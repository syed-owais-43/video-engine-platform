import type { Metadata } from "next";
import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { plans } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { getAccess } from "@/lib/access";
import { startCheckout } from "../dashboard/billing-actions";

export const metadata: Metadata = { title: "Pricing" };

export default async function PricingPage() {
  const [user, list] = await Promise.all([
    getCurrentUser(),
    db.select().from(plans).where(eq(plans.active, true)).orderBy(asc(plans.sort), asc(plans.name)),
  ]);
  const access = user ? await getAccess(user) : null;

  return (
    <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
      <p className="eyebrow">Pricing</p>
      <h1 className="display mt-4 text-6xl sm:text-7xl">One subscription. Every engine.</h1>
      <p className="mt-5 max-w-2xl text-muted">
        Billed monthly. Cancel any time. Videos render on your own machine, so there are no render credits or upload limits.
      </p>

      {list.length === 0 ? (
        <div className="card mt-12 text-muted">Plans are being finalised. Check back soon.</div>
      ) : (
        <div className={`mt-12 grid gap-5 ${list.length > 1 ? "md:grid-cols-2 lg:grid-cols-3" : "max-w-md"}`}>
          {list.map((p, i) => {
            const current = access?.source === "subscription" && access.plan?.id === p.id;
            return (
              <div key={p.id} className={`card flex flex-col ${i === 0 && list.length > 1 ? "border-ember/60" : ""}`}>
                <h2 className="display text-4xl">{p.name}</h2>
                <p className="mt-2 text-2xl">{p.priceLabel}</p>
                {p.description && <p className="mt-3 text-sm text-muted">{p.description}</p>}
                <ul className="mt-6 flex-1 space-y-2 text-sm">
                  <li className="flex gap-2">
                    <span className="text-ember">→</span>
                    {p.monthlyProjects === null ? "Unlimited projects" : `${p.monthlyProjects} projects per month`}
                  </li>
                  {p.features.map((f) => (
                    <li key={f} className="flex gap-2">
                      <span className="text-ember">→</span>
                      {f}
                    </li>
                  ))}
                </ul>
                <div className="mt-8">
                  {current ? (
                    <Link href="/dashboard" className="btn-ghost w-full">Current plan</Link>
                  ) : !user ? (
                    <Link href="/signup?next=/pricing" className="btn-primary w-full">Create account to subscribe</Link>
                  ) : access?.source === "subscription" ? (
                    <Link href="/dashboard" className="btn-ghost w-full">Change plan in billing</Link>
                  ) : (
                    <form action={startCheckout} className="space-y-3">
                      <input type="hidden" name="planId" value={p.id} />
                      <label className="flex items-start gap-2 text-xs text-muted">
                        <input type="checkbox" required className="mt-0.5 accent-[var(--color-ember)]" />
                        <span>
                          I agree to the <Link href="/terms" className="underline">terms and single-user engine licence</Link>.
                        </span>
                      </label>
                      <button className="btn-primary w-full">Subscribe</button>
                    </form>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
