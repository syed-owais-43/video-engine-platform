# Voice-over with Voicebox (free, runs on this computer)

Voicebox has a local API at `http://127.0.0.1:17493`. Nothing leaves the user's PC and there is no cost.
If it isn't running, start it (Windows: Start menu → Voicebox; macOS: `open -a Voicebox`); if it isn't installed, follow
step 6 of the setup checklist (`get_setup`).

## 1. Pick a voice

```
curl -s http://127.0.0.1:17493/profiles
```

PowerShell: `Invoke-RestMethod http://127.0.0.1:17493/profiles | ConvertTo-Json -Depth 4`.

Each profile has an `id` and a `name`. Match the brief (gender, age, energy, accent, language). If the user has a voice of
their own in Voicebox, prefer it. If none fits, use a preset voice and say which one you chose. To clone the user's voice,
they record or import a sample in the Voicebox app (Voices → New); you can't do that for them.

## 2. Generate each line

Generate one WAV per narration line or beat, so timing stays editable:

```
curl -s -X POST http://127.0.0.1:17493/generate/stream -H "Content-Type: application/json" \
  -d '{"text": "Ship faster.", "profile_id": "<id>", "language": "en"}' -o assets/vo/vo_01.wav
```

PowerShell:

```
Invoke-WebRequest -Method Post http://127.0.0.1:17493/generate/stream -ContentType "application/json" `
  -Body (@{ text = "Ship faster."; profile_id = "<id>"; language = "en" } | ConvertTo-Json) -OutFile assets/vo/vo_01.wav
```

- `language`: the script's language code. Supported: en, es, de, fr, it, pt, nl, da, sv, no, fi, pl, ru, tr, el, he, ar,
  hi, ms, sw, zh, ja, ko.
- `instruct` (optional, up to 500 characters): delivery direction such as "warm, confident, slightly fast" for engines
  that support it.
- Check every file: `ffprobe` duration > 0 and roughly matches the line length. Re-generate lines that clip, mumble or
  mispronounce a brand name (spell it phonetically in `text`).
- Generation takes a few seconds per line (longer the first time, while the model loads). Lines are independent: generate
  them one after another, not in parallel.
- Full API reference: `http://127.0.0.1:17493/docs` on the user's computer.

## 3. Use it

Treat the WAVs like any recorded voice-over: measure durations, fit the beats to them, then mix (voice on top, music ducked
under it). Record each file in the asset manifest as "Voicebox (local), voice <name>".
