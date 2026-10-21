import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser, safeNext } from "@/lib/auth";
import { googleReady } from "@/lib/settings";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Log in" };

export default async function LoginPage(props: PageProps<"/login">) {
  const q = await props.searchParams;
  const next = typeof q.next === "string" ? q.next : undefined;
  if (await getCurrentUser()) redirect(safeNext(next));
  const error = q.error === "google" ? "Google sign-in failed. Please try again." : undefined;
  return (
    <div className="px-4 py-20">
      <AuthForm mode="login" next={next} googleEnabled={await googleReady()} error={error} />
    </div>
  );
}
