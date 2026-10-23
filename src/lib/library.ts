import "server-only";
import JSZip from "jszip";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { libraryFiles, libraryItems, type LibraryItem } from "@/db/schema";
import { baseUrl } from "./config";
import { sign, verifySignature } from "./crypto";
import { filesFromZip, type IncomingFile } from "./engine-files";
import { contentTypeFor, knownType, readStored, removeStored, storeFile } from "./storage";

// The style library and resource packs.
//
// Style (e.g. editorial-explainer/): style.json (palette, fonts, sizes, easing, timings, SFX names),
// recipe.md (the rules in plain words), frames.jpg (contact sheet), optional breakdown.md, prompts.md
// and other notes, optional preview.mp4 / cover.jpg for the gallery, and fonts/ and sfx/ with the
// files the style uses.
// Resource pack: a ZIP of SFX, fonts, textures or Lottie files that the Companion installs once into
// ~/.framewright/assets.
//
// Claude learns a look from text and a few still frames, so MCP returns style.json and every Markdown
// note as text and the contact sheet as an image. Videos and covers are mainly for people browsing.

export type LibraryKind = LibraryItem["kind"];
export type ShelfKind = Exclude<LibraryKind, "pack">;

const IMAGE = ["jpg", "jpeg", "png", "webp"];
const VIDEO = ["mp4", "webm", "mov", "m4v"];
const variants = (base: string, exts: string[]) => exts.map((e) => `${base}.${e}`);

export const SHELVES = {
  style: {
    label: "Style",
    plural: "Styles",
    path: "/styles",
    meta: "style.json",
    notes: "recipe.md",
    required: ["style.json", "recipe.md"],
    frames: [variants("frames", IMAGE)],
    video: variants("preview", VIDEO),
    cover: variants("cover", IMAGE),
    // Shown in the public gallery once the item is published. The contact sheet is not: it can hold
    // frames from other creators' videos, so only subscribers (and their AI) get it.
    public: [...variants("preview", VIDEO), ...variants("cover", IMAGE)],
  },
} as const;

export const PACK_CATEGORIES = ["sfx", "fonts", "textures", "lottie", "music", "other"] as const;
export type PackCategory = (typeof PACK_CATEGORIES)[number];
export const PACK_LABELS: Record<PackCategory, string> = {
  sfx: "Sound effects",
  fonts: "Fonts",
  textures: "Textures & overlays",
  lottie: "Lottie animations",
  music: "Music",
  other: "Other",
};

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

const titleCase = (slug: string) => slug.replace(/(^|-)(\w)/g, (_, sep, c) => (sep ? " " : "") + c.toUpperCase());

