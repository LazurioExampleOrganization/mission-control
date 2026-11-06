import { join } from "node:path";
import dataRepository from "../../config/data-repository.json";
import { readDataDirectory } from "../data/directory.ts";
import { createRepositoryDbStore } from "../data/repository-db-store.ts";
import type { RuleIssue } from "../domain/rules.ts";
import { DATA_MOUNT, DATA_REPO_TEMPLATE, MODULE_ROOT, SAMPLE_DATA } from "./paths.ts";

/**
 * `bun run validate` checks the Module's data checkout (`db/`), draft
 * included: every record against its schema and the rules across records.
 * `--seed` checks the seeds this repository ships instead.
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

let ok = true;
if (process.argv.includes("--seed")) {
  const empty = readDataDirectory(join(DATA_REPO_TEMPLATE, "data"));
  ok = report("templates/data-repo (empty start)", empty.issues) && ok;
  if (empty.plans.length + empty.roadmaps.length > 0) {
    ok = report("templates/data-repo (empty start)", [
      { record: "data", message: "the empty start must hold no plans or roadmaps" },
    ]);
  }
  const sample = readDataDirectory(join(SAMPLE_DATA, "data"));
  ok = report("templates/sample-data (example start)", sample.issues) && ok;
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
      ok = false;
    } else {
      ok = report("db/", await store.check());
    }
  } finally {
    store.close();
  }
}
process.exit(ok ? 0 : 1);
