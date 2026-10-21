import Link from "next/link";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { creditPacks, plans } from "@/db/schema";
import { getSettings } from "@/lib/settings";
import { formatPrice } from "@/lib/stripe-admin";
import { PackForm, PlanForm, PublishPlanButton } from "../forms";

export default async function AdminPlans() {
  const [list, packs, s] = await Promise.all([
    db.select().from(plans).orderBy(asc(plans.sort), asc(plans.name)),
    db.select().from(creditPacks).orderBy(asc(creditPacks.sort), asc(creditPacks.credits)),
    getSettings(),
  ]);
  const stripeOn = Boolean(s.stripe.secretKey);
  const models = s.images.models.map((m) => ({ key: m.key, label: `${m.label} (${m.credits} cr)` }));

  return (
    <div className="space-y-5">
      {!stripeOn && (
        <p className="rounded-xl border border-warn/40 px-4 py-3 text-sm text-warn">
          Stripe isn&apos;t connected, so nobody can subscribe yet. Connect it in <Link href="/admin/settings" className="underline">Settings</Link>,
          then press &ldquo;Publish to Stripe&rdquo; on each plan.
        </p>
      )}

      {list.map((p) => (
        <section key={p.id} className="card">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <h2 className="display text-3xl">{p.name}</h2>
              <span className={`pill ${p.stripePriceId ? "border-ok/40 text-ok" : "border-warn/40 text-warn"}`}>
                {p.stripePriceId ? "on Stripe" : "not on Stripe yet"}
              </span>
              {!p.active && <span className="pill border-line text-muted">hidden</span>}
            </div>
            {stripeOn && <PublishPlanButton id={p.id} published={Boolean(p.stripePriceId)} />}
          </div>
          <PlanForm plan={p} models={models} />
        </section>
      ))}

      <section className="card">
        <p className="label">New plan</p>
        <PlanForm models={models} />
      </section>

      <section className="card">
        <h2 className="display text-3xl">Credit packs</h2>
        <p className="mb-5 text-sm text-muted">
          One-off top-ups for image credits. They never expire and are used after the plan&apos;s monthly credits run out. Saving a
          pack creates or updates its Stripe price automatically.
        </p>
        <div className="space-y-4">
          {packs.map((pk) => (
            <div key={pk.id} className="rounded-xl border border-line p-4">
              <p className="mb-2 text-xs text-faint">
                {pk.credits} credits for {formatPrice(pk.priceCents, pk.currency, false)} · {pk.stripePriceId ? "on Stripe" : "not on Stripe yet"}
              </p>
              <PackForm pack={pk} />
            </div>
          ))}
          <div className="rounded-xl border border-dashed border-line p-4">
            <PackForm />
          </div>
        </div>
      </section>
    </div>
  );
}
