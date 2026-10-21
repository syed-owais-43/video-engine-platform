import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { apiKeys, oauthTokens } from "@/db/schema";
import { randomToken, sha256 } from "./crypto";

export const API_KEY_PREFIX = "fw_";
export const ACCESS_TOKEN_TTL = 3600;
export const REFRESH_TOKEN_TTL = 30 * 86400;

export type BearerIdentity = { userId: string; via: "api_key" | "oauth"; clientId?: string };

export function newApiKey() {
  const key = `${API_KEY_PREFIX}${randomToken(24)}`;
  return { key, prefix: key.slice(0, 10), hash: sha256(key) };
}

export async function issueTokenPair(userId: string, clientId: string) {
  const access = randomToken();
  const refresh = randomToken();
  const now = Date.now();
  await db.insert(oauthTokens).values([
    { tokenHash: sha256(access), kind: "access", clientId, userId, expiresAt: new Date(now + ACCESS_TOKEN_TTL * 1000) },
    { tokenHash: sha256(refresh), kind: "refresh", clientId, userId, expiresAt: new Date(now + REFRESH_TOKEN_TTL * 1000) },
  ]);
  return {
    access_token: access,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL,
    refresh_token: refresh,
    scope: "mcp",
  };
}

export async function authenticateBearer(header: string | null): Promise<BearerIdentity | null> {
  const token = header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) return null;
  const hash = sha256(token);

  if (token.startsWith(API_KEY_PREFIX)) {
    const [key] = await db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.hash, hash), isNull(apiKeys.revokedAt)));
    if (!key) return null;
    await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, key.id));
    return { userId: key.userId, via: "api_key" };
  }

  const [row] = await db
    .select()
    .from(oauthTokens)
    .where(
      and(
        eq(oauthTokens.tokenHash, hash),
        eq(oauthTokens.kind, "access"),
        isNull(oauthTokens.revokedAt),
        gt(oauthTokens.expiresAt, new Date()),
      ),
    );
  return row ? { userId: row.userId, via: "oauth", clientId: row.clientId } : null;
}
