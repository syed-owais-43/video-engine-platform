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
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { clipGain, isEnabled, loadTimeline, srt } from "./fw-export.mjs";

const ffmpegBin = () => process.env.MVD_FFMPEG || "ffmpeg";

// Plain captions are drawn with drawtext and an explicit font file. (The subtitles/libass route
// relies on fontconfig, which can stall for minutes scanning system fonts on some Windows builds.)
const FONT_CANDIDATES = [
  process.env.FW_CAPTION_FONT,
  "C:/Windows/Fonts/arialbd.ttf",
  "C:/Windows/Fonts/segoeuib.ttf",
  "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
  "/Library/Fonts/Arial Bold.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
].filter(Boolean);
const findCaptionFont = () => FONT_CANDIDATES.find((f) => existsSync(f)) ?? null;
const STALL_MS = 60 * 1000;
const n = (x) => Number(x.toFixed(4));

// Export runs in three FFmpeg passes: (1) the audio mix to a WAV, (2) the picture with no audio,
// (3) both muxed together without re-encoding the video. Keeping audio and picture apart means a
// problem in one can't stall the other, and each pass has its own stall watchdog.
// Builders are separate from running them so they can be tested.

// Pass 1: every enabled audio clip, with gain, fades and timing, mixed into one stereo WAV.
export function composeAudioArgs(tl, { wavFile }) {
  const D = n(tl.duration);
  const args = ["-hide_banner", "-y", "-nostdin"];
  const filters = [];
  const audio = [];
  let inputs = 0;
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
  // Mix over a silent bed of exactly the timeline's length (duration=first). Padding with apad and
  // cutting with atrim instead makes FFmpeg 9 hang at the end about half the time.
  filters.push(`anullsrc=r=48000:cl=stereo:d=${D}[bed]`);
  filters.push(`[bed]${audio.join("")}amix=inputs=${audio.length + 1}:normalize=0:duration=first[aout]`);
  args.push("-filter_complex", filters.join(";"), "-map", "[aout]", "-c:a", "pcm_s16le", "-ar", "48000", "-t", String(D), "-progress", "pipe:1", "-nostats", wavFile);
  return args;
}

// Pass 2: the picture, silent. `safe` decodes each input and runs the graph single-threaded; it is
// only used for the automatic retry if a pass stalls.
export function composeArgs(tl, { outFile, captions = "overlay", srtName = "captions.srt", fontFile = null, safe = false }) {
  const W = tl.width;
  const H = tl.height;
  const D = n(tl.duration);
  const args = ["-hide_banner", "-y", "-nostdin", ...(safe ? ["-filter_complex_threads", "1"] : [])];
  const input = (...opts) => args.push(...(safe ? ["-threads", "1"] : []), ...opts);
  const filters = [`color=c=black:s=${W}x${H}:r=${tl.fps}:d=${D}[base]`];
  let inputs = 0;
  let last = "base";

  const addVisual = (abs, info, { start, inPoint, duration }) => {
    if (info.still) input("-loop", "1", "-framerate", String(tl.fps), "-t", String(n(duration)), "-i", abs);
    else input("-ss", String(n(inPoint)), "-t", String(n(duration)), "-i", abs);
    const i = inputs++;
    // Fit inside the frame, keep transparency, and shift the clip to its timeline position.
    filters.push(
      `[${i}:v]fps=${tl.fps},scale=${W}:${H}:force_original_aspect_ratio=decrease,format=yuva420p,` +
        `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black@0,setpts=PTS-STARTPTS` +
        // Lead-in of transparent frames instead of a timestamp offset: every input then produces frames
        // from 0:00 at the same pace, so no input sits far ahead filling its queue (which stalls FFmpeg).
        (start > 0 ? `,tpad=start_duration=${n(start)}:color=black@0` : "") +
        `[v${i}]`,
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
    } else if (captions === "plain" && cap.cues.length && fontFile) {
      // Each cue's text lives in cueN.txt and the font in the working folder (FFmpeg runs there),
      // so no text or path escaping is needed in the filter graph.
      const size = Math.round((H * 18) / 288);
      const margin = Math.round((H * 22) / 288);
      const border = Math.max(2, Math.round(size / 9));
      const draws = [...cap.cues]
        .sort((a, b) => a.start - b.start)
        .map(
          (c, i) =>
            `drawtext=fontfile=${fontFile}:textfile=cue${i}.txt:fontcolor=white:fontsize=${size}:borderw=${border}:bordercolor=black:` +
            `line_spacing=${Math.round(size * 0.15)}:x=(w-text_w)/2:y=h-${margin}-text_h:enable='between(t,${n(c.start)},${n(c.end)})'`,
        );
      filters.push(`[${last}]${draws.join(",")}[subs]`);
      last = "subs";
    } else if (captions === "plain" && cap.cues.length) {
      // No known font file on this system: fall back to libass. Sizes are in a 288-line script space.
      filters.push(
        `[${last}]subtitles=${srtName}:force_style='Fontname=Arial,Fontsize=18,Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=1.5,Shadow=0,Alignment=2,MarginV=22'[subs]`,
      );
      last = "subs";
    }
  }
  filters.push(`[${last}]format=yuv420p[vout]`);

  args.push(
    "-filter_complex", filters.join(";"),
    "-map", "[vout]", "-an",
    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-r", String(tl.fps),
    "-t", String(D),
    "-progress", "pipe:1", "-nostats",
    outFile,
  );
  return args;
}

