import { parseYaml } from "@lazurio/repository-db";
import type { RuleIssue } from "../domain/rules.ts";
import {
  checkData,
  collectDataFiles,
  directoryReader,
  type ParsedData,
  parseDataFiles,
} from "./files.ts";

/**
 * Reads Mission Control records from a plain directory laid out like a data
 * repository (`data/mission-control/…`), outside any repository-db checkout:
 * the seeds this repository ships and `bun run validate -- --data <dir>`.
 * The running App never uses it; its data goes through the storage port.
 */
export interface DirectoryData extends ParsedData {
  /** Every issue of the directory: records, rules, evidence, frozen history. */
  problems: RuleIssue[];
}

export function readDataDirectory(root: string): DirectoryData {
  const reader = directoryReader(root);
  const parsed = parseDataFiles(collectDataFiles(reader), parseYaml);
  return { ...parsed, problems: checkData(reader, parsed) };
}
