import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  freezeHistory,
  validateRepository,
} from "../../../templates/data-repo/scripts/validate.ts";
import { readDataDirectory } from "../src/data/directory.ts";
import { createRepositoryDbStore } from "../src/data/repository-db-store.ts";
import { HISTORY_SCHEMA_VERSION } from "../src/domain/history.ts";
import {
  at,
  cleanupDataRepos,
  codes,
  dataRepo,
  edit,
  link,
  PLAN,
  ROADMAP,
} from "./support/data-repo.ts";
import { createFixtureRepo, git } from "./support/fixture-repo.ts";

// The safeguards the Mission Control 3.x data validator had and 4.0 dropped
// (LazurioTemplates/mission-control#21): evidence that names a published file,
// URLs without credentials, and the 3.x history kept as it was. Every case
// runs the data repository's validator and the App's own check of the same
// directory, which must say the same.
setDefaultTimeout(60_000);
cleanupDataRepos();

const LOCK = "data/mission-control/history.lock.json";
const HISTORY = {
  "data/mission-control/DONE.tasks.json": '{\n  "tasks": []\n}\n',
  "data/mission-control/ISSUES.open.json": '{\n  "issues": []\n}\n',
  "data/mission-control/changesets/published/cs-0001.json": '{\n  "id": "cs-0001"\n}\n',
  "data/mission-control/reports/.gitkeep": "",
};

/** A data repository with the example records and a 3.x history beside them. */
function withHistory(): string {
  const root = dataRepo("en");
  for (const [path, text] of Object.entries(HISTORY)) {
    mkdirSync(join(at(root, path), ".."), { recursive: true });
    writeFileSync(at(root, path), text);
  }
  return root;
}

/** The validator's issues, after checking that the App's check says the same. */
async function check(root: string) {
  const validator = await validateRepository(root);
  expect(codes(readDataDirectory(root).problems)).toEqual(codes(validator));
  return validator;
}

async function freeze(root: string) {
  const result = await freezeHistory(root);
  if (Array.isArray(result)) throw new Error(`freeze refused: ${JSON.stringify(result)}`);
  return result;
}

describe("local evidence names a file the data repository publishes", () => {
  const cases: [string, (root: string) => void, string][] = [
    [
      "a path that leaves the repository",
      (root) =>
        edit(root, ROADMAP, (value) => {
          value.steps[0].evidence_refs[0].path = "../../outside-or-missing";
        }),
      `${ROADMAP} schema`,
    ],
    [
      "an absolute path",
      (root) =>
        edit(root, ROADMAP, (value) => {
          value.steps[0].evidence_refs[0].path = "/etc/hosts";
        }),
      `${ROADMAP} schema`,
    ],
    [
      "a file that does not exist",
      (root) =>
        edit(root, ROADMAP, (value) => {
          value.steps[0].evidence_refs[0].path = "data/mission-control/reports/missing.md";
        }),
      "RM-0001 evidence_missing",
    ],
    [
      "a name in another letter case",
      (root) =>
        edit(root, ROADMAP, (value) => {
          value.steps[0].evidence_refs[0].path = value.steps[0].evidence_refs[0].path.replace(
            "plans/",
            "Plans/",
          );
        }),
      "RM-0001 evidence_missing",
    ],
    [
      "a directory",
      (root) =>
        edit(root, ROADMAP, (value) => {
          value.steps[0].evidence_refs[0].path = "data/mission-control/plans";
        }),
      "RM-0001 evidence_not_file",
    ],
    [
      "a file repository-db never publishes",
      (root) => {
        mkdirSync(at(root, "generated"), { recursive: true });
        writeFileSync(at(root, "generated/report.md"), "derived\n");
        edit(root, ROADMAP, (value) => {
          value.steps[0].evidence_refs[0].path = "generated/report.md";
        });
      },
      "RM-0001 evidence_excluded",
    ],
  ];
  for (const [name, breakIt, expected] of cases) {
    test(name, async () => {
      const root = dataRepo("en");
      breakIt(root);
      expect(codes(await check(root))).toEqual([expected]);
    });
  }

  test("an existing file is accepted", async () => {
    const root = dataRepo("en");
    edit(root, ROADMAP, (value) => {
      value.steps[0].evidence_refs[0].path = PLAN;
    });
    expect(await check(root)).toEqual([]);
  });

  test("a file reached through a symbolic link", async () => {
    const root = dataRepo("en");
    const elsewhere = dataRepo("en");
    mkdirSync(at(root, "evidence"), { recursive: true });
    if (!link(at(elsewhere, "data"), at(root, "evidence/linked"), "dir")) {
      console.warn("skipped: this platform did not create a directory link");
      return;
    }
    edit(root, ROADMAP, (value) => {
      value.steps[0].evidence_refs[0].path = `evidence/linked/${PLAN.slice("data/".length)}`;
    });
    expect(codes(await check(root))).toEqual(["RM-0001 evidence_link"]);
  });
});

