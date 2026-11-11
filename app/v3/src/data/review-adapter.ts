import {
  parseYaml,
  REVIEW_SURFACE_CONTRACT_VERSION,
  type ReviewableResource,
  type ReviewFieldSummary,
  type ReviewInputChange,
  type ReviewSurfaceAdapter,
  structuralDiff,
} from "@lazurio/repository-db";
import { formatDate } from "../i18n/format.ts";
import { DEFAULT_LOCALE, type Locale } from "../i18n/locale.ts";
import { type Messages, messagesFor } from "../i18n/messages.ts";

/**
 * A record with its keys sorted at every depth. The engine writes stable YAML
 * (sorted keys), so the first edit of an older record reorders its keys; a
 * comparison of canonical values sees that this is not a change.
 */
export function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, canonical(record[key])]),
    );
  }
  return value;
}

/** The value an RFC 6901 pointer of `structuralDiff` names. */
function valueAt(document: unknown, pointer: string): unknown {
  if (pointer === "") return document;
  let current = document;
  for (const raw of pointer.slice(1).split("/")) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[raw.replace(/~1/g, "/").replace(/~0/g, "~")];
  }
  return current;
}

/** A changed value as a person reads it: a state or priority by its name, a date in their language. */
function summarize(
  locale: Locale,
  messages: Messages,
  pointer: string,
  value: unknown,
): string | undefined {
  if (value === undefined) return undefined;
  if (value === null) return "—";
  if (Array.isArray(value)) return messages.review.items(value.length);
  if (typeof value === "object") return messages.review.fields(Object.keys(value).length);
  if (typeof value === "boolean") return value ? messages.review.yes : messages.review.no;
  if (typeof value === "string") {
    const named =
      pointer === "/status"
        ? (messages.status as Record<string, string>)[value]
        : pointer === "/priority"
          ? (messages.priority as Record<string, string>)[value]
          : undefined;
    if (named) return named;
    if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return formatDate(locale, value);
  }
  const text = String(value);
  return text.length > 120 ? `${text.slice(0, 119)}…` : text;
}

function fieldLabel(messages: Messages, pointer: string, fallback: string): string {
  const parts = pointer.split("/").slice(1);
  return (
    messages.review.field[parts.slice(0, 2).join("/")] ??
    messages.review.field[parts[0] ?? ""] ??
    fallback
  );
}

/**
 * The fields a reviewer sees as changed: compared by value, never by the
 * order of keys in the file, and named and summarized in `locale`.
 */
export function changedFields(
  before: unknown,
  after: unknown,
  locale: Locale,
  maxFields = 12,
): { fields: ReviewFieldSummary[]; truncated: number } {
  const messages = messagesFor(locale);
  const left = canonical(before ?? {});
  const right = canonical(after ?? {});
  const diff = structuralDiff(left, right, { maxFields });
  return {
    fields: diff.fields.map((field) => ({
      ...field,
      label: fieldLabel(messages, field.fieldPath, field.label),
      beforeSummary: summarize(locale, messages, field.fieldPath, valueAt(left, field.fieldPath)),
      afterSummary: summarize(locale, messages, field.fieldPath, valueAt(right, field.fieldPath)),
    })),
    truncated: diff.truncated,
  };
}

/** The summary line of one changed record. */
export function changeSummary(locale: Locale, kind: string, changed: number): string {
  const { review } = messagesFor(locale);
  if (kind === "created") return review.created;
  if (kind === "deleted") return review.deleted;
  return review.changed(changed);
}

function parsed(text: string | undefined): Record<string, unknown> | undefined {
  if (text === undefined) return undefined;
  try {
    const value = parseYaml(text);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function describe(path: string, record: Record<string, unknown> | undefined, messages: Messages) {
  const planCode = typeof record?.dev_code === "string" ? record.dev_code : null;
  const roadmapCode = typeof record?.roadmap_code === "string" ? record.roadmap_code : null;
  const title = typeof record?.title === "string" ? record.title : null;
  if (path.includes("/plans/") && planCode) {
    return {
      type: "plan",
      typeLabel: messages.review.type.plan,
      id: planCode,
      label: title ? `${planCode} · ${title}` : planCode,
      href: `#/plans/${encodeURIComponent(planCode)}`,
    };
  }
  if (path.includes("/roadmaps/") && roadmapCode) {
    return {
      type: "roadmap",
      typeLabel: messages.review.type.roadmap,
      id: roadmapCode,
      label: title ? `${roadmapCode} · ${title}` : roadmapCode,
      href: `#/roadmaps/${encodeURIComponent(roadmapCode)}`,
    };
  }
  if (path.endsWith("mission-control.config.json")) {
    return {
      type: "config",
      typeLabel: messages.review.type.config,
      id: "config",
      label: messages.review.configLabel,
      href: undefined,
    };
  }
  return null;
}

/**
 * Turns changed data files into the records a person recognises: a plan by
 * its code and title, with the changed fields named in the person's language.
 * A file this adapter does not know falls through to the engine's generic
 * review.
 */
export function reviewAdapter(locale: Locale = DEFAULT_LOCALE): ReviewSurfaceAdapter {
  const messages = messagesFor(locale);
  return {
    id: "mission-control-v3",
    appId: "mission-control",
    contractVersion: REVIEW_SURFACE_CONTRACT_VERSION,
    adapterVersion: "1.1.0",
    supportedPathGlobs: [
      "data/mission-control/plans/**/*.yaml",
      "data/mission-control/roadmaps/**/*.yaml",
      "data/mission-control/mission-control.config.json",
    ],
    toReviewableResources(changes: readonly ReviewInputChange[]): ReviewableResource[] {
      const resources: ReviewableResource[] = [];
      for (const change of changes) {
        const path = change.technicalRefs[0]?.path ?? "";
        const before = path.endsWith(".json") ? undefined : parsed(change.baselineText);
        const after = path.endsWith(".json") ? undefined : parsed(change.draftText);
        const subject = describe(path, after ?? before, messages);
        if (!subject) continue;
        const diff = changedFields(before, after, locale);
        const kind = change.kind === "renamed" ? "modified" : change.kind;
        resources.push({
          appId: "mission-control",
          resourceType: subject.type,
          stableResourceId: `${subject.type}:${subject.id}`,
          label: subject.label,
          ...(subject.href
            ? { routeTarget: { href: subject.href, label: messages.review.open } }
            : {}),
          changes: [
            {
              changeId: change.changeId,
              kind,
              summary: changeSummary(locale, kind, diff.fields.length + diff.truncated),
              technicalRefs: change.technicalRefs,
              fields: diff.fields,
            },
          ],
          fallback: { activeLevel: "resource_adapter", steps: [] },
          metadata: { typeLabel: subject.typeLabel },
        });
      }
      return resources;
    },
  };
}
