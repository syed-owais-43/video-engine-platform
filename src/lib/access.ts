import { and, count, desc, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/db";
import { plans, subscriptions, usageEvents, type Plan, type User } from "@/db/schema";

export const ACTIVE_STATUSES = ["active", "trialing"];
export const PROJECT_TOOL = "start_project";

export type Access = {
  active: boolean;
  source: "comp" | "subscription" | null;
  plan: Plan | null;
  limit: number | null; // projects per period; null = unlimited
  used: number;
  periodStart: Date;
  periodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  status: string | null;
};

function monthStart() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export async function getAccess(user: Pick<User, "id" | "compAccess">): Promise<Access> {
  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, user.id))
    .orderBy(desc(subscriptions.updatedAt))
    .limit(1);
  const subActive = !!sub && ACTIVE_STATUSES.includes(sub.status);
  const [plan] = subActive ? await db.select().from(plans).where(eq(plans.stripePriceId, sub.priceId)) : [];

  const periodStart = (subActive && sub.currentPeriodStart) || monthStart();
  const [{ n }] = await db
    .select({ n: count() })
    .from(usageEvents)
    .where(and(eq(usageEvents.userId, user.id), eq(usageEvents.tool, PROJECT_TOOL), gte(usageEvents.createdAt, periodStart)));

  const base = { used: n, periodStart, status: sub?.status ?? null, cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false };
  if (user.compAccess) {
    return { ...base, active: true, source: "comp", plan: plan ?? null, limit: null, periodEnd: null };
  }
  if (subActive) {
    return {
      ...base,
      active: true,
      source: "subscription",
      plan: plan ?? null,
      limit: plan?.monthlyProjects ?? null,
      periodEnd: sub.currentPeriodEnd,
    };
  }
  return { ...base, active: false, source: null, plan: null, limit: null, periodEnd: null };
}

export async function activeSubscriberIds(): Promise<Set<string>> {
  const rows = await db
    .select({ userId: subscriptions.userId })
    .from(subscriptions)
    .where(inArray(subscriptions.status, ACTIVE_STATUSES));
  return new Set(rows.map((r) => r.userId));
}
