import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { check, validateRepository } from "../../../templates/data-repo/scripts/validate.ts";
import { renderSchemas } from "../src/cli/schema.ts";
import { plan } from "../src/domain/plan.ts";
import { roadmap } from "../src/domain/roadmap.ts";
import { createFixtureRepo } from "./support/fixture-repo.ts";
import { DATA_REPO_TEMPLATE, newPlan, sampleData } from "./support/seed.ts";

const schema = (file: string) =>
  JSON.parse(readFileSync(join(DATA_REPO_TEMPLATE, "schemas", file), "utf8"));

describe("data repository template", () => {
  test("its JSON Schemas are the ones generated from the Zod schemas", () => {
    for (const { file, text } of renderSchemas()) {
      expect(readFileSync(join(DATA_REPO_TEMPLATE, "schemas", file), "utf8")).toBe(text);
    }
  });

  test("its validator agrees with the Zod schemas on the shape of a record", () => {
    const sample = sampleData();
    const planSchema = schema("plan.schema.json");
    const roadmapSchema = schema("roadmap.schema.json");
    const plans = [
      ...sample.plans,
      newPlan(),
      { ...newPlan(), title: "" },
      { ...newPlan(), extra: 1 },
      { ...newPlan(), priority_rank: 0 },
      { ...newPlan(), status: "someday" },
      { ...newPlan(), scope: { in: [] } },
    ];
    for (const value of plans) {
      expect(check(planSchema, value).length === 0).toBe(plan.safeParse(value).success);
    }
    const [main] = sample.roadmaps;
    if (!main) throw new Error("no example roadmap");
    const roadmaps = [
      main,
      { ...main, roadmap_code: "RM-1" },
      { ...main, steps: [] },
      {
        ...main,
        links: [
          { label: "Board", url: "https://example.com" },
          { label: "Doc", path: "a.md" },
        ],
      },
      { ...main, links: [{ label: "Nothing" }] },
    ];
    for (const value of roadmaps) {
      expect(check(roadmapSchema, value).length === 0).toBe(roadmap.safeParse(value).success);
    }
  });

  test("the validator passes the empty and the example start", () => {
    const empty = createFixtureRepo();
    const example = createFixtureRepo({ sample: true });
    try {
      expect(validateRepository(empty.mountRoot)).toEqual([]);
      expect(validateRepository(example.mountRoot)).toEqual([]);
    } finally {
      empty.cleanup();
      example.cleanup();
    }
  });
});
