"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  clipDuration,
  clipIn,
  formatTime,
  overlaps,
  snapFrame,
  type CaptionTrack,
  type MediaInfo,
  type MediaTrack,
  type Selection,
  type Timeline,
  type Track,
} from "./model";

const HEADER = 172;
const ROW_H: Record<Track["kind"], number> = { video: 58, captions: 40, audio: 50 };
const SNAP_PX = 7;

type Drag = {
  mode: "move" | "trimL" | "trimR";
  kind: "clip" | "cue";
  trackId: string;
  id: string;
  x0: number;
  orig: { start: number; in: number; dur: number };
  maxDur: number; // source length available after `in` (Infinity for stills/cues)
  start: number;
  in: number;
  dur: number;
  targetTrackId: string;
};

type Props = {
  tl: Timeline;
  media: Record<string, MediaInfo>;
  pps: number;
  time: number;
  duration: number;
  selection: Selection;
  onSelect: (s: Selection) => void;
  onSeek: (t: number) => void;
  onCommit: (tl: Timeline) => void;
  onError: (msg: string) => void;
  onTrackPatch: (trackId: string, patch: Partial<Track>) => void;
};

export function TimelineView({ tl, media, pps, time, duration, selection, onSelect, onSeek, onCommit, onError, onTrackPatch }: Props) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const rows = useRef(new Map<string, HTMLDivElement>());
  const lanes = useRef<HTMLDivElement>(null);
  const width = Math.max(duration + 10, 30) * pps;

  // ----- snapping -----
  function snapPoints(excludeId: string) {
    const pts = [0, time];
    for (const t of tl.tracks) {
      if (t.kind === "captions") {
        for (const c of t.cues) if (c.id !== excludeId) pts.push(c.start, c.end);
      } else {
        for (const c of t.clips) if (c.id !== excludeId) pts.push(c.start, c.start + clipDuration(c, media));
      }
    }
    return pts;
  }
  const snap = (v: number, pts: number[]) => {
    let best = v;
    let bestPx = SNAP_PX;
    for (const p of pts) {
      const d = Math.abs(p - v) * pps;
      if (d < bestPx) {
        bestPx = d;
        best = p;
      }
    }
    return snapFrame(best, tl.fps);
  };

  // ----- dragging -----
  function begin(e: ReactPointerEvent, mode: Drag["mode"], track: Track, id: string) {
    e.stopPropagation();
    if (e.button !== 0) return;
    let start: number;
    let inPt = 0;
    let dur: number;
    let maxDur = Infinity;
    if (track.kind === "captions") {
      const cue = track.cues.find((c) => c.id === id)!;
      start = cue.start;
      dur = cue.end - cue.start;
      onSelect({ kind: "cue", trackId: track.id, id });
    } else {
      const clip = track.clips.find((c) => c.id === id)!;
      const info = media[clip.src];
      start = clip.start;
      inPt = clipIn(clip);
      dur = clipDuration(clip, media);
      if (info && !info.still) maxDur = info.duration;
      onSelect({ kind: "clip", trackId: track.id, id });
    }
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({
      mode,
      kind: track.kind === "captions" ? "cue" : "clip",
      trackId: track.id,
      id,
      x0: e.clientX,
      orig: { start, in: inPt, dur },
      maxDur,
      start,
      in: inPt,
      dur,
      targetTrackId: track.id,
    });
  }

  function move(e: ReactPointerEvent) {
    if (!drag) return;
    const dt = (e.clientX - drag.x0) / pps;
    const pts = snapPoints(drag.id);
    const minDur = 1 / tl.fps;
    const o = drag.orig;
    let { start, in: inPt, dur, targetTrackId } = drag;
    if (drag.mode === "move") {
      start = Math.max(0, o.start + dt);
      // Snap whichever edge is closer to a snap point.
      const s1 = snap(start, pts);
      const s2 = snap(start + o.dur, pts) - o.dur;
      start = Math.max(0, Math.abs(s1 - start) <= Math.abs(s2 - start) ? s1 : s2);
      if (drag.kind === "clip") {
        const kind = tl.tracks.find((t) => t.id === drag.trackId)!.kind;
        for (const [id, el] of rows.current) {
          const r = el.getBoundingClientRect();
          const target = tl.tracks.find((t) => t.id === id);
          if (e.clientY >= r.top && e.clientY < r.bottom && target?.kind === kind) targetTrackId = id;
        }
      }
    } else if (drag.mode === "trimL") {
      const lowest = drag.kind === "clip" && drag.maxDur !== Infinity ? o.start - o.in : 0;
      let ns = snap(Math.max(lowest, Math.max(0, o.start + dt)), pts);
      ns = Math.min(ns, o.start + o.dur - minDur);
      ns = Math.max(ns, lowest, 0);
      start = ns;
      inPt = drag.maxDur === Infinity ? o.in : o.in + (ns - o.start);
      dur = o.dur - (ns - o.start);
    } else {
      let end = snap(o.start + o.dur + dt, pts);
      end = Math.max(end, o.start + minDur);
      if (drag.maxDur !== Infinity) end = Math.min(end, o.start + (drag.maxDur - o.in));
      dur = end - o.start;
    }
    setDrag({ ...drag, start, in: inPt, dur, targetTrackId });
  }

  function end() {
    if (!drag) return;
    const d = drag;
    setDrag(null);
    const changed = d.start !== d.orig.start || d.dur !== d.orig.dur || d.in !== d.orig.in || d.targetTrackId !== d.trackId;
    if (!changed) return;
    const r3 = (v: number) => Math.round(v * 1000) / 1000;
    if (d.kind === "cue") {
      onCommit({
        ...tl,
        tracks: tl.tracks.map((t) =>
          t.id === d.trackId && t.kind === "captions"
            ? { ...t, cues: t.cues.map((c) => (c.id === d.id ? { ...c, start: r3(d.start), end: r3(d.start + d.dur) } : c)) }
            : t,
        ),
      });
      return;
    }
    const src = tl.tracks.find((t) => t.id === d.trackId) as MediaTrack;
    const clip = src.clips.find((c) => c.id === d.id)!;
    const moved = { ...clip, start: r3(d.start), in: r3(d.in), duration: r3(d.dur) };
    if (moved.in === 0 && clip.in === undefined) delete (moved as { in?: number }).in;
    const target = tl.tracks.find((t) => t.id === d.targetTrackId) as MediaTrack;
    if (overlaps(target, d.id, moved.start, moved.start + moved.duration, media)) {
      onError("Clips can't overlap on the same track. Drop it on another track or add a new one.");
      return;
    }
    onCommit({
      ...tl,
      tracks: tl.tracks.map((t) => {
        if (t.kind === "captions") return t;
        let clips = t.clips;
        if (t.id === d.trackId) clips = clips.filter((c) => c.id !== d.id);
        if (t.id === d.targetTrackId) clips = [...clips, moved].sort((a, b) => a.start - b.start);
        return clips === t.clips ? t : { ...t, clips };
      }),
    });
    if (d.targetTrackId !== d.trackId) onSelect({ kind: "clip", trackId: d.targetTrackId, id: d.id });
  }

  // ----- ruler -----
  const step = [0.5, 1, 2, 5, 10, 15, 30, 60, 120].find((s) => s * pps >= 70) ?? 300;
  const ticks: number[] = [];
  for (let t = 0; t <= width / pps; t += step) ticks.push(t);

  function seekFrom(e: ReactPointerEvent) {
    const r = lanes.current!.getBoundingClientRect();
    onSeek(snapFrame(Math.max(0, (e.clientX - r.left) / pps), tl.fps));
  }

  const isSel = (kind: "clip" | "cue", id: string) => selection?.kind === kind && selection.id === id;

  return (
    <div className="relative min-w-0 flex-1 overflow-auto bg-ink" onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
      <div className="relative" style={{ width: width + HEADER }}>
        {/* Ruler */}
        <div className="sticky top-0 z-20 flex h-7 border-b border-line bg-ink-2">
          <div className="sticky left-0 z-10 shrink-0 border-r border-line bg-ink-2" style={{ width: HEADER }} />
          <div
            ref={lanes}
            className="relative flex-1 cursor-pointer"
            onPointerDown={(e) => {
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              seekFrom(e);
            }}
            onPointerMove={(e) => e.buttons === 1 && seekFrom(e)}
          >
            {ticks.map((t) => (
              <div key={t} className="absolute top-0 h-full border-l border-line/80 pl-1 font-mono text-[10px] leading-7 text-faint" style={{ left: t * pps }}>
                {formatTime(t)}
              </div>
            ))}
          </div>
        </div>

        {/* Tracks: listed top-down, so video tracks are reversed (top track drawn last in the preview). */}
        {orderForDisplay(tl.tracks).map((track) => (
          <div
            key={track.id}
            ref={(el) => {
              if (el) rows.current.set(track.id, el);
              else rows.current.delete(track.id);
            }}
            className="flex border-b border-line/70"
            style={{ height: ROW_H[track.kind] }}
          >
            <TrackHeader track={track} onPatch={(p) => onTrackPatch(track.id, p)} />
            <div className="relative flex-1" onPointerDown={() => onSelect(null)}>
              {track.kind === "captions"
                ? (track as CaptionTrack).cues.map((c) => {
                    const live = drag?.id === c.id ? drag : null;
                    const s = live ? live.start : c.start;
                    const w = (live ? live.dur : c.end - c.start) * pps;
                    return (
                      <Block
                        key={c.id}
                        left={s * pps}
                        width={w}
                        selected={isSel("cue", c.id)}
                        tone="cue"
                        label={c.text}
                        muted={track.muted}
                        onDown={(e, mode) => begin(e, mode, track, c.id)}
                      />
                    );
                  })
                : (track as MediaTrack).clips
                    .filter((c) => !(drag?.id === c.id && drag.targetTrackId !== track.id))
                    .map((c) => {
                      const live = drag?.id === c.id ? drag : null;
                      const info = media[c.src];
                      return (
                        <Block
                          key={c.id}
                          left={(live ? live.start : c.start) * pps}
                          width={(live ? live.dur : clipDuration(c, media)) * pps}
                          selected={isSel("clip", c.id)}
                          tone={track.kind === "audio" ? "audio" : info?.still ? "image" : "video"}
                          label={c.name ?? c.src.split("/").pop() ?? c.src}
                          muted={c.muted || track.muted}
                          missing={info === null}
                          onDown={(e, mode) => begin(e, mode, track, c.id)}
                        />
                      );
                    })}
              {/* Ghost of a clip being dragged onto this track from another one. */}
              {drag && drag.kind === "clip" && drag.targetTrackId === track.id && drag.trackId !== track.id && (
                <Block left={drag.start * pps} width={drag.dur * pps} selected tone={track.kind === "audio" ? "audio" : "video"} label="" onDown={() => {}} />
              )}
            </div>
          </div>
        ))}

        {/* Playhead */}
        <div className="pointer-events-none absolute top-0 bottom-0 z-30 w-px bg-ember" style={{ left: HEADER + time * pps }}>
          <div className="absolute -top-0 -left-[5px] h-0 w-0 border-x-[5px] border-t-[7px] border-x-transparent border-t-ember" />
        </div>
      </div>
    </div>
  );
}

