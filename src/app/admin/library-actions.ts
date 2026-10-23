"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { del, head } from "@vercel/blob";
import { db } from "@/db";
import { libraryItems } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { deleteItem, importPack, importShelfZip, PACK_CATEGORIES, SHELVES, type ImportResult, type PackCategory, type ShelfKind } from "@/lib/library";
import { blobEnabled } from "@/lib/storage";

export type LibraryFormState = { ok?: string; error?: string } | undefined;

const list = (v: FormDataEntryValue | null) =>
  String(v ?? "")
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

const adminPath = (kind: ShelfKind | "pack") => (kind === "pack" ? "/admin/packs" : "/admin/styles");

function refresh(kind: ShelfKind | "pack") {
  revalidatePath(adminPath(kind));
  if (kind !== "pack") revalidatePath(SHELVES[kind].path);
}

function summary(r: ImportResult, what: string) {
  return (
    `Saved ${what} "${r.item.slug}" (${r.files} file${r.files === 1 ? "" : "s"}${r.item.version > 1 ? `, version ${r.item.version}` : ""}).` +
    (r.item.published ? "" : " It's hidden until you tick Published.") +
    (r.skipped.length ? ` Skipped unsupported files: ${r.skipped.slice(0, 5).join(", ")}${r.skipped.length > 5 ? "…" : ""}.` : "")
  );
}

// Only ZIPs this site uploaded to its own Blob store are fetched (never arbitrary URLs).
async function fromBlob(url: string) {
  if (!blobEnabled()) throw new Error("Vercel Blob isn't connected.");
  const u = new URL(url);
  if (u.protocol !== "https:" || !u.hostname.endsWith(".blob.vercel-storage.com") || !u.pathname.startsWith("/uploads/")) {
    throw new Error("Unexpected upload address.");
  }
  return head(url);
}

// Small ZIPs (or any size when testing locally) come through the form itself.
export async function uploadShelfItem(_: LibraryFormState, form: FormData): Promise<LibraryFormState> {
  await requireAdmin();
  const kind: ShelfKind = "style";
  const label = SHELVES[kind].label.toLowerCase();
  try {
    const opts = { kind, slug: String(form.get("slug") ?? "").trim() || undefined, tags: list(form.get("tags")), publish: form.get("publish") === "on" };
    const blobUrl = String(form.get("blobUrl") ?? "");
    let r: ImportResult;
    if (blobUrl) {
      await fromBlob(blobUrl);
      const res = await fetch(blobUrl);
      if (!res.ok) throw new Error(`Couldn't read the uploaded ZIP (${res.status}).`);
      try {
        r = await importShelfZip({ ...opts, zip: Buffer.from(await res.arrayBuffer()) });
      } finally {
        await del(blobUrl).catch(() => {});
      }
    } else {
      const file = form.get("zip");
      if (!(file instanceof File) || file.size === 0) return { error: "Choose a ZIP file." };
      r = await importShelfZip({ ...opts, zip: Buffer.from(await file.arrayBuffer()) });
    }
    refresh(kind);
    return { ok: summary(r, label) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Upload failed" };
  }
}

export async function uploadPack(_: LibraryFormState, form: FormData): Promise<LibraryFormState> {
  await requireAdmin();
  const category = String(form.get("category") ?? "other");
  if (!(PACK_CATEGORIES as readonly string[]).includes(category)) return { error: "Pick a category." };
  const name = String(form.get("name") ?? "").trim().slice(0, 80);
  if (!name) return { error: "Give the pack a name." };
  try {
    const opts = {
      name,
      slug: String(form.get("slug") ?? "").trim() || name,
      description: String(form.get("description") ?? "").trim().slice(0, 500),
      category: category as PackCategory,
      tags: list(form.get("tags")),
      publish: form.get("publish") === "on",
    };
    const blobUrl = String(form.get("blobUrl") ?? "");
    let r: ImportResult;
    if (blobUrl) {
      const meta = await fromBlob(blobUrl);
      r = await importPack({ ...opts, blob: { url: blobUrl, size: meta.size } });
    } else {
      const file = form.get("zip");
      if (!(file instanceof File) || file.size === 0) return { error: "Choose a ZIP file." };
      r = await importPack({ ...opts, zip: Buffer.from(await file.arrayBuffer()) });
    }
    refresh("pack");
    return { ok: summary(r, "pack") };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Upload failed" };
  }
}

export async function updateLibraryItem(form: FormData) {
  await requireAdmin();
  const id = String(form.get("id"));
  const [item] = await db.select().from(libraryItems).where(eq(libraryItems.id, id));
  if (!item) return;
  const sort = Math.trunc(Number(form.get("sort") ?? 0));
  const category = String(form.get("category") ?? "");
  await db
    .update(libraryItems)
    .set({
      name: String(form.get("name") ?? "").trim().slice(0, 80) || item.name,
      description: String(form.get("description") ?? "").trim().slice(0, 500),
      tags: list(form.get("tags")),
      published: form.get("published") === "on",
      sort: Number.isFinite(sort) ? Math.min(999, Math.max(0, sort)) : 0,
      ...(item.kind === "pack" && (PACK_CATEGORIES as readonly string[]).includes(category) ? { meta: { ...item.meta, category } } : {}),
      updatedAt: new Date(),
    })
    .where(eq(libraryItems.id, id));
  refresh(item.kind);
}

export async function removeLibraryItem(form: FormData) {
  await requireAdmin();
  const id = String(form.get("id"));
  const [item] = await db.select({ kind: libraryItems.kind }).from(libraryItems).where(eq(libraryItems.id, id));
  if (!item) return;
  await deleteItem(id);
  refresh(item.kind);
}
