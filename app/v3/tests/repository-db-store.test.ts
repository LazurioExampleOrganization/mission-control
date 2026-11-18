import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gatewayRequest, TEST_ORIGIN } from "@lazurio/module-kit/tools/testing";
import { toStableYaml } from "@lazurio/repository-db";
import { createRepositoryDbStore } from "../src/data/repository-db-store.ts";
import { MESSAGES } from "../src/i18n/messages.ts";
import { copyWrites } from "../src/server/access.ts";
import { createApi } from "../src/server/api.ts";
import { wordDraftCard } from "../src/ui/draft-wording.ts";
import { storeContract } from "./store-contract.ts";
import { colleagueClone, createFixtureRepo, git } from "./support/fixture-repo.ts";
import { newPlan } from "./support/seed.ts";

// These tests run real Git and the data repository's validator for every
// publish. On a Windows runner one publish takes several seconds, more than
// bun's default of 5 s per test, so they get a minute.
setDefaultTimeout(60_000);

storeContract("repository-db", async () => {
  const fixture = createFixtureRepo({ sample: true });
  const store = createRepositoryDbStore({
    mountRoot: fixture.mountRoot,
    expect: { remote: fixture.origin, branch: "v3", within: fixture.moduleRoot },
    intervalMs: 0,
  });
  return { store, cleanup: fixture.cleanup };
});

