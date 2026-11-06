import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { MissionControlStore } from "../src/data/store.ts";
import { newPlan, sampleData } from "./support/seed.ts";

/**
 * The shared test suite of the storage port. Every implementation runs it:
 * the repository-db store of generation v3 and the memory store today, the
 * Dolt store of generation v4 later. An implementation that passes it can
 * replace another without a change to the server or the UI.
 *
 * `setup` returns a store over the fictional example data.
 */
export function storeContract(
  name: string,
  setup: () => Promise<{ store: MissionControlStore; cleanup(): void }>,
) {
  describe(`storage port: ${name}`, () => {
    let store: MissionControlStore;
    let cleanup: () => void;
    const sample = sampleData();

    beforeEach(async () => {
      ({ store, cleanup } = await setup());
    });
    afterEach(() => {
      store.close();
      cleanup();
    });

    const codeOf = (error: unknown) => (error as { code?: string }).code;
    const refusal = async (operation: () => Promise<unknown>) => {
      try {
        await operation();
      } catch (error) {
        return codeOf(error);
      }
      throw new Error("expected a refusal");
    };

    test("reads the settings, plans in working order and roadmaps", async () => {
      expect(await store.available()).toEqual({ ok: true });
      expect((await store.config()).plan_prefix).toBe(sample.config.plan_prefix);
      const plans = await store.listPlans();
      expect(plans.map((entry) => entry.value.dev_code)).toEqual([
        "EX-0001",
        "EX-0002",
        "EX-0003",
        "EX-0004",
      ]);
      expect(plans.every((entry) => entry.revision.length > 0)).toBe(true);
      expect((await store.listRoadmaps()).map((entry) => entry.value.roadmap_code)).toEqual([
        "RM-0001",
      ]);
      expect((await store.getPlan("EX-0002"))?.value.title).toBe("Weekly research digest pilot");
      expect(await store.getPlan("EX-9999")).toBeNull();
      expect(await store.check()).toEqual([]);
    });

    test("a published state has no draft", async () => {
      const card = await store.draft();
      expect(card.status?.state).toBe("published");
      expect(card.records ?? []).toEqual([]);
    });

    test("a new plan becomes a draft with one record", async () => {
      const created = await store.savePlan(newPlan(), null);
      expect(created.value.dev_code).toBe("EX-0005");
      expect((await store.getPlan("EX-0005"))?.revision).toBe(created.revision);
      const card = await store.draft();
      expect(card.status?.state).toBe("draft");
      expect(card.records?.map((record) => record.resource.label)).toEqual([
        "EX-0005 · Shared glossary review",
      ]);
      expect(card.revision).toBeString();
    });

    test("a save names the version it was edited from", async () => {
      const opened = await store.getPlan("EX-0003");
      if (!opened) throw new Error("EX-0003 missing");
      const saved = await store.savePlan(
        { ...opened.value, status: "in_progress" },
        opened.revision,
      );
      expect(saved.revision).not.toBe(opened.revision);
      // A second editor that opened the old version is refused, not overwritten.
      expect(
        await refusal(() =>
          store.savePlan({ ...opened.value, owner: "samtaylor" }, opened.revision),
        ),
      ).toBe("record_changed");
      expect((await store.getPlan("EX-0003"))?.value.status).toBe("in_progress");
      // A new record under an existing code is refused.
      expect(await refusal(() => store.savePlan(newPlan("EX-0001"), null))).toBe("record_changed");
    });

    test("refuses a record that breaks its schema or a rule across records", async () => {
      expect(await refusal(() => store.savePlan({ ...newPlan(), title: "" }, null))).toBe(
        "invalid_record",
      );
      expect(
        await refusal(() => store.savePlan({ ...newPlan(), id: "mcplan-ex-0099" }, null)),
      ).toBe("invalid_record");
      const roadmap = await store.getRoadmap("RM-0001");
      if (!roadmap) throw new Error("RM-0001 missing");
      const [first, ...rest] = roadmap.value.steps;
      if (!first) throw new Error("RM-0001 has no step");
      expect(
        await refusal(() =>
          store.saveRoadmap(
            { ...roadmap.value, steps: [{ ...first, plan_refs: ["EX-0404"] }, ...rest] },
            roadmap.revision,
          ),
        ),
      ).toBe("invalid_record");
      expect((await store.draft()).records ?? []).toEqual([]);
    });

    test("publishes exactly the draft that was shown", async () => {
      await store.savePlan(newPlan(), null);
      const shown = await store.draft();
      await store.savePlan(newPlan("EX-0006", "Second idea"), null);
      expect(await refusal(() => store.publish({ expectedRevision: shown.revision ?? "" }))).toBe(
        "draft_changed",
      );
      const current = await store.draft();
      await store.publish({ expectedRevision: current.revision ?? "", summary: "Two new plans" });
      const after = await store.draft();
      expect(after.status?.state).toBe("published");
      expect(after.records ?? []).toEqual([]);
      expect((await store.listPlans()).map((entry) => entry.value.dev_code)).toContain("EX-0006");
    });

    test("returns one record or the whole draft to the published state", async () => {
      const opened = await store.getPlan("EX-0004");
      if (!opened) throw new Error("EX-0004 missing");
      await store.savePlan({ ...opened.value, title: "Changed title" }, opened.revision);
      await store.savePlan(newPlan(), null);
      const card = await store.draft();
      const changed = card.records?.find((record) => record.resource.label.startsWith("EX-0004"));
      if (!changed) throw new Error("EX-0004 is not in the draft");
      await store.discard({ kind: "record", path: changed.technicalPath }, card.revision ?? "");
      expect((await store.getPlan("EX-0004"))?.value.title).toBe(opened.value.title);
      expect((await store.draft()).records?.length).toBe(1);

      const rest = await store.draft();
      await store.discard({ kind: "draft" }, rest.revision ?? "");
      expect(await store.getPlan("EX-0005")).toBeNull();
      expect((await store.draft()).records ?? []).toEqual([]);
    });

    test("tells subscribers that the draft moved", async () => {
      const events: string[] = [];
      const stop = store.subscribe((event) => events.push(event.type));
      await store.savePlan(newPlan(), null);
      stop();
      expect(events).toContain("draft-changed");
    });
  });
}
