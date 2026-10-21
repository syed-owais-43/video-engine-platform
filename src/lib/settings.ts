import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { db } from "@/db";
import { settings as settingsTable } from "@/db/schema";
import { appSecret } from "./config";

// Everything the site owner configures from the admin panel. Stored per section, encrypted with a
// key derived from APP_SECRET (so database backups never contain usable API keys).

export type ImageModel = { key: string; label: string; endpoint: string; credits: number; enabled: boolean };

export type AppSettings = {
  brand: { name: string; tagline: string; accent: string; supportEmail: string; logo: string | null; companionPackage: string };
  stripe: { secretKey: string; webhookSecret: string; webhookEndpointId: string; accountKey: string };
  google: { clientId: string; clientSecret: string };
  images: { enabled: boolean; falKey: string; models: ImageModel[] };
};

export type SectionKey = keyof AppSettings;

export const DEFAULT_IMAGE_MODELS: ImageModel[] = [
  { key: "schnell", label: "FLUX Schnell (draft)", endpoint: "fal-ai/flux/schnell", credits: 1, enabled: true },
  { key: "dev", label: "FLUX Dev (high quality)", endpoint: "fal-ai/flux/dev", credits: 4, enabled: true },
  { key: "pro", label: "FLUX Pro (best)", endpoint: "fal-ai/flux-pro/v1.1", credits: 15, enabled: true },
];

function defaults(): AppSettings {
  return {
    brand: {
      name: "Framewright",
      tagline: "Video engines for your AI",
      accent: "#ff6a2b",
      supportEmail: "",
      logo: null,
      companionPackage: "framewright-companion",
    },
    // Environment variables still work as a fallback (useful for local development).
    stripe: { secretKey: process.env.STRIPE_SECRET_KEY ?? "", webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "", webhookEndpointId: "", accountKey: "" },
    google: { clientId: process.env.GOOGLE_CLIENT_ID ?? "", clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "" },
    images: { enabled: false, falKey: process.env.FAL_KEY ?? "", models: DEFAULT_IMAGE_MODELS },
  };
}

// ---------- encryption ----------

const key = () => createHash("sha256").update(`settings:${appSecret()}`).digest();

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1:${Buffer.concat([iv, c.getAuthTag(), body]).toString("base64")}`;
}

export function decrypt(value: string): string {
  if (!value.startsWith("v1:")) throw new Error("Unknown settings format");
  const raw = Buffer.from(value.slice(3), "base64");
  const d = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
}

// ---------- read / write ----------

const g = globalThis as unknown as { __settings?: { at: number; value: AppSettings } };
const TTL_MS = 5000;

export async function getSettings(): Promise<AppSettings> {
  const hit = g.__settings;
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const out = defaults();
  for (const row of await db.select().from(settingsTable)) {
    if (!(row.key in out)) continue;
    try {
      const saved = JSON.parse(decrypt(row.value));
      const k = row.key as SectionKey;
      // Empty saved strings don't override env fallbacks.
      const merged = { ...out[k] } as Record<string, unknown>;
      for (const [f, v] of Object.entries(saved)) if (v !== "" && v !== undefined) merged[f] = v;
      (out as Record<string, unknown>)[k] = merged;
    } catch {
      console.error(`Settings section "${row.key}" could not be decrypted. Was APP_SECRET changed? Re-enter it in the admin panel.`);
    }
  }
  g.__settings = { at: Date.now(), value: out };
  return out;
}

export async function saveSection<K extends SectionKey>(section: K, value: AppSettings[K]) {
  const v = encrypt(JSON.stringify(value));
  await db
    .insert(settingsTable)
    .values({ key: section, value: v, updatedAt: new Date() })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value: v, updatedAt: new Date() } });
  g.__settings = undefined;
}

// Raw, non-section values (e.g. the one-time setup code hash).
export async function getRaw(k: string): Promise<string | null> {
  const rows = await db.select().from(settingsTable);
  const row = rows.find((r) => r.key === k);
  return row ? decrypt(row.value) : null;
}

export async function setRaw(k: string, value: string) {
  const v = encrypt(value);
  await db
    .insert(settingsTable)
    .values({ key: k, value: v, updatedAt: new Date() })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value: v, updatedAt: new Date() } });
}

export const mask = (s: string) => (s ? `${s.slice(0, 7)}…${s.slice(-4)}` : "");

export async function getBrand() {
  return (await getSettings()).brand;
}

export const stripeReady = async () => Boolean((await getSettings()).stripe.secretKey);
export const googleReady = async () => {
  const s = (await getSettings()).google;
  return Boolean(s.clientId && s.clientSecret);
};
