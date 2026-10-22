# {{BRAND}} timeline editor

The user can open the project in {{BRAND}}'s web timeline editor to move, trim, split and delete clips, set audio levels and
fades, edit captions, adjust each scene's settings with sliders (re-rendered locally, without you), add their own
images/video/audio, and leave change requests for you. The editor reads and writes the
project's `framewright.timeline.json` on the user's computer through the {{BRAND}} Companion; nothing is uploaded.

## 1. Make a project editable

The editor needs the same parts as the editable export. Follow `framewright/export.md` steps 1–2 (scene clips per layer,
transparent caption overlay, audio stems, then `framewright.timeline.json` in the project root). Additionally:

- Give every track, clip and caption cue a short unique `"id"` (e.g. `"s03"`, `"vo03"`, `"c12"`) and keep ids stable when
  you re-render, so the user's edits and requests keep pointing at the right things.
- Name clips the way the storyboard does ("03 Three Lanes"), and caption cues one readable line each.
- Give every scene clip a `scene.params.json` so the user can change its text, colours, sizes, speed and easing with
  sliders and re-render just that scene without you: read `framewright/scenes.md` and follow it.
- Validate: `node "<skill>/framewright/fw-export.mjs" validate framewright.timeline.json`.

Mention the editor once when the final render is approved: "You can fine-tune this in the {{BRAND}} editor."

## 2. Open the editor

- {{BRAND}} Companion connected (Claude Desktop): call its `open_editor` tool.
- Otherwise (Claude Code, Cursor…): ask the user to run this in a terminal inside the project folder and keep it open while
  editing (you can't keep it running for them):
  `npx -y {{COMPANION}} --editor --site {{SITE_URL}}`
  It opens the editor in their browser.

## 3. What the user's edits mean

Edits are saved straight into `framewright.timeline.json` (previous versions are kept in `.framewright/history/`).

- Clip `start` / `in` / `duration` changed, clips split, moved or deleted, tracks added: an editorial change. Exporting from the
  editor (MP4 or edit package) already reflects it without re-rendering.
- `gainDb`, `fadeIn`, `fadeOut`, `muted` on clips or tracks: mix changes, also already reflected in editor exports.
- New clips under `assets/imported/`: media the user added. Keep them.
- A scene's `scene.params.json` values changed (and its clip file re-rendered by the Companion): the user tuned that
  scene with the sliders. Treat those values as approved.
- Caption `cues` text/timing changed: the track gets `"overlayStale": true`. The styled overlay no longer matches until you
  re-render it.

When the user asks you to "apply my editor edits" or to make a new **final render through the engine** (higher quality than
the editor's quick export, or because scene code must change), carry the editor timeline back into the source of truth:

1. Read `framewright.timeline.json` and compare it with `plan/beats.json` / the scene definitions (`src/data.js` for
   motion-video-director). Map clip ids back to scenes.
2. Retimings → update scene `start`/`end` and the beat timings; trims that cut into a scene → shorten that scene; split scenes
   → keep both parts as separate time ranges of the same scene unless the user asked otherwise.
3. Caption edits → update the caption cue data the engine draws from, re-render the caption overlay with `--alpha`, then set
   `overlayStale` to false (or remove it) in the timeline.
4. Imported media on the timeline → treat as approved assets; add them to the asset manifest with "user supplied".
5. Re-render only what changed, rebuild the affected edit clips, and write the updated timeline with the same ids. Never
   discard the user's edits silently; if something can't be carried over, say what and why.

## 4. Editor requests

The user can attach a request to a clip ("make the headline bigger", "replace this whoosh"). They are stored in
`framewright.requests.json` in the project:

```json
{ "version": 1, "requests": [
  { "id": "a1b2c3d4", "status": "open", "createdAt": "…", "clipId": "s03", "clipName": "03 Three Lanes",
    "src": "renders/edit/v1/03 Three Lanes.mp4", "trackName": "Scenes A", "at": 12.4, "text": "Make the headline bigger" }
]}
```

When the user says "apply my {{BRAND}} editor requests" (or similar):

1. Read the file. Work through every request with `"status": "open"`, oldest first. `at` is the playhead time in seconds on
   the timeline when the request was made; `clipId` / `src` identify the clip.
2. Make the change in the scene code or audio, re-render the affected parts (preview first if the change is visual), and
   update the timeline (same ids).
3. Mark each one done: set `"status": "done"` and a short `"note"` saying what you changed. If you can't do one, leave it open
   and explain why in `"note"`.
4. Tell the user it's ready; the editor reloads the project automatically when the timeline file changes.

## 5. Exports from the editor

The editor's Export tab runs the same tools you have:
- MP4: `node "<skill>/framewright/fw-compose.mjs" framewright.timeline.json --out exports --version N --captions overlay|plain|none`
- Edit package: `node "<skill>/framewright/fw-export.mjs" package framewright.timeline.json --out exports --version N`

These assemble existing clips; they don't re-run the engine. For the highest-quality master after big edits, apply the edits
to the source (section 3) and render through the engine.
