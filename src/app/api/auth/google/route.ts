import { cookies } from "next/headers";
import { baseUrl } from "@/lib/config";
import { getSettings } from "@/lib/settings";
import { randomToken } from "@/lib/crypto";
import { safeNext } from "@/lib/auth";

export async function GET(req: Request) {
  const google = (await getSettings()).google;
  if (!google.clientId || !google.clientSecret) return new Response("Google sign-in is not configured", { status: 503 });
  const next = safeNext(new URL(req.url).searchParams.get("next"));
  const state = randomToken(16);
  const jar = await cookies();
  const opts = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 600 };
  jar.set("fw_g_state", state, opts);
  jar.set("fw_g_next", next, opts);

  const params = new URLSearchParams({
    client_id: google.clientId,
    redirect_uri: `${baseUrl()}/api/auth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, 302);
}
