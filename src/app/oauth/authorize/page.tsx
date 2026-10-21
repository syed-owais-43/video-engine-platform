import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { oauthClients } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { getAccess } from "@/lib/access";
import { getBrand } from "@/lib/settings";

export const metadata: Metadata = { title: "Authorize app" };

function ErrorCard({ message }: { message: string }) {
  return (
    <div className="mx-auto max-w-md px-4 py-24">
      <div className="card">
        <h1 className="display text-4xl">Can&apos;t connect</h1>
        <p className="mt-3 text-sm text-muted">{message}</p>
      </div>
    </div>
  );
}

export default async function AuthorizePage(props: PageProps<"/oauth/authorize">) {
  const raw = await props.searchParams;
  const p = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, typeof v === "string" ? v : ""]));

  const [user, brand] = await Promise.all([getCurrentUser(), getBrand()]);
  if (!user) {
    const here = `/oauth/authorize?${new URLSearchParams(p)}`;
    redirect(`/login?next=${encodeURIComponent(here)}`);
  }

  if (p.response_type !== "code") return <ErrorCard message="Unsupported response_type. Only 'code' is supported." />;
  if (!p.code_challenge || p.code_challenge_method !== "S256") {
    return <ErrorCard message="This app must use PKCE (S256). Please update your MCP client." />;
  }
  const [client] = p.client_id ? await db.select().from(oauthClients).where(eq(oauthClients.clientId, p.client_id)) : [];
  if (!client) return <ErrorCard message="Unknown app. Remove and re-add this server in your AI app." />;
  if (!client.redirectUris.includes(p.redirect_uri)) return <ErrorCard message="Redirect address doesn't match this app's registration." />;

  const access = await getAccess(user);
  const host = (() => {
    try {
      return new URL(p.redirect_uri).host || new URL(p.redirect_uri).protocol;
    } catch {
      return p.redirect_uri;
    }
  })();

  return (
    <div className="mx-auto max-w-md px-4 py-24">
      <div className="card">
        <p className="eyebrow">Connect app</p>
        <h1 className="display mt-3 text-4xl">
          Allow <span className="text-ember">{client.name}</span> to use {brand.name}?
        </h1>
        <p className="mt-4 text-sm text-muted">
          It will be able to list engines, start projects on your plan and read engine guides as <span className="text-paper">{user.email}</span>.
          It can&apos;t see your password or billing details.
        </p>
        <p className="mt-2 text-xs text-faint">Returns to: {host}</p>

        {!access.active && (
          <p className="mt-5 rounded-lg border border-warn/40 bg-warn/5 px-3 py-2 text-sm text-warn">
            You don&apos;t have an active plan yet. The app can connect, but tools won&apos;t work until you{" "}
            <Link href="/pricing" className="underline">subscribe</Link>.
          </p>
        )}

        <form method="POST" action="/api/oauth/authorize" className="mt-8 flex gap-3">
          {["client_id", "redirect_uri", "state", "code_challenge", "resource"].map((k) => (
            <input key={k} type="hidden" name={k} value={p[k] ?? ""} />
          ))}
          <button name="decision" value="deny" className="btn-ghost flex-1">
            Cancel
          </button>
          <button name="decision" value="approve" className="btn-primary flex-1">
            Allow
          </button>
        </form>
      </div>
    </div>
  );
}
