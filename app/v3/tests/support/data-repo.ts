import { afterEach } from "bun:test";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseYaml, toStableYaml } from "@lazurio/repository-db";
import type { RuleIssue } from "../../src/domain/rules.ts";
import type { Locale } from "../../src/i18n/locale.ts";
import { DATA_REPO_TEMPLATE, sampleDataFor } from "./seed.ts";

/** Records of the English example start, by repository-relative path. */
export const ROADMAP = "data/mission-control/roadmaps/2026/RM-0001-operating-roadmap.yaml";
export const PLAN = "data/mission-control/plans/2026/10/EX-0004-second-sales-channel.yaml";

const roots: string[] = [];

/** Removes the data repositories of a test file after each test. */
export function cleanupDataRepos() {
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });
}

/** A data repository as an Organization has it: the template and, optionally, examples. */
export function dataRepo(sample: Locale | null = "en"): string {
  // The long, real path: Windows runners hand out an 8.3 short temp path.
  const root = mkdtempSync(join(realpathSync.native(tmpdir()), "mission-control-data-"));
  roots.push(root);
  cpSync(DATA_REPO_TEMPLATE, root, { recursive: true });
  if (sample) cpSync(join(sampleDataFor(sample), "data"), join(root, "data"), { recursive: true });
  return root;
}

export const at = (root: string, path: string) => join(root, ...path.split("/"));

// biome-ignore lint/suspicious/noExplicitAny: a test edits records of any shape
export function edit(root: string, path: string, change: (value: any) => void) {
  const file = at(root, path);
  const value = parseYaml(readFileSync(file, "utf8"));
  change(value);
  writeFileSync(file, toStableYaml(value));
}

export const codes = (issues: readonly RuleIssue[] | readonly { record: string; code: string }[]) =>
  issues.map((issue) => `${issue.record} ${issue.code}`);

/** A link, or false where the platform does not let this process create one. */
export function link(target: string, path: string, type: "dir" | "file"): boolean {
  try {
    symlinkSync(target, path, type);
    return true;
  } catch {
    return false;
  }
}
