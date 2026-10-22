import { desc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { plans, subscriptions, type Plan, type User } from "@/db/schema";

export const ACTIVE_STATUSES = ["active", "trialing"];
// Logged for analytics only: one flat subscription, no per-plan video limits (videos render on the
// user's own computer, so they cost the site nothing).
export const PROJECT_TOOL = "start_project";

export type Access = {
  active: boolean;
  source: "comp" | "subscription" | null;
  plan: Plan | null;
  periodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  status: string | null;
};

// A plan matches its current Stripe price or any earlier one (subscribers keep old prices).
export function planForPrice(priceId: string) {
  return db
    .select()
    .from(plans)
    .where(or(eq(plans.stripePriceId, priceId), sql`${plans.legacyPriceIds} @> ${JSON.stringify([priceId])}::jsonb`))
    .limit(1);
}

export async function getAccess(user: Pick<User, "id" | "compAccess">): Promise<Access> {
  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, user.id))
    .orderBy(desc(subscriptions.updatedAt))
    .limit(1);
  const subActive = !!sub && ACTIVE_STATUSES.includes(sub.status);
  const [plan] = subActive ? await planForPrice(sub.priceId) : [];

  const base = { status: sub?.status ?? null, cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false };
  if (user.compAccess) return { ...base, active: true, source: "comp", plan: plan ?? null, periodEnd: null };
  if (subActive) return { ...base, active: true, source: "subscription", plan: plan ?? null, periodEnd: sub.currentPeriodEnd };
  return { ...base, active: false, source: null, plan: null, periodEnd: null };
}

export async function activeSubscriberIds(): Promise<Set<string>> {
  const rows = await db
    .select({ userId: subscriptions.userId })
    .from(subscriptions)
    .where(inArray(subscriptions.status, ACTIVE_STATUSES));
  return new Set(rows.map((r) => r.userId));
}
