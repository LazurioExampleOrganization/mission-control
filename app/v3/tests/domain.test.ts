import { describe, expect, test } from "bun:test";
import { isPortablePath } from "../src/domain/common.ts";
import { hasCredential } from "../src/domain/credentials.ts";
import { nextPlanCode, plan } from "../src/domain/plan.ts";
import { nextSteps, periodEnd, periodStart, progress, roadmap } from "../src/domain/roadmap.ts";
import { checkRules } from "../src/domain/rules.ts";
import { newPlan, sampleData } from "./support/seed.ts";

describe("plan schema", () => {
  test("accepts the example plans and a new plan", () => {
    for (const value of sampleData().plans) expect(plan.safeParse(value).success).toBe(true);
    expect(plan.safeParse(newPlan()).success).toBe(true);
  });

  test("refuses unknown fields, empty text and a wrong code", () => {
    expect(plan.safeParse({ ...newPlan(), surprise: true }).success).toBe(false);
    expect(plan.safeParse({ ...newPlan(), context: "" }).success).toBe(false);
    expect(plan.safeParse({ ...newPlan(), dev_code: "ex-5" }).success).toBe(false);
    expect(plan.safeParse({ ...newPlan(), acceptance_criteria: [] }).success).toBe(false);
  });

  test("the next code follows the highest code of the prefix", () => {
    expect(nextPlanCode("EX", [])).toBe("EX-0001");
    expect(nextPlanCode("EX", ["EX-0001", "EX-0009", "OT-0100"])).toBe("EX-0010");
  });
});

describe("roadmap schema", () => {
  const [main] = sampleData().roadmaps;
  if (!main) throw new Error("no example roadmap");

  test("accepts the example roadmap", () => {
    expect(roadmap.safeParse(main).success).toBe(true);
  });

  test("an executable step names its work and a done step its evidence", () => {
    const [first, ...rest] = main.steps;
    if (!first) throw new Error("no step");
    const { plan_refs: _plans, ...withoutRefs } = first;
    expect(roadmap.safeParse({ ...main, steps: [withoutRefs, ...rest] }).success).toBe(false);
    const { evidence_refs: _evidence, ...withoutEvidence } = first;
    expect(roadmap.safeParse({ ...main, steps: [withoutEvidence, ...rest] }).success).toBe(false);
  });

  test("next steps, progress and period order", () => {
    expect(nextSteps(main).map((step) => step.id)).toEqual(["step-003"]);
    expect(progress(main)).toEqual({ done: 1, total: 4 });
    expect(periodStart("2026-Q3")).toBe("2026-07");
    expect(periodStart("2026-11")).toBe("2026-11");
    expect(periodEnd("2026-Q3")).toBe("2026-09");
  });
});

describe("rules across records", () => {
  const sample = sampleData();
  const input = {
    config: sample.config,
    plans: sample.plans.map((value) => ({ value, fileName: `${value.dev_code}-x.yaml` })),
    roadmaps: sample.roadmaps.map((value) => ({ value, fileName: `${value.roadmap_code}-x.yaml` })),
  };

  test("the example data keeps every rule", () => {
    expect(checkRules(input)).toEqual([]);
  });

  test("names duplicate codes, foreign prefixes and unknown references", () => {
    const first = sample.plans.find((value) => value.dev_code === "EX-0001");
    const [main] = sample.roadmaps;
    if (!first || !main) throw new Error("no sample");
    const issues = checkRules({
      ...input,
      plans: [
        ...input.plans,
        { value: first, fileName: "EX-0001-copy.yaml" },
        { value: { ...newPlan("OT-0001"), id: "mcplan-ot-0001" }, fileName: "OT-0001-x.yaml" },
      ],
      roadmaps: [
        ...input.roadmaps,
        {
          value: {
            ...main,
            roadmap_code: "RM-0002",
            id: "mcroadmap-rm-0002",
            source_plan: "EX-0404",
          },
          fileName: "RM-0002-x.yaml",
        },
      ],
    });
    const messages = issues.map((issue) => `${issue.record}: ${issue.message}`);
    expect(messages).toContain("EX-0001: the plan code is used twice");
    expect(messages).toContain("OT-0001: the code must start with the Organization's prefix EX");
    expect(messages).toContain("RM-0002: the source plan EX-0404 does not exist");
    expect(messages).toContain("roadmaps: more than one roadmap is marked main");
  });

  test("a step's timing starts before it ends, and an archived roadmap is not main", () => {
    const [main] = sample.roadmaps;
    const [first, ...rest] = main?.steps ?? [];
    if (!main || !first) throw new Error("no sample");
    const issues = checkRules({
      ...input,
      roadmaps: [
        {
          value: {
            ...main,
            status: "archived",
            steps: [{ ...first, timing: { from: "2026-Q4", to: "2026-11" } }, ...rest],
          },
          fileName: "RM-0001-x.yaml",
        },
      ],
    });
    expect(issues.map((issue) => issue.message)).toEqual([
      "an archived roadmap cannot be the main roadmap",
      "step-001 starts or ends after its end (to)",
    ]);
  });
});

