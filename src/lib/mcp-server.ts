import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { usageEvents, users, type LibraryItem, type User } from "@/db/schema";
import { getAccess, PROJECT_TOOL } from "./access";
import { baseUrl } from "./config";
import { readSharedFile, SETUP_VERSION, SHARED_GUIDES } from "./shared-tools";
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
import {
  fileBytes,
  filesOf,
  findPath,
  FILE_LINK_TTL,
  getItem,
  listItems,
  PACK_CATEGORIES,
  PACK_LABELS,
  paletteOf,
  SHELVES,
  signedFileUrl,
  type FileRef,
  type PackCategory,
  type ShelfKind,
} from "./library";
import { listVoices, MAX_TTS_CHARS, signedTtsUrl, TTS_LINK_TTL, usesElevenlabs, elevenlabsKeyOf, ELEVENLABS_MODEL } from "./voice";

type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
type ToolResult = { content: Content[]; isError?: boolean; structuredContent?: Record<string, unknown> };
const text = (t: string, isError = false): ToolResult => ({ content: [{ type: "text", text: t }], ...(isError ? { isError } : {}) });

// Contact sheets are sent to the AI as images. MCP responses go through a serverless function with a
// response size limit, so very large sheets are linked instead.
const MAX_INLINE_IMAGE = 1_500_000;

const serverInstructions = (brand: string) => `${brand} gives you everything to make expert-level videos that render on the user's own computer. Workflow:
0. First time on this computer: call get_setup and install what it lists yourself (ffmpeg, Playwright + Chromium, Python models, Voicebox, yt-dlp). The user does nothing.
1. Look: if the user picks a style (or describes one), call list_styles / get_style and build in exactly that look. If they send a reference video or link, download it with yt-dlp (see get_setup) and analyse it with the engine's tools; ready-made references are in list_refs / get_ref.
2. Call start_project with the user's video idea. It picks the best engine and returns its entry instructions. Follow them; whenever they mention a file under reference/ (e.g. reference/visual-design.md), call get_guide to read it.
3. Call get_scripts once per engine version to get the local helper bundle (scripts, templates), and get_assets for sound effects, fonts, textures and Lottie files. If the ${brand} Companion MCP server is connected, use its install_engine and get_assets tools instead (they download once to ~/.framewright).
4. Voice-over: call get_voice (Voicebox on this PC by default, or the user's own ElevenLabs key).
5. Render on the user's machine with their terminal/file tools. To let the user fine-tune scenes with sliders in the ${brand} editor, follow get_guide framewright/editor.md and framewright/scenes.md.
Do not save fetched instructions or guides to disk; fetch them again when needed.`;

async function logUsage(userId: string, tool: string, engineId: string | null, detail?: string) {
  await db.insert(usageEvents).values({ userId, tool, engineId, detail: detail?.slice(0, 500) });
}

function subscribeMessage() {
  return text(`This account has no active subscription. Ask the user to subscribe at ${baseUrl()}/pricing, then try again.`, true);
}

function fillShared(file: string, brand: string, companion: string) {
  return readSharedFile(file)
    .toString("utf8")
    .replaceAll("{{SITE_URL}}", baseUrl())
    .replaceAll("{{BRAND}}", brand)
    .replaceAll("{{COMPANION}}", companion)
    .replaceAll("{{SETUP_VERSION}}", String(SETUP_VERSION));
}

function remotePreamble(brand: string, slug: string, version: string, guides: string[]) {
  return `# ${brand} engine: ${slug} v${version}

You are running this engine through ${brand}. Path conventions in the instructions below:
- \`reference/<file>.md\` → call the get_guide tool with engine="${slug}" and that path. Do not look for it on disk.
- \`<skill>\` / the skill folder → the local helper bundle from get_scripts (or the Companion's install_engine), which contains scripts/, templates/ and LICENSE.md.
- \`LICENSE.md\` is in the local bundle.
- Computer setup: if \`~/.framewright/setup.json\` is missing on this computer or its "version" is below ${SETUP_VERSION}, call get_setup and finish it first.
- Look: if a ${brand} style was chosen, its style.json and recipe.md (get_style) override the engine's default look; keep to them.
- Sound effects, fonts, textures, Lottie: call get_assets (installed once in ~/.framewright/assets) before reaching for anything else.
- Voice-over: call get_voice and use what it says.
- Editable export for Premiere Pro / DaVinci Resolve / Final Cut Pro: when the user asks for an editable or project-file
  version, read get_guide path "framewright/export.md" and follow it.
- Timeline editor and scene sliders: when the user wants to fine-tune in the ${brand} editor, or asks you to apply their editor
  edits or "editor requests", read get_guide path "framewright/editor.md" (and "framewright/scenes.md") and follow it. After
  the final render is approved, mention once that both the editor and the editable export are available.
Available guides: ${[...guides, ...Object.keys(SHARED_GUIDES)].join(", ") || "(none)"}

---

`;
}

