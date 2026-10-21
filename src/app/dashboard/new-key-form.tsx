"use client";

import { useActionState } from "react";
import { createApiKey, type KeyState } from "./key-actions";
import { CopyBlock } from "@/components/copy-block";

export function NewKeyForm() {
  const [state, action, pending] = useActionState<KeyState, FormData>(createApiKey, undefined);
  return (
    <div>
      <form action={action} className="flex flex-col gap-2 sm:flex-row">
        <input name="name" placeholder="Key name, e.g. Work laptop" className="input" maxLength={60} />
        <button className="btn-primary shrink-0" disabled={pending}>
          {pending ? "Creating…" : "Create key"}
        </button>
      </form>
      {state?.error && <p className="mt-3 text-sm text-bad">{state.error}</p>}
      {state?.key && (
        <div className="mt-4 rounded-xl border border-ember/50 bg-ember/5 p-4">
          <p className="mb-2 text-sm">Copy this key now. You won&apos;t be able to see it again.</p>
          <CopyBlock code={state.key} />
        </div>
      )}
    </div>
  );
}
