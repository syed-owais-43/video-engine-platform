import Link from "next/link";
import { getBrand } from "@/lib/settings";

export async function SiteFooter() {
  const brand = await getBrand();
  return (
    <footer className="border-t border-line/70">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-10 text-sm text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>
          <span className="font-display text-lg text-paper">{brand.name}</span> · © {new Date().getFullYear()}
          {brand.supportEmail && (
            <>
              {" · "}
              <a href={`mailto:${brand.supportEmail}`} className="hover:text-paper">
                {brand.supportEmail}
              </a>
            </>
          )}
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
