"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { engineVersions, engines, plans, users } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { filesFromZip, importEngineVersion } from "@/lib/engines";

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

// ---- Plans ----

const planSchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(300),
  stripePriceId: z.string().trim().regex(/^price_[A-Za-z0-9]+$/, "Stripe price id must look like price_..."),
  priceLabel: z.string().trim().min(1).max(40),
  monthlyProjects: z.string().trim().regex(/^\d*$/, "Project limit must be a whole number or blank"),
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
    stripePriceId: d.stripePriceId,
    priceLabel: d.priceLabel,
    monthlyProjects: d.monthlyProjects === "" ? null : Number(d.monthlyProjects),
    sort: d.sort,
    features: lines(form.get("features")),
    active: form.get("active") === "on",
  };
  const id = String(form.get("id") ?? "");
  try {
    if (id) await db.update(plans).set(values).where(eq(plans.id, id));
    else await db.insert(plans).values(values);
  } catch {
    return { error: "Couldn't save. Is that Stripe price id already used by another plan?" };
  }
  revalidatePath("/admin/plans");
  revalidatePath("/pricing");
  return { ok: id ? "Plan updated." : "Plan created." };
}
