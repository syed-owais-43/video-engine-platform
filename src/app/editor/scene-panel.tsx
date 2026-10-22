"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import type { Bridge, Job } from "./bridge";
import { BridgeError } from "./bridge";
import { formatTime, POSITIONS, type Bezier, type ParamValue, type Position, type SceneParam, type SceneParams, type SelectOption } from "./model";

// Scene sliders: edits a scene's *.params.json through the Companion and re-renders only that scene
// on the user's PC (no AI involved). See shared/framewright-tools/scenes.md for the file format.

const AUTO_KEY = "fw-editor-auto-render";
const AUTO_DELAY = 2500;

const optValue = (o: SelectOption) => (typeof o === "object" ? o.value : o);
const optLabel = (o: SelectOption) => (typeof o === "object" ? (o.label ?? String(o.value)) : String(o));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// Easing presets from the mockup.
const EASES: Record<string, Bezier> = { Smooth: [0.22, 1, 0.36, 1], Snappy: [0.7, 0, 0.2, 1], Bouncy: [0.34, 1.56, 0.64, 1], Linear: [0, 0, 1, 1] };
const CURVES: Record<string, Bezier> = { "Expo out": [0.16, 1, 0.3, 1], "Back out": [0.34, 1.56, 0.64, 1], "Ease in": [0.55, 0, 1, 0.45], Anticip: [0.6, -0.28, 0.74, 0.05] };
const bezierCss = (b: Bezier) => `cubic-bezier(${b.map((v) => +v.toFixed(2)).join(", ")})`;

type Props = {
  bridge: Bridge;
  project: string;
  path: string;
  clipName: string;
  start: number;
  end: number;
  fps: number;
  frame: { width: number; height: number };
  onRendered: () => Promise<void>;
};

