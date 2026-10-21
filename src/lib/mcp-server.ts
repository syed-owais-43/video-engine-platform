import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { usageEvents, users } from "@/db/schema";
import { getAccess, PROJECT_TOOL, type Access } from "./access";
import { baseUrl } from "./config";
import { readSharedFile, SHARED_GUIDES } from "./shared-tools";
import {
  BUNDLE_TTL_SECONDS,
  getPublishedEngine,
  listEngineFiles,
  listPublishedEngines,
  rankEngines,
  readEngineFile,
  signedBundleUrl,
} from "./engines";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
const text = (t: string, isError = false): ToolResult => ({ content: [{ type: "text", text: t }], ...(isError ? { isError } : {}) });

const SERVER_INSTRUCTIONS = `Framewright serves video-generation engines (skills). Workflow:
1. Call start_project with the user's video idea. It picks the best engine and returns its entry instructions.
2. Follow those instructions. Whenever they mention a file under reference/ (e.g. reference/visual-design.md), call get_guide to read it.
3. Call get_scripts once per engine version to get the local helper bundle (scripts, templates). If the Framewright Companion MCP server is connected, use its install_engine tool instead.
4. Render on the user's own machine with their terminal/file tools.
Do not save fetched instructions or guides to disk; fetch them again when needed.`;

async function logUsage(userId: string, tool: string, engineId: string | null, detail?: string) {
  await db.insert(usageEvents).values({ userId, tool, engineId, detail: detail?.slice(0, 500) });
}

function subscribeMessage() {
  return text(
    `This Framewright account has no active subscription. Ask the user to subscribe at ${baseUrl()}/pricing, then try again.`,
    true,
  );
}

function limitMessage(a: Access) {
  return text(
    `This account has used ${a.used} of ${a.limit} projects for the current billing period. ` +
      `The user can upgrade at ${baseUrl()}/pricing or wait until ${a.periodEnd?.toISOString().slice(0, 10) ?? "the next period"}.`,
    true,
  );
}

function remotePreamble(slug: string, version: string, guides: string[]) {
  return `# Framewright engine: ${slug} v${version}

You are running this engine through Framewright. Path conventions in the instructions below:
- \`reference/<file>.md\` → call the get_guide tool with engine="${slug}" and that path. Do not look for it on disk.
- \`<skill>\` / the skill folder → the local helper bundle from get_scripts (or the Companion's install_engine), which contains scripts/, templates/ and LICENSE.md.
- \`LICENSE.md\` is in the local bundle.
- Editable export for Premiere Pro / DaVinci Resolve / Final Cut Pro: when the user asks for an editable or project-file
  version, read get_guide path "framewright/export.md" and follow it.
- Timeline editor: when the user wants to fine-tune in the Framewright editor, or asks you to apply their editor edits or
  "editor requests", read get_guide path "framewright/editor.md" and follow it. After the final render is approved, mention
  once that both the editor and the editable export are available.
Available guides: ${[...guides, ...Object.keys(SHARED_GUIDES)].join(", ") || "(none)"}

---

`;
}

