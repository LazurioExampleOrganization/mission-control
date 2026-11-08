import { type FormEvent, useEffect, useState } from "react";
import { PRIORITIES, STATUSES } from "../../domain/common.ts";
import type { Plan } from "../../domain/plan.ts";
import { ApiError, api } from "../api.ts";
import { ErrorNotice, Field } from "../components/fields.tsx";
import { useI18n } from "../i18n.tsx";
import { type ListField, listsOf, type PlanLists, planFromForm } from "../plan-form.ts";
import { href } from "../routes.ts";

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
  const { messages } = useI18n();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [lists, setLists] = useState<PlanLists | null>(null);
  const [revision, setRevision] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .plan(code)
      .then((stored) => {
        setPlan(stored.value);
        setLists(listsOf(stored.value));
        setRevision(stored.revision);
      })
      .catch((caught: unknown) =>
        setError(caught instanceof ApiError ? caught : new ApiError("unexpected", String(caught))),
      );
  }, [code]);

  if (!plan || !lists || !revision) {
    return error ? <ErrorNotice error={error} /> : <p className="muted">{messages.app.loading}</p>;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!plan || !lists || !revision) return;
    setSaving(true);
    setError(null);
    try {
      await api.savePlan(planFromForm(plan, lists), revision);
      await onChanged();
      window.location.hash = href({ page: "plan", code });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError("unexpected", String(caught)));
    } finally {
      setSaving(false);
    }
  }

  return (
    <PlanEditForm
      code={code}
      plan={plan}
      lists={lists}
      error={error}
      saving={saving}
      onPlan={setPlan}
      onList={(key, value) => setLists({ ...lists, [key]: value })}
      onSubmit={submit}
    />
  );
}

/**
 * The form itself. Every list field shows its text exactly as typed; the
 * text becomes items only on save (`planFromForm`).
 */
export function PlanEditForm({
  code,
  plan,
  lists,
  error,
  saving,
  onPlan,
  onList,
  onSubmit,
}: {
  code: string;
  plan: Plan;
  lists: PlanLists;
  error: ApiError | null;
  saving: boolean;
  onPlan: (plan: Plan) => void;
  onList: (key: ListField, value: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const { messages } = useI18n();
  const words = messages.edit;
  const set = <K extends keyof Plan>(key: K, value: Plan[K]) => onPlan({ ...plan, [key]: value });
  const list = (key: ListField, label: string, rows = 4) => (
    <Field key={key} label={label} hint={words.onePerLine}>
      <textarea
        rows={rows}
        name={key}
        value={lists[key]}
        onChange={(event) => onList(key, event.target.value)}
      />
    </Field>
  );

  return (
    <form className="form" onSubmit={onSubmit}>
      <header className="page-header">
        <p className="eyebrow">
          <a href={href({ page: "plan", code })}>{code}</a> / {words.breadcrumb}
        </p>
        <h1 className="page-title">{words.title}</h1>
        <p className="page-subtitle">{words.subtitle}</p>
      </header>
      <Field label={words.titleField}>
        <input value={plan.title} onChange={(event) => set("title", event.target.value)} required />
      </Field>
      <div className="form-row">
        <Field label={words.status}>
          <select
            value={plan.status}
            onChange={(event) => set("status", event.target.value as Plan["status"])}
          >
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {messages.status[value]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={words.priority}>
          <select
            value={plan.priority}
            onChange={(event) => set("priority", event.target.value as Plan["priority"])}
          >
            {PRIORITIES.map((value) => (
              <option key={value} value={value}>
                {messages.priority[value]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={words.rank}>
          <input
            type="number"
            inputMode="numeric"
            min={1}
            value={plan.priority_rank}
            onChange={(event) => set("priority_rank", Number(event.target.value))}
          />
        </Field>
        <Field label={words.owner}>
          <input
            value={plan.owner}
            onChange={(event) => set("owner", event.target.value)}
            required
          />
        </Field>
      </div>
      <Field label={messages.plan.context}>
        <textarea
          rows={4}
          value={plan.context}
          onChange={(event) => set("context", event.target.value)}
        />
      </Field>
      <Field label={messages.plan.currentProblem}>
        <textarea
          rows={3}
          value={plan.current_problem}
          onChange={(event) => set("current_problem", event.target.value)}
        />
      </Field>
      <Field label={messages.plan.targetState}>
        <textarea
          rows={3}
          value={plan.target_state}
          onChange={(event) => set("target_state", event.target.value)}
        />
      </Field>
      <div className="form-row">
        {list("scope_in", words.scopeIn)}
        {list("scope_out", words.scopeOut)}
      </div>
      {list("acceptance_criteria", messages.plan.acceptanceCriteria)}
      {list("validation", messages.plan.validation)}
      {list("open_questions", messages.plan.openQuestions)}
      {list("risk_notes", messages.plan.risks)}
      {error ? <ErrorNotice error={error} /> : null}
      <div className="form-actions">
        <button className="button primary" type="submit" disabled={saving}>
          {saving ? words.saving : words.save}
        </button>
        <a className="button" href={href({ page: "plan", code })}>
          {words.cancel}
        </a>
      </div>
    </form>
  );
}
