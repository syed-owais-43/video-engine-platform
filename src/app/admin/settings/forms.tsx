"use client";

import { useActionState, useState } from "react";
import { saveBrand, saveGoogle, saveStripe, type ActionState } from "./actions";

function Status({ state }: { state: ActionState }) {
  if (state?.error) return <p className="text-sm text-bad">{state.error}</p>;
  if (state?.ok) return <p className="text-sm text-ok">{state.ok}</p>;
  return null;
}

export function BrandForm({ brand }: { brand: { name: string; tagline: string; accent: string; supportEmail: string; logo: string | null; companionPackage: string } }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveBrand, undefined);
  const [accent, setAccent] = useState(brand.accent);
  return (
    <form action={action} className="grid gap-4 md:grid-cols-2">
      <div>
        <label className="label">Site name</label>
        <input name="name" required defaultValue={brand.name} className="input" />
      </div>
      <div>
        <label className="label">Tagline</label>
        <input name="tagline" defaultValue={brand.tagline} className="input" />
      </div>
      <div>
        <label className="label">Accent colour</label>
        <div className="flex gap-2">
          <input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} className="h-10 w-12 cursor-pointer rounded border border-line bg-ink" />
          <input name="accent" value={accent} onChange={(e) => setAccent(e.target.value)} className="input font-mono" />
        </div>
      </div>
      <div>
        <label className="label">Support email (shown in the footer)</label>
        <input name="supportEmail" type="email" defaultValue={brand.supportEmail} className="input" />
      </div>
      <div>
        <label className="label">Logo (PNG/SVG, under 200 KB)</label>
        <div className="flex items-center gap-3">
          {brand.logo && <img src={brand.logo} alt="" className="h-9 w-9 rounded border border-line object-contain" />}
          <input name="logo" type="file" accept="image/png,image/svg+xml,image/jpeg,image/webp" className="input file:mr-3 file:rounded-full file:border-0 file:bg-ink-3 file:px-3 file:py-1 file:text-paper" />
        </div>
        {brand.logo && (
          <label className="mt-2 flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" name="removeLogo" className="accent-[var(--color-ember)]" /> Remove logo
          </label>
        )}
      </div>
      <div>
        <label className="label">Companion npm package</label>
        <input name="companionPackage" defaultValue={brand.companionPackage} className="input font-mono" />
        <p className="mt-1 text-xs text-faint">The name you publish the companion under. Used in every setup command shown to customers.</p>
      </div>
      <div className="flex items-center justify-end gap-4 md:col-span-2">
        <Status state={state} />
        <button className="btn-primary" disabled={pending}>{pending ? "Saving…" : "Save brand"}</button>
      </div>
    </form>
  );
}

export function StripeForm({ connected, maskedKey, hasWebhook, webhookUrl, isHttps }: { connected: boolean; maskedKey: string; hasWebhook: boolean; webhookUrl: string; isHttps: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveStripe, undefined);
  return (
    <form action={action} className="space-y-4">
      <div>
        <label className="label">Secret key</label>
        <input name="secretKey" type="password" autoComplete="off" placeholder={connected ? `Connected: ${maskedKey}. Paste a new key to replace it.` : "sk_live_… or sk_test_…"} className="input font-mono" />
        <p className="mt-1 text-xs text-faint">Stripe Dashboard → Developers → API keys → Secret key. Use a test key (sk_test_) until you&apos;re ready to take real payments.</p>
      </div>
      <div>
        <label className="label">Webhook signing secret {hasWebhook ? "(set)" : ""}</label>
        <input name="webhookSecret" type="password" autoComplete="off" placeholder={hasWebhook ? "Set. Paste a new one only to replace it." : "whsec_…"} className="input font-mono" />
        <p className="mt-1 text-xs text-faint">
          {isHttps
            ? "Filled in automatically when you connect. Only needed if you created the webhook yourself."
            : "Needed while testing locally."}{" "}
          Webhook URL: <code className="font-mono text-paper">{webhookUrl}</code>
        </p>
      </div>
      <div className="flex items-center justify-end gap-4">
        <Status state={state} />
        <button className="btn-primary" disabled={pending}>{pending ? "Checking with Stripe…" : connected ? "Save" : "Connect Stripe"}</button>
      </div>
    </form>
  );
}

export function GoogleForm({ configured, clientId, redirectUri, origin }: { configured: boolean; clientId: string; redirectUri: string; origin: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveGoogle, undefined);
  return (
    <form action={action} className="space-y-4">
      <ol className="list-decimal space-y-1 pl-5 text-xs text-muted">
        <li>Google Cloud Console → APIs &amp; Services → Credentials → Create credentials → OAuth client ID → Web application.</li>
        <li>
          Authorised JavaScript origin: <code className="font-mono text-paper">{origin}</code>
        </li>
        <li>
          Authorised redirect URI: <code className="font-mono text-paper">{redirectUri}</code>
        </li>
        <li>Paste the client ID and secret here. (OAuth consent screen: app name = your site name, scopes = email, profile.)</li>
      </ol>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="label">Client ID</label>
          <input name="clientId" defaultValue={clientId} className="input font-mono" placeholder="….apps.googleusercontent.com" />
        </div>
        <div>
          <label className="label">Client secret</label>
          <input name="clientSecret" type="password" autoComplete="off" placeholder={configured ? "Set. Paste a new one to replace it." : "GOCSPX-…"} className="input font-mono" />
        </div>
      </div>
      <div className="flex items-center justify-between gap-4">
        {configured ? (
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" name="disable" className="accent-[var(--color-ember)]" /> Turn Google sign-in off
          </label>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-4">
          <Status state={state} />
          <button className="btn-primary" disabled={pending}>{pending ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </form>
  );
}
