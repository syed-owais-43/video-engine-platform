import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createSession, safeNext } from "@/lib/auth";
import { adminEmails, baseUrl } from "@/lib/config";
import { getSettings } from "@/lib/settings";

type GoogleUser = { sub: string; email: string; email_verified: boolean; name?: string };

export async function GET(req: Request) {
  const url = new URL(req.url);
  const jar = await cookies();
  const state = jar.get("fw_g_state")?.value;
  const next = safeNext(jar.get("fw_g_next")?.value);
  jar.delete("fw_g_state");
  jar.delete("fw_g_next");

  const code = url.searchParams.get("code");
  if (!code || !state || url.searchParams.get("state") !== state) {
    return Response.redirect(`${baseUrl()}/login?error=google`, 302);
  }

  const google = (await getSettings()).google;
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: google.clientId,
      client_secret: google.clientSecret,
      redirect_uri: `${baseUrl()}/api/auth/google/callback`,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) return Response.redirect(`${baseUrl()}/login?error=google`, 302);
  const { access_token } = (await tokenRes.json()) as { access_token: string };

  const infoRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { authorization: `Bearer ${access_token}` },
  });
  const info = (await infoRes.json()) as GoogleUser;
  if (!infoRes.ok || !info.email || !info.email_verified) {
    return Response.redirect(`${baseUrl()}/login?error=google`, 302);
  }
  const email = info.email.toLowerCase();

  // Link by Google id first, then by verified email (so password users can add Google later).
  let [user] = await db.select().from(users).where(eq(users.googleId, info.sub));
  if (!user) {
    [user] = await db.select().from(users).where(eq(users.email, email));
    if (user) {
      await db.update(users).set({ googleId: info.sub }).where(eq(users.id, user.id));
    } else {
      [user] = await db
        .insert(users)
        .values({ email, name: info.name ?? null, googleId: info.sub, role: adminEmails().includes(email) ? "admin" : "user" })
        .returning();
    }
  }
  await createSession(user.id);
  return Response.redirect(`${baseUrl()}${next}`, 302);
}
