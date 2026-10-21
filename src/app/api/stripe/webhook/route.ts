import Stripe from "stripe";
import { stripe, syncSubscription } from "@/lib/stripe";
import { getSettings } from "@/lib/settings";
import { grantPurchase } from "@/lib/credits";

// Credit packs are one-off Checkout payments tagged with metadata.kind = "credits".
async function maybeGrantCredits(session: Stripe.Checkout.Session) {
  const m = session.metadata ?? {};
  if (session.mode !== "payment" || m.kind !== "credits" || session.payment_status !== "paid") return;
  const credits = Number(m.credits);
  if (!m.userId || !Number.isInteger(credits) || credits <= 0) return;
  await grantPurchase(m.userId, credits, session.id, m.packName ?? "Credit pack");
}

export async function POST(req: Request) {
  const secret = (await getSettings()).stripe.webhookSecret;
  if (!secret) return new Response("Webhook secret not configured", { status: 503 });
  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("Missing signature", { status: 400 });

  let event: Stripe.Event;
  try {
    // Signature checks need only the signing secret, not an API key.
    event = await Stripe.webhooks.constructEventAsync(await req.text(), signature, secret);
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }

  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed":
      await syncSubscription(event.data.object);
      break;
    case "checkout.session.completed": {
      const session = event.data.object;
      if (session.mode === "subscription" && session.subscription) {
        const id = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
        await syncSubscription(await (await stripe()).subscriptions.retrieve(id));
      }
      await maybeGrantCredits(session);
      break;
    }
    case "checkout.session.async_payment_succeeded":
      await maybeGrantCredits(event.data.object);
      break;
  }
  return Response.json({ received: true });
}
