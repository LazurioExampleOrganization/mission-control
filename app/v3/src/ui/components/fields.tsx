import type { ReactNode } from "react";

/** One item per line, for the list fields of a plan. */
export const toLines = (items: readonly string[] | undefined) => (items ?? []).join("\n");
export const fromLines = (value: string) =>
  value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

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

export function Issues({ issues }: { issues: { path: string; message: string }[] }) {
  if (issues.length === 0) return null;
  return (
    <ul className="issues">
      {issues.map((issue) => (
        <li key={`${issue.path}:${issue.message}`}>
          <code>{issue.path}</code> {issue.message}
        </li>
      ))}
    </ul>
  );
}
