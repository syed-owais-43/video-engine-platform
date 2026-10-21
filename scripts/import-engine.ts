// Usage: npm run engine:import -- <folder-or-zip> --version 3.5.2 [--tags a,b] [--name "Display"] [--publish]
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { filesFromZip, importEngineVersion, type IncomingFile } from "../src/lib/engines";

function walk(dir: string, root = dir): IncomingFile[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full, root);
    return [{ path: relative(root, full).replace(/\\/g, "/"), data: readFileSync(full) }];
  });
}

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const src = process.argv[2];
  const version = arg("version");
  if (!src || !version) throw new Error("Usage: engine:import <folder-or-zip> --version X [--tags a,b] [--name N] [--publish]");
  const files = src.toLowerCase().endsWith(".zip") ? await filesFromZip(readFileSync(src)) : walk(src);
  const { engine, version: v } = await importEngineVersion({
    files,
    version,
    name: arg("name"),
    tags: arg("tags")?.split(",").map((t) => t.trim()).filter(Boolean),
    publish: process.argv.includes("--publish"),
  });
  console.log(`Imported ${engine.slug} v${v.version} (${v.fileCount} files)`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
