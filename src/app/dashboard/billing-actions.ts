"use server";

import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { creditPacks, plans } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { getAccess } from "@/lib/access";
import { baseUrl } from "@/lib/config";
import { stripeReady } from "@/lib/settings";
import { ensureCustomer, stripe } from "@/lib/stripe";

export async function startCheckout(form: FormData) {
  const user = await requireUser("/pricing");
  if (!(await stripeReady())) redirect("/dashboard?billing=unconfigured");
  const access = await getAccess(user);
  if (access.source === "subscription") redirect("/dashboard?billing=already");

  const planId = String(form.get("planId") ?? "");
  const [plan] = await db.select().from(plans).where(and(eq(plans.id, planId), eq(plans.active, true)));
  if (!plan) redirect("/pricing");

  if (!plan.stripePriceId) redirect("/pricing");
  const customer = await ensureCustomer(user);
  const session = await (await stripe()).checkout.sessions.create({
    mode: "subscription",
    customer,
    line_items: [{ price: plan.stripePriceId, quantity: 1 }],
    subscription_data: { metadata: { userId: user.id } },
    allow_promotion_codes: true,
    success_url: `${baseUrl()}/dashboard?billing=success`,
    cancel_url: `${baseUrl()}/pricing`,
  });
  redirect(session.url!);
}

export async function buyCredits(form: FormData) {
  const user = await requireUser("/dashboard");
  if (!(await stripeReady())) redirect("/dashboard?billing=unconfigured");
  const [pack] = await db
    .select()
    .from(creditPacks)
    .where(and(eq(creditPacks.id, String(form.get("packId") ?? "")), eq(creditPacks.active, true)));
  if (!pack?.stripePriceId) redirect("/dashboard");
  const customer = await ensureCustomer(user);
  const session = await (await stripe()).checkout.sessions.create({
    mode: "payment",
    customer,
    line_items: [{ price: pack.stripePriceId, quantity: 1 }],
    metadata: { kind: "credits", userId: user.id, packId: pack.id, credits: String(pack.credits), packName: pack.name },
    success_url: `${baseUrl()}/dashboard?billing=credits`,
    cancel_url: `${baseUrl()}/dashboard`,
  });
  redirect(session.url!);
}

export async function openBillingPortal() {
  const user = await requireUser("/dashboard");
  if (!(await stripeReady()) || !user.stripeCustomerId) redirect("/dashboard");
  const portal = await (await stripe()).billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: `${baseUrl()}/dashboard`,
  });
  redirect(portal.url);
}
