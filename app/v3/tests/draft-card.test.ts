import { describe, expect, test } from "bun:test";
import {
  type DraftPanelInput,
  type DraftPanelRecordInput,
  deriveDraftPanel,
  type SyncState,
} from "@lazurio/repository-db";
import { createMemoryStore } from "../src/data/memory-store.ts";
import { MESSAGES } from "../src/i18n/messages.ts";
import { MISSION_CONTROL_CAPABILITIES, wordDraftCard } from "../src/ui/draft-wording.ts";
import { sampleData } from "./support/seed.ts";

const CZECH = /[ěščřžýáíéůúňťďĚŠČŘŽÝÁÍÉŮÚŇŤĎ]/;

function record(code: string, revert = true): DraftPanelRecordInput {
  return {
    technicalPath: `data/mission-control/plans/2026/10/${code}-x.yaml`,
    revert: revert ? { supported: true } : { supported: false, reason: "renamed_record" },
    resource: {
      appId: "mission-control",
      resourceType: "plan",
      stableResourceId: `plan:${code}`,
      label: code,
      changes: [
        {
          changeId: code,
          kind: "modified",
          summary: "x",
          technicalRefs: [],
          fields: [],
          origin: { kind: "app", source: "mission-control-v3" },
        },
      ],
      fallback: { activeLevel: "resource_adapter", steps: [] },
    },
  };
}

function input(
  state: SyncState,
  options: Partial<DraftPanelInput> & {
    ahead?: number;
    behind?: number;
    head?: string | null;
  } = {},
): DraftPanelInput {
  const { ahead = 0, behind = 0, head = null, ...rest } = options;
  return {
    status: {
      state,
      branch: "v3",
      ahead,
      behind,
      dirtyPaths: [],
      head,
      conflict: state === "conflict",
      fetched: false,
    },
    revision: "r",
    ...rest,
  };
}

const conflict = (paths: string[], retryable: boolean) => ({
  schemaVersion: "repository-db.conflict.v1" as const,
  detectedAt: "2026-11-06T00:00:00Z",
  operation: "publish",
  gitState: "rebase",
  message: "publish stopped: remote changes could not be safely integrated",
  handoff: "Resolve in the data checkout.",
  paths,
  retryable,
  ...(retryable ? { pendingHead: "abc" } : {}),
});

/** Every state the card can be in, as the engine reports it. */
const STATES: [string, DraftPanelInput][] = [
  ["published", input("published")],
  ["one draft record", input("draft", { records: [record("EX-0001")] })],
  [
    "three draft records",
    input("draft", { records: ["EX-0001", "EX-0002", "EX-0003"].map((code) => record(code)) }),
  ],
  [
    "a draft over a commit waiting to be sent",
    input("draft", { ahead: 1, head: "abc", records: [record("EX-0001")] }),
  ],
  ["a draft behind newer work", input("draft", { behind: 2, records: [record("EX-0001")] })],
  [
    "a draft whose pull is refused",
    input("draft", {
      behind: 1,
      records: [record("EX-0001")],
      pullBlocked: { paths: ["data/x.yaml"], message: "pull refused" },
    }),
  ],
  ["a record that cannot be returned", input("draft", { records: [record("EX-0001", false)] })],
  [
    "a send waiting, known head",
    input("committed_not_pushed", { ahead: 1, head: "abc", records: [record("EX-0001")] }),
  ],
  [
    "a send waiting, unknown head",
    input("committed_not_pushed", { ahead: 1, records: [record("EX-0001"), record("EX-0002")] }),
  ],
  ["newer data", input("pull_needed", { behind: 1 })],
  [
    "a conflict that can be retried",
    input("conflict", {
      ahead: 1,
      head: "abc",
      records: [record("EX-0001"), record("EX-0002")],
      conflict: conflict(["data/mission-control/plans/2026/10/EX-0001-x.yaml"], true),
    }),
  ],
  [
    "a conflict to resolve by hand",
    input("conflict", { records: [record("EX-0001")], conflict: conflict([], false) }),
  ],
];