// Renders the timeline to "<out>/<Name> Edit Render v<N>.mp4". Never overwrites.
// Pass 3: copy the video stream, encode the WAV to AAC.
export function muxArgs(tl, { videoFile, wavFile, outFile }) {
  return [
    "-hide_banner", "-y", "-nostdin", "-i", videoFile, "-i", wavFile,
    "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
    "-t", String(n(tl.duration)), "-movflags", "+faststart", "-progress", "pipe:1", "-nostats", outFile,
  ];
}

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
  let fontFile = null;
  const capTrack = tl.tracks.find((t) => t.kind === "captions");
  const font = mode === "plain" ? findCaptionFont() : null;
  if (font && capTrack) {
    copyFileSync(font, path.join(work, "font.ttf"));
    fontFile = "font.ttf";
    [...capTrack.cues].sort((a, b) => a.start - b.start).forEach((c, i) => writeFileSync(path.join(work, `cue${i}.txt`), c.text.trim()));
  }
  const wavFile = path.join(work, "mix.wav");
  const silent = path.join(work, "video.mp4");
  const video = (safe) =>
    runFfmpeg(composeArgs(tl, { outFile: silent, captions: mode, fontFile, safe }), {
      cwd: work,
      outFile: silent,
      duration: tl.duration,
      onProgress: onProgress && ((p) => onProgress(0.1 + 0.85 * p)),
    });
  const mux = muxArgs(tl, { videoFile: silent, wavFile, outFile });
  return runFfmpeg(composeAudioArgs(tl, { wavFile }), { cwd: work, outFile: wavFile, duration: tl.duration })
    .then(() => {
      onProgress?.(0.1);
      return video(false).catch((e) => {
        if (!(e instanceof StallError)) throw e;
        return video(true); // one retry, fully single-threaded
      });
    })
    .then(() => runFfmpeg(mux, { cwd: work, outFile, duration: tl.duration }))
    .then(() => {
      onProgress?.(1);
      return outFile;
    })
    .finally(() => rmSync(work, { recursive: true, force: true }));
}

class StallError extends Error {}

function runFfmpeg(args, { cwd, outFile, duration, onProgress }) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegBin(), args, { cwd, windowsHide: true });
    let err = "";
    let buf = "";
    // Watchdog: FFmpeg keeps printing progress reports even when frozen, so track whether the
    // encoded time actually advances.
    let lastSign = Date.now();
    let lastTime = -1;
    let stalled = false;
    const watchdog = setInterval(() => {
      if (Date.now() - lastSign > STALL_MS) {
        stalled = true;
        proc.kill();
      }
    }, 5000);
    proc.stdout.on("data", (d) => {
      buf += d;
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        const m = line.match(/^out_time_us=(\d+)/);
        if (!m) continue;
        const t = Number(m[1]);
        if (t > lastTime) {
          lastTime = t;
          lastSign = Date.now();
        }
        onProgress?.(Math.min(1, t / 1e6 / duration));
      }
    });
    proc.stderr.on("data", (d) => {
      err = (err + d).slice(-4000);
    });
    proc.on("error", (e) => reject(new Error(`FFmpeg not found (${e.message}). Install FFmpeg or set MVD_FFMPEG.`)));
    proc.on("close", (code) => {
      clearInterval(watchdog);
      if (code === 0) return resolve(outFile);
      if (existsSync(outFile)) rmSync(outFile, { force: true });
      reject(stalled ? new StallError(`FFmpeg made no progress for ${STALL_MS / 1000} seconds and was stopped.`) : new Error(`FFmpeg exited ${code}:\n${err.trim()}`));
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
