import { type FormEvent, useState } from "react";
import { PRIORITIES } from "../../domain/common.ts";
import { ApiError, api, type NewPlanInput } from "../api.ts";
import { Field, fromLines, Issues } from "../components/fields.tsx";
import { PRIORITY_LABELS } from "../labels.ts";
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
  const [input, setInput] = useState(EMPTY);
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
        <h1 className="page-title">Nový plán</h1>
        <p className="page-subtitle">
          Plán říká, proč se něco dělá, pro koho a podle čeho poznáte, že je hotovo. Uloží se jako
          koncept.
        </p>
      </header>
      <Field label="Název">
        <input
          value={input.title}
          onChange={(event) => set("title", event.target.value)}
          required
        />
      </Field>
      <div className="form-row">
        <Field label="Vlastník">
          <input
            value={input.owner}
            onChange={(event) => set("owner", event.target.value)}
            required
          />
        </Field>
        <Field label="Priorita">
          <select
            value={input.priority}
            onChange={(event) => set("priority", event.target.value as NewPlanInput["priority"])}
          >
            {PRIORITIES.map((value) => (
              <option key={value} value={value}>
                {PRIORITY_LABELS[value]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Kontext">
        <textarea
          rows={3}
          value={input.context}
          onChange={(event) => set("context", event.target.value)}
          required
        />
      </Field>
      <Field label="Současný problém">
        <textarea
          rows={3}
          value={input.current_problem}
          onChange={(event) => set("current_problem", event.target.value)}
          required
        />
      </Field>
      <Field label="Cílový stav">
        <textarea
          rows={3}
          value={input.target_state}
          onChange={(event) => set("target_state", event.target.value)}
          required
        />
      </Field>
      <Field label="Kritéria přijetí" hint="Jedna položka na řádek.">
        <textarea
          rows={3}
          value={criteria}
          onChange={(event) => setCriteria(event.target.value)}
          required
        />
      </Field>
      <Field label="Ověření" hint="Jak se ověří, že plán splnil cíl. Jedna položka na řádek.">
        <textarea
          rows={3}
          value={validation}
          onChange={(event) => setValidation(event.target.value)}
          required
        />
      </Field>
      {error ? (
        <div className="notice notice-danger" role="alert">
          {error.message}
          <Issues issues={error.issues} />
        </div>
      ) : null}
      <div className="form-actions">
        <button className="button primary" type="submit" disabled={saving}>
          {saving ? "Zakládám…" : "Založit plán"}
        </button>
      </div>
    </form>
  );
}
