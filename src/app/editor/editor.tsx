"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Bridge, BridgeError, forgetBridge, readBridgeConfig, type BridgeConfig, type Project } from "./bridge";
import {
  clipDuration,
  clipIn,
  findClip,
  formatTime,
  newId,
  overlaps,
  snapFrame,
  timelineDuration,
  updateClip,
  updateCue,
  updateTrack,
  withIds,
  type CaptionTrack,
  type Clip,
  type EditorRequest,
  type MediaInfo,
  type MediaTrack,
  type Selection,
  type Timeline,
  type Track,
} from "./model";
import { CaptionStyleNote, ClipInspector, CueInspector, ExportPanel, MediaBin, RequestsPanel } from "./panels";
import { Preview } from "./preview";
import { TimelineView } from "./timeline-view";

export type EditorBrand = { name: string; logo: string | null; companionPackage: string };
type Gate = { signedIn: boolean; active: boolean; brand: EditorBrand };

const BrandCtx = createContext<EditorBrand>({ name: "", logo: null, companionPackage: "" });
const useBrand = () => useContext(BrandCtx);

export function EditorApp({ signedIn, active, brand }: Gate) {
  return (
    <BrandCtx.Provider value={brand}>
      <EditorGate signedIn={signedIn} active={active} />
    </BrandCtx.Provider>
  );
}