function orderForDisplay(tracks: Track[]): Track[] {
  const video = tracks.filter((t) => t.kind === "video").reverse();
  return [...tracks.filter((t) => t.kind === "captions"), ...video, ...tracks.filter((t) => t.kind === "audio")];
}

function TrackHeader({ track, onPatch }: { track: Track; onPatch: (p: Partial<Track>) => void }) {
  const icon = track.kind === "video" ? "▣" : track.kind === "audio" ? "♪" : "T";
  return (
    <div className="sticky left-0 z-10 flex shrink-0 items-center gap-2 border-r border-line bg-ink-2 px-2.5" style={{ width: HEADER }}>
      <span className="w-4 text-center text-xs text-faint">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-xs">{track.name ?? track.kind}</span>
      {track.kind === "audio" && (
        <input
          type="range"
          min={-30}
          max={12}
          step={0.5}
          value={(track as MediaTrack).gainDb ?? 0}
          onChange={(e) => onPatch({ gainDb: Number(e.target.value) } as Partial<Track>)}
          title={`Track volume ${(track as MediaTrack).gainDb ?? 0} dB`}
          className="w-12 accent-[var(--color-ember)]"
        />
      )}
      <button
        onClick={() => onPatch({ muted: !track.muted })}
        className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${track.muted ? "bg-bad/20 text-bad" : "text-faint hover:text-paper"}`}
        title={track.muted ? "Unmute track" : "Mute track"}
      >
        M
      </button>
    </div>
  );
}

const TONES = {
  video: "bg-[#2c5f55] border-[#4a9a8a]",
  image: "bg-[#6b5426] border-[#c49a45]",
  audio: "bg-[#4a3b7a] border-[#7d68c9]",
  cue: "bg-[#3a3631] border-[#857b6c]",
} as const;

function Block({
  left,
  width,
  selected,
  tone,
  label,
  muted,
  missing,
  onDown,
}: {
  left: number;
  width: number;
  selected: boolean;
  tone: keyof typeof TONES;
  label: string;
  muted?: boolean;
  missing?: boolean;
  onDown: (e: ReactPointerEvent, mode: Drag["mode"]) => void;
}) {
  return (
    <div
      className={`group absolute top-1 bottom-1 cursor-grab overflow-hidden rounded-md border text-[11px] leading-tight text-paper select-none active:cursor-grabbing ${TONES[tone]} ${selected ? "ring-2 ring-ember" : ""} ${muted ? "opacity-40" : ""} ${missing ? "!border-bad !bg-bad/30" : ""}`}
      style={{ left, width: Math.max(4, width) }}
      onPointerDown={(e) => onDown(e, "move")}
      title={missing ? `${label} (file missing)` : label}
    >
      <div className="truncate px-2 pt-1">{label}</div>
      <div className="absolute inset-y-0 left-0 w-2 cursor-ew-resize hover:bg-paper/30" onPointerDown={(e) => onDown(e, "trimL")} />
      <div className="absolute inset-y-0 right-0 w-2 cursor-ew-resize hover:bg-paper/30" onPointerDown={(e) => onDown(e, "trimR")} />
    </div>
  );
}
