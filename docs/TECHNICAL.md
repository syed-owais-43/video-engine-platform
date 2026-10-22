# Video-engine subscription site (technical reference)

The installation guide is the repository's main [README](../README.md). This file is the technical reference.

A paywalled MCP server and website that serves video-generation engines (Claude skills) to a subscriber's own AI. The user
describes a video in Claude Code, Cursor or Claude Desktop; the AI calls the site to pick an engine, reads its instructions
live, installs the engine's helper scripts locally and renders the video on the user's machine.

```
User's AI ──MCP (OAuth or API key)──▶ /api/mcp ──▶ start_project / get_guide / get_scripts / generate_image
   │                                                     │
   └── renders locally with Node/Python/FFmpeg ◀── signed bundle download (scripts + templates)
```

- **Instructions stay on the server.** `SKILL.md` and `reference/**` are only sent through MCP tool calls to active
  subscribers; never in the downloadable bundle.
- **Scripts are local.** Everything else in the engine is a ZIP served from a 15-minute signed URL.
- **Paywall:** Stripe monthly subscriptions plus one-off credit packs. Plans (price, video limit, image credits, allowed
  image models, usage rights) are managed in Admin → Plans and pushed to Stripe from there.
- **Image credits:** `generate_image` calls fal.ai with the owner's key. Monthly plan credits are spent first, then top-up
  credits; failed generations are refunded. Ledger in `credit_ledger`.

## Configuration

Only three environment variables (see `.env.example`): `DATABASE_URL`, `APP_URL`, `APP_SECRET`. Optional: `SETUP_CODE`,
`ADMIN_EMAILS` (recovery admin), `FAL_API_BASE` (tests only).

Everything else is set in **Admin → Settings** and stored encrypted (AES-256-GCM, key derived from `APP_SECRET`) in the
`settings` table: brand (name, tagline, accent, logo, support email, companion npm name), Stripe (secret key, webhook
secret, created automatically on https deployments), Google OAuth client, image generation (fal.ai key, models, credits).
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `GOOGLE_CLIENT_ID/SECRET` and `FAL_KEY` env vars still work as fallbacks.

First run: with no admin user, `/` redirects to `/setup`, which prints a one-time code to the server log (or uses
`SETUP_CODE`), creates the admin and seeds the three default plans.

## Stack

Next.js 16 (App Router) · Drizzle ORM on Postgres (embedded PGlite locally) · Stripe Billing · MCP TypeScript SDK
(stateless Streamable HTTP) · own OAuth 2.1 server (dynamic client registration + PKCE) · Tailwind 4 · fal.ai.

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
for Claude Desktop (proxies the site's tools with an API key; adds `install_engine`, `download_file`, workspace file tools,
`run_command` / `job_status`, `open_editor`) or as the editor bridge (`--editor`). `npm publish` vendors
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

| Tool | What it does | Counts toward limit |
|---|---|---|
| `list_engines` | Published engines with tags | no |
| `start_project` | Picks an engine from the brief (keyword + tag match) and returns `SKILL.md` with a site preamble | **yes** |
| `get_guide` | Returns one `reference/*.md` file | no |
| `get_scripts` | Signed bundle URL + install commands | no |
| `generate_image` | fal.ai image with the user's credits (plan model limits, refunds on failure) | credits |
| `account_status` | Plan, usage, renewal date, credits, allowed models | no |

Every call is logged to `usage_events` for the admin analytics.

## Adding an engine

Upload a skill ZIP (standalone or plugin layout) in **Admin → Engines**. The engine root is wherever the shallowest `SKILL.md` is; its
frontmatter `name` becomes the slug. Set tags so `start_project` can route briefs to it, then tick **Published**.
