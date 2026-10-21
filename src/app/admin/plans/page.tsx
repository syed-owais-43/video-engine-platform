import { asc } from "drizzle-orm";
import { db } from "@/db";
import { plans } from "@/db/schema";
import { stripeConfigured } from "@/lib/config";
import { PlanForm } from "../forms";

export default async function AdminPlans() {
  const list = await db.select().from(plans).orderBy(asc(plans.sort), asc(plans.name));
  return (
    <div className="space-y-5">
      {!stripeConfigured() && (
        <p className="rounded-xl border border-warn/40 px-4 py-3 text-sm text-warn">
          STRIPE_SECRET_KEY isn&apos;t set, so checkout is disabled. Plans still show on the pricing page.
        </p>
      )}
      <section className="card">
        <p className="label">New plan</p>
        <p className="mb-5 text-sm text-muted">
          Create a recurring monthly Price in Stripe (Product catalogue → Add product), then paste its <code className="font-mono">price_…</code> id here.
        </p>
        <PlanForm />
      </section>
      {list.map((p) => (
        <section key={p.id} className="card">
          <p className="label">{p.active ? "Live plan" : "Hidden plan"}</p>
          <PlanForm plan={p} />
        </section>
      ))}
    </div>
  );
}
