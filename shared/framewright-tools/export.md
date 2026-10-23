# {{BRAND}} editable export (Premiere Pro · DaVinci Resolve · Final Cut Pro)

Use this when the user wants to edit the video in their own editing software, or asks for an "editable", "project file",
"XML", "FCPXML" or "Premiere/Resolve/Final Cut" version. It works for every {{BRAND}} engine. The final MP4 stays the main
deliverable; the edit package is an extra.

The result is a folder the user opens in their editor with:
- each **scene** as its own clip (overlapping scenes go on alternating video tracks so transitions survive),
- **captions** twice: a styled, animated overlay clip with transparency on the top track, and an `.srt` with editable text,
- **voice** split per scene, **music** and **sound effects** on their own audio tracks with their levels and fades.

Animation inside a scene is rendered pixels; editors can trim, reorder, retime, replace and remix, but not re-keyframe it.
Say so if the user expects After Effects-style layers.

## 1. Render the parts (do not re-render approved work unnecessarily)

Work inside the project. Put everything in `renders/edit/v<N>/`.

1. **Scene clips** — one file per scene, rendering **only that scene's layer** so overlapping neighbours and captions are not
   baked in. Render exactly the scene's own range; add handles (extra time before/after for trimming) only if the engine
   actually draws the scene outside that range — otherwise handles are blank frames. motion-video-director does not, so no
   handles. H.264 `.mp4` is fine for opaque scenes; a scene that fades over the one below it needs `--alpha` too, or its fade
   will go to black instead of revealing the scene underneath.
2. **Caption overlay** — render the captions layer alone over the full duration **with transparency** as ProRes 4444 `.mov`.
   Skip if the video has no captions.
3. **Audio stems** — WAV, 48 kHz:
   - voice: one file per scene or per narration line (cut from the approved VO master at the beat boundaries, no fades
     baked in unless they are part of the sound design),
   - music bed: the whole track, unducked; express ducking as clip gain instead,
   - SFX: the individual approved sounds, each placed at its cue time (not a pre-mixed SFX stem), unless there are more than
     ~60; then group them per scene.
   Do not apply final loudness normalization to stems; record each stem's mix level as `gainDb` instead.

### motion-video-director
Its renderer (`<skill>/templates/render/render.js`, v3.6.0+) supports layers. Give the captions scene(s) `layer: 'captions'`
in `data.js` (all other scenes default to their own id as layer) and render:

```
node src/render.js --from 10.5 --to 20.7 --layers 03-three-lanes --out renders/edit/v1 --name "03 Three Lanes"
node src/render.js --from 0 --to <DURATION> --layers captions --alpha --out renders/edit/v1 --name "Captions overlay"
```

`--layers` takes comma-separated scene ids and/or layer names; `--alpha` renders a transparent background to a ProRes 4444
`.mov`. If the project's `src/render.js` predates these flags, copy the updated `render.js` and `main.js` from `<skill>` (keep
the project's `data.js` and scenes), then re-run a 1-second smoke test before exporting.

## 2. Write `framewright.timeline.json` in the project root

Times are seconds on the edit timeline; the exporter snaps them to frames. `src` paths are relative to this file.
List video tracks bottom to top. `in` (default 0) is where the clip starts inside its source file; `duration` defaults to
the rest of the file.

```json
{
  "version": 1,
  "name": "Launch Promo",
  "fps": 30,
  "width": 1080,
  "height": 1920,
  "tracks": [
    { "kind": "video", "name": "Scenes A", "clips": [
      { "name": "01 Still Alive", "src": "renders/edit/v1/01 Still Alive.mp4", "start": 0, "in": 0, "duration": 4.6 },
      { "name": "03 Three Lanes", "src": "renders/edit/v1/03 Three Lanes.mp4", "start": 10.5 }
    ]},
    { "kind": "video", "name": "Scenes B", "clips": [
      { "name": "02 No Port", "src": "renders/edit/v1/02 No Port.mp4", "start": 4.1 }
    ]},
    { "kind": "captions", "name": "Captions", "overlay": "renders/edit/v1/Captions overlay.mov", "cues": [
      { "start": 0.2, "end": 1.4, "text": "Your server is still alive" }
    ]},
    { "kind": "audio", "name": "Voice", "role": "dialogue", "clips": [
      { "name": "VO 01", "src": "renders/edit/v1/audio/VO 01.wav", "start": 0, "gainDb": 0 }
    ]},
    { "kind": "audio", "name": "SFX", "role": "effects", "clips": [
      { "name": "whoosh", "src": "assets/sfx/whoosh.wav", "start": 4.05, "gainDb": -9 }
    ]},
    { "kind": "audio", "name": "Music", "role": "music", "clips": [
      { "name": "BGM", "src": "assets/music/bed.wav", "start": 0, "gainDb": -18, "fadeIn": 1, "fadeOut": 2.5 }
    ]}
  ]
}
```

Rules:
- `fps`: 23.976, 24, 25, 29.97, 30, 50, 59.94 or 60 — the same as the final render.
- Clip `duration` defaults to the rest of the file after `in`; it must not run past the file's end.
- Alternate overlapping scenes between two video tracks, exactly as they overlap in the final render.
- Caption cue text comes from the approved script/transcript (`plan/beats.json`), one readable line or two per cue.
- `gainDb`, `fadeIn`, `fadeOut` (seconds) are optional on any clip.
- Only one captions track.

## 3. Build the package

The exporter ships inside every engine's local bundle at `<skill>/framewright/fw-export.mjs` (from get_scripts or the
Companion's install_engine; re-install if it is missing). It needs `ffprobe`.

```
node "<skill>/framewright/fw-export.mjs" validate framewright.timeline.json
node "<skill>/framewright/fw-export.mjs" package framewright.timeline.json --out exports --version 1
```

`validate` lists every problem at once; fix them all, then package. `package` refuses to overwrite: bump `--version`.
It copies all media into `exports/<Name> Edit v<N>/Media/` so the folder is self-contained (`--link-media` keeps original
paths instead) and writes `<Name>.fcpxml`, `<Name> - Premiere.xml`, `<Name> - Captions.srt` and a README with import steps.

## 4. Check and hand over

- Run `validate` once more on the final timeline and confirm the clip count per track matches the storyboard.
- Spot-check: total duration equals the final MP4's duration (±1 frame).
- Tell the user the folder path and which file to open in their editor (the README lists the menu paths).
- Be honest: the package is generated to each format's specification; say it has not been opened in their editor yet and
  ask them to report any import warning.
