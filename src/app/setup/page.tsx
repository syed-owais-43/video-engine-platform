import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { adminExists, ensureSetupCode } from "@/lib/setup";
import { newSetupCode } from "./actions";
import { SetupForm } from "./setup-form";

export const metadata: Metadata = { title: "Set up" };

export default async function SetupPage(props: PageProps<"/setup">) {
  if (await adminExists()) redirect("/login");
  await ensureSetupCode();
  const fresh = (await props.searchParams).new === "1";
  const fromEnv = Boolean(process.env.SETUP_CODE);

  return (
    <div className="mx-auto max-w-md px-4 py-20">
      <p className="eyebrow">First-time setup</p>
      <h1 className="display mt-3 text-5xl">Create the admin account</h1>
      <div className="mt-5 space-y-3 text-sm text-muted">
        {fromEnv ? (
          <p>Enter the setup code you put in the <code className="font-mono text-paper">SETUP_CODE</code> setting of your hosting.</p>
        ) : (
          <>
            <p>
              A one-time setup code was printed in your server log{fresh ? " just now" : ""}. Look for{" "}
              <code className="font-mono text-paper">SETUP CODE</code>:
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Running locally: in the terminal where <code className="font-mono text-paper">npm run dev</code> is running.</li>
              <li>On Vercel: Project → Logs, then search for &ldquo;SETUP CODE&rdquo;.</li>
            </ul>
          </>
        )}
        <p>This page disappears once the admin account exists.</p>
      </div>
      <div className="card mt-8">
        <SetupForm />
      </div>
      {!fromEnv && (
        <form action={newSetupCode} className="mt-4 text-center">
          <button className="text-xs text-faint underline hover:text-paper">Can&apos;t find it? Print a new code</button>
        </form>
      )}
    </div>
  );
}