function EditorGate({ signedIn, active }: { signedIn: boolean; active: boolean }) {
  const brand = useBrand();
  const [cfg, setCfg] = useState<BridgeConfig | null | undefined>(undefined);
  useEffect(() => {
    // Reads (and removes) the pairing token from the URL fragment on load, and again when a new
    // companion link is opened in this same tab (only the fragment changes then).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCfg(readBridgeConfig());
    const onHash = () => {
      if (window.location.hash.includes("token=")) setCfg(readBridgeConfig());
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  if (cfg === undefined) return <Shell />;
  if (!signedIn)
    return (
      <Shell>
        <Notice title="Log in to edit">
          <p>The editor is part of your {brand.name} subscription.</p>
          <Link href="/login?next=/editor" className="btn-primary mt-6">
            Log in
          </Link>
        </Notice>
      </Shell>
    );
  if (!active)
    return (
      <Shell>
        <Notice title="Subscription needed">
          <p>The timeline editor is included with every {brand.name} plan.</p>
          <Link href="/pricing" className="btn-primary mt-6">
            See plans
          </Link>
        </Notice>
      </Shell>
    );
  if (!cfg) return <Shell><HowToOpen /></Shell>;
  return <Connected key={`${cfg.bridge}:${cfg.token}`} cfg={cfg} />;
}

function Shell({ children, right }: { children?: React.ReactNode; right?: React.ReactNode }) {
  const brand = useBrand();
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-ink text-paper">
      <div className="flex h-12 shrink-0 items-center gap-4 border-b border-line bg-ink-2 px-4">
        <Link href="/dashboard" className="flex items-center gap-2">
          {brand.logo ? (
            <img src={brand.logo} alt="" className="h-[18px] w-[18px] rounded object-contain" />
          ) : (
            <svg width="18" height="18" viewBox="0 0 22 22" aria-hidden>
              <rect x="1" y="1" width="20" height="20" rx="4" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M7 6.5v9l8-4.5z" fill="var(--color-ember)" />
            </svg>
          )}
          <span className="font-display text-xl leading-none">{brand.name}</span>
        </Link>
        <span className="text-xs text-faint">Editor</span>
        <div className="ml-auto flex items-center gap-2">{right}</div>
      </div>
      {children && <div className="flex min-h-0 flex-1 flex-col">{children}</div>}
    </div>
  );
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="card max-w-lg text-sm text-muted">
        <h1 className="display mb-3 text-4xl text-paper">{title}</h1>
        {children}
      </div>
    </div>
  );
}

function HowToOpen() {
  const brand = useBrand();
  return (
    <Notice title="Open a project">
      <p>The editor works on video projects on your own computer, through the {brand.name} Companion. Nothing is uploaded.</p>
      <p className="mt-4 text-paper">Claude Code, Cursor and other agents:</p>
      <p className="mt-1">In a terminal, inside your video project folder, run:</p>
      <pre className="code mt-2">npx -y {brand.companionPackage} --editor --site {window.location.origin}</pre>
      <p className="mt-4 text-paper">Claude Desktop:</p>
      <p className="mt-1">Ask Claude to &ldquo;open the {brand.name} editor&rdquo;.</p>
      <p className="mt-4">Either way, the companion opens this page with a private link. If your AI hasn&apos;t prepared the project for editing yet, ask it to &ldquo;make this video editable in the {brand.name} editor&rdquo;.</p>
      <p className="mt-4 text-xs text-faint">Your browser may ask to allow this site to access devices on your local network. Allow it: that&apos;s how the editor reaches the companion on this computer.</p>
    </Notice>
  );
}

function Connected({ cfg }: { cfg: BridgeConfig }) {
  const brand = useBrand();
  const bridge = useMemo(() => new Bridge(cfg), [cfg]);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let live = true;
    bridge
      .projects()
      .then((r) => {
        if (!live) return;
        setError(null);
        setProjects(r.projects);
        if (r.projects.length === 1) setOpen(r.projects[0].id);
      })
      .catch((e: BridgeError) => {
        if (!live) return;
        if (e.status === 401) forgetBridge();
        setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [bridge, retry]);

  if (open) return <ProjectEditor key={open} bridge={bridge} project={open} onClose={projects && projects.length > 1 ? () => setOpen(null) : undefined} />;
  if (error)
    return (
      <Shell>
        <Notice title="Can't reach your computer">
          <p>{error}</p>
          <p className="mt-3">Start the companion again; it opens a fresh link. If your browser asked about local network access, allow it.</p>
          <button className="btn-ghost mt-6" onClick={() => setRetry((n) => n + 1)}>
            Try again
          </button>
        </Notice>
      </Shell>
    );
  if (!projects) return <Shell><Notice title="Connecting…"><p>Talking to the {brand.name} Companion on this computer.</p></Notice></Shell>;
  if (!projects.length)
    return (
      <Shell>
        <Notice title="No editable projects yet">
          <p>The companion didn&apos;t find a framewright.timeline.json in this folder.</p>
          <p className="mt-3">Ask your AI to &ldquo;make this video editable in the {brand.name} editor&rdquo;, then try again.</p>
          <button className="btn-ghost mt-6" onClick={() => setRetry((n) => n + 1)}>
            Look again
          </button>
        </Notice>
      </Shell>
    );
  return (
    <Shell>
      <Notice title="Choose a project">
        <ul className="divide-y divide-line">
          {projects.map((p) => (
            <li key={p.id}>
              <button className="flex w-full items-center justify-between py-3 text-left hover:text-paper" onClick={() => setOpen(p.id)}>
                <span>
                  <span className="text-paper">{p.name}</span>
                  <span className="block font-mono text-[11px] text-faint">{p.id}</span>
                </span>
                <span className="text-xs text-faint">{new Date(p.mtime).toLocaleString()}</span>
              </button>
            </li>
          ))}
        </ul>
      </Notice>
    </Shell>
  );
}

type SaveState = "saved" | "saving" | "unsaved" | "error";
type Side = "inspect" | "media" | "requests" | "export";
const AUDIO_EXT = /\.(wav|mp3|m4a|aac|ogg|flac)$/i;
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp)$/i;

function ProjectEditor({ bridge, project, onClose }: { bridge: Bridge; project: string; onClose?: () => void }) {
  const [tl, setTl] = useState<Timeline | null>(null);
  const [media, setMedia] = useState<Record<string, MediaInfo>>({});
  const [requests, setRequests] = useState<EditorRequest[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [pps, setPps] = useState(40);
  const [side, setSide] = useState<Side>("inspect");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [conflict, setConflict] = useState(false);
  const [problems, setProblems] = useState<string[] | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [mediaRefresh, setMediaRefresh] = useState(0);
  const [history, setHistory] = useState<{ past: Timeline[]; future: Timeline[] }>({ past: [], future: [] });
  const mtime = useRef(0);
  const dirty = useRef(false);
  const lastPush = useRef({ key: "", at: 0 });
  const timelineBox = useRef<HTMLDivElement>(null);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 4000);
  }, []);

  const load = useCallback(
    async (fit: boolean) => {
      try {
        const r = await bridge.project(project);
        mtime.current = r.mtime;
        dirty.current = false;
        setTl(withIds(r.timeline));
        setMedia(r.media);
        setRequests(r.requests);
        setSaveState("saved");
        setConflict(false);
        setProblems(null);
        if (fit && timelineBox.current) {
          const d = timelineDuration(r.timeline as Timeline, r.media);
          if (d > 0) setPps(Math.max(8, Math.min(300, (timelineBox.current.clientWidth - 200) / (d * 1.05))));
        }
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Couldn't load the project");
      }
    },
    [bridge, project],
  );

  useEffect(() => {
    // Initial load of the project from the companion.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(true);
  }, [load]);

  const duration = useMemo(() => (tl ? timelineDuration(tl, media) : 0), [tl, media]);

  // ----- editing with undo -----
  const apply = useCallback(
    (next: Timeline, coalesceKey?: string) => {
      setTl((prev) => {
        if (!prev) return next;
        const now = Date.now();
        const merge = coalesceKey && lastPush.current.key === coalesceKey && now - lastPush.current.at < 800;
        lastPush.current = { key: coalesceKey ?? "", at: now };
        if (!merge) setHistory((h) => ({ past: [...h.past.slice(-99), prev], future: [] }));
        return next;
      });
      dirty.current = true;
      setSaveState("unsaved");
    },
    [],
  );

  const undo = useCallback(() => {
    setHistory((h) => {
      if (!h.past.length || !tl) return h;
      const prev = h.past[h.past.length - 1];
      setTl(prev);
      dirty.current = true;
      setSaveState("unsaved");
      return { past: h.past.slice(0, -1), future: [tl, ...h.future] };
    });
  }, [tl]);
  const redo = useCallback(() => {
    setHistory((h) => {
      if (!h.future.length || !tl) return h;
      const [next, ...rest] = h.future;
      setTl(next);
      dirty.current = true;
      setSaveState("unsaved");
      return { past: [...h.past, tl], future: rest };
    });
  }, [tl]);

  // ----- autosave -----
  useEffect(() => {
    if (!tl || saveState !== "unsaved" || conflict) return;
    const id = window.setTimeout(async () => {
      setSaveState("saving");
      try {
        const r = await bridge.save(project, tl, mtime.current);
        mtime.current = r.mtime;
        dirty.current = false;
        setMedia(r.media);
        setProblems(null);
        setSaveState("saved");
      } catch (e) {
        const err = e as BridgeError;
        if (err.status === 409) setConflict(true);
        else if (err.status === 422) setProblems(err.problems ?? [err.message]);
        else flash(err.message);
        setSaveState("error");
      }
    }, 700);
    return () => window.clearTimeout(id);
  }, [tl, saveState, conflict, bridge, project, flash]);

  // ----- watch for changes made by the AI -----
  useEffect(() => {
    const id = window.setInterval(async () => {
      try {
        const r = await bridge.mtime(project);
        setRequests(r.requests);
        if (Math.abs(r.mtime - mtime.current) > 1 && saveState !== "saving") {
          if (dirty.current) setConflict(true);
          else {
            await load(false);
            flash("Project updated on disk (probably by your AI). Reloaded.");
          }
        }
      } catch {
        /* companion briefly unavailable; keep editing */
      }
    }, 4000);
    return () => window.clearInterval(id);
  }, [bridge, project, saveState, load, flash]);

  // ----- actions -----
  const seek = useCallback((t: number) => {
    setPlaying(false);
    setTime(Math.max(0, t));
  }, []);

  const deleteSelection = useCallback(() => {
    if (!tl || !selection) return;
    apply(
      updateTrack(tl, selection.trackId, (t) =>
        t.kind === "captions"
          ? { ...t, overlayStale: t.overlay ? true : t.overlayStale, cues: t.cues.filter((c) => c.id !== selection.id) }
          : { ...t, clips: t.clips.filter((c) => c.id !== selection.id) },
      ),
    );
    setSelection(null);
  }, [tl, selection, apply]);

  const split = useCallback(() => {
    if (!tl || selection?.kind !== "clip") return;
    const found = findClip(tl, selection);
    if (found?.kind !== "clip") return;
    const { clip, track } = found;
    const d = clipDuration(clip, media);
    const at = snapFrame(time - clip.start, tl.fps);
    if (at <= 0 || at >= d) return flash("Move the playhead inside the selected clip to split it.");
    const right: Clip = { ...clip, id: newId(), start: clip.start + at, in: media[clip.src]?.still ? clipIn(clip) : clipIn(clip) + at, duration: d - at, fadeIn: undefined };
    const left: Clip = { ...clip, duration: at, fadeOut: undefined };
    apply(
      updateTrack(tl, track.id, (t) =>
        t.kind === "captions" ? t : { ...t, clips: t.clips.flatMap((c) => (c.id === clip.id ? [left, right] : [c])) },
      ),
    );
  }, [tl, selection, media, time, apply, flash]);

  const addTrack = (kind: "video" | "audio") => {
    if (!tl) return;
    const n = tl.tracks.filter((t) => t.kind === kind).length + 1;
    const track: MediaTrack = { id: newId(), kind, name: `${kind === "video" ? "Video" : "Audio"} ${n}`, clips: [] };
    // New video tracks go above existing ones (later = drawn on top); audio tracks at the end.
    const lastVideo = tl.tracks.map((t) => t.kind).lastIndexOf("video");
    const tracks = [...tl.tracks];
    if (kind === "video") tracks.splice(lastVideo + 1, 0, track);
    else tracks.push(track);
    apply({ ...tl, tracks });
    return track;
  };

  const addMedia = (src: string, info?: MediaInfo) => {
    if (!tl) return;
    const kind: "video" | "audio" = AUDIO_EXT.test(src) || (info && !info.video && !info.still) ? "audio" : "video";
    const still = IMAGE_EXT.test(src) || info?.still;
    const length = still ? 5 : (info?.duration ?? 5);
    const clip: Clip = { id: newId(), name: src.split("/").pop()!.replace(/\.[^.]+$/, ""), src, start: snapFrame(time, tl.fps), ...(still ? { duration: 5 } : {}) };
    const knownMedia = info ? { ...media, [src]: info } : media;
    if (info) setMedia(knownMedia);
    let target = tl.tracks.find((t): t is MediaTrack => t.kind === kind && !overlaps(t, clip.id, clip.start, clip.start + length, knownMedia));
    let base = tl;
    if (!target) {
      const n = tl.tracks.filter((t) => t.kind === kind).length + 1;
      target = { id: newId(), kind, name: `${kind === "video" ? "Video" : "Audio"} ${n}`, clips: [] };
      const tracks = [...tl.tracks];
      if (kind === "video") tracks.splice(tracks.map((t) => t.kind).lastIndexOf("video") + 1, 0, target);
      else tracks.push(target);
      base = { ...tl, tracks };
    }
    apply(updateTrack(base, target.id, (t) => (t.kind === "captions" ? t : { ...t, clips: [...t.clips, clip].sort((a, b) => a.start - b.start) })));
    setSelection({ kind: "clip", trackId: target.id, id: clip.id });
    setSide("inspect");
    setMediaRefresh((n) => n + 1);
  };

  const addCaption = () => {
    if (!tl) return;
    const start = snapFrame(time, tl.fps);
    const cue = { id: newId(), start, end: snapFrame(start + 2, tl.fps), text: "New caption" };
    let cap = tl.tracks.find((t): t is CaptionTrack => t.kind === "captions");
    let base = tl;
    if (!cap) {
      cap = { id: newId(), kind: "captions", name: "Captions", cues: [] };
      base = { ...tl, tracks: [...tl.tracks, cap] };
    }
    apply(
      updateTrack(base, cap.id, (t) =>
        t.kind === "captions" ? { ...t, overlayStale: t.overlay ? true : t.overlayStale, cues: [...t.cues, cue].sort((a, b) => a.start - b.start) } : t,
      ),
    );
    setSelection({ kind: "cue", trackId: cap.id, id: cue.id });
    setSide("inspect");
  };

  const ask = async (text: string, extra: Partial<EditorRequest> = {}) => {
    const r = await bridge.addRequest(project, { text, at: time, ...extra });
    setRequests(r.requests);
  };

  // ----- keyboard -----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const mod = e.ctrlKey || e.metaKey;
      if (e.code === "Space") {
        e.preventDefault();
        if (!playing && time >= duration - 0.01) setTime(0);
        setPlaying((p) => !p);
      } else if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelection();
      } else if (e.key.toLowerCase() === "s" && !mod) {
        split();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const step = (e.shiftKey ? 1 : 1 / (tl?.fps ?? 30)) * (e.key === "ArrowLeft" ? -1 : 1);
        seek(Math.min(duration, Math.max(0, time + step)));
      } else if (e.key === "Home") seek(0);
      else if (e.key === "End") seek(duration);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playing, time, duration, tl, undo, redo, deleteSelection, split, seek]);

  // ----- render -----
  if (loadError)
    return (
      <Shell>
        <Notice title="Couldn't open the project">
          <p>{loadError}</p>
        </Notice>
      </Shell>
    );
  if (!tl) return <Shell><Notice title="Loading…"><p>Reading the project from your computer.</p></Notice></Shell>;

  const sel = findClip(tl, selection);
  const cap = tl.tracks.find((t): t is CaptionTrack => t.kind === "captions");
  const openRequests = requests.filter((r) => r.status !== "done").length;
  const saveLabel = { saved: "Saved", saving: "Saving…", unsaved: "Unsaved", error: "Not saved" }[saveState];

  return (
    <Shell
      right={
        <>
          <span className="max-w-56 truncate text-sm">{tl.name}</span>
          <span className={`text-xs ${saveState === "error" ? "text-bad" : "text-faint"}`}>{saveLabel}</span>
          <button className="btn-ghost !px-3 !py-1 !text-xs" disabled={!history.past.length} onClick={undo} title="Undo (Ctrl+Z)">
            Undo
          </button>
          <button className="btn-ghost !px-3 !py-1 !text-xs" disabled={!history.future.length} onClick={redo} title="Redo (Ctrl+Shift+Z)">
            Redo
          </button>
          {onClose && (
            <button className="btn-ghost !px-3 !py-1 !text-xs" onClick={onClose}>
              Projects
            </button>
          )}
        </>
      }
    >
      {conflict && (
        <div className="flex items-center gap-3 border-b border-warn/40 bg-warn/10 px-4 py-2 text-xs text-warn">
          The project changed on disk while you had unsaved edits (probably your AI re-rendered it).
          <button className="underline" onClick={() => load(false)}>
            Load their version
          </button>
          <button
            className="underline"
            onClick={async () => {
              const r = await bridge.save(project, tl, mtime.current, true);
              mtime.current = r.mtime;
              dirty.current = false;
              setConflict(false);
              setSaveState("saved");
            }}
          >
            Keep mine
          </button>
        </div>
      )}
      {problems && (
        <div className="border-b border-bad/40 bg-bad/10 px-4 py-2 text-xs text-bad">
          Not saved, the timeline has problems: {problems.join(" · ")}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 items-center justify-center p-4">
            <Preview
              tl={tl}
              media={media}
              bridge={bridge}
              project={project}
              time={time}
              duration={duration}
              playing={playing}
              onTick={setTime}
              onEnded={() => setPlaying(false)}
            />
          </div>
          <div className="flex items-center justify-center gap-3 border-t border-line py-2">
            <button className="btn-ghost !px-3 !py-1 !text-xs" onClick={() => seek(0)} title="Start (Home)">
              ⏮
            </button>
            <button
              className="btn-primary !px-5 !py-1.5 !text-xs"
              onClick={() => {
                if (!playing && time >= duration - 0.01) setTime(0);
                setPlaying((p) => !p);
              }}
              title="Play / pause (Space)"
            >
              {playing ? "Pause" : "Play"}
            </button>
            <span className="font-mono text-xs tabular-nums text-muted">
              {formatTime(time, tl.fps)} / {formatTime(duration, tl.fps)}
            </span>
          </div>
        </div>

        <aside className="flex w-80 shrink-0 flex-col border-l border-line bg-ink-2">
          <div className="flex border-b border-line text-xs">
            {(["inspect", "media", "requests", "export"] as Side[]).map((s) => (
              <button key={s} className={`flex-1 py-2.5 capitalize ${side === s ? "border-b-2 border-ember text-paper" : "text-muted hover:text-paper"}`} onClick={() => setSide(s)}>
                {s === "requests" && openRequests ? `Requests (${openRequests})` : s}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {side === "inspect" &&
              (sel?.kind === "clip" ? (
                <ClipInspector
                  clip={sel.clip}
                  track={sel.track}
                  media={media}
                  fps={tl.fps}
                  onPatch={(p) => apply(updateClip(tl, sel.track.id, sel.clip.id, p), `clip:${sel.clip.id}`)}
                  onDelete={deleteSelection}
                  onAsk={(text) => ask(text, { clipId: sel.clip.id, clipName: sel.clip.name ?? null, src: sel.clip.src, trackName: sel.track.name ?? null })}
                />
              ) : sel?.kind === "cue" ? (
                <CueInspector
                  cue={sel.cue}
                  track={sel.track}
                  fps={tl.fps}
                  onPatch={(p) => apply(updateCue(tl, sel.track.id, sel.cue.id, p), `cue:${sel.cue.id}`)}
                  onDelete={deleteSelection}
                  onTrackPatch={(p) => apply(updateTrack(tl, sel.track.id, (t) => ({ ...t, ...p }) as Track))}
                  onAsk={(text) => ask(text, { trackName: "Captions" })}
                />
              ) : (
                <div className="space-y-4 text-xs text-muted">
                  <p>Select a clip or caption to edit it. Drag clips to move them, drag their edges to trim.</p>
                  <ul className="space-y-1 font-mono text-[11px] text-faint">
                    <li>Space · play / pause</li>
                    <li>S · split selected clip at playhead</li>
                    <li>Delete · remove selection</li>
                    <li>← → · step one frame (Shift: 1 s)</li>
                    <li>Ctrl+Z / Ctrl+Shift+Z · undo / redo</li>
                  </ul>
                  {cap?.overlay && <CaptionStyleNote track={cap} onTrackPatch={(p) => apply(updateTrack(tl, cap.id, (t) => ({ ...t, ...p }) as Track))} onAsk={(text) => ask(text, { trackName: "Captions" })} />}
                </div>
              ))}
            {side === "media" && <MediaBin bridge={bridge} project={project} refreshKey={mediaRefresh} onAdd={(src) => addMedia(src, media[src])} />}
            {side === "requests" && (
              <RequestsPanel
                requests={requests}
                onDelete={async (id) => setRequests((await bridge.deleteRequest(project, id)).requests)}
              />
            )}
            {side === "export" && <ExportPanel bridge={bridge} project={project} tl={tl} dirty={saveState !== "saved"} />}
          </div>
        </aside>
      </div>

      <div ref={timelineBox} className="flex h-[38vh] min-h-56 shrink-0 flex-col border-t border-line">
        <div className="flex items-center gap-2 border-b border-line bg-ink-2 px-3 py-1.5 text-xs">
          <button className="btn-ghost !px-3 !py-1 !text-xs" onClick={split} title="Split (S)">
            Split
          </button>
          <button className="btn-ghost !px-3 !py-1 !text-xs" onClick={addCaption}>
            + Caption
          </button>
          <button className="btn-ghost !px-3 !py-1 !text-xs" onClick={() => addTrack("video")}>
            + Video track
          </button>
          <button className="btn-ghost !px-3 !py-1 !text-xs" onClick={() => addTrack("audio")}>
            + Audio track
          </button>
          <button className="btn-ghost !px-3 !py-1 !text-xs" onClick={() => setSide("media")}>
            + Media
          </button>
          <div className="ml-auto flex items-center gap-2 text-faint">
            Zoom
            <input type="range" min={8} max={300} value={pps} onChange={(e) => setPps(Number(e.target.value))} className="w-28 accent-[var(--color-ember)]" />
            <button
              className="hover:text-paper"
              onClick={() => timelineBox.current && duration > 0 && setPps(Math.max(8, Math.min(300, (timelineBox.current.clientWidth - 200) / (duration * 1.05))))}
            >
              Fit
            </button>
          </div>
        </div>
        <TimelineView
          tl={tl}
          media={media}
          pps={pps}
          time={time}
          duration={duration}
          selection={selection}
          onSelect={(s) => {
            setSelection(s);
            if (s) setSide("inspect");
          }}
          onSeek={seek}
          onCommit={(next) => apply(next)}
          onError={flash}
          onTrackPatch={(trackId, patch) => apply(updateTrack(tl, trackId, (t) => ({ ...t, ...patch }) as Track), `track:${trackId}`)}
        />
      </div>

      {toast && <div className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-full border border-line bg-ink-3 px-4 py-2 text-xs shadow-xl">{toast}</div>}
    </Shell>
  );
}
