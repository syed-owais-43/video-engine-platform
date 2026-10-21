import { and, desc, eq, ilike, inArray, or, sum } from "drizzle-orm";
import { db } from "@/db";
import { creditLedger, plans, subscriptions, users } from "@/db/schema";
import { ACTIVE_STATUSES } from "@/lib/access";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { adjustCredits, setUserFlags } from "../actions";
import { ResetPasswordButton } from "../forms";

function Toggle({ id, field, value, label }: { id: string; field: string; value: boolean; label: string }) {
  return (
    <form action={setUserFlags}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="field" value={field} />
      <input type="hidden" name="value" value={String(!value)} />
      <button className={`pill ${value ? "border-ember/50 text-ember" : "border-line text-faint hover:text-paper"}`}>
        {label}: {value ? "on" : "off"}
      </button>
    </form>
  );
}

export default async function AdminUsers(props: PageProps<"/admin/users">) {
  const q = await props.searchParams;
  const search = typeof q.q === "string" ? q.q.trim() : "";
  const me = await getCurrentUser();

  const rows = await db
    .select({ user: users, sub: subscriptions, planName: plans.name })
    .from(users)
    .leftJoin(subscriptions, eq(subscriptions.userId, users.id))
    .leftJoin(plans, eq(plans.stripePriceId, subscriptions.priceId))
    .where(search ? or(ilike(users.email, `%${search}%`), ilike(users.name, `%${search}%`)) : undefined)
    .orderBy(desc(users.createdAt))
    .limit(200);

  // A user can have several subscription rows over time; keep the most relevant one.
  const byUser = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const prev = byUser.get(r.user.id);
    const active = r.sub && ACTIVE_STATUSES.includes(r.sub.status);
    if (!prev || (active && !(prev.sub && ACTIVE_STATUSES.includes(prev.sub.status)))) byUser.set(r.user.id, r);
  }

  const ids = [...byUser.keys()];
  const topups = ids.length
    ? await db
        .select({ userId: creditLedger.userId, n: sum(creditLedger.delta) })
        .from(creditLedger)
        .where(and(inArray(creditLedger.userId, ids), eq(creditLedger.bucket, "topup")))
        .groupBy(creditLedger.userId)
    : [];
  const credits = new Map(topups.map((t) => [t.userId, Number(t.n ?? 0)]));

  return (
    <section className="card overflow-x-auto">
      <form className="mb-6 flex gap-2">
        <input name="q" defaultValue={search} placeholder="Search email or name" className="input max-w-sm" />
        <button className="btn-ghost">Search</button>
      </form>
      <table className="data-table">
        <thead>
          <tr>
            <th>User</th>
            <th>Joined</th>
            <th>Subscription</th>
            <th>Access</th>
            <th>Extra credits</th>
          </tr>
        </thead>
        <tbody>
          {[...byUser.values()].map(({ user, sub, planName }) => {
            const active = sub && ACTIVE_STATUSES.includes(sub.status);
            return (
              <tr key={user.id}>
                <td>
                  <p>{user.email}</p>
                  <p className="text-xs text-faint">
                    {user.name ?? ""} {user.googleId ? "· Google" : ""} {user.passwordHash ? "· password" : ""}
                  </p>
                </td>
                <td className="whitespace-nowrap text-muted">{user.createdAt.toLocaleDateString("en-GB")}</td>
                <td>
                  {sub ? (
                    <>
                      <span className={`pill ${active ? "border-ok/40 text-ok" : "border-line text-muted"}`}>{sub.status}</span>
                      <p className="mt-1 text-xs text-faint">
                        {planName ?? sub.priceId}
                        {sub.currentPeriodEnd ? ` · to ${sub.currentPeriodEnd.toLocaleDateString("en-GB")}` : ""}
                      </p>
                    </>
                  ) : (
                    <span className="text-faint">—</span>
                  )}
                </td>
                <td>
                  <div className="flex flex-wrap gap-1.5">
                    <Toggle id={user.id} field="compAccess" value={user.compAccess} label="Comp" />
                    {me?.id !== user.id && <Toggle id={user.id} field="admin" value={isAdmin(user)} label="Admin" />}
                    {me?.id !== user.id && <ResetPasswordButton id={user.id} />}
                  </div>
                </td>
                <td>
                  <form action={adjustCredits} className="flex items-center gap-1.5">
                    <input type="hidden" name="id" value={user.id} />
                    <span className="w-14 text-xs text-muted tabular-nums" title="Top-up credits: purchases and admin adjustments, minus what was spent from them">{credits.get(user.id) ?? 0}</span>
                    <input name="delta" type="number" placeholder="±" className="input w-20 !px-2 !py-1 text-xs" />
                    <button className="text-xs text-muted hover:text-paper">Apply</button>
                  </form>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
