#!/usr/bin/env node
// Framewright edit-package exporter. Zero dependencies (Node 18+, ffprobe on PATH or MVD_FFPROBE).
//
//   node fw-export.mjs validate <framewright.timeline.json>
//   node fw-export.mjs package  <framewright.timeline.json> [--out exports] [--version 1] [--link-media]
//
// Also imported as a module by fw-compose.mjs and the Framewright Companion's editor bridge.
//
// Reads a Framewright timeline and writes "<out>/<Name> Edit v<N>/" containing:
//   <Name>.fcpxml            Final Cut Pro and DaVinci Resolve
//   <Name> - Premiere.xml    Premiere Pro and DaVinci Resolve (FCP7 XML / xmeml v4)
//   <Name> - Captions.srt    caption text, editable in all three
//   Media/                   copies of every clip (unless --link-media)
//   README.txt               how to open it in each editor

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// ---------- time ----------

const RATES = { 23.976: [1001, 24000], 29.97: [1001, 30000], 59.94: [1001, 60000] };

export function rateOf(fps) {
  if (RATES[fps]) return { num: RATES[fps][0], den: RATES[fps][1], timebase: Math.round(fps), ntsc: true };
  if (Number.isInteger(fps) && fps > 0 && fps <= 120) return { num: 1, den: fps, timebase: fps, ntsc: false };
  throw new Error(`Unsupported fps ${fps}. Use 23.976, 24, 25, 29.97, 30, 50, 59.94 or 60.`);
}

// All timeline values snap to whole frames so every editor agrees on cut points.
export const toFrames = (sec, fps) => Math.round(sec * fps);
const fcpTime = (frames, r) => (frames === 0 ? "0s" : `${frames * r.num}/${r.den}s`);

// Stills have no length of their own; they are as long as the clip that uses them.
const STILL_FRAMES = 10 * 3600 * 60;
const mediaFrames = (info, fps) => (info.still ? STILL_FRAMES : Math.max(1, Math.floor(info.duration * fps + 1e-6)));

// A clip may never be longer than the whole frames left in its source after the in point.
export function clipFrames(c, tl) {
  const inF = toFrames(c.in, tl.fps);
  const len = Math.min(toFrames(c.duration, tl.fps), mediaFrames(tl.media.get(c.abs), tl.fps) - inF);
  return { inF, len: Math.max(1, len) };
}

// Effective level of a clip is its own gain plus its track's gain. Muted clips and tracks stay
// in the exported timeline, disabled, so editors can switch them back on.
export const clipGain = (c, t) => (c.gainDb ?? 0) + (t.gainDb ?? 0);
const hasLevels = (c, t) => c.gainDb !== undefined || t.gainDb !== undefined || c.fadeIn || c.fadeOut;
export const isEnabled = (c, t) => !c.muted && !t.muted;

// ---------- helpers ----------

const esc = (s) =>
  String(s).replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]);

