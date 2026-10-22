# {{BRAND}} scene sliders (`scene.params.json`)

The {{BRAND}} editor lets the user change each scene's text, colours, sizes, speed and easing with simple sliders and
pickers. When they press **Re-render scene**, the {{BRAND}} Companion re-renders **only that scene** on their PC by running
the command you put in the scene's params file. No AI, no tokens. Your job is to make every scene expose its settings.

Do this for every project you make editable (`framewright/editor.md`), right after the scene clips and the timeline exist.

## 1. One params file per scene

Write `scenes/<scene-id>/scene.params.json` (any path ending in `.params.json` inside the project works) and point the
scene's timeline clip at it with `"params"`:

```json
{ "id": "s03", "name": "03 Three Lanes", "src": "renders/edit/v1/03 Three Lanes.mp4", "start": 10.5,
  "params": "scenes/03-three-lanes/scene.params.json" }
```

```json
{
  "version": 1,
  "scene": "03-three-lanes",
  "name": "03 Three Lanes",
  "style": "clean-premium-saas",
  "render": {
    "command": ["node", "src/render.js", "--from", "10.5", "--to", "20.7", "--layers", "03-three-lanes",
                "--out", "renders/edit/v1", "--name", "03 Three Lanes"],
    "cwd": ".",
    "output": "renders/edit/v1/03 Three Lanes.mp4"
  },
  "groups": ["Text", "Colors", "Motion", "Sound"],
  "params": [
    { "id": "headline", "group": "Text", "label": "Headline", "type": "text", "value": "Ship faster.", "default": "Ship faster.", "maxLength": 60 },
    { "id": "font", "group": "Text", "label": "Font", "type": "select", "options": ["Clash Display", "Satoshi", "General Sans"], "value": "Clash Display", "default": "Clash Display" },
    { "id": "weight", "group": "Text", "label": "Weight", "type": "select", "options": [{ "value": 500, "label": "Medium 500" }, { "value": 700, "label": "Bold 700" }, { "value": 900, "label": "Black 900" }], "value": 700, "default": 700 },
    { "id": "size", "group": "Text", "label": "Size", "type": "number", "min": 32, "max": 140, "step": 1, "unit": "px", "value": 76, "default": 76 },
    { "id": "tracking", "group": "Text", "label": "Letter spacing", "type": "number", "min": -8, "max": 20, "step": 1, "unit": "%", "value": -2, "default": -2 },
    { "id": "position", "group": "Text", "label": "Position", "type": "position", "value": "middle-left", "default": "middle-left" },
    { "id": "textColor", "group": "Colors", "label": "Text", "type": "color", "options": ["#ffffff", "#ff6a2b", "#111111"], "value": "#ffffff", "default": "#ffffff" },
    { "id": "bgColor", "group": "Colors", "label": "Background", "type": "color", "options": ["#111111", "#0f1d2b", "#f3efe9"], "value": "#111111", "default": "#111111" },
    { "id": "speed", "group": "Motion", "label": "Speed", "type": "number", "min": 0.5, "max": 2, "step": 0.1, "unit": "×", "value": 1, "default": 1 },
    { "id": "delay", "group": "Motion", "label": "Delay", "type": "number", "min": 0, "max": 2, "step": 0.1, "unit": "s", "value": 0.2, "default": 0.2 },
    { "id": "easing", "group": "Motion", "label": "Easing", "type": "easing", "value": [0.22, 1, 0.36, 1], "default": [0.22, 1, 0.36, 1] },
    { "id": "entrance", "group": "Motion", "label": "Entrance", "type": "select", "options": ["Blur in", "Slide up", "Scale pop", "Typewriter", "Mask reveal"], "value": "Blur in", "default": "Blur in" },
    { "id": "sfxGain", "group": "Sound", "label": "SFX volume", "type": "number", "min": -30, "max": 6, "step": 1, "unit": "dB", "value": -8, "default": -8 },
    { "id": "grain", "group": "Look", "label": "Film grain", "type": "toggle", "value": true, "default": true }
  ]
}
```

### Parameter types

| `type` | Editor control | `value` | Extra fields |
|---|---|---|---|
| `text` | text box | string | `maxLength` (default 200), `multiline` |
| `number` | slider | number | `min`, `max` (required), `step`, `unit` |
| `color` | swatches + custom colour | `#rrggbb` | `options`: swatches, take them from the style's palette |
| `select` | dropdown | string or number | `options`: values, or `{ "value", "label" }` |
| `toggle` | switch | boolean | |
| `position` | 3×3 grid | `top-left` … `middle-center` … `bottom-right` | |
| `easing` | presets + curve editor | `[x1, y1, x2, y2]` cubic-bezier | |

Every param needs `id`, `type`, `value`, a short `label`, a `group` (cards shown in `groups` order) and `default` (what
**Reset** restores; set it to the value you rendered). Optional: `hint` (one short line under the control).

The editor also shows a small, approximate **instant preview** of the scene's main text while the user drags sliders
(the real look appears after the re-render). It finds the params by `"preview"` role, or by these ids when `preview` is
missing: `text` (headline/title/text), `font`, `weight`, `size` (in pixels at the video's full size), `tracking` (%),
`color` (textColor), `background` (bgColor), `position`, `speed`, `delay`, `easing`, `entrance`. Set
`"preview": "<role>"` on params whose ids differ, e.g. `{ "id": "line1", "preview": "text", … }`. Scenes without a main
text simply show no instant preview.

### What to expose

Expose what a user would plausibly tweak, typically 6–14 params per scene: every on-screen text, its font/weight/size and
position, the colours (swatches from the style palette), motion speed, delay, easing and entrance, and the scene's SFX
level. Skip anything that would break the layout or the edit (scene length, beat timing, camera paths). Keep slider
ranges inside what still looks good in this style: the user should not be able to make it ugly by accident.

## 2. Make the scene read its params

The render must take every exposed value from the params file at render time, never from a copy hard-coded in the scene
code. For example, in motion-video-director load the file in `src/data.js` and map `params[].value` by `id` into the
scene's config; in other engines, read it in the scene module or pass it to the renderer. After writing the files,
change one value, run the render command, check the output changed, and change it back.

Rules:
- `speed` and `delay` change animation timing **inside** the scene; the scene's length on the timeline stays the same.
- Fonts, SFX and textures you reference must already be in the project (or `~/.framewright/assets`) so the Companion
  can render offline.

## 3. The render command

- `command` is an argument list (no shell, no pipes): the program first. Allowed programs: `node`, `python`, `python3`,
  `py`, `ffmpeg`, or the {{BRAND}} Python at `~/.framewright/venv`. Put anything more complex in a script inside the
  project and call it with `node` or `python`.
- `cwd` is relative to the project folder (default `.`).
- `output` must be the clip's `src` in `framewright.timeline.json`, rendered at the same size, frame rate, length and
  transparency as before, so the editor picks it up without timeline changes.
- It must render only this scene (its layer and time range) and finish in well under a minute where possible.
- Print progress as a percentage (e.g. `42%`) if the renderer can; the editor shows it.

## 4. When the AI is asked to change a scene later

Read the scene's params file first: the user may have changed values in the editor. Keep their values unless the request
says otherwise, keep the ids, and update `default` only when the user approves a new baseline.
