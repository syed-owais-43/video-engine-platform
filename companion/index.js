#!/usr/bin/env node
// Framewright Companion: a local stdio MCP server for AI apps (like Claude Desktop) that
// can't run commands themselves. It proxies the Framewright engine tools from the website
// and adds file + command tools scoped to one workspace folder.

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { unzipSync } from "fflate";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";
import { openInBrowser, startEditorBridge } from "./editor-bridge.js";

const VERSION = "1.0.0";
const SITE = (process.env.FRAMEWRIGHT_URL ?? "").replace(/\/$/, "");
const API_KEY = process.env.FRAMEWRIGHT_API_KEY ?? "";
const WORKSPACE = resolve(process.env.FRAMEWRIGHT_WORKSPACE ?? join(homedir(), "Framewright"));
const ENGINES_DIR = resolve(process.env.FRAMEWRIGHT_ENGINES_DIR ?? join(homedir(), ".framewright", "engines"));
const MAX_OUTPUT = 30_000;

// `framewright-companion --editor [--project <folder>] [--port 7717] [--site <url>]` runs only the
// editor bridge (for Claude Code / Cursor users), serving the given folder or the current one.
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 ? argv[i + 1] : undefined;
};
if (argv.includes("--editor")) {
  const site = (flag("site") ?? SITE).replace(/\/$/, "");
  const bridge = await startEditorBridge({ root: resolve(flag("project") ?? process.cwd()), site, port: Number(flag("port") ?? 7717) });
  console.log(`Framewright editor bridge for ${bridge.root}\n\nOpen this link to edit (keep this window open while editing):\n${bridge.pairingUrl}\n`);
  if (!argv.includes("--no-open")) openInBrowser(bridge.pairingUrl);
  await new Promise(() => {});
}

mkdirSync(WORKSPACE, { recursive: true });
mkdirSync(ENGINES_DIR, { recursive: true });

const text = (t, isError = false) => ({ content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) });

// ---------- Remote Framewright tools ----------

