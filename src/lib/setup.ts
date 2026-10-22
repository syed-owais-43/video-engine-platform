import "server-only";
import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import { plans, users } from "@/db/schema";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { sha256 } from "./crypto";
import { getRaw, setRaw } from "./settings";

// First-run setup: until an admin exists, /setup lets the owner create one using a one-time code
// that only someone with access to the server logs (or the SETUP_CODE env var) can know.

const g = globalThis as unknown as { __adminExists?: boolean };

export async function adminExists(): Promise<boolean> {
  if (g.__adminExists) return true;
  const [{ n }] = await db.select({ n: count() }).from(users).where(eq(users.role, "admin"));
  if (n > 0) g.__adminExists = true;
  return n > 0;
}

function newCode() {
  const raw = randomBytes(9).toString("base64url").toUpperCase().replace(/[^A-Z0-9]/g, "X");
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

// Makes sure a setup code exists and prints it to the server log when it is created.
export async function ensureSetupCode(regenerate = false) {
  if (process.env.SETUP_CODE) return;
  if (!regenerate && (await getRaw("setup_code_hash"))) return;
  const code = newCode();
  await setRaw("setup_code_hash", sha256(code));
  console.log(`\n==================================================\n  SETUP CODE: ${code}\n  Open /setup on your site and enter this code to\n  create the admin account. It works only once.\n==================================================\n`);
}

export async function checkSetupCode(code: string): Promise<boolean> {
  const given = code.trim().toUpperCase();
  const env = process.env.SETUP_CODE?.trim().toUpperCase();
  if (env) {
    const a = Buffer.from(sha256(given));
    const b = Buffer.from(sha256(env));
    return timingSafeEqual(a, b);
  }
  const stored = await getRaw("setup_code_hash");
  if (!stored) return false;
  return timingSafeEqual(Buffer.from(stored), Buffer.from(sha256(given)));
}

export async function finishSetup() {
  g.__adminExists = true;
  await setRaw("setup_code_hash", sha256(randomBytes(32).toString("hex"))); // burn the code
  await seedDefaultPlans();
}

// One flat, low-priced subscription: videos render on the customer's own computer, so there are no
// usage limits to sell. The Stripe price is created later from Admin → Plans.
export async function seedDefaultPlans() {
  const [{ n }] = await db.select({ n: count() }).from(plans);
  if (n > 0) return;
  await db.insert(plans).values({
    name: "Unlimited",
    description: "Every engine, style and resource pack. Unlimited videos, rendered on your own computer.",
    priceCents: 599,
    priceLabel: "$5.99 / month",
    commercialUse: true,
    features: ["Style and inspiration libraries", "Sound effects, fonts, textures and Lottie packs", "Timeline editor with scene sliders", "Export to Premiere, DaVinci Resolve and Final Cut"],
    sort: 1,
  });
}
