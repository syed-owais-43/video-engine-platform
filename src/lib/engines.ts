import JSZip from "jszip";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { engineFiles, engineVersions, engines, type Engine } from "@/db/schema";
import { baseUrl } from "./config";
import { classify, normaliseFiles, parseFrontmatter, type IncomingFile } from "./engine-files";
import { sign } from "./crypto";
import { readSharedFile, SHARED_SCRIPTS } from "./shared-tools";

export { classify, filesFromZip, normaliseFiles, parseFrontmatter, type IncomingFile } from "./engine-files";

export async function importEngineVersion(input: {
  files: IncomingFile[];
  version: string;
  notes?: string;
  slug?: string;
  name?: string;
  tags?: string[];
  publish?: boolean;
}) {
  const files = normaliseFiles(input.files);
  const skillMd = files.find((f) => f.path === "SKILL.md")!.data.toString("utf8");
  const fm = parseFrontmatter(skillMd);
  const slug = (input.slug ?? fm.name ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "-");
  if (!slug) throw new Error("Engine slug missing (set `name` in SKILL.md frontmatter)");

  return db.transaction(async (tx) => {
    let [engine] = await tx.select().from(engines).where(eq(engines.slug, slug));
    if (!engine) {
      [engine] = await tx
        .insert(engines)
        .values({
          slug,
          name: input.name ?? titleCase(slug),
          description: fm.description ?? "",
          tags: input.tags ?? [],
        })
        .returning();
    } else if (fm.description) {
      await tx.update(engines).set({ description: fm.description }).where(eq(engines.id, engine.id));
    }
    const existing = await tx
      .select({ id: engineVersions.id })
      .from(engineVersions)
      .where(and(eq(engineVersions.engineId, engine.id), eq(engineVersions.version, input.version)));
    if (existing.length) throw new Error(`Version ${input.version} already exists for ${slug}`);

    const [version] = await tx
      .insert(engineVersions)
      .values({ engineId: engine.id, version: input.version, notes: input.notes ?? "", fileCount: files.length })
      .returning();
    await tx.insert(engineFiles).values(
      files.map((f) => ({
        versionId: version.id,
        path: f.path,
        kind: classify(f.path),
        data: f.data.toString("base64"),
        size: f.data.length,
      })),
    );
    await tx
      .update(engines)
      .set({ currentVersionId: version.id, ...(input.publish ? { published: true } : {}) })
      .where(eq(engines.id, engine.id));
    return { engine, version };
  });
}

function titleCase(slug: string) {
  return slug.replace(/(^|-)(\w)/g, (_, sep, c) => (sep ? " " : "") + c.toUpperCase());
}

export async function listPublishedEngines() {
  const rows = await db
    .select({ engine: engines, version: engineVersions.version })
    .from(engines)
    .innerJoin(engineVersions, eq(engineVersions.id, engines.currentVersionId))
    .where(eq(engines.published, true))
    .orderBy(asc(engines.name));
  return rows.map((r) => ({ ...r.engine, version: r.version }));
}

export async function getPublishedEngine(slug: string) {
  const [row] = await db
    .select({ engine: engines, version: engineVersions })
    .from(engines)
    .innerJoin(engineVersions, eq(engineVersions.id, engines.currentVersionId))
    .where(and(eq(engines.slug, slug), eq(engines.published, true)));
  return row ?? null;
}

// Simple keyword ranking: cheap, deterministic, and good enough while the catalog is small.
export function rankEngines<T extends Pick<Engine, "slug" | "name" | "description" | "tags">>(brief: string, list: T[]) {
  const words = new Set(brief.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
  return list
    .map((e) => {
      const hay = `${e.slug} ${e.name} ${e.description} ${e.tags.join(" ")}`.toLowerCase();
      let score = 0;
      for (const w of words) if (hay.includes(w)) score += 1;
      for (const t of e.tags) if (brief.toLowerCase().includes(t.toLowerCase())) score += 3;
      return { engine: e, score };
    })
    .sort((a, b) => b.score - a.score);
}

export async function readEngineFile(versionId: string, path: string, kind?: "remote" | "local") {
  const [row] = await db
    .select()
    .from(engineFiles)
    .where(and(eq(engineFiles.versionId, versionId), eq(engineFiles.path, path)));
  if (!row || (kind && row.kind !== kind)) return null;
  return Buffer.from(row.data, "base64");
}

export async function listEngineFiles(versionId: string, kinds: ("remote" | "local")[]) {
  return db
    .select({ path: engineFiles.path, kind: engineFiles.kind, size: engineFiles.size })
    .from(engineFiles)
    .where(and(eq(engineFiles.versionId, versionId), inArray(engineFiles.kind, kinds)))
    .orderBy(asc(engineFiles.path));
}

export async function buildBundle(slug: string, versionId: string): Promise<Buffer> {
  const rows = await db
    .select()
    .from(engineFiles)
    .where(and(eq(engineFiles.versionId, versionId), eq(engineFiles.kind, "local")));
  const zip = new JSZip();
  for (const r of rows) zip.file(`${slug}/${r.path}`, Buffer.from(r.data, "base64"));
  for (const [dest, file] of Object.entries(SHARED_SCRIPTS)) zip.file(`${slug}/${dest}`, readSharedFile(file));
  zip.file(
    `${slug}/FRAMEWRIGHT.txt`,
    "Local helper bundle. Instructions (SKILL.md, reference/) are served live through the Framewright MCP server.\n",
  );
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

export const BUNDLE_TTL_SECONDS = 15 * 60;

export function signedBundleUrl(slug: string, versionId: string, userId: string) {
  const exp = Math.floor(Date.now() / 1000) + BUNDLE_TTL_SECONDS;
  const payload = `${slug}:${versionId}:${userId}:${exp}`;
  const q = new URLSearchParams({ v: versionId, u: userId, exp: String(exp), sig: sign(payload) });
  return `${baseUrl()}/api/bundle/${slug}?${q}`;
}
