# {{BRAND}} computer setup (checklist v{{SETUP_VERSION}})

Every {{BRAND}} video renders on the user's own computer. Before the first video, make sure this computer has the tools
below. **You install everything yourself; the user does nothing.** Tell them once, in one sentence, that you're setting up
free local tools (a few minutes, a few GB), then work through the list without asking about each step. Only stop to ask
when the system needs their password or a confirmation you can't give (e.g. `sudo`, a Windows UAC prompt, a macOS
security dialog), and say exactly what to click.

Use the user's shell: PowerShell on Windows, bash/zsh elsewhere. Run checks first and install only what's missing.
`~/.framewright` means `$HOME/.framewright` (Windows: `$env:USERPROFILE\.framewright`).

## 0. Already done on this computer?

If `~/.framewright/setup.json` exists and its `"version"` is {{SETUP_VERSION}} or higher, this computer is ready: call
`finish_setup` with `"already set up"` and continue with the user's request. Otherwise do steps 1–7.

## 1. Package manager

- **Windows:** `winget --version` (built into Windows 10/11). Add `--accept-source-agreements --accept-package-agreements -e`
  to every `winget install`.
- **macOS:** `brew --version`. If missing, install Homebrew:
  `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"` (asks for the user's
  password once).
- **Linux:** `apt-get` (Debian/Ubuntu) or the distro's package manager; needs `sudo`.

After installing anything on Windows, open a new shell (or refresh `PATH`) before checking it.

## 2. Node.js 20+ and FFmpeg

| Check | Windows | macOS | Linux |
|---|---|---|---|
| `node -v` (20 or newer) | `winget install OpenJS.NodeJS.LTS` | `brew install node` | `sudo apt-get install -y nodejs npm` (or NodeSource for 20+) |
| `ffmpeg -version` and `ffprobe -version` | `winget install Gyan.FFmpeg` | `brew install ffmpeg` | `sudo apt-get install -y ffmpeg` |

FFmpeg must include `libx264`, `libvpx-vp9` and `prores_ks` (`ffmpeg -hide_banner -encoders`); the builds above do.

## 3. Playwright + Chromium (renders the animated scenes)

```
npx -y playwright@latest install chromium
```

On Linux also run `sudo npx -y playwright@latest install-deps chromium`. Check: the command ends without errors and
`npx -y playwright@latest --version` prints a version. (An engine may pin its own Playwright version; its own install step
then fetches the matching browser.)

## 4. Python 3.10+ with the analysis and speech models

| Check | Windows | macOS | Linux |
|---|---|---|---|
| `python --version` / `python3 --version` (3.10–3.12) | `winget install Python.Python.3.12` | `brew install python@3.12` | `sudo apt-get install -y python3 python3-venv python3-pip` |

Create one shared environment for {{BRAND}} and install the packages:

```
python3 -m venv ~/.framewright/venv            # Windows: python -m venv "$env:USERPROFILE\.framewright\venv"
~/.framewright/venv/bin/python -m pip install -U pip
~/.framewright/venv/bin/python -m pip install numpy opencv-python scipy pillow scenedetect librosa soundfile faster-whisper yt-dlp
```

The engine's reference-analysis scripts also need `numpy opencv-python scipy pillow` in the `python` they're run with.
Install them for the user's main Python as well:

```
python -m pip install --user numpy opencv-python scipy pillow      # macOS / Linux: python3 -m pip …
```

If pip refuses with "externally-managed-environment" (Homebrew or Debian Python), skip this and run those scripts with the
{{BRAND}} Python instead (`~/.framewright/venv/bin/python`, Windows `~\.framewright\venv\Scripts\python.exe`).

On Windows the interpreter is `~\.framewright\venv\Scripts\python.exe`. Then download the speech model once (used for
word-timed captions and transcribing references):

```
~/.framewright/venv/bin/python -c "from faster_whisper import WhisperModel; WhisperModel('small')"
```

If an engine's helper bundle contains a `requirements.txt`, install it into the same environment.

## 5. yt-dlp (download reference videos from YouTube, TikTok, Instagram, X…)

Installed in step 4. Check: `~/.framewright/venv/bin/yt-dlp --version` (Windows: `~\.framewright\venv\Scripts\yt-dlp.exe`).
Usage when the user gives a link:

```
~/.framewright/venv/bin/yt-dlp --no-playlist -f "bv*[height<=1080]+ba/b[height<=1080]/b" --merge-output-format mp4 -o "refs/%(title).80s.%(ext)s" "<URL>"
```

The {{BRAND}} Companion's `download_video` tool does the same. Use downloads only as private references for the user's
own project (analysis, timing, look); never put someone else's footage in the final video unless the user owns it or has
the rights. Keep yt-dlp current (`pip install -U yt-dlp`) when a site stops working.

## 6. Voicebox (free local voice-over)

Voicebox is a free, open-source voice studio that runs on the user's PC with a local API at `http://127.0.0.1:17493`.
{{BRAND}} uses it by default for narration (users who prefer ElevenLabs add their own key on {{SITE_URL}}/dashboard).

1. Check: `curl -s http://127.0.0.1:17493/profiles` (PowerShell: `Invoke-RestMethod http://127.0.0.1:17493/profiles`). A
   JSON reply means it's installed and running; skip to step 7.
2. Install it:
   - **Windows:** download `https://voicebox.sh/download/windows` (MSI) and run it:
     `Invoke-WebRequest https://voicebox.sh/download/windows -OutFile "$env:TEMP\voicebox.msi"; Start-Process msiexec -ArgumentList "/i","$env:TEMP\voicebox.msi","/passive" -Wait`
   - **macOS (Apple Silicon / Intel):** download `https://voicebox.sh/download/mac-arm` (or `mac-intel`), open the DMG and
     copy Voicebox to Applications:
     `curl -fL https://voicebox.sh/download/mac-arm -o /tmp/voicebox.dmg && hdiutil attach /tmp/voicebox.dmg -nobrowse -mountpoint /tmp/voicebox && cp -R /tmp/voicebox/*.app /Applications/ && hdiutil detach /tmp/voicebox`
   - **Linux:** no installer yet; skip Voicebox and tell the user narration needs ElevenLabs (their own key) on Linux.
3. Start it once (Windows: Start menu → Voicebox; macOS: `open -a Voicebox`). On first start it downloads its voice
   models; wait until the check in 1 answers. Leave it running while making videos.

The voice-over workflow is in `get_voice`.

## 7. Record and report

Write `~/.framewright/setup.json`:

```json
{ "version": {{SETUP_VERSION}}, "date": "<ISO date>", "os": "<windows|macos|linux>",
  "node": "<version>", "ffmpeg": "<version>", "python": "<~/.framewright/venv python path>",
  "ytDlp": "<path>", "playwright": "<version>", "voicebox": "<running|installed|skipped: reason>" }
```

Then call `finish_setup` with a one-line summary (what was installed, anything skipped and why). Tell the user in one or
two sentences that their computer is ready, and carry on with their video. If something failed twice, don't loop: report
it to the user plainly, say what it affects (e.g. "no local voice; I can use captions only or your ElevenLabs key"), and
continue with what works.
