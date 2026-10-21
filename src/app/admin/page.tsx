import { and, count, countDistinct, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { engines, usageEvents, users } from "@/db/schema";
import { activeSubscriberIds, PROJECT_TOOL } from "@/lib/access";

const DAYS = 30;

async function loadAnalytics() {
  const since = new Date(Date.now() - DAYS * 86400_000);
  const day = sql<string>`to_char(date_trunc('day', ${usageEvents.createdAt}), 'YYYY-MM-DD')`;

  const [[{ totalUsers }], [{ compUsers }], subscriberIds, [{ projects }], [{ activeUsers }], daily, byEngine, byTool, recent] =
    await Promise.all([
      db.select({ totalUsers: count() }).from(users),
      db.select({ compUsers: count() }).from(users).where(eq(users.compAccess, true)),
      activeSubscriberIds(),
      db.select({ projects: count() }).from(usageEvents).where(and(eq(usageEvents.tool, PROJECT_TOOL), gte(usageEvents.createdAt, since))),
      db.select({ activeUsers: countDistinct(usageEvents.userId) }).from(usageEvents).where(gte(usageEvents.createdAt, since)),
      db
        .select({ day, n: count() })
        .from(usageEvents)
        .where(and(eq(usageEvents.tool, PROJECT_TOOL), gte(usageEvents.createdAt, since)))
        .groupBy(day)
        .orderBy(day),
      db
        .select({ name: engines.name, n: count() })
        .from(usageEvents)
        .innerJoin(engines, eq(engines.id, usageEvents.engineId))
        .where(gte(usageEvents.createdAt, since))
        .groupBy(engines.name)
        .orderBy(desc(count())),
      db
        .select({ tool: usageEvents.tool, n: count() })
        .from(usageEvents)
        .where(gte(usageEvents.createdAt, since))
        .groupBy(usageEvents.tool)
        .orderBy(desc(count())),
      db
        .select({ email: users.email, tool: usageEvents.tool, detail: usageEvents.detail, at: usageEvents.createdAt, engine: engines.slug })
        .from(usageEvents)
        .innerJoin(users, eq(users.id, usageEvents.userId))
        .leftJoin(engines, eq(engines.id, usageEvents.engineId))
        .orderBy(desc(usageEvents.createdAt))
        .limit(25),
    ]);

  // Fill every day in the window so gaps show as zero.
  const counts = new Map(daily.map((d) => [d.day, d.n]));
  const series = Array.from({ length: DAYS }, (_, i) => {
    const d = new Date(Date.now() - (DAYS - 1 - i) * 86400_000).toISOString().slice(0, 10);
    return { day: d, n: counts.get(d) ?? 0 };
  });
  return { totalUsers, compUsers, subscriberIds, projects, activeUsers, series, byEngine, byTool, recent };
}

export default async function AdminAnalytics() {
  const { totalUsers, compUsers, subscriberIds, projects, activeUsers, series, byEngine, byTool, recent } = await loadAnalytics();
  const peak = Math.max(1, ...series.map((s) => s.n));

  const stats = [
    { label: "Users", value: totalUsers },
    { label: "Paying subscribers", value: subscriberIds.size },
    { label: "Complimentary", value: compUsers },
    { label: `Projects · ${DAYS}d`, value: projects },
    { label: `Active users · ${DAYS}d`, value: activeUsers },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-5">
        {stats.map((s) => (
          <div key={s.label} className="bg-ink-2 p-5">
            <p className="text-xs uppercase tracking-wider text-muted">{s.label}</p>
            <p className="display mt-2 text-5xl">{s.value}</p>
          </div>
        ))}
      </div>

      <section className="card">
        <div className="flex items-baseline justify-between">
          <p className="label">Projects started per day</p>
          <p className="text-xs text-faint">peak {peak}</p>
        </div>
        <div className="mt-4 flex h-40 items-end gap-[3px]" role="img" aria-label={`Projects per day over the last ${DAYS} days`}>
          {series.map((s) => (
            <div key={s.day} className="group relative flex-1">
              <div
                className="w-full rounded-t-sm bg-ember/80 group-hover:bg-ember"
                style={{ height: `${Math.max(s.n ? 4 : 1, (s.n / peak) * 160)}px`, opacity: s.n ? 1 : 0.25 }}
              />
              <span className="pointer-events-none absolute -top-7 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-paper px-1.5 py-0.5 text-[10px] text-ink group-hover:block">
                {s.day.slice(5)} · {s.n}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-2 flex justify-between text-[10px] text-faint">
          <span>{series[0].day}</span>
          <span>{series[series.length - 1].day}</span>
        </div>
      </section>

      <div className="grid gap-5 md:grid-cols-2">
        <section className="card">
          <p className="label">Engine usage · {DAYS}d</p>
          <BarList rows={byEngine.map((r) => ({ label: r.name, n: r.n }))} />
        </section>
        <section className="card">
          <p className="label">Tool calls · {DAYS}d</p>
          <BarList rows={byTool.map((r) => ({ label: r.tool, n: r.n }))} mono />
        </section>
      </div>

      <section className="card overflow-x-auto">
        <p className="label">Latest activity</p>
        <table className="data-table">
          <thead>
            <tr>
              <th>When</th>
              <th>User</th>
              <th>Tool</th>
              <th>Engine</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((r, i) => (
              <tr key={i}>
                <td className="whitespace-nowrap text-muted">{r.at.toLocaleString("en-GB")}</td>
                <td>{r.email}</td>
                <td className="font-mono text-xs text-ember">{r.tool}</td>
                <td className="text-muted">{r.engine ?? "—"}</td>
                <td className="max-w-xs truncate text-muted" title={r.detail ?? ""}>{r.detail ?? ""}</td>
              </tr>
            ))}
            {recent.length === 0 && (
              <tr>
                <td colSpan={5} className="text-muted">No activity yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function BarList({ rows, mono }: { rows: { label: string; n: number }[]; mono?: boolean }) {
  if (!rows.length) return <p className="text-sm text-muted">No data yet.</p>;
  const peak = Math.max(...rows.map((r) => r.n));
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label} className="text-sm">
          <div className="flex justify-between">
            <span className={mono ? "font-mono text-xs" : ""}>{r.label}</span>
            <span className="tabular-nums text-muted">{r.n}</span>
          </div>
          <div className="mt-1 h-1 rounded-full bg-line">
            <div className="h-full rounded-full bg-ember" style={{ width: `${(r.n / peak) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
