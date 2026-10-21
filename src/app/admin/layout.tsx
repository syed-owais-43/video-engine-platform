import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth";

export const metadata: Metadata = { title: "Admin" };

const tabs = [
  { href: "/admin", label: "Analytics" },
  { href: "/admin/engines", label: "Engines" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/plans", label: "Plans" },
  { href: "/admin/settings", label: "Settings" },
];

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  await requireAdmin();
  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Admin</p>
          <h1 className="display mt-2 text-5xl">Control room</h1>
        </div>
        <nav className="flex flex-wrap gap-1 rounded-full border border-line p-1 text-sm">
          {tabs.map((t) => (
            <Link key={t.href} href={t.href} className="rounded-full px-4 py-1.5 text-muted hover:bg-ink-3 hover:text-paper">
              {t.label}
            </Link>
          ))}
        </nav>
      </div>
      <div className="mt-10">{children}</div>
    </div>
  );
}
