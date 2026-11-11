import { resolve } from "node:path";
import dataRepository from "../../config/data-repository.json";
import { readDataDirectory } from "../data/directory.ts";
import { createRepositoryDbStore } from "../data/repository-db-store.ts";
import type { RuleIssue } from "../domain/rules.ts";
import { LOCALES } from "../i18n/locale.ts";
import { DATA_MOUNT, DATA_REPO_TEMPLATE, MODULE_ROOT, sampleDataFor } from "./paths.ts";

/**
 * `bun run validate` checks the Module's data checkout (`db/`), draft
 * included: every record against its schema and the rules across records.
 * `--data <dir>` checks a plain directory laid out like a data repository
 * (for example a worktree of a data pull request) with the same code, without
 * the checkout's repository and branch check. `--seed` checks the seeds this
 * repository ships.
 */
function report(label: string, issues: readonly RuleIssue[]): boolean {
  if (issues.length === 0) {
    console.log(`${label}: OK`);
    return true;
  }
  console.error(`${label}: ${issues.length} problem(s)`);
  for (const issue of issues) console.error(`  ${issue.record}: ${issue.message}`);
  return false;
}

const args = process.argv.slice(2);
const dataIndex = args.indexOf("--data");
let ok = true;
if (args.includes("--seed")) {
  const empty = readDataDirectory(DATA_REPO_TEMPLATE);
  ok = report("templates/data-repo (empty start)", empty.problems) && ok;
  if (empty.plans.length + empty.roadmaps.length > 0) {
    ok =
      report("templates/data-repo (empty start)", [
        {
          record: "data",
          code: "empty_start",
          message: "the empty start must hold no plans or roadmaps",
        },
      ]) && ok;
  }
  for (const locale of LOCALES) {
    const sample = readDataDirectory(sampleDataFor(locale));
    ok = report(`templates/sample-data/${locale} (example start)`, sample.problems) && ok;
  }
} else if (dataIndex >= 0) {
  const directory = args[dataIndex + 1];
  if (!directory) {
    console.error("usage: bun run validate -- --data <data repository directory>");
    process.exit(2);
  }
  ok = report(directory, readDataDirectory(resolve(directory)).problems);
} else {
  const store = createRepositoryDbStore({
    mountRoot: DATA_MOUNT,
    expect: { ...dataRepository, within: MODULE_ROOT },
    intervalMs: 0,
  });
  try {
    const available = await store.available();
    if (!available.ok) {
      console.error(`db/: ${available.message}`);
      console.error("To check a directory that is not the Module's data checkout: --data <dir>");
      ok = false;
    } else {
      ok = report("db/", await store.check());
    }
  } finally {
    store.close();
  }
}
process.exit(ok ? 0 : 1);
