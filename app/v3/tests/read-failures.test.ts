import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { parseYaml, toStableYaml } from "@lazurio/repository-db";
import {
  freezeHistory,
  validateRepository,
} from "../../../templates/data-repo/scripts/validate.ts";
import { readDataDirectory } from "../src/data/directory.ts";
import {
  checkData,
  checkHistory,
  collectDataFiles,
  type DataReader,
  directoryReader,
  freezeHistory as freezeWith,
  parseDataFiles,
} from "../src/data/files.ts";
import { createRepositoryDbStore } from "../src/data/repository-db-store.ts";
import { at, cleanupDataRepos, codes, dataRepo } from "./support/data-repo.ts";
import { createFixtureRepo } from "./support/fixture-repo.ts";
import { newPlan } from "./support/seed.ts";

// A check that could not read a file has not checked it: every failure to
// read or list a file or directory is an issue, never a silent skip, and a
// freeze never writes a lock that leaves out what it could not read
// (LazurioTemplates/mission-control#22, review of 2026-11-09).
setDefaultTimeout(60_000);
cleanupDataRepos();

const EXTRA_PLAN = "data/mission-control/plans/2026/11/EX-0005-shared-glossary-review.yaml";
const HISTORY_FILE = "data/mission-control/changesets/published/cs-0001.json";
const HISTORY_DIR = "data/mission-control/changesets/published";

/** The example records, one plan no roadmap names, and a frozen history. */
async function repository(): Promise<string> {
  const root = dataRepo("en");
  mkdirSync(join(at(root, EXTRA_PLAN), ".."), { recursive: true });
  writeFileSync(at(root, EXTRA_PLAN), toStableYaml(newPlan()));
  mkdirSync(at(root, HISTORY_DIR), { recursive: true });
  writeFileSync(at(root, HISTORY_FILE), '{\n  "id": "cs-0001"\n}\n');
  writeFileSync(at(root, "data/mission-control/DONE.tasks.json"), '{\n  "tasks": []\n}\n');
  const frozen = await freezeHistory(root);
  if (Array.isArray(frozen)) throw new Error(`freeze refused: ${JSON.stringify(frozen)}`);
  expect(await validateRepository(root)).toEqual([]);
  return root;
}

/**
 * Takes the read right of a file or directory away: `chmod 000` on POSIX, a
 * deny entry for Everyone on Windows. Returns how to give it back, or null
 * where this process can still read it (root, a file system without rights).
 */
function unreadable(path: string): (() => void) | null {
  const directory = !path.endsWith(".json") && !path.endsWith(".yaml");
  const readable = () => {
    try {
      if (directory) readdirSync(path);
      else readFileSync(path);
      return true;
    } catch {
      return false;
    }
  };
  let restore: () => void;
  if (process.platform === "win32") {
    spawnSync("icacls", [path, "/deny", "*S-1-1-0:(R)"], { stdio: "ignore" });
    restore = () => {
      spawnSync("icacls", [path, "/remove:d", "*S-1-1-0"], { stdio: "ignore" });
    };
  } else {
    chmodSync(path, 0);
    restore = () => chmodSync(path, directory ? 0o755 : 0o644);
  }
  if (readable()) {
    restore();
    return null;
  }
  return restore;
}

/** Runs `check` with `path` unreadable, or skips where rights cannot be taken away. */
async function withUnreadable(root: string, path: string, check: () => Promise<void>) {
  const restore = unreadable(at(root, path));
  if (!restore) {
    console.warn(`skipped: this process can still read ${path} (rights cannot be taken away here)`);
    return;
  }
  try {
    await check();
  } finally {
    restore();
  }
}

/** The validator's issues, after checking that the App's check of the directory says the same. */
async function check(root: string) {
  const issues = await validateRepository(root);
  expect(codes(readDataDirectory(root).problems)).toEqual(codes(issues));
  return issues;
}

