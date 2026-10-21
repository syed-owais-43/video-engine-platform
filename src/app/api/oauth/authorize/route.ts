import { eq } from "drizzle-orm";
import { db } from "@/db";
import { oauthClients, oauthCodes } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { baseUrl } from "@/lib/config";
import { randomToken, sha256 } from "@/lib/crypto";

// Consent form target. The session cookie is SameSite=Lax, so it is never sent on a
// cross-site POST; the Origin check is a second guard against CSRF.
export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(baseUrl()).origin) return new Response("Bad origin", { status: 403 });

  const user = await getCurrentUser();
  if (!user) return new Response("Not signed in", { status: 401 });

  const form = await req.formData();
  const get = (k: string) => String(form.get(k) ?? "");
  const clientId = get("client_id");
  const redirectUri = get("redirect_uri");
  const [client] = await db.select().from(oauthClients).where(eq(oauthClients.clientId, clientId));
  if (!client || !client.redirectUris.includes(redirectUri)) return new Response("Invalid client", { status: 400 });

  const target = new URL(redirectUri);
  if (get("state")) target.searchParams.set("state", get("state"));

  if (get("decision") !== "approve") {
    target.searchParams.set("error", "access_denied");
    return Response.redirect(target.toString(), 302);
  }

  const challenge = get("code_challenge");
  if (!challenge) return new Response("Missing code_challenge", { status: 400 });
  const code = randomToken();
  await db.insert(oauthCodes).values({
    codeHash: sha256(code),
    clientId,
    userId: user.id,
    redirectUri,
    codeChallenge: challenge,
    resource: get("resource") || null,
    expiresAt: new Date(Date.now() + 5 * 60_000),
  });
  target.searchParams.set("code", code);
  return Response.redirect(target.toString(), 302);
}
