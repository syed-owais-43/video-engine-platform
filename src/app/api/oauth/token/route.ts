import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { oauthCodes, oauthTokens } from "@/db/schema";
import { pkceMatches, sha256 } from "@/lib/crypto";
import { json, oauthError, preflight } from "@/lib/oauth";
import { issueTokenPair } from "@/lib/tokens";

async function readParams(req: Request): Promise<URLSearchParams> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const body = (await req.json()) as Record<string, string>;
    return new URLSearchParams(body);
  }
  return new URLSearchParams(await req.text());
}

// OAuth clients expect a JSON error body even on failures, so unexpected errors become server_error.
export async function POST(req: Request) {
  try {
    return await handleToken(req);
  } catch (e) {
    console.error("OAuth token endpoint failed:", e);
    return oauthError("server_error", "The sign-in server hit an internal error. Try again.", 500);
  }
}

async function handleToken(req: Request) {
  const p = await readParams(req);
  const grant = p.get("grant_type");
  const clientId = p.get("client_id");
  if (!clientId) return oauthError("invalid_client", "client_id is required", 401);

  if (grant === "authorization_code") {
    const code = p.get("code");
    const verifier = p.get("code_verifier");
    if (!code || !verifier) return oauthError("invalid_request", "code and code_verifier are required");
    // Delete-on-read makes codes strictly single use.
    const [row] = await db.delete(oauthCodes).where(eq(oauthCodes.codeHash, sha256(code))).returning();
    if (
      !row ||
      row.clientId !== clientId ||
      row.expiresAt < new Date() ||
      (p.get("redirect_uri") && p.get("redirect_uri") !== row.redirectUri) ||
      !pkceMatches(verifier, row.codeChallenge)
    ) {
      return oauthError("invalid_grant", "Authorization code is invalid or expired");
    }
    return json(await issueTokenPair(row.userId, clientId));
  }

  if (grant === "refresh_token") {
    const refresh = p.get("refresh_token");
    if (!refresh) return oauthError("invalid_request", "refresh_token is required");
    const [row] = await db
      .update(oauthTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(oauthTokens.tokenHash, sha256(refresh)),
          eq(oauthTokens.kind, "refresh"),
          eq(oauthTokens.clientId, clientId),
          isNull(oauthTokens.revokedAt),
          gt(oauthTokens.expiresAt, new Date()),
        ),
      )
      .returning();
    if (!row) return oauthError("invalid_grant", "Refresh token is invalid or expired");
    return json(await issueTokenPair(row.userId, clientId));
  }

  return oauthError("unsupported_grant_type", "Use authorization_code or refresh_token");
}

export const OPTIONS = preflight;
