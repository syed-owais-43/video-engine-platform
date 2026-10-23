import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getAccess } from "@/lib/access";
import { elevenlabsKeyOf, MAX_TTS_CHARS, textToSpeech, verifyTtsLink } from "@/lib/voice";

export const maxDuration = 60;

// ElevenLabs text-to-speech with the subscriber's own key. The signed link comes from the get_voice
// MCP tool, so the key itself never reaches the user's AI or their terminal history.
export async function POST(req: Request) {
  const userId = verifyTtsLink(new URL(req.url).searchParams);
  if (!userId) return Response.json({ error: "Link expired or invalid. Call get_voice again for a new one." }, { status: 403 });
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user || !(await getAccess(user)).active) return Response.json({ error: "An active subscription is needed." }, { status: 402 });
  const key = elevenlabsKeyOf(user);
  if (user.voiceProvider !== "elevenlabs" || !key) {
    return Response.json({ error: "ElevenLabs isn't set up for this account. Use Voicebox, or add a key in the dashboard." }, { status: 409 });
  }

  const body = (await req.json().catch(() => null)) as { text?: unknown; voice_id?: unknown; model_id?: unknown; output_format?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  const voiceId = typeof body?.voice_id === "string" ? body.voice_id.trim() : "";
  if (!text || text.length > MAX_TTS_CHARS) return Response.json({ error: `"text" is required (up to ${MAX_TTS_CHARS} characters).` }, { status: 400 });
  if (!/^[A-Za-z0-9]{8,64}$/.test(voiceId)) return Response.json({ error: '"voice_id" is required (from get_voice).' }, { status: 400 });
  const modelId = typeof body?.model_id === "string" && /^[a-z0-9_]{3,60}$/.test(body.model_id) ? body.model_id : undefined;
  const format = typeof body?.output_format === "string" && /^(mp3|pcm|ulaw|opus)_[0-9_]+$/.test(body.output_format) ? body.output_format : undefined;

  const res = await textToSpeech(key, voiceId, text, { modelId, format });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return Response.json({ error: `ElevenLabs returned ${res.status}: ${detail.slice(0, 300)}` }, { status: 502 });
  }
  return new Response(res.body, {
    headers: { "content-type": res.headers.get("content-type") ?? "audio/mpeg", "cache-control": "no-store" },
  });
}
