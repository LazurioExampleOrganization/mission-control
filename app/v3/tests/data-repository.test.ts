import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validateRepository } from "../../../templates/data-repo/scripts/validate.ts";
import { renderOutputs } from "../src/cli/schema.ts";
import { readDataDirectory } from "../src/data/directory.ts";
import { createRepositoryDbStore } from "../src/data/repository-db-store.ts";
import {
  cleanupDataRepos,
  codes,
  dataRepo,
  edit,
  link,
  PLAN,
  ROADMAP,
} from "./support/data-repo.ts";
import { createFixtureRepo } from "./support/fixture-repo.ts";
import { DATA_REPO_TEMPLATE } from "./support/seed.ts";

// Building the check bundle and running Git take longer than bun's default
// of 5 s per test on a Windows runner.
setDefaultTimeout(60_000);
cleanupDataRepos();

describe("data repository template", () => {
  test("its generated JSON Schemas and check bundle are current", async () => {
    // Digests, so a stale bundle fails with its name rather than 200 kB of code.
    const digest = (text: string) => new Bun.CryptoHasher("sha256").update(text).digest("hex");
    for (const { file, text } of await renderOutputs()) {
      const current = readFileSync(join(DATA_REPO_TEMPLATE, ...file.split("/")), "utf8");
      expect({ file, digest: digest(current) }).toEqual({ file, digest: digest(text) });
    }
  });

  test("the validator passes the empty start and both example starts", async () => {
    expect(await validateRepository(dataRepo(null))).toEqual([]);
    expect(await validateRepository(dataRepo("cs"))).toEqual([]);
    expect(await validateRepository(dataRepo("en"))).toEqual([]);
  });
});

describe("the data repository's validator enforces what the App enforces", () => {
  const cases: [string, (root: string) => void, string][] = [
    [
      "a done step without evidence",
      (root) =>
        edit(root, ROADMAP, (value) => {
          delete value.steps[0].evidence_refs;
        }),
      `${ROADMAP} schema`,
    ],
    [
      "an executable step that names no plan, task or issue",
      (root) =>
        edit(root, ROADMAP, (value) => {
          delete value.steps[2].plan_refs;
        }),
      `${ROADMAP} schema`,
    ],
    [
      "a step naming a plan that does not exist",
      (root) =>
        edit(root, ROADMAP, (value) => {
          value.steps[2].plan_refs = ["EX-0404"];
        }),
      "RM-0001 step_unknown_plan",
    ],
    [
      "a plan outside the Organization's prefix",
      (root) =>
        edit(root, PLAN, (value) => {
          value.dev_code = "OT-0004";
          value.id = "mcplan-ot-0004";
        }),
      "OT-0004 prefix_mismatch",
    ],
    [
      "a record with a key written twice",
      (root) => {
        const file = join(root, ...PLAN.split("/"));
        writeFileSync(file, `${readFileSync(file, "utf8")}status: ready\n`);
      },
      `${PLAN} unreadable`,
    ],
  ];

  for (const [name, breakIt, expected] of cases) {
    test(name, async () => {
      const root = dataRepo("en");
      breakIt(root);
      const validator = await validateRepository(root);
      expect(codes(validator)).toContain(expected);
      // The App's own check of the same directory says exactly the same.
      expect(codes(readDataDirectory(root).problems)).toEqual(codes(validator));
    });
  }

  test("the App's check of a data checkout and the validator agree", async () => {
    const fixture = createFixtureRepo({ sample: "cs" });
    const store = createRepositoryDbStore({
      mountRoot: fixture.mountRoot,
      expect: { remote: fixture.origin, branch: "v3", within: fixture.moduleRoot },
      intervalMs: 0,
    });
    try {
      edit(
        fixture.mountRoot,
        "data/mission-control/roadmaps/2026/RM-0001-provozni-roadmapa-2026-2027.yaml",
        (value) => {
          delete value.steps[0].evidence_refs;
          value.steps[2].plan_refs = ["EX-0404"];
        },
      );
      const validator = await validateRepository(fixture.mountRoot);
      expect(validator.length).toBeGreaterThan(0);
      expect(codes(await store.check())).toEqual(codes(validator));
      // The roadmap the App cannot read is the one the validator refuses.
      expect(await store.getRoadmap("RM-0001")).toBeNull();
    } finally {
      store.close();
      fixture.cleanup();
    }
  });
});

describe("the data repository's validator never follows a symbolic link", () => {
  /** A copy of the example records outside the checkout, with a record that would fail. */
  function outside(): string {
    const root = dataRepo("en");
    edit(root, PLAN, (value) => {
      value.title = "";
    });
    return root;
  }

  const cases: [string, string, "dir" | "file"][] = [
    ["the plans directory", "data/mission-control/plans", "dir"],
    ["the data directory", "data", "dir"],
    ["the settings", "data/mission-control/mission-control.config.json", "file"],
    ["one record", PLAN, "file"],
    ["the check bundle", "scripts/mission-control-check.js", "file"],
  ];

  for (const [name, path, type] of cases) {
    test(name, async () => {
      const root = dataRepo("en");
      const elsewhere = outside();
      const target = join(root, ...path.split("/"));
      rmSync(target, { recursive: true, force: true });
      if (!link(join(elsewhere, ...path.split("/")), target, type)) {
        console.warn(`skipped: this platform did not create a ${type} link`);
        return;
      }
      const issues = await validateRepository(root);
      expect(codes(issues)).toContain(`${path} link_refused`);
      // Nothing behind the link was read: its broken record is not reported.
      expect(issues.filter((issue) => issue.code === "schema")).toEqual([]);
    });
  }

  test("a link deeper in a record directory", async () => {
    const root = dataRepo("en");
    const elsewhere = outside();
    const directory = join(root, "data", "mission-control", "plans", "2026", "11");
    mkdirSync(directory, { recursive: true });
    if (
      !link(join(elsewhere, ...PLAN.split("/")), join(directory, "EX-0009-linked.yaml"), "file")
    ) {
      console.warn("skipped: this platform did not create a file link");
      return;
    }
    expect(codes(await validateRepository(root))).toEqual([
      "data/mission-control/plans/2026/11/EX-0009-linked.yaml link_refused",
    ]);
  });
});
