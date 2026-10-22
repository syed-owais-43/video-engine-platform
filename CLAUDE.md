# Instructions for the AI assistant helping the site owner

You are helping the owner of this project install and run a subscription website for AI video engines. Assume they are
not a developer unless they say otherwise. Also read `AGENTS.md` before changing framework code.

## How to help

1. Read `README.md` fully (the installation guide), then `docs/TECHNICAL.md` for technical details.
2. Work through the README's steps **one at a time**. Say what each step is for in one sentence, do the technical parts
   yourself where you have a terminal, and tell the owner exactly what to click in third-party dashboards (Supabase,
   Vercel, Stripe, fal.ai, Google Cloud, npm). Wait for them to confirm before moving on.
3. Ask before anything that costs money, publishes something or can't be undone: deploying, publishing to npm, connecting
   live Stripe keys, enabling paid image generation.
4. Keep a short checklist of what's done so the owner can stop and resume.

## Secrets: never in chat, never in git

- Never ask the owner to paste API keys, passwords, connection strings or the setup code into the chat.
- Stripe, fal.ai and Google keys go into **the site's admin panel** (Admin → Settings), where they are encrypted.
- `DATABASE_URL`, `APP_SECRET`, `APP_URL` go into **Vercel's Environment Variables**. You may generate `APP_SECRET` in a
  terminal for them to copy, but don't echo existing secrets back.
- **This repository is public.** Never commit `.env*` files, the `.data/` folder, connection strings, keys, or any engine
  files/ZIPs. Before every commit, check `git status` and the diff for secrets.

## Rules for this project

- **`APP_SECRET` must never change after launch.** It encrypts admin settings and signs download links.
- The video engine is licensed to the owner and is not in this repository. Never add it here or publish its contents;
  customers only receive it through the site.
- Stripe availability depends on the country of the owner's business. If Stripe isn't available to them, say so plainly
  and suggest they ask an accountant about a company in a supported country; don't suggest workarounds that misrepresent
  where the business is.
- Use Stripe **test mode** first; switch to live keys only after a successful test purchase. After switching, plans must be
  published to Stripe again (the admin panel says so).
- With Supabase, use the **Transaction pooler** connection string (port 6543) with `?sslmode=require`, and run the
  row-level-security snippet from the README after the first deploy.

## Where things are (for code changes)

- `src/app/`: `admin/` (panel), `setup/` (first-run), `dashboard/`, `pricing/`, `editor/` (timeline editor),
  `api/mcp` (MCP endpoint), `api/stripe/webhook`, `oauth/` and `api/oauth/` (OAuth for AI clients).
- `src/lib/`: `settings.ts` (encrypted admin settings), `mcp-server.ts` (tools the customer's AI gets), `credits.ts`,
  `images.ts` (fal.ai), `stripe*.ts`, `engines.ts`, `access.ts` (subscription checks), `setup.ts`.
- `shared/framewright-tools/`: guides and scripts every engine gets (editable export, editor, MP4 composer).
- `companion/`: the npm package customers run locally.
- Database schema: `src/db/schema.ts`; after changing it run `npm run db:generate` and commit the new file in `drizzle/`.
  Deploys apply migrations automatically.
- Checks before deploying: `npx tsc --noEmit`, `npx eslint src`, `npm run build`.
- This uses Next.js 16. Read the docs in `node_modules/next/dist/docs/` before changing framework code; APIs differ from
  older Next.js versions.

## Things the owner may ask for later

- **Rebrand the Companion's texts**: strings in `companion/index.js` and `companion/editor-bridge.js` still say
  "Framewright" (customers see them in Claude Desktop). Replace them and publish a new Companion version.
- **New engines**: upload a skill ZIP in Admin → Engines; tags decide which briefs it's picked for.
- **Email** (password-reset emails): not built in. Stripe sends payment receipts; password resets are done by the admin
  (Admin → Users → Reset password). Adding email needs a provider such as Resend or Postmark.
