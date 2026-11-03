import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DATA_REPO_TEMPLATE, SAMPLE_DATA } from "./seed.ts";

/**
 * A data repository for tests, built the way an adopting Organization builds
 * it: the data repository template, optionally the example records, pushed
 * to a local bare `origin` on branch `v3` and checked out as a module's `db/`.
 * The engine's real validator (`bun scripts/validate.ts`) runs on publish.
 */
export interface FixtureRepo {
  root: string;
  moduleRoot: string;
  mountRoot: string;
  origin: string;
  cleanup(): void;
}

export function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

function identity(path: string) {
  git(path, ["config", "user.name", "Fixture Colleague"]);
  git(path, ["config", "user.email", "colleague@example.com"]);
}

export function createFixtureRepo(options: { sample?: boolean } = {}): FixtureRepo {
  const root = mkdtempSync(join(tmpdir(), "mission-control-test-"));
  const origin = join(root, "origin.git");
  git(root, ["init", "--quiet", "--bare", "--initial-branch", "v3", origin]);
  const moduleRoot = join(root, "module");
  mkdirSync(moduleRoot);
  const mountRoot = join(moduleRoot, "db");
  git(moduleRoot, ["clone", "--quiet", origin, "db"]);
  identity(mountRoot);
  git(mountRoot, ["checkout", "--quiet", "-B", "v3"]);
  cpSync(DATA_REPO_TEMPLATE, mountRoot, { recursive: true });
  if (options.sample)
    cpSync(join(SAMPLE_DATA, "data"), join(mountRoot, "data"), { recursive: true });
  const config = join(mountRoot, "repository-db.yaml");
  writeFileSync(
    config,
    readFileSync(config, "utf8").replace(
      "git@github.com:REPLACE_WITH_ORGANIZATION/mission-control-data.git",
      origin,
    ),
  );
  git(mountRoot, ["add", "--all"]);
  git(mountRoot, ["commit", "--quiet", "--message", "Mission Control data: start"]);
  git(mountRoot, ["push", "--quiet", "--set-upstream", "origin", "v3"]);
  return {
    root,
    moduleRoot,
    mountRoot,
    origin,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

/** A colleague's own checkout of the same data repository. */
export function colleagueClone(fixture: FixtureRepo, name = "colleague"): string {
  const path = join(fixture.root, name);
  git(fixture.root, ["clone", "--quiet", "--branch", "v3", fixture.origin, name]);
  identity(path);
  return path;
}
