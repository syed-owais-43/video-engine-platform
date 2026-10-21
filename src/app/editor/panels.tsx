"use client";

import { useEffect, useState } from "react";
import type { Bridge, Job } from "./bridge";
import {
  clipDuration,
  clipIn,
  formatTime,
  type CaptionTrack,
  type Clip,
  type Cue,
  type EditorRequest,
  type MediaInfo,
  type MediaTrack,
  type Timeline,
} from "./model";

const num = (v: string, fallback: number) => (Number.isFinite(Number(v)) && v.trim() !== "" ? Number(v) : fallback);

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-medium tracking-wider text-muted uppercase">{label}</span>
      {children}
    </label>
  );
}

const small = "w-full rounded-md border border-line bg-ink px-2 py-1.5 text-xs text-paper outline-none focus:border-ember";

// ---------------- Inspector ----------------

export function ClipInspector({
  clip,
  track,
  media,
  fps,
  onPatch,
  onDelete,
  onAsk,
}: {
  clip: Clip;
  track: MediaTrack;
  media: Record<string, MediaInfo>;
  fps: number;
  onPatch: (p: Partial<Clip>) => void;
  onDelete: () => void;
  onAsk: (text: string) => Promise<void>;
}) {
  const info = media[clip.src];
  const dur = clipDuration(clip, media);
  const isAudio = track.kind === "audio";
  return (
    <div className="space-y-4">
      <div>
        <p className="text-[10px] tracking-wider text-muted uppercase">{isAudio ? "Audio clip" : info?.still ? "Image" : "Video clip"}</p>
        <input className={`${small} mt-1 text-sm`} value={clip.name ?? ""} placeholder={clip.src} onChange={(e) => onPatch({ name: e.target.value })} />
        <p className="mt-1 truncate font-mono text-[10px] text-faint" title={clip.src}>{clip.src}</p>
        {info === null && <p className="mt-1 text-xs text-bad">File missing or unreadable.</p>}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Start">
          <input className={small} type="number" step={1 / fps} value={clip.start} onChange={(e) => onPatch({ start: Math.max(0, num(e.target.value, clip.start)) })} />
        </Field>
        <Field label="In">
          <input className={small} type="number" step={1 / fps} disabled={info?.still} value={clipIn(clip)} onChange={(e) => onPatch({ in: Math.max(0, num(e.target.value, clipIn(clip))) })} />
        </Field>
        <Field label="Length">
          <input className={small} type="number" step={1 / fps} value={Math.round(dur * 1000) / 1000} onChange={(e) => onPatch({ duration: Math.max(1 / fps, num(e.target.value, dur)) })} />
        </Field>
      </div>
      {isAudio && (
        <>
          <Field label={`Volume ${clip.gainDb ?? 0} dB`}>
            <input
              type="range"
              min={-40}
              max={12}
              step={0.5}
              value={clip.gainDb ?? 0}
              onChange={(e) => onPatch({ gainDb: Number(e.target.value) })}
              className="w-full accent-[var(--color-ember)]"
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Fade in (s)">
              <input className={small} type="number" min={0} step={0.1} value={clip.fadeIn ?? 0} onChange={(e) => onPatch({ fadeIn: Math.max(0, num(e.target.value, 0)) || undefined })} />
            </Field>
            <Field label="Fade out (s)">
              <input className={small} type="number" min={0} step={0.1} value={clip.fadeOut ?? 0} onChange={(e) => onPatch({ fadeOut: Math.max(0, num(e.target.value, 0)) || undefined })} />
            </Field>
          </div>
        </>
      )}
      <div className="flex gap-2">
        <button className="btn-ghost flex-1 !px-3 !py-1.5 !text-xs" onClick={() => onPatch({ muted: !clip.muted })}>
          {clip.muted ? "Unmute" : isAudio ? "Mute" : "Hide"}
        </button>
        <button className="btn-danger flex-1 !px-3 !py-1.5 !text-xs" onClick={onDelete}>
          Delete
        </button>
      </div>
      <AskAi
        hint={isAudio ? "e.g. replace this whoosh with something softer" : "e.g. make the headline bigger and slow the intro"}
        onAsk={onAsk}
      />
    </div>
  );
}

