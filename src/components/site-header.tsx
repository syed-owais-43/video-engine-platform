import Link from "next/link";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { logout } from "@/app/(auth)/actions";
import { getBrand } from "@/lib/settings";

export function LogoMark({ logo, size = 22 }: { logo: string | null; size?: number }) {
  if (logo) return <img src={logo} alt="" width={size} height={size} className="rounded object-contain" style={{ width: size, height: size }} />;
  return (
    <svg width={size} height={size} viewBox="0 0 22 22" aria-hidden>
      <rect x="1" y="1" width="20" height="20" rx="4" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7 6.5v9l8-4.5z" fill="var(--color-ember)" />
    </svg>
  );
}

export async function SiteHeader() {
  const [user, brand] = await Promise.all([getCurrentUser(), getBrand()]);
  return (
    <header className="sticky top-0 z-30 border-b border-line/70 bg-ink/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <LogoMark logo={brand.logo} />
          <span className="font-display text-2xl leading-none">{brand.name}</span>
        </Link>
        <nav className="flex items-center gap-1 whitespace-nowrap text-sm sm:gap-2">
          <Link href="/styles" className="hidden rounded-full px-3 py-2 text-muted hover:text-paper md:block">
            Styles
          </Link>
          <Link href="/inspiration" className="hidden rounded-full px-3 py-2 text-muted hover:text-paper lg:block">
            Inspiration
          </Link>
          <Link href="/docs" className="hidden rounded-full px-3 py-2 text-muted hover:text-paper sm:block">
            Connect
          </Link>
          <Link href="/pricing" className="rounded-full px-3 py-2 text-muted hover:text-paper">
            Pricing
          </Link>
          {user ? (
            <>
              {isAdmin(user) && (
                <Link href="/admin" className="rounded-full px-3 py-2 text-muted hover:text-paper">
                  Admin
                </Link>
              )}
              <Link href="/dashboard" className="btn-ghost !py-1.5">
                Dashboard
              </Link>
              <form action={logout}>
                <button className="hidden px-2 py-2 text-muted hover:text-paper sm:block">Log out</button>
              </form>
            </>
          ) : (
            <>
              <Link href="/login" className="rounded-full px-3 py-2 text-muted hover:text-paper">
                Log in
              </Link>
              <Link href="/signup" className="btn-primary !py-1.5">
                Start
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
