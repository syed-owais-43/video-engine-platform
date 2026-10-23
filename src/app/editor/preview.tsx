"use client";

import { useEffect, useRef, useState } from "react";
import type { Bridge } from "./bridge";
import { clipDuration, clipIn, dbToGain, type MediaInfo, type Timeline } from "./model";

type El = HTMLVideoElement | HTMLImageElement | HTMLAudioElement;
type Kind = "video" | "image" | "audio";

// The element kind is part of the key, so a clip whose file info arrives later (e.g. an image
// added before it was probed) gets the right element instead of keeping a wrong one.
const kindOf = (trackKind: string, info: MediaInfo | undefined): Kind => (trackKind === "audio" ? "audio" : info?.still ? "image" : "video");
const keyOf = (id: string, src: string, kind: Kind, version?: number) => `${id}:${src}:${kind}:${version ?? 0}`;

type Props = {
  tl: Timeline;
  media: Record<string, MediaInfo>;
  bridge: Bridge;
  project: string;
  time: number;
  duration: number;
  playing: boolean;
  onTick: (t: number) => void;
  onEnded: () => void;
  // Dashed title-safe area (6% inset) and a label naming the scene under the playhead.
  guides?: boolean;
  badge?: string | null;
};

// Plays the timeline by keeping one media element per clip in sync with a shared clock and
// compositing the visible ones onto a canvas, bottom track first.
export function Preview({ tl, media, bridge, project, time, duration, playing, onTick, onEnded, guides, badge }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const els = useRef(new Map<string, El>());
  const gains = useRef(new Map<string, GainNode>());
  const audioCtx = useRef<AudioContext | null>(null);
  const clock = useRef({ t: time, wall: 0, playing: false });
  const latest = useRef({ tl, media, duration, onTick, onEnded });

  useEffect(() => {
    latest.current = { tl, media, duration, onTick, onEnded };
  });

  // Create/remove media elements as clips change.
  useEffect(() => {
    const wanted = new Map<string, { src: string; kind: Kind; version?: number }>();
    for (const t of tl.tracks) {
      if (t.kind === "captions") {
        if (t.overlay) wanted.set(`overlay:${t.overlay}:${media[t.overlay]?.mtime ?? 0}`, { src: t.overlay, kind: "video", version: media[t.overlay]?.mtime });
        continue;
      }
      for (const c of t.clips) {
        const kind = kindOf(t.kind, media[c.src]);
        const version = media[c.src]?.mtime;
        wanted.set(keyOf(c.id, c.src, kind, version), { src: c.src, kind, version });
      }
    }
    const map = els.current;
    for (const [key, el] of map) {
      if (!wanted.has(key)) {
        if (el instanceof HTMLMediaElement) {
          el.pause();
          el.removeAttribute("src");
          el.load();
        }
        map.delete(key);
        gains.current.delete(key);
      }
    }
    for (const [key, w] of wanted) {
      if (map.has(key)) continue;
      const url = bridge.mediaUrl(project, w.src, w.kind === "video", w.version);
      let el: El;
      if (w.kind === "image") {
        el = new Image();
        el.crossOrigin = "anonymous";
      } else if (w.kind === "video") {
        const v = document.createElement("video");
        v.muted = true;
        v.playsInline = true;
        v.preload = "auto";
        el = v;
      } else {
        el = new Audio();
        (el as HTMLAudioElement).preload = "auto";
      }
      el.crossOrigin = "anonymous";
      el.src = url;
      map.set(key, el);
      if (w.kind === "audio" && audioCtx.current) connectAudio(key, el as HTMLAudioElement);
    }
  }, [tl, media, bridge, project]);

  function connectAudio(key: string, el: HTMLAudioElement) {
    const ctx = audioCtx.current!;
    if (gains.current.has(key)) return;
    const g = ctx.createGain();
    ctx.createMediaElementSource(el).connect(g).connect(ctx.destination);
    gains.current.set(key, g);
  }

  // Start/stop the clock.
  useEffect(() => {
    if (playing) {
      if (!audioCtx.current) {
        audioCtx.current = new AudioContext();
        for (const [key, el] of els.current) if (el instanceof HTMLAudioElement) connectAudio(key, el);
      }
      void audioCtx.current.resume();
      clock.current = { t: time, wall: performance.now(), playing: true };
    } else {
      clock.current = { ...clock.current, t: time, playing: false };
      for (const el of els.current.values()) if (el instanceof HTMLMediaElement) el.pause();
    }
    // `time` only seeds the clock when play starts or stops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  // While paused, follow external seeks.
  useEffect(() => {
    if (!clock.current.playing) clock.current.t = time;
  }, [time]);

  // One render loop for both playback and scrubbing.
  useEffect(() => {
    let raf = 0;
    let lastTick = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const { tl, media, duration, onTick, onEnded } = latest.current;
      const c = clock.current;
      let t = c.t;
      if (c.playing) {
        t = c.t + (now - c.wall) / 1000;
        if (t >= duration) {
          c.playing = false;
          c.t = duration;
          onEnded();
          t = duration;
        } else if (now - lastTick > 50) {
          lastTick = now;
          onTick(t);
        }
      }
      sync(tl, media, t, c.playing);
      draw(tl, media, t);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function syncEl(el: HTMLMediaElement, active: boolean, local: number, isPlaying: boolean, fps: number) {
    if (!active) {
      if (!el.paused) el.pause();
      return;
    }
    if (el.readyState < 1) return;
    if (isPlaying) {
      if (el.paused) {
        el.currentTime = local;
        void el.play().catch(() => {});
      } else if (Math.abs(el.currentTime - local) > 0.25) el.currentTime = local;
    } else {
      if (!el.paused) el.pause();
      if (Math.abs(el.currentTime - local) > 0.5 / fps && !el.seeking) el.currentTime = local;
    }
  }

  function sync(tl: Timeline, media: Record<string, MediaInfo>, t: number, isPlaying: boolean) {
    for (const track of tl.tracks) {
      if (track.kind === "captions") {
        const el = track.overlay ? els.current.get(`overlay:${track.overlay}:${media[track.overlay]?.mtime ?? 0}`) : undefined;
        if (el instanceof HTMLVideoElement) {
          const on = !track.muted && track.overlayEnabled !== false && !track.overlayStale;
          syncEl(el, on && t < (media[track.overlay!]?.duration ?? 0), t, isPlaying, tl.fps);
        }
        continue;
      }
      for (const c of track.clips) {
        const key = keyOf(c.id, c.src, kindOf(track.kind, media[c.src]), media[c.src]?.mtime);
        const el = els.current.get(key);
        if (!(el instanceof HTMLMediaElement)) continue;
        const dur = clipDuration(c, media);
        const local = t - c.start;
        const active = local >= 0 && local < dur;
        syncEl(el, active, clipIn(c) + local, isPlaying, tl.fps);
        const g = gains.current.get(key);
        if (g && active) {
          let level = track.muted || c.muted ? 0 : dbToGain((c.gainDb ?? 0) + (track.gainDb ?? 0));
          if (c.fadeIn && local < c.fadeIn) level *= local / c.fadeIn;
          if (c.fadeOut && dur - local < c.fadeOut) level *= Math.max(0, (dur - local) / c.fadeOut);
          g.gain.value = level;
        }
      }
    }
  }

  function drawFit(ctx: CanvasRenderingContext2D, el: CanvasImageSource, w: number, h: number, W: number, H: number) {
    const s = Math.min(W / w, H / h);
    ctx.drawImage(el, (W - w * s) / 2, (H - h * s) / 2, w * s, h * s);
  }

  function draw(tl: Timeline, media: Record<string, MediaInfo>, t: number) {
    const cv = canvas.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const W = tl.width;
    const H = tl.height;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    for (const track of tl.tracks) {
      if (track.kind === "audio" || track.muted) continue;
      if (track.kind === "captions") {
        const overlay = track.overlay ? els.current.get(`overlay:${track.overlay}:${media[track.overlay]?.mtime ?? 0}`) : undefined;
        if (overlay instanceof HTMLVideoElement && track.overlayEnabled !== false && !track.overlayStale) {
          if (overlay.readyState >= 2 && t < (media[track.overlay!]?.duration ?? 0)) drawFit(ctx, overlay, overlay.videoWidth, overlay.videoHeight, W, H);
        } else {
          const cue = track.cues.find((c) => t >= c.start && t < c.end);
          if (cue) drawPlainCaption(ctx, cue.text, W, H);
        }
        continue;
      }
      for (const c of track.clips) {
        if (c.muted) continue;
        const local = t - c.start;
        if (local < 0 || local >= clipDuration(c, media)) continue;
        const el = els.current.get(keyOf(c.id, c.src, kindOf(track.kind, media[c.src]), media[c.src]?.mtime));
        if (el instanceof HTMLVideoElement && el.readyState >= 2) drawFit(ctx, el, el.videoWidth, el.videoHeight, W, H);
        else if (el instanceof HTMLImageElement && el.complete && el.naturalWidth) drawFit(ctx, el, el.naturalWidth, el.naturalHeight, W, H);
      }
    }
  }

  // Overlays follow the canvas's displayed box (it's letterboxed inside the stage).
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="relative flex h-full w-full items-center justify-center">
      <canvas
        ref={canvas}
        width={tl.width}
        height={tl.height}
        className="max-h-full max-w-full rounded-md bg-black shadow-2xl shadow-black/60"
        style={{ aspectRatio: `${tl.width} / ${tl.height}` }}
      />
      {box && (guides || badge) && (
        <div className="pointer-events-none absolute" style={box}>
          {guides && <div className="absolute inset-[6%] rounded-md border border-dashed border-white/20" />}
          {badge && <span className="absolute top-3 left-3 max-w-[70%] truncate rounded-full bg-black/60 px-2.5 py-1 text-[11px] text-white/90 backdrop-blur">{badge}</span>}
        </div>
      )}
    </div>
  );
}

// Same look as the exporter's "plain" captions so the preview matches the MP4.
function drawPlainCaption(ctx: CanvasRenderingContext2D, text: string, W: number, H: number) {
  const size = Math.round((H * 18) / 288);
  ctx.font = `bold ${size}px Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(2, (size * 1.5) / 9);
  const lines = text.split("\n");
  const base = H - (H * 22) / 288;
  lines.forEach((line, i) => {
    const y = base - (lines.length - 1 - i) * size * 1.15;
    ctx.strokeStyle = "#000";
    ctx.strokeText(line, W / 2, y);
    ctx.fillStyle = "#fff";
    ctx.fillText(line, W / 2, y);
  });
}
