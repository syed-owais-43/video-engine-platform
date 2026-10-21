import { eq } from "drizzle-orm";
import { db } from "@/db";
import { oauthTokens } from "@/db/schema";
import { sha256 } from "@/lib/crypto";
import { preflight, CORS_HEADERS } from "@/lib/oauth";

// RFC 7009: always 200, whether or not the token existed.
export async function POST(req: Request) {
  const token = new URLSearchParams(await req.text()).get("token");
  if (token) {
    await db.update(oauthTokens).set({ revokedAt: new Date() }).where(eq(oauthTokens.tokenHash, sha256(token)));
  }
  return new Response(null, { status: 200, headers: CORS_HEADERS });
}

export const OPTIONS = preflight;
