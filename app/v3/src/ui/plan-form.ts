import type { Plan } from "../domain/plan.ts";

/**
 * The list fields of the plan form. Their text is kept exactly as typed while
 * the person edits, spaces and empty lines included, and becomes items only
 * when the form is saved: parsing on every keystroke would eat the space
 * before the next word and the new line before the next item.
 */
export const LIST_FIELDS = [
  "scope_in",
  "scope_out",
  "acceptance_criteria",
  "validation",
  "open_questions",
  "risk_notes",
] as const;
export type ListField = (typeof LIST_FIELDS)[number];
export type PlanLists = Record<ListField, string>;

/** One item per line. */
export const toLines = (items: readonly string[] | undefined) => (items ?? []).join("\n");

/** The items of a list field's text: trimmed, empty lines dropped. */
export const fromLines = (value: string) =>
  value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

export function listsOf(plan: Plan): PlanLists {
  return {
    scope_in: toLines(plan.scope.in),
    scope_out: toLines(plan.scope.out),
    acceptance_criteria: toLines(plan.acceptance_criteria),
    validation: toLines(plan.validation),
    open_questions: toLines(plan.open_questions),
    risk_notes: toLines(plan.risk_notes),
  };
}

/** The plan as it is saved: the edited fields with the list texts read into items. */
export function planFromForm(plan: Plan, lists: PlanLists): Plan {
  const next: Plan = {
    ...plan,
    scope: { in: fromLines(lists.scope_in), out: fromLines(lists.scope_out) },
    acceptance_criteria: fromLines(lists.acceptance_criteria),
    validation: fromLines(lists.validation),
  };
  for (const key of ["open_questions", "risk_notes"] as const) {
    const items = fromLines(lists[key]);
    if (items.length > 0) next[key] = items;
    else delete next[key];
  }
  return next;
}