describe("no URL in a record carries a credential", () => {
  const cases: [string, string, (root: string) => void][] = [
    [
      "a token parameter in evidence",
      ROADMAP,
      (root) =>
        edit(root, ROADMAP, (value) => {
          value.steps[0].evidence_refs = [
            {
              label: "Report",
              kind: "report",
              url: "https://example.com/report?token=FAKE",
              verification: "external",
            },
          ];
        }),
    ],
    [
      "user info in a roadmap link",
      ROADMAP,
      (root) =>
        edit(root, ROADMAP, (value) => {
          value.links = [{ label: "Board", url: "https://robin:hunter2@example.com/board" }];
        }),
    ],
    [
      "an access key in a plan link",
      PLAN,
      (root) =>
        edit(root, PLAN, (value) => {
          value.links = [{ label: "Sheet", url: "https://example.com/sheet?api_key=FAKE-KEY" }];
        }),
    ],
    [
      "a token-shaped value in a pull request URL",
      PLAN,
      (root) =>
        edit(root, PLAN, (value) => {
          value.github = {
            prs: [{ url: "https://example.com/pr/1/ghp_exampleexampleexample" }],
          };
        }),
    ],
    [
      "a credential in a URL nested in a parameter",
      PLAN,
      (root) =>
        edit(root, PLAN, (value) => {
          value.links = [
            {
              label: "Redirect",
              url: "https://example.com/go?next=https%3A%2F%2Fexample.org%2F%3Faccess_token%3Dx",
            },
          ];
        }),
    ],
  ];
  for (const [name, path, breakIt] of cases) {
    test(name, async () => {
      const root = dataRepo("en");
      breakIt(root);
      // A refused plan is not read, so a roadmap step naming it reports it as
      // unknown as well; the URL is the schema issue of the record itself.
      const refused = (await check(root)).filter(
        (issue) => issue.record === path && issue.code === "schema",
      );
      expect(refused.length).toBe(1);
      expect(refused[0]?.message).toContain("credential");
    });
  }

  test("ordinary links pass", async () => {
    const root = dataRepo("en");
    edit(root, PLAN, (value) => {
      value.links = [
        { label: "Docs", url: "https://example.com/docs/triage" },
        { label: "Search", url: "https://example.com/search?q=token+budget&page=2" },
        { label: "Pull request", url: "https://github.com/example/repo/pull/12" },
      ];
    });
    expect(await check(root)).toEqual([]);
  });
});

describe("the 3.x history stays as it was frozen", () => {
  test("history without a lock is refused, file by file", async () => {
    const root = withHistory();
    expect(codes(await check(root))).toEqual(
      Object.keys(HISTORY)
        .sort()
        .map((path) => `${path} history_added`),
    );
  });

  test("a freeze writes the lock, and the frozen history passes", async () => {
    const root = withHistory();
    const result = await freeze(root);
    expect(result.count).toBe(4);
    expect(result.changes.added).toEqual(Object.keys(HISTORY).sort());
    const lock = JSON.parse(readFileSync(at(root, LOCK), "utf8"));
    expect(lock.schema_version).toBe(HISTORY_SCHEMA_VERSION);
    expect(Object.keys(lock.files)).toEqual(Object.keys(HISTORY).sort());
    expect(await check(root)).toEqual([]);
    // The same content gives the same lock.
    const again = await freeze(root);
    expect(again.changes).toEqual({ added: [], changed: [], removed: [] });
    expect(readFileSync(at(root, LOCK), "utf8")).toBe(again.text);
  });

  const changes: [string, (root: string) => void, string][] = [
    [
      "a ledger that no longer parses",
      (root) => writeFileSync(at(root, "data/mission-control/DONE.tasks.json"), "{ not json"),
      "data/mission-control/DONE.tasks.json history_changed",
    ],
    [
      "a changed changeset",
      (root) =>
        writeFileSync(
          at(root, "data/mission-control/changesets/published/cs-0001.json"),
          '{\n  "id": "cs-0002"\n}\n',
        ),
      "data/mission-control/changesets/published/cs-0001.json history_changed",
    ],
    [
      "a new changeset",
      (root) =>
        writeFileSync(at(root, "data/mission-control/changesets/published/cs-0002.json"), "{}"),
      "data/mission-control/changesets/published/cs-0002.json history_added",
    ],
    [
      "a new file anywhere beside the records",
      (root) => writeFileSync(at(root, "data/mission-control/notes.md"), "new\n"),
      "data/mission-control/notes.md history_added",
    ],
    [
      "a removed file",
      (root) => rmSync(at(root, "data/mission-control/reports/.gitkeep")),
      "data/mission-control/reports/.gitkeep history_removed",
    ],
    [
      "a lock that is not JSON",
      (root) => writeFileSync(at(root, LOCK), "{"),
      `${LOCK} history_lock_invalid`,
    ],
    [
      "a lock that freezes a record",
      (root) => {
        const lock = JSON.parse(readFileSync(at(root, LOCK), "utf8"));
        lock.files[PLAN] = `sha256:${"0".repeat(64)}`;
        writeFileSync(at(root, LOCK), JSON.stringify(lock));
      },
      `${LOCK} history_lock_invalid`,
    ],
  ];
  for (const [name, change, expected] of changes) {
    test(name, async () => {
      const root = withHistory();
      await freeze(root);
      change(root);
      expect(codes(await check(root))).toEqual([expected]);
    });
  }

  test("line endings do not count", async () => {
    const root = withHistory();
    await freeze(root);
    const path = at(root, "data/mission-control/DONE.tasks.json");
    writeFileSync(path, readFileSync(path, "utf8").replaceAll("\n", "\r\n"));
    expect(await check(root)).toEqual([]);
  });

  test("records stay free to change", async () => {
    const root = withHistory();
    await freeze(root);
    edit(root, PLAN, (value) => {
      value.status = "ready";
    });
    expect(await check(root)).toEqual([]);
  });

  test("a linked history directory is refused and not read, and not frozen", async () => {
    const root = withHistory();
    const elsewhere = withHistory();
    rmSync(at(root, "data/mission-control/changesets"), { recursive: true });
    if (
      !link(
        at(elsewhere, "data/mission-control/changesets"),
        at(root, "data/mission-control/changesets"),
        "dir",
      )
    ) {
      console.warn("skipped: this platform did not create a directory link");
      return;
    }
    const refused = await freezeHistory(root);
    expect(Array.isArray(refused) ? codes(refused) : refused).toEqual([
      "data/mission-control/changesets link_refused",
    ]);
    expect(existsSync(at(root, LOCK))).toBe(false);
    expect(codes(await check(root))).toContain("data/mission-control/changesets link_refused");
  });
});

