import Link from "next/link";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { plans } from "@/db/schema";
import { getSettings } from "@/lib/settings";
import { PlanForm, PublishPlanButton } from "../forms";

export default async function AdminPlans() {
  const [list, s] = await Promise.all([db.select().from(plans).orderBy(asc(plans.sort), asc(plans.name)), getSettings()]);
  const stripeOn = Boolean(s.stripe.secretKey);

  return (
    <div className="space-y-5">
      {!stripeOn && (
        <p className="rounded-xl border border-warn/40 px-4 py-3 text-sm text-warn">
          Stripe isn&apos;t connected, so nobody can subscribe yet. Connect it in <Link href="/admin/settings" className="underline">Settings</Link>,
          then press &ldquo;Publish to Stripe&rdquo; on each plan.
        </p>
      )}

      <p className="text-sm text-muted">
        One flat subscription is all most sites need: videos render on each customer&apos;s own computer, so there are no limits to
        sell. You can still add more plans below if you ever need them.
      </p>

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
          <PlanForm plan={p} />
        </section>
      ))}

      <section className="card">
        <p className="label">New plan</p>
        <PlanForm />
      </section>
    </div>
  );
}
