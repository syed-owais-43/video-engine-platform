"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createSession, hashPassword } from "@/lib/auth";
import { adminExists, checkSetupCode, ensureSetupCode, finishSetup } from "@/lib/setup";

export type SetupState = { error?: string } | undefined;

const input = z.object({
  code: z.string().trim().min(4, "Enter the setup code"),
  name: z.string().trim().max(100),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(10, "Use at least 10 characters for the admin password").max(200),
});

export async function completeSetup(_: SetupState, form: FormData): Promise<SetupState> {
  if (await adminExists()) redirect("/login");
  const parsed = input.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { code, name, email, password } = parsed.data;
  if (!(await checkSetupCode(code))) return { error: "That setup code isn't right. Check the server log for the latest code." };

  const passwordHash = await hashPassword(password);
  const [existing] = await db.select().from(users).where(eq(users.email, email));
  let userId: string;
  if (existing) {
    await db.update(users).set({ role: "admin", passwordHash, name: name || existing.name }).where(eq(users.id, existing.id));
    userId = existing.id;
  } else {
    const [u] = await db.insert(users).values({ email, name: name || null, passwordHash, role: "admin" }).returning();
    userId = u.id;
  }
  await finishSetup();
  await createSession(userId);
  redirect("/admin/settings?welcome=1");
}

export async function newSetupCode() {
  if (await adminExists()) redirect("/login");
  await ensureSetupCode(true);
  redirect("/setup?new=1");
}
