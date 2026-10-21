import JSZip from "jszip";

export type IncomingFile = { path: string; data: Buffer };

const IGNORED = [/(^|\/)__pycache__\//, /(^|\/)\.env(\.|$)/, /(^|\/)\.DS_Store$/, /(^|\/)node_modules\//, /\.pyc$/];

// SKILL.md and reference docs are the valuable instructions: served live only.
// Everything else (scripts, templates, licence) is safe to install on the user's machine.
export function classify(path: string): "remote" | "local" {
  if (path === "SKILL.md" || path.startsWith("reference/")) return "remote";
  return "local";
}

export function parseFrontmatter(md: string): Record<string, string> {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].replace(/^["']|["']$/g, "").trim();
  }
  return out;
}

// Accepts a flat file list (from a ZIP or a folder). The engine root is wherever the
// shallowest SKILL.md lives, so both standalone-skill and plugin ZIP layouts work.
export function normaliseFiles(files: IncomingFile[]): IncomingFile[] {
  const clean = files
    .map((f) => ({ ...f, path: f.path.replace(/\\/g, "/").replace(/^\.\//, "") }))
    .filter((f) => !f.path.endsWith("/") && !IGNORED.some((re) => re.test(f.path)));
  const skill = clean
    .filter((f) => f.path === "SKILL.md" || f.path.endsWith("/SKILL.md"))
    .sort((a, b) => a.path.split("/").length - b.path.split("/").length)[0];
  if (!skill) throw new Error("No SKILL.md found in upload");
  const root = skill.path.slice(0, -"SKILL.md".length);
  return clean
    .filter((f) => f.path.startsWith(root))
    .map((f) => ({ ...f, path: f.path.slice(root.length) }))
    .filter((f) => !f.path.includes(".."));
}

export async function filesFromZip(buf: Buffer | ArrayBuffer): Promise<IncomingFile[]> {
  const zip = await JSZip.loadAsync(buf);
  const out: IncomingFile[] = [];
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    out.push({ path: entry.name, data: Buffer.from(await entry.async("uint8array")) });
  }
  return out;
}
