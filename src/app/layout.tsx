import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { getBrand } from "@/lib/settings";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const instrumentSerif = Instrument_Serif({ variable: "--font-instrument-serif", subsets: ["latin"], weight: "400", style: ["normal", "italic"] });

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getBrand();
  return {
    title: { default: `${brand.name} — ${brand.tagline.toLowerCase()}`, template: `%s · ${brand.name}` },
    description: `Connect Claude, Cursor or any MCP agent to ${brand.name}. Describe a video, and your AI fetches the right engine and renders it on your own machine.`,
    ...(brand.logo ? { icons: { icon: brand.logo } } : {}),
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const brand = await getBrand();
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} h-full antialiased`}
      style={{ "--color-ember": brand.accent } as CSSProperties}
    >
      <body className="flex min-h-full flex-col">
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
