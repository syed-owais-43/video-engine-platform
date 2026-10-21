import "server-only";
import { and, desc, eq, sql, sum } from "drizzle-orm";
import { db } from "@/db";
import { creditLedger, users, type User } from "@/db/schema";
import { getAccess, type Access } from "./access";

// Credits come from two buckets:
// - monthly: the plan's allowance for the current billing period (unused credits expire),
// - topup:   purchased packs and admin adjustments, which never expire.
// Spending always uses monthly credits first.

export type Balance = {
  monthlyAllowance: number;
  monthlyUsed: number;
  monthlyLeft: number;
  topup: number;
  total: number;
  periodStart: Date;
  access: Access;
};

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function sums(q: Tx | typeof db, userId: string, periodStart: Date) {
  const [[m], [t]] = await Promise.all([
    q
      .select({ n: sum(creditLedger.delta) })
      .from(creditLedger)
      .where(and(eq(creditLedger.userId, userId), eq(creditLedger.bucket, "monthly"), eq(creditLedger.periodStart, periodStart))),
    q.select({ n: sum(creditLedger.delta) }).from(creditLedger).where(and(eq(creditLedger.userId, userId), eq(creditLedger.bucket, "topup"))),
  ]);
  return { monthlyNet: Number(m?.n ?? 0), topup: Number(t?.n ?? 0) };
}

export async function getBalance(user: Pick<User, "id" | "compAccess">): Promise<Balance> {
  const access = await getAccess(user);
  const allowance = access.active ? (access.plan?.monthlyCredits ?? 0) : 0;
  const { monthlyNet, topup } = await sums(db, user.id, access.periodStart);
  const used = Math.max(0, -monthlyNet);
  const left = Math.max(0, allowance - used);
  return { monthlyAllowance: allowance, monthlyUsed: used, monthlyLeft: left, topup, total: left + Math.max(0, topup), periodStart: access.periodStart, access };
}

export type Spend = { bucket: "monthly" | "topup"; amount: number; periodStart: Date | null }[];

// Deducts `cost` credits atomically. Returns the parts taken (for refunds), or null if the user
// can't afford it.
export async function spendCredits(user: Pick<User, "id" | "compAccess">, cost: number, detail: string): Promise<Spend | null> {
  const access = await getAccess(user);
  const allowance = access.active ? (access.plan?.monthlyCredits ?? 0) : 0;
  return db.transaction(async (tx) => {
    // Serialise spends for this user so two parallel requests can't overdraw.
    await tx.execute(sql`select id from ${users} where ${users.id} = ${user.id} for update`);
    const { monthlyNet, topup } = await sums(tx, user.id, access.periodStart);
    const monthlyLeft = Math.max(0, allowance + monthlyNet);
    if (monthlyLeft + Math.max(0, topup) < cost) return null;
    const fromMonthly = Math.min(monthlyLeft, cost);
    const fromTopup = cost - fromMonthly;
    const parts: Spend = [];
    if (fromMonthly) parts.push({ bucket: "monthly", amount: fromMonthly, periodStart: access.periodStart });
    if (fromTopup) parts.push({ bucket: "topup", amount: fromTopup, periodStart: null });
    for (const p of parts) {
      await tx.insert(creditLedger).values({ userId: user.id, bucket: p.bucket, delta: -p.amount, reason: "image", periodStart: p.periodStart, detail });
    }
    return parts;
  });
}

export async function refundCredits(userId: string, parts: Spend, detail: string) {
  for (const p of parts) {
    await db.insert(creditLedger).values({ userId, bucket: p.bucket, delta: p.amount, reason: "refund", periodStart: p.periodStart, detail });
  }
}

// Idempotent: the same Stripe checkout session never grants credits twice.
export async function grantPurchase(userId: string, credits: number, ref: string, detail: string) {
  await db.insert(creditLedger).values({ userId, bucket: "topup", delta: credits, reason: "purchase", ref, detail }).onConflictDoNothing();
}

export async function adminAdjust(userId: string, delta: number, detail: string) {
  await db.insert(creditLedger).values({ userId, bucket: "topup", delta, reason: "admin", detail });
}

export async function recentCredits(userId: string, limit = 10) {
  return db.select().from(creditLedger).where(eq(creditLedger.userId, userId)).orderBy(desc(creditLedger.createdAt)).limit(limit);
}
