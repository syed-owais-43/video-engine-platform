"use client";

import { useActionState, useState } from "react";
import { upload } from "@vercel/blob/client";
import { uploadPack, uploadShelfItem, type LibraryFormState } from "./library-actions";

function Status({ state }: { state: LibraryFormState }) {
  if (state?.error) return <p className="text-sm text-bad">{state.error}</p>;
  if (state?.ok) return <p className="text-sm text-ok">{state.ok}</p>;
  return null;
}

// With Vercel Blob connected, the ZIP goes from the browser straight to Blob (no size limit worth
// worrying about) and only its URL is sent to the server. Without it, the ZIP is posted with the form.
function useZipUpload(action: (s: LibraryFormState, f: FormData) => Promise<LibraryFormState>, blob: boolean) {
  const [progress, setProgress] = useState<number | null>(null);
  const [state, run, pending] = useActionState<LibraryFormState, FormData>(async (prev, form) => {
    const file = form.get("zip");
    if (blob && file instanceof File && file.size > 0) {
      try {
        setProgress(0);
        const safe = file.name.replace(/[^\w.-]+/g, "-");
        const r = await upload(`uploads/${safe}`, file, {
          access: "public",
          handleUploadUrl: "/api/admin/upload",
          multipart: file.size > 20 * 1024 * 1024,
          onUploadProgress: (p) => setProgress(p.percentage),
        });
        form.delete("zip");
        form.set("blobUrl", r.url);
      } catch (e) {
        setProgress(null);
        return { error: `Upload to Vercel Blob failed: ${e instanceof Error ? e.message : e}` };
      }
    }
    setProgress(null);
    return action(prev, form);
  }, undefined);
  const label = progress !== null ? `Uploading ${Math.round(progress)}%…` : pending ? "Importing…" : null;
  return { state, run, busy: pending || progress !== null, label };
}

export function StyleUploadForm({ blob, maxMb }: { blob: boolean; maxMb: number }) {
  const { state, run, busy, label } = useZipUpload(uploadShelfItem, blob);
  return (
    <form action={run} className="grid gap-4 md:grid-cols-2">
      <div className="md:col-span-2">
        <label className="label" htmlFor="zip-style">Style ZIP</label>
        <input id="zip-style" name="zip" type="file" accept=".zip" required className="input file:mr-3 file:rounded-full file:border-0 file:bg-ink-3 file:px-3 file:py-1 file:text-paper" />
        <p className="mt-1 text-xs text-faint">
          One folder, e.g. <code>editorial-explainer/</code>, containing <code>style.json</code>, <code>recipe.md</code> and{" "}
          <code>frames.jpg</code>. Optional: <code>breakdown.md</code>, <code>prompts.md</code> and other notes (shown to your
          customers&apos; AI in full), <code>fonts/</code>, <code>sfx/</code>, a <code>preview.mp4</code> and a <code>cover.jpg</code>{" "}
          (16:9) for the gallery. The contact sheet is only shown to subscribers; keep it under 1.5 MB. Uploading the same folder
          name again replaces it.
          {!blob && ` Up to ${maxMb} MB without Vercel Blob.`}
        </p>
      </div>
      <div>
        <label className="label" htmlFor="slug-style">Id override (optional)</label>
        <input id="slug-style" name="slug" placeholder="from style.json or the folder name" className="input" />
      </div>
      <div>
        <label className="label" htmlFor="tags-style">Tags (comma separated, optional)</label>
        <input id="tags-style" name="tags" placeholder="from style.json when empty" className="input" />
      </div>
      <label className="flex items-center gap-2 text-sm text-muted">
        <input type="checkbox" name="publish" className="accent-[var(--color-ember)]" /> Publish now
      </label>
      <div className="flex items-center justify-end gap-4">
        <Status state={state} />
        <button className="btn-primary" disabled={busy}>{label ?? "Upload"}</button>
      </div>
    </form>
  );
}

export function PackUploadForm({ blob, maxMb, categories }: { blob: boolean; maxMb: number; categories: { value: string; label: string }[] }) {
  const { state, run, busy, label } = useZipUpload(uploadPack, blob);
  return (
    <form action={run} className="grid gap-4 md:grid-cols-2">
      <div className="md:col-span-2">
        <label className="label" htmlFor="zip-pack">Pack ZIP</label>
        <input id="zip-pack" name="zip" type="file" accept=".zip" required className="input file:mr-3 file:rounded-full file:border-0 file:bg-ink-3 file:px-3 file:py-1 file:text-paper" />
        <p className="mt-1 text-xs text-faint">
          Sound effects, fonts, textures or Lottie files, organised in folders. Customers&apos; Companion downloads each pack once.
          Upload a pack with the same name again to release a new version.{!blob && ` Up to ${maxMb} MB without Vercel Blob.`} Only
          include files you&apos;re licensed to redistribute.
        </p>
      </div>
      <div>
        <label className="label" htmlFor="pack-name">Name</label>
        <input id="pack-name" name="name" required placeholder="Essential UI sounds" className="input" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="pack-category">Category</label>
          <select id="pack-category" name="category" className="input">
            {categories.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="pack-slug">Id (optional)</label>
          <input id="pack-slug" name="slug" placeholder="from the name" className="input" />
        </div>
      </div>
      <div className="md:col-span-2">
        <label className="label" htmlFor="pack-description">What&apos;s inside (your customers&apos; AI reads this)</label>
        <textarea id="pack-description" name="description" rows={2} className="input" placeholder="120 short UI sounds: clicks, ticks, pops, whooshes, risers. WAV 48 kHz." />
      </div>
      <div>
        <label className="label" htmlFor="pack-tags">Tags</label>
        <input id="pack-tags" name="tags" className="input" placeholder="ui, clicks, whooshes" />
      </div>
      <label className="flex items-center gap-2 self-end pb-2 text-sm text-muted">
        <input type="checkbox" name="publish" className="accent-[var(--color-ember)]" /> Publish now
      </label>
      <div className="flex items-center justify-end gap-4 md:col-span-2">
        <Status state={state} />
        <button className="btn-primary" disabled={busy}>{label ?? "Upload pack"}</button>
      </div>
    </form>
  );
}

export function DeleteItemButton({ id, name, action }: { id: string; name: string; action: (form: FormData) => Promise<void> }) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(`Delete "${name}" and its files? Customers' AI can no longer use it.`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button className="text-xs text-bad hover:underline">Delete</button>
    </form>
  );
}
