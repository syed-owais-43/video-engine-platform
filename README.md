# Framewright

A paywalled MCP server and website that serves video-generation engines (Claude skills) to a subscriber's own AI. The user describes a
video in Claude Code, Cursor or Claude Desktop; the AI calls Framewright to pick an engine, reads its instructions live, installs the
engine's helper scripts locally and renders the video on the user's machine.

```
User's AI ──MCP (OAuth or API key)──▶ /api/mcp ──▶ start_project / get_guide / get_scripts
   │                                                     │
   └── renders locally with Node/Python/FFmpeg ◀── signed bundle download (scripts + templates)
```

- **Instructions stay on the server.** `SKILL.md` and `reference/**` are only ever sent through MCP tool calls, on every session, to
  active subscribers. They are never in the downloadable bundle.
- **Scripts are local.** Everything else in the engine (scripts, templates, licence) is a ZIP served from a 15-minute signed URL.
- **Paywall:** Stripe monthly subscriptions. Plans (price, project limit, features) are managed in the admin panel. A "project" is one
  `start_project` call; the limit resets each billing period.

## Stack

Next.js 16 (App Router) · Drizzle ORM on Postgres (embedded PGlite locally) · Stripe Billing · MCP TypeScript SDK (stateless Streamable
HTTP) · own OAuth 2.1 server (dynamic client registration + PKCE) · Tailwind 4.

## Run locally

```bash
npm install
cp .env.example .env.local    # set ADMIN_EMAILS to your email
npm run engine:import -- ../motion-video-director/skills/motion-video-director --version 3.5.2 --name "Motion Video Director" --tags "motion graphics,kinetic typography,explainer,promo" --publish
npm run dev
```

With no `DATABASE_URL`, data lives in `.data/pglite` (one process at a time: stop `npm run dev` before running import scripts).
Sign up with an email listed in `ADMIN_EMAILS` to get the admin panel at `/admin`.

Smoke-test the MCP server with an API key from the dashboard:

```bash
FW_KEY=fw_... node scripts/smoke-mcp.mjs '[["list_engines",{}],["account_status",{}]]'
```

## Deploy (Vercel + Neon)

1. Create a Postgres database (Neon, Supabase…) and run `DATABASE_URL=... npm run db:migrate`.
2. Import the engine against that database: `DATABASE_URL=... npm run engine:import -- <folder> --version 3.5.2 --publish`
   (later versions can be uploaded as ZIPs from **Admin → Engines**).
3. Deploy to Vercel with every variable from `.env.example`. `APP_URL` must be the public https URL. `APP_SECRET` is required.
4. Google sign-in: create an OAuth client (Web) in Google Cloud Console with redirect URI `<APP_URL>/api/auth/google/callback`.
5. Stripe:
   - Create a Product with a monthly recurring Price, then add a plan with that `price_…` id in **Admin → Plans**.
   - Add a webhook endpoint `<APP_URL>/api/stripe/webhook` with events `checkout.session.completed`,
     `customer.subscription.created|updated|deleted|paused|resumed`; put its signing secret in `STRIPE_WEBHOOK_SECRET`.
   - Enable the Customer Portal (Settings → Billing → Customer portal) so users can cancel and change cards.
   - Local testing: `stripe listen --forward-to localhost:3000/api/stripe/webhook`.
   - Stripe doesn't onboard businesses based in Bangladesh; the account needs an entity in a supported country (e.g. via Stripe Atlas).
     Until then, use test-mode keys.

## Companion (Claude Desktop)

`companion/` is a separate npm package, `framewright-companion`, that Claude Desktop runs over stdio. It proxies the engine tools using an
API key and adds `install_engine`, `list_files`, `read_file`, `write_file` (workspace only) and `run_command` / `job_status`.
Publish it before launch so the `npx -y framewright-companion` setup on `/docs` works:

```bash
cd companion && npm publish
```

If the npm name is taken, change `name` in `companion/package.json` and `COMPANION_PACKAGE` in `src/components/connect-guide.tsx`.

## Editable export (Premiere Pro · DaVinci Resolve · Final Cut Pro)

`shared/framewright-tools/` holds engine-independent tools:

- `export.md` — served live via `get_guide` at path `framewright/export.md` for every engine; tells the AI how to render scene
  layers, a transparent caption overlay and audio stems, and how to write `framewright.timeline.json`.
- `fw-export.mjs` — added to every engine bundle at `<skill>/framewright/fw-export.mjs`. `validate` / `package` a timeline
  into a folder with `.fcpxml` (Final Cut, Resolve), Premiere XML (Premiere, Resolve), `.srt` captions, `Media/` and a README.

Engines need a way to render one layer with transparency. motion-video-director 3.5.3 (built in `../engine-builds/`) adds
`render.js --layers <ids> --alpha`; the client's original 3.5.2 folder is unchanged.

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
| `start_project` | Picks an engine from the brief (keyword + tag match) and returns `SKILL.md` with a Framewright preamble | **yes** |
| `get_guide` | Returns one `reference/*.md` file | no |
| `get_scripts` | Signed bundle URL + install commands | no |
| `account_status` | Plan, usage, renewal date | no |

Every call is logged to `usage_events` for the admin analytics.

## Adding an engine

Upload a skill ZIP (standalone or plugin layout) in **Admin → Engines**. The engine root is wherever the shallowest `SKILL.md` is; its
frontmatter `name` becomes the slug. Set tags so `start_project` can route briefs to it, then tick **Published**.
