"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createSession, destroySession, hashPassword, safeNext, verifyPassword } from "@/lib/auth";
import { adminEmails } from "@/lib/config";

export type AuthState = { error?: string } | undefined;

const credentials = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
});

export async function signup(_: AuthState, form: FormData): Promise<AuthState> {
  const parsed = credentials.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const name = String(form.get("name") ?? "").trim().slice(0, 100) || null;
  const { email, password } = parsed.data;

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (existing) return { error: "An account with this email already exists. Log in instead." };

  const [user] = await db
    .insert(users)
    .values({
      email,
      name,
      passwordHash: await hashPassword(password),
      role: adminEmails().includes(email) ? "admin" : "user",
    })
    .returning();
  await createSession(user.id);
  redirect(safeNext(String(form.get("next") ?? "")));
}

export async function login(_: AuthState, form: FormData): Promise<AuthState> {
  const parsed = credentials.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: "Invalid email or password" };
  const { email, password } = parsed.data;
  const [user] = await db.select().from(users).where(eq(users.email, email));
  if (!user?.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
    return { error: user && !user.passwordHash ? "This account uses Google sign-in." : "Invalid email or password" };
  }
  await createSession(user.id);
  redirect(safeNext(String(form.get("next") ?? "")));
}

export async function logout() {
  await destroySession();
  redirect("/");
}
