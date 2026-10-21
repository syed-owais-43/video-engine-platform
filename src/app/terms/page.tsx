import type { Metadata } from "next";
import { listPublishedEngines, readEngineFile } from "@/lib/engines";

export const metadata: Metadata = { title: "Terms & licence" };

export default async function TermsPage() {
  const engines = await listPublishedEngines();
  const licences = await Promise.all(
    engines.map(async (e) => ({
      engine: e,
      text: e.currentVersionId ? (await readEngineFile(e.currentVersionId, "LICENSE.md"))?.toString("utf8") : undefined,
    })),
  );

  return (
    <div className="mx-auto max-w-3xl px-4 py-20 sm:px-6">
      <p className="eyebrow">Legal</p>
      <h1 className="display mt-4 text-6xl">Terms & licence</h1>
      <div className="mt-8 space-y-4 text-sm leading-relaxed text-muted">
        <p>
          A Framewright subscription gives one person access to the engines listed on this site through their own AI tools while the
          subscription is active. Each engine is also governed by its own licence, reproduced below. You keep the rights to the videos
          you make.
        </p>
        <p>
          Accounts are for one person. Don&apos;t share your login, API keys or engine materials. Engine instructions are delivered live
          to your AI and shouldn&apos;t be saved, published or redistributed.
        </p>
      </div>
      {licences
        .filter((l) => l.text)
        .map((l) => (
          <section key={l.engine.id} className="mt-12">
            <h2 className="display text-3xl">{l.engine.name} licence</h2>
            <pre className="code mt-4 max-h-[32rem] overflow-y-auto whitespace-pre-wrap">{l.text}</pre>
          </section>
        ))}
    </div>
  );
}
