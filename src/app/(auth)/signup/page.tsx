import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser, safeNext } from "@/lib/auth";
import { googleConfigured } from "@/lib/config";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Create account" };

export default async function SignupPage(props: PageProps<"/signup">) {
  const q = await props.searchParams;
  const next = typeof q.next === "string" ? q.next : undefined;
  if (await getCurrentUser()) redirect(safeNext(next));
  return (
    <div className="px-4 py-20">
      <AuthForm mode="signup" next={next} googleEnabled={googleConfigured()} />
      <p className="mx-auto mt-8 max-w-sm text-center text-xs text-faint">
        By creating an account you agree to the <a href="/terms" className="underline">terms and engine licence</a>.
      </p>
    </div>
  );
}
