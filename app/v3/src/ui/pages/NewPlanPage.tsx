import { type FormEvent, useState } from "react";
import { PRIORITIES } from "../../domain/common.ts";
import { ApiError, api, type NewPlanInput } from "../api.ts";
import { ErrorNotice, Field } from "../components/fields.tsx";
import { useI18n } from "../i18n.tsx";
import { fromLines } from "../plan-form.ts";
import { href } from "../routes.ts";

const EMPTY: NewPlanInput = {
  title: "",
  owner: "",
  priority: "medium",
  status: "shaping",
  context: "",
  current_problem: "",
  target_state: "",
  acceptance_criteria: [],
  validation: [],
};

/** A new plan gets the next code of the Organization's prefix and starts as a draft. */
export function NewPlanPage({ onChanged }: { onChanged: () => Promise<void> }) {
  const { messages } = useI18n();
  const words = messages.newPlan;
  const [input, setInput] = useState(EMPTY);
  // The list fields stay text as typed; they become items on submit.
  const [criteria, setCriteria] = useState("");
  const [validation, setValidation] = useState("");
  const [error, setError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof NewPlanInput>(key: K, value: NewPlanInput[K]) =>
    setInput({ ...input, [key]: value });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const created = await api.createPlan({
        ...input,
        acceptance_criteria: fromLines(criteria),
        validation: fromLines(validation),
      });
      await onChanged();
      window.location.hash = href({ page: "plan", code: created.value.dev_code });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError("unexpected", String(caught)));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <header className="page-header">
        <h1 className="page-title">{words.title}</h1>
        <p className="page-subtitle">{words.subtitle}</p>
      </header>
      <Field label={messages.edit.titleField}>
        <input
          value={input.title}
          onChange={(event) => set("title", event.target.value)}
          required
        />
      </Field>
      <div className="form-row">
        <Field label={messages.edit.owner}>
          <input
            value={input.owner}
            onChange={(event) => set("owner", event.target.value)}
            required
          />
        </Field>
        <Field label={messages.edit.priority}>
          <select
            value={input.priority}
            onChange={(event) => set("priority", event.target.value as NewPlanInput["priority"])}
          >
            {PRIORITIES.map((value) => (
              <option key={value} value={value}>
                {messages.priority[value]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label={messages.plan.context}>
        <textarea
          rows={3}
          value={input.context}
          onChange={(event) => set("context", event.target.value)}
          required
        />
      </Field>
      <Field label={messages.plan.currentProblem}>
        <textarea
          rows={3}
          value={input.current_problem}
          onChange={(event) => set("current_problem", event.target.value)}
          required
        />
      </Field>
      <Field label={messages.plan.targetState}>
        <textarea
          rows={3}
          value={input.target_state}
          onChange={(event) => set("target_state", event.target.value)}
          required
        />
      </Field>
      <Field label={messages.plan.acceptanceCriteria} hint={messages.edit.onePerLine}>
        <textarea
          rows={3}
          value={criteria}
          onChange={(event) => setCriteria(event.target.value)}
          required
        />
      </Field>
      <Field label={messages.plan.validation} hint={words.validationHint}>
        <textarea
          rows={3}
          value={validation}
          onChange={(event) => setValidation(event.target.value)}
          required
        />
      </Field>
      {error ? <ErrorNotice error={error} /> : null}
      <div className="form-actions">
        <button className="button primary" type="submit" disabled={saving}>
          {saving ? words.creating : words.create}
        </button>
      </div>
    </form>
  );
}
