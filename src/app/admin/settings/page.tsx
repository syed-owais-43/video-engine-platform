import Link from "next/link";
import { and, count, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { engines, libraryItems, plans } from "@/db/schema";
import { baseUrl } from "@/lib/config";
import { getSettings, mask } from "@/lib/settings";
import { webhookUrl } from "@/lib/stripe-admin";
import { blobEnabled } from "@/lib/storage";
import { disconnectStripe } from "./actions";
import { BrandForm, GoogleForm, StripeForm } from "./forms";

function Step({ done, children, optional }: { done: boolean; children: React.ReactNode; optional?: boolean }) {
  return (
    <li className="flex items-start gap-3 text-sm">
      <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] ${done ? "border-ok bg-ok/15 text-ok" : "border-line text-faint"}`}>
        {done ? "✓" : ""}
      </span>
      <span className={done ? "text-muted line-through decoration-line" : ""}>
        {children} {optional && <span className="text-xs text-faint">(optional)</span>}
      </span>
    </li>
  );
}

export default async function AdminSettings(props: PageProps<"/admin/settings">) {
  const welcome = (await props.searchParams).welcome === "1";
  const s = await getSettings();
  const shelf = (kind: "style" | "ref" | "pack") =>
    db.select({ n: count() }).from(libraryItems).where(and(eq(libraryItems.kind, kind), eq(libraryItems.published, true)));
  const [[{ published }], [{ priced }], [styles], [packs]] = await Promise.all([
    db.select({ published: count() }).from(engines).where(eq(engines.published, true)),
    db.select({ priced: count() }).from(plans).where(isNotNull(plans.stripePriceId)),
    shelf("style"),
    shelf("pack"),
  ]);
  const stripeOn = Boolean(s.stripe.secretKey);
  const googleOn = Boolean(s.google.clientId && s.google.clientSecret);
  const isHttps = baseUrl().startsWith("https://");

  return (
    <div className="space-y-5">
      <section className={`card ${welcome ? "border-ember/60" : ""}`}>
        <p className="label">{welcome ? "Welcome! Finish setting up" : "Setup checklist"}</p>
        <ul className="mt-3 space-y-2.5">
          <Step done={s.brand.name !== "Framewright" || Boolean(s.brand.logo)}>Set your site name, logo and colour (Brand, below)</Step>
          <Step done={stripeOn}>Connect Stripe so customers can pay (Payments, below)</Step>
          <Step done={stripeOn && Boolean(s.stripe.webhookSecret)}>Stripe webhook active (automatic once the site is on https)</Step>
          <Step done={priced > 0}>
            Publish your plans to Stripe in <Link href="/admin/plans" className="underline">Plans</Link>
          </Step>
          <Step done={published > 0}>
            Publish at least one video engine in <Link href="/admin/engines" className="underline">Engines</Link>
          </Step>
          <Step done={blobEnabled()}>Connect a Vercel Blob store for videos and packs (Vercel → Storage → Create → Blob)</Step>
          <Step done={styles.n > 0}>
            Publish styles in <Link href="/admin/styles" className="underline">Styles</Link>
          </Step>
          <Step done={packs.n > 0}>
            Publish sound, font, texture or Lottie packs in <Link href="/admin/packs" className="underline">Packs</Link>
          </Step>
          <Step done={googleOn} optional>Let customers sign in with Google (Google sign-in, below)</Step>
          <Step done={s.brand.companionPackage !== "framewright-companion"} optional>
            Publish the companion to npm under your own name and enter it in Brand
          </Step>
        </ul>
      </section>

      <section className="card">
        <h2 className="display text-3xl">Brand</h2>
        <p className="mb-5 text-sm text-muted">How the site looks to customers.</p>
        <BrandForm brand={s.brand} />
      </section>

      <section className="card">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="display text-3xl">Payments (Stripe)</h2>
          <span className={`pill ${stripeOn ? "border-ok/40 text-ok" : "border-line text-muted"}`}>{stripeOn ? (s.stripe.secretKey.includes("_test_") ? "connected · test mode" : "connected · live") : "not connected"}</span>
        </div>
        <p className="mb-5 text-sm text-muted">
          Subscriptions are charged through your Stripe account. Stripe must support the country your business is
          registered in.
        </p>
        <StripeForm connected={stripeOn} maskedKey={mask(s.stripe.secretKey)} hasWebhook={Boolean(s.stripe.webhookSecret)} webhookUrl={webhookUrl()} isHttps={isHttps} />
        {stripeOn && (
          <form action={disconnectStripe} className="mt-3 text-right">
            <button className="text-xs text-bad hover:underline">Disconnect Stripe</button>
          </form>
        )}
      </section>

      <section className="card">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="display text-3xl">Google sign-in</h2>
          <span className={`pill ${googleOn ? "border-ok/40 text-ok" : "border-line text-muted"}`}>{googleOn ? "on" : "off"}</span>
        </div>
        <p className="mb-5 text-sm text-muted">Optional. Email and password sign-in always works.</p>
        <GoogleForm configured={googleOn} clientId={s.google.clientId} redirectUri={`${baseUrl()}/api/auth/google/callback`} origin={baseUrl()} />
      </section>
    </div>
  );
}
