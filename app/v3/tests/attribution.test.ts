import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { TEST_ORIGIN } from "@lazurio/module-kit/tools/testing";
import { createRepositoryDbStore } from "../src/data/repository-db-store.ts";
import { CHANNEL_HEADER, createApi } from "../src/server/api.ts";
import { createFixtureRepo, git } from "./support/fixture-repo.ts";
import { newPlan } from "./support/seed.ts";

// Real Git and the data repository's validator run here; see repository-db-store.test.ts.
setDefaultTimeout(60_000);

const PLAN = {
  title: "Shared glossary review",
  owner: "robinlee",
  priority: "medium",
  context: "Terms drift.",
  current_problem: "No schedule.",
  target_state: "A quarterly review.",
  acceptance_criteria: ["Reviewed once a quarter."],
  validation: ["The glossary shows the review date."],
};

/**
 * Author and channel (Module Standard, One data port): every change records
 * the person's subject and the channel it came by, in the draft and when it
 * is published; a caller without a subject records none.
 */
function setup(subject: string | null) {
  const fixture = createFixtureRepo({ sample: true });
  const store = createRepositoryDbStore({
    mountRoot: fixture.mountRoot,
    expect: { remote: fixture.origin, branch: "v3", within: fixture.moduleRoot },
    intervalMs: 0,
  });
  const handle = createApi(store, {
    allowedOrigins: new Set([TEST_ORIGIN]),
    access: () => ({ admitted: true, mayWrite: true, subject }),
    today: () => "2026-11-03",
  });
  // The interface states its channel; `stated: null` sends none.
  const call = (path: string, body: unknown, stated: string | null = "ui") =>
    handle(
      new Request(`${TEST_ORIGIN}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: TEST_ORIGIN,
          ...(stated ? { [CHANNEL_HEADER]: stated } : {}),
        },
        body: JSON.stringify(body),
      }),
    );
  const origins = async () =>
    ((await store.draft()).records ?? []).map((record) => record.resource.changes[0]?.origin);
  return { fixture, store, call, origins };
}

describe("author and channel", () => {
  test("a change from the interface records the person and the channel ui", async () => {
    const { fixture, store, call, origins } = setup("subject-1");
    try {
      expect((await call("/api/plans", PLAN)).status).toBe(201);
      expect(await origins()).toEqual([
        expect.objectContaining({
          kind: "app",
          actor: "subject-1",
          source: "mission-control-v3/ui",
        }),
      ]);
    } finally {
      store.close();
      fixture.cleanup();
    }
  });

  test("a caller without a subject invents none", async () => {
    const { fixture, store, call, origins } = setup(null);
    try {
      expect((await call("/api/plans", PLAN)).status).toBe(201);
      const [origin] = await origins();
      expect(origin?.source).toBe("mission-control-v3/ui");
      expect(origin?.actor).toBeUndefined();
    } finally {
      store.close();
      fixture.cleanup();
    }
  });

  test("a change nobody stated the origin of is recorded as unknown", async () => {
    const { fixture, store, origins } = setup(null);
    try {
      await store.savePlan(newPlan(), null);
      expect(await origins()).toEqual([
        expect.objectContaining({ kind: "unknown", source: "mission-control-v3" }),
      ]);
    } finally {
      store.close();
      fixture.cleanup();
    }
  });

  test("a publication records who published and by which channel", async () => {
    const { fixture, store, call } = setup("subject-2");
    try {
      expect((await call("/api/plans", PLAN)).status).toBe(201);
      const card = await store.draft();
      expect((await call("/api/draft/publish", { expectedRevision: card.revision })).status).toBe(
        200,
      );
      const trailers = git(fixture.originPath, ["log", "-1", "--format=%(trailers:only)", "v3"]);
      expect(trailers).toContain("Repository-Db-Actor: subject-2");
      expect(trailers).toContain("Repository-Db-Source: mission-control-v3/ui");
    } finally {
      store.close();
      fixture.cleanup();
    }
  });

  test("a failure to record the origin never fails the saved write", async () => {
    const { fixture, store, call } = setup("subject-3");
    try {
      // The origin hint cannot be written: a directory stands where its file goes.
      mkdirSync(join(fixture.mountRoot, ".repository-db", "draft-origin.json"), {
        recursive: true,
      });
      expect((await call("/api/plans", PLAN)).status).toBe(201);
      expect((await store.listPlans()).some((row) => row.value.title === PLAN.title)).toBe(true);
    } finally {
      store.close();
      fixture.cleanup();
    }
  });

  test("a request that states no channel is unknown, with the gateway's person", async () => {
    const { fixture, store, call, origins } = setup("subject-4");
    try {
      expect((await call("/api/plans", PLAN, null)).status).toBe(201);
      expect(await origins()).toEqual([
        expect.objectContaining({
          kind: "unknown",
          actor: "subject-4",
          source: "mission-control-v3",
        }),
      ]);
    } finally {
      store.close();
      fixture.cleanup();
    }
  });
});
