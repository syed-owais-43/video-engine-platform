import "server-only";
import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { subscriptions, users } from "@/db/schema";

let client: Stripe | null = null;

export function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  return (client ??= new Stripe(key));
}

export async function ensureCustomer(user: { id: string; email: string; name: string | null; stripeCustomerId: string | null }) {
  if (user.stripeCustomerId) return user.stripeCustomerId;
  const customer = await stripe().customers.create({
    email: user.email,
    name: user.name ?? undefined,
    metadata: { userId: user.id },
  });
  await db.update(users).set({ stripeCustomerId: customer.id }).where(eq(users.id, user.id));
  return customer.id;
}

// Period dates live on subscription items in current Stripe API versions.
export async function syncSubscription(sub: Stripe.Subscription) {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.stripeCustomerId, customerId));
  const userId = user?.id ?? sub.metadata?.userId;
  if (!userId) {
    console.warn(`Stripe subscription ${sub.id} has no matching user (customer ${customerId})`);
    return;
  }
  const item = sub.items.data[0];
  const toDate = (s?: number | null) => (s ? new Date(s * 1000) : null);
  const values = {
    userId,
    status: sub.status,
    priceId: item?.price.id ?? "",
    currentPeriodStart: toDate(item?.current_period_start),
    currentPeriodEnd: toDate(item?.current_period_end),
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    updatedAt: new Date(),
  };
  await db
    .insert(subscriptions)
    .values({ id: sub.id, ...values })
    .onConflictDoUpdate({ target: subscriptions.id, set: values });
}
