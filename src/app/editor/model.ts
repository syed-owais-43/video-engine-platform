// Framewright timeline model used by the web editor. Mirrors framewright.timeline.json (see
// shared/framewright-tools/export.md); extra fields (ids, mute, gain) are preserved on save.

export type Clip = {
  id: string;
  name?: string;
  src: string;
  start: number;
  in?: number;
  duration?: number;
  gainDb?: number;
  fadeIn?: number;
  fadeOut?: number;
  muted?: boolean;
};

export type Cue = { id: string; start: number; end: number; text: string };

export type MediaTrack = { id: string; kind: "video" | "audio"; name?: string; role?: string; muted?: boolean; gainDb?: number; clips: Clip[] };
export type CaptionTrack = {
  id: string;
  kind: "captions";
  name?: string;
  muted?: boolean;
  overlay?: string;
  overlayEnabled?: boolean;
  overlayStale?: boolean;
  cues: Cue[];
};
export type Track = MediaTrack | CaptionTrack;

export type Timeline = { version: 1; name: string; fps: number; width: number; height: number; tracks: Track[]; [k: string]: unknown };

export type MediaInfo = {
  still: boolean;
  duration: number;
  video: { width: number; height: number; alpha: boolean; codec?: string } | null;
  audio: { rate: number; channels: number } | null;
} | null;

export type EditorRequest = {
  id: string;
  createdAt: string;
  status: "open" | "done";
  clipId: string | null;
  clipName: string | null;
  src: string | null;
  trackName: string | null;
  at: number | null;
  text: string;
  note?: string;
};

export type Selection = { kind: "clip" | "cue"; trackId: string; id: string } | null;

const rid = () => Math.random().toString(36).slice(2, 10);

// Gives every track, clip and cue a stable id so edits and AI requests can refer to them.
export function withIds(tl: Timeline): Timeline {
  return {
    ...tl,
    tracks: tl.tracks.map((t) =>
      t.kind === "captions"
        ? { ...t, id: t.id ?? rid(), cues: t.cues.map((c) => ({ ...c, id: c.id ?? rid() })) }
        : { ...t, id: t.id ?? rid(), clips: t.clips.map((c) => ({ ...c, id: c.id ?? rid() })) },
    ),
  };
}

export const newId = rid;

export const clipIn = (c: Clip) => c.in ?? 0;

export function clipDuration(c: Clip, media: Record<string, MediaInfo>): number {
  if (c.duration !== undefined) return c.duration;
  const info = media[c.src];
  if (!info) return 1;
  return info.still ? 5 : Math.max(0, info.duration - clipIn(c));
}

export const clipEnd = (c: Clip, media: Record<string, MediaInfo>) => c.start + clipDuration(c, media);

export function timelineDuration(tl: Timeline, media: Record<string, MediaInfo>): number {
  let end = 0;
  for (const t of tl.tracks) {
    if (t.kind === "captions") for (const c of t.cues) end = Math.max(end, c.end);
    else for (const c of t.clips) end = Math.max(end, clipEnd(c, media));
  }
  return end;
}

export const snapFrame = (s: number, fps: number) => Math.round(s * fps) / fps;
export const dbToGain = (db: number) => Math.pow(10, db / 20);

export function formatTime(s: number, fps?: number): string {
  const neg = s < 0;
  s = Math.abs(s);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const tail = fps ? `:${String(Math.floor((s % 1) * fps + 1e-6)).padStart(2, "0")}` : `.${String(Math.floor((s % 1) * 10))}`;
  return `${neg ? "-" : ""}${m}:${String(sec).padStart(2, "0")}${tail}`;
}

// True when [start, end) overlaps another clip on the same track.
export function overlaps(track: MediaTrack, clipId: string, start: number, end: number, media: Record<string, MediaInfo>) {
  const eps = 1e-4;
  return track.clips.some((c) => c.id !== clipId && start < clipEnd(c, media) - eps && end > c.start + eps);
}

export type Found = { kind: "clip"; track: MediaTrack; clip: Clip } | { kind: "cue"; track: CaptionTrack; cue: Cue } | null;

export function findClip(tl: Timeline, sel: Selection): Found {
  if (!sel) return null;
  const track = tl.tracks.find((t) => t.id === sel.trackId);
  if (!track) return null;
  if (sel.kind === "cue" && track.kind === "captions") {
    const cue = track.cues.find((c) => c.id === sel.id);
    return cue ? { kind: "cue", track, cue } : null;
  }
  if (sel.kind === "clip" && track.kind !== "captions") {
    const clip = track.clips.find((c) => c.id === sel.id);
    return clip ? { kind: "clip", track, clip } : null;
  }
  return null;
}

export function updateTrack(tl: Timeline, trackId: string, fn: (t: Track) => Track): Timeline {
  return { ...tl, tracks: tl.tracks.map((t) => (t.id === trackId ? fn(t) : t)) };
}

export function updateClip(tl: Timeline, trackId: string, clipId: string, patch: Partial<Clip>): Timeline {
  return updateTrack(tl, trackId, (t) =>
    t.kind === "captions" ? t : { ...t, clips: t.clips.map((c) => (c.id === clipId ? { ...c, ...patch } : c)) },
  );
}

export function updateCue(tl: Timeline, trackId: string, cueId: string, patch: Partial<Cue>): Timeline {
  return updateTrack(tl, trackId, (t) =>
    t.kind !== "captions"
      ? t
      : { ...t, overlayStale: t.overlay ? true : t.overlayStale, cues: t.cues.map((c) => (c.id === cueId ? { ...c, ...patch } : c)) },
  );
}

// Strips nothing: the bridge validates and stores the timeline as-is (ids included).
export const serialise = (tl: Timeline) => tl;

export const isVideoMedia = (info: MediaInfo) => Boolean(info?.video) || Boolean(info?.still);
