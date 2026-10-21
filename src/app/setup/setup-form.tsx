"use client";

import { useActionState } from "react";
import { completeSetup, type SetupState } from "./actions";

export function SetupForm() {
  const [state, action, pending] = useActionState<SetupState, FormData>(completeSetup, undefined);
  return (
    <form action={action} className="space-y-4">
      <div>
        <label className="label" htmlFor="code">Setup code</label>
        <input id="code" name="code" required className="input font-mono tracking-widest uppercase" placeholder="XXXX-XXXX-XXXX" autoComplete="off" />
      </div>
      <div>
        <label className="label" htmlFor="name">Your name</label>
        <input id="name" name="name" className="input" autoComplete="name" />
      </div>
      <div>
        <label className="label" htmlFor="email">Admin email</label>
        <input id="email" name="email" type="email" required className="input" autoComplete="email" />
      </div>
      <div>
        <label className="label" htmlFor="password">Admin password</label>
        <input id="password" name="password" type="password" required minLength={10} className="input" autoComplete="new-password" />
      </div>
      {state?.error && <p className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">{state.error}</p>}
      <button className="btn-primary w-full" disabled={pending}>
        {pending ? "Creating…" : "Create admin account"}
      </button>
    </form>
  );
}
