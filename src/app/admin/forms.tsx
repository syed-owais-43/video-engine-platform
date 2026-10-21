"use client";

import { useActionState } from "react";
import type { Plan } from "@/db/schema";
import { savePlan, uploadEngine, type FormState } from "./actions";

function Status({ state }: { state: FormState }) {
  if (state?.error) return <p className="text-sm text-bad">{state.error}</p>;
  if (state?.ok) return <p className="text-sm text-ok">{state.ok}</p>;
  return null;
}

export function UploadEngineForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(uploadEngine, undefined);
  return (
    <form action={action} className="grid gap-4 md:grid-cols-2">
      <div className="md:col-span-2">
        <label className="label" htmlFor="zip">Skill ZIP</label>
        <input id="zip" name="zip" type="file" accept=".zip" required className="input file:mr-3 file:rounded-full file:border-0 file:bg-ink-3 file:px-3 file:py-1 file:text-paper" />
        <p className="mt-1 text-xs text-faint">Standalone skill or plugin ZIP. Must contain a SKILL.md with a <code>name</code> in its frontmatter.</p>
      </div>
      <div>
        <label className="label" htmlFor="version">Version</label>
        <input id="version" name="version" required placeholder="3.6.0" className="input" />
      </div>
      <div>
        <label className="label" htmlFor="slug">Slug override (optional)</label>
        <input id="slug" name="slug" placeholder="from SKILL.md name" className="input" />
      </div>
      <div className="md:col-span-2">
        <label className="label" htmlFor="tags">Tags for new engines (comma separated)</label>
        <input id="tags" name="tags" placeholder="explainer, kinetic typography" className="input" />
      </div>
      <div className="md:col-span-2">
        <label className="label" htmlFor="notes">Release notes</label>
        <textarea id="notes" name="notes" rows={2} className="input" />
      </div>
      <label className="flex items-center gap-2 text-sm text-muted">
        <input type="checkbox" name="publish" className="accent-[var(--color-ember)]" /> Publish engine
      </label>
      <div className="flex items-center justify-end gap-4">
        <Status state={state} />
        <button className="btn-primary" disabled={pending}>{pending ? "Uploading…" : "Upload version"}</button>
      </div>
    </form>
  );
}

export function PlanForm({ plan }: { plan?: Plan }) {
  const [state, action, pending] = useActionState<FormState, FormData>(savePlan, undefined);
  return (
    <form action={action} className="grid gap-4 md:grid-cols-2">
      {plan && <input type="hidden" name="id" value={plan.id} />}
      <div>
        <label className="label">Name</label>
        <input name="name" required defaultValue={plan?.name} className="input" placeholder="Pro" />
      </div>
      <div>
        <label className="label">Price label</label>
        <input name="priceLabel" required defaultValue={plan?.priceLabel} className="input" placeholder="$29 / month" />
      </div>
      <div>
        <label className="label">Stripe price id</label>
        <input name="stripePriceId" required defaultValue={plan?.stripePriceId} className="input font-mono" placeholder="price_..." />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Projects / month</label>
          <input name="monthlyProjects" defaultValue={plan?.monthlyProjects ?? ""} className="input" placeholder="blank = unlimited" />
        </div>
        <div>
          <label className="label">Sort</label>
          <input name="sort" type="number" defaultValue={plan?.sort ?? 0} className="input" />
        </div>
      </div>
      <div className="md:col-span-2">
        <label className="label">Description</label>
        <input name="description" defaultValue={plan?.description} className="input" />
      </div>
      <div className="md:col-span-2">
        <label className="label">Features (one per line)</label>
        <textarea name="features" rows={3} defaultValue={plan?.features.join("\n")} className="input" />
      </div>
      <label className="flex items-center gap-2 text-sm text-muted">
        <input type="checkbox" name="active" defaultChecked={plan?.active ?? true} className="accent-[var(--color-ember)]" /> Shown on pricing page
      </label>
      <div className="flex items-center justify-end gap-4">
        <Status state={state} />
        <button className="btn-primary" disabled={pending}>{pending ? "Saving…" : plan ? "Save plan" : "Create plan"}</button>
      </div>
    </form>
  );
}
