import type { DraftPanelInput } from "@lazurio/repository-db";
import type { MissionControlConfig } from "../domain/config.ts";
import type { Plan } from "../domain/plan.ts";
import type { Roadmap } from "../domain/roadmap.ts";
import type { RuleIssue } from "../domain/rules.ts";
import type { Locale } from "../i18n/locale.ts";

/** What the server stores, as the browser receives it. */
export interface Stored<T> {
  value: T;
  revision: string;
}

/**
 * A refusal of the API: a stable `code` the UI words in the person's
 * language (`errorText`), the issues of a refused record, and the server's
 * English message for the technical detail.
 */
export class ApiError extends Error {
  readonly code: string;
  readonly issues: RuleIssue[];

  constructor(code: string, message: string, issues: RuleIssue[] = []) {
    super(message);
    this.code = code;
    this.issues = issues;
  }
}

async function request<T>(path: string, init?: { method: string; body: unknown }): Promise<T> {
  let response: Response;
  try {
    response = await fetch(
      path,
      init
        ? {
            method: init.method,
            headers: { "content-type": "application/json" },
            body: JSON.stringify(init.body),
          }
        : { headers: { accept: "application/json" } },
    );
  } catch (error) {
    throw new ApiError("unreachable", error instanceof Error ? error.message : String(error));
  }
  const data = (await response.json().catch(() => null)) as
    | (T & { code?: string; message?: string; issues?: RuleIssue[] })
    | null;
  if (!response.ok) {
    throw new ApiError(
      data?.code ?? "unexpected",
      data?.message ?? response.statusText,
      Array.isArray(data?.issues) ? data.issues : [],
    );
  }
  return data as T;
}

export interface NewPlanInput {
  title: string;
  owner: string;
  priority: Plan["priority"];
  status: Plan["status"];
  context: string;
  current_problem: string;
  target_state: string;
  acceptance_criteria: string[];
  validation: string[];
}

export const api = {
  config: () => request<MissionControlConfig>("/api/config"),
  plans: () => request<Stored<Plan>[]>("/api/plans"),
  plan: (code: string) => request<Stored<Plan>>(`/api/plans/${encodeURIComponent(code)}`),
  createPlan: (input: NewPlanInput) =>
    request<Stored<Plan>>("/api/plans", { method: "POST", body: input }),
  savePlan: (value: Plan, baseRevision: string) =>
    request<Stored<Plan>>(`/api/plans/${encodeURIComponent(value.dev_code)}`, {
      method: "PUT",
      body: { record: value, baseRevision },
    }),
  roadmaps: () => request<Stored<Roadmap>[]>("/api/roadmaps"),
  check: () => request<RuleIssue[]>("/api/check"),
  draft: (locale: Locale) => request<DraftPanelInput>(`/api/draft?locale=${locale}`),
  publish: (expectedRevision: string) =>
    request<{ ok: true }>("/api/draft/publish", { method: "POST", body: { expectedRevision } }),
  finishSend: (expectedHead: string) =>
    request<{ ok: true }>("/api/draft/finish-send", { method: "POST", body: { expectedHead } }),
  discard: (
    scope: { kind: "draft" } | { kind: "record"; path: string },
    expectedRevision: string,
  ) =>
    request<{ ok: true }>("/api/draft/discard", {
      method: "POST",
      body: { scope, expectedRevision },
    }),
  pull: () => request<{ ok: true }>("/api/draft/pull", { method: "POST", body: {} }),
};

/** Server events: records came in or the draft moved. Returns the unsubscribe function. */
export function subscribe(onChange: (type: "records-changed" | "draft-changed") => void) {
  if (typeof EventSource === "undefined") return () => {};
  const source = new EventSource("/api/events");
  const records = () => onChange("records-changed");
  const draft = () => onChange("draft-changed");
  source.addEventListener("records-changed", records);
  source.addEventListener("draft-changed", draft);
  return () => source.close();
}
