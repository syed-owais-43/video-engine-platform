import "server-only";

// Thin client for fal.ai's synchronous model endpoints (https://fal.run/<model-id>).
// FAL_API_BASE can point at a mock server for tests.

export const ASPECTS = {
  square: "square_hd",
  landscape: "landscape_16_9",
  portrait: "portrait_16_9",
  "landscape-4-3": "landscape_4_3",
  "portrait-4-3": "portrait_4_3",
} as const;
export type Aspect = keyof typeof ASPECTS;

export type FalImage = { url: string; width?: number; height?: number; content_type?: string };

export async function generateImage(opts: { falKey: string; endpoint: string; prompt: string; aspect: Aspect; seed?: number }) {
  const base = (process.env.FAL_API_BASE ?? "https://fal.run").replace(/\/$/, "");
  const res = await fetch(`${base}/${opts.endpoint}`, {
    method: "POST",
    headers: { authorization: `Key ${opts.falKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      prompt: opts.prompt,
      image_size: ASPECTS[opts.aspect],
      num_images: 1,
      enable_safety_checker: true,
      ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const body = (await res.json().catch(() => ({}))) as { images?: FalImage[]; detail?: unknown; error?: string };
  if (!res.ok) {
    const detail = typeof body.detail === "string" ? body.detail : body.error ?? JSON.stringify(body.detail ?? body).slice(0, 300);
    throw new Error(`fal.ai returned ${res.status}: ${detail}`);
  }
  if (!body.images?.length) throw new Error("fal.ai returned no image");
  return { images: body.images };
}
