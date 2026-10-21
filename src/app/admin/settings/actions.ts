"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { generateImage } from "@/lib/images";
import { getSettings, saveSection, type ImageModel } from "@/lib/settings";
import { connectStripe } from "@/lib/stripe-admin";

export type ActionState = { ok?: string; error?: string; image?: string } | undefined;

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

export async function saveImages(_: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const current = (await getSettings()).images;
  const keys = form.getAll("modelKey").map(String);
  const models: ImageModel[] = [];
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i].trim().toLowerCase();
    const endpoint = String(form.getAll("modelEndpoint")[i] ?? "").trim();
    const label = String(form.getAll("modelLabel")[i] ?? "").trim();
    const credits = Number(form.getAll("modelCredits")[i]);
    if (!key && !endpoint) continue;
    if (!/^[a-z0-9-]{1,30}$/.test(key)) return { error: `Model key "${key}" must be lowercase letters, numbers or dashes.` };
    if (!/^[\w.-]+\/[\w./-]+$/.test(endpoint)) return { error: `"${endpoint}" isn't a fal.ai model id (like fal-ai/flux/dev).` };
    if (!Number.isInteger(credits) || credits < 1 || credits > 10000) return { error: `Credits for ${key} must be a whole number from 1 to 10000.` };
    if (models.some((m) => m.key === key)) return { error: `Model key "${key}" is used twice.` };
    models.push({ key, label: label || key, endpoint, credits, enabled: form.getAll("modelEnabled").map(String).includes(key) });
  }
  const enabled = form.get("enabled") === "on";
  const falKey = str(form, "falKey") || current.falKey;
  if (enabled && !falKey) return { error: "Add your fal.ai API key before turning image generation on." };
  if (enabled && !models.some((m) => m.enabled)) return { error: "Enable at least one model." };
  await saveSection("images", { enabled, falKey, models });
  return done(enabled ? "Image generation is on." : "Image settings saved (generation is off).");
}

export async function testImage(_: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const s = (await getSettings()).images;
  const model = s.models.find((m) => m.key === String(form.get("model")));
  if (!s.falKey) return { error: "Save your fal.ai API key first." };
  if (!model) return { error: "Pick a model." };
  try {
    const r = await generateImage({ falKey: s.falKey, endpoint: model.endpoint, prompt: "A small clay robot waving, studio light, simple background", aspect: "square" });
    return { ok: `${model.label} works.`, image: r.images[0]?.url };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Test failed" };
  }
}
