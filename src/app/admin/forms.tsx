"use client";

import { useActionState } from "react";
import type { CreditPack, Plan } from "@/db/schema";
import { publishPlan, resetPassword, savePack, savePlan, uploadEngine, type FormState, type ResetState } from "./actions";

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

export function PlanForm({ plan, models }: { plan?: Plan; models: { key: string; label: string }[] }) {
  const [state, action, pending] = useActionState<FormState, FormData>(savePlan, undefined);
  return (
    <form action={action} className="grid gap-4 md:grid-cols-2">
      {plan && <input type="hidden" name="id" value={plan.id} />}
      <div>
        <label className="label">Name</label>
        <input name="name" required defaultValue={plan?.name} className="input" placeholder="Creator" />
      </div>
      <div className="grid grid-cols-[1fr_6rem] gap-3">
        <div>
          <label className="label">Price per month</label>
          <input name="price" required defaultValue={plan ? (plan.priceCents / 100).toFixed(2) : ""} className="input" placeholder="5.99" />
        </div>
        <div>
          <label className="label">Currency</label>
          <input name="currency" required defaultValue={plan?.currency ?? "usd"} className="input uppercase" maxLength={3} />
        </div>
      </div>
      <div className="md:col-span-2">
        <label className="label">Description</label>
        <input name="description" defaultValue={plan?.description} className="input" />
      </div>
      <div className="grid grid-cols-3 gap-3 md:col-span-2">
        <div>
          <label className="label">Image credits / month</label>
          <input name="monthlyCredits" type="number" min={0} defaultValue={plan?.monthlyCredits ?? 0} className="input" />
        </div>
        <div>
          <label className="label">Videos / month</label>
          <input name="monthlyProjects" defaultValue={plan?.monthlyProjects ?? ""} className="input" placeholder="blank = unlimited" />
        </div>
        <div>
          <label className="label">Sort</label>
          <input name="sort" type="number" defaultValue={plan?.sort ?? 0} className="input" />
        </div>
      </div>
      <div>
        <p className="label">Image models allowed</p>
        <div className="flex flex-wrap gap-3">
          {models.map((m) => (
            <label key={m.key} className="flex items-center gap-2 text-sm text-muted">
              <input type="checkbox" name="imageModels" value={m.key} defaultChecked={plan?.imageModels.includes(m.key)} className="accent-[var(--color-ember)]" /> {m.label}
            </label>
          ))}
        </div>
      </div>
      <div>
        <p className="label">Usage rights</p>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" name="commercialUse" defaultChecked={plan?.commercialUse ?? true} className="accent-[var(--color-ember)]" /> Commercial use allowed (unticked = personal use only)
        </label>
      </div>
      <div className="md:col-span-2">
        <label className="label">Extra features to list (one per line)</label>
        <textarea name="features" rows={2} defaultValue={plan?.features.join("\n")} className="input" />
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

export function PublishPlanButton({ id, published }: { id: string; published: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(publishPlan, undefined);
  return (
    <form action={action} className="flex items-center gap-3">
      <input type="hidden" name="id" value={id} />
      <Status state={state} />
      <button className="btn-ghost !py-1.5 !text-xs" disabled={pending}>
        {pending ? "Publishing…" : published ? "Re-sync with Stripe" : "Publish to Stripe"}
      </button>
    </form>
  );
}

export function PackForm({ pack }: { pack?: CreditPack }) {
  const [state, action, pending] = useActionState<FormState, FormData>(savePack, undefined);
  return (
    <form action={action} className="grid items-end gap-3 md:grid-cols-[1fr_8rem_7rem_5rem_4rem_auto]">
      {pack && <input type="hidden" name="id" value={pack.id} />}
      <div>
        <label className="label">Pack name</label>
        <input name="name" required defaultValue={pack?.name} className="input" placeholder="500 credits" />
      </div>
      <div>
        <label className="label">Credits</label>
        <input name="credits" type="number" min={1} required defaultValue={pack?.credits} className="input" />
      </div>
      <div>
        <label className="label">Price</label>
        <input name="price" required defaultValue={pack ? (pack.priceCents / 100).toFixed(2) : ""} className="input" placeholder="4.99" />
      </div>
      <div>
        <label className="label">Currency</label>
        <input name="currency" required defaultValue={pack?.currency ?? "usd"} className="input uppercase" maxLength={3} />
      </div>
      <div>
        <label className="label">Sort</label>
        <input name="sort" type="number" defaultValue={pack?.sort ?? 0} className="input" />
      </div>
      <div className="flex items-center gap-3 pb-2">
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" name="active" defaultChecked={pack?.active ?? true} className="accent-[var(--color-ember)]" /> On sale
        </label>
        <button className="btn-primary !py-2" disabled={pending}>{pending ? "…" : pack ? "Save" : "Add"}</button>
      </div>
      <div className="md:col-span-6">
        <Status state={state} />
      </div>
    </form>
  );
}

export function ResetPasswordButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState<ResetState, FormData>(resetPassword, undefined);
  if (state?.password)
    return (
      <span className="text-xs text-ok" title="Shown once. Send it to the user; they can sign in with it right away.">
        Temp password: <code className="font-mono text-paper select-all">{state.password}</code>
      </span>
    );
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm("Replace this user's password with a temporary one and sign them out everywhere?")) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button className="pill border-line text-faint hover:text-paper" disabled={pending}>
        {pending ? "…" : "Reset password"}
      </button>
    </form>
  );
}
