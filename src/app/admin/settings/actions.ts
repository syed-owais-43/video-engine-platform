"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { getSettings, saveSection } from "@/lib/settings";
import { connectStripe } from "@/lib/stripe-admin";

export type ActionState = { ok?: string; error?: string } | undefined;

const done = (ok: string): ActionState => {
  revalidatePath("/", "layout");
  return { ok };
};

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function saveBrand(_: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const current = (await getSettings()).brand;
  const name = str(form, "name").slice(0, 60);
  if (!name) return { error: "The site needs a name." };
  const accent = str(form, "accent");
  if (!/^#[0-9a-fA-F]{6}$/.test(accent)) return { error: "Accent colour must look like #ff6a2b." };
  const pkg = str(form, "companionPackage");
  if (!/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(pkg)) return { error: "Companion package must be a valid npm package name." };
  const email = str(form, "supportEmail");
  if (email && !z.string().email().safeParse(email).success) return { error: "Support email isn't valid." };

  let logo = current.logo;
  const file = form.get("logo");
  if (form.get("removeLogo") === "on") logo = null;
  else if (file instanceof File && file.size > 0) {
    if (file.size > 200_000) return { error: "Logo must be under 200 KB." };
    if (!["image/png", "image/svg+xml", "image/jpeg", "image/webp"].includes(file.type)) return { error: "Logo must be PNG, SVG, JPG or WebP." };
    logo = `data:${file.type};base64,${Buffer.from(await file.arrayBuffer()).toString("base64")}`;
  }
  await saveSection("brand", { name, tagline: str(form, "tagline").slice(0, 120), accent, supportEmail: email, logo, companionPackage: pkg });
  return done("Brand saved.");
}

export async function saveStripe(_: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const current = (await getSettings()).stripe;
  const key = str(form, "secretKey");
  const whsec = str(form, "webhookSecret");
  if (whsec && !whsec.startsWith("whsec_")) return { error: "The webhook signing secret starts with whsec_." };
  if (whsec) await saveSection("stripe", { ...current, webhookSecret: whsec });
  if (!key) return whsec ? done("Webhook secret saved.") : { error: "Paste your Stripe secret key (sk_live_… or sk_test_…)." };
  if (!/^(sk|rk)_(live|test)_/.test(key)) return { error: "That doesn't look like a Stripe secret key. It starts with sk_live_ or sk_test_." };
  const r = await connectStripe(key);
  if (!r.ok) return { error: r.error };
  return done(r.summary);
}

export async function disconnectStripe(): Promise<void> {
  await requireAdmin();
  await saveSection("stripe", { secretKey: "", webhookSecret: "", webhookEndpointId: "", accountKey: "" });
  revalidatePath("/", "layout");
}

export async function saveGoogle(_: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const current = (await getSettings()).google;
  const clientId = str(form, "clientId");
  const clientSecret = str(form, "clientSecret");
  if (form.get("disable") === "on") {
    await saveSection("google", { clientId: "", clientSecret: "" });
    return done("Google sign-in turned off.");
  }
  if (clientId && !clientId.endsWith(".apps.googleusercontent.com")) return { error: "The client ID ends with .apps.googleusercontent.com." };
  await saveSection("google", { clientId: clientId || current.clientId, clientSecret: clientSecret || current.clientSecret });
  return done("Google sign-in saved.");
}
