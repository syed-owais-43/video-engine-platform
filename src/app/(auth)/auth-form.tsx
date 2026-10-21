"use client";

import { useActionState } from "react";
import Link from "next/link";
import { login, signup, type AuthState } from "./actions";

export function AuthForm({ mode, next, googleEnabled, error }: { mode: "login" | "signup"; next?: string; googleEnabled: boolean; error?: string }) {
  const [state, action, pending] = useActionState<AuthState, FormData>(mode === "login" ? login : signup, undefined);
  const message = state?.error ?? error;
  const googleHref = `/api/auth/google${next ? `?next=${encodeURIComponent(next)}` : ""}`;

  return (
    <div className="mx-auto w-full max-w-sm">
      <h1 className="display text-5xl">{mode === "login" ? "Welcome back" : "Create account"}</h1>
      <p className="mt-3 text-sm text-muted">
        {mode === "login" ? "Log in to manage your subscription and connect your AI." : "Then pick a plan and connect your AI."}
      </p>

      {googleEnabled && (
        <>
          <a href={googleHref} className="btn-ghost mt-8 w-full">
            <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
              <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
              <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
              <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.5 2.4-7.2 2.4-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
              <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
            </svg>
            Continue with Google
          </a>
          <div className="my-6 flex items-center gap-3 text-xs text-faint">
            <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
          </div>
        </>
      )}

      <form action={action} className={`space-y-4 ${googleEnabled ? "" : "mt-8"}`}>
        <input type="hidden" name="next" value={next ?? ""} />
        {mode === "signup" && (
          <div>
            <label className="label" htmlFor="name">Name</label>
            <input id="name" name="name" className="input" autoComplete="name" />
          </div>
        )}
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required className="input" autoComplete="email" />
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            className="input"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
          />
        </div>
        {message && <p className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{message}</p>}
        <button className="btn-primary w-full" disabled={pending}>
          {pending ? "One moment…" : mode === "login" ? "Log in" : "Create account"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        {mode === "login" ? (
          <>
            New here? <Link href={`/signup${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="text-paper underline">Create an account</Link>
          </>
        ) : (
          <>
            Have an account? <Link href={`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="text-paper underline">Log in</Link>
          </>
        )}
      </p>
    </div>
  );
}
