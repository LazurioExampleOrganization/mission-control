import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { toStableYaml } from "@lazurio/repository-db";
import { createRepositoryDbStore } from "../src/data/repository-db-store.ts";
import { storeContract } from "./store-contract.ts";
import { colleagueClone, createFixtureRepo, git } from "./support/fixture-repo.ts";
import { newPlan } from "./support/seed.ts";

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
      const log = git(fixture.origin, ["log", "-1", "--format=%s%n%(trailers:only)", "v3"]);
      expect(log).toContain("Plan EX-0005");
      expect(log).toContain("Repository-Db-Source: mission-control-v3");
      expect(git(fixture.origin, ["rev-list", "--count", "v3"])).toBe("2");
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
      expect(git(fixture.origin, ["rev-list", "--count", "v3"])).toBe("1");
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
});
