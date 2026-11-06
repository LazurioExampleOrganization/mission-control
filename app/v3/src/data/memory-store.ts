import { createHash } from "node:crypto";
import { structuralDiff } from "@lazurio/repository-db";
import type { MissionControlConfig } from "../domain/config.ts";
import { comparePlans, type Plan } from "../domain/plan.ts";
import type { Roadmap } from "../domain/roadmap.ts";
import { checkRules } from "../domain/rules.ts";
import { assertRulesFor, parsePlan, parseRoadmap, recordFileName } from "./records.ts";
import { labelFields } from "./review-adapter.ts";
import type {
  DiscardScope,
  DraftCard,
  MissionControlStore,
  Revision,
  Stored,
  StoreEvent,
} from "./store.ts";
import { StoreError } from "./store.ts";

/**
 * Mission Control's storage in memory: the same port and the same Draft &
 * Publish behaviour as the repository-db store, without Git. Tests of the
 * server and the UI use it; it also proves that `tests/store-contract.ts`
 * describes the port and not one engine.
 */
export interface MemoryStoreSeed {
  config: MissionControlConfig;
  plans?: Plan[];
  roadmaps?: Roadmap[];
}

type Key = `plan:${string}` | `roadmap:${string}`;
type Value = Plan | Roadmap;

function revisionOf(value: Value): Revision {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

export function createMemoryStore(seed: MemoryStoreSeed): MissionControlStore {
  const published = new Map<Key, Value>();
  for (const value of seed.plans ?? []) published.set(`plan:${value.dev_code}`, value);
  for (const value of seed.roadmaps ?? []) published.set(`roadmap:${value.roadmap_code}`, value);
  const draft = new Map<Key, Value>(published);
  const listeners = new Set<(event: StoreEvent) => void>();
  const emit = (event: StoreEvent) => {
    for (const listener of listeners) listener(event);
  };

  const changedKeys = () =>
    [...new Set<Key>([...published.keys(), ...draft.keys()])]
      .filter((key) => published.get(key) !== draft.get(key))
      .sort();
  const draftRevision = () =>
    `memory:${createHash("sha256")
      .update(JSON.stringify(changedKeys().map((key) => [key, draft.get(key) ?? null])))
      .digest("hex")}`;
  const plans = () =>
    [...draft.entries()]
      .filter(([key]) => key.startsWith("plan:"))
      .map(([, value]) => value as Plan)
      .sort(comparePlans);
  const roadmaps = () =>
    [...draft.entries()]
      .filter(([key]) => key.startsWith("roadmap:"))
      .map(([, value]) => value as Roadmap)
      .sort((left, right) => left.roadmap_code.localeCompare(right.roadmap_code));
  const ruleInput = () => ({
    config: seed.config,
    plans: plans().map((value) => ({
      value,
      fileName: recordFileName(value.dev_code, value.title),
    })),
    roadmaps: roadmaps().map((value) => ({
      value,
      fileName: recordFileName(value.roadmap_code, value.title),
    })),
  });

  function save<T extends Value>(key: Key, code: string, value: T, base: Revision | null) {
    const current = draft.get(key);
    if (base === null && current) throw new StoreError("record_changed", `${code} already exists.`);
    if (base !== null && !current) {
      throw new StoreError("record_changed", `${code} no longer exists.`);
    }
    if (current && base !== revisionOf(current)) {
      throw new StoreError(
        "record_changed",
        `${code} was saved by someone else since it was read.`,
      );
    }
    const previous = draft.get(key);
    draft.set(key, value);
    try {
      assertRulesFor(code, ruleInput());
    } catch (error) {
      if (previous) draft.set(key, previous);
      else draft.delete(key);
      throw error;
    }
    emit({ type: "draft-changed" });
    return { value, revision: revisionOf(value) } satisfies Stored<T>;
  }

  function assertRevision(expected: string) {
    if (expected !== draftRevision()) {
      throw new StoreError("draft_changed", "The draft changed since it was shown.");
    }
  }

  const stored = <T extends Value>(value: T): Stored<T> => ({ value, revision: revisionOf(value) });

  return {
    available: async () => ({ ok: true }),
    config: async () => seed.config,
    listPlans: async () => plans().map(stored),
    getPlan: async (code) => {
      const value = draft.get(`plan:${code}`) as Plan | undefined;
      return value ? stored(value) : null;
    },
    savePlan: async (value, base) =>
      save(`plan:${value.dev_code}`, value.dev_code, parsePlan(value, value.dev_code), base),
    listRoadmaps: async () => roadmaps().map(stored),
    getRoadmap: async (code) => {
      const value = draft.get(`roadmap:${code}`) as Roadmap | undefined;
      return value ? stored(value) : null;
    },
    saveRoadmap: async (value, base) =>
      save(
        `roadmap:${value.roadmap_code}`,
        value.roadmap_code,
        parseRoadmap(value, value.roadmap_code),
        base,
      ),
    check: async () => checkRules(ruleInput()),
    async draft(): Promise<DraftCard> {
      const keys = changedKeys();
      return {
        status: {
          state: keys.length > 0 ? "draft" : "published",
          branch: "memory",
          ahead: 0,
          behind: 0,
          dirtyPaths: keys,
          head: null,
          conflict: false,
          fetched: false,
        },
        revision: draftRevision(),
        records: keys.map((key) => {
          const [type, code] = key.split(":") as [string, string];
          const value = draft.get(key) ?? published.get(key);
          const kind = !published.has(key) ? "created" : !draft.has(key) ? "deleted" : "modified";
          const fields = labelFields(
            structuralDiff(published.get(key) ?? {}, draft.get(key) ?? {}, {
              maxFields: 12,
            }).fields,
          );
          return {
            technicalPath: key,
            revert: { supported: true },
            resource: {
              appId: "mission-control",
              resourceType: type,
              stableResourceId: `${type}:${code}`,
              label: value ? `${code} · ${value.title}` : code,
              routeTarget: { href: `#/${type}s/${encodeURIComponent(code)}` },
              changes: [
                {
                  changeId: key,
                  kind,
                  summary: kind === "created" ? "Nový záznam" : `Změněno polí: ${fields.length}`,
                  technicalRefs: [{ path: key, kind: "canonical_data_path" }],
                  fields,
                  origin: { kind: "app", source: "mission-control-v3" },
                },
              ],
              fallback: { activeLevel: "resource_adapter", steps: [] },
              metadata: { typeLabel: type === "plan" ? "Plán" : "Roadmapa" },
            },
          };
        }),
      };
    },
    async publish({ expectedRevision }) {
      assertRevision(expectedRevision);
      published.clear();
      for (const [key, value] of draft) published.set(key, value);
      emit({ type: "draft-changed" });
    },
    async finishSend() {
      throw new StoreError("nothing_to_send", "Nothing waits to be sent.");
    },
    async discard(scope: DiscardScope, expectedRevision) {
      assertRevision(expectedRevision);
      const keys = scope.kind === "draft" ? changedKeys() : [scope.path as Key];
      for (const key of keys) {
        const value = published.get(key);
        if (value) draft.set(key, value);
        else draft.delete(key);
      }
      emit({ type: "records-changed" });
      emit({ type: "draft-changed" });
    },
    async pull() {},
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      listeners.clear();
    },
  };
}
