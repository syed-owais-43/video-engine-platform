import { asc, desc } from "drizzle-orm";
import { db } from "@/db";
import { engineVersions, engines } from "@/db/schema";
import { setCurrentVersion, updateEngine } from "../actions";
import { UploadEngineForm } from "../forms";

export default async function AdminEngines() {
  const [list, versions] = await Promise.all([
    db.select().from(engines).orderBy(asc(engines.name)),
    db.select().from(engineVersions).orderBy(desc(engineVersions.createdAt)),
  ]);

  return (
    <div className="space-y-5">
      <section className="card">
        <p className="label">Upload a new engine or version</p>
        <UploadEngineForm />
      </section>

      {list.map((e) => {
        const vs = versions.filter((v) => v.engineId === e.id);
        return (
          <section key={e.id} className="card">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="display text-3xl">{e.name}</h2>
              <span className={`pill ${e.published ? "border-ok/40 text-ok" : "border-line text-muted"}`}>
                {e.published ? "published" : "hidden"}
              </span>
            </div>
            <p className="font-mono text-xs text-faint">{e.slug}</p>

            <form action={updateEngine} className="mt-6 grid gap-4 md:grid-cols-2">
              <input type="hidden" name="id" value={e.id} />
              <div>
                <label className="label">Display name</label>
                <input name="name" defaultValue={e.name} className="input" />
              </div>
              <div>
                <label className="label">Tags (comma separated — used to auto-select the engine)</label>
                <input name="tags" defaultValue={e.tags.join(", ")} className="input" />
              </div>
              <div className="md:col-span-2">
                <label className="label">Description</label>
                <textarea name="description" rows={2} defaultValue={e.description} className="input" />
              </div>
              <label className="flex items-center gap-2 text-sm text-muted">
                <input type="checkbox" name="published" defaultChecked={e.published} className="accent-[var(--color-ember)]" /> Published
              </label>
              <div className="text-right">
                <button className="btn-ghost">Save details</button>
              </div>
            </form>

            <div className="mt-6 overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Version</th>
                    <th>Files</th>
                    <th>Uploaded</th>
                    <th>Notes</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {vs.map((v) => (
                    <tr key={v.id}>
                      <td className="font-mono">{v.version}</td>
                      <td className="text-muted">{v.fileCount}</td>
                      <td className="text-muted">{v.createdAt.toLocaleDateString("en-GB")}</td>
                      <td className="max-w-xs truncate text-muted">{v.notes}</td>
                      <td className="text-right">
                        {e.currentVersionId === v.id ? (
                          <span className="pill border-ember/50 text-ember">current</span>
                        ) : (
                          <form action={setCurrentVersion}>
                            <input type="hidden" name="engineId" value={e.id} />
                            <input type="hidden" name="versionId" value={v.id} />
                            <button className="text-xs text-muted hover:text-paper hover:underline">Make current</button>
                          </form>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}
