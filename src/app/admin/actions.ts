"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { engineVersions, engines, plans, sessions, users } from "@/db/schema";
import { randomBytes } from "node:crypto";
import { hashPassword, requireAdmin } from "@/lib/auth";
import { filesFromZip, importEngineVersion } from "@/lib/engines";
import { stripeReady } from "@/lib/settings";
import { formatPrice, syncPlanToStripe } from "@/lib/stripe-admin";

export type FormState = { ok?: string; error?: string } | undefined;

const split = (v: FormDataEntryValue | null, sep: RegExp) =>
  String(v ?? "")
    .split(sep)
    .map((s) => s.trim())
    .filter(Boolean);
const list = (v: FormDataEntryValue | null) => split(v, /[,\n]/);
const lines = (v: FormDataEntryValue | null) => split(v, /\r?\n/);

// ---- Engines ----

export async function uploadEngine(_: FormState, form: FormData): Promise<FormState> {
  await requireAdmin();
  const file = form.get("zip");
  const version = String(form.get("version") ?? "").trim();
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a ZIP file" };
  if (!/^[0-9A-Za-z.+-]{1,40}$/.test(version)) return { error: "Enter a version like 3.6.0" };
  try {
    const { engine, version: v } = await importEngineVersion({
      files: await filesFromZip(await file.arrayBuffer()),
      version,
      notes: String(form.get("notes") ?? ""),
      slug: String(form.get("slug") ?? "").trim() || undefined,
      tags: list(form.get("tags")),
      publish: form.get("publish") === "on",
    });
    revalidatePath("/admin/engines");
    return { ok: `Uploaded ${engine.slug} v${v.version} (${v.fileCount} files) and made it current.` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Upload failed" };
  }
}

export async function updateEngine(form: FormData) {
  await requireAdmin();
  const id = String(form.get("id"));
  await db
    .update(engines)
    .set({
      name: String(form.get("name") ?? "").trim() || undefined,
      description: String(form.get("description") ?? "").trim(),
      tags: list(form.get("tags")),
      published: form.get("published") === "on",
    })
    .where(eq(engines.id, id));
  revalidatePath("/admin/engines");
  revalidatePath("/");
}

export async function setCurrentVersion(form: FormData) {
  await requireAdmin();
  const engineId = String(form.get("engineId"));
  const versionId = String(form.get("versionId"));
  const [v] = await db
    .select({ id: engineVersions.id })
    .from(engineVersions)
    .where(and(eq(engineVersions.id, versionId), eq(engineVersions.engineId, engineId)));
  if (v) await db.update(engines).set({ currentVersionId: v.id }).where(eq(engines.id, engineId));
  revalidatePath("/admin/engines");
}

// ---- Users ----

export async function setUserFlags(form: FormData) {
  const admin = await requireAdmin();
  const id = String(form.get("id"));
  const field = String(form.get("field"));
  const value = form.get("value") === "true";
  if (field === "compAccess") await db.update(users).set({ compAccess: value }).where(eq(users.id, id));
  // Admins can't demote themselves, so the panel can't lock everyone out.
  if (field === "admin" && id !== admin.id) await db.update(users).set({ role: value ? "admin" : "user" }).where(eq(users.id, id));
  revalidatePath("/admin/users");
}

export type ResetState = { password?: string; error?: string } | undefined;

// There is no email delivery, so the admin can issue a temporary password and pass it on.
export async function resetPassword(_: ResetState, form: FormData): Promise<ResetState> {
  await requireAdmin();
  const id = String(form.get("id"));
  const temp = randomBytes(9).toString("base64url");
  await db.update(users).set({ passwordHash: await hashPassword(temp) }).where(eq(users.id, id));
  await db.delete(sessions).where(eq(sessions.userId, id));
  return { password: temp };
}

// ---- Plans ----

const money = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, "Price must be a number like 5.99")
  .transform((v) => Math.round(Number(v) * 100));

const planSchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(300),
  price: money,
  currency: z.string().trim().toLowerCase().regex(/^[a-z]{3}$/, "Currency must be a 3-letter code like usd"),
  sort: z.coerce.number().int().min(0).max(999),
});

export async function savePlan(_: FormState, form: FormData): Promise<FormState> {
  await requireAdmin();
  const parsed = planSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  const values = {
    name: d.name,
    description: d.description,
    priceCents: d.price,
    currency: d.currency,
    priceLabel: formatPrice(d.price, d.currency, true),
    commercialUse: form.get("commercialUse") === "on",
    sort: d.sort,
    features: lines(form.get("features")),
    active: form.get("active") === "on",
  };
  const id = String(form.get("id") ?? "");
  const [saved] = id
    ? await db.update(plans).set(values).where(eq(plans.id, id)).returning()
    : await db.insert(plans).values(values).returning();
  let note = id ? "Plan saved." : "Plan created.";
  // Keep Stripe in step once the plan has been published there.
  if (saved.stripePriceId && (await stripeReady())) {
    try {
      const r = await syncPlanToStripe(saved);
      if (r.replaced) note += " The price changed, so a new Stripe price was created; existing subscribers keep their old price.";
    } catch (e) {
      note += ` Stripe update failed: ${e instanceof Error ? e.message : e}`;
    }
  }
  revalidatePath("/admin/plans");
  revalidatePath("/pricing");
  return { ok: note };
}

export async function publishPlan(_: FormState, form: FormData): Promise<FormState> {
  await requireAdmin();
  if (!(await stripeReady())) return { error: "Connect Stripe first (Admin → Settings → Payments)." };
  const [plan] = await db.select().from(plans).where(eq(plans.id, String(form.get("id"))));
  if (!plan) return { error: "Plan not found" };
  try {
    await syncPlanToStripe(plan);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Stripe error" };
  }
  revalidatePath("/admin/plans");
  revalidatePath("/pricing");
  return { ok: "Published to Stripe. Customers can subscribe now." };
}
