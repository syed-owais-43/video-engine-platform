#!/usr/bin/env node
// Framewright timeline composer: renders the final MP4 straight from framewright.timeline.json
// with FFmpeg, so edits made in the editor (cuts, moves, levels, captions) export in seconds
// without re-rendering any animation.
//
//   node fw-compose.mjs <framewright.timeline.json> [--out exports] [--version 1] [--captions overlay|plain|none]
//
// captions: overlay = the styled caption video (default when present), plain = burn the caption
// text with a simple style (use after editing caption wording), none = no captions.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { clipGain, isEnabled, loadTimeline, srt } from "./fw-export.mjs";

const ffmpegBin = () => process.env.MVD_FFMPEG || "ffmpeg";
const STALL_MS = 3 * 60 * 1000;
const n = (x) => Number(x.toFixed(4));

// Builds the FFmpeg argument list. Returned separately from running it so it can be tested.
export function composeArgs(tl, { outFile, captions = "overlay", srtName = "captions.srt" }) {
  const W = tl.width;
  const H = tl.height;
  const D = n(tl.duration);
  const args = ["-hide_banner", "-y", "-nostdin"];
  const filters = [`color=c=black:s=${W}x${H}:r=${tl.fps}:d=${D}[base]`];
  let inputs = 0;
  let last = "base";

  const addVisual = (abs, info, { start, inPoint, duration }) => {
    if (info.still) args.push("-loop", "1", "-framerate", String(tl.fps), "-t", String(n(duration)), "-i", abs);
    else args.push("-ss", String(n(inPoint)), "-t", String(n(duration)), "-i", abs);
    const i = inputs++;
    // Fit inside the frame, keep transparency, and shift the clip to its timeline position.
    filters.push(
      `[${i}:v]fps=${tl.fps},scale=${W}:${H}:force_original_aspect_ratio=decrease,format=yuva420p,` +
        `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black@0,setpts=PTS-STARTPTS+${n(start)}/TB[v${i}]`,
    );
    filters.push(`[${last}][v${i}]overlay=eof_action=pass:enable='between(t,${n(start)},${n(start + duration)})'[o${i}]`);
    last = `o${i}`;
  };

  for (const t of tl.tracks.filter((t) => t.kind === "video")) {
    for (const c of t.clips) {
      if (!isEnabled(c, t)) continue;
      addVisual(c.abs, tl.media.get(c.abs), { start: c.start, inPoint: c.in, duration: c.duration });
    }
  }

  const cap = tl.tracks.find((t) => t.kind === "captions");
  if (cap && !cap.muted) {
    if (captions === "overlay" && cap.overlayAbs) {
      const info = tl.media.get(cap.overlayAbs);
      addVisual(cap.overlayAbs, info, { start: 0, inPoint: 0, duration: Math.min(info.duration, tl.duration) });
    } else if (captions === "plain" && cap.cues.length) {
      // Relative file name: FFmpeg runs inside the temp folder, avoiding filter-path escaping.
      // libass sizes are in a 288-line script space, so these scale with the video height.
      filters.push(
        `[${last}]subtitles=${srtName}:force_style='Fontname=Arial,Fontsize=18,Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=1.5,Shadow=0,Alignment=2,MarginV=22'[subs]`,
      );
      last = "subs";
    }
  }
  filters.push(`[${last}]format=yuv420p[vout]`);

  const audio = [];
  for (const t of tl.tracks.filter((t) => t.kind === "audio")) {
    for (const c of t.clips) {
      if (!isEnabled(c, t)) continue;
      args.push("-ss", String(n(c.in)), "-t", String(n(c.duration)), "-i", c.abs);
      const i = inputs++;
      const chain = [`aresample=48000`, `aformat=channel_layouts=stereo`, `volume=${clipGain(c, t)}dB`];
      if (c.fadeIn) chain.push(`afade=t=in:st=0:d=${n(c.fadeIn)}`);
      if (c.fadeOut) chain.push(`afade=t=out:st=${n(Math.max(0, c.duration - c.fadeOut))}:d=${n(c.fadeOut)}`);
      const ms = Math.round(c.start * 1000);
      chain.push(`adelay=${ms}|${ms}`);
      filters.push(`[${i}:a]${chain.join(",")}[a${i}]`);
      audio.push(`[a${i}]`);
    }
  }
  if (audio.length) {
    filters.push(`${audio.join("")}amix=inputs=${audio.length}:normalize=0:duration=longest,apad,atrim=0:${D}[aout]`);
  } else {
    filters.push(`anullsrc=r=48000:cl=stereo,atrim=0:${D}[aout]`);
  }

  args.push(
    "-filter_complex", filters.join(";"),
    "-map", "[vout]", "-map", "[aout]",
    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-r", String(tl.fps),
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
    "-t", String(D), "-movflags", "+faststart",
    "-progress", "pipe:1", "-nostats",
    outFile,
  );
  return args;
}