describe("URLs without credentials", () => {
  test("refuses user info, credential parameters and secret-shaped values", () => {
    for (const url of [
      "https://example.com/report?token=FAKE",
      "https://robin:hunter2@example.com/",
      "https://robin@example.com/",
      "https://example.com/?access_token=x",
      "https://example.com/?X-Amz-Signature=abc",
      "https://example.com/?API-Key=abc",
      "https://example.com/#id_token=abc",
      "https://example.com/files/ghp_exampleexampleexample",
      "https://example.com/?q=AKIAEXAMPLEEXAMPLE12",
      "https://example.com/?next=https%3A%2F%2Fexample.org%2F%3Fpassword%3Dx",
      "https://example.com/?next=https%253A%252F%252Fexample.org%252F%253Ftoken%253Dx",
      "https://example.com/?h=Bearer%20abc.def",
      "https://example.com/?bad=%E0%A4%A",
    ]) {
      expect([url, hasCredential(url)]).toEqual([url, true]);
    }
  });

  test("accepts ordinary links", () => {
    for (const url of [
      "https://example.com/docs/triage",
      "https://github.com/example/repo/pull/12",
      "https://example.com/search?q=token+budget&page=2",
      "https://example.com/docs/sql-reference/server/replication",
      "https://example.com/#section-2",
    ]) {
      expect([url, hasCredential(url)]).toEqual([url, false]);
    }
  });

  test("the schemas carry the rule", () => {
    const [main] = sampleData().roadmaps;
    if (!main) throw new Error("no example roadmap");
    const result = roadmap.safeParse({
      ...main,
      links: [{ label: "Board", url: "https://example.com/board?token=FAKE" }],
    });
    expect(result.success).toBe(false);
    const [issue] = result.error?.issues ?? [];
    expect(issue?.code === "custom" ? issue.params : null).toEqual({ rule: "credential_url" });
    expect(
      plan.safeParse({ ...newPlan(), links: [{ label: "x", url: "https://a:b@example.com" }] })
        .success,
    ).toBe(false);
  });
});

describe("portable paths", () => {
  test("only relative paths every system reads the same way", () => {
    const accepted = [
      "data/mission-control/reports/2026-10.md",
      "workspace/experiments/specs/agent-desk.md",
      "README.md",
    ];
    const refused = [
      "",
      "../../outside-or-missing",
      "data/../../x",
      "/etc/hosts",
      "./data/x.md",
      "data//x.md",
      "data\\x.md",
      "C:/data/x.md",
      "data/x.md ",
      "data/CON",
      "data/nul.txt",
      "data/x.",
      "data/x?.md",
      "data/zpráva.md",
    ];
    expect(accepted.filter((path) => !isPortablePath(path))).toEqual([]);
    expect(refused.filter((path) => isPortablePath(path))).toEqual([]);
  });
});
