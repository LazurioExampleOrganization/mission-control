import type { ReactNode } from "react";
import type { RuleIssue } from "../../domain/rules.ts";
import { errorText, issueText } from "../../i18n/messages.ts";
import type { ApiError } from "../api.ts";
import { useI18n } from "../i18n.tsx";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is passed as children
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

/** Issues of the data or of a refused record, worded in the page's language. */
export function Issues({ issues }: { issues: readonly RuleIssue[] }) {
  const { messages } = useI18n();
  if (issues.length === 0) return null;
  return (
    <ul className="issues">
      {issues.map((issue) => (
        <li key={`${issue.record}:${issue.code}:${issue.message}`}>
          <code>{issue.record}</code> {issueText(messages, issue)}
        </li>
      ))}
    </ul>
  );
}

/** A refusal of the API: what happened, in the page's language, and what to fix. */
export function ErrorNotice({ error, lead }: { error: ApiError; lead?: string }) {
  const { messages } = useI18n();
  return (
    <div className="notice notice-danger" role="alert">
      {lead ? <strong>{lead} </strong> : null}
      {errorText(messages, error.code)}
      <Issues issues={error.issues} />
    </div>
  );
}