export function createMcpServer(userId: string) {
  const server = new McpServer({ name: "framewright", version: "1.0.0" }, { instructions: SERVER_INSTRUCTIONS });

  async function loadUserAccess() {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) return null;
    return getAccess(user);
  }

  server.registerTool(
    "list_engines",
    {
      title: "List video engines",
      description: "List the video-generation engines available on Framewright.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const list = await listPublishedEngines();
      if (!list.length) return text("No engines are published yet.");
      return text(
        list.map((e) => `- ${e.slug} (v${e.version}): ${e.name}. ${e.description}${e.tags.length ? ` Tags: ${e.tags.join(", ")}` : ""}`).join("\n"),
      );
    },
  );

  server.registerTool(
    "start_project",
    {
      title: "Start a video project",
      description:
        "Start a new video. Pass the user's idea (and a summary of any references they gave). Picks the best engine (or the one you name) and returns its entry instructions. Counts as one project against the user's plan.",
      inputSchema: {
        brief: z.string().min(3).max(4000).describe("The user's video idea, format, length, style and references, summarised"),
        engine: z.string().optional().describe("Engine slug to force; omit to auto-select"),
      },
    },
    async ({ brief, engine }) => {
      const access = await loadUserAccess();
      if (!access?.active) return subscribeMessage();
      if (access.limit !== null && access.used >= access.limit) return limitMessage(access);

      const list = await listPublishedEngines();
      if (!list.length) return text("No engines are published yet.", true);
      const chosen = engine ? list.find((e) => e.slug === engine) : rankEngines(brief, list)[0]?.engine;
      if (!chosen) return text(`Unknown engine "${engine}". Available: ${list.map((e) => e.slug).join(", ")}`, true);

      const row = await getPublishedEngine(chosen.slug);
      const skill = row && (await readEngineFile(row.version.id, "SKILL.md", "remote"));
      if (!row || !skill) return text("Engine entrypoint is missing; contact support.", true);

      const guides = (await listEngineFiles(row.version.id, ["remote"])).map((f) => f.path).filter((p) => p !== "SKILL.md");
      await logUsage(userId, PROJECT_TOOL, chosen.id, brief);
      const remaining = access.limit === null ? "unlimited" : `${access.limit - access.used - 1} left this period`;
      return text(
        `Selected engine: ${chosen.slug} v${chosen.version} (projects: ${remaining}).\n\n` +
          remotePreamble(chosen.slug, chosen.version, guides) +
          skill.toString("utf8"),
      );
    },
  );

  server.registerTool(
    "get_guide",
    {
      title: "Read an engine guide",
      description: "Read one of the engine's reference guides (e.g. reference/visual-design.md). Load only what the current task needs.",
      inputSchema: {
        engine: z.string().describe("Engine slug"),
        path: z.string().describe("Guide path such as reference/visual-design.md"),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ engine, path }) => {
      const access = await loadUserAccess();
      if (!access?.active) return subscribeMessage();
      const row = await getPublishedEngine(engine);
      if (!row) return text(`Unknown engine "${engine}".`, true);
      const clean = path.replace(/\\/g, "/").replace(/^\.?\//, "").replace(/^<skill>\//, "");
      const shared = SHARED_GUIDES[clean];
      // Shared guides may contain {{SITE_URL}} so commands they show point at this deployment.
      const file = shared
        ? Buffer.from(readSharedFile(shared).toString("utf8").replaceAll("{{SITE_URL}}", baseUrl()))
        : await readEngineFile(row.version.id, clean, "remote");
      if (!file) {
        const guides = (await listEngineFiles(row.version.id, ["remote"])).map((f) => f.path);
        return text(`No guide "${clean}". Available: ${[...guides, ...Object.keys(SHARED_GUIDES)].join(", ")}`, true);
      }
      await logUsage(userId, "get_guide", row.engine.id, clean);
      return text(file.toString("utf8"));
    },
  );

  server.registerTool(
    "get_scripts",
    {
      title: "Get local helper bundle",
      description:
        "Get a short-lived download link and install commands for the engine's local helper bundle (scripts, templates, licence). Needed before running engine scripts.",
      inputSchema: { engine: z.string().describe("Engine slug") },
      annotations: { readOnlyHint: true },
    },
    async ({ engine }) => {
      const access = await loadUserAccess();
      if (!access?.active) return subscribeMessage();
      const row = await getPublishedEngine(engine);
      if (!row) return text(`Unknown engine "${engine}".`, true);
      const url = signedBundleUrl(row.engine.slug, row.version.id, userId);
      const v = row.version.version;
      const dir = `.framewright/engines/${row.engine.slug}/${v}`;
      await logUsage(userId, "get_scripts", row.engine.id, v);
      return text(
        `Bundle for ${row.engine.slug} v${v}. Link expires in ${BUNDLE_TTL_SECONDS / 60} minutes; do not share it.\n` +
          `Install into the user's home folder at ~/${dir} (skip if that folder already exists). The engine root (\`<skill>\`) is ~/${dir}/${row.engine.slug}.\n\n` +
          `Windows (PowerShell):\n` +
          `$d="$HOME\\${dir.replace(/\//g, "\\")}"; New-Item -ItemType Directory -Force $d | Out-Null; Invoke-WebRequest "${url}" -OutFile "$d\\bundle.zip"; Expand-Archive -Force "$d\\bundle.zip" $d; Remove-Item "$d\\bundle.zip"\n\n` +
          `macOS / Linux:\n` +
          `d="$HOME/${dir}"; mkdir -p "$d" && curl -fsSL "${url}" -o "$d/bundle.zip" && unzip -oq "$d/bundle.zip" -d "$d" && rm "$d/bundle.zip"`,
      );
    },
  );

  server.registerTool(
    "account_status",
    {
      title: "Account status",
      description: "Show the user's Framewright plan, usage and access.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const a = await loadUserAccess();
      if (!a) return text("Account not found.", true);
      if (!a.active) return text(`No active subscription. Subscribe at ${baseUrl()}/pricing.`);
      return text(
        [
          `Access: active (${a.source === "comp" ? "complimentary" : (a.plan?.name ?? "subscription")})`,
          `Projects this period: ${a.used}${a.limit === null ? " (unlimited)" : ` of ${a.limit}`}`,
          a.periodEnd ? `Period ends: ${a.periodEnd.toISOString().slice(0, 10)}${a.cancelAtPeriodEnd ? " (cancels then)" : ""}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      );
    },
  );

  return server;
}