describe("a file or directory the check cannot read is an issue", () => {
  test("a plan no roadmap names", async () => {
    const root = await repository();
    await withUnreadable(root, EXTRA_PLAN, async () => {
      expect(codes(await check(root))).toEqual([`${EXTRA_PLAN} read_failed`]);
      const run = Bun.spawnSync([process.execPath, "scripts/validate.ts"], {
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(run.exitCode).toBe(1);
      expect(run.stderr.toString()).toContain(`${EXTRA_PLAN}: cannot be read`);
      expect(run.stdout.toString()).not.toContain("OK");
    });
  });

  test("a directory of records", async () => {
    const root = await repository();
    const directory = "data/mission-control/plans/2026/11";
    await withUnreadable(root, directory, async () => {
      expect(codes(await check(root))).toEqual([`${directory} read_failed`]);
    });
  });

  test("the settings", async () => {
    const root = await repository();
    const settings = "data/mission-control/mission-control.config.json";
    await withUnreadable(root, settings, async () => {
      const issues = codes(await check(root));
      expect(issues).toContain(`${settings} read_failed`);
      expect(issues).not.toContain(`${settings} config_missing`);
    });
  });

  test("a frozen history file: reported, not taken for changed or removed, and not frozen", async () => {
    const root = await repository();
    const lock = readFileSync(at(root, "data/mission-control/history.lock.json"), "utf8");
    await withUnreadable(root, HISTORY_FILE, async () => {
      expect(codes(await check(root))).toEqual([`${HISTORY_FILE} read_failed`]);
      const freeze = await freezeHistory(root);
      expect(Array.isArray(freeze) ? codes(freeze) : freeze).toEqual([
        `${HISTORY_FILE} read_failed`,
      ]);
    });
    expect(readFileSync(at(root, "data/mission-control/history.lock.json"), "utf8")).toBe(lock);
  });

  test("a history directory: no file under it is reported removed, and no lock is written", async () => {
    const root = dataRepo("en");
    mkdirSync(at(root, HISTORY_DIR), { recursive: true });
    writeFileSync(at(root, HISTORY_FILE), "{}\n");
    await withUnreadable(root, HISTORY_DIR, async () => {
      expect(codes(await check(root))).toEqual([`${HISTORY_DIR} read_failed`]);
      const freeze = await freezeHistory(root);
      expect(Array.isArray(freeze) ? codes(freeze) : freeze).toEqual([
        `${HISTORY_DIR} read_failed`,
      ]);
      expect(existsSync(at(root, "data/mission-control/history.lock.json"))).toBe(false);
    });
  });

  test("evidence in a directory that cannot be read", async () => {
    if (process.platform === "win32") return; // Windows lets lstat pass a denied directory.
    const root = await repository();
    const directory = "data/mission-control/plans/2026/09";
    await withUnreadable(root, directory, async () => {
      const issues = codes(await check(root));
      expect(issues).toContain(`${directory} read_failed`);
      expect(issues.filter((issue) => issue.includes("evidence"))).toEqual([]);
    });
  });

  test("the App's data check reports it as the validator does", async () => {
    const fixture = createFixtureRepo({ sample: true });
    const store = createRepositoryDbStore({
      mountRoot: fixture.mountRoot,
      expect: { remote: fixture.origin, branch: "v3", within: fixture.moduleRoot },
      intervalMs: 0,
    });
    try {
      mkdirSync(join(at(fixture.mountRoot, EXTRA_PLAN), ".."), { recursive: true });
      writeFileSync(at(fixture.mountRoot, EXTRA_PLAN), toStableYaml(newPlan()));
      await withUnreadable(fixture.mountRoot, EXTRA_PLAN, async () => {
        const app = codes(await store.check());
        expect(app).toEqual([`${EXTRA_PLAN} read_failed`]);
        expect(app).toEqual(codes(await validateRepository(fixture.mountRoot)));
        // The records it can read are still served.
        expect((await store.listPlans()).length).toBe(4);
      });
    } finally {
      store.close();
      fixture.cleanup();
    }
  });
});

describe("read failures on every platform", () => {
  /** The checkout on disk, except that the given paths fail as an I/O error would. */
  function failing(root: string, paths: { bytes?: string[]; list?: string[] }): DataReader {
    const disk = directoryReader(root);
    return {
      kind: (path) => disk.kind(path),
      list: (path) => (paths.list?.includes(path) ? { failed: "EIO" } : disk.list(path)),
      bytes: (path) => (paths.bytes?.includes(path) ? { failed: "EIO" } : disk.bytes(path)),
    };
  }
  const checkWith = (reader: DataReader) =>
    codes(checkData(reader, parseDataFiles(collectDataFiles(reader), parseYaml)));

  test("a record that fails to read", async () => {
    const root = await repository();
    expect(checkWith(failing(root, { bytes: [EXTRA_PLAN] }))).toEqual([
      `${EXTRA_PLAN} read_failed`,
    ]);
  });

  test("a record directory that fails to list", async () => {
    const root = await repository();
    const directory = "data/mission-control/plans/2026/11";
    expect(checkWith(failing(root, { list: [directory] }))).toEqual([`${directory} read_failed`]);
  });

  test("a history file and a history directory, in the check and in a freeze", async () => {
    const root = await repository();
    const file = failing(root, { bytes: [HISTORY_FILE] });
    expect(codes(checkHistory(file))).toEqual([`${HISTORY_FILE} read_failed`]);
    expect(codes(freezeWith(file).issues)).toEqual([`${HISTORY_FILE} read_failed`]);
    const directory = failing(root, { list: [HISTORY_DIR] });
    expect(codes(checkHistory(directory))).toEqual([`${HISTORY_DIR} read_failed`]);
    expect(codes(freezeWith(directory).issues)).toEqual([`${HISTORY_DIR} read_failed`]);
  });

  test("a history lock that fails to read stops the check and a freeze", async () => {
    const root = await repository();
    const lock = "data/mission-control/history.lock.json";
    const reader = failing(root, { bytes: [lock] });
    expect(codes(checkHistory(reader))).toEqual([`${lock} read_failed`]);
    expect(codes(freezeWith(reader).issues)).toEqual([`${lock} read_failed`]);
  });

  test("the disk reader tells a failed listing from an empty directory, and missing from unreadable", () => {
    const root = dataRepo("en");
    const reader = directoryReader(root);
    const plan =
      "data/mission-control/plans/2026/09/EX-0001-knowledge-base-for-new-colleagues.yaml";
    expect(reader.list(plan)).toHaveProperty("failed");
    expect(reader.list("data/mission-control/plans/2026/09")).toHaveLength(2);
    expect(reader.bytes("data/mission-control/plans")).toBeNull();
    expect(reader.bytes("data/mission-control/plans/nothing.yaml")).toBeNull();
    expect(reader.kind("data/mission-control/plans/nothing.yaml")).toBe("missing");
  });
});
