import type { DraftPanelInput } from "@lazurio/repository-db";
import type { MissionControlConfig } from "../domain/config.ts";
import type { Plan } from "../domain/plan.ts";
import type { Roadmap } from "../domain/roadmap.ts";
import type { RuleIssue } from "../domain/rules.ts";

/** What the server stores, as the browser receives it. */
export interface Stored<T> {
  value: T;
  revision: string;
}

/** A refusal of the API, with the code the engine documents. */
export class ApiError extends Error {
  readonly code: string;
  readonly issues: { path: string; message: string }[];

  constructor(code: string, message: string, issues: { path: string; message: string }[] = []) {
    super(message);
    this.code = code;
    this.issues = issues;
  }
}

/** Czech wording of the refusals a person can meet. */
const MESSAGES: Record<string, string> = {
  record_changed: "Záznam mezitím uložil někdo jiný. Načtěte ho znovu; váš text zůstává v editoru.",
  draft_changed: "Koncept se od zobrazení změnil. Podívejte se na něj znovu a potvrďte.",
  draft_write_blocked: "Právě probíhá publikování. Zkuste to za chvíli znovu.",
  conflict_active: "Publikování zastavil konflikt; změny zůstávají vidět v konceptu.",
  publish_conflict:
    "Novější práci kolegy nešlo bezpečně spojit s vaší. Postup ukazuje karta konceptu.",
  pull_blocked_by_draft:
    "Kolega změnil stejný záznam, který upravujete. Vraťte ho, stáhněte a upravte znovu.",
  publish_push_failed: "Uloženo, ale server nebyl dostupný. Dokončete odeslání.",
  send_pending: "Publikování čeká na odeslání; nejdřív ho dokončete.",
  identity_missing:
    "Toto Prostředí nemá jméno a e-mail pro Git; přihlaste se ke GitHubu v Lazuriu.",
  credentials: "Toto Prostředí se k datovému repozitáři nedostane; přihlaste se.",
  validation_failed: "Data porušují pravidlo datového repozitáře. Nic se nepublikovalo.",
  mount_unavailable: "Data zatím nejsou k dispozici.",
  config_missing: "Datový repozitář zatím nemá nastavení Mission Control.",
  origin_refused: "Změnu lze poslat jen z Mission Control.",
};

async function request<T>(path: string, init?: { method: string; body: unknown }): Promise<T> {
  const response = await fetch(
    path,
    init
      ? {
          method: init.method,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(init.body),
        }
      : { headers: { accept: "application/json" } },
  );
  const data = (await response.json().catch(() => null)) as
    | (T & { code?: string; message?: string; issues?: { path: string; message: string }[] })
    | null;
  if (!response.ok) {
    const code = data?.code ?? "unexpected";
    throw new ApiError(code, MESSAGES[code] ?? data?.message ?? response.statusText, data?.issues);
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
  draft: () => request<DraftPanelInput>("/api/draft"),
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
