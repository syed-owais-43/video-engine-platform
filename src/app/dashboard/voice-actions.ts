"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { elevenlabsKeyOf, listVoices, saveVoiceSettings } from "@/lib/voice";

export type VoiceState = { ok?: string; error?: string } | undefined;

export async function saveVoice(_: VoiceState, form: FormData): Promise<VoiceState> {
  const user = await requireUser("/dashboard");
  if (form.get("remove") === "on") {
    await saveVoiceSettings(user.id, "voicebox", null);
    revalidatePath("/dashboard");
    return { ok: "ElevenLabs key removed. Your videos use Voicebox." };
  }
  const provider = form.get("provider") === "elevenlabs" ? "elevenlabs" : "voicebox";
  const key = String(form.get("key") ?? "").trim();
  if (provider === "voicebox") {
    await saveVoiceSettings(user.id, "voicebox");
    revalidatePath("/dashboard");
    return { ok: "Saved. Your videos use Voicebox, free on your computer." };
  }
  if (!key && !elevenlabsKeyOf(user)) return { error: "Paste your ElevenLabs API key (ElevenLabs → Developers → API keys)." };
  if (key) {
    if (!/^[\w-]{20,200}$/.test(key)) return { error: "That doesn't look like an ElevenLabs API key." };
    try {
      await listVoices(key);
    } catch (e) {
      return { error: e instanceof Error ? e.message : "ElevenLabs didn't accept the key." };
    }
  }
  await saveVoiceSettings(user.id, "elevenlabs", key || undefined);
  revalidatePath("/dashboard");
  return { ok: "Saved. Your AI will use ElevenLabs with your key; the key stays encrypted on our side and is never shown to it." };
}
