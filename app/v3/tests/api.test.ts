import { describe, expect, test } from "bun:test";
import { createMemoryStore } from "../src/data/memory-store.ts";
import { createApi } from "../src/server/api.ts";
import { sampleData } from "./support/seed.ts";

const ORIGIN = "http://127.0.0.1:24901";

function setup() {
  const store = createMemoryStore(sampleData());
  const api = createApi(store, { allowedOrigins: new Set([ORIGIN]), today: () => "2026-11-03" });
  const call = (method: string, path: string, body?: unknown, origin: string | null = ORIGIN) =>
    api(
      new Request(`${ORIGIN}${path}`, {
        method,
        headers: {
          ...(origin ? { origin } : {}),
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  return { store, call };
}

const newPlanInput = {
  title: "Shared glossary review",
  owner: "robinlee",
  priority: "medium",
  context: "Terms drift.",
  current_problem: "No schedule.",
  target_state: "A quarterly review.",
  acceptance_criteria: ["Reviewed once a quarter."],
  validation: ["The glossary shows the review date."],
};

describe("HTTP API", () => {
  test("reads plans, roadmaps and settings", async () => {
    const { call } = setup();
    expect((await (await call("GET", "/api/plans")).json()).length).toBe(4);
    expect((await (await call("GET", "/api/roadmaps/RM-0001")).json()).value.main).toBe(true);
    expect((await call("GET", "/api/plans/EX-0404")).status).toBe(404);
    expect((await (await call("GET", "/api/config")).json()).plan_prefix).toBe("EX");
    expect(await (await call("GET", "/api/check")).json()).toEqual([]);
  });

  test("accepts a change only as JSON from the App's own origin", async () => {
    const { call } = setup();
    expect((await call("POST", "/api/plans", newPlanInput, null)).status).toBe(403);
    expect((await call("POST", "/api/plans", newPlanInput, "https://evil.example")).status).toBe(
      403,
    );
    const plain = await call("POST", "/api/draft/pull", undefined);
    expect(plain.status).toBe(415);
  });

  test("creates a plan with the next code and saves an edit as a draft", async () => {
    const { call } = setup();
    const created = await call("POST", "/api/plans", newPlanInput);
    expect(created.status).toBe(201);
    const { value, revision } = await created.json();
    expect(value.dev_code).toBe("EX-0005");
    expect(value.created_at).toBe("2026-11-03");

    const saved = await call("PUT", "/api/plans/EX-0005", {
      record: { ...value, status: "ready" },
      baseRevision: revision,
    });
    expect(saved.status).toBe(200);
    const stale = await call("PUT", "/api/plans/EX-0005", {
      record: { ...value, owner: "someone-else" },
      baseRevision: revision,
    });
    expect(stale.status).toBe(409);
    expect((await stale.json()).code).toBe("record_changed");

    const mismatch = await call("PUT", "/api/plans/EX-0001", {
      record: value,
      baseRevision: revision,
    });
    expect(mismatch.status).toBe(400);
  });

  test("refuses an invalid record with its issues", async () => {
    const { call } = setup();
    const plan = await (await call("GET", "/api/plans/EX-0001")).json();
    const response = await call("PUT", "/api/plans/EX-0001", {
      record: { ...plan.value, priority_rank: 0 },
      baseRevision: plan.revision,
    });
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.code).toBe("invalid_record");
    expect(body.issues[0].path).toBe("priority_rank");
  });

  test("publishes the shown draft and refuses a changed one", async () => {
    const { call } = setup();
    await call("POST", "/api/plans", newPlanInput);
    const draft = await (await call("GET", "/api/draft")).json();
    expect(draft.records.length).toBe(1);
    expect((await call("POST", "/api/draft/publish", { expectedRevision: "stale" })).status).toBe(
      409,
    );
    expect(
      (await call("POST", "/api/draft/publish", { expectedRevision: draft.revision })).status,
    ).toBe(200);
    expect((await (await call("GET", "/api/draft")).json()).records).toEqual([]);
  });
});
