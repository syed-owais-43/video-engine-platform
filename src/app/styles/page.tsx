import type { Metadata } from "next";
import { GalleryVideo } from "@/components/gallery-video";
import { CopyBlock } from "@/components/copy-block";
import { getAccess } from "@/lib/access";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { filesOf, findPath, fontsOf, galleryFileUrl, listItems, paletteOf, SHELVES } from "@/lib/library";
import { getBrand } from "@/lib/settings";

export const metadata: Metadata = { title: "Styles" };

export default async function StylesPage() {
  const [items, brand, user] = await Promise.all([listItems("style", { published: true }), getBrand(), getCurrentUser()]);
  const files = await filesOf(items.map((i) => i.id));
  // The contact sheet can contain other creators' frames, so only subscribers see it here.
  const subscriber = user ? isAdmin(user) || (await getAccess(user)).active : false;
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
            const cover = findPath(mine, SHELVES.style.cover);
            const frames = subscriber ? findPath(mine, SHELVES.style.frames[0]) : null;
            const poster = cover ?? frames;
            const palette = paletteOf(s.meta);
            const fonts = fontsOf(s.meta);
            return (
              <article key={s.id} id={s.slug} className="card flex scroll-mt-24 flex-col !p-0 overflow-hidden">
                <div className="aspect-video overflow-hidden bg-ink-3">
                  {video ? (
                    <GalleryVideo src={galleryFileUrl(video.id)} poster={cover ? galleryFileUrl(cover.id) : undefined} className="h-full w-full object-cover" />
                  ) : poster ? (
                    // A contact sheet is tall: show its top row (the key frames) rather than the middle.
                    <img src={galleryFileUrl(poster.id)} alt="" className={`h-full w-full object-cover ${cover ? "" : "object-top"}`} />
                  ) : (
                    <PalettePoster name={s.name} palette={palette} font={fonts[0]} />
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
      </p>
    </div>
  );
}

// Stand-in artwork for styles without a cover or preview: the style's own palette and display font.
function PalettePoster({ name, palette, font }: { name: string; palette: string[]; font?: string }) {
  // Darkest colour as the background, lightest for the name, the rest as swatches.
  const sorted = [...palette].sort((x, y) => luminance(x) - luminance(y));
  const bg = sorted[0] ?? "#171512";
  const fg = sorted.length > 1 ? sorted[sorted.length - 1] : "#efe9dc";
  const rest = palette.filter((c) => c !== bg && c !== fg);
  return (
    <div className="relative flex h-full w-full items-end p-5" style={{ background: bg }}>
      <div className="absolute top-4 right-4 flex gap-1.5">
        {rest.slice(0, 5).map((c) => (
          <span key={c} className="h-4 w-4 rounded-full ring-1 ring-black/20" style={{ background: c }} />
        ))}
      </div>
      <span className="text-3xl leading-none font-semibold" style={{ color: fg, fontFamily: font ? `"${font}", serif` : undefined }}>
        {name}
      </span>
    </div>
  );
}

function luminance(hex: string) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) || 0);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
