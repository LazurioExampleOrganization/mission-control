import { type FormEvent, useEffect, useState } from "react";
import { PRIORITIES, STATUSES } from "../../domain/common.ts";
import type { Plan } from "../../domain/plan.ts";
import { ApiError, api } from "../api.ts";
import { Field, fromLines, Issues, toLines } from "../components/fields.tsx";
import { PRIORITY_LABELS, STATUS_LABELS } from "../labels.ts";
import { href } from "../routes.ts";

const LIST_FIELDS = [
  ["acceptance_criteria", "Kritéria přijetí"],
  ["validation", "Ověření"],
  ["open_questions", "Otevřené otázky"],
  ["risk_notes", "Rizika"],
] as const;

/**
 * Edits one plan as a draft. The revision is taken when the editor opens, so
 * a save over a colleague's newer save is refused instead of overwriting it.
 */
export function PlanEditPage({
  code,
  onChanged,
}: {
  code: string;
  onChanged: () => Promise<void>;
}) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [revision, setRevision] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .plan(code)
      .then((stored) => {
        setPlan(stored.value);
        setRevision(stored.revision);
      })
      .catch((caught: ApiError) => setError(caught));
  }, [code]);

  if (!plan || !revision) {
    return error ? <p className="notice notice-danger">{error.message}</p> : <p>Načítám…</p>;
  }
  const set = <K extends keyof Plan>(key: K, value: Plan[K]) => setPlan({ ...plan, [key]: value });

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!plan || !revision) return;
    setSaving(true);
    setError(null);
    try {
      await api.savePlan(plan, revision);
      await onChanged();
      window.location.hash = href({ page: "plan", code });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError("unexpected", String(caught)));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <header className="page-header">
        <p className="eyebrow">
          <a href={href({ page: "plan", code })}>{code}</a> / Úprava
        </p>
        <h1 className="page-title">Upravit plán</h1>
        <p className="page-subtitle">
          Uložení vytvoří koncept. Ostatní ho uvidí až po publikování.
        </p>
      </header>
      <Field label="Název">
        <input value={plan.title} onChange={(event) => set("title", event.target.value)} required />
      </Field>
      <div className="form-row">
        <Field label="Stav">
          <select
            value={plan.status}
            onChange={(event) => set("status", event.target.value as Plan["status"])}
          >
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Priorita">
          <select
            value={plan.priority}
            onChange={(event) => set("priority", event.target.value as Plan["priority"])}
          >
            {PRIORITIES.map((value) => (
              <option key={value} value={value}>
                {PRIORITY_LABELS[value]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Pořadí">
          <input
            type="number"
            min={1}
            value={plan.priority_rank}
            onChange={(event) => set("priority_rank", Number(event.target.value))}
          />
        </Field>
        <Field label="Vlastník">
          <input
            value={plan.owner}
            onChange={(event) => set("owner", event.target.value)}
            required
          />
        </Field>
      </div>
      <Field label="Kontext">
        <textarea
          rows={4}
          value={plan.context}
          onChange={(event) => set("context", event.target.value)}
        />
      </Field>
      <Field label="Současný problém">
        <textarea
          rows={3}
          value={plan.current_problem}
          onChange={(event) => set("current_problem", event.target.value)}
        />
      </Field>
      <Field label="Cílový stav">
        <textarea
          rows={3}
          value={plan.target_state}
          onChange={(event) => set("target_state", event.target.value)}
        />
      </Field>
      <div className="form-row">
        <Field label="Rozsah: patří do něj" hint="Jedna položka na řádek.">
          <textarea
            rows={4}
            value={toLines(plan.scope.in)}
            onChange={(event) => set("scope", { ...plan.scope, in: fromLines(event.target.value) })}
          />
        </Field>
        <Field label="Rozsah: nepatří do něj" hint="Jedna položka na řádek.">
          <textarea
            rows={4}
            value={toLines(plan.scope.out)}
            onChange={(event) =>
              set("scope", { ...plan.scope, out: fromLines(event.target.value) })
            }
          />
        </Field>
      </div>
      {LIST_FIELDS.map(([key, label]) => (
        <Field key={key} label={label} hint="Jedna položka na řádek.">
          <textarea
            rows={4}
            value={toLines(plan[key])}
            onChange={(event) => {
              const items = fromLines(event.target.value);
              const optional = key === "open_questions" || key === "risk_notes";
              const next = { ...plan, [key]: items } as Plan;
              if (optional && items.length === 0) delete next[key];
              setPlan(next);
            }}
          />
        </Field>
      ))}
      {error ? (
        <div className="notice notice-danger" role="alert">
          {error.message}
          <Issues issues={error.issues} />
        </div>
      ) : null}
      <div className="form-actions">
        <button className="button primary" type="submit" disabled={saving}>
          {saving ? "Ukládám…" : "Uložit do konceptu"}
        </button>
        <a className="button" href={href({ page: "plan", code })}>
          Zrušit
        </a>
      </div>
    </form>
  );
}