export function ScenePanel({ bridge, project, path, clipName, start, end, fps, frame, onRendered }: Props) {
  const [scene, setScene] = useState<SceneParams | null>(null);
  const [loadError, setLoadError] = useState<{ message: string; problems?: string[] } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [unrendered, setUnrendered] = useState(false);
  const [auto, setAuto] = useState(false);
  const pending = useRef<Record<string, ParamValue>>({});
  const saveTimer = useRef<number | undefined>(undefined);
  const autoTimer = useRef<number | undefined>(undefined);
  const saving$ = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    try {
      // Per-browser preference, so it's read after mount.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAuto(localStorage.getItem(AUTO_KEY) === "1");
    } catch {}
  }, []);

  useEffect(() => {
    let live = true;
    bridge
      .scene(project, path)
      .then((r) => {
        if (!live) return;
        setScene(r.scene);
        setLoadError(null);
        if (r.job) setJob(r.job);
      })
      .catch((e: BridgeError) => live && setLoadError({ message: e.message, problems: e.problems }));
    return () => {
      live = false;
      window.clearTimeout(saveTimer.current);
      window.clearTimeout(autoTimer.current);
    };
  }, [bridge, project, path]);

  // Saves queued changes; later calls wait for earlier ones so writes stay in order.
  const flush = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    const values = pending.current;
    if (!Object.keys(values).length) return saving$.current;
    pending.current = {};
    setSaving(true);
    saving$.current = saving$.current.then(async () => {
      try {
        const r = await bridge.saveScene(project, path, values);
        setScene((cur) => (cur ? mergeSaved(cur, r.scene, pending.current) : r.scene));
        setSaveError(null);
      } catch (e) {
        const err = e as BridgeError;
        setSaveError(err.problems?.join(" ") ?? err.message);
      } finally {
        setSaving(false);
      }
    });
    return saving$.current;
  }, [bridge, project, path]);

  const render = useCallback(async () => {
    window.clearTimeout(autoTimer.current);
    await flush();
    setRenderError(null);
    try {
      const r = await bridge.renderScene(project, path);
      setJob(r.job);
      setUnrendered(false);
    } catch (e) {
      const err = e as BridgeError;
      setRenderError(err.problems?.join("\n") ?? err.message);
    }
  }, [bridge, project, path, flush]);

  const running = job?.status === "running";

  // Poll the render; when it's done, reload the clip in the preview.
  useEffect(() => {
    if (!job || job.status !== "running") return;
    const id = window.setInterval(async () => {
      try {
        const next = (await bridge.job(job.id)).job;
        setJob(next);
        if (next.status === "done") await onRendered();
        if (next.status === "error") setRenderError(next.error);
      } catch (e) {
        setRenderError(e instanceof Error ? e.message : "Lost track of the render");
        setJob(null);
      }
    }, 700);
    return () => window.clearInterval(id);
  }, [job, bridge, onRendered]);

  // Auto re-render: a few seconds after the last change, and again after a running render if
  // settings changed meanwhile.
  useEffect(() => {
    if (!auto || !unrendered || running) return;
    autoTimer.current = window.setTimeout(() => void render(), AUTO_DELAY);
    return () => window.clearTimeout(autoTimer.current);
  }, [auto, unrendered, running, render, scene]);

  const change = (id: string, value: ParamValue) => {
    setScene((cur) => (cur ? { ...cur, params: cur.params.map((q) => (q.id === id ? ({ ...q, value } as SceneParam) : q)) } : cur));
    pending.current = { ...pending.current, [id]: value };
    setUnrendered(true);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void flush(), 400);
  };

  const reset = () => {
    if (!scene) return;
    for (const q of scene.params) if (q.default !== undefined && !same(q.default, q.value)) change(q.id, q.default);
  };

  if (loadError)
    return (
      <div className="space-y-2 rounded-lg border border-bad/40 bg-bad/5 p-3 text-xs text-bad">
        <p>Couldn&apos;t read this scene&apos;s settings ({path}): {loadError.message}</p>
        {loadError.problems && (
          <ul className="list-disc pl-4">
            {loadError.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        <p className="text-muted">Ask your AI to fix the scene&apos;s params file (see its scene-sliders guide).</p>
      </div>
    );
  if (!scene) return <p className="text-xs text-faint">Loading scene settings…</p>;

  const groups = groupParams(scene);
  const changed = scene.params.some((q) => q.default !== undefined && !same(q.default, q.value));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 rounded-xl border border-line bg-ink-3 p-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-paper">{scene.name ?? clipName}</p>
          <p className="text-[11px] text-faint">
            {formatTime(start, fps)} – {formatTime(end, fps)}
          </p>
        </div>
        {scene.style && <span className="shrink-0 rounded-full border border-ember/40 px-2 py-0.5 text-[10px] text-ember">{scene.style}</span>}
      </div>

      <InstantPreview scene={scene} frame={frame} />

      {groups.map(([name, params]) => (
        <section key={name} className="rounded-xl border border-line bg-ink-3 p-3">
          <h3 className="mb-2.5 text-[10px] font-medium tracking-wider text-muted uppercase">{name}</h3>
          <div className="space-y-3">
            {params.map((q) => (
              <Control key={q.id} param={q} onChange={(v) => change(q.id, v)} />
            ))}
          </div>
        </section>
      ))}

      <div className="sticky -bottom-4 z-10 space-y-2 border-t border-line bg-ink-2 pt-2 pb-2">
        {running && (
          <div>
            <p className="text-xs text-muted">Rendering this scene… {Math.round((job?.progress ?? 0) * 100)}%</p>
            <div className="mt-1 h-1 rounded-full bg-line">
              <div className="h-full rounded-full bg-ember transition-all" style={{ width: `${Math.max(3, Math.round((job?.progress ?? 0) * 100))}%` }} />
            </div>
          </div>
        )}
        {saveError && <p className="text-xs text-bad">Not saved: {saveError}</p>}
        {!running && (saving || unrendered) && <p className="text-[11px] text-warn">{saving ? "Saving…" : "Changes not rendered yet"}</p>}
        {renderError && <pre className="max-h-40 overflow-auto rounded-lg border border-bad/40 bg-bad/5 p-2 text-[11px] whitespace-pre-wrap text-bad">{renderError}</pre>}
        <div className="flex gap-2">
          <button className="btn-ghost flex-1 !px-3 !py-2 !text-xs" disabled={!changed || running} onClick={reset} title="Back to the values your AI rendered">
            Reset
          </button>
          <button className="btn-primary flex-1 !px-3 !py-2 !text-xs" disabled={running} onClick={() => void render()}>
            {running ? "Rendering…" : "Re-render scene"}
          </button>
        </div>
      </div>
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-[11px] text-muted">
          <input
            type="checkbox"
            checked={auto}
            onChange={(e) => {
              setAuto(e.target.checked);
              try {
                localStorage.setItem(AUTO_KEY, e.target.checked ? "1" : "0");
              } catch {}
            }}
            className="accent-[var(--color-ember)]"
          />
          Re-render automatically when I stop changing settings
        </label>
        <p className="text-center text-[11px] text-faint">
          Renders this scene only, on your PC · no AI, no tokens
        </p>
        <p className="truncate text-center font-mono text-[10px] text-faint" title={scene.render.command.join(" ")}>
          Runs: {scene.render.command.join(" ")}
        </p>
      </div>
    </div>
  );
}

// Keeps values the user changed while a save was in flight.
function mergeSaved(cur: SceneParams, saved: SceneParams, unsaved: Record<string, ParamValue>): SceneParams {
  return { ...saved, params: saved.params.map((q) => (q.id in unsaved ? ({ ...q, value: cur.params.find((c) => c.id === q.id)?.value ?? q.value } as SceneParam) : q)) };
}

function groupParams(scene: SceneParams): [string, SceneParam[]][] {
  const order = [...(scene.groups ?? [])];
  for (const q of scene.params) if (!order.includes(q.group ?? "Settings")) order.push(q.group ?? "Settings");
  return order.map((g) => [g, scene.params.filter((q) => (q.group ?? "Settings") === g)] as [string, SceneParam[]]).filter(([, ps]) => ps.length > 0);
}

// ---------------- controls ----------------

const field = "w-full rounded-md border border-line bg-ink px-2 py-1.5 text-xs text-paper outline-none focus:border-ember";

function Label({ text, value, hint }: { text: string; value?: string; hint?: string }) {
  return (
    <div className="mb-1.5">
      <div className="flex justify-between text-xs text-muted">
        <span>{text}</span>
        {value !== undefined && <b className="font-medium text-paper tabular-nums">{value}</b>}
      </div>
      {hint && <p className="text-[10px] text-faint">{hint}</p>}
    </div>
  );
}

function Control({ param: q, onChange }: { param: SceneParam; onChange: (v: ParamValue) => void }) {
  const label = q.label ?? q.id;
  switch (q.type) {
    case "text":
      return (
        <div>
          <Label text={label} hint={q.hint} />
          {q.multiline ? (
            <textarea className={`${field} min-h-16`} maxLength={q.maxLength ?? 200} value={q.value} onChange={(e) => onChange(e.target.value)} />
          ) : (
            <input className={field} maxLength={q.maxLength ?? 200} value={q.value} onChange={(e) => onChange(e.target.value)} />
          )}
        </div>
      );
    case "number": {
      const pct = ((q.value - q.min) / (q.max - q.min)) * 100;
      const decimals = q.step && q.step < 1 ? String(q.step).split(".")[1]?.length ?? 1 : 0;
      return (
        <div>
          <Label text={label} value={`${q.value.toFixed(decimals)}${q.unit ? (q.unit.length > 2 ? ` ${q.unit}` : q.unit) : ""}`} hint={q.hint} />
          <input
            type="range"
            min={q.min}
            max={q.max}
            step={q.step ?? (q.max - q.min) / 100}
            value={q.value}
            onChange={(e) => onChange(Number(e.target.value))}
            className="fw-slider w-full"
            style={{ "--v": `${pct}%` } as CSSProperties}
          />
        </div>
      );
    }
    case "color":
      return (
        <div>
          <Label text={label} value={q.value} hint={q.hint} />
          <div className="flex flex-wrap items-center gap-2">
            {(q.options ?? []).map((c) => (
              <button
                key={c}
                title={c}
                onClick={() => onChange(c.toLowerCase())}
                className={`h-7 w-7 rounded-full ${q.value.toLowerCase() === c.toLowerCase() ? "ring-2 ring-ember ring-offset-2 ring-offset-ink-3" : "ring-1 ring-white/15"}`}
                style={{ background: c }}
              />
            ))}
            <label className="relative h-7 w-7 cursor-pointer overflow-hidden rounded-full ring-1 ring-white/15" title="Custom colour" style={{ background: "conic-gradient(red, yellow, lime, aqua, blue, magenta, red)" }}>
              <input type="color" value={q.value} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
            </label>
          </div>
        </div>
      );
    case "select":
      return (
        <div>
          <Label text={label} hint={q.hint} />
          <select
            className={field}
            value={String(q.value)}
            onChange={(e) => {
              const hit = q.options.find((o) => String(optValue(o)) === e.target.value);
              if (hit !== undefined) onChange(optValue(hit));
            }}
          >
            {q.options.map((o) => (
              <option key={String(optValue(o))} value={String(optValue(o))}>
                {optLabel(o)}
              </option>
            ))}
          </select>
        </div>
      );
    case "toggle":
      return (
        <label className="flex cursor-pointer items-center justify-between text-xs text-muted">
          <span>
            {label}
            {q.hint && <span className="block text-[10px] text-faint">{q.hint}</span>}
          </span>
          <button
            role="switch"
            aria-checked={q.value}
            onClick={() => onChange(!q.value)}
            className={`relative h-5 w-9 rounded-full transition-colors ${q.value ? "bg-ember" : "bg-line"}`}
          >
            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${q.value ? "left-[18px]" : "left-0.5"}`} />
          </button>
        </label>
      );
    case "position":
      return (
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted">{label}</span>
          <div className="grid grid-cols-3 gap-1">
            {POSITIONS.map((p) => (
              <button
                key={p}
                title={p.replace("-", " ")}
                onClick={() => onChange(p)}
                className={`h-[18px] w-[26px] rounded border ${q.value === p ? "border-ember bg-ember" : "border-line bg-ink hover:border-muted"}`}
              />
            ))}
          </div>
        </div>
      );
    case "easing":
      return <EasingControl label={label} value={q.value} onChange={onChange} />;
  }
}

// Preset chips, plus the mockup's curve editor with draggable handles and preset curves.
function EasingControl({ label, value, onChange }: { label: string; value: Bezier; onChange: (v: Bezier) => void }) {
  const preset = Object.entries(EASES).find(([, b]) => same(b, value))?.[0];
  const [advanced, setAdvanced] = useState(!preset);
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<0 | 1 | null>(null);
  const X = (v: number) => v * 100;
  const Y = (v: number) => 100 - v * 100;
  const [a, b, c, d] = value;

  const move = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (drag === null || !svg.current) return;
    const ctm = svg.current.getScreenCTM();
    if (!ctm) return;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    const x = Math.min(1, Math.max(0, pt.x / 100));
    const y = Math.min(1.6, Math.max(-0.6, (100 - pt.y) / 100));
    const next = [...value] as Bezier;
    next[drag * 2] = Math.round(x * 100) / 100;
    next[drag * 2 + 1] = Math.round(y * 100) / 100;
    onChange(next);
  };

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-xs text-muted">
        <span>{label}</span>
        <button className="rounded-full border border-ember/40 px-2 py-0.5 text-[10px] text-ember" onClick={() => setAdvanced((v) => !v)}>
          {advanced ? "Hide curve" : "Advanced easing"}
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(EASES).map(([name, bz]) => (
          <button
            key={name}
            onClick={() => onChange(bz)}
            className={`rounded-full border px-2.5 py-1 text-[11px] ${preset === name ? "border-ember bg-ember font-medium text-ink" : "border-line bg-ink text-muted hover:text-paper"}`}
          >
            {name}
          </button>
        ))}
        <button
          onClick={() => setAdvanced(true)}
          className={`rounded-full border px-2.5 py-1 text-[11px] ${!preset ? "border-ember bg-ember font-medium text-ink" : "border-line bg-ink text-muted hover:text-paper"}`}
        >
          Custom
        </button>
      </div>
      {advanced && (
        <div className="mt-3">
          <div className="flex gap-3">
            <svg
              ref={svg}
              width={130}
              height={150}
              viewBox="-10 -40 120 180"
              className="shrink-0 touch-none rounded-lg border border-line bg-ink"
              onPointerMove={move}
              onPointerUp={() => setDrag(null)}
              onPointerLeave={() => setDrag(null)}
            >
              <rect x={0} y={0} width={100} height={100} fill="none" stroke="var(--color-line)" />
              <line x1={0} y1={100} x2={X(a)} y2={Y(b)} stroke="var(--color-muted)" />
              <line x1={100} y1={0} x2={X(c)} y2={Y(d)} stroke="var(--color-muted)" />
              <path d={`M0 100 C${X(a)} ${Y(b)} ${X(c)} ${Y(d)} 100 0`} fill="none" stroke="var(--color-ember)" strokeWidth={2.5} />
              {([0, 1] as const).map((i) => (
                <circle
                  key={i}
                  cx={X(value[i * 2])}
                  cy={Y(value[i * 2 + 1])}
                  r={6}
                  fill="#fff"
                  stroke="var(--color-ember)"
                  strokeWidth={2}
                  className="cursor-grab"
                  onPointerDown={(e) => {
                    svg.current?.setPointerCapture(e.pointerId);
                    setDrag(i);
                  }}
                />
              ))}
            </svg>
            <div className="flex min-w-0 flex-1 flex-col justify-between gap-2">
              <span className="text-[11px] text-faint">Drag the handles</span>
              <code className="block rounded-md border border-line bg-ink p-1.5 text-[10px] break-all text-ember">{bezierCss(value)}</code>
              <div className="relative h-5 rounded-full border border-line bg-ink">
                <i className="fw-runner absolute top-[3px] left-[3px] h-3 w-3 rounded-full bg-ember" style={{ animationTimingFunction: bezierCss(value) }} />
              </div>
            </div>
          </div>
          <div className="mt-2 grid grid-cols-4 gap-1.5">
            {Object.entries(CURVES).map(([name, bz]) => (
              <button key={name} onClick={() => onChange(bz)} className="rounded-md border border-line bg-ink p-1 text-center text-[10px] text-muted hover:text-paper">
                <svg width={40} height={26} viewBox="-5 -15 110 130" className="mx-auto block">
                  <path d={`M0 100 C${X(bz[0])} ${Y(bz[1])} ${X(bz[2])} ${Y(bz[3])} 100 0`} fill="none" stroke="var(--color-ember)" strokeWidth={6} />
                </svg>
                {name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- instant preview ----------------

// Which param drives which part of the quick preview: an explicit "preview" role, or a common id.
const ROLES: Record<string, string[]> = {
  text: ["headline", "title", "text", "heading"],
  font: ["font", "fontFamily"],
  weight: ["weight", "fontWeight"],
  size: ["size", "fontSize", "textSize"],
  tracking: ["tracking", "letterSpacing"],
  color: ["textColor", "color", "fg"],
  background: ["bgColor", "background", "backgroundColor", "bg"],
  position: ["position", "textPosition"],
  speed: ["speed"],
  delay: ["delay"],
  easing: ["easing", "ease"],
  entrance: ["entrance", "animation", "enter"],
};

function role(scene: SceneParams, name: string) {
  const q = scene.params.find((p) => p.preview === name) ?? scene.params.find((p) => ROLES[name].includes(p.id));
  return q?.value;
}

const PLACE: Record<Position, { left: string; top: string; align: CSSProperties["textAlign"]; tx: string; ty: string }> = Object.fromEntries(
  POSITIONS.map((p) => {
    const [v, h] = p.split("-");
    return [
      p,
      {
        left: h === "left" ? "8%" : h === "center" ? "50%" : "92%",
        top: v === "top" ? "12%" : v === "middle" ? "50%" : "88%",
        align: h === "left" ? "left" : h === "center" ? "center" : "right",
        tx: h === "left" ? "0" : h === "center" ? "-50%" : "-100%",
        ty: v === "top" ? "0" : v === "middle" ? "-50%" : "-100%",
      },
    ];
  }),
) as Record<Position, { left: string; top: string; align: CSSProperties["textAlign"]; tx: string; ty: string }>;

function entranceKeyframes(name: string) {
  const n = name.toLowerCase();
  if (n.includes("blur")) return "fw-in-blur";
  if (n.includes("scale") || n.includes("pop") || n.includes("zoom")) return "fw-in-scale";
  if (n.includes("mask") || n.includes("wipe") || n.includes("reveal")) return "fw-in-mask";
  if (n.includes("type")) return "fw-in-type";
  if (n.includes("fade")) return "fw-in-fade";
  return "fw-in-up";
}

// A small, approximate live view of the scene's text, colours and motion, so slider changes are
// visible at once. The real look comes from the re-render, shown in the main preview.
function InstantPreview({ scene, frame }: { scene: SceneParams; frame: { width: number; height: number } }) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const text = role(scene, "text");
  if (typeof text !== "string") return null;
  const size = Number(role(scene, "size") ?? 72);
  const tracking = Number(role(scene, "tracking") ?? 0);
  const speed = Math.max(0.1, Number(role(scene, "speed") ?? 1));
  const delay = Math.max(0, Number(role(scene, "delay") ?? 0));
  const easing = role(scene, "easing");
  const pos = PLACE[(role(scene, "position") as Position) ?? "middle-center"] ?? PLACE["middle-center"];
  const font = role(scene, "font");
  const weight = role(scene, "weight");
  const color = role(scene, "color");
  const bg = role(scene, "background");
  const entrance = role(scene, "entrance");
  const scale = w && frame.width ? w / frame.width : 0.25;

  return (
    <div>
      <div
        ref={box}
        className="relative w-full overflow-hidden rounded-lg border border-line"
        style={{ aspectRatio: `${frame.width} / ${frame.height}`, background: typeof bg === "string" ? bg : "#111" }}
      >
        <div className="pointer-events-none absolute inset-[6%] rounded border border-dashed border-white/10" />
        <span
          key={`${String(entrance)}:${speed}:${delay}:${JSON.stringify(easing)}`}
          className="absolute whitespace-pre-wrap leading-[1.05]"
          style={{
            left: pos.left,
            top: pos.top,
            maxWidth: "84%",
            textAlign: pos.align,
            translate: `${pos.tx} ${pos.ty}`,
            color: typeof color === "string" ? color : "#fff",
            fontFamily: typeof font === "string" ? `"${font}", system-ui, sans-serif` : undefined,
            fontWeight: typeof weight === "number" || typeof weight === "string" ? (weight as CSSProperties["fontWeight"]) : 700,
            fontSize: Math.max(6, size * scale),
            letterSpacing: `${tracking / 100}em`,
            animationName: entranceKeyframes(typeof entrance === "string" ? entrance : ""),
            animationDuration: `${1 / speed}s`,
            animationDelay: `${delay}s`,
            animationTimingFunction: Array.isArray(easing) ? bezierCss(easing as Bezier) : "ease-out",
            animationIterationCount: "infinite",
            animationDirection: "alternate",
            animationFillMode: "both",
          }}
        >
          {text}
        </span>
        <span className="absolute top-1.5 left-1.5 rounded-full bg-black/60 px-2 py-0.5 text-[9px] text-white/80">Instant preview · approximate</span>
      </div>
    </div>
  );
}
