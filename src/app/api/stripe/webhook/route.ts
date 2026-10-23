import Stripe from "stripe";
import { stripe, syncSubscription } from "@/lib/stripe";
import { getSettings } from "@/lib/settings";

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
      break;
    }
  }
  return Response.json({ received: true });
}
