# Video-engine subscription site (technical reference)

The installation guide is the repository's main [README](../README.md). This file is the technical reference.

A paywalled MCP server and website that serves video-generation engines (Claude skills) to a subscriber's own AI. The user
describes a video in Claude Code, Cursor or Claude Desktop; the AI calls the site to pick an engine, reads its instructions
live, installs the engine's helper scripts locally and renders the video on the user's machine.

```
User's AI ──MCP (OAuth or API key)──▶ /api/mcp ──▶ start_project / get_guide / get_scripts / get_style / get_assets …
   │                                                     │
   └── renders locally with Node/Python/FFmpeg ◀── signed bundle download (scripts + templates)
```

- **Instructions stay on the server.** `SKILL.md` and `reference/**` are only sent through MCP tool calls to active
  subscribers; never in the downloadable bundle.
- **Scripts are local.** Everything else in the engine is a ZIP served from a 15-minute signed URL.
- **Paywall:** one flat Stripe monthly subscription, no usage limits (videos render on the user's PC). Plans (price,
  usage rights, features) are managed in Admin → Plans and pushed to Stripe from there.
- **Libraries:** styles and resource packs (`library_items` + `library_files`, `src/lib/library.ts`).
  Files live in Vercel Blob when `BLOB_READ_WRITE_TOKEN` is set (`src/lib/storage.ts`), otherwise base64 in the database.
  `/api/files/<id>` serves them: `preview.*` and `cover.*` of published styles are public (the contact sheet is not); everything else needs a signed link
  (made per subscriber for their AI, 60 min) or a signed-in subscriber. Admin uploads go browser → Blob directly
  (`/api/admin/upload`, `@vercel/blob/client`) to avoid the serverless body limit.
- **Computer setup:** until a user's AI calls `finish_setup`, every tool answer starts with the checklist from
  `shared/framewright-tools/setup.md` (FFmpeg, Playwright + Chromium, Python venv with analysis/speech models, Voicebox,
  yt-dlp). Bump `SETUP_VERSION` in `src/lib/shared-tools.ts` when the checklist changes.
- **Voice:** Voicebox (local, `http://127.0.0.1:17493`) by default; users may save their own ElevenLabs key (encrypted in
  `users.elevenlabs_key`). `get_voice` hands the AI a 2-hour signed link to `/api/voice/tts`, which calls ElevenLabs with
  the key, so the key never reaches the AI.

## Configuration

Only three environment variables (see `.env.example`): `DATABASE_URL`, `APP_URL`, `APP_SECRET`. Optional: `SETUP_CODE`,
`ADMIN_EMAILS` (recovery admin), `BLOB_READ_WRITE_TOKEN` (added by Vercel when a Blob store is connected).

Everything else is set in **Admin → Settings** and stored encrypted (AES-256-GCM, key derived from `APP_SECRET`) in the
`settings` table: brand (name, tagline, accent, logo, support email, companion npm name), Stripe (secret key, webhook
secret, created automatically on https deployments), Google OAuth client.
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `GOOGLE_CLIENT_ID/SECRET` env vars still work as fallbacks.

First run: with no admin user, `/` redirects to `/setup`, which prints a one-time code to the server log (or uses
`SETUP_CODE`), creates the admin and seeds the default flat plan.

## Stack

Next.js 16 (App Router) · Drizzle ORM on Postgres (embedded PGlite locally) · Stripe Billing · MCP TypeScript SDK
(stateless Streamable HTTP) · own OAuth 2.1 server (dynamic client registration + PKCE) · Tailwind 4 · Vercel Blob.

## Run locally

```bash
npm install
npm run dev            # applies migrations first; open http://localhost:3000 → /setup (code in this terminal)
```

With no `DATABASE_URL`, data lives in `.data/pglite` (one process at a time: stop `npm run dev` before running scripts).
Engines can be uploaded in Admin → Engines, or from the CLI:
`npm run engine:import -- <folder-or-zip> --version 3.5.3 --name "Motion Video Director" --tags "motion graphics,explainer" --publish`.

Smoke-test the MCP server with an API key from the dashboard:

```bash
FW_KEY=fw_... node scripts/smoke-mcp.mjs '[["list_engines",{}],["account_status",{}]]'
```

Stripe webhooks locally: `stripe listen --forward-to localhost:3000/api/stripe/webhook`, then paste the `whsec_…` into
Admin → Settings → Payments.

## Deploy (Vercel + Neon)

Set the three env vars and deploy. `npm run build` runs `db:migrate` before `next build`, so schema changes apply on every
deploy. Then follow the owner's guide (setup code from Vercel logs, Admin → Settings).

## Companion (Claude Desktop and the editor)