const JUNK = [/(^|\/)__MACOSX\//, /(^|\/)\.[^/]*$/, /(^|\/)Thumbs\.db$/i, /(^|\/)desktop\.ini$/i];

// Strips a single top folder (clean-premium-saas/…) and drops OS junk. Returns that folder name too.
function unwrap(files: IncomingFile[]): { files: IncomingFile[]; folder: string | null } {
  const clean = files
    .map((f) => ({ ...f, path: f.path.replace(/\\/g, "/").replace(/^\.?\//, "") }))
    .filter((f) => f.path && !f.path.endsWith("/") && !JUNK.some((re) => re.test(f.path)) && !f.path.split("/").includes(".."));
  const tops = new Set(clean.map((f) => (f.path.includes("/") ? f.path.split("/")[0] : "")));
  if (tops.size === 1 && !tops.has("")) {
    const folder = [...tops][0];
    return { files: clean.map((f) => ({ ...f, path: f.path.slice(folder.length + 1) })), folder };
  }
  return { files: clean, folder: null };
}

// First paragraph of a Markdown file that isn't a heading, for a default description.
function firstParagraph(md: string) {
  const para = md
    .replace(/^---[\s\S]*?---/, "")
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .find((p) => p && !p.startsWith("#") && !p.startsWith("|") && !p.startsWith("```"));
  return (para ?? "").replace(/\s+/g, " ").replace(/[*_`]/g, "").slice(0, 280);
}

const pick = (paths: string[], names: readonly string[]) => names.find((n) => paths.includes(n)) ?? null;

export type ImportResult = { item: LibraryItem; files: number; skipped: string[] };

// Imports (or replaces) a style from its ZIP.
export async function importShelfZip(input: {
  kind: ShelfKind;
  zip: Buffer;
  slug?: string;
  tags?: string[];
  publish?: boolean;
}): Promise<ImportResult> {
  const shelf = SHELVES[input.kind];
  const { files: raw, folder } = unwrap(await filesFromZip(input.zip));
  const skipped = raw.filter((f) => !knownType(f.path)).map((f) => f.path);
  const files = raw.filter((f) => knownType(f.path));
  const paths = files.map((f) => f.path);
  for (const r of shelf.required) if (!paths.includes(r)) throw new Error(`The ZIP has no ${r}. Expected files: ${shelf.required.join(", ")}.`);
  if (!shelf.frames.some((names) => pick(paths, names))) throw new Error(`The ZIP has no ${shelf.frames[0][0]} contact sheet.`);

  let meta: Record<string, unknown> = {};
  if (shelf.meta) {
    try {
      meta = JSON.parse(files.find((f) => f.path === shelf.meta)!.data.toString("utf8"));
    } catch (e) {
      throw new Error(`${shelf.meta} isn't valid JSON: ${e instanceof Error ? e.message : e}`);
    }
    if (!meta || typeof meta !== "object" || Array.isArray(meta)) throw new Error(`${shelf.meta} must be a JSON object.`);
  }
  const notes = files.find((f) => f.path === shelf.notes)!.data.toString("utf8");
  const str = (k: string) => (typeof meta[k] === "string" ? (meta[k] as string) : "");
  const slug = slugify(input.slug || str("id") || str("slug") || folder || "");
  if (!slug) throw new Error("Name the folder inside the ZIP (e.g. clean-premium-saas) or enter a slug.");
  // Tags typed in the admin panel win; otherwise use the ones in style.json.
  const metaTags = Array.isArray(meta.tags) ? meta.tags.filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter(Boolean).slice(0, 20) : [];
  const tags = input.tags?.length ? input.tags : metaTags;

  const stored: { path: string; size: number; contentType: string; url: string | null; data: string | null }[] = [];
  for (const f of files) {
    const contentType = contentTypeFor(f.path);
    stored.push({ path: f.path, size: f.data.length, contentType, ...(await storeFile(`${input.kind}/${slug}/${f.path}`, f.data, contentType)) });
  }

  const values = {
    name: str("name") || titleCase(slug),
    description: str("description") || firstParagraph(notes),
    meta,
    notes,
    updatedAt: new Date(),
  };
  const { item, old } = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(libraryItems).where(and(eq(libraryItems.kind, input.kind), eq(libraryItems.slug, slug)));
    const [item] = existing
      ? await tx
          .update(libraryItems)
          .set({
            ...values,
            version: existing.version + 1,
            ...(tags.length ? { tags } : {}),
            ...(input.publish ? { published: true } : {}),
          })
          .where(eq(libraryItems.id, existing.id))
          .returning()
      : await tx
          .insert(libraryItems)
          .values({ kind: input.kind, slug, ...values, tags, published: Boolean(input.publish) })
          .returning();
    const old = await tx.select({ url: libraryFiles.url }).from(libraryFiles).where(eq(libraryFiles.itemId, item.id));
    await tx.delete(libraryFiles).where(eq(libraryFiles.itemId, item.id));
    await tx.insert(libraryFiles).values(stored.map((s) => ({ ...s, itemId: item.id })));
    return { item, old };
  });
  await removeStored(old.map((o) => o.url));
  return { item, files: stored.length, skipped };
}

// Adds or replaces a resource pack. The ZIP is kept whole: the Companion unpacks it on the user's PC.
// With Vercel Blob the browser uploads it straight to Blob and passes its URL here.
export async function importPack(input: {
  slug: string;
  name: string;
  description: string;
  category: PackCategory;
  tags: string[];
  publish: boolean;
  zip?: Buffer;
  blob?: { url: string; size: number };
}): Promise<ImportResult> {
  const slug = slugify(input.slug || input.name);
  if (!slug) throw new Error("Give the pack a name.");
  let file;
  let count: number | null = null;
  if (input.zip) {
    try {
      const zip = await JSZip.loadAsync(input.zip);
      count = Object.values(zip.files).filter((f) => !f.dir && !JUNK.some((re) => re.test(f.name))).length;
    } catch {
      throw new Error("That file isn't a valid ZIP.");
    }
    if (!count) throw new Error("The ZIP is empty.");
    file = { size: input.zip.length, ...(await storeFile(`pack/${slug}.zip`, input.zip, "application/zip")) };
  } else if (input.blob) {
    file = { size: input.blob.size, url: input.blob.url, data: null };
  } else throw new Error("Choose a ZIP file.");

  const meta = { category: input.category, ...(count !== null ? { files: count } : {}) };
  const { item, old } = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(libraryItems).where(and(eq(libraryItems.kind, "pack"), eq(libraryItems.slug, slug)));
    const values = { name: input.name || titleCase(slug), description: input.description, meta, tags: input.tags, updatedAt: new Date() };
    const [item] = existing
      ? await tx
          .update(libraryItems)
          .set({ ...values, version: existing.version + 1, ...(input.publish ? { published: true } : {}) })
          .where(eq(libraryItems.id, existing.id))
          .returning()
      : await tx.insert(libraryItems).values({ kind: "pack", slug, ...values, published: input.publish }).returning();
    const old = await tx.select({ url: libraryFiles.url }).from(libraryFiles).where(eq(libraryFiles.itemId, item.id));
    await tx.delete(libraryFiles).where(eq(libraryFiles.itemId, item.id));
    await tx.insert(libraryFiles).values({ itemId: item.id, path: "pack.zip", contentType: "application/zip", ...file });
    return { item, old };
  });
  await removeStored(old.map((o) => o.url).filter((u) => u !== file.url));
  return { item, files: count ?? 1, skipped: [] };
}

export async function deleteItem(id: string) {
  const old = await db.select({ url: libraryFiles.url }).from(libraryFiles).where(eq(libraryFiles.itemId, id));
  await db.delete(libraryItems).where(eq(libraryItems.id, id));
  await removeStored(old.map((o) => o.url));
}

// ---------- reading ----------

// File rows without their (possibly large) inline data.
const fileColumns = {
  id: libraryFiles.id,
  itemId: libraryFiles.itemId,
  path: libraryFiles.path,
  size: libraryFiles.size,
  contentType: libraryFiles.contentType,
};
export type FileRef = { id: string; itemId: string; path: string; size: number; contentType: string };

export async function listItems(kind: LibraryKind, opts: { published?: boolean } = {}) {
  return db
    .select()
    .from(libraryItems)
    .where(opts.published ? and(eq(libraryItems.kind, kind), eq(libraryItems.published, true)) : eq(libraryItems.kind, kind))
    .orderBy(asc(libraryItems.sort), asc(libraryItems.name));
}

export async function getItem(kind: LibraryKind, slug: string, opts: { published?: boolean } = { published: true }) {
  const [item] = await db
    .select()
    .from(libraryItems)
    .where(and(eq(libraryItems.kind, kind), eq(libraryItems.slug, slugify(slug)), ...(opts.published ? [eq(libraryItems.published, true)] : [])));
  return item ?? null;
}

export async function filesOf(itemIds: string[]): Promise<FileRef[]> {
  if (!itemIds.length) return [];
  return db.select(fileColumns).from(libraryFiles).where(inArray(libraryFiles.itemId, itemIds)).orderBy(asc(libraryFiles.path));
}

export async function readFile(fileId: string) {
  const [row] = await db
    .select({ file: libraryFiles, item: libraryItems })
    .from(libraryFiles)
    .innerJoin(libraryItems, eq(libraryItems.id, libraryFiles.itemId))
    .where(eq(libraryFiles.id, fileId));
  return row ?? null;
}

export async function fileBytes(fileId: string) {
  const [row] = await db.select({ url: libraryFiles.url, data: libraryFiles.data }).from(libraryFiles).where(eq(libraryFiles.id, fileId));
  return row ? readStored(row) : null;
}

// Gallery files (previews, contact sheets) of published styles and references are public.
export function isPublicFile(item: Pick<LibraryItem, "kind" | "published">, path: string) {
  if (!item.published || item.kind === "pack") return false;
  return (SHELVES[item.kind].public as readonly string[]).includes(path);
}

export const findPath = (files: FileRef[], names: readonly string[]) => names.map((n) => files.find((f) => f.path === n)).find(Boolean) ?? null;

// ---------- links ----------

export const FILE_LINK_TTL = 60 * 60;

export const galleryFileUrl = (fileId: string) => `/api/files/${fileId}`;

// A download link for one subscriber, used by their AI (curl / the Companion). It's checked again
// on use, so it stops working when the subscription ends.
export function signedFileUrl(fileId: string, userId: string, ttl = FILE_LINK_TTL) {
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const q = new URLSearchParams({ u: userId, exp: String(exp), sig: sign(`file:${fileId}:${userId}:${exp}`) });
  return `${baseUrl()}/api/files/${fileId}?${q}`;
}

export function verifyFileLink(fileId: string, q: URLSearchParams): string | null {
  const userId = q.get("u") ?? "";
  const exp = Number(q.get("exp"));
  const sig = q.get("sig") ?? "";
  if (!userId || !exp || exp < Date.now() / 1000) return null;
  return verifySignature(`file:${fileId}:${userId}:${exp}`, sig) ? userId : null;
}

// ---------- style.json helpers (gallery display only) ----------

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function collect(v: unknown, test: (s: string) => boolean, out: string[], depth = 0) {
  if (out.length >= 10 || depth > 3) return;
  if (typeof v === "string") {
    if (test(v) && !out.includes(v)) out.push(v);
  } else if (Array.isArray(v)) for (const x of v) collect(x, test, out, depth + 1);
  else if (v && typeof v === "object") for (const x of Object.values(v)) collect(x, test, out, depth + 1);
}

export function paletteOf(meta: Record<string, unknown>): string[] {
  const out: string[] = [];
  collect(meta.palette ?? meta.colors ?? meta.colours, (s) => HEX.test(s.trim()), out);
  return out.slice(0, 8);
}

export function fontsOf(meta: Record<string, unknown>): string[] {
  const fonts = meta.fonts ?? meta.typography;
  const out: string[] = [];
  if (Array.isArray(fonts)) for (const f of fonts) collect(typeof f === "object" && f ? ((f as Record<string, unknown>).family ?? (f as Record<string, unknown>).name) : f, (s) => !HEX.test(s) && s.length < 40, out);
  else if (fonts && typeof fonts === "object") {
    for (const f of Object.values(fonts)) collect(typeof f === "object" && f ? ((f as Record<string, unknown>).family ?? (f as Record<string, unknown>).name) : f, (s) => !HEX.test(s) && s.length < 40, out);
  }
  return out.slice(0, 4);
}
