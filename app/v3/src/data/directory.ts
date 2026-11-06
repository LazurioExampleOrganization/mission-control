import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { parseYaml } from "@lazurio/repository-db";
import type { MissionControlConfig } from "../domain/config.ts";
import type { Plan } from "../domain/plan.ts";
import type { Roadmap } from "../domain/roadmap.ts";
import { checkRules, type RuleIssue } from "../domain/rules.ts";
import { parseConfig, parsePlan, parseRoadmap } from "./records.ts";

/**
 * Reads Mission Control records from a plain directory, outside any data
 * checkout: the seeds this repository ships (`templates/`). The running App
 * never uses it; its data goes through the storage port.
 */
export interface DirectoryData {
  config: MissionControlConfig | null;
  plans: { value: Plan; fileName: string }[];
  roadmaps: { value: Roadmap; fileName: string }[];
  issues: RuleIssue[];
}

function yamlFiles(root: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(root).sort();
  } catch {
    return [];
  }
  return entries.flatMap((name) => {
    const path = join(root, name);
    const stat = lstatSync(path);
    if (stat.isDirectory()) return yamlFiles(path);
    return stat.isFile() && /\.ya?ml$/i.test(name) ? [path] : [];
  });
}

/** `dataRoot` is the data repository's `data/` directory. */
export function readDataDirectory(dataRoot: string): DirectoryData {
  const issues: RuleIssue[] = [];
  const root = join(dataRoot, "mission-control");
  let config: MissionControlConfig | null = null;
  try {
    const path = join(root, "mission-control.config.json");
    config = parseConfig(JSON.parse(readFileSync(path, "utf8")), relative(dataRoot, path));
  } catch (error) {
    issues.push({
      record: "config",
      message: error instanceof Error ? error.message : String(error),
    });
  }
  const read = <T>(directory: string, parse: (value: unknown, label: string) => T) =>
    yamlFiles(join(root, directory)).flatMap((path) => {
      const label = relative(dataRoot, path);
      try {
        return [
          { value: parse(parseYaml(readFileSync(path, "utf8")), label), fileName: basename(path) },
        ];
      } catch (error) {
        issues.push({
          record: label,
          message: error instanceof Error ? error.message : String(error),
        });
        return [];
      }
    });
  const plans = read("plans", parsePlan);
  const roadmaps = read("roadmaps", parseRoadmap);
  if (config) issues.push(...checkRules({ config, plans, roadmaps }));
  return { config, plans, roadmaps, issues };
}
