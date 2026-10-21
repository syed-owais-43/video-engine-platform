import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { usageEvents, users } from "@/db/schema";
import { getAccess, PROJECT_TOOL, type Access } from "./access";
import { baseUrl } from "./config";
import { readSharedFile, SHARED_GUIDES } from "./shared-tools";
import { getBalance, refundCredits, spendCredits } from "./credits";
import { ASPECTS, generateImage, type Aspect } from "./images";
import { getSettings } from "./settings";
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

const serverInstructions = (brand: string) => `${brand} serves video-generation engines (skills). Workflow:
1. Call start_project with the user's video idea. It picks the best engine and returns its entry instructions.
2. Follow those instructions. Whenever they mention a file under reference/ (e.g. reference/visual-design.md), call get_guide to read it.
3. Call get_scripts once per engine version to get the local helper bundle (scripts, templates). If the ${brand} Companion MCP server is connected, use its install_engine tool instead.
4. Render on the user's own machine with their terminal/file tools.
Do not save fetched instructions or guides to disk; fetch them again when needed.`;

async function logUsage(userId: string, tool: string, engineId: string | null, detail?: string) {
  await db.insert(usageEvents).values({ userId, tool, engineId, detail: detail?.slice(0, 500) });
}

function subscribeMessage() {
  return text(
    `This account has no active subscription. Ask the user to subscribe at ${baseUrl()}/pricing, then try again.`,
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

function remotePreamble(brand: string, slug: string, version: string, guides: string[]) {
  return `# ${brand} engine: ${slug} v${version}

You are running this engine through ${brand}. Path conventions in the instructions below:
- \`reference/<file>.md\` → call the get_guide tool with engine="${slug}" and that path. Do not look for it on disk.
- \`<skill>\` / the skill folder → the local helper bundle from get_scripts (or the Companion's install_engine), which contains scripts/, templates/ and LICENSE.md.
- \`LICENSE.md\` is in the local bundle.
- Editable export for Premiere Pro / DaVinci Resolve / Final Cut Pro: when the user asks for an editable or project-file
  version, read get_guide path "framewright/export.md" and follow it.
- Timeline editor: when the user wants to fine-tune in the ${brand} editor, or asks you to apply their editor edits or
  "editor requests", read get_guide path "framewright/editor.md" and follow it. After the final render is approved, mention
  once that both the editor and the editable export are available.
Available guides: ${[...guides, ...Object.keys(SHARED_GUIDES)].join(", ") || "(none)"}

---

`;
}

export async function createMcpServer(userId: string) {
  const brandCfg = (await getSettings()).brand;
  const brand = brandCfg.name;
  const slug = brand.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "videos";
  const server = new McpServer({ name: slug, version: "1.0.0" }, { instructions: serverInstructions(brand) });

  async function loadUserAccess() {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) return null;
    return getAccess(user);
  }

  server.registerTool(
    "list_engines",
    {
      title: "List video engines",
      description: `List the video-generation engines available on ${brand}.`,
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
          remotePreamble(brand, chosen.slug, chosen.version, guides) +
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
        ? Buffer.from(readSharedFile(shared).toString("utf8").replaceAll("{{SITE_URL}}", baseUrl()).replaceAll("{{BRAND}}", brand).replaceAll("{{COMPANION}}", brandCfg.companionPackage))
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
    "generate_image",
    {
      title: "Generate an image",
      description:
        "Generate one image for the video (backgrounds, illustrations, textures, product shots) using the user's image credits. " +
        "Use it only when the user wants AI-made images or approved it for this project; prefer images the user supplied. " +
        "Returns a temporary URL: download it into the project right away.",
      inputSchema: {
        prompt: z.string().min(3).max(2000).describe("Detailed description of the image"),
        model: z.string().optional().describe("Model key from account_status; omit for the plan's default"),
        aspect: z.enum(Object.keys(ASPECTS) as [Aspect, ...Aspect[]]).default("landscape").describe("Image shape"),
        seed: z.number().int().min(0).max(2 ** 31 - 1).optional(),
      },
    },
    async ({ prompt, model, aspect, seed }) => {
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      if (!user) return text("Account not found.", true);
      const cfg = (await getSettings()).images;
      if (!cfg.enabled || !cfg.falKey) {
        return text("AI image generation isn't available on this site. Ask the user for images instead (they can attach them in chat or put them in the project's assets/ folder).", true);
      }
      const bal = await getBalance(user);
      if (!bal.access.active) return subscribeMessage();
      const enabled = cfg.models.filter((m) => m.enabled);
      // Complimentary accounts may use every enabled model; plans list theirs explicitly.
      const allowed = bal.access.plan ? enabled.filter((m) => bal.access.plan!.imageModels.includes(m.key)) : enabled;
      if (!allowed.length) return text(`This plan doesn't include image generation. The user can upgrade at ${baseUrl()}/pricing.`, true);
      const chosen = model ? allowed.find((m) => m.key === model) : [...allowed].sort((a, b) => a.credits - b.credits)[0];
      if (!chosen) {
        const other = enabled.find((m) => m.key === model);
        return text(
          other
            ? `${other.label} isn't included in this plan. Available: ${allowed.map((m) => `${m.key} (${m.label}, ${m.credits} credits)`).join(", ")}. Upgrade at ${baseUrl()}/pricing.`
            : `Unknown model "${model}". Available: ${allowed.map((m) => m.key).join(", ")}.`,
          true,
        );
      }
      const spent = await spendCredits(user, chosen.credits, `${chosen.key}: ${prompt.slice(0, 200)}`);
      if (!spent) {
        return text(
          `Not enough credits: ${chosen.label} costs ${chosen.credits}, the user has ${bal.total}. They can buy more at ${baseUrl()}/dashboard or wait for the monthly refill.`,
          true,
        );
      }
      try {
        const r = await generateImage({ falKey: cfg.falKey, endpoint: chosen.endpoint, prompt, aspect, seed });
        await logUsage(userId, "generate_image", null, `${chosen.key}: ${prompt}`);
        const img = r.images[0];
        const left = (await getBalance(user)).total;
        const rights = bal.access.plan && !bal.access.plan.commercialUse ? "Personal use only on this plan (no commercial use)." : "Commercial use allowed.";
        return text(
          `Generated with ${chosen.label} (${chosen.credits} credits, ${left} left). ${rights}\n` +
            `URL (temporary, download now): ${img.url}\n` +
            `${img.width && img.height ? `Size: ${img.width}x${img.height}\n` : ""}` +
            `Save it into the project, e.g. assets/generated/<short-name>.${(img.content_type ?? "image/jpeg").split("/")[1]?.replace("jpeg", "jpg") ?? "jpg"}, ` +
            `using the Companion's download_file tool or: curl -L "<url>" -o "<path>". Record it in the asset manifest as "AI-generated (${chosen.endpoint})".`,
        );
      } catch (e) {
        await refundCredits(userId, spent, `failed ${chosen.key}`);
        return text(`Image generation failed and the credits were refunded: ${e instanceof Error ? e.message : e}`, true);
      }
    },
  );

  server.registerTool(
    "account_status",
    {
      title: "Account status",
      description: "Show the user's plan, usage, image credits and access.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      if (!user) return text("Account not found.", true);
      const bal = await getBalance(user);
      const a = bal.access;
      if (!a.active) return text(`No active subscription. Subscribe at ${baseUrl()}/pricing.`);
      const cfg = (await getSettings()).images;
      const enabled = cfg.enabled ? cfg.models.filter((m) => m.enabled) : [];
      const allowed = a.plan ? enabled.filter((m) => a.plan!.imageModels.includes(m.key)) : enabled;
      return text(
        [
          `Access: active (${a.source === "comp" ? "complimentary" : (a.plan?.name ?? "subscription")})`,
          `Projects this period: ${a.used}${a.limit === null ? " (unlimited)" : ` of ${a.limit}`}`,
          a.periodEnd ? `Period ends: ${a.periodEnd.toISOString().slice(0, 10)}${a.cancelAtPeriodEnd ? " (cancels then)" : ""}` : "",
          allowed.length
            ? `Image credits: ${bal.total} (${bal.monthlyLeft} monthly left of ${bal.monthlyAllowance}, ${Math.max(0, bal.topup)} top-up). Models: ${allowed.map((m) => `${m.key} = ${m.label}, ${m.credits} credits`).join("; ")}.`
            : "AI image generation: not included.",
          a.plan && !a.plan.commercialUse ? "Usage rights: personal use only." : "",
        ]
          .filter(Boolean)
          .join("\n"),
      );
    },
  );

  return server;
}
