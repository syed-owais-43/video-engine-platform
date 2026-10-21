"use server";

import { revalidatePath } from "next/cache";
import { and, count, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { apiKeys, oauthTokens } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { newApiKey } from "@/lib/tokens";

export type KeyState = { key?: string; error?: string } | undefined;

const MAX_KEYS = 10;

export async function createApiKey(_: KeyState, form: FormData): Promise<KeyState> {
  const user = await requireUser("/dashboard");
  const name = String(form.get("name") ?? "").trim().slice(0, 60) || "API key";
  const [{ n }] = await db
    .select({ n: count() })
    .from(apiKeys)
    .where(and(eq(apiKeys.userId, user.id), isNull(apiKeys.revokedAt)));
  if (n >= MAX_KEYS) return { error: `You can have up to ${MAX_KEYS} active keys. Revoke one first.` };
  const { key, prefix, hash } = newApiKey();
  await db.insert(apiKeys).values({ userId: user.id, name, prefix, hash });
  revalidatePath("/dashboard");
  return { key };
}

export async function revokeApiKey(form: FormData) {
  const user = await requireUser("/dashboard");
  await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, String(form.get("id"))), eq(apiKeys.userId, user.id)));
  revalidatePath("/dashboard");
}

export async function disconnectApp(form: FormData) {
  const user = await requireUser("/dashboard");
  await db
    .update(oauthTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(oauthTokens.clientId, String(form.get("clientId"))), eq(oauthTokens.userId, user.id), isNull(oauthTokens.revokedAt)));
  revalidatePath("/dashboard");
}
