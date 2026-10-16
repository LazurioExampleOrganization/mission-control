import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { loadMissionControlData, assertMissionControlWriteTarget } from "./mission-control-data-adapter.mjs";
import { detectSymlinkSupport } from "../test-support/symlink-support.mjs";

// Test fixtures create Git repositories with the host's default line-ending
// policy. Force LF so Windows hosts with core.autocrlf=true cannot turn
// fixture worktrees into CRLF copies that no longer match their LF blobs.
process.env.GIT_CONFIG_PARAMETERS = [
  process.env.GIT_CONFIG_PARAMETERS,
  "'core.autocrlf=false' 'core.eol=lf'",
].filter(Boolean).join(" ");

const symlinkTest = detectSymlinkSupport() ? test : test.skip;

function writeJson(path, value) {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeFixtureFile(root, relativePath, content) {
  const absolute = join(root, relativePath);
  mkdirSync(resolve(absolute, ".."), { recursive: true });
  writeFileSync(absolute, content);
}

function withRepositoryDbFixture(testBody) {
  const tempRoot = join(tmpdir(), `mct-data-adapter-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const repositoryDbRoot = join(tempRoot, "mission-control/db");
  mkdirSync(repositoryDbRoot, { recursive: true });
  writeFixtureFile(
    repositoryDbRoot,
    "repository-db.yaml",
    `schema_version: repository-db.config.v1\napp: mission-control\ndata_repo:\n  remote: git@github.com:ExampleOrg/mission-control-data.git\n  branch: v3\nschema:\n  name: mission-control-data\n  version: 3.0.0-alpha.0\nlayout:\n  data: data\n  generated: generated\n  scripts: scripts\nvalidate:\n  command: node scripts/validate-mission-control-data.mjs\n`,
  );
  writeJson(join(repositoryDbRoot, "data/mission-control/mission-control.config.json"), {
    schema_version: "mission-control.config.v1",
    data_mode: "repository-db",
    plan_prefix: "DEV",
    plans_dir: "data/mission-control/plans",
    roadmaps_dir: "data/mission-control/roadmaps",
    reports_dir: "data/mission-control/reports",
    import_reviews_dir: "data/mission-control/import-reviews",
    issues_open_path: "data/mission-control/ISSUES.open.json",
    issues_resolved_path: "data/mission-control/ISSUES.resolved.json",
    todo_tasks_path: "data/mission-control/TODO.tasks.json",
    done_tasks_path: "data/mission-control/DONE.tasks.json",
    compatibility_bridge: {
      legacy_read_paths_allowed: true,
      legacy_write_paths_allowed: false,
    },
  });
  writeFixtureFile(
    repositoryDbRoot,
    "data/mission-control/plans/2026/06/DEV-0001-template-runtime.yaml",
    `schema_version: mission-control.plan.v1\ncode: DEV-0001\ntitle: Template runtime\nstatus: ready\nowner: template-steward\nsummary: Placeholder fixture plan.\n`,
  );
  writeFixtureFile(
    repositoryDbRoot,
    "data/mission-control/roadmaps/2026/RM-0001-template-runtime.yaml",
    `schema_version: mission-control.roadmap.v1\ncode: RM-0001\ntitle: Template runtime roadmap\nstatus: ready\nowner: template-steward\nsource_plan: DEV-0001\npriorities:\n  - id: priority-001\n    title: Prove data adapter\n    priority: P1\nsteps:\n  - id: step-001\n    title: Read repository-db data\n    status: ready\n    executable: true\n    priority_refs:\n      - priority-001\n    plan_refs:\n      - DEV-0001\n    acceptance_criteria:\n      - Adapter reads repository-db mounted data.\n`,
  );
  writeJson(join(repositoryDbRoot, "data/mission-control/ISSUES.open.json"), [
    { id: "issue-001", status: "decision_needed", title: "Fixture open issue" },
  ]);
  writeJson(join(repositoryDbRoot, "data/mission-control/ISSUES.resolved.json"), [
    { id: "issue-000", status: "resolved", title: "Fixture resolved issue" },
  ]);
  writeJson(join(repositoryDbRoot, "data/mission-control/TODO.tasks.json"), [
    { id: "task-001", status: "pending", content: "Fixture TODO" },
  ]);
  writeJson(join(repositoryDbRoot, "data/mission-control/DONE.tasks.json"), [
    { id: "task-000", status: "completed", content: "Fixture DONE" },
  ]);
  writeFixtureFile(repositoryDbRoot, "data/mission-control/reports/.gitkeep", "");
  writeFixtureFile(repositoryDbRoot, "data/mission-control/import-reviews/.gitkeep", "");
  writeJson(join(repositoryDbRoot, "data/mission-control/reports/2026/06/auto-review.json"), {
    schema_version: "mission-control.report.v1",
    kind: "auto-review",
    findings: [],
  });
  writeFixtureFile(
    repositoryDbRoot,
    "data/mission-control/import-reviews/legacy-plans-import.md",
    "# Legacy plans import review\n\nPlaceholder fixture import review.\n",
  );
  try {
    return testBody({ tempRoot, repositoryDbRoot });
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

test("loads from an app/v3-only cold install without root node_modules", async () => {
  const tempRoot = join(
    tmpdir(),
    `mct-data-adapter-cold-install-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  const adapterPath = join(tempRoot, "src/mission-control-data-adapter.mjs");
  writeFixtureFile(
    tempRoot,
    "src/mission-control-data-adapter.mjs",
    readFileSync(new URL("./mission-control-data-adapter.mjs", import.meta.url), "utf8"),
  );
  writeJson(join(tempRoot, "app/v3/package.json"), {
    name: "mission-control-v3-cold-install-fixture",
    private: true,
    type: "module",
  });
  writeJson(join(tempRoot, "app/v3/node_modules/yaml/package.json"), {
    name: "yaml",
    version: "0.0.0-test",
    main: "index.cjs",
  });
  writeFixtureFile(
    tempRoot,
    "app/v3/node_modules/yaml/index.cjs",
    "module.exports = { parse(value) { return { value }; } };\n",
  );
  try {
    const coldAdapter = await import(pathToFileURL(adapterPath).href);
    assert.equal(typeof coldAdapter.loadMissionControlData, "function");
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("loads Mission Control records from a repository-db data mount", () => {
  withRepositoryDbFixture(({ repositoryDbRoot }) => {
    const data = loadMissionControlData({ repositoryDbRoot });

    assert.equal(data.repositoryDb.root, repositoryDbRoot);
    assert.equal(data.repositoryDb.config.data_repo.branch, "v3");
    assert.equal(data.config.data_mode, "repository-db");
    assert.equal(data.config.plan_prefix, "DEV");
    assert.equal(data.plans.length, 1);
    assert.equal(data.plans[0].code, "DEV-0001");
    assert.equal(data.roadmaps.length, 1);
    assert.equal(data.roadmaps[0].code, "RM-0001");
    assert.equal(data.issues.open[0].id, "issue-001");
    assert.equal(data.issues.resolved[0].id, "issue-000");
    assert.equal(data.tasks.todo[0].id, "task-001");
    assert.equal(data.tasks.done[0].id, "task-000");
    assert.equal(data.reports.length, 1);
    assert.equal(data.reports[0].relativePath, "data/mission-control/reports/2026/06/auto-review.json");
    assert.deepEqual(data.reports[0].parsed.findings, []);
    assert.equal(data.importReviews.length, 1);
    assert.equal(data.importReviews[0].relativePath, "data/mission-control/import-reviews/legacy-plans-import.md");
    assert.match(data.importReviews[0].content, /Legacy plans import review/);
  });
});

test("rejects legacy Mission Control write targets when compatibility bridge forbids them", () => {
  withRepositoryDbFixture(({ tempRoot, repositoryDbRoot }) => {
    const data = loadMissionControlData({ repositoryDbRoot });
    const legacyTarget = join(tempRoot, "mission-control/plans/2026/06/DEV-0002-legacy.yaml");
    assert.throws(
      () => assertMissionControlWriteTarget({ config: data.config, repositoryDbRoot, targetPath: legacyTarget }),
      /Legacy Mission Control writes are disabled/,
    );
    assert.doesNotThrow(() =>
      assertMissionControlWriteTarget({
        config: data.config,
        repositoryDbRoot,
        targetPath: join(repositoryDbRoot, "data/mission-control/plans/2026/06/DEV-0002-data-repo.yaml"),
      }),
    );
  });
});

symlinkTest("rejects repository-db write targets that traverse symlinked path components", () => {
  withRepositoryDbFixture(({ tempRoot, repositoryDbRoot }) => {
    const data = loadMissionControlData({ repositoryDbRoot });
    const outsidePlans = join(tempRoot, "legacy/plans");
    mkdirSync(outsidePlans, { recursive: true });
    rmSync(join(repositoryDbRoot, "data/mission-control/plans"), { recursive: true, force: true });
    symlinkSync(outsidePlans, join(repositoryDbRoot, "data/mission-control/plans"), "dir");

    assert.throws(
      () =>
        assertMissionControlWriteTarget({
          config: data.config,
          repositoryDbRoot,
          targetPath: join(repositoryDbRoot, "data/mission-control/plans/2026/06/DEV-0002-symlink.yaml"),
        }),
      /must not traverse symlink/i,
    );
  });
});

symlinkTest("rejects existing repository-db write target files that are symlinks", () => {
  withRepositoryDbFixture(({ tempRoot, repositoryDbRoot }) => {
    const data = loadMissionControlData({ repositoryDbRoot });
    const outsideFile = join(tempRoot, "legacy/DEV-0003-existing.yaml");
    writeFixtureFile(tempRoot, "legacy/DEV-0003-existing.yaml", "legacy: true\n");
    const targetPath = join(repositoryDbRoot, "data/mission-control/plans/2026/06/DEV-0003-existing.yaml");
    mkdirSync(resolve(targetPath, ".."), { recursive: true });
    symlinkSync(outsideFile, targetPath);

    assert.throws(
      () => assertMissionControlWriteTarget({ config: data.config, repositoryDbRoot, targetPath }),
      /must not traverse symlink/i,
    );
  });
});

test("requires explicit legacy roots before allowing legacy Mission Control writes", () => {
  withRepositoryDbFixture(({ tempRoot, repositoryDbRoot }) => {
    const data = loadMissionControlData({ repositoryDbRoot });
    data.config.compatibility_bridge.legacy_write_paths_allowed = true;
    assert.throws(
      () =>
        assertMissionControlWriteTarget({
          config: data.config,
          repositoryDbRoot,
          targetPath: join(tempRoot, "arbitrary/outside.yaml"),
        }),
      /explicit legacyRoots/,
    );
  });
});

test("restricts repository-db writes to configured Mission Control data paths", () => {
  withRepositoryDbFixture(({ repositoryDbRoot }) => {
    const data = loadMissionControlData({ repositoryDbRoot });
    assert.throws(
      () =>
        assertMissionControlWriteTarget({
          config: data.config,
          repositoryDbRoot,
          targetPath: join(repositoryDbRoot, "repository-db.yaml"),
        }),
      /protected Mission Control control-plane file/,
    );
    assert.throws(
      () =>
        assertMissionControlWriteTarget({
          config: data.config,
          repositoryDbRoot,
          targetPath: join(repositoryDbRoot, ".git/config"),
        }),
      /not an allowed Mission Control data path/,
    );
    assert.doesNotThrow(() =>
      assertMissionControlWriteTarget({
        config: data.config,
        repositoryDbRoot,
        targetPath: join(repositoryDbRoot, "data/mission-control/ISSUES.open.json"),
      }),
    );
  });
});

test("control-plane files stay denied when configured data directories broaden", () => {
  withRepositoryDbFixture(({ repositoryDbRoot }) => {
    const data = loadMissionControlData({ repositoryDbRoot });
    data.config.reports_dir = "data/mission-control";
    assert.throws(
      () =>
        assertMissionControlWriteTarget({
          config: data.config,
          repositoryDbRoot,
          targetPath: join(
            repositoryDbRoot,
            "data/mission-control/mission-control.config.json",
          ),
        }),
      /protected Mission Control control-plane file/,
    );
    assert.throws(
      () =>
        assertMissionControlWriteTarget({
          config: data.config,
          repositoryDbRoot,
          targetPath: join(
            repositoryDbRoot,
            "data/mission-control/MISSION-CONTROL.CONFIG.JSON",
          ),
        }),
      /protected Mission Control control-plane file/,
    );

    data.config.reports_dir = ".";
    assert.throws(
      () =>
        assertMissionControlWriteTarget({
          config: data.config,
          repositoryDbRoot,
          targetPath: join(repositoryDbRoot, "repository-db.yaml"),
        }),
      /protected Mission Control control-plane file/,
    );
    assert.throws(
      () =>
        assertMissionControlWriteTarget({
          config: data.config,
          repositoryDbRoot,
          targetPath: join(repositoryDbRoot, "REPOSITORY-DB.YAML"),
        }),
      /protected Mission Control control-plane file/,
    );
    assert.throws(
      () =>
        assertMissionControlWriteTarget({
          config: data.config,
          repositoryDbRoot,
          targetPath: join(repositoryDbRoot, "README.md"),
        }),
      /reports_dir must stay inside the Mission Control data root/,
    );
  });
});

symlinkTest("rejects configured read directories that traverse symlinks outside the data mount", () => {
  withRepositoryDbFixture(({ tempRoot, repositoryDbRoot }) => {
    const outsideReports = join(tempRoot, "outside-reports");
    mkdirSync(outsideReports, { recursive: true });
    writeFixtureFile(tempRoot, "outside-reports/leak.json", "{\"leaked\":true}\n");
    rmSync(join(repositoryDbRoot, "data/mission-control/reports"), { recursive: true, force: true });
    symlinkSync(outsideReports, join(repositoryDbRoot, "data/mission-control/reports"), "dir");

    assert.throws(() => loadMissionControlData({ repositoryDbRoot }), /reports_dir must not traverse symlink/i);
  });
});

symlinkTest("rejects symlinked Mission Control config path components", () => {
  withRepositoryDbFixture(({ tempRoot, repositoryDbRoot }) => {
    const outsideMissionControl = join(tempRoot, "outside-mission-control");
    mkdirSync(outsideMissionControl, { recursive: true });
    writeJson(join(outsideMissionControl, "mission-control.config.json"), { data_mode: "repository-db" });
    rmSync(join(repositoryDbRoot, "data/mission-control"), { recursive: true, force: true });
    symlinkSync(outsideMissionControl, join(repositoryDbRoot, "data/mission-control"), "dir");

    assert.throws(() => loadMissionControlData({ repositoryDbRoot }), /mission-control\.config\.json must not traverse symlink/i);
  });
});

symlinkTest("rejects symlinked repository-db config files", () => {
  withRepositoryDbFixture(({ tempRoot, repositoryDbRoot }) => {
    writeFixtureFile(
      tempRoot,
      "outside-repository-db.yaml",
      `schema_version: repository-db.config.v1\napp: mission-control\ndata_repo:\n  remote: git@github.com:ExampleOrg/mission-control-data.git\n  branch: v3\nschema:\n  name: mission-control-data\n  version: 3.0.0-alpha.0\nlayout:\n  data: data\n  generated: generated\n  scripts: scripts\nvalidate:\n  command: node scripts/validate-mission-control-data.mjs\n`,
    );
    rmSync(join(repositoryDbRoot, "repository-db.yaml"), { force: true });
    symlinkSync(join(tempRoot, "outside-repository-db.yaml"), join(repositoryDbRoot, "repository-db.yaml"));

    assert.throws(() => loadMissionControlData({ repositoryDbRoot }), /repository-db\.yaml must not traverse symlink/i);
  });
});

test("rejects repository-db config paths that escape the data mount", () => {
  withRepositoryDbFixture(({ repositoryDbRoot }) => {
    const configPath = join(repositoryDbRoot, "data/mission-control/mission-control.config.json");
    writeJson(configPath, {
      schema_version: "mission-control.config.v1",
      data_mode: "repository-db",
      plans_dir: "../outside/plans",
      roadmaps_dir: "data/mission-control/roadmaps",
      issues_open_path: "data/mission-control/ISSUES.open.json",
      issues_resolved_path: "data/mission-control/ISSUES.resolved.json",
      todo_tasks_path: "data/mission-control/TODO.tasks.json",
      done_tasks_path: "data/mission-control/DONE.tasks.json",
      compatibility_bridge: { legacy_write_paths_allowed: false },
    });
    assert.throws(() => loadMissionControlData({ repositoryDbRoot }), /plans_dir must stay inside repository-db root/);
  });
});
