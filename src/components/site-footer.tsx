import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="border-t border-line/70">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-10 text-sm text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>
          <span className="font-display text-lg text-paper">Framewright</span> · Engines by Miftahul Islam
        </p>
        <div className="flex gap-5">
          <Link href="/docs" className="hover:text-paper">Connect your AI</Link>
          <Link href="/pricing" className="hover:text-paper">Pricing</Link>
          <Link href="/terms" className="hover:text-paper">Terms</Link>
        </div>
      </div>
    </footer>
  );
}
