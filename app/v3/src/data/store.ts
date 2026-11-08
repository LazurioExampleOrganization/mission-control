import type { DraftPanelInput } from "@lazurio/repository-db";
import type { MissionControlConfig } from "../domain/config.ts";
import type { Plan } from "../domain/plan.ts";
import type { Roadmap } from "../domain/roadmap.ts";
import type { RuleIssue } from "../domain/rules.ts";
import type { Locale } from "../i18n/locale.ts";

/**
 * The storage port of Mission Control: everything the server needs from the
 * data, named by the domain and never by files or Git.
 *
 * Generation v3 implements it over repository-db (`repository-db-store.ts`).
 * Generation v4 implements the same port over Dolt; the server, the UI and
 * the shared test suite (`tests/store-contract.ts`) stay as they are. No path
 * of a YAML file and no Git term crosses this boundary: a record is addressed
 * by its code, and a change is confirmed by an opaque revision.
 */

/** An opaque version of one stored record; a save names the one it was edited from. */
export type Revision = string;

export interface Stored<T> {
  value: T;
  revision: Revision;
}

/**
 * Draft & Publish is the contract of the UI: an edit is a draft, a person
 * reviews it and publishes it as one change. The card input is the shared
 * view model of `@lazurio/repository-db`, which a v4 store produces as well.
 */
export type DraftCard = DraftPanelInput;

export type DiscardScope = { kind: "draft" } | { kind: "record"; path: string };

export type StoreEvent =
  /** Records changed outside this process (a colleague's publish came in, a discard). */
  | { type: "records-changed" }
  /** The draft or the sync state changed; reload the card. */
  | { type: "draft-changed" };

export interface MissionControlStore {
  /** False while the data cannot be read (not mounted yet, wrong repository). */
  available(): Promise<{ ok: true } | { ok: false; code: string; message: string }>;
  config(): Promise<MissionControlConfig>;

  /** Every plan, in working order (rank, then code). */
  listPlans(): Promise<Stored<Plan>[]>;
  getPlan(code: string): Promise<Stored<Plan> | null>;
  /**
   * Save a plan as a draft. `baseRevision` is the revision the editor opened,
   * `null` for a new plan. A stale revision is refused with `record_changed`.
   */
  savePlan(value: Plan, baseRevision: Revision | null): Promise<Stored<Plan>>;

  listRoadmaps(): Promise<Stored<Roadmap>[]>;
  getRoadmap(code: string): Promise<Stored<Roadmap> | null>;
  saveRoadmap(value: Roadmap, baseRevision: Revision | null): Promise<Stored<Roadmap>>;

  /**
   * Every problem of the data as it stands (draft included): records that do
   * not match their schema and broken rules across records. Empty when valid.
   */
  check(): Promise<RuleIssue[]>;

  /**
   * The Draft & Publish card: state, the changed records and the draft
   * revision. Record labels and changed fields are worded in `locale`.
   */
  draft(locale?: Locale): Promise<DraftCard>;
  /** Publish the whole draft as shown; a changed draft is refused with `draft_changed`. */
  publish(input: { expectedRevision: string; actor?: string; summary?: string }): Promise<void>;
  /** Finish sending a publish that was saved but not sent. */
  finishSend(expectedHead: string): Promise<void>;
  discard(scope: DiscardScope, expectedRevision: string): Promise<void>;
  /** Take colleagues' published work. */
  pull(): Promise<void>;

  subscribe(listener: (event: StoreEvent) => void): () => void;
  close(): void;
}

/**
 * A refusal with a locale-neutral `code` (repository-db's error codes and the
 * App's own); the UI words it. `issues` name what in a record was refused.
 */
export class StoreError extends Error {
  readonly code: string;
  readonly issues: readonly RuleIssue[];

  constructor(code: string, message: string, issues: RuleIssue[] = []) {
    super(message);
    this.name = "StoreError";
    this.code = code;
    this.issues = issues;
  }
}