// Renders the timeline to "<out>/<Name> Edit Render v<N>.mp4". Never overwrites.
export function compose(tl, { out = "exports", version = 1, captions, onProgress } = {}) {
  // Default to the styled overlay only while it still matches the caption text.
  const cap = tl.tracks.find((t) => t.kind === "captions");
  const mode = captions ?? (cap?.overlayAbs && cap.overlayEnabled !== false && !cap.overlayStale ? "overlay" : "plain");
  if (!["overlay", "plain", "none"].includes(mode)) throw new Error("captions must be overlay, plain or none");
  const outFile = path.resolve(out, `${tl.name} Edit Render v${version}.mp4`);
  if (existsSync(outFile)) throw new Error(`${outFile} already exists; use version ${version + 1}`);
  mkdirSync(path.dirname(outFile), { recursive: true });

  const work = mkdtempSync(path.join(tmpdir(), "fw-compose-"));
  const subs = srt(tl);
  if (subs) writeFileSync(path.join(work, "captions.srt"), subs);
  const args = composeArgs(tl, { outFile, captions: mode });

  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegBin(), args, { cwd: work, windowsHide: true });
    let err = "";
    let buf = "";
    // Watchdog: FFmpeg reports progress every ~0.5 s; silence this long means it is stuck.
    let lastSign = Date.now();
    let stalled = false;
    const watchdog = setInterval(() => {
      if (Date.now() - lastSign > STALL_MS) {
        stalled = true;
        proc.kill();
      }
    }, 5000);
    proc.stdout.on("data", (d) => {
      lastSign = Date.now();
      buf += d;
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        const m = line.match(/^out_time_us=(\d+)/);
        if (m && onProgress) onProgress(Math.min(1, Number(m[1]) / 1e6 / tl.duration));
      }
    });
    proc.stderr.on("data", (d) => {
      err = (err + d).slice(-4000);
    });
    proc.on("error", (e) => reject(new Error(`FFmpeg not found (${e.message}). Install FFmpeg or set MVD_FFMPEG.`)));
    proc.on("close", (code) => {
      clearInterval(watchdog);
      rmSync(work, { recursive: true, force: true });
      if (code === 0) return resolve(outFile);
      if (existsSync(outFile)) rmSync(outFile, { force: true });
      reject(
        new Error(
          stalled
            ? `FFmpeg made no progress for ${STALL_MS / 60000} minutes and was stopped. Try again; if it repeats, export with captions "overlay" or "none".`
            : `FFmpeg exited ${code}:\n${err.trim()}`,
        ),
      );
    });
  });
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

if (process.argv[1]?.endsWith("fw-compose.mjs")) {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: node fw-compose.mjs <timeline.json> [--out exports] [--version 1] [--captions overlay|plain|none]");
    process.exit(2);
  }
  try {
    const tl = loadTimeline(file);
    let shown = -1;
    const outFile = await compose(tl, {
      out: arg("out", "exports"),
      version: Number(arg("version", "1")),
      captions: arg("captions"),
      onProgress: (p) => {
        const pct = Math.floor(p * 10) * 10;
        if (pct > shown) console.log(`${(shown = pct)}%`);
      },
    });
    console.log(`Wrote ${outFile}`);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
