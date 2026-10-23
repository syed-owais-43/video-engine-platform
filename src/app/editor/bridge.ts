// Client for the Framewright Companion's editor bridge on 127.0.0.1. The pairing token comes
// from the URL fragment the companion opens, so it never reaches the Framewright server.

import type { EditorRequest, MediaInfo, ParamValue, SceneParams, Timeline } from "./model";

export type BridgeConfig = { bridge: string; token: string };
export type Project = { id: string; name: string; path: string; mtime: number };
export type Job = { id: string; kind: string; status: "running" | "done" | "error"; progress: number; output: string | null; error: string | null };

const KEY = "fw-editor-bridge";

export function readBridgeConfig(): BridgeConfig | null {
  if (typeof window === "undefined") return null;
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const bridge = hash.get("bridge");
  const token = hash.get("token");
  if (bridge && token && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(bridge)) {
    const cfg = { bridge, token };
    try {
      sessionStorage.setItem(KEY, JSON.stringify(cfg));
    } catch {}
    // Drop the token from the address bar so it isn't shared by accident.
    history.replaceState(null, "", window.location.pathname + window.location.search);
    return cfg;
  }
  try {
    const saved = sessionStorage.getItem(KEY);
    return saved ? (JSON.parse(saved) as BridgeConfig) : null;
  } catch {
    return null;
  }
}

export function forgetBridge() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {}
}

export class BridgeError extends Error {
  constructor(
    message: string,
    public status: number,
    public problems?: string[],
  ) {
    super(message);
  }
}

export class Bridge {
  constructor(public cfg: BridgeConfig) {}

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.cfg.bridge}${path}`, {
        ...init,
        headers: { authorization: `Bearer ${this.cfg.token}`, ...(init.body && typeof init.body === "string" ? { "content-type": "application/json" } : {}), ...init.headers },
      });
    } catch {
      throw new BridgeError("Can't reach the Framewright Companion on this computer. Is it still running?", 0);
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new BridgeError(body.error ?? `Request failed (${res.status})`, res.status, body.problems);
    return body as T;
  }

  q = (p: string, extra: Record<string, string> = {}) => new URLSearchParams({ p, ...extra }).toString();

  projects = () => this.call<{ projects: Project[] }>("/api/projects");
  project = (p: string) =>
    this.call<{ timeline: Timeline; mtime: number; media: Record<string, MediaInfo>; requests: EditorRequest[]; dir: string }>(`/api/project?${this.q(p)}`);
  save = (p: string, timeline: Timeline, baseMtime: number, force = false) =>
    this.call<{ mtime: number; media: Record<string, MediaInfo> }>(`/api/project?${this.q(p)}`, {
      method: "PUT",
      body: JSON.stringify({ timeline, baseMtime, force }),
    });
  mtime = (p: string) => this.call<{ mtime: number; requests: EditorRequest[] }>(`/api/mtime?${this.q(p)}`);
  assets = (p: string) => this.call<{ assets: { src: string; size: number }[] }>(`/api/assets?${this.q(p)}`);
  upload = (p: string, file: File) =>
    this.call<{ src: string; info: MediaInfo }>(`/api/upload?${this.q(p, { name: file.name })}`, { method: "POST", body: file });
  addRequest = (p: string, r: Partial<EditorRequest>) =>
    this.call<{ requests: EditorRequest[] }>(`/api/requests?${this.q(p)}`, { method: "POST", body: JSON.stringify(r) });
  deleteRequest = (p: string, id: string) =>
    this.call<{ requests: EditorRequest[] }>(`/api/requests?${this.q(p, { id })}`, { method: "DELETE" });
  render = (p: string, captions: string) =>
    this.call<{ job: Job }>(`/api/render?${this.q(p)}`, { method: "POST", body: JSON.stringify({ captions }) });
  exportPackage = (p: string) => this.call<{ job: Job }>(`/api/export-package?${this.q(p)}`, { method: "POST", body: "{}" });
  job = (id: string) => this.call<{ job: Job }>(`/api/jobs/${id}`);
  scene = (p: string, path: string) => this.call<{ scene: SceneParams; mtime: number; job: Job | null }>(`/api/scene?${this.q(p, { path })}`);
  saveScene = (p: string, path: string, values: Record<string, ParamValue>) =>
    this.call<{ scene: SceneParams; mtime: number }>(`/api/scene?${this.q(p, { path })}`, { method: "PUT", body: JSON.stringify({ values }) });
  renderScene = (p: string, path: string) => this.call<{ job: Job }>(`/api/scene/render?${this.q(p, { path })}`, { method: "POST", body: "{}" });
  reveal = (path: string) => this.call<{ ok: true }>("/api/reveal", { method: "POST", body: JSON.stringify({ path }) });

  // preview=1 asks the companion for a browser-playable copy (e.g. ProRes → VP9 with alpha).
  // version (the file's mtime) changes the URL when a scene is re-rendered in place.
  mediaUrl = (p: string, src: string, preview = false, version?: number) =>
    `${this.cfg.bridge}/media?${this.q(p, { src, token: this.cfg.token, ...(preview ? { preview: "1" } : {}), ...(version ? { v: String(Math.round(version)) } : {}) })}`;
}
