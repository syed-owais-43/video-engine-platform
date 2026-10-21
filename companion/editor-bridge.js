// Editor bridge: a loopback HTTP server that lets the Framewright web editor (on the
// Framewright site) read and edit timeline projects on this computer. Nothing is uploaded
// anywhere: the browser talks straight to 127.0.0.1.
//
// Security: binds to 127.0.0.1 only, checks the Host header (DNS rebinding), only answers CORS
// requests from the Framewright site, and every call needs the random pairing token that is
// handed to the browser in the URL fragment (never sent to the website).

import { exec, execFile } from "node:child_process";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { checkTimeline, probe, TimelineError, writePackage } from "./vendor/fw-export.mjs";
import { compose } from "./vendor/fw-compose.mjs";

const TIMELINE = "framewright.timeline.json";
const REQUESTS = "framewright.requests.json";
const HISTORY_KEEP = 50;
const SKIP_DIRS = new Set(["node_modules", ".git", ".framewright", "exports", "cache", ".next"]);
const MEDIA_EXT = {
  ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".m4v": "video/mp4", ".mkv": "video/x-matroska",
  ".wav": "audio/wav", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".aac": "audio/aac", ".ogg": "audio/ogg", ".flac": "audio/flac",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".bmp": "image/bmp",
};

const inside = (root, p) => {
  const rel = relative(root, p);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export function openInBrowser(url) {
  const cmd = process.platform === "win32" ? `start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

export async function startEditorBridge({ root, site, port = 7717 }) {
  if (!site) throw new Error("FRAMEWRIGHT_URL (the Framewright site address) is required for the editor.");
  const siteOrigin = new URL(site).origin;
  const token = randomBytes(24).toString("base64url");
  root = resolve(root);

  const probeCache = new Map();
  const cachedProbe = (abs) => {
    const m = statSync(abs).mtimeMs;
    const hit = probeCache.get(abs);
    if (hit && hit.m === m) return hit.info;
    const info = probe(abs);
    probeCache.set(abs, { m, info });
    return info;
  };

  const jobs = new Map();

  // Browsers can't decode ProRes (used for transparent clips) and most MOV variants, so the
  // preview gets a VP9 WebM copy, keeping transparency. Exports always use the originals.
  const BROWSER_SAFE = new Set(["h264", "vp8", "vp9", "av1"]);
  const proxies = new Map(); // cache path -> Promise<string>
  function previewFile(dir, abs) {
    const info = cachedProbe(abs);
    const v = info.video;
    if (!v || info.still) return abs;
    if (BROWSER_SAFE.has(v.codec) && !v.alpha && /\.(mp4|webm|m4v)$/i.test(abs)) return abs;
    const key = createHash("sha1").update(`${abs}:${statSync(abs).mtimeMs}`).digest("hex").slice(0, 16);
    const out = join(dir, ".framewright", "proxies", `${key}.webm`);
    if (existsSync(out)) return out;
    if (!proxies.has(out)) {
      mkdirSync(dirname(out), { recursive: true });
      const tmp = `${out}.part.webm`;
      const args = [
        "-hide_banner", "-y", "-nostdin", "-i", abs,
        "-vf", "scale='min(1280,iw)':-2",
        "-c:v", "libvpx-vp9", "-pix_fmt", v.alpha ? "yuva420p" : "yuv420p",
        "-b:v", "0", "-crf", "36", "-deadline", "realtime", "-cpu-used", "8", "-row-mt", "1",
        ...(v.alpha ? ["-auto-alt-ref", "0"] : []),
        "-an", tmp,
      ];
      proxies.set(
        out,
        new Promise((ok, fail) => {
          execFile(process.env.MVD_FFMPEG || "ffmpeg", args, { windowsHide: true, maxBuffer: 1 << 20 }, (err) => {
            if (err) {
              proxies.delete(out);
              return fail(new HttpError(500, `Couldn't make a preview of ${basename(abs)}: ${err.message.split("\n").pop()}`));
            }
            renameSync(tmp, out);
            ok(out);
          });
        }),
      );
    }
    return proxies.get(out);
  }

  // ---------- projects ----------

  function listProjects() {
    const found = [];
    const walk = (dir, depth) => {
      if (existsSync(join(dir, TIMELINE))) {
        const tlPath = join(dir, TIMELINE);
        let name = basename(dir);
        try {
          name = JSON.parse(readFileSync(tlPath, "utf8")).name || name;
        } catch {}
        found.push({ id: relative(root, dir).split(sep).join("/") || ".", name, path: dir, mtime: statSync(tlPath).mtimeMs });
      }
      if (depth >= 3) return;
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) walk(join(dir, e.name), depth + 1);
      }
    };
    walk(root, 0);
    return found.sort((a, b) => b.mtime - a.mtime);
  }

  function projectDir(id) {
    if (typeof id !== "string" || !id) throw new HttpError(400, "Missing project");
    const dir = resolve(root, id);
    if (!inside(root, dir) || !existsSync(join(dir, TIMELINE))) throw new HttpError(404, "Project not found");
    return dir;
  }

  function mediaInfoFor(dir, timeline) {
    const out = {};
    const add = (src) => {
      if (typeof src !== "string" || src in out) return;
      const abs = resolve(dir, src);
      try {
        out[src] = inside(dir, abs) && existsSync(abs) ? cachedProbe(abs) : null;
      } catch {
        out[src] = null;
      }
    };
    for (const t of timeline.tracks ?? []) {
      if (t.kind === "captions") add(t.overlay);
      else for (const c of t.clips ?? []) add(c.src);
    }
    return out;
  }

  const readRequests = (dir) => {
    try {
      return JSON.parse(readFileSync(join(dir, REQUESTS), "utf8")).requests ?? [];
    } catch {
      return [];
    }
  };
  const writeRequests = (dir, requests) =>
    writeFileSync(join(dir, REQUESTS), JSON.stringify({ version: 1, requests }, null, 2) + "\n");

  function saveTimeline(dir, timeline, baseMtime, force) {
    const tlPath = join(dir, TIMELINE);
    const current = statSync(tlPath).mtimeMs;
    if (!force && baseMtime && Math.abs(current - baseMtime) > 1) {
      throw new HttpError(409, "The project changed on disk (probably your AI re-rendered it). Reload to see the new version.");
    }
    // Validate a copy: checkTimeline annotates the object it checks.
    try {
      checkTimeline(structuredClone(timeline), dir, { probeCache: cachedProbe });
    } catch (e) {
      if (e instanceof TimelineError) throw new HttpError(422, "Timeline is invalid", { problems: e.problems });
      throw e;
    }
    const hist = join(dir, ".framewright", "history");
    mkdirSync(hist, { recursive: true });
    writeFileSync(join(hist, `timeline-${new Date().toISOString().replace(/[:.]/g, "-")}.json`), readFileSync(tlPath));
    const old = readdirSync(hist).filter((f) => f.startsWith("timeline-")).sort();
    for (const f of old.slice(0, Math.max(0, old.length - HISTORY_KEEP))) unlinkSync(join(hist, f));
    const tmp = `${tlPath}.tmp`;
    writeFileSync(tmp, JSON.stringify(timeline, null, 2) + "\n");
    renameSync(tmp, tlPath);
    return statSync(tlPath).mtimeMs;
  }

  function loadForExport(dir) {
    try {
      return checkTimeline(JSON.parse(readFileSync(join(dir, TIMELINE), "utf8")), dir, { probeCache: cachedProbe });
    } catch (e) {
      if (e instanceof TimelineError) throw new HttpError(422, "Timeline is invalid", { problems: e.problems });
      throw e;
    }
  }

  function nextVersion(dir, re) {
    if (!existsSync(dir)) return 1;
    let max = 0;
    for (const f of readdirSync(dir)) {
      const m = f.match(re);
      if (m) max = Math.max(max, Number(m[1]));
    }
    return max + 1;
  }
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  function startJob(kind, run) {
    const id = randomBytes(6).toString("hex");
    const job = { id, kind, status: "running", progress: 0, output: null, error: null, startedAt: Date.now() };
    jobs.set(id, job);
    Promise.resolve()
      .then(() => run((p) => (job.progress = p)))
      .then((output) => Object.assign(job, { status: "done", progress: 1, output }))
      .catch((e) => Object.assign(job, { status: "error", error: e.problems ? e.problems.join("\n") : e.message }));
    return job;
  }

  function listAssets(dir) {
    const out = [];
    const walk = (d, depth) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (out.length > 1000) return;
        const full = join(d, e.name);
        if (e.isDirectory()) {
          if (depth < 4 && !SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) walk(full, depth + 1);
        } else if (MEDIA_EXT[extname(e.name).toLowerCase()]) {
          out.push({ src: relative(dir, full).split(sep).join("/"), size: statSync(full).size });
        }
      }
    };
    for (const sub of ["assets", "renders"]) if (existsSync(join(dir, sub))) walk(join(dir, sub), 0);
    return out;
  }

  // ---------- http ----------

  const json = (res, status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  const readBody = (req, limit = 20 * 1024 * 1024) =>
    new Promise((ok, fail) => {
      const chunks = [];
      let size = 0;
      req.on("data", (c) => {
        size += c.length;
        if (size > limit) {
          fail(new HttpError(413, "Request too large"));
          req.destroy();
        } else chunks.push(c);
      });
      req.on("end", () => ok(Buffer.concat(chunks)));
      req.on("error", fail);
    });

  function authorised(req, url) {
    const header = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    const given = Buffer.from(header ?? url.searchParams.get("token") ?? "");
    const expected = Buffer.from(token);
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  function serveFile(req, res, abs) {
    const size = statSync(abs).size;
    const type = MEDIA_EXT[extname(abs).toLowerCase()] ?? "application/octet-stream";
    const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
    if (range && (range[1] || range[2])) {
      let start = range[1] ? Number(range[1]) : size - Number(range[2]);
      let end = range[1] && range[2] ? Number(range[2]) : size - 1;
      start = Math.max(0, start);
      end = Math.min(size - 1, end);
      if (start > end) {
        res.writeHead(416, { "content-range": `bytes */${size}` });
        return res.end();
      }
      res.writeHead(206, { "content-type": type, "content-length": end - start + 1, "content-range": `bytes ${start}-${end}/${size}`, "accept-ranges": "bytes" });
      return createReadStream(abs, { start, end }).pipe(res);
    }
    res.writeHead(200, { "content-type": type, "content-length": size, "accept-ranges": "bytes" });
    createReadStream(abs).pipe(res);
  }

  async function route(req, res, url) {
    const p = url.searchParams.get("p");
    const path = url.pathname;

    if (path === "/api/hello" && req.method === "GET") return json(res, 200, { app: "framewright-companion", root });
    if (path === "/api/projects" && req.method === "GET") return json(res, 200, { projects: listProjects() });

    if (path === "/api/project") {
      const dir = projectDir(p);
      if (req.method === "GET") {
        const tlPath = join(dir, TIMELINE);
        const timeline = JSON.parse(readFileSync(tlPath, "utf8"));
        return json(res, 200, { timeline, mtime: statSync(tlPath).mtimeMs, media: mediaInfoFor(dir, timeline), requests: readRequests(dir), dir });
      }
      if (req.method === "PUT") {
        const body = JSON.parse((await readBody(req)).toString("utf8"));
        const mtime = saveTimeline(dir, body.timeline, body.baseMtime, body.force === true);
        return json(res, 200, { mtime, media: mediaInfoFor(dir, body.timeline) });
      }
    }

    if (path === "/api/mtime" && req.method === "GET") {
      const dir = projectDir(p);
      return json(res, 200, { mtime: statSync(join(dir, TIMELINE)).mtimeMs, requests: readRequests(dir) });
    }

    if (path === "/media" && req.method === "GET") {
      const dir = projectDir(p);
      const abs = resolve(dir, url.searchParams.get("src") ?? "");
      if (!inside(dir, abs) || !existsSync(abs) || !statSync(abs).isFile()) throw new HttpError(404, "Not found");
      return serveFile(req, res, url.searchParams.get("preview") === "1" ? await previewFile(dir, abs) : abs);
    }

    if (path === "/api/assets" && req.method === "GET") return json(res, 200, { assets: listAssets(projectDir(p)) });

    if (path === "/api/upload" && req.method === "POST") {
      const dir = projectDir(p);
      const raw = basename(url.searchParams.get("name") ?? "");
      const ext = extname(raw).toLowerCase();
      if (!MEDIA_EXT[ext]) throw new HttpError(415, "Only video, audio and image files can be added");
      const stem = basename(raw, extname(raw)).replace(/[^\w .()-]+/g, "_").slice(0, 80) || "media";
      const destDir = join(dir, "assets", "imported");
      mkdirSync(destDir, { recursive: true });
      let name = `${stem}${ext}`;
      for (let i = 2; existsSync(join(destDir, name)); i++) name = `${stem} ${i}${ext}`;
      const dest = join(destDir, name);
      await new Promise((ok, fail) => {
        const out = createWriteStream(dest);
        req.pipe(out);
        out.on("finish", ok);
        out.on("error", fail);
        req.on("error", fail);
      });
      const src = relative(dir, dest).split(sep).join("/");
      let info;
      try {
        info = cachedProbe(dest);
      } catch (e) {
        unlinkSync(dest);
        throw new HttpError(422, `Couldn't read that file: ${e.message}`);
      }
      return json(res, 200, { src, info });
    }

    if (path === "/api/requests") {
      const dir = projectDir(p);
      if (req.method === "POST") {
        const b = JSON.parse((await readBody(req, 100_000)).toString("utf8"));
        const textIn = String(b.text ?? "").trim().slice(0, 2000);
        if (!textIn) throw new HttpError(400, "Describe the change");
        const requests = readRequests(dir);
        const r = {
          id: randomBytes(4).toString("hex"),
          createdAt: new Date().toISOString(),
          status: "open",
          clipId: b.clipId ?? null,
          clipName: b.clipName ?? null,
          src: b.src ?? null,
          trackName: b.trackName ?? null,
          at: typeof b.at === "number" ? Math.round(b.at * 1000) / 1000 : null,
          text: textIn,
        };
        requests.push(r);
        writeRequests(dir, requests);
        return json(res, 200, { requests });
      }
      if (req.method === "DELETE") {
        const requests = readRequests(dir).filter((r) => r.id !== url.searchParams.get("id"));
        writeRequests(dir, requests);
        return json(res, 200, { requests });
      }
    }

    if (path === "/api/render" && req.method === "POST") {
      const dir = projectDir(p);
      const b = JSON.parse((await readBody(req, 10_000)).toString("utf8") || "{}");
      const tl = loadForExport(dir);
      const out = join(dir, "exports");
      const version = nextVersion(out, new RegExp(`^${escRe(tl.name)} Edit Render v(\\d+)\\.mp4$`));
      const job = startJob("render", (onProgress) => compose(tl, { out, version, captions: b.captions, onProgress }));
      return json(res, 202, { job });
    }

    if (path === "/api/export-package" && req.method === "POST") {
      const dir = projectDir(p);
      const tl = loadForExport(dir);
      const out = join(dir, "exports");
      const version = nextVersion(out, new RegExp(`^${escRe(tl.name)} Edit v(\\d+)$`));
      const job = startJob("package", () => writePackage(tl, { out, version }));
      return json(res, 202, { job });
    }

    const jobMatch = path.match(/^\/api\/jobs\/([a-f0-9]+)$/);
    if (jobMatch && req.method === "GET") {
      const job = jobs.get(jobMatch[1]);
      if (!job) throw new HttpError(404, "No such job");
      return json(res, 200, { job });
    }

    if (path === "/api/reveal" && req.method === "POST") {
      const b = JSON.parse((await readBody(req, 10_000)).toString("utf8"));
      const target = resolve(String(b.path ?? ""));
      if (!inside(root, target) || !existsSync(target)) throw new HttpError(404, "Not found");
      const cmd =
        process.platform === "win32"
          ? `explorer /select,"${target}"`
          : process.platform === "darwin"
            ? `open -R "${target}"`
            : `xdg-open "${dirname(target)}"`;
      exec(cmd, () => {});
      return json(res, 200, { ok: true });
    }

    throw new HttpError(404, "Not found");
  }

  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    const allowed = origin === siteOrigin;
    if (allowed) {
      res.setHeader("access-control-allow-origin", siteOrigin);
      res.setHeader("vary", "origin");
      res.setHeader("access-control-allow-headers", "authorization, content-type");
      res.setHeader("access-control-allow-methods", "GET, POST, PUT, DELETE, OPTIONS");
      res.setHeader("access-control-expose-headers", "content-range, content-length");
      res.setHeader("access-control-allow-private-network", "true");
    }
    // DNS rebinding guard: only answer requests addressed to the loopback interface.
    const host = (req.headers.host ?? "").replace(/:\d+$/, "");
    if (!["127.0.0.1", "localhost", "[::1]"].includes(host)) {
      res.writeHead(403);
      return res.end();
    }
    if (req.method === "OPTIONS") {
      res.writeHead(allowed ? 204 : 403);
      return res.end();
    }
    if (origin && !allowed) {
      res.writeHead(403);
      return res.end("Origin not allowed");
    }
    const url = new URL(req.url, "http://127.0.0.1");
    if (!authorised(req, url)) return json(res, 401, { error: "Pairing token missing or wrong. Open the editor link from the companion again." });
    try {
      await route(req, res, url);
    } catch (e) {
      if (res.headersSent) return res.destroy();
      if (e instanceof HttpError) return json(res, e.status, { error: e.message, ...e.extra });
      json(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
  });

  // Try the preferred port, then the next few, so two companions can run side by side.
  let bound = port;
  for (let attempt = 0; ; attempt++) {
    try {
      await new Promise((ok, fail) => {
        server.once("error", fail);
        server.listen(bound, "127.0.0.1", () => {
          server.off("error", fail);
          ok();
        });
      });
      break;
    } catch (e) {
      if (e.code !== "EADDRINUSE" || attempt >= 10) throw e;
      bound++;
    }
  }

  const bridge = `http://127.0.0.1:${bound}`;
  const pairingUrl = `${site.replace(/\/$/, "")}/editor#${new URLSearchParams({ bridge, token })}`;
  return { pairingUrl, port: bound, root, close: () => server.close() };
}
