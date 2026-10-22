"use client";

import { useActionState, useState } from "react";
import { saveVoice, type VoiceState } from "./voice-actions";

export function VoiceForm({ provider, hasKey }: { provider: "voicebox" | "elevenlabs"; hasKey: boolean }) {
  const [state, action, pending] = useActionState<VoiceState, FormData>(saveVoice, undefined);
  const [choice, setChoice] = useState(provider);
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {(
          [
            ["voicebox", "Voicebox", "Free and private. Runs on your computer; your AI installs it for you."],
            ["elevenlabs", "ElevenLabs", "Your own ElevenLabs account and voices. Uses your ElevenLabs credits."],
          ] as const
        ).map(([value, title, body]) => (
          <label key={value} className={`cursor-pointer rounded-xl border p-4 text-sm ${choice === value ? "border-ember/70 bg-ember/5" : "border-line"}`}>
            <span className="flex items-center gap-2">
              <input type="radio" name="provider" value={value} checked={choice === value} onChange={() => setChoice(value)} className="accent-[var(--color-ember)]" />
              <span className="text-paper">{title}</span>
              {value === "voicebox" && <span className="text-xs text-faint">default</span>}
            </span>
            <span className="mt-1.5 block text-muted">{body}</span>
          </label>
        ))}
      </div>
      {choice === "elevenlabs" && (
        <div>
          <label className="label" htmlFor="el-key">ElevenLabs API key</label>
          <input
            id="el-key"
            name="key"
            type="password"
            autoComplete="off"
            className="input font-mono"
            placeholder={hasKey ? "Saved. Paste a new key only to replace it." : "From ElevenLabs → Developers → API keys"}
          />
          <p className="mt-1 text-xs text-faint">
            Stored encrypted. Your AI never sees it: it gets a private, short-lived link and we call ElevenLabs for you. The key needs
            text-to-speech and voices (read) access.
          </p>
          {hasKey && (
            <label className="mt-2 flex items-center gap-2 text-xs text-muted">
              <input type="checkbox" name="remove" className="accent-[var(--color-ember)]" /> Remove my key and go back to Voicebox
            </label>
          )}
        </div>
      )}
      <div className="flex items-center justify-end gap-4">
        {state?.error && <p className="text-sm text-bad">{state.error}</p>}
        {state?.ok && <p className="text-sm text-ok">{state.ok}</p>}
        <button className="btn-primary" disabled={pending}>{pending ? "Checking…" : "Save voice"}</button>
      </div>
    </form>
  );
}
