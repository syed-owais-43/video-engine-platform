# Video Engine Platform

A subscription website that lets people make professional videos with **their own AI**.

Customers connect Claude Code, Claude Desktop, Cursor or any MCP-capable AI to your site. They describe a video; their AI
fetches the right video engine from your site and builds the video **on their own computer**. They pay you one flat monthly
subscription (Stripe). On first use their AI sets up their computer by itself. It builds in a look from your **style
library** or **inspiration library** (or from a reference video or link they send), uses your **resource packs** (sound
effects, fonts, textures, Lottie) and narrates with Voicebox (free, local) or the customer's own ElevenLabs key. Customers
fine-tune each scene with sliders in a browser editor without spending AI tokens, and export to MP4, Premiere Pro, DaVinci
Resolve or Final Cut Pro.

You run everything from an **admin panel**: brand, payments, plan, engines, styles, inspiration, packs, users and analytics.

> **Setting this up with Claude?** Open this repository in Claude Code and say:
> *"Read README.md and CLAUDE.md, then guide me through installing and launching this step by step."*
> Claude does the technical parts and tells you exactly what to click. You never paste passwords or API keys into the
> chat; they go into your hosting dashboard or the site's admin panel.

---

## Contents

1. [What you need](#1-what-you-need)
2. [Try it on your computer (optional)](#2-try-it-on-your-computer-optional)
3. [Create the database (Supabase)](#3-create-the-database-supabase)
4. [Put the site online (Vercel)](#4-put-the-site-online-vercel)
5. [Create your admin account](#5-create-your-admin-account)
6. [Configure the admin panel](#6-configure-the-admin-panel)
7. [Publish the Companion](#7-publish-the-companion)
8. [Test as a customer, then go live](#8-test-as-a-customer-then-go-live)
9. [Running the site day to day](#9-running-the-site-day-to-day)
10. [Updating the site](#10-updating-the-site)
11. [Troubleshooting](#11-troubleshooting)
12. [Security](#12-security)

---

## 1. What you need

**Accounts** (free tiers are fine to start):

| Service | Used for | Required |
|---|---|---|
| [GitHub](https://github.com) | your copy of this code | yes |
| [Vercel](https://vercel.com) | hosting the website | yes |
| [Supabase](https://supabase.com) (or Neon) | the database | yes |
| [Stripe](https://stripe.com) | the subscription | yes, to take payments |
| [npm](https://www.npmjs.com) | publishing the Companion app | yes |
| Vercel Blob (inside your Vercel project) | style previews, reference videos and resource packs | yes, once you upload videos or packs |
| [Google Cloud](https://console.cloud.google.com) | "Sign in with Google" | optional |

**Files:**
- This repository.
- **The video engine ZIP** (e.g. `motion-video-director-3.5.3.zip`). It is licensed material and is **not** in this
  repository; you receive it privately. You'll upload it in the admin panel (step 6).

**On your computer** (only for local testing and publishing the Companion): [Node.js 20 or newer](https://nodejs.org).

---

## 2. Try it on your computer (optional)

```bash
git clone https://github.com/<your-account>/video-engine-platform.git
cd video-engine-platform
npm install
npm run dev
```

Open http://localhost:3000. You're sent to **/setup**. The one-time **setup code** is printed in the terminal where
`npm run dev` runs (look for `SETUP CODE`). Locally the site uses a built-in database stored in `.data/`, so nothing else is
needed. Delete the `.data` folder to start over.

---

## 3. Create the database (Supabase)

The site uses Supabase only as a PostgreSQL database (not Supabase Auth or Storage).

1. supabase.com → **New project**. Choose a region close to where you'll host the site (e.g. the same region as Vercel).
   Set a strong **database password** and save it.
2. In the project, click **Connect** → **Connection string** → **Transaction pooler** (port **6543**). It looks like:
   ```
   postgresql://postgres.abcdefghijkl:YOUR-PASSWORD@aws-0-eu-central-1.pooler.supabase.com:6543/postgres
   ```
   - Use the **pooler**, not "Direct connection" (Supabase's direct address is IPv6-only and Vercel can't reach it).
   - Add **`?sslmode=require`** to the end.
   - If the password contains `@ # / ?` or similar, URL-encode them (e.g. `@` → `%40`) or choose a simpler password.
3. Keep this connection string for step 4. The tables are created automatically on the first deploy.

<details>
<summary>Using Neon instead</summary>

Create a project at neon.tech, copy the **pooled** connection string and use it as `DATABASE_URL`. Skip step 6's
Supabase-only security step.
</details>

---

## 4. Put the site online (Vercel)

1. **Fork** this repository (or push your own copy) to your GitHub account.
2. vercel.com → **Add New → Project** → import the repository. Framework preset: Next.js (detected automatically).
3. Before clicking Deploy, open **Environment Variables** and add these three:

| Name | Value |
|---|---|
| `DATABASE_URL` | the Supabase connection string from step 3 (with `?sslmode=require`) |
| `APP_SECRET` | 64 random characters, see below |
| `APP_URL` | your site's address, e.g. `https://yourbrand.com` (optional until you add a domain) |

   Generate `APP_SECRET` on your computer with:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
4. **Deploy.** The build creates all database tables automatically (you'll see them in Supabase → Table Editor).
5. Optional: Vercel → Settings → Domains → add your domain, set `APP_URL` to it, and redeploy.
6. **File storage (Vercel Blob):** your project → **Storage** → **Create Database** → **Blob** → name it → **Create** →
   **Connect** it to this project (all environments). Vercel adds `BLOB_READ_WRITE_TOKEN` by itself; redeploy once. Style
   previews, reference videos and resource packs are stored there. Without it, files go into the database and each upload is
   limited to about 4 MB.

> ⚠️ **Never change `APP_SECRET` after launch.** It encrypts the keys you enter in the admin panel and the ElevenLabs keys
> your customers save. If it changes, you must re-enter the Stripe and Google keys, and customers must re-enter theirs.

### Lock down Supabase's automatic API (do this once)

Supabase automatically publishes `public` tables through its REST API. The site doesn't use that API, so switch it off by
enabling row-level security. In Supabase → **SQL Editor**, run:

```sql
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;
```

The website connects as the database owner and isn't affected. Run it again after any update that adds tables.

---

## 5. Create your admin account

1. Open your site; it sends you to **/setup**.
2. Find the setup code: Vercel → your project → **Logs** → search for `SETUP CODE`. (Open /setup once first so the code is
   created. Can't find it? Click "Print a new code" on the setup page and search again.)
3. Enter the code, your name, email and a strong password. You're now the admin, and /setup is gone for good.

Prefer to choose the code yourself? Add `SETUP_CODE` as a Vercel environment variable before opening /setup.

---

## 6. Configure the admin panel

Go to **Admin → Settings**. The checklist at the top shows what's left.

### Brand
Site name, tagline, logo (PNG/SVG under 200 KB), accent colour, support email. Changes apply across the site immediately.

### Payments (Stripe)
1. Stripe must support the **country your business is registered in**.
2. Start in **test mode**: Stripe Dashboard → Developers → API keys → copy the **Secret key** (`sk_test_…`).
3. Paste it in Admin → Settings → Payments → **Connect Stripe**. The site checks the key, creates the webhook and turns on
   the customer billing portal.
4. **Admin → Plans** → press **Publish to Stripe** on each plan.

### Plan
One flat plan comes pre-filled: **Unlimited, $5.99 / month**. Edit its name, price and features in **Admin → Plans**.
Videos render on your customers' own computers, so there are no video limits or credits to manage.

- Changing a price creates a new Stripe price; existing subscribers keep their old price.
- You can add more plans later, but one is all most sites need.

### Google sign-in, optional
The Settings page shows the exact origin and redirect address to enter in Google Cloud Console → Credentials → OAuth
client ID (Web application). Paste the client ID and secret, save.

### Engines
**Admin → Engines** → upload the engine ZIP, version (e.g. `3.5.3`), tags (e.g. *motion graphics, kinetic typography,
explainer, promo*), tick **Publish engine**. New engines and versions are uploaded the same way.

### Styles and inspiration
Customers' AI learns a look from text and a few still frames; the videos are mainly for people browsing your galleries
(`/styles` and `/inspiration` on your site). Each item is one folder, uploaded as a ZIP.

| Style, e.g. `clean-premium-saas/` | What it is |
|---|---|
| `preview.mp4` | a 5–10 s example, shown in the gallery |
| `style.json` | palette hex codes, fonts, sizes, easing, timings, SFX names |
| `recipe.md` | the rules in plain words: how text enters, transitions, dos and don'ts |
| `frames.jpg` | one contact sheet (key frames in a grid), under 1.5 MB |
| `fonts/`, `sfx/` | the files the style uses (optional) |

| Inspiration, e.g. `apple-recap-kinetic/` | What it is |
|---|---|
| `reference.mp4` | the original video, visible to subscribers only (optional, see the licence note) |
| `breakdown.md` | shot-by-shot timeline, type system, motion, SFX map |
| `frames.jpg` + `hook.jpg` | contact sheet + the first 3 seconds frame by frame |

**Making one:** give Claude a reference video (a file, or a link: it downloads it with yt-dlp). The motion engine's analysis
(`analyze_ref.py`) makes the contact sheets and the breakdown; Claude writes `style.json` and `recipe.md` and zips the
folder. Upload it in **Admin → Styles** or **Admin → Inspiration** and tick **Publish**. No coding needed. Uploading a folder
with the same name again replaces it.

> **Licence:** only include a `reference.mp4` you have the rights to publish. Otherwise ship the frames and breakdown only.

### Resource packs
**Admin → Packs** → upload a ZIP of sound effects, fonts, textures, Lottie animations or music, with a name, a category and a
short description of what's inside (customers' AI reads it), and tick **Publish**. Customers' Companion downloads each pack
once into `~/.framewright/assets`; uploading the same pack again releases a new version. Only include files you're licensed
to redistribute.

### What customers get automatically
- **Computer setup:** the first time their AI connects, it receives a checklist (FFmpeg, Playwright + Chromium, Python with
  analysis and speech models, Voicebox, yt-dlp) and installs everything itself.
- **Voice:** Voicebox (free, runs on their PC) by default. Customers who prefer ElevenLabs paste their own API key in their
  dashboard; it's stored encrypted and never shown to their AI.
- **Scene sliders:** in the timeline editor, each scene's text, colours, size, speed and easing can be changed with sliders
  and re-rendered on their PC, without AI or tokens.

---

## 7. Publish the Companion

Customers using Claude Desktop, and everyone using the timeline editor, run a small app called the Companion with `npx`.
It must be published to npm under a name **you** own (if you skip this, those commands fail or could fetch someone
else's package):

1. In `companion/package.json`, change `"name"` to your own, e.g. `"yourbrand-companion"` (must be unused on npm).
2. Run:
   ```bash
   cd companion
   npm install
   npm login
   npm publish --access public
   ```
3. Admin → Settings → Brand → **Companion npm package**: enter the same name. All setup commands on the site update.

To release an update: bump `"version"` in `companion/package.json` and run `npm publish` again.

---

## 8. Test as a customer, then go live

1. Open the site in a private window, create a customer account and choose a plan.
2. Pay with Stripe's test card `4242 4242 4242 4242`, any future date, any CVC.
3. Dashboard → **Connect your AI**: follow the steps for Claude Code or Claude Desktop, then ask your AI for a short video.
4. Pick a style from `/styles`, and try the timeline editor with its scene sliders.
5. **Go live:** copy Stripe's **live** secret key (`sk_live_…`) into Settings → Payments. Test and live mode are separate,
   so press **Publish to Stripe** on the plan again (the site reminds you).

---

## 9. Running the site day to day

| Task | Where |
|---|---|
| Signups, videos started, engine and tool usage | Admin → Analytics |
| Give someone free access | Admin → Users → **Comp** |
| Someone forgot their password | Admin → Users → **Reset password**, then send them the temporary password |
| Make someone an admin | Admin → Users → **Admin** |
| Price and plan features | Admin → Plans |
| New style, reference or pack | Admin → Styles / Inspiration / Packs → upload ZIP, tick Published |
| Refunds, cancellations, invoices | Stripe Dashboard (customers can also cancel from their dashboard) |
| New engine or version | Admin → Engines → upload ZIP |
| Roll back an engine | Admin → Engines → **Make current** on an older version |

---

## 10. Updating the site

Push changes to the GitHub repository; Vercel deploys automatically and applies any database changes during the build.
Before deploying a code change, run locally: `npx tsc --noEmit`, `npx eslint src`, `npm run build`.

---

## 11. Troubleshooting

| Problem | Fix |
|---|---|
| Can't find the setup code | /setup → "Print a new code", then search Vercel Logs for `SETUP CODE`, or set `SETUP_CODE` in Vercel. |
| Locked out of the admin account | Add `ADMIN_EMAILS=you@example.com` in Vercel and redeploy; log in or sign up with that email. Remove it afterwards. |
| Error "DATABASE_URL is not set" | Add it in Vercel → Settings → Environment Variables, then redeploy. |
| Database connection errors on Vercel | Use Supabase's **Transaction pooler** string (port 6543) with `?sslmode=require`, not "Direct connection". |
| Payments go through but subscriptions don't activate | Settings → Payments should show the webhook as set. In Stripe → Developers → Webhooks, the endpoint `https://<your-site>/api/stripe/webhook` should show successful deliveries. Reconnecting Stripe recreates it. |
| "Stripe isn't connected" after changing `APP_SECRET` | Re-enter all keys in Settings. |
| Customers' editor can't connect | They need the Companion running (the editor explains how), desktop Chrome, Edge or Firefox, and to allow "local network access" if asked. Safari isn't supported. |
| "Uploads are limited to 4 MB" in Styles / Inspiration / Packs | Connect a Vercel Blob store (step 4.6) and redeploy. |
| `npx <companion> … 404 Not Found` | The Companion isn't published yet, or the name in Admin → Settings → Brand doesn't match npm (step 7). |

---

## 12. Security

- **Never commit secrets.** Keys belong in the admin panel (stored encrypted) or in Vercel's environment variables. `.env*`
  files and the local `.data/` database are ignored by git.
- **Never commit the engine ZIP** or any engine files. This repository is public; the engine is licensed material that
  customers only receive through the site.
- Customer videos, references and files never touch your server; only the engine instructions and your library files do.
  Customers' own ElevenLabs keys are stored encrypted and only used by the server to call ElevenLabs for them.

---

Technical reference (architecture, MCP tools, editor internals): [docs/TECHNICAL.md](docs/TECHNICAL.md).