`companion/` is a separate npm package (default name `framewright-companion`; the owner publishes it under their own name and
enters that name in Admin → Settings → Brand, which updates every command the site shows). It runs as a stdio MCP server
for Claude Desktop (proxies the site's tools with an API key; adds `install_engine`, `get_assets` (installs packs once into
`~/.framewright/assets`), `download_video` (yt-dlp), `download_file`, workspace file tools, `run_command` / `job_status`,
`open_editor`) or as the editor bridge (`--editor`). `npm publish` vendors
`shared/framewright-tools` into `companion/vendor/` first.

## Editable export (Premiere Pro · DaVinci Resolve · Final Cut Pro)

`shared/framewright-tools/` holds engine-independent tools:

- `export.md` — served live via `get_guide` at path `framewright/export.md` for every engine; tells the AI how to render scene
  layers, a transparent caption overlay and audio stems, and how to write `framewright.timeline.json`.
- `fw-export.mjs` — added to every engine bundle at `<skill>/framewright/fw-export.mjs`. `validate` / `package` a timeline
  into a folder with `.fcpxml` (Final Cut, Resolve), Premiere XML (Premiere, Resolve), `.srt` captions, `Media/` and a README.

Engines need a way to render one layer with transparency. motion-video-director 3.5.3 adds `render.js --layers <ids> --alpha`.

## Timeline editor (`/editor`)

A browser editor for subscribers that works on projects on the user's own computer. The page holds no project data: it
talks straight to the Framewright Companion's **editor bridge** on `127.0.0.1` (`companion/editor-bridge.js`).

- Start: `npx framewright-companion --editor [--project <folder>]` (Claude Code, Cursor…) or the companion's `open_editor`
  MCP tool (Claude Desktop). It opens `<APP_URL>/editor#bridge=…&token=…`; the token lives only in the URL fragment and
  sessionStorage, never on the server.
- Bridge security: loopback only, Host-header check (DNS rebinding), CORS limited to `FRAMEWRIGHT_URL`'s origin with the
  Private Network Access header, random pairing token on every call, paths confined to the project folder.
- Edits save to `framewright.timeline.json` (backups in `.framewright/history/`), requests to `framewright.requests.json`,
  added media to `assets/imported/`. Browsers can't play ProRes, so the bridge serves VP9 WebM preview copies (with alpha)
  from `.framewright/proxies/`; exports always use originals.
- Exports run on the user's PC: MP4 via `shared/framewright-tools/fw-compose.mjs` (FFmpeg), edit package via `fw-export.mjs`.
- The AI side is documented in `shared/framewright-tools/editor.md`, served via `get_guide framewright/editor.md`.
- Supported browsers: Chrome, Edge, Firefox (desktop). Safari is untested and may block the loopback connection.
- The companion vendors the shared tools on `npm pack`/`publish` (`companion/vendor.mjs`).

## MCP tools

| Tool | What it does |
|---|---|
| `list_engines` | Published engines with tags |
| `start_project` | Picks an engine from the brief (keyword + tag match; optional `style`) and returns `SKILL.md` with a site preamble |
| `get_guide` | Returns one `reference/*.md` file or a shared guide (`framewright/*.md`) |
| `get_scripts` | Signed bundle URL + install commands |
| `list_styles` / `get_style` | Style library; `get_style` returns style.json, recipe.md and every other `.md` note (breakdown.md, prompts.md…) as text, the contact sheet as an image, and signed links for fonts/SFX |
| `get_assets` | Published resource packs (structured output: slug, version, folder, signed URL) |
| `get_setup` / `finish_setup` | Computer setup checklist; `finish_setup` records `users.setup_version` |
| `get_voice` | Voicebox instructions, or ElevenLabs voices + signed TTS link when the user saved a key |
| `account_status` | Subscription, voice provider, setup state |

Every call is logged to `usage_events` for the admin analytics.

## Scene sliders

`shared/framewright-tools/scenes.md` (served as `framewright/scenes.md`) tells the AI to write a `*.params.json` per scene
(typed params: text, number, color, select, toggle, position, easing; plus an argv render command and its output file) and
to point the timeline clip at it with `"params"`. The editor (`src/app/editor/scene-panel.tsx`) edits values through the
bridge (`GET/PUT /api/scene`, `POST /api/scene/render` in `companion/editor-bridge.js`), which validates every value and
runs the render command without a shell (programs limited to node, python, python3, py, ffmpeg or the
`~/.framewright/venv` Python). After a render the bridge reports the clip's new mtime, which reloads it in the preview.
The panel also draws an approximate instant preview from params with `preview` roles (or conventional ids).

## Adding an engine

Upload a skill ZIP (standalone or plugin layout) in **Admin → Engines**. The engine root is wherever the shallowest `SKILL.md` is; its
frontmatter `name` becomes the slug. Set tags so `start_project` can route briefs to it, then tick **Published**.
