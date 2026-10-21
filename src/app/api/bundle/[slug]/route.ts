import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { engineVersions, engines, users } from "@/db/schema";
import { getAccess } from "@/lib/access";
import { verifySignature } from "@/lib/crypto";
import { buildBundle } from "@/lib/engines";

export async function GET(req: Request, ctx: RouteContext<"/api/bundle/[slug]">) {
  const { slug } = await ctx.params;
  const q = new URL(req.url).searchParams;
  const versionId = q.get("v") ?? "";
  const userId = q.get("u") ?? "";
  const exp = Number(q.get("exp"));
  const sig = q.get("sig") ?? "";

  if (!exp || exp < Date.now() / 1000 || !verifySignature(`${slug}:${versionId}:${userId}:${exp}`, sig)) {
    return new Response("Link expired or invalid. Ask your AI to call get_scripts again.", { status: 403 });
  }
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user || !(await getAccess(user)).active) return new Response("Subscription required", { status: 402 });

  const [row] = await db
    .select({ id: engineVersions.id })
    .from(engineVersions)
    .innerJoin(engines, eq(engines.id, engineVersions.engineId))
    .where(and(eq(engines.slug, slug), eq(engineVersions.id, versionId)));
  if (!row) return new Response("Not found", { status: 404 });

  const zip = await buildBundle(slug, versionId);
  return new Response(new Uint8Array(zip), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${slug}.zip"`,
      "cache-control": "private, no-store",
    },
  });
}
