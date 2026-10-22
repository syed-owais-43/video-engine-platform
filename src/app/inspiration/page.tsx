import type { Metadata } from "next";
import Link from "next/link";
import { CopyBlock } from "@/components/copy-block";
import { getAccess } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import { filesOf, findPath, galleryFileUrl, listItems, SHELVES } from "@/lib/library";
import { getBrand } from "@/lib/settings";

export const metadata: Metadata = { title: "Inspiration" };

export default async function InspirationPage() {
  const [items, brand, user] = await Promise.all([listItems("ref", { published: true }), getBrand(), getCurrentUser()]);
  const files = await filesOf(items.map((i) => i.id));
  const subscriber = user ? (await getAccess(user)).active : false;
  return (
    <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
      <p className="eyebrow">Inspiration library</p>
      <h1 className="display mt-4 text-6xl sm:text-7xl">Videos, taken apart.</h1>
      <p className="mt-5 max-w-2xl text-muted">
        Standout videos broken down shot by shot: structure, type system, motion and sound. Ask your AI to make yours in the spirit of
        one, with your own content.
      </p>

      {items.length === 0 ? (
        <div className="card mt-12 text-muted">The first breakdowns are on their way. Check back soon.</div>
      ) : (
        <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {items.map((r) => {
            const mine = files.filter((f) => f.itemId === r.id);
            const hook = findPath(mine, SHELVES.ref.frames[1]) ?? findPath(mine, SHELVES.ref.frames[0]);
            const video = findPath(mine, SHELVES.ref.video);
            return (
              <article key={r.id} id={r.slug} className="card flex scroll-mt-24 flex-col !p-0 overflow-hidden">
                <div className="aspect-video bg-ink-3">
                  {video && subscriber ? (
                    <video src={galleryFileUrl(video.id)} poster={hook ? galleryFileUrl(hook.id) : undefined} controls preload="none" className="h-full w-full object-cover" />
                  ) : (
                    hook && <img src={galleryFileUrl(hook.id)} alt="" className="h-full w-full object-cover" />
                  )}
                </div>
                <div className="flex flex-1 flex-col p-5">
                  <h2 className="display text-3xl">{r.name}</h2>
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-muted">{r.description}</p>
                  {video && !subscriber && <p className="mt-3 text-xs text-faint">Subscribers can watch the original.</p>}
                  {r.tags.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {r.tags.map((t) => (
                        <span key={t} className="pill border-line text-muted">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="mt-4">
                    <CopyBlock wrap code={`Use ${brand.name} to make my video like the "${r.slug}" reference.`} />
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {!subscriber && (
        <p className="mt-10 text-sm text-muted">
          <Link href="/pricing" className="text-paper underline">Subscribe</Link> to use every reference and style with your AI.
        </p>
      )}
    </div>
  );
}