describe("the App applies the same safeguards to its data checkout", () => {
  test("its data check equals the validator, and a roadmap save with missing evidence is refused", async () => {
    const fixture = createFixtureRepo({ sample: true });
    const store = createRepositoryDbStore({
      mountRoot: fixture.mountRoot,
      expect: { remote: fixture.origin, branch: "v3", within: fixture.moduleRoot },
      intervalMs: 0,
    });
    try {
      for (const [path, text] of Object.entries(HISTORY)) {
        mkdirSync(join(at(fixture.mountRoot, path), ".."), { recursive: true });
        writeFileSync(at(fixture.mountRoot, path), text);
      }
      expect(codes(await store.check())).toEqual(
        codes(await validateRepository(fixture.mountRoot)),
      );
      expect(codes(await store.check())).toContain(
        "data/mission-control/DONE.tasks.json history_added",
      );
      await freeze(fixture.mountRoot);
      writeFileSync(at(fixture.mountRoot, "data/mission-control/DONE.tasks.json"), "{ not json");
      expect(codes(await store.check())).toEqual([
        "data/mission-control/DONE.tasks.json history_changed",
      ]);

      const roadmap = await store.getRoadmap("RM-0001");
      if (!roadmap) throw new Error("RM-0001 missing");
      const [first, ...rest] = roadmap.value.steps;
      if (!first) throw new Error("RM-0001 has no step");
      let refusal: { code?: string; issues?: { code: string }[] } = {};
      try {
        await store.saveRoadmap(
          {
            ...roadmap.value,
            steps: [
              {
                ...first,
                evidence_refs: [
                  { label: "Report", kind: "report", path: "data/mission-control/reports/x.md" },
                ],
              },
              ...rest,
            ],
          },
          roadmap.revision,
        );
      } catch (error) {
        refusal = error as typeof refusal;
      }
      expect(refusal.code).toBe("invalid_record");
      expect(refusal.issues?.map((issue) => issue.code)).toEqual(["evidence_missing"]);
      expect(
        git(fixture.mountRoot, ["status", "--porcelain", "--", "data/mission-control/roadmaps"]),
      ).toBe("");
    } finally {
      store.close();
      fixture.cleanup();
    }
  });

  test("bun scripts/validate.ts --freeze-history works in a data repository checkout", () => {
    const root = withHistory();
    const run = (args: string[]) =>
      Bun.spawnSync([process.execPath, "scripts/validate.ts", ...args], {
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
      });
    const before = run([]);
    expect(before.exitCode).toBe(1);
    expect(before.stderr.toString()).toContain("--freeze-history");
    const frozen = run(["--freeze-history"]);
    expect(frozen.exitCode).toBe(0);
    expect(frozen.stdout.toString()).toContain("Froze 4 history file(s)");
    expect(run([]).exitCode).toBe(0);
  });
});
