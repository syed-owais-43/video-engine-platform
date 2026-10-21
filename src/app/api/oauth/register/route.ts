import { db } from "@/db";
import { oauthClients } from "@/db/schema";
import { randomToken } from "@/lib/crypto";
import { isAllowedRedirectUri, json, oauthError, preflight } from "@/lib/oauth";

// RFC 7591 dynamic client registration (public clients only, PKCE required).
export async function POST(req: Request) {
  let body: { client_name?: unknown; redirect_uris?: unknown };
  try {
    body = await req.json();
  } catch {
    return oauthError("invalid_client_metadata", "Body must be JSON");
  }
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u): u is string => typeof u === "string") : [];
  if (!uris.length || uris.length > 10 || !uris.every(isAllowedRedirectUri)) {
    return oauthError("invalid_redirect_uri", "Provide 1-10 redirect_uris using https, loopback http, or an app scheme");
  }
  const name = typeof body.client_name === "string" ? body.client_name.slice(0, 100) : "MCP client";
  const clientId = `fwc_${randomToken(16)}`;
  await db.insert(oauthClients).values({ clientId, name, redirectUris: uris });
  return json(
    {
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: name,
      redirect_uris: uris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    201,
  );
}

export const OPTIONS = preflight;
