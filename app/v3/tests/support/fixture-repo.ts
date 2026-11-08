import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Locale } from "../../src/i18n/locale.ts";
import { DATA_REPO_TEMPLATE, sampleDataFor } from "./seed.ts";

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
  /** The bare `origin` as the data checkout names it (a `file://` URL). */
  origin: string;
  /** The bare `origin` on disk, for Git commands run in it. */
  originPath: string;
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

/** `sample`: the example records of that language (`true` is English), or none. */
export function createFixtureRepo(options: { sample?: boolean | Locale } = {}): FixtureRepo {
  // The long, real path: Windows runners hand out an 8.3 short temp path
  // (RUNNER~1) that Git reports in its long form.
  const root = mkdtempSync(join(realpathSync.native(tmpdir()), "mission-control-test-"));
  const originPath = join(root, "origin.git");
  git(root, ["init", "--quiet", "--bare", "--initial-branch", "v3", originPath]);
  // A `file://` URL, not the path: repository-db recognises a local remote by
  // `/`, `.` or `file://`, so a Windows path (`C:\\…`) would be taken for a
  // network remote that needs credentials (Git for Windows configures the
  // credential manager).
  const origin = pathToFileURL(originPath).href;
  const moduleRoot = join(root, "module");
  mkdirSync(moduleRoot);
  const mountRoot = join(moduleRoot, "db");
  git(moduleRoot, ["clone", "--quiet", origin, "db"]);
  identity(mountRoot);
  git(mountRoot, ["checkout", "--quiet", "-B", "v3"]);
  cpSync(DATA_REPO_TEMPLATE, mountRoot, { recursive: true });
  if (options.sample) {
    const locale = options.sample === true ? "en" : options.sample;
    cpSync(join(sampleDataFor(locale), "data"), join(mountRoot, "data"), { recursive: true });
  }
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
    originPath,
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