function fileUrl(abs, { premiere = false } = {}) {
  const parts = path.resolve(abs).split(path.sep);
  const drive = /^[A-Za-z]:$/.test(parts[0]) ? parts.shift() : null;
  const encoded = parts.filter((p, i) => p !== "" || i > 0).map(encodeURIComponent).join("/");
  if (drive) return premiere ? `file://localhost/${drive[0]}%3a/${encoded}` : `file:///${drive}/${encoded}`;
  return premiere ? `file://localhost/${encoded}` : `file:///${encoded}`;
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

const ffprobeBin = () => process.env.MVD_FFPROBE || "ffprobe";
export const STILL_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"]);

export function probe(file) {
  const res = spawnSync(ffprobeBin(), ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", file], { encoding: "utf8" });
  if (res.error) throw new Error(`ffprobe not found (${res.error.message}). Install FFmpeg or set MVD_FFPROBE.`);
  if (res.status !== 0) throw new Error(`ffprobe failed on ${file}: ${res.stderr.trim()}`);
  const info = JSON.parse(res.stdout);
  const v = info.streams.find((s) => s.codec_type === "video" && s.disposition?.attached_pic !== 1);
  const a = info.streams.find((s) => s.codec_type === "audio");
  const still = STILL_EXT.has(path.extname(file).toLowerCase());
  return {
    still,
    duration: still ? 0 : Number(info.format.duration ?? v?.duration ?? a?.duration ?? 0),
    video: v ? { width: v.width, height: v.height, codec: v.codec_name, alpha: /yuva|rgba|argb|bgra|abgr|gbrap|ya/.test(v.pix_fmt ?? "") } : null,
    audio: a ? { rate: Number(a.sample_rate), channels: a.channels } : null,
  };
}

// ---------- timeline ----------

export class TimelineError extends Error {
  constructor(problems) {
    super(`Timeline has ${problems.length} problem(s):\n- ${problems.join("\n- ")}`);
    this.problems = problems;
  }
}

export function loadTimeline(file, opts) {
  return checkTimeline(JSON.parse(readFileSync(file, "utf8")), path.dirname(path.resolve(file)), opts);
}

// Validates a parsed timeline in place (resolves paths, fills defaults, attaches probe info) and
// returns it. `base` is the folder that relative src paths resolve against.
export function checkTimeline(tl, base, { probeCache } = {}) {
  const errors = [];
  if (tl.version !== 1) errors.push('"version" must be 1');
  if (!tl.name || /[\\/:*?"<>|]/.test(tl.name)) errors.push('"name" is required and must be a plain name (no path characters)');
  if (!(tl.width > 0 && tl.height > 0)) errors.push('"width" and "height" are required');
  try {
    rateOf(tl.fps);
  } catch (e) {
    errors.push(e.message);
  }
  if (!Array.isArray(tl.tracks) || !tl.tracks.length) throw new TimelineError([...errors, '"tracks" must be a non-empty array']);

  const media = new Map(); // absolute path -> probe info
  const need = (src, where) => {
    if (typeof src !== "string" || !src) return errors.push(`${where}: "src" is required`), null;
    const abs = path.resolve(base, src);
    if (!existsSync(abs)) return errors.push(`${where}: file not found: ${src}`), null;
    if (!media.has(abs)) {
      try {
        media.set(abs, probeCache ? probeCache(abs) : probe(abs));
      } catch (e) {
        errors.push(`${where}: ${e.message}`);
        return null;
      }
    }
    return abs;
  };

  let captionsSeen = 0;
  tl.tracks.forEach((t, ti) => {
    const where = `tracks[${ti}] "${t.name ?? t.kind}"`;
    if (!["video", "audio", "captions"].includes(t.kind)) return errors.push(`${where}: kind must be video, audio or captions`);
    if (t.kind === "captions") {
      captionsSeen++;
      if (!Array.isArray(t.cues)) errors.push(`${where}: "cues" array is required`);
      else
        t.cues.forEach((c, ci) => {
          if (!(c.end > c.start && c.start >= 0) || typeof c.text !== "string" || !c.text.trim()) {
            errors.push(`${where} cue ${ci}: needs start < end and non-empty text`);
          }
        });
      if (t.overlay) {
        t.overlayAbs = need(t.overlay, `${where} overlay`);
        const info = t.overlayAbs && media.get(t.overlayAbs);
        if (info && !info.video) errors.push(`${where}: overlay has no video stream`);
        if (info?.video && !info.video.alpha) {
          errors.push(`${where}: overlay must have transparency (render it with --alpha to a ProRes 4444 .mov)`);
        }
      }
      return;
    }
    if (!Array.isArray(t.clips)) return errors.push(`${where}: "clips" array is required`);
    t.clips.forEach((c, ci) => {
      const w = `${where} clip ${ci} "${c.name ?? c.src}"`;
      c.abs = need(c.src, w);
      if (!(c.start >= 0)) errors.push(`${w}: "start" (seconds on the timeline) is required`);
      c.in = c.in ?? 0;
      const info = c.abs && media.get(c.abs);
      if (!info) return;
      if (t.kind === "video" && !info.video) errors.push(`${w}: file has no video stream`);
      if (t.kind === "audio" && !info.audio) errors.push(`${w}: file has no audio stream`);
      if (info.still && t.kind !== "video") errors.push(`${w}: images belong on a video track`);
      c.duration = c.duration ?? (info.still ? 5 : info.duration - c.in);
      if (!(c.duration > 0)) errors.push(`${w}: duration must be positive`);
      if (!info.still && c.in + c.duration > info.duration + 0.05) {
        errors.push(`${w}: in (${c.in}s) + duration (${c.duration}s) exceeds the file length (${info.duration.toFixed(3)}s)`);
      }
    });
  });
  if (captionsSeen > 1) errors.push("Only one captions track is supported");
  if (errors.length) throw new TimelineError(errors);

  const ends = tl.tracks.flatMap((t) =>
    t.kind === "captions" ? t.cues.map((c) => c.end) : t.clips.map((c) => c.start + c.duration),
  );
  tl.duration = Math.max(tl.duration ?? 0, ...ends);
  tl.media = media;
  return tl;
}

// ---------- FCPXML (Final Cut Pro, DaVinci Resolve) ----------

function fcpxml(tl, resolveSrc) {
  const r = rateOf(tl.fps);
  const F = (s) => toFrames(s, tl.fps);
  const assets = new Map();
  for (const [abs, info] of tl.media) {
    const id = `a${assets.size + 1}`;
    assets.set(abs, { id, info });
  }
  const assetXml = [...assets].map(([abs, { id, info }]) => {
    const attrs = [
      `id="${id}"`,
      `name="${esc(path.basename(abs, path.extname(abs)))}"`,
      `src="${esc(fileUrl(resolveSrc(abs)))}"`,
      `start="0s"`,
      `duration="${info.still ? "0s" : fcpTime(mediaFrames(info, tl.fps), r)}"`,
      `hasVideo="${info.video ? 1 : 0}"`,
      info.video ? `format="r1"` : "",
      `hasAudio="${info.audio ? 1 : 0}"`,
      info.audio ? `audioSources="1" audioChannels="${info.audio.channels}" audioRate="${info.audio.rate}"` : "",
    ];
    return `    <asset ${attrs.filter(Boolean).join(" ")}/>`;
  });

  // FCPXML is magnetic: a gap spans the whole primary storyline and every clip is a
  // connected clip on its own lane, which maps cleanly from track-based timelines.
  const clips = [];
  const volume = (c, t) => {
    if (!hasLevels(c, t)) return "";
    const fades = [
      c.fadeIn ? `<fadeIn type="easeIn" duration="${fcpTime(F(c.fadeIn), r)}"/>` : "",
      c.fadeOut ? `<fadeOut type="easeOut" duration="${fcpTime(F(c.fadeOut), r)}"/>` : "",
    ].join("");
    const amount = `amount="${clipGain(c, t)}dB"`;
    return fades ? `<adjust-volume ${amount}><param name="amount">${fades}</param></adjust-volume>` : `<adjust-volume ${amount}/>`;
  };
  let videoLane = 0;
  let audioLane = 0;
  for (const t of tl.tracks) {
    if (t.kind === "captions") continue;
    const lane = t.kind === "video" ? ++videoLane : -++audioLane;
    for (const c of t.clips) {
      const a = assets.get(c.abs);
      const { inF, len } = clipFrames(c, tl);
      const role = t.kind === "audio" ? ` audioRole="${esc(t.role ?? (/(music|bgm)/i.test(t.name ?? "") ? "music" : /(sfx|effect)/i.test(t.name ?? "") ? "effects" : "dialogue"))}"` : "";
      const name = esc(c.name ?? path.basename(c.src));
      const enabled = isEnabled(c, t) ? "" : ' enabled="0"';
      const placed = `lane="${lane}" offset="${fcpTime(F(c.start), r)}" name="${name}"`;
      // Stills are wrapped in a <clip> holding a <video>, the way Final Cut itself exports them.
      clips.push(
        a.info.still
          ? `            <clip ${placed} start="0s" duration="${fcpTime(len, r)}"${enabled}><video ref="${a.id}" offset="0s" start="0s" duration="${fcpTime(len, r)}"/></clip>`
          : `            <asset-clip ref="${a.id}" ${placed} start="${fcpTime(inF, r)}" duration="${fcpTime(len, r)}"${enabled}${role}${t.kind === "video" ? ' tcFormat="NDF"' : ""}>${volume(c, t)}</asset-clip>`,
      );
    }
  }
  const cap = tl.tracks.find((t) => t.kind === "captions");
  if (cap?.overlayAbs && cap.overlayEnabled !== false && !cap.overlayStale) {
    const a = assets.get(cap.overlayAbs);
    const len = Math.min(mediaFrames(tl.media.get(cap.overlayAbs), tl.fps), F(tl.duration));
    clips.push(
      `            <asset-clip ref="${a.id}" lane="${videoLane + 1}" offset="0s" name="Captions overlay" start="0s" duration="${fcpTime(len, r)}"/>`,
    );
  }

  const total = fcpTime(F(tl.duration), r);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.9">
  <resources>
    <format id="r1" frameDuration="${fcpTime(1, r)}" width="${tl.width}" height="${tl.height}" colorSpace="1-1-1 (Rec. 709)"/>
${assetXml.join("\n")}
  </resources>
  <library>
    <event name="${esc(tl.name)}">
      <project name="${esc(tl.name)}">
        <sequence format="r1" duration="${total}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">
          <spine>
            <gap name="Gap" offset="0s" start="0s" duration="${total}">
${clips.join("\n")}
            </gap>
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
`;
}

// ---------- Premiere XML / xmeml v4 (Premiere Pro, DaVinci Resolve) ----------

function xmeml(tl, resolveSrc) {
  const r = rateOf(tl.fps);
  const F = (s) => toFrames(s, tl.fps);
  const rate = `<rate><timebase>${r.timebase}</timebase><ntsc>${r.ntsc ? "TRUE" : "FALSE"}</ntsc></rate>`;
  const fileIds = new Map();
  let clipN = 0;

  const fileXml = (abs) => {
    if (fileIds.has(abs)) return `<file id="${fileIds.get(abs)}"/>`;
    const id = `file-${fileIds.size + 1}`;
    fileIds.set(abs, id);
    const info = tl.media.get(abs);
    const v = info.video
      ? `<video><samplecharacteristics>${rate}<width>${info.video.width}</width><height>${info.video.height}</height></samplecharacteristics></video>`
      : "";
    const a = info.audio
      ? `<audio><samplecharacteristics><depth>16</depth><samplerate>${info.audio.rate}</samplerate></samplecharacteristics><channelcount>${info.audio.channels}</channelcount></audio>`
      : "";
    return `<file id="${id}"><name>${esc(path.basename(abs))}</name><pathurl>${esc(fileUrl(resolveSrc(abs), { premiere: true }))}</pathurl>${rate}<duration>${mediaFrames(info, tl.fps)}</duration><media>${v}${a}</media></file>`;
  };

  const levels = (c, t, inF, outF) => {
    if (!hasLevels(c, t)) return "";
    const lin = (db) => Math.pow(10, db / 20).toFixed(6);
    const g = lin(clipGain(c, t));
    // Keyframe times are in source frames, between the clip's in and out points.
    const kf = [];
    if (c.fadeIn) kf.push([inF, lin(-96)], [inF + F(c.fadeIn), g]);
    if (c.fadeOut) kf.push([outF - F(c.fadeOut), g], [outF, lin(-96)]);
    const keys = kf.map(([w, v]) => `<keyframe><when>${w}</when><value>${v}</value></keyframe>`).join("");
    return `<filter><effect><name>Audio Levels</name><effectid>audiolevels</effectid><effectcategory>audiolevels</effectcategory><effecttype>audiolevels</effecttype><mediatype>audio</mediatype><parameter authoringApp="PremierePro"><parameterid>level</parameterid><name>Level</name><valuemin>0</valuemin><valuemax>3.98109</valuemax><value>${g}</value>${keys}</parameter></effect></filter>`;
  };

  const clipitem = (c, t, kind, extra = "") => {
    const info = tl.media.get(c.abs);
    const { inF, len } = clipFrames(c, tl);
    const outF = inF + len;
    const start = F(c.start);
    const src = kind === "audio" ? `<sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>` : "";
    const still = info.still ? "<stillframe>TRUE</stillframe>" : "";
    return `<clipitem id="clipitem-${++clipN}"><name>${esc(c.name ?? path.basename(c.src))}</name><enabled>${isEnabled(c, t) ? "TRUE" : "FALSE"}</enabled><duration>${mediaFrames(info, tl.fps)}</duration>${rate}<start>${start}</start><end>${start + len}</end><in>${inF}</in><out>${outF}</out>${still}${extra}${fileXml(c.abs)}${src}${kind === "audio" ? levels(c, t, inF, outF) : ""}</clipitem>`;
  };

  const videoTracks = tl.tracks
    .filter((t) => t.kind === "video")
    .map((t) => `<track>${t.clips.map((c) => clipitem(c, t, "video")).join("")}<enabled>TRUE</enabled><locked>FALSE</locked></track>`);
  const cap = tl.tracks.find((t) => t.kind === "captions");
  if (cap?.overlayAbs && cap.overlayEnabled !== false && !cap.overlayStale) {
    const dur = Math.min(tl.media.get(cap.overlayAbs).duration, tl.duration);
    const c = { abs: cap.overlayAbs, src: cap.overlay, name: "Captions overlay", start: 0, in: 0, duration: dur };
    videoTracks.push(`<track>${clipitem(c, cap, "video", "<alphatype>straight</alphatype>")}<enabled>TRUE</enabled><locked>FALSE</locked></track>`);
  }
  const audioTracks = tl.tracks
    .filter((t) => t.kind === "audio")
    .map((t) => `<track>${t.clips.map((c) => clipitem(c, t, "audio")).join("")}<enabled>TRUE</enabled><locked>FALSE</locked></track>`);

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="4">
<sequence id="sequence-1">
<name>${esc(tl.name)}</name>
<duration>${F(tl.duration)}</duration>
${rate}
<timecode>${rate}<string>00:00:00:00</string><frame>0</frame><displayformat>NDF</displayformat></timecode>
<media>
<video>
<format><samplecharacteristics>${rate}<width>${tl.width}</width><height>${tl.height}</height><pixelaspectratio>square</pixelaspectratio><fielddominance>none</fielddominance></samplecharacteristics></format>
${videoTracks.join("\n")}
</video>
<audio>
<numOutputChannels>2</numOutputChannels>
<format><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics></format>
${audioTracks.join("\n")}
</audio>
</media>
</sequence>
</xmeml>
`;
}

// ---------- SRT ----------

export function srt(tl) {
  const cap = tl.tracks.find((t) => t.kind === "captions");
  if (!cap || !cap.cues.length) return null;
  const ts = (s) => {
    const ms = Math.round(s * 1000);
    const p = (n, w = 2) => String(n).padStart(w, "0");
    return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
  };
  return (
    [...cap.cues]
      .sort((a, b) => a.start - b.start)
      .map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${c.text.trim()}\n`)
      .join("\n") + "\n"
  );
}

function readme(tl, files) {
  const cap = tl.tracks.find((t) => t.kind === "captions");
  const hasOverlay = Boolean(cap?.overlayAbs && cap.overlayEnabled !== false && !cap.overlayStale);
  return `${tl.name} — editable project
${"=".repeat(tl.name.length + 22)}
${tl.width}x${tl.height} · ${tl.fps} fps · ${tl.duration.toFixed(2)} s

Keep this folder where it is after opening, or relink media to the Media folder if you move it.

PREMIERE PRO
  File > Import > "${files.xml}". Open the imported sequence.
${files.srt ? `  Captions as editable text: File > Import > "${files.srt}", then drag it onto the sequence.\n` : ""}
DAVINCI RESOLVE
  File > Import > Timeline > "${files.fcpxml}" (or the Premiere .xml). When asked, untick
  "Automatically import source clips into media pool" only if you have already imported the Media folder.
${files.srt ? `  Captions as editable text: import "${files.srt}" into the Media Pool and drag it onto the timeline (subtitle track).\n` : ""}
FINAL CUT PRO
  File > Import > XML > "${files.fcpxml}".
${files.srt ? `  Captions as editable text: select the project, File > Import > Captions > "${files.srt}".\n` : ""}
CAPTIONS
${
  hasOverlay
    ? `  The top video track "Captions overlay" is the styled, animated captions with transparency.
  Use it for the exact designed look, or disable it and use the .srt for retypeable captions.`
    : "  Only the .srt caption file is included."
}

Scene clips are rendered motion graphics: trim, reorder, retime and replace them freely.
Voice, music and sound effects are on separate audio tracks with their levels set.
Muted clips are included but switched off.
`;
}

// ---------- package ----------

export const trackSummary = (tl) =>
  tl.tracks.map((t) => `${t.name ?? t.kind}: ${t.kind === "captions" ? `${t.cues.length} cues${t.overlayAbs ? " + overlay" : ""}` : `${t.clips.length} clips`}`);

// Writes "<out>/<Name> Edit v<version>/" and returns its path. Never overwrites.
export function writePackage(tl, { out = "exports", version = 1, linkMedia = false } = {}) {
  if (!Number.isInteger(version) || version < 1) throw new Error("version must be a positive whole number");
  const outDir = path.resolve(out, `${tl.name} Edit v${version}`);
  if (existsSync(outDir)) throw new Error(`${outDir} already exists; use version ${version + 1}`);
  mkdirSync(outDir, { recursive: true });

  const copied = new Map();
  if (!linkMedia) {
    const mediaDir = path.join(outDir, "Media");
    mkdirSync(mediaDir);
    const used = new Set();
    for (const abs of tl.media.keys()) {
      let name = path.basename(abs);
      for (let n = 2; used.has(name.toLowerCase()); n++) name = `${path.basename(abs, path.extname(abs))} ${n}${path.extname(abs)}`;
      used.add(name.toLowerCase());
      copyFileSync(abs, path.join(mediaDir, name));
      copied.set(abs, path.join(mediaDir, name));
    }
  }
  const resolveSrc = (abs) => copied.get(abs) ?? abs;

  const files = { fcpxml: `${tl.name}.fcpxml`, xml: `${tl.name} - Premiere.xml`, srt: null };
  writeFileSync(path.join(outDir, files.fcpxml), fcpxml(tl, resolveSrc));
  writeFileSync(path.join(outDir, files.xml), xmeml(tl, resolveSrc));
  const subs = srt(tl);
  if (subs) {
    files.srt = `${tl.name} - Captions.srt`;
    writeFileSync(path.join(outDir, files.srt), subs);
  }
  writeFileSync(path.join(outDir, "README.txt"), readme(tl, files));
  return outDir;
}

// ---------- CLI ----------

function main() {
  const [cmd, file] = process.argv.slice(2);
  if (!["validate", "package"].includes(cmd) || !file) {
    console.error("Usage:\n  node fw-export.mjs validate <timeline.json>\n  node fw-export.mjs package <timeline.json> [--out exports] [--version 1] [--link-media]");
    process.exit(2);
  }
  const tl = loadTimeline(file);
  const counts = trackSummary(tl);
  if (cmd === "validate") {
    console.log(`OK: ${tl.name}, ${tl.duration.toFixed(2)} s, ${tl.media.size} media files\n  ${counts.join("\n  ")}`);
    return;
  }
  const outDir = writePackage(tl, {
    out: arg("out", "exports"),
    version: Number(arg("version", "1")),
    linkMedia: process.argv.includes("--link-media"),
  });
  console.log(`Wrote ${outDir}\n  ${counts.join("\n  ")}`);
}

if (process.argv[1]?.endsWith("fw-export.mjs")) {
  try {
    main();
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
