import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { MissionControlConfig } from "../domain/config.ts";
import type { Plan } from "../domain/plan.ts";
import type { Roadmap } from "../domain/roadmap.ts";
import { checkRules, type RuleInput, type RuleIssue } from "../domain/rules.ts";
import { parseConfig, parsePlan, parseRoadmap } from "./records.ts";
import { StoreError } from "./store.ts";

/**
 * The one way Mission Control reads its records from files and checks them:
 * the same Zod schemas, the same YAML parser and the same rules across
 * records, whoever asks. The App's data check, `bun run validate` and the
 * data repository's own validator (`templates/data-repo/scripts/`, a bundle
 * of this module) all run this code, so a data pull request passes exactly
 * when the App accepts its records.
 *
 * Paths are relative to the data repository's root and use `/`.
 */
export const CONFIG_PATH = "data/mission-control/mission-control.config.json";
export const PLANS_PATH = "data/mission-control/plans";
export const ROADMAPS_PATH = "data/mission-control/roadmaps";

export interface DataFile {
  path: string;
  text: string;
}

export interface DataFiles {
  config: DataFile | null;
  plans: DataFile[];
  roadmaps: DataFile[];
  /** Paths refused while collecting (symbolic links). */
  issues: RuleIssue[];
}

export interface ParsedRecord<T> {
  path: string;
  fileName: string;
  value: T;
}

export interface ParsedData {
  config: MissionControlConfig | null;
  plans: ParsedRecord<Plan>[];
  roadmaps: ParsedRecord<Roadmap>[];
  /** Files that are missing, unreadable or do not match their schema. */
  issues: RuleIssue[];
}

export const isRecordFile = (name: string) => /\.ya?ml$/i.test(name);

export function linkRefused(path: string): RuleIssue {
  return {
    record: path,
    code: "link_refused",
    params: { path },
    message: `${path} is a symbolic link; links are never followed`,
  };
}

type PathState = "missing" | "file" | "directory" | "other" | { link: string };

/**
 * What a relative path is, checking every component from the root without
 * following a link: a link anywhere on the way is reported, never read.
 */
function inspect(root: string, relative: string): PathState {
  const parts = relative.split("/");
  for (let index = 0; index < parts.length; index += 1) {
    const current = parts.slice(0, index + 1).join("/");
    let stat: ReturnType<typeof lstatSync>;
    try {
      stat = lstatSync(join(root, ...parts.slice(0, index + 1)));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") return "missing";
      throw error;
    }
    if (stat.isSymbolicLink()) return { link: current };
    if (index === parts.length - 1) {
      return stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "other";
    }
    if (!stat.isDirectory()) return "missing";
  }
  return "missing";
}

/**
 * Reads the Mission Control files of a data repository checkout at `root`.
 * It never leaves the checkout: a symbolic link in any component of a path
 * (the `data` directory, a record directory, a record, the settings) is
 * refused as an issue and not read.
 */
export function collectDataFiles(root: string): DataFiles {
  const issues: RuleIssue[] = [];
  // A link high up (`data`) lies on the way to every file; it is named once.
  const refuse = (path: string) => {
    if (!issues.some((issue) => issue.record === path)) issues.push(linkRefused(path));
  };
  const read = (relative: string): DataFile => ({
    path: relative,
    text: readFileSync(join(root, ...relative.split("/")), "utf8"),
  });

  let config: DataFile | null = null;
  const configState = inspect(root, CONFIG_PATH);
  if (typeof configState === "object") refuse(configState.link);
  else if (configState === "file") config = read(CONFIG_PATH);

  const records = (directory: string): DataFile[] => {
    const state = inspect(root, directory);
    if (typeof state === "object") {
      refuse(state.link);
      return [];
    }
    if (state !== "directory") return [];
    const found: DataFile[] = [];
    const walk = (relative: string) => {
      const entries = readdirSync(join(root, ...relative.split("/")), { withFileTypes: true });
      for (const entry of entries.sort((a, b) =>
        a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
      )) {
        const child = `${relative}/${entry.name}`;
        if (entry.isSymbolicLink()) refuse(child);
        else if (entry.isDirectory()) walk(child);
        else if (entry.isFile() && isRecordFile(entry.name)) found.push(read(child));
      }
    };
    walk(directory);
    return found;
  };

  const plans = records(PLANS_PATH);
  const roadmaps = records(ROADMAPS_PATH);
  return { config, plans, roadmaps, issues };
}

const fileNameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);

function refused(error: unknown, path: string): RuleIssue[] {
  if (error instanceof StoreError && error.issues.length > 0) return [...error.issues];
  const detail = error instanceof Error ? error.message : String(error);
  return [{ record: path, code: "unreadable", params: { detail }, message: `${path}: ${detail}` }];
}

/** Parses collected files with their schemas; `parseYaml` is the engine's YAML parser. */
export function parseDataFiles(files: DataFiles, parseYaml: (text: string) => unknown): ParsedData {
  const issues = [...files.issues];
  let config: MissionControlConfig | null = null;
  if (!files.config) {
    const refusedOnTheWay = files.issues.some(
      (issue) => CONFIG_PATH === issue.record || CONFIG_PATH.startsWith(`${issue.record}/`),
    );
    if (!refusedOnTheWay) {
      issues.push({
        record: CONFIG_PATH,
        code: "config_missing",
        message: `${CONFIG_PATH} is missing: the data repository has no Mission Control settings`,
      });
    }
  } else {
    try {
      config = parseConfig(JSON.parse(files.config.text), files.config.path);
    } catch (error) {
      issues.push(...refused(error, files.config.path));
    }
  }
  const parse = <T>(
    list: readonly DataFile[],
    parser: (value: unknown, label: string) => T,
  ): ParsedRecord<T>[] =>
    list.flatMap((file) => {
      try {
        return [
          {
            path: file.path,
            fileName: fileNameOf(file.path),
            value: parser(parseYaml(file.text), file.path),
          },
        ];
      } catch (error) {
        issues.push(...refused(error, file.path));
        return [];
      }
    });
  const plans = parse(files.plans, parsePlan);
  const roadmaps = parse(files.roadmaps, parseRoadmap);
  return { config, plans, roadmaps, issues };
}

export function ruleInputOf(data: {
  config: MissionControlConfig;
  plans: readonly ParsedRecord<Plan>[];
  roadmaps: readonly ParsedRecord<Roadmap>[];
}): RuleInput {
  return {
    config: data.config,
    plans: data.plans.map(({ value, fileName }) => ({ value, fileName })),
    roadmaps: data.roadmaps.map(({ value, fileName }) => ({ value, fileName })),
  };
}

/** Every issue of the data: files, schemas and the rules across records. */
export function checkParsedData(data: ParsedData): RuleIssue[] {
  const { config } = data;
  return config ? [...data.issues, ...checkRules(ruleInputOf({ ...data, config }))] : data.issues;
}

export function checkDataFiles(
  files: DataFiles,
  parseYaml: (text: string) => unknown,
): RuleIssue[] {
  return checkParsedData(parseDataFiles(files, parseYaml));
}