const kb = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`);

export async function createMcpServer(userId: string) {
  const brandCfg = (await getSettings()).brand;
  const brand = brandCfg.name;
  const slug = brand.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "videos";
  const server = new McpServer({ name: slug, version: "1.1.0" }, { instructions: serverInstructions(brand) });

  // The server is created per request, so this is loaded at most once per tool call.
  let cached: Promise<{ user: User; active: boolean } | null> | null = null;
  const me = () =>
    (cached ??= (async () => {
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      return user ? { user, active: (await getAccess(user)).active } : null;
    })());

  // Until the user's AI has run the setup checklist, every answer starts with it, so the first
  // call from a new subscriber sets up their computer before anything else.
  async function withSetup(result: ToolResult): Promise<ToolResult> {
    const m = await me();
    if (!m?.active || result.isError || m.user.setupVersion >= SETUP_VERSION) return result;
    const checklist =
      `IMPORTANT, before anything else: set up this computer for ${brand} (one time). Follow this checklist now, then call finish_setup, ` +
      `then continue with the user's request.\n\n${fillShared("setup.md", brand, brandCfg.companionPackage)}\n\n---\n\n`;
    return { ...result, content: [{ type: "text", text: checklist }, ...result.content] };
  }

  async function requireActive() {
    const m = await me();
    return m?.active ? m.user : null;
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
      if (!list.length) return withSetup(text("No engines are published yet."));
      return withSetup(
        text(list.map((e) => `- ${e.slug} (v${e.version}): ${e.name}. ${e.description}${e.tags.length ? ` Tags: ${e.tags.join(", ")}` : ""}`).join("\n")),
      );
    },
  );

  server.registerTool(
    "start_project",
    {
      title: "Start a video project",
      description:
        "Start a new video. Pass the user's idea (and a summary of any references they gave). Picks the best engine (or the one you name) and returns its entry instructions.",
      inputSchema: {
        brief: z.string().min(3).max(4000).describe("The user's video idea, format, length, style and references, summarised"),
        engine: z.string().optional().describe("Engine slug to force; omit to auto-select"),
        style: z.string().optional().describe("Style id from list_styles, if the user chose one"),
      },
    },
    async ({ brief, engine, style }) => {
      if (!(await requireActive())) return subscribeMessage();
      const list = await listPublishedEngines();
      if (!list.length) return text("No engines are published yet.", true);
      const chosen = engine ? list.find((e) => e.slug === engine) : rankEngines(brief, list)[0]?.engine;
      if (!chosen) return text(`Unknown engine "${engine}". Available: ${list.map((e) => e.slug).join(", ")}`, true);

      const row = await getPublishedEngine(chosen.slug);
      const skill = row && (await readEngineFile(row.version.id, "SKILL.md", "remote"));
      if (!row || !skill) return text("Engine entrypoint is missing; contact support.", true);

      const styleItem = style ? await getItem("style", style) : null;
      const guides = (await listEngineFiles(row.version.id, ["remote"])).map((f) => f.path).filter((p) => p !== "SKILL.md");
      await logUsage(userId, PROJECT_TOOL, chosen.id, `${styleItem ? `[style ${styleItem.slug}] ` : ""}${brief}`);
      return withSetup(
        text(
          `Selected engine: ${chosen.slug} v${chosen.version}.` +
            (style ? (styleItem ? ` Style: ${styleItem.slug} (call get_style("${styleItem.slug}") if you haven't yet).` : ` No published style "${style}"; see list_styles.`) : "") +
            `\n\n` +
            remotePreamble(brand, chosen.slug, chosen.version, guides) +
            skill.toString("utf8"),
        ),
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
      if (!(await requireActive())) return subscribeMessage();
      const row = await getPublishedEngine(engine);
      if (!row) return text(`Unknown engine "${engine}".`, true);
      const clean = path.replace(/\\/g, "/").replace(/^\.?\//, "").replace(/^<skill>\//, "");
      const shared = SHARED_GUIDES[clean];
      // Shared guides may contain {{SITE_URL}} so commands they show point at this deployment.
      const file = shared ? Buffer.from(fillShared(shared, brand, brandCfg.companionPackage)) : await readEngineFile(row.version.id, clean, "remote");
      if (!file) {
        const guides = (await listEngineFiles(row.version.id, ["remote"])).map((f) => f.path);
        return text(`No guide "${clean}". Available: ${[...guides, ...Object.keys(SHARED_GUIDES)].join(", ")}`, true);
      }
      await logUsage(userId, "get_guide", row.engine.id, clean);
      return withSetup(text(file.toString("utf8")));
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
      if (!(await requireActive())) return subscribeMessage();
      const row = await getPublishedEngine(engine);
      if (!row) return text(`Unknown engine "${engine}".`, true);
      const url = signedBundleUrl(row.engine.slug, row.version.id, userId);
      const v = row.version.version;
      const dir = `.framewright/engines/${row.engine.slug}/${v}`;
      await logUsage(userId, "get_scripts", row.engine.id, v);
      return withSetup(
        text(
          `Bundle for ${row.engine.slug} v${v}. Link expires in ${BUNDLE_TTL_SECONDS / 60} minutes; do not share it.\n` +
            `Install into the user's home folder at ~/${dir} (skip if that folder already exists). The engine root (\`<skill>\`) is ~/${dir}/${row.engine.slug}.\n\n` +
            `Windows (PowerShell):\n` +
            `$d="$HOME\\${dir.replace(/\//g, "\\")}"; New-Item -ItemType Directory -Force $d | Out-Null; Invoke-WebRequest "${url}" -OutFile "$d\\bundle.zip"; Expand-Archive -Force "$d\\bundle.zip" $d; Remove-Item "$d\\bundle.zip"\n\n` +
            `macOS / Linux:\n` +
            `d="$HOME/${dir}"; mkdir -p "$d" && curl -fsSL "${url}" -o "$d/bundle.zip" && unzip -oq "$d/bundle.zip" -d "$d" && rm "$d/bundle.zip"`,
        ),
      );
    },
  );

  // ---------- style and inspiration libraries ----------

  async function shelfList(kind: ShelfKind, tag?: string) {
    const shelf = SHELVES[kind];
    const items = (await listItems(kind, { published: true })).filter(
      (i) => !tag || i.tags.some((t) => t.toLowerCase().includes(tag.toLowerCase())) || i.name.toLowerCase().includes(tag.toLowerCase()),
    );
    if (!items.length) return text(tag ? `No ${shelf.plural.toLowerCase()} match "${tag}".` : `No ${shelf.plural.toLowerCase()} are published yet.`);
    const lines = items.map((i) => {
      const palette = kind === "style" ? paletteOf(i.meta) : [];
      return `- ${i.slug}: ${i.name}. ${i.description}${i.tags.length ? ` Tags: ${i.tags.join(", ")}.` : ""}${palette.length ? ` Palette: ${palette.join(" ")}.` : ""}`;
    });
    return text(
      `${shelf.plural} on ${brand} (the user can browse them at ${baseUrl()}${shelf.path}):\n${lines.join("\n")}\n\n` +
        `Call ${kind === "style" ? "get_style" : "get_ref"} with an id to load one.`,
    );
  }

  async function sheetImages(files: FileRef[], groups: readonly (readonly string[])[], labels: string[]) {
    const out: Content[] = [];
    const notes: string[] = [];
    for (const [i, names] of groups.entries()) {
      const f = findPath(files, names);
      if (!f) continue;
      if (f.size > MAX_INLINE_IMAGE) {
        notes.push(`${labels[i]} (${f.path}, ${kb(f.size)}) is too large to show inline: ${signedFileUrl(f.id, userId)}`);
        continue;
      }
      const bytes = await fileBytes(f.id);
      if (bytes) out.push({ type: "text", text: `${labels[i]} (${f.path}):` }, { type: "image", data: bytes.toString("base64"), mimeType: f.contentType });
    }
    return { images: out, notes };
  }

  function downloadList(item: LibraryItem, files: FileRef[], skip: string[]) {
    const extra = files.filter((f) => !skip.includes(f.path));
    if (!extra.length) return "";
    const base = `assets/${item.kind === "style" ? "style" : "ref"}/${item.slug}`;
    return (
      `\n## Files (download into the project, under ${base}/; links expire in ${FILE_LINK_TTL / 60} minutes, don't share them)\n` +
      extra.map((f) => `- ${f.path} (${kb(f.size)}): ${signedFileUrl(f.id, userId)}`).join("\n") +
      `\n\nmacOS / Linux: curl -fsSL "<link>" --create-dirs -o "${base}/<path>"\n` +
      `Windows: New-Item -ItemType Directory -Force (Split-Path "${base}/<path>") | Out-Null; Invoke-WebRequest "<link>" -OutFile "${base}/<path>"\n` +
      `Companion: download_file with the link and that path.\n`
    );
  }

  server.registerTool(
    "list_styles",
    {
      title: "List styles",
      description: `List ${brand}'s video styles (look recipes: palette, type, motion, sound). Optional filter by tag or word.`,
      inputSchema: { tag: z.string().max(60).optional().describe("Filter, e.g. 'saas', 'kinetic', 'minimal'") },
      annotations: { readOnlyHint: true },
    },
    async ({ tag }) => {
      if (!(await requireActive())) return subscribeMessage();
      return withSetup(await shelfList("style", tag));
    },
  );

  server.registerTool(
    "get_style",
    {
      title: "Load a style",
      description:
        "Load one style: style.json (palette hex codes, fonts, sizes, easing, timings, SFX names), recipe.md (the rules in plain words) and its contact sheet image. Build the video in exactly this look.",
      inputSchema: { id: z.string().min(1).max(80).describe("Style id from list_styles, e.g. clean-premium-saas") },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => {
      if (!(await requireActive())) return subscribeMessage();
      const item = await getItem("style", id);
      if (!item) return text(`No published style "${id}". Call list_styles for the ids.`, true);
      const files = await filesOf([item.id]);
      const { images, notes } = await sheetImages(files, SHELVES.style.frames, ["Contact sheet: key frames of this style"]);
      await logUsage(userId, "get_style", null, item.slug);
      const preview = findPath(files, SHELVES.style.video);
      const head =
        `# Style: ${item.name} (${item.slug}, v${item.version})\n${item.description}\n\n` +
        `Build every scene in exactly this look: follow recipe.md's rules, take colours, fonts, sizes, easing, timings and SFX ` +
        `names from style.json, and match the contact sheet. Where the engine's own design guidance disagrees, the style wins. ` +
        `Expose the style's palette as colour swatches when you write scene.params.json.\n\n` +
        `## style.json\n\`\`\`json\n${JSON.stringify(item.meta, null, 2)}\n\`\`\`\n\n## recipe.md\n${item.notes}\n` +
        downloadList(item, files, ["style.json", "recipe.md", ...SHELVES.style.frames.flat(), ...SHELVES.style.video]) +
        (preview ? `\nGallery preview for the user: ${baseUrl()}${SHELVES.style.path}#${item.slug}\n` : "") +
        (notes.length ? `\n${notes.join("\n")}\n` : "");
      return withSetup({ content: [{ type: "text", text: head }, ...images] });
    },
  );

  server.registerTool(
    "list_refs",
    {
      title: "List inspiration references",
      description: `List ${brand}'s inspiration library: analysed reference videos (shot-by-shot breakdowns). Optional filter by tag or word.`,
      inputSchema: { tag: z.string().max(60).optional().describe("Filter, e.g. 'recap', 'product launch'") },
      annotations: { readOnlyHint: true },
    },
    async ({ tag }) => {
      if (!(await requireActive())) return subscribeMessage();
      return withSetup(await shelfList("ref", tag));
    },
  );

  server.registerTool(
    "get_ref",
    {
      title: "Load an inspiration reference",
      description:
        "Load one reference: breakdown.md (shot-by-shot timeline, type system, motion, SFX map), its contact sheet and the first 3 seconds frame by frame, and a private link to the original video when available.",
      inputSchema: { id: z.string().min(1).max(80).describe("Reference id from list_refs") },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => {
      if (!(await requireActive())) return subscribeMessage();
      const item = await getItem("ref", id);
      if (!item) return text(`No published reference "${id}". Call list_refs for the ids.`, true);
      const files = await filesOf([item.id]);
      const { images, notes } = await sheetImages(files, SHELVES.ref.frames, ["Contact sheet: key frames", "Hook: the first 3 seconds, frame by frame"]);
      const video = findPath(files, SHELVES.ref.video);
      await logUsage(userId, "get_ref", null, item.slug);
      const head =
        `# Reference: ${item.name} (${item.slug})\n${item.description}\n\n` +
        `Use it as a blueprint for structure, pacing, type system, motion and sound, rebuilt with the user's own content. ` +
        `Never copy its footage, logos, music or exact wording into the user's video.\n\n## breakdown.md\n${item.notes}\n` +
        (video
          ? `\n## Original video (private to subscribers; for analysis only, don't redistribute or reuse its footage)\n` +
            `${video.path} (${kb(video.size)}), link valid ${FILE_LINK_TTL / 60} minutes: ${signedFileUrl(video.id, userId)}\n`
          : "") +
        downloadList(item, files, ["breakdown.md", ...SHELVES.ref.frames.flat(), ...SHELVES.ref.video]) +
        (notes.length ? `\n${notes.join("\n")}\n` : "");
      return withSetup({ content: [{ type: "text", text: head }, ...images] });
    },
  );

  // ---------- resource packs ----------

  server.registerTool(
    "get_assets",
    {
      title: "Get resource packs",
      description:
        "Sound effects, fonts, textures, Lottie animations and music for the user's videos. Returns each pack with its install folder (~/.framewright/assets/<pack>/v<version>) and a download link; install each pack once and reuse it across projects.",
      inputSchema: { category: z.enum(PACK_CATEGORIES).optional().describe("Only packs of this kind") },
      outputSchema: {
        root: z.string(),
        packs: z.array(
          z.object({
            slug: z.string(),
            name: z.string(),
            category: z.string(),
            version: z.number(),
            size: z.number(),
            folder: z.string(),
            url: z.string(),
            description: z.string(),
          }),
        ),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ category }) => {
      if (!(await requireActive())) return subscribeMessage();
      const items = (await listItems("pack", { published: true })).filter((p) => !category || p.meta.category === category);
      const files = await filesOf(items.map((i) => i.id));
      const packs = items.flatMap((i) => {
        const f = files.find((x) => x.itemId === i.id && x.path === "pack.zip");
        if (!f) return [];
        const cat = (PACK_CATEGORIES as readonly string[]).includes(String(i.meta.category)) ? (i.meta.category as PackCategory) : "other";
        return [{ slug: i.slug, name: i.name, category: cat, version: i.version, size: f.size, folder: `${i.slug}/v${i.version}`, url: signedFileUrl(f.id, userId), description: i.description }];
      });
      await logUsage(userId, "get_assets", null, category ?? "all");
      const structuredContent = { root: "~/.framewright/assets", packs };
      if (!packs.length) return withSetup({ content: [{ type: "text", text: "No resource packs are published yet." }], structuredContent });
      const body =
        `Resource packs (install each once; the folder name includes the version, so skip packs whose folder already exists). ` +
        `Links expire in ${FILE_LINK_TTL / 60} minutes. If the ${brand} Companion is connected, its get_assets tool installs them for you.\n\n` +
        packs.map((p) => `- ${p.slug} v${p.version} · ${PACK_LABELS[p.category]} · ${kb(p.size)}: ${p.name}. ${p.description}\n  folder: ~/.framewright/assets/${p.folder}\n  link: ${p.url}`).join("\n") +
        `\n\nInstall one pack (replace <folder> and <link>):\n` +
        `macOS / Linux: d="$HOME/.framewright/assets/<folder>"; [ -d "$d" ] || { mkdir -p "$d" && curl -fsSL "<link>" -o "$d.zip" && unzip -oq "$d.zip" -d "$d" && rm "$d.zip"; }\n` +
        `Windows: $d="$HOME\\.framewright\\assets\\<folder>"; if (!(Test-Path $d)) { New-Item -ItemType Directory -Force $d | Out-Null; Invoke-WebRequest "<link>" -OutFile "$d.zip"; Expand-Archive -Force "$d.zip" $d; Remove-Item "$d.zip" }\n\n` +
        `Then list the pack folders to find files. Copy what a project uses into its assets/ folder, and record each file in the asset manifest as "${brand} pack <slug>".`;
      return withSetup({ content: [{ type: "text", text: body }], structuredContent });
    },
  );

  // ---------- computer setup ----------

  server.registerTool(
    "get_setup",
    {
      title: "Computer setup checklist",
      description:
        "The one-time setup checklist for this computer (FFmpeg, Playwright + Chromium, Python with analysis and speech models, Voicebox, yt-dlp). You install everything; call finish_setup when done.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      if (!(await requireActive())) return subscribeMessage();
      return text(fillShared("setup.md", brand, brandCfg.companionPackage));
    },
  );

  server.registerTool(
    "finish_setup",
    {
      title: "Finish computer setup",
      description: "Report that the setup checklist from get_setup is done on this computer (or was already done).",
      inputSchema: { summary: z.string().min(2).max(1000).describe("One line: what was installed, what was skipped and why") },
    },
    async ({ summary }) => {
      if (!(await requireActive())) return subscribeMessage();
      await db.update(users).set({ setupVersion: SETUP_VERSION }).where(eq(users.id, userId));
      await logUsage(userId, "finish_setup", null, summary);
      return text(`Setup v${SETUP_VERSION} recorded. Continue with the user's request.`);
    },
  );

  // ---------- voice ----------

  server.registerTool(
    "get_voice",
    {
      title: "Voice-over",
      description:
        "How to make the voice-over for this user: Voicebox on their own computer (free, default) or ElevenLabs with their own key (voices list and a private text-to-speech link).",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const user = await requireActive();
      if (!user) return subscribeMessage();
      await logUsage(userId, "get_voice", null, user.voiceProvider);
      if (!usesElevenlabs(user)) {
        return withSetup(
          text(
            `${fillShared("voice.md", brand, brandCfg.companionPackage)}\n\n` +
              `(The user can switch to ElevenLabs with their own API key at ${baseUrl()}/dashboard. Don't ask them for the key in chat.)`,
          ),
        );
      }
      let voices = "";
      try {
        const list = await listVoices(elevenlabsKeyOf(user)!);
        voices = list
          .slice(0, 60)
          .map((v) => `- ${v.voice_id}: ${v.name}${v.labels ? ` (${Object.values(v.labels).filter(Boolean).join(", ")})` : ""}`)
          .join("\n");
      } catch (e) {
        voices = `(Couldn't list voices: ${e instanceof Error ? e.message : e}. The user may need to check their key in the dashboard.)`;
      }
      const url = signedTtsUrl(userId);
      return withSetup(
        text(
          `This user uses ElevenLabs with their own API key (stored on ${brand}; you never see it). Generate one file per narration ` +
            `line through this private link (valid ${TTS_LINK_TTL / 3600} hours, don't share it or write it into project files):\n${url}\n\n` +
            `POST JSON {"text": "...", "voice_id": "...", "model_id": "${ELEVENLABS_MODEL}" (optional), "output_format": "mp3_44100_128" (optional)}; ` +
            `up to ${MAX_TTS_CHARS} characters per call. The response is the audio file.\n\n` +
            `macOS / Linux:\ncurl -fsS -X POST "<link>" -H "Content-Type: application/json" -d '{"text":"Ship faster.","voice_id":"<id>"}' -o assets/vo/vo_01.mp3\n\n` +
            `Windows:\nInvoke-WebRequest -Method Post "<link>" -ContentType "application/json" -Body (@{ text = "Ship faster."; voice_id = "<id>" } | ConvertTo-Json) -OutFile assets/vo/vo_01.mp3\n\n` +
            `Voices on their account (pick one that fits the brief and say which):\n${voices}\n\n` +
            `Each call uses the user's ElevenLabs credits: generate each line once, check it, and only re-generate lines that are wrong. ` +
            `If ElevenLabs fails (quota, key), fall back to Voicebox: get_guide framewright/voice.md.`,
        ),
      );
    },
  );

  server.registerTool(
    "account_status",
    {
      title: "Account status",
      description: "Show the user's subscription, voice provider and computer-setup state.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const m = await me();
      if (!m) return text("Account not found.", true);
      const a = await getAccess(m.user);
      if (!a.active) return text(`No active subscription. Subscribe at ${baseUrl()}/pricing.`);
      return withSetup(
        text(
          [
            `Access: active (${a.source === "comp" ? "complimentary" : (a.plan?.name ?? "subscription")}). Unlimited videos.`,
            a.periodEnd ? `Period ends: ${a.periodEnd.toISOString().slice(0, 10)}${a.cancelAtPeriodEnd ? " (cancels then)" : ""}` : "",
            `Voice: ${usesElevenlabs(m.user) ? "ElevenLabs (their own key)" : "Voicebox (local)"}`,
            `Setup checklist: ${m.user.setupVersion >= SETUP_VERSION ? `done (v${m.user.setupVersion})` : "not done yet (call get_setup)"}`,
            a.plan && !a.plan.commercialUse ? "Usage rights: personal use only." : "",
          ]
            .filter(Boolean)
            .join("\n"),
        ),
      );
    },
  );

  return server;
}