describe("the Draft & Publish card", () => {
  for (const [name, state] of STATES) {
    test(`${name}: Czech says what the shared card says`, () => {
      const model = deriveDraftPanel(state, MISSION_CONTROL_CAPABILITIES);
      const card = wordDraftCard(state, MESSAGES.cs);
      expect(card.pill).toBe(model.pill);
      if (model.tone !== "conflict") expect(card.headline).toBe(model.headline);
      if (model.wholeDraftNote) expect(card.notes).toContain(model.wholeDraftNote);
      expect(card.actions.map((action) => [action.kind, action.label, action.enabled])).toEqual(
        model.actions.map((action) => [action.kind, action.label, action.enabled]),
      );
      for (const [index, action] of model.actions.entries()) {
        // A refused pull carries the engine's own sentence; the card words it itself.
        if (action.enabled || (action.kind === "pull" && state.pullBlocked)) continue;
        expect(card.actions[index]?.reason).toBe(action.disabledReason);
      }
      for (const [index, row] of model.records.entries()) {
        expect(card.records[index]?.changeLabel).toBe(row.changeLabel);
        expect(card.records[index]?.originLabel).toBe(row.originLabel);
        if (!row.revertSupported && model.tone !== "draft") {
          expect(card.records[index]?.revertBlockedReason).toBe(row.revertBlockedReason);
        }
      }
    });

    test(`${name}: English has no Czech word`, () => {
      const card = wordDraftCard(state, MESSAGES.en);
      const shown = [
        card.pill,
        card.headline,
        ...card.notes,
        ...card.actions.flatMap((action) => [action.label, action.reason ?? ""]),
        ...card.records.flatMap((row) => [
          row.changeLabel,
          row.originLabel,
          row.revertBlockedReason ?? "",
        ]),
      ];
      expect(shown.filter((text) => CZECH.test(text))).toEqual([]);
    });
  }

  test("an engine's own words are technical detail, never the headline", () => {
    const state = STATES.find(([name]) => name === "a conflict to resolve by hand")?.[1];
    if (!state) throw new Error("no conflict state");
    const card = wordDraftCard(state, MESSAGES.en);
    expect(card.headline).toBe(MESSAGES.en.draft.headline.conflict);
    expect(card.technical.join("\n")).toContain("publish stopped");
  });

  test("the changed records come worded from the store in the page's language", async () => {
    const sample = sampleData("en");
    const store = createMemoryStore(sample);
    const plan = await store.getPlan("EX-0002");
    if (!plan) throw new Error("EX-0002 missing");
    await store.savePlan(
      {
        ...plan.value,
        priority_rank: 21,
        status: "review",
        updated_at: "2026-11-06",
        scope: { ...plan.value.scope, out: [] },
      },
      plan.revision,
    );
    const rows = async (locale: "cs" | "en") =>
      (await store.draft(locale)).records?.[0]?.resource.changes[0]?.fields.map((field) => [
        field.label,
        field.beforeSummary,
        field.afterSummary,
      ]);
    const english = (await store.draft("en")).records?.[0]?.resource;
    expect(english?.metadata?.typeLabel).toBe("Plan");
    expect(english?.changes[0]?.summary).toBe("Fields changed: 4");
    // States and priorities by their names, dates in the page's language.
    expect(await rows("en")).toEqual([
      ["Rank", "20", "21"],
      ["Scope: out", "1 item", "0 items"],
      ["State", "In progress", "In review"],
      ["Updated", "28 Oct 2026", "6 Nov 2026"],
    ]);
    expect((await store.draft("cs")).records?.[0]?.resource.metadata?.typeLabel).toBe("Plán");
    expect(await rows("cs")).toEqual([
      ["Pořadí", "20", "21"],
      ["Rozsah: nepatří do něj", "1 položka", "0 položek"],
      ["Stav", "Rozpracováno", "Kontrola"],
      ["Upraveno", "28. 10. 2026", "6. 11. 2026"],
    ]);
  });
});
