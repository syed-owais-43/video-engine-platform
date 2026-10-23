import { blobEnabled } from "@/lib/storage";
import { filesOf, findPath, galleryFileUrl, listItems, PACK_CATEGORIES, PACK_LABELS, paletteOf, SHELVES, type LibraryKind } from "@/lib/library";
import { removeLibraryItem, updateLibraryItem } from "./library-actions";
import { DeleteItemButton, PackUploadForm, StyleUploadForm } from "./library-forms";

const mb = (n: number) => `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)} MB`;

const INTRO: Record<LibraryKind, string> = {
  style:
    "Looks your customers can pick (palette, type, motion, sound). Their AI loads style.json, recipe.md, the other notes (breakdown.md, prompts.md) and the contact sheet through MCP and builds in exactly that look. Published styles appear in the public gallery with their preview video or cover image; the contact sheet stays subscribers-only because it can contain other creators' frames.",
  pack: "Sound effects, fonts, textures and Lottie files. Customers' Companion downloads each pack once into ~/.framewright/assets and their AI uses it in every video.",
};

// Admin page for one library shelf: upload, then edit or delete each item.
export async function LibraryAdmin({ kind }: { kind: LibraryKind }) {
  const items = await listItems(kind);
  const files = await filesOf(items.map((i) => i.id));
  const blob = blobEnabled();
  const maxMb = process.env.VERCEL ? 4 : 20;
  return (
    <div className="space-y-5">
      <p className="max-w-3xl text-sm text-muted">{INTRO[kind]}</p>
      {!blob && (
        <p className="rounded-xl border border-warn/40 px-4 py-3 text-sm text-warn">
          Files are stored in the database because no Vercel Blob store is connected, so uploads are limited to {maxMb} MB. For
          videos and packs, connect one: Vercel → your project → Storage → Create → Blob → Connect, then redeploy.
        </p>
      )}
      <section className="card">
        <p className="label">Upload</p>
        {kind === "pack" ? (
          <PackUploadForm blob={blob} maxMb={maxMb} categories={PACK_CATEGORIES.map((c) => ({ value: c, label: PACK_LABELS[c] }))} />
        ) : (
          <StyleUploadForm blob={blob} maxMb={maxMb} />
        )}
      </section>

      {items.length === 0 && <p className="text-sm text-faint">Nothing uploaded yet.</p>}

      {items.map((item) => {
        const mine = files.filter((f) => f.itemId === item.id);
        const thumb = kind === "pack" ? null : (findPath(mine, SHELVES.style.cover) ?? findPath(mine, SHELVES.style.frames[0]));
        const palette = kind === "style" ? paletteOf(item.meta) : [];
        const size = mine.reduce((n, f) => n + f.size, 0);
        return (
          <section key={item.id} className="card">
            <div className="flex flex-wrap items-start gap-5">
              {thumb && <img src={galleryFileUrl(thumb.id)} alt="" className="h-24 w-40 rounded-lg border border-line object-cover object-top" />}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="display text-3xl">{item.name}</h2>
                  <span className={`pill ${item.published ? "border-ok/40 text-ok" : "border-line text-muted"}`}>{item.published ? "published" : "hidden"}</span>
                </div>
                <p className="font-mono text-xs text-faint">
                  {item.slug} · v{item.version} · {mine.length} file{mine.length === 1 ? "" : "s"} · {mb(size)}
                  {kind === "pack" && typeof item.meta.files === "number" ? ` · ${item.meta.files} files inside` : ""}
                </p>
                {palette.length > 0 && (
                  <div className="mt-2 flex gap-1.5">
                    {palette.map((c) => (
                      <span key={c} title={c} className="h-5 w-5 rounded-full border border-line" style={{ background: c }} />
                    ))}
                  </div>
                )}
              </div>
            </div>
            <form action={updateLibraryItem} className="mt-5 grid gap-4 md:grid-cols-2">
              <input type="hidden" name="id" value={item.id} />
              <div>
                <label className="label">Name</label>
                <input name="name" defaultValue={item.name} className="input" />
              </div>
              <div className="grid grid-cols-[1fr_5rem] gap-3">
                <div>
                  <label className="label">Tags</label>
                  <input name="tags" defaultValue={item.tags.join(", ")} className="input" />
                </div>
                <div>
                  <label className="label">Sort</label>
                  <input name="sort" type="number" defaultValue={item.sort} className="input" />
                </div>
              </div>
              <div className="md:col-span-2">
                <label className="label">Description</label>
                <textarea name="description" rows={2} defaultValue={item.description} className="input" />
              </div>
              {kind === "pack" && (
                <div>
                  <label className="label">Category</label>
                  <select name="category" defaultValue={String(item.meta.category ?? "other")} className="input">
                    {PACK_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {PACK_LABELS[c]}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <label className="flex items-center gap-2 text-sm text-muted">
                <input type="checkbox" name="published" defaultChecked={item.published} className="accent-[var(--color-ember)]" /> Published
              </label>
              <div className="flex items-center justify-end gap-4 md:col-span-2">
                <button className="btn-ghost">Save details</button>
              </div>
            </form>
            <div className="mt-3 flex justify-end">
              <DeleteItemButton id={item.id} name={item.name} action={removeLibraryItem} />
            </div>
            {kind !== "pack" && (
              <details className="mt-3 text-xs text-muted">
                <summary className="cursor-pointer">Files</summary>
                <ul className="mt-2 grid gap-1 font-mono sm:grid-cols-2">
                  {mine.map((f) => (
                    <li key={f.id} className="flex justify-between gap-3">
                      <a href={galleryFileUrl(f.id)} className="truncate hover:text-paper" target="_blank" rel="noreferrer">
                        {f.path}
                      </a>
                      <span className="text-faint">{mb(f.size)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        );
      })}
    </div>
  );
}
