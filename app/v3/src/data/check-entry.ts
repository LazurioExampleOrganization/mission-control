// The entry of the data repository's check bundle
// (`templates/data-repo/scripts/mission-control-check.js`, built by
// `bun run schema:export`): the App's own reading and checking of the data,
// with the engine's YAML parser, for a checkout that has no dependencies.
import { parseYaml } from "@lazurio/repository-db";
import type { RuleIssue } from "../domain/rules.ts";
import { checkDataFiles, directoryReader, freezeHistory } from "./files.ts";

/** Every issue of the data repository checkout at `root`; empty when the App accepts it. */
export function validateRepository(root: string): RuleIssue[] {
  return checkDataFiles(directoryReader(root), parseYaml);
}

/** A new `history.lock.json` for the checkout at `root`; see `freezeHistory`. */
export function freezeRepositoryHistory(root: string) {
  return freezeHistory(directoryReader(root));
}