let remote = null;
async function remoteClient() {
  if (remote) return remote;
  if (!SITE) throw new Error("FRAMEWRIGHT_URL is not set in the companion's env.");
  if (!API_KEY) throw new Error(`FRAMEWRIGHT_API_KEY is not set. Create one at ${SITE}/dashboard and add it to the companion's env.`);
  const client = new Client({ name: "framewright-companion", version: VERSION });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${SITE}/api/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${API_KEY}` } },
    }),
  );
  remote = client;
  return client;
}

async function callRemote(name, args = {}) {
  try {
    const client = await remoteClient();
    return await client.callTool({ name, arguments: args });
  } catch (err) {
    remote = null;
    return text(`Could not reach Framewright (${SITE}): ${err.message}`, true);
  }
}

const remoteText = (res) => res.content?.map((c) => c.text ?? "").join("\n") ?? "";

// ---------- Path safety ----------

function inside(root, p) {
  const rel = relative(root, p);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

// Relative paths resolve against the workspace. Reads may also target installed engines.
function resolvePath(p, { write = false } = {}) {
  const full = resolve(isAbsolute(p) ? p : join(WORKSPACE, p));
  if (inside(WORKSPACE, full)) return full;
  if (!write && inside(ENGINES_DIR, full)) return full;
  throw new Error(`Path is outside the allowed folders. Workspace: ${WORKSPACE}${write ? "" : `; engines (read-only): ${ENGINES_DIR}`}`);
}

// ---------- Commands ----------

const jobs = new Map();

function tail(s) {
  return s.length > MAX_OUTPUT ? `…[${s.length - MAX_OUTPUT} chars truncated]…\n${s.slice(-MAX_OUTPUT)}` : s;
}

function startProcess(command, cwd) {
  // The API key stays in this process; commands the AI runs never see it.
  const env = { ...process.env };
  delete env.FRAMEWRIGHT_API_KEY;
  const child = spawn(command, {
    cwd,
    shell: process.platform === "win32" ? "powershell.exe" : "/bin/bash",
    env,
    windowsHide: true,
  });
  const job = { id: randomUUID().slice(0, 8), command, cwd, output: "", exitCode: null, done: false, startedAt: Date.now(), child };
  const append = (d) => {
    job.output += d.toString();
    if (job.output.length > MAX_OUTPUT * 4) job.output = job.output.slice(-MAX_OUTPUT * 2);
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  job.finished = new Promise((res) => {
    child.on("close", (code) => {
      job.exitCode = code;
      job.done = true;
      res();
    });
    child.on("error", (e) => {
      append(`\n${e.message}`);
      job.exitCode = -1;
      job.done = true;
      res();
    });
  });
  jobs.set(job.id, job);
  return job;
}

function jobReport(job) {
  const secs = ((Date.now() - job.startedAt) / 1000).toFixed(1);
  const state = job.done ? `exit code ${job.exitCode}` : `still running (${secs}s)`;
  return `[job ${job.id}] ${state}\n$ ${job.command}\n${tail(job.output) || "(no output)"}`;
}

// ---------- Server ----------

const server = new McpServer(
  { name: "framewright-companion", version: VERSION },
  {
    instructions: `Framewright Companion. Use start_project to begin a video, get_guide for reference/*.md files, and install_engine to install an engine's local scripts.
Work inside the workspace folder ${WORKSPACE}: create one subfolder per video project. Use write_file/read_file/list_files for files and run_command for terminal commands (PowerShell on Windows, bash elsewhere).
For long renders pass background=true and poll with job_status. Installed engines live in ${ENGINES_DIR} (read-only).`,
  },
);

server.registerTool(
  "list_engines",
  { title: "List video engines", description: "List Framewright video engines.", inputSchema: {}, annotations: { readOnlyHint: true } },
  async () => callRemote("list_engines"),
);

server.registerTool(
  "start_project",
  {
    title: "Start a video project",
    description: "Start a new video: picks the best engine for the brief and returns its instructions. Counts as one project on the user's plan.",
    inputSchema: {
      brief: z.string().min(3).max(4000).describe("The user's idea, format, length, style and references, summarised"),
      engine: z.string().optional().describe("Engine slug to force; omit to auto-select"),
    },
  },
  async (args) => {
    const res = await callRemote("start_project", args);
    if (res.isError) return res;
    return text(
      `${remoteText(res)}\n\n---\nCompanion notes: install the engine with install_engine (not get_scripts). ` +
        `Create the project folder inside ${WORKSPACE}.`,
    );
  },
);

server.registerTool(
  "get_guide",
  {
    title: "Read an engine guide",
    description: "Read one of the engine's reference guides, e.g. reference/visual-design.md.",
    inputSchema: { engine: z.string(), path: z.string() },
    annotations: { readOnlyHint: true },
  },
  async (args) => callRemote("get_guide", args),
);

server.registerTool(
  "account_status",
  { title: "Account status", description: "Show the user's Framewright plan and usage.", inputSchema: {}, annotations: { readOnlyHint: true } },
  async () => callRemote("account_status"),
);

server.registerTool(
  "install_engine",
  {
    title: "Install engine scripts",
    description: "Download and unpack an engine's local helper bundle (scripts, templates). Returns the engine folder to use as <skill>.",
    inputSchema: { engine: z.string().describe("Engine slug") },
  },
  async ({ engine }) => {
    const res = await callRemote("get_scripts", { engine });
    if (res.isError) return res;
    const body = remoteText(res);
    const url = body.match(/https?:\/\/\S+\/api\/bundle\/\S+?(?=["\s]|$)/)?.[0];
    const version = body.match(/ v([0-9A-Za-z.+-]+)\./)?.[1] ?? "latest";
    if (!url) return text("Framewright did not return a download link.", true);

    const target = join(ENGINES_DIR, engine, version);
    const root = join(target, engine);
    // Re-download when the bundle predates a shared tool (e.g. the exporter) so older installs pick it up.
    if (existsSync(join(root, "FRAMEWRIGHT.txt")) && existsSync(join(root, "framewright", "fw-compose.mjs"))) {
      return text(`Already installed. Engine folder (<skill>): ${root}`);
    }

    const dl = await fetch(url);
    if (!dl.ok) return text(`Download failed: ${dl.status} ${await dl.text()}`, true);
    const files = unzipSync(new Uint8Array(await dl.arrayBuffer()));
    for (const [name, data] of Object.entries(files)) {
      if (name.endsWith("/")) continue;
      const out = resolve(target, name);
      if (!inside(target, out)) continue; // never let a ZIP entry escape the target folder
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, data);
    }
    return text(`Installed ${engine} v${version}. Engine folder (<skill>): ${root}`);
  },
);

server.registerTool(
  "list_files",
  {
    title: "List files",
    description: "List a folder in the workspace (or an installed engine). Relative paths are inside the workspace.",
    inputSchema: { path: z.string().default(".").describe("Folder path"), depth: z.number().int().min(1).max(4).default(1) },
    annotations: { readOnlyHint: true },
  },
  async ({ path, depth }) => {
    try {
      const root = resolvePath(path);
      const lines = [];
      const walk = (dir, level) => {
        for (const name of readdirSync(dir).sort()) {
          if (lines.length > 500) return;
          const full = join(dir, name);
          const isDir = statSync(full).isDirectory();
          lines.push(`${"  ".repeat(level)}${name}${isDir ? sep : ""}`);
          if (isDir && level + 1 < depth && name !== "node_modules") walk(full, level + 1);
        }
      };
      walk(root, 0);
      return text(`${root}\n${lines.join("\n") || "(empty)"}`);
    } catch (e) {
      return text(e.message, true);
    }
  },
);

server.registerTool(
  "read_file",
  {
    title: "Read file",
    description: "Read a text file from the workspace or an installed engine.",
    inputSchema: { path: z.string() },
    annotations: { readOnlyHint: true },
  },
  async ({ path }) => {
    try {
      const full = resolvePath(path);
      const size = statSync(full).size;
      if (size > 2_000_000) return text(`File is ${size} bytes; too large to read as text.`, true);
      return text(readFileSync(full, "utf8"));
    } catch (e) {
      return text(e.message, true);
    }
  },
);

server.registerTool(
  "write_file",
  {
    title: "Write file",
    description: "Create or overwrite a text file inside the workspace. Parent folders are created.",
    inputSchema: { path: z.string(), content: z.string() },
  },
  async ({ path, content }) => {
    try {
      const full = resolvePath(path, { write: true });
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content, "utf8");
      return text(`Wrote ${Buffer.byteLength(content)} bytes to ${full}`);
    } catch (e) {
      return text(e.message, true);
    }
  },
);

server.registerTool(
  "run_command",
  {
    title: "Run command",
    description:
      "Run a terminal command (PowerShell on Windows, bash elsewhere) with its working directory inside the workspace. " +
      "Use background=true for renders or installs that may take more than a minute, then poll job_status.",
    inputSchema: {
      command: z.string().min(1),
      cwd: z.string().default(".").describe("Working directory, relative to the workspace"),
      background: z.boolean().default(false),
      timeout_seconds: z.number().int().min(1).max(600).default(120),
    },
  },
  async ({ command, cwd, background, timeout_seconds }) => {
    let dir;
    try {
      dir = resolvePath(cwd, { write: true });
      mkdirSync(dir, { recursive: true });
    } catch (e) {
      return text(e.message, true);
    }
    const job = startProcess(command, dir);
    if (background) return text(`Started job ${job.id} in ${dir}. Poll with job_status.`);
    const timedOut = await Promise.race([job.finished.then(() => false), new Promise((r) => setTimeout(() => r(true), timeout_seconds * 1000))]);
    if (timedOut) return text(`${jobReport(job)}\n\nStill running after ${timeout_seconds}s; it continues as job ${job.id}. Poll with job_status.`);
    return text(jobReport(job), job.exitCode !== 0);
  },
);

server.registerTool(
  "job_status",
  {
    title: "Job status",
    description: "Check a background command's progress and output. Pass stop=true to terminate it.",
    inputSchema: { id: z.string(), stop: z.boolean().default(false) },
  },
  async ({ id, stop }) => {
    const job = jobs.get(id);
    if (!job) return text(`No job ${id}. Known: ${[...jobs.keys()].join(", ") || "none"}`, true);
    if (stop && !job.done) job.child.kill();
    return text(jobReport(job));
  },
);

let editorBridge = null;
server.registerTool(
  "open_editor",
  {
    title: "Open the timeline editor",
    description:
      "Open the Framewright web timeline editor for projects in the workspace (a project needs framewright.timeline.json; " +
      "see get_guide framewright/editor.md). Opens the user's browser and returns the link.",
    inputSchema: {},
  },
  async () => {
    try {
      editorBridge ??= await startEditorBridge({ root: WORKSPACE, site: SITE });
      openInBrowser(editorBridge.pairingUrl);
      return text(`Opened the editor in the user's browser. If it didn't open, give them this link (it only works on this computer):\n${editorBridge.pairingUrl}`);
    } catch (e) {
      return text(`Couldn't start the editor: ${e.message}`, true);
    }
  },
);

await server.connect(new StdioServerTransport());
console.error(`Framewright Companion ${VERSION} · site ${SITE} · workspace ${WORKSPACE}`);