describe("repository-db store", () => {
  test("keeps the record layout of v3 data repositories and publishes one validated commit", async () => {
    const fixture = createFixtureRepo({ sample: true });
    const store = createRepositoryDbStore({
      mountRoot: fixture.mountRoot,
      expect: { remote: fixture.origin, branch: "v3", within: fixture.moduleRoot },
      intervalMs: 0,
    });
    try {
      await store.savePlan(newPlan(), null);
      const path = "data/mission-control/plans/2026/11/EX-0005-shared-glossary-review.yaml";
      expect(existsSync(join(fixture.mountRoot, path))).toBe(true);
      const card = await store.draft();
      expect(card.records?.[0]?.technicalPath).toBe(path);
      expect(card.records?.[0]?.resource.routeTarget?.href).toBe("#/plans/EX-0005");

      await store.publish({ expectedRevision: card.revision ?? "", summary: "Plan EX-0005" });
      const log = git(fixture.originPath, ["log", "-1", "--format=%s%n%(trailers:only)", "v3"]);
      expect(log).toContain("Plan EX-0005");
      expect(log).toContain("Repository-Db-Source: mission-control-v3");
      expect(git(fixture.originPath, ["rev-list", "--count", "v3"])).toBe("2");
    } finally {
      store.close();
      fixture.cleanup();
    }
  });

  test("refuses a publish the data repository's validator rejects", async () => {
    const fixture = createFixtureRepo({ sample: true });
    const store = createRepositoryDbStore({
      mountRoot: fixture.mountRoot,
      expect: { remote: fixture.origin, branch: "v3", within: fixture.moduleRoot },
      intervalMs: 0,
    });
    try {
      // An agent wrote a broken record by hand, past the App.
      writeFileSync(
        join(fixture.mountRoot, "data/mission-control/plans/2026/10/EX-0009-broken.yaml"),
        toStableYaml({ dev_code: "EX-0009" }),
      );
      expect((await store.check()).length).toBeGreaterThan(0);
      const card = await store.draft();
      let code: string | undefined;
      try {
        await store.publish({ expectedRevision: card.revision ?? "" });
      } catch (error) {
        code = (error as { code?: string }).code;
      }
      expect(code).toBe("validation_failed");
      expect(git(fixture.originPath, ["rev-list", "--count", "v3"])).toBe("1");
    } finally {
      store.close();
      fixture.cleanup();
    }
  });

  test("names only fields whose value changed, not keys the engine reordered (#18)", async () => {
    const fixture = createFixtureRepo({ sample: true });
    const store = createRepositoryDbStore({
      mountRoot: fixture.mountRoot,
      expect: { remote: fixture.origin, branch: "v3", within: fixture.moduleRoot },
      intervalMs: 0,
    });
    try {
      // EX-0002 is an older record: its keys, and those of its proposed tasks,
      // are not in the sorted order the engine writes on the first edit.
      const path = "data/mission-control/plans/2026/09/EX-0002-research-digest-pilot.yaml";
      const before = readFileSync(join(fixture.mountRoot, path), "utf8");
      expect(before).toContain("  - title: Draft the issue template\n    summary:");
      const opened = await store.getPlan("EX-0002");
      if (!opened) throw new Error("EX-0002 missing");
      await store.savePlan({ ...opened.value, priority_rank: 21 }, opened.revision);
      const after = readFileSync(join(fixture.mountRoot, path), "utf8");
      expect(after).toContain("  - assignee: research-agent\n    priority: high");

      for (const locale of ["cs", "en"] as const) {
        const change = (await store.draft(locale)).records?.[0]?.resource.changes[0];
        expect(change?.fields.map((field) => field.fieldPath)).toEqual(["/priority_rank"]);
        expect(change?.summary).toBe(locale === "cs" ? "Změněno polí: 1" : "Fields changed: 1");
      }
    } finally {
      store.close();
      fixture.cleanup();
    }
  });

  test("serves only its own data repository", async () => {
    const fixture = createFixtureRepo({ sample: true });
    const store = createRepositoryDbStore({
      mountRoot: fixture.mountRoot,
      expect: {
        remote: "git@github.com:SomeoneElse/mission-control-data.git",
        branch: "v3",
        within: fixture.moduleRoot,
      },
      intervalMs: 0,
    });
    try {
      const available = await store.available();
      expect(available.ok).toBe(false);
      if (!available.ok) expect(available.code).toBe("boundary_violation");
    } finally {
      store.close();
      fixture.cleanup();
    }
  });

  test("takes a colleague's published work and says which records changed", async () => {
    const fixture = createFixtureRepo({ sample: true });
    const store = createRepositoryDbStore({
      mountRoot: fixture.mountRoot,
      expect: { remote: fixture.origin, branch: "v3", within: fixture.moduleRoot },
      intervalMs: 0,
    });
    try {
      const colleague = colleagueClone(fixture);
      const file = join(
        colleague,
        "data/mission-control/plans/2026/10/EX-0004-second-sales-channel.yaml",
      );
      writeFileSync(file, readFileSync(file, "utf8").replace("status: shaping", "status: ready"));
      git(colleague, ["commit", "--quiet", "--all", "--message", "EX-0004 is ready"]);
      git(colleague, ["push", "--quiet"]);

      const events: string[] = [];
      const stop = store.subscribe((event) => events.push(event.type));
      await store.pull();
      stop();
      expect((await store.getPlan("EX-0004"))?.value.status).toBe("ready");
      expect(events).toContain("records-changed");
    } finally {
      store.close();
      fixture.cleanup();
    }
  });

  test("a copy that may not write never fetches or pulls, also through read requests", async () => {
    const fixture = createFixtureRepo({ sample: true });
    const store = createRepositoryDbStore({
      mountRoot: fixture.mountRoot,
      expect: { remote: fixture.origin, branch: "v3", within: fixture.moduleRoot },
      intervalMs: 0,
      writes: false,
    });
    try {
      const colleague = colleagueClone(fixture);
      writeFileSync(join(colleague, "colleague.txt"), "newer work\n");
      git(colleague, ["add", "colleague.txt"]);
      git(colleague, ["commit", "--quiet", "--message", "A colleague's newer work"]);
      git(colleague, ["push", "--quiet"]);
      const head = git(fixture.mountRoot, ["rev-parse", "HEAD"]);
      const tracked = git(fixture.mountRoot, ["rev-parse", "origin/v3"]);
      const handle = createApi(store, {
        allowedOrigins: new Set([TEST_ORIGIN]),
        access: () => ({ admitted: true, mayWrite: false }),
      });
      for (const path of ["/api/status", "/api/draft", "/api/check", "/api/plans", "/api/roadmaps"])
        expect((await handle(gatewayRequest(path, { caller: { role: "admin" } }))).status).toBe(
          200,
        );
      expect(git(fixture.mountRoot, ["rev-parse", "HEAD"])).toBe(head);
      expect(git(fixture.mountRoot, ["rev-parse", "origin/v3"])).toBe(tracked);
      expect(existsSync(join(fixture.mountRoot, "colleague.txt"))).toBe(false);
      await expect(store.pull()).rejects.toMatchObject({ code: "data_read_only" });
      const pull = await handle(
        gatewayRequest("/api/draft/pull", {
          caller: { role: "admin" },
          origin: TEST_ORIGIN,
          body: {},
        }),
      );
      expect(pull.status).toBe(409);
      expect(git(fixture.mountRoot, ["rev-parse", "origin/v3"])).toBe(tracked);
    } finally {
      store.close();
      fixture.cleanup();
    }
  });

  test("a read-only replica shows its draft without the network", async () => {
    const fixture = createFixtureRepo({ sample: true });
    const writer = createRepositoryDbStore({
      mountRoot: fixture.mountRoot,
      expect: { remote: fixture.origin, branch: "v3", within: fixture.moduleRoot },
      intervalMs: 0,
    });
    await writer.savePlan(newPlan(), null);
    writer.close();
    // The origin is gone: a fetch would fail, so a status needing one shows it.
    rmSync(fixture.originPath, { recursive: true, force: true });
    const store = createRepositoryDbStore({
      mountRoot: fixture.mountRoot,
      expect: { remote: fixture.origin, branch: "v3", within: fixture.moduleRoot },
      intervalMs: 0,
      writes: false,
    });
    try {
      expect((await store.available()).ok).toBe(true);
      const card = await store.draft();
      expect(card.unavailableReason).toBeUndefined();
      expect(card.status?.dirtyPaths).toEqual([
        "data/mission-control/plans/2026/11/EX-0005-shared-glossary-review.yaml",
      ]);
      expect(card.records).toHaveLength(1);
      // The card a person sees: the draft of one record, not "unavailable".
      const shown = wordDraftCard(card, MESSAGES.en);
      expect(shown.model.visible).toBe(true);
      expect(shown.model.tone).toBe("draft");
      expect(shown.model.count).toBe(1);
      expect(shown.headline).toBe(MESSAGES.en.draft.headline.draft(1));
    } finally {
      store.close();
      fixture.cleanup();
    }
  });

  test("a copy that may not write changes no record, as main.ts opens it in production", async () => {
    const fixture = createFixtureRepo({ sample: true });
    const writes = copyWrites({ LAZURIO_RUNTIME_DEPLOYMENT: "production" });
    expect(writes).toBe(false);
    const store = createRepositoryDbStore({
      mountRoot: fixture.mountRoot,
      expect: { remote: fixture.origin, branch: "v3", within: fixture.moduleRoot },
      intervalMs: 0,
      writes,
    });
    try {
      await expect(store.savePlan(newPlan(), null)).rejects.toMatchObject({
        code: "data_read_only",
      });
      expect(git(fixture.mountRoot, ["status", "--porcelain"])).toBe("");
    } finally {
      store.close();
      fixture.cleanup();
    }
  });

  test("an open read-only page hears when the host updates the replica", async () => {
    const fixture = createFixtureRepo({ sample: true });
    const store = createRepositoryDbStore({
      mountRoot: fixture.mountRoot,
      expect: { remote: fixture.origin, branch: "v3", within: fixture.moduleRoot },
      intervalMs: 20,
      writes: false,
    });
    const events: string[] = [];
    const stop = store.subscribe((event) => events.push(event.type));
    try {
      await Bun.sleep(60);
      expect(events).toEqual([]);
      const colleague = colleagueClone(fixture);
      const path = git(colleague, ["ls-files", "data/mission-control/plans"])
        .split("\n")
        .find((entry) => entry.endsWith(".yaml"));
      const file = join(colleague, path ?? "");
      writeFileSync(
        file,
        readFileSync(file, "utf8").replace(/^(\s*)title: .*$/m, "$1title: Replica update"),
      );
      git(colleague, ["commit", "--quiet", "--all", "--message", "Rename a plan"]);
      git(colleague, ["push", "--quiet"]);
      // The application host updates its replica; the App itself never pulls.
      git(fixture.mountRoot, ["pull", "--quiet", "--ff-only"]);
      for (let waited = 0; !events.includes("records-changed") && waited < 3000; waited += 20)
        await Bun.sleep(20);
      expect(events).toContain("records-changed");
      expect(events).toContain("draft-changed");
      expect((await store.listPlans()).some((row) => row.value.title === "Replica update")).toBe(
        true,
      );
    } finally {
      stop();
      store.close();
      fixture.cleanup();
    }
  });

  test("an open read-only page hears every change of a draft record, also the same one again", async () => {
    const fixture = createFixtureRepo({ sample: true });
    const store = createRepositoryDbStore({
      mountRoot: fixture.mountRoot,
      expect: { remote: fixture.origin, branch: "v3", within: fixture.moduleRoot },
      intervalMs: 20,
      writes: false,
    });
    const events: string[] = [];
    const stop = store.subscribe((event) => events.push(event.type));
    const recordChanges = () => events.filter((type) => type === "records-changed").length;
    const path = git(fixture.mountRoot, ["ls-files", "data/mission-control/plans"])
      .split("\n")
      .find((entry) => entry.endsWith(".yaml"));
    const file = join(fixture.mountRoot, path ?? "");
    const original = readFileSync(file, "utf8");
    // The host changes the replica's draft; the App itself never writes.
    const edit = async (value: string) => {
      const before = recordChanges();
      writeFileSync(file, original.replace(/^(\s*)title: .*$/m, `$1title: ${value}`));
      for (let waited = 0; recordChanges() === before && waited < 3000; waited += 20)
        await Bun.sleep(20);
      expect(recordChanges()).toBeGreaterThan(before);
      expect(events.at(-1)).toBe("draft-changed");
      expect((await store.listPlans()).some((row) => row.value.title === value)).toBe(true);
    };
    try {
      await Bun.sleep(60);
      expect(events).toEqual([]);
      await edit("First edit");
      await edit("Second edit");
    } finally {
      stop();
      store.close();
      fixture.cleanup();
    }
  });

  test("an open read-only page hears when its data become available", async () => {
    const fixture = createFixtureRepo({ sample: true });
    // The page opens before the host has mounted the data checkout.
    renameSync(fixture.mountRoot, `${fixture.mountRoot}.later`);
    const store = createRepositoryDbStore({
      mountRoot: fixture.mountRoot,
      expect: { remote: fixture.origin, branch: "v3", within: fixture.moduleRoot },
      intervalMs: 20,
      writes: false,
    });
    const events: string[] = [];
    const stop = store.subscribe((event) => events.push(event.type));
    try {
      await Bun.sleep(60);
      expect(events).toEqual([]);
      expect((await store.available()).ok).toBe(false);
      renameSync(`${fixture.mountRoot}.later`, fixture.mountRoot);
      for (let waited = 0; !events.includes("records-changed") && waited < 3000; waited += 20)
        await Bun.sleep(20);
      expect(events).toContain("records-changed");
      expect(events).toContain("draft-changed");
      expect((await store.available()).ok).toBe(true);
      expect((await store.listPlans()).length).toBeGreaterThan(0);
    } finally {
      stop();
      store.close();
      fixture.cleanup();
    }
  });

  test("an open read-only page hears a fetched newer state it does not pull", async () => {
    const fixture = createFixtureRepo({ sample: true });
    const store = createRepositoryDbStore({
      mountRoot: fixture.mountRoot,
      expect: { remote: fixture.origin, branch: "v3", within: fixture.moduleRoot },
      intervalMs: 20,
      writes: false,
    });
    const events: string[] = [];
    const stop = store.subscribe((event) => events.push(event.type));
    try {
      await Bun.sleep(60);
      expect(events).toEqual([]);
      expect((await store.draft()).status?.state).toBe("published");
      const colleague = colleagueClone(fixture);
      writeFileSync(join(colleague, "colleague.txt"), "newer work\n");
      git(colleague, ["add", "colleague.txt"]);
      git(colleague, ["commit", "--quiet", "--message", "A colleague's newer work"]);
      git(colleague, ["push", "--quiet"]);
      const head = git(fixture.mountRoot, ["rev-parse", "HEAD"]);
      // The host fetches but does not pull yet; the App itself does neither.
      git(fixture.mountRoot, ["fetch", "--quiet"]);
      for (let waited = 0; !events.includes("draft-changed") && waited < 3000; waited += 20)
        await Bun.sleep(20);
      expect(events).toContain("draft-changed");
      expect((await store.draft()).status?.state).toBe("pull_needed");
      expect(git(fixture.mountRoot, ["rev-parse", "HEAD"])).toBe(head);
    } finally {
      stop();
      store.close();
      fixture.cleanup();
    }
  });
});