export function CueInspector({
  cue,
  track,
  fps,
  onPatch,
  onDelete,
  onTrackPatch,
  onAsk,
}: {
  cue: Cue;
  track: CaptionTrack;
  fps: number;
  onPatch: (p: Partial<Cue>) => void;
  onDelete: () => void;
  onTrackPatch: (p: Partial<CaptionTrack>) => void;
  onAsk: (text: string) => Promise<void>;
}) {
  return (
    <div className="space-y-4">
      <p className="text-[10px] tracking-wider text-muted uppercase">Caption</p>
      <textarea className={`${small} min-h-20 text-sm`} value={cue.text} onChange={(e) => onPatch({ text: e.target.value })} />
      <div className="grid grid-cols-2 gap-2">
        <Field label="Start">
          <input className={small} type="number" step={1 / fps} value={cue.start} onChange={(e) => onPatch({ start: Math.max(0, num(e.target.value, cue.start)) })} />
        </Field>
        <Field label="End">
          <input className={small} type="number" step={1 / fps} value={cue.end} onChange={(e) => onPatch({ end: Math.max(cue.start + 1 / fps, num(e.target.value, cue.end)) })} />
        </Field>
      </div>
      <button className="btn-danger w-full !py-1.5 !text-xs" onClick={onDelete}>
        Delete caption
      </button>
      {track.overlay && <CaptionStyleNote track={track} onTrackPatch={onTrackPatch} onAsk={onAsk} />}
    </div>
  );
}

export function CaptionStyleNote({
  track,
  onTrackPatch,
  onAsk,
}: {
  track: CaptionTrack;
  onTrackPatch: (p: Partial<CaptionTrack>) => void;
  onAsk: (text: string) => Promise<void>;
}) {
  const [asked, setAsked] = useState(false);
  if (!track.overlayStale && track.overlayEnabled !== false) {
    return <p className="text-xs text-faint">Showing the styled caption overlay. Editing any caption switches the preview to plain captions until the overlay is re-rendered.</p>;
  }
  return (
    <div className="space-y-2 rounded-lg border border-warn/40 bg-warn/5 p-3 text-xs text-warn">
      <p>
        {track.overlayStale
          ? "Captions changed, so the styled overlay is out of date. The preview and MP4 export use plain captions for now."
          : "Styled caption overlay is switched off; plain captions are used."}
      </p>
      <div className="flex flex-wrap gap-2">
        {track.overlayStale && (
          <button
            className="btn-ghost !px-3 !py-1 !text-xs"
            disabled={asked}
            onClick={async () => {
              await onAsk("Captions were edited in the timeline editor. Re-render the styled caption overlay from the current cues and clear overlayStale.");
              setAsked(true);
            }}
          >
            {asked ? "Asked" : "Ask AI to re-style"}
          </button>
        )}
        {track.overlayEnabled === false && !track.overlayStale && (
          <button className="btn-ghost !px-3 !py-1 !text-xs" onClick={() => onTrackPatch({ overlayEnabled: true })}>
            Use styled overlay
          </button>
        )}
      </div>
    </div>
  );
}

