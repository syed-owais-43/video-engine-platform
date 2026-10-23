import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, type User } from "@/db/schema";
import { baseUrl } from "./config";
import { sign, verifySignature } from "./crypto";
import { decrypt, encrypt } from "./settings";

// Voice-over: Voicebox (free, on the user's PC) by default. Users who prefer ElevenLabs save their
// own API key in the dashboard. The key is stored encrypted and never handed to their AI: the AI
// gets a short-lived signed link to /api/voice/tts, and the site calls ElevenLabs with the key.

const API = "https://api.elevenlabs.io";
export const ELEVENLABS_MODEL = "eleven_multilingual_v2";
export const TTS_LINK_TTL = 2 * 60 * 60;
export const MAX_TTS_CHARS = 5000;

export function elevenlabsKeyOf(user: Pick<User, "elevenlabsKey">): string | null {
  if (!user.elevenlabsKey) return null;
  try {
    return decrypt(user.elevenlabsKey);
  } catch {
    return null; // APP_SECRET changed: the user has to enter the key again.
  }
}

export function usesElevenlabs(user: Pick<User, "voiceProvider" | "elevenlabsKey">) {
  return user.voiceProvider === "elevenlabs" && Boolean(elevenlabsKeyOf(user));
}

export async function saveVoiceSettings(userId: string, provider: "voicebox" | "elevenlabs", key?: string | null) {
  await db
    .update(users)
    .set({ voiceProvider: provider, ...(key !== undefined ? { elevenlabsKey: key ? encrypt(key) : null } : {}) })
    .where(eq(users.id, userId));
}

export type Voice = { voice_id: string; name: string; category?: string; labels?: Record<string, string> };

// Also used to check a key before saving it.
export async function listVoices(key: string): Promise<Voice[]> {
  const res = await fetch(`${API}/v1/voices`, { headers: { "xi-api-key": key }, signal: AbortSignal.timeout(15_000) });
  if (res.status === 401) throw new Error("ElevenLabs didn't accept this API key.");
  if (!res.ok) throw new Error(`ElevenLabs returned ${res.status} when listing voices.`);
  return ((await res.json()) as { voices?: Voice[] }).voices ?? [];
}

export async function textToSpeech(key: string, voiceId: string, text: string, opts: { modelId?: string; format?: string } = {}) {
  const format = opts.format ?? "mp3_44100_128";
  return fetch(`${API}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${encodeURIComponent(format)}`, {
    method: "POST",
    headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: opts.modelId ?? ELEVENLABS_MODEL }),
    signal: AbortSignal.timeout(55_000),
  });
}

export function signedTtsUrl(userId: string) {
  const exp = Math.floor(Date.now() / 1000) + TTS_LINK_TTL;
  const q = new URLSearchParams({ u: userId, exp: String(exp), sig: sign(`tts:${userId}:${exp}`) });
  return `${baseUrl()}/api/voice/tts?${q}`;
}

export function verifyTtsLink(q: URLSearchParams): string | null {
  const userId = q.get("u") ?? "";
  const exp = Number(q.get("exp"));
  if (!userId || !exp || exp < Date.now() / 1000) return null;
  return verifySignature(`tts:${userId}:${exp}`, q.get("sig") ?? "") ? userId : null;
}
