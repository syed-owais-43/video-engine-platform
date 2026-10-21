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

// The blueprint's three tiers. Stripe prices are created later from Admin → Plans.
export async function seedDefaultPlans() {
  const [{ n }] = await db.select({ n: count() }).from(plans);
  if (n > 0) return;
  await db.insert(plans).values([
    {
      name: "Starter",
      description: "Try it out with draft-quality images.",
      priceCents: 299,
      priceLabel: "$2.99 / month",
      monthlyCredits: 200,
      imageModels: ["schnell"],
      commercialUse: false,
      sort: 1,
    },
    {
      name: "Creator",
      description: "High-quality images and full commercial rights.",
      priceCents: 599,
      priceLabel: "$5.99 / month",
      monthlyCredits: 500,
      imageModels: ["schnell", "dev"],
      commercialUse: true,
      sort: 2,
    },
    {
      name: "Pro",
      description: "Our best image model and the most credits.",
      priceCents: 1599,
      priceLabel: "$15.99 / month",
      monthlyCredits: 1500,
      imageModels: ["schnell", "dev", "pro"],
      commercialUse: true,
      sort: 3,
    },
  ]);
}
