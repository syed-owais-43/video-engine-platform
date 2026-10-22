import Link from "next/link";
import { redirect } from "next/navigation";
import { listPublishedEngines } from "@/lib/engines";
import { getBrand } from "@/lib/settings";
import { adminExists } from "@/lib/setup";

const steps = (name: string) => [
  {
    n: "01",
    title: "Connect your AI",
    body: `Add ${name} as an MCP server in Claude Code, Claude Desktop or Cursor. Sign in once, and you're connected.`,
  },
  {
    n: "02",
    title: "Describe the video",
    body: "Tell your AI the idea, the length, the format, and drop in references. It picks the right engine for the job.",
  },
  {
    n: "03",
    title: "It renders on your machine",
    body: "Your AI follows the engine's direction, animates, sound-designs and exports the MP4 locally. Your files never leave your PC.",
  },
];

const faqs = (name: string) => [
  {
    q: "Where does the video get rendered?",
    a: `On your own computer. ${name} serves the engine's instructions to your AI; rendering uses your machine's Node.js, Python and FFmpeg. We never see your footage or references.`,
  },
  {
    q: "Which AI apps work?",
    a: `Any MCP-capable agent with file and terminal access: Claude Code, Cursor, Windsurf and similar. Claude Desktop works with the free ${name} Companion, which gives it a sandboxed workspace folder to render in.`,
  },
  {
    q: "What do I need installed?",
    a: "Nothing up front. The first time you connect, your AI sets up your computer itself: FFmpeg, a headless browser for rendering, Python with the analysis and speech models, Voicebox for free local voice-overs, and yt-dlp for reference links.",
  },
  {
    q: "Can I choose the look?",
    a: `Yes. Pick a style from the ${name} style library, or send your AI a reference video or a link to one. It builds your video in that look, with sound effects, fonts, textures and animations from our resource packs.`,
  },
  {
    q: "Can I edit the video myself?",
    a: `Yes. Open it in the ${name} timeline editor in your browser to move, trim and split scenes, change each scene's text, colours, size, speed and easing with sliders (re-rendered on your PC, no AI and no tokens needed), balance voice, music and sound effects, fix captions and add your own images or clips. Your files stay on your computer.`,
  },
  {
    q: "Can I keep editing in Premiere, Resolve or Final Cut?",
    a: "Yes. Ask your AI for an editable version and it exports a project folder: every scene as its own clip, voice, music and sound effects on separate tracks, and captions both as a styled overlay and as editable text. Open it in Premiere Pro, DaVinci Resolve or Final Cut Pro and keep cutting.",
  },
  {
    q: "Can I cancel any time?",
    a: "Yes. Manage or cancel your subscription from the dashboard. Access continues until the end of the period you paid for.",
  },
  {
    q: "Who owns the videos I make?",
    a: "You do. Finished videos can be used for personal and commercial work. The engines themselves stay licensed to your account and can't be redistributed.",
  },
];

export default async function Home() {
  // A fresh install has no admin yet: send the owner to first-run setup.
  if (!(await adminExists())) redirect("/setup");
  const [engines, brand] = await Promise.all([listPublishedEngines(), getBrand()]);
  const name = brand.name;
  return (
    <>
      <section className="relative overflow-hidden border-b border-line/70">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(90deg, var(--color-paper) 0 1px, transparent 1px 120px), repeating-linear-gradient(0deg, var(--color-paper) 0 1px, transparent 1px 120px)",
          }}
        />
        <div className="relative mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:py-28">
          <div>
            <p className="eyebrow">Video engines for your AI · via MCP</p>
            <h1 className="display mt-5 text-6xl sm:text-7xl lg:text-8xl">
              Describe it.
              <br />
              <em className="text-ember">Your AI</em> directs it.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">
              {name} gives Claude, Cursor and other agents a professional motion-design engine. Describe a video, and your AI plans,
              animates, voices and sound-designs it, then renders it on your own machine.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link href="/signup" className="btn-primary">
                Start creating
              </Link>
              <Link href="/styles" className="btn-ghost">
                Browse styles
              </Link>
            </div>
          </div>

          <div className="card !p-0 overflow-hidden shadow-2xl shadow-black/50">
            <div className="flex items-center gap-1.5 border-b border-line px-4 py-3">
              <span className="h-2.5 w-2.5 rounded-full bg-line" />
              <span className="h-2.5 w-2.5 rounded-full bg-line" />
              <span className="h-2.5 w-2.5 rounded-full bg-line" />
              <span className="ml-3 font-mono text-xs text-faint">claude · ~/videos/launch</span>
            </div>
            <div className="space-y-4 p-5 font-mono text-[13px] leading-relaxed">
              <p>
                <span className="text-ember">you ›</span> 20s kinetic-type promo for our app launch, 9:16, punchy, ref: launch.mp4
              </p>
              <p className="text-faint">⏺ framewright.start_project</p>
              <p className="pl-4 text-muted">Selected engine: motion-video-director v3.5.2</p>
              <p className="text-faint">⏺ framewright.get_guide reference/visual-design.md</p>
              <p className="text-faint">⏺ bash python analyze_ref.py launch.mp4</p>
              <p className="pl-4 text-muted">Storyboard: 6 beats, 120 BPM grid, approve?</p>
              <p>
                <span className="text-ember">you ›</span> go
              </p>
              <p className="text-faint">⏺ bash node render.js --fps 30</p>
              <p className="pl-4 text-ok">✓ exports/launch_v1.mp4 · 1080×1920 · 20.0s · -14 LUFS</p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <p className="eyebrow">How it works</p>
        <div className="mt-8 grid gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-3">
          {steps(name).map((s) => (
            <div key={s.n} className="bg-ink-2 p-7">
              <p className="font-mono text-sm text-ember">{s.n}</p>
              <h3 className="display mt-4 text-3xl">{s.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-muted">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-y border-line/70 bg-ink-2/50">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="eyebrow">Engines</p>
              <h2 className="display mt-4 text-5xl">The library</h2>
            </div>
            <p className="max-w-md text-sm text-muted">
              Your AI picks the right engine from your brief. New engines are added to every subscription automatically.
            </p>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-2">
            {engines.map((e) => (
              <article key={e.id} className="card">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="display text-3xl">{e.name}</h3>
                  <span className="font-mono text-xs text-faint">v{e.version}</span>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-muted">{e.description}</p>
                {e.tags.length > 0 && (
                  <div className="mt-5 flex flex-wrap gap-1.5">
                    {e.tags.map((t) => (
                      <span key={t} className="pill border-line text-muted">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </article>
            ))}
            <article className="card flex flex-col justify-center border-dashed bg-transparent">
              <h3 className="display text-3xl text-muted">More engines in production</h3>
              <p className="mt-3 text-sm text-faint">Included with your subscription as they ship.</p>
            </article>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.4fr]">
          <div>
            <p className="eyebrow">Questions</p>
            <h2 className="display mt-4 text-5xl">Good to know</h2>
            <Link href="/pricing" className="btn-primary mt-8">
              See pricing
            </Link>
          </div>
          <dl className="divide-y divide-line border-y border-line">
            {faqs(name).map((f) => (
              <div key={f.q} className="py-6">
                <dt className="text-lg">{f.q}</dt>
                <dd className="mt-2 text-sm leading-relaxed text-muted">{f.a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </>
  );
}