function AskAi({ hint, onAsk }: { hint: string; onAsk: (text: string) => Promise<void> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  return (
    <div className="rounded-lg border border-line p-3">
      <p className="text-[10px] font-medium tracking-wider text-muted uppercase">Ask your AI to change this</p>
      <textarea className={`${small} mt-2 min-h-16`} placeholder={hint} value={text} onChange={(e) => (setText(e.target.value), setDone(false))} />
      <button
        className="btn-primary mt-2 w-full !py-1.5 !text-xs"
        disabled={!text.trim() || busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onAsk(text.trim());
            setText("");
            setDone(true);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Saving…" : "Add request"}
      </button>
      {done && <p className="mt-2 text-xs text-ok">Saved. See Requests for what to tell your AI.</p>}
    </div>
  );
}

// ---------------- Media bin ----------------

export function MediaBin({
  bridge,
  project,
  onAdd,
  refreshKey,
}: {
  bridge: Bridge;
  project: string;
  onAdd: (src: string) => void;
  refreshKey: number;
}) {
  const [assets, setAssets] = useState<{ src: string; size: number }[] | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let live = true;
    bridge
      .assets(project)
      .then((r) => live && setAssets(r.assets))
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [bridge, project, refreshKey, reload]);

  async function upload(files: FileList | File[]) {
    setError(null);
    for (const f of Array.from(files)) {
      setUploading(f.name);
      try {
        const r = await bridge.upload(project, f);
        onAdd(r.src);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed");
      }
    }
    setUploading(null);
    setReload((n) => n + 1);
  }

  return (
    <div className="space-y-3">
      <label
        className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-3 py-5 text-center text-xs ${over ? "border-ember bg-ember/5" : "border-line text-muted"}`}
        onDragOver={(e) => (e.preventDefault(), setOver(true))}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void upload(e.dataTransfer.files);
        }}
      >
        <input type="file" multiple accept="video/*,audio/*,image/*" className="hidden" onChange={(e) => e.target.files && upload(e.target.files)} />
        {uploading ? `Copying ${uploading}…` : "Drop images, video or audio here, or click to choose. They're copied into the project's assets/imported folder and placed at the playhead."}
      </label>
      {error && <p className="text-xs text-bad">{error}</p>}
      <div>
        <p className="mb-1.5 text-[10px] font-medium tracking-wider text-muted uppercase">In this project</p>
        {!assets ? (
          <p className="text-xs text-faint">Loading…</p>
        ) : assets.length === 0 ? (
          <p className="text-xs text-faint">No media in assets/ or renders/ yet.</p>
        ) : (
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {assets.map((a) => (
              <li key={a.src} className="group flex items-center gap-2 rounded-md px-2 py-1 text-xs hover:bg-ink-3">
                <span className="min-w-0 flex-1 truncate" title={a.src}>
                  {a.src}
                </span>
                <button className="shrink-0 text-ember opacity-0 group-hover:opacity-100" onClick={() => onAdd(a.src)}>
                  + Add
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------------- Requests ----------------

export function RequestsPanel({ requests, onDelete }: { requests: EditorRequest[]; onDelete: (id: string) => void }) {
  const open = requests.filter((r) => r.status !== "done");
  const done = requests.filter((r) => r.status === "done");
  return (
    <div className="space-y-4 text-xs">
      <div className="rounded-lg border border-line bg-ink p-3 text-muted">
        Your edits are saved straight to the project. To apply these requests (and re-render with your timing edits), tell your AI:
        <p className="mt-2 rounded bg-ink-3 px-2 py-1.5 font-mono text-paper">Apply my editor requests</p>
      </div>
      {open.length === 0 && <p className="text-faint">No open requests.</p>}
      <ul className="space-y-2">
        {open.map((r) => (
          <li key={r.id} className="rounded-lg border border-line p-3">
            <p className="text-paper">{r.text}</p>
            <p className="mt-1 text-faint">
              {[r.clipName, r.trackName, r.at !== null ? `at ${formatTime(r.at)}` : null].filter(Boolean).join(" · ")}
            </p>
            <button className="mt-2 text-bad hover:underline" onClick={() => onDelete(r.id)}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      {done.length > 0 && (
        <details>
          <summary className="cursor-pointer text-faint">{done.length} done</summary>
          <ul className="mt-2 space-y-2">
            {done.map((r) => (
              <li key={r.id} className="rounded-lg border border-line/60 p-3 text-faint">
                {r.text}
                {r.note && <p className="mt-1 text-ok">{r.note}</p>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

// ---------------- Export ----------------

export function ExportPanel({ bridge, project, tl, dirty }: { bridge: Bridge; project: string; tl: Timeline; dirty: boolean }) {
  const cap = tl.tracks.find((t): t is CaptionTrack => t.kind === "captions");
  const overlayUsable = Boolean(cap?.overlay && cap.overlayEnabled !== false && !cap.overlayStale);
  const [captions, setCaptions] = useState<"overlay" | "plain" | "none">(overlayUsable ? "overlay" : cap ? "plain" : "none");
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!job || job.status !== "running") return;
    const id = setInterval(async () => {
      try {
        setJob((await bridge.job(job.id)).job);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Lost the job");
        clearInterval(id);
      }
    }, 700);
    return () => clearInterval(id);
  }, [job, bridge]);

  const start = async (fn: () => Promise<{ job: Job }>) => {
    setError(null);
    try {
      setJob((await fn()).job);
    } catch (e) {
      const p = (e as { problems?: string[] }).problems;
      setError(p?.length ? `${(e as Error).message}:\n${p.join("\n")}` : (e as Error).message);
    }
  };
  const running = job?.status === "running";

  return (
    <div className="space-y-5 text-xs">
      {dirty && <p className="text-warn">Saving your latest edits first…</p>}
      <div className="space-y-2">
        <p className="text-[10px] font-medium tracking-wider text-muted uppercase">MP4 video</p>
        <p className="text-muted">Builds the video from this timeline in seconds. Animation inside scenes stays as rendered.</p>
        {cap && (
          <div className="space-y-1">
            {(["overlay", "plain", "none"] as const).map((m) => (
              <label key={m} className={`flex items-center gap-2 ${m === "overlay" && !overlayUsable ? "opacity-40" : ""}`}>
                <input type="radio" name="captions" disabled={m === "overlay" && !overlayUsable} checked={captions === m} onChange={() => setCaptions(m)} className="accent-[var(--color-ember)]" />
                {m === "overlay" ? "Styled captions" : m === "plain" ? "Plain captions (current text)" : "No captions"}
              </label>
            ))}
          </div>
        )}
        <button className="btn-primary w-full !py-2 !text-xs" disabled={running || dirty} onClick={() => start(() => bridge.render(project, captions))}>
          Export MP4
        </button>
      </div>
      <div className="space-y-2">
        <p className="text-[10px] font-medium tracking-wider text-muted uppercase">Premiere · Resolve · Final Cut</p>
        <p className="text-muted">Project files plus a media folder, to keep editing in your own software.</p>
        <button className="btn-ghost w-full !py-2 !text-xs" disabled={running || dirty} onClick={() => start(() => bridge.exportPackage(project))}>
          Export edit package
        </button>
      </div>
      {job && (
        <div className="rounded-lg border border-line p-3">
          {job.status === "running" && (
            <>
              <p>{job.kind === "render" ? "Rendering MP4" : "Writing edit package"}… {Math.round(job.progress * 100)}%</p>
              <div className="mt-2 h-1 rounded-full bg-line">
                <div className="h-full rounded-full bg-ember transition-all" style={{ width: `${Math.round(job.progress * 100)}%` }} />
              </div>
            </>
          )}
          {job.status === "done" && job.output && (
            <>
              <p className="text-ok">Done</p>
              <p className="mt-1 font-mono break-all text-faint">{job.output}</p>
              <button className="mt-2 text-paper underline" onClick={() => bridge.reveal(job.output!)}>
                Show in folder
              </button>
            </>
          )}
          {job.status === "error" && <p className="whitespace-pre-wrap text-bad">{job.error}</p>}
        </div>
      )}
      {error && <p className="whitespace-pre-wrap text-bad">{error}</p>}
    </div>
  );
}
