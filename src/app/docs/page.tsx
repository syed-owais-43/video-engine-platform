import type { Metadata } from "next";
import Link from "next/link";
import { ConnectGuide } from "@/components/connect-guide";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Connect your AI" };

export default async function DocsPage() {
  const user = await getCurrentUser();
  return (
    <div className="mx-auto max-w-4xl px-4 py-20 sm:px-6">
      <p className="eyebrow">Setup · 2 minutes</p>
      <h1 className="display mt-4 text-6xl">Connect your AI</h1>
      <p className="mt-5 max-w-2xl text-muted">
        Framewright is an MCP server. Add it to your AI app once; after that, any video request can use the engines. You need an active
        subscription for the tools to work.
        {!user && (
          <>
            {" "}
            <Link href="/signup" className="text-paper underline">Create an account</Link> first.
          </>
        )}
      </p>
      <div className="mt-12">
        <ConnectGuide />
      </div>
    </div>
  );
}
