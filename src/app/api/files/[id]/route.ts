import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getAccess } from "@/lib/access";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { fileBytes, isPublicFile, readFile, verifyFileLink } from "@/lib/library";

// Serves library files. Gallery previews of published items are public; everything else needs an
// active subscription, shown either by a signed link (made for the subscriber's AI) or by being
// signed in on the site. Files in Vercel Blob are redirected to; database-stored files are streamed.
export async function GET(req: Request, ctx: RouteContext<"/api/files/[id]">) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const row = await readFile(id);
  if (!row) return new Response("Not found", { status: 404 });
  const { file, item } = row;

  const publicFile = isPublicFile(item, file.path);
  if (!publicFile) {
    const linkUser = verifyFileLink(id, new URL(req.url).searchParams);
    const [user] = linkUser ? await db.select().from(users).where(eq(users.id, linkUser)) : [await getCurrentUser()];
    const allowed = user && (isAdmin(user) || (item.published && (await getAccess(user)).active));
    if (!allowed) {
      return new Response(user ? "An active subscription is needed for this file." : "Sign in with an active subscription to get this file.", {
        status: user ? 402 : 401,
      });
    }
  }
  const cache = publicFile ? "public, max-age=300" : "private, no-store";
  if (file.url) return new Response(null, { status: 302, headers: { location: file.url, "cache-control": cache } });

  const bytes = await fileBytes(id);
  if (!bytes) return new Response("Not found", { status: 404 });
  const name = file.path.split("/").pop()!.replace(/"/g, "");
  const headers: Record<string, string> = {
    "content-type": file.contentType,
    "accept-ranges": "bytes",
    "cache-control": cache,
    "content-disposition": `inline; filename="${name}"`,
  };
  // Videos need byte ranges to play and seek.
  const range = req.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (range && (range[1] || range[2])) {
    const size = bytes.length;
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(size - 1, Number(range[2])) : size - 1;
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    return new Response(new Uint8Array(bytes.subarray(start, end + 1)), {
      status: 206,
      headers: { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) },
    });
  }
  return new Response(new Uint8Array(bytes), { headers: { ...headers, "content-length": String(bytes.length) } });
}
