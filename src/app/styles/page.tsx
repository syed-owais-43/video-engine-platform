import type { Metadata } from "next";
import Link from "next/link";
import { GalleryVideo } from "@/components/gallery-video";
import { CopyBlock } from "@/components/copy-block";
import { filesOf, findPath, fontsOf, galleryFileUrl, listItems, paletteOf, SHELVES } from "@/lib/library";
import { getBrand } from "@/lib/settings";

export const metadata: Metadata = { title: "Styles" };

export default async function StylesPage() {
  const [items, brand] = await Promise.all([listItems("style", { published: true }), getBrand()]);
  const files = await filesOf(items.map((i) => i.id));
  return (
    <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
      <p className="eyebrow">Style library</p>
      <h1 className="display mt-4 text-6xl sm:text-7xl">Pick a look.</h1>
      <p className="mt-5 max-w-2xl text-muted">
        Each style is a complete recipe: palette, type, motion, easing and sound. Tell your AI which one you want and it builds your
        video in exactly that look, on your own computer.
      </p>

      {items.length === 0 ? (
        <div className="card mt-12 text-muted">The first styles are on their way. Check back soon.</div>
      ) : (
        <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {items.map((s) => {
            const mine = files.filter((f) => f.itemId === s.id);
            const video = findPath(mine, SHELVES.style.video);
            const frames = findPath(mine, SHELVES.style.frames[0]);
            const palette = paletteOf(s.meta);
            const fonts = fontsOf(s.meta);
            return (
              <article key={s.id} id={s.slug} className="card flex scroll-mt-24 flex-col !p-0 overflow-hidden">
                <div className="aspect-video bg-ink-3">
                  {video ? (
                    <GalleryVideo src={galleryFileUrl(video.id)} poster={frames ? galleryFileUrl(frames.id) : undefined} className="h-full w-full object-cover" />
                  ) : (
                    frames && <img src={galleryFileUrl(frames.id)} alt="" className="h-full w-full object-cover" />
                  )}
                </div>
                <div className="flex flex-1 flex-col p-5">
                  <h2 className="display text-3xl">{s.name}</h2>
                  <p className="mt-2 flex-1 text-sm leading-relaxed text-muted">{s.description}</p>
                  {(palette.length > 0 || fonts.length > 0) && (
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      {palette.length > 0 && (
                        <div className="flex -space-x-1">
                          {palette.map((c) => (
                            <span key={c} title={c} className="h-5 w-5 rounded-full border border-ink-2" style={{ background: c }} />
                          ))}
                        </div>
                      )}
                      {fonts.length > 0 && <span className="text-xs text-faint">{fonts.join(" · ")}</span>}
                    </div>
                  )}
                  {s.tags.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {s.tags.map((t) => (
                        <span key={t} className="pill border-line text-muted">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="mt-4">
                    <CopyBlock wrap code={`Use ${brand.name} to make my video in the "${s.slug}" style.`} />
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
      <p className="mt-10 text-sm text-muted">
        Have a video you love instead? Send your AI the file or a link, and it studies the reference and builds something in that spirit.
        See also the <Link href="/inspiration" className="text-paper underline">inspiration library</Link>.
      </p>
    </div>
  );
}
