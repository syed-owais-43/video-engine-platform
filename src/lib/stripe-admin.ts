import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { creditPacks, plans, type CreditPack, type Plan } from "@/db/schema";
import { baseUrl } from "./config";
import { getSettings, saveSection } from "./settings";
import { stripe } from "./stripe";

export const WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
] as const;

export const webhookUrl = () => `${baseUrl()}/api/stripe/webhook`;

export function formatPrice(cents: number, currency: string, recurring: boolean) {
  const amount = new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
  return recurring ? `${amount} / month` : amount;
}

// Verifies the key and, when the site has a public https address, registers the webhook so the
// owner doesn't have to copy a signing secret by hand. Returns a human summary.
export async function connectStripe(secretKey: string): Promise<{ ok: true; summary: string } | { ok: false; error: string }> {
  const current = (await getSettings()).stripe;
  await saveSection("stripe", { ...current, secretKey });
  let client;
  try {
    client = await stripe();
    const account = await client.accounts.retrieveCurrent();
    const mode = secretKey.startsWith("sk_live") || secretKey.startsWith("rk_live") ? "live" : "test";
    const parts = [`Connected to ${account.settings?.dashboard?.display_name || account.email || account.id} (${mode} mode).`];

    // Test and live mode (and different accounts) have separate catalogues, so products and prices
    // made under the previous key don't exist here: forget them so plans get published again.
    const accountKey = `${account.id}:${mode}`;
    if (current.accountKey && current.accountKey !== accountKey) {
      await db.update(plans).set({ stripeProductId: null, stripePriceId: null, legacyPriceIds: [] });
      await db.update(creditPacks).set({ stripeProductId: null, stripePriceId: null });
      parts.push("This is a different Stripe account or mode, so press “Publish to Stripe” on each plan and save each credit pack again.");
    }
    await saveSection("stripe", { ...(await getSettings()).stripe, secretKey, accountKey, ...(current.accountKey !== accountKey ? { webhookSecret: "", webhookEndpointId: "" } : {}) });

    if (baseUrl().startsWith("https://")) {
      const existing = (await client.webhookEndpoints.list({ limit: 100 })).data.find((w) => w.url === webhookUrl());
      const now = (await getSettings()).stripe;
      if (existing && now.webhookSecret && now.webhookEndpointId === existing.id) {
        parts.push("Webhook already set up.");
      } else {
        if (existing) await client.webhookEndpoints.del(existing.id);
        const hook = await client.webhookEndpoints.create({ url: webhookUrl(), enabled_events: [...WEBHOOK_EVENTS] });
        await saveSection("stripe", { ...now, secretKey, webhookSecret: hook.secret ?? "", webhookEndpointId: hook.id });
        parts.push("Webhook created automatically.");
      }
    } else {
      parts.push(`This site isn't on a public https address yet, so the webhook can't be created automatically. For local testing run: stripe listen --forward-to ${webhookUrl()}, then paste the whsec_… secret below.`);
    }

    // The customer portal (cancel, change card) needs a configuration in each Stripe account.
    const portals = await client.billingPortal.configurations.list({ limit: 1 });
    if (!portals.data.length) {
      await client.billingPortal.configurations.create({
        business_profile: { headline: (await getSettings()).brand.name },
        features: {
          customer_update: { enabled: true, allowed_updates: ["email", "address"] },
          invoice_history: { enabled: true },
          payment_method_update: { enabled: true },
          subscription_cancel: { enabled: true, mode: "at_period_end" },
        },
      });
      parts.push("Customer billing portal enabled.");
    }
    return { ok: true, summary: parts.join(" ") };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Stripe rejected the key" };
  }
}

async function ensureProduct(id: string | null, name: string, description: string) {
  const client = await stripe();
  if (id) {
    await client.products.update(id, { name, ...(description ? { description } : {}) });
    return id;
  }
  return (await client.products.create({ name, ...(description ? { description } : {}) })).id;
}

// Prices are immutable in Stripe, so a changed amount creates a new price and archives the old one.
async function ensurePrice(productId: string, oldPriceId: string | null, cents: number, currency: string, recurring: boolean) {
  const client = await stripe();
  if (oldPriceId) {
    const old = await client.prices.retrieve(oldPriceId);
    const same = old.unit_amount === cents && old.currency === currency && Boolean(old.recurring) === recurring && old.product === productId;
    if (same && old.active) return { priceId: oldPriceId, replaced: null as string | null };
  }
  const price = await client.prices.create({
    product: productId,
    unit_amount: cents,
    currency,
    ...(recurring ? { recurring: { interval: "month" as const } } : {}),
  });
  if (oldPriceId) await client.prices.update(oldPriceId, { active: false }).catch(() => {});
  return { priceId: price.id, replaced: oldPriceId };
}

export async function syncPlanToStripe(plan: Plan) {
  if (plan.priceCents <= 0) throw new Error("Set a price above zero before publishing to Stripe.");
  const productId = await ensureProduct(plan.stripeProductId, plan.name, plan.description);
  const { priceId, replaced } = await ensurePrice(productId, plan.stripePriceId, plan.priceCents, plan.currency, true);
  await db
    .update(plans)
    .set({
      stripeProductId: productId,
      stripePriceId: priceId,
      legacyPriceIds: replaced && !plan.legacyPriceIds.includes(replaced) ? [...plan.legacyPriceIds, replaced] : plan.legacyPriceIds,
    })
    .where(eq(plans.id, plan.id));
  return { priceId, replaced };
}

export async function syncPackToStripe(pack: CreditPack) {
  if (pack.priceCents <= 0) throw new Error("Set a price above zero before publishing to Stripe.");
  const productId = await ensureProduct(pack.stripeProductId, pack.name, `${pack.credits} credits`);
  const { priceId } = await ensurePrice(productId, pack.stripePriceId, pack.priceCents, pack.currency, false);
  await db.update(creditPacks).set({ stripeProductId: productId, stripePriceId: priceId }).where(eq(creditPacks.id, pack.id));
  return priceId;
}
