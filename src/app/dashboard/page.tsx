import type { Metadata } from "next";
import Link from "next/link";
import { and, desc, eq, gt, isNull, max } from "drizzle-orm";
import { db } from "@/db";
import { apiKeys, engines, oauthClients, oauthTokens, usageEvents } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { getAccess } from "@/lib/access";
import { baseUrl, stripeConfigured } from "@/lib/config";
import { ConnectGuide } from "@/components/connect-guide";
import { openBillingPortal } from "./billing-actions";
import { disconnectApp, revokeApiKey } from "./key-actions";
import { NewKeyForm } from "./new-key-form";

export const metadata: Metadata = { title: "Dashboard" };

const fmt = (d: Date | null | undefined) => (d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");

const BILLING_NOTICES: Record<string, { tone: string; text: string }> = {
  success: { tone: "border-ok/40 text-ok", text: "Payment received. Your subscription will show as active in a few seconds; refresh if needed." },
  unconfigured: { tone: "border-warn/40 text-warn", text: "Payments aren't set up on this site yet." },
  already: { tone: "border-warn/40 text-warn", text: "You already have a subscription. Use Manage billing to change plans." },
};

export default async function DashboardPage(props: PageProps<"/dashboard">) {
  const user = await requireUser("/dashboard");
  const q = await props.searchParams;
  const notice = typeof q.billing === "string" ? BILLING_NOTICES[q.billing] : undefined;

  const [access, keys, apps, activity] = await Promise.all([
    getAccess(user),
    db.select().from(apiKeys).where(and(eq(apiKeys.userId, user.id), isNull(apiKeys.revokedAt))).orderBy(desc(apiKeys.createdAt)),
    db
      .select({ clientId: oauthClients.clientId, name: oauthClients.name, lastUsed: max(oauthTokens.createdAt) })
      .from(oauthTokens)
      .innerJoin(oauthClients, eq(oauthClients.clientId, oauthTokens.clientId))
      .where(and(eq(oauthTokens.userId, user.id), isNull(oauthTokens.revokedAt), gt(oauthTokens.expiresAt, new Date())))
      .groupBy(oauthClients.clientId, oauthClients.name),
    db
      .select({ tool: usageEvents.tool, detail: usageEvents.detail, at: usageEvents.createdAt, engine: engines.name })
      .from(usageEvents)
      .leftJoin(engines, eq(engines.id, usageEvents.engineId))
      .where(eq(usageEvents.userId, user.id))
      .orderBy(desc(usageEvents.createdAt))
      .limit(8),
  ]);

  const pct = access.limit ? Math.min(100, Math.round((access.used / access.limit) * 100)) : 0;

  return (
    <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
      <p className="eyebrow">Dashboard</p>
      <h1 className="display mt-3 text-5xl sm:text-6xl">Hello{user.name ? `, ${user.name.split(" ")[0]}` : ""}.</h1>

      {notice && <p className={`mt-6 rounded-xl border px-4 py-3 text-sm ${notice.tone}`}>{notice.text}</p>}

      <div className="mt-10 grid gap-5 lg:grid-cols-3">
        <section className="card lg:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="label">Subscription</p>
              {access.active ? (
                <p className="display text-4xl">
                  {access.source === "comp" ? "Complimentary access" : (access.plan?.name ?? "Active")}
                </p>
              ) : (
                <p className="display text-4xl text-muted">No active plan</p>
              )}
              {access.source === "subscription" && (
                <p className="mt-1 text-sm text-muted">
                  {access.cancelAtPeriodEnd ? "Ends" : "Renews"} {fmt(access.periodEnd)}
                  {access.status === "trialing" && " · trial"}
                </p>
              )}
              {!access.active && access.status && <p className="mt-1 text-sm text-bad">Last status: {access.status.replace(/_/g, " ")}</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              {!access.active && (
                <Link href="/pricing" className="btn-primary">
                  Choose a plan
                </Link>
              )}
              {stripeConfigured() && user.stripeCustomerId && (
                <form action={openBillingPortal}>
                  <button className="btn-ghost">Manage billing</button>
                </form>
              )}
            </div>
          </div>
          {access.active && (
            <div className="mt-8">
              <div className="flex justify-between text-sm">
                <span className="text-muted">Projects this period</span>
                <span>
                  {access.used}
                  {access.limit === null ? " · unlimited" : ` / ${access.limit}`}
                </span>
              </div>
              {access.limit !== null && (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
                  <div className="h-full rounded-full bg-ember" style={{ width: `${pct}%` }} />
                </div>
              )}
            </div>
          )}
        </section>

        <section className="card">
          <p className="label">Recent activity</p>
          {activity.length === 0 ? (
            <p className="text-sm text-muted">Nothing yet. Connect your AI and start a project.</p>
          ) : (
            <ul className="space-y-3 text-sm">
              {activity.map((a, i) => (
                <li key={i}>
                  <p className="font-mono text-xs text-ember">{a.tool}</p>
                  <p className="truncate text-muted" title={a.detail ?? ""}>
                    {a.engine ?? ""} {a.detail ? `· ${a.detail}` : ""}
                  </p>
                  <p className="text-xs text-faint">{a.at.toLocaleString("en-GB")}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <section className="card">
          <p className="label">API keys</p>
          <p className="mb-4 text-sm text-muted">For the Claude Desktop Companion, or any client that can&apos;t sign in with OAuth.</p>
          <NewKeyForm />
          {keys.length > 0 && (
            <table className="data-table mt-6">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Key</th>
                  <th>Last used</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id}>
                    <td>{k.name}</td>
                    <td className="font-mono text-xs text-muted">{k.prefix}…</td>
                    <td className="text-muted">{fmt(k.lastUsedAt)}</td>
                    <td className="text-right">
                      <form action={revokeApiKey}>
                        <input type="hidden" name="id" value={k.id} />
                        <button className="text-xs text-bad hover:underline">Revoke</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="card">
          <p className="label">Connected apps</p>
          {apps.length === 0 ? (
            <p className="text-sm text-muted">No apps signed in with OAuth yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {apps.map((a) => (
                <li key={a.clientId} className="flex items-center justify-between py-3 text-sm">
                  <div>
                    <p>{a.name}</p>
                    <p className="text-xs text-faint">Last sign-in {fmt(a.lastUsed)}</p>
                  </div>
                  <form action={disconnectApp}>
                    <input type="hidden" name="clientId" value={a.clientId} />
                    <button className="text-xs text-bad hover:underline">Disconnect</button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="card mt-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="label">Timeline editor</p>
          <p className="text-sm text-muted">
            Edit your videos in the browser. Run <code className="font-mono text-paper">npx -y framewright-companion --editor --site {baseUrl()}</code> in a project
            folder, or ask Claude Desktop to open the editor.
          </p>
        </div>
        <Link href="/editor" className="btn-ghost">
          Open editor
        </Link>
      </section>

      <h2 className="display mt-16 text-4xl">Connect your AI</h2>
      <div className="mt-6">
        <ConnectGuide />
      </div>
    </div>
  );
}
