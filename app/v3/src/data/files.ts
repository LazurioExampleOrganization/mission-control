import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import type { MissionControlConfig } from "../domain/config.ts";
import {
  HISTORY_FREEZE_COMMAND,
  HISTORY_SCHEMA_VERSION,
  type HistoryLock,
  historyLock,
} from "../domain/history.ts";
import type { Plan } from "../domain/plan.ts";
import type { Roadmap } from "../domain/roadmap.ts";
import { checkRules, type RuleInput, type RuleIssue } from "../domain/rules.ts";
import { parseConfig, parsePlan, parseRoadmap, schemaIssues } from "./records.ts";
import { StoreError } from "./store.ts";

/**
 * The one way Mission Control reads its data from files and checks it: the
 * same Zod schemas, the same YAML parser, the same rules across records, the
 * same evidence and history checks, whoever asks. The App's data check,
 * `bun run validate` and the data repository's own validator
 * (`templates/data-repo/scripts/`, a bundle of this module) all run this
 * code, so a data pull request passes exactly when the App accepts it.
 *
 * Paths are relative to the data repository's root and use `/`.
 */
export const CONFIG_PATH = "data/mission-control/mission-control.config.json";
export const PLANS_PATH = "data/mission-control/plans";
export const ROADMAPS_PATH = "data/mission-control/roadmaps";
export const HISTORY_LOCK_FILE = "history.lock.json";

/** What a path is, read without following a link anywhere on the way. */
export type PathKind = "missing" | "file" | "directory" | "other" | { link: string };

export interface DirectoryEntry {
  name: string;
  kind: "file" | "directory" | "link" | "other";
}

/**
 * Read-only access to a data repository checkout. Every path is relative to
 * its root; no read follows a symbolic link or leaves the root.
 */
export interface DataReader {
  kind(path: string): PathKind;
  /** The entries of a directory, sorted by name; empty when it is not one. */
  list(path: string): DirectoryEntry[];
  /** The bytes of a regular file, or null. */
  bytes(path: string): Uint8Array | null;
}

/**
 * The checkout at `root` on disk. It checks every component of a path with
 * `lstat`, as repository-db's `assertDataPath` does, opens files with
 * `O_NOFOLLOW` as its `readDataFile` does, and takes names letter for letter:
 * on a file system that ignores case, `Plans/` is not `plans/`, as it would
 * not be on the Linux runner of a pull request.
 */
export function directoryReader(root: string): DataReader {
  const absolute = (path: string) => join(root, ...path.split("/"));
  const names = (directory: string): string[] | null => {
    try {
      return readdirSync(directory);
    } catch {
      return null;
    }
  };
  return {
    kind(path) {
      const parts = path.split("/");
      let parent = root;
      for (let index = 0; index < parts.length; index += 1) {
        const part = parts[index] ?? "";
        const current = join(parent, part);
        let stat: ReturnType<typeof lstatSync>;
        try {
          stat = lstatSync(current);
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === "ENOENT" || code === "ENOTDIR") return "missing";
          throw error;
        }
        if (!names(parent)?.includes(part)) return "missing";
        if (stat.isSymbolicLink()) return { link: parts.slice(0, index + 1).join("/") };
        if (index === parts.length - 1) {
          return stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "other";
        }
        if (!stat.isDirectory()) return "missing";
        parent = current;
      }
      return "missing";
    },
    list(path) {
      let entries: import("node:fs").Dirent[];
      try {
        entries = readdirSync(absolute(path), { withFileTypes: true });
      } catch {
        return [];
      }
      return entries
        .map(
          (entry): DirectoryEntry => ({
            name: entry.name,
            kind: entry.isSymbolicLink()
              ? "link"
              : entry.isDirectory()
                ? "directory"
                : entry.isFile()
                  ? "file"
                  : "other",
          }),
        )
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    },
    bytes(path) {
      let fd: number;
      try {
        fd = openSync(absolute(path), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      } catch {
        return null;
      }
      try {
        return fstatSync(fd).isFile() ? readFileSync(fd) : null;
      } finally {
        closeSync(fd);
      }
    },
  };
}

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

const decoder = new TextDecoder();

/**
 * Reads the Mission Control records of a data repository: the settings and
 * every plan and roadmap. A symbolic link in any component of a path (the
 * `data` directory, a record directory, a record, the settings) is refused as
 * an issue and not read.
 */
export function collectDataFiles(reader: DataReader): DataFiles {
  const issues: RuleIssue[] = [];
  // A link high up (`data`) lies on the way to every file; it is named once.
  const refuse = (path: string) => {
    if (!issues.some((issue) => issue.record === path)) issues.push(linkRefused(path));
  };
  const read = (path: string): DataFile[] => {
    const bytes = reader.bytes(path);
    return bytes ? [{ path, text: decoder.decode(bytes) }] : [];
  };

  let config: DataFile | null = null;
  const configKind = reader.kind(CONFIG_PATH);
  if (typeof configKind === "object") refuse(configKind.link);
  else if (configKind === "file") config = read(CONFIG_PATH)[0] ?? null;

  const records = (directory: string): DataFile[] => {
    const kind = reader.kind(directory);
    if (typeof kind === "object") {
      refuse(kind.link);
      return [];
    }
    if (kind !== "directory") return [];
    const found: DataFile[] = [];
    const walk = (path: string) => {
      for (const entry of reader.list(path)) {
        const child = `${path}/${entry.name}`;
        if (entry.kind === "link") refuse(child);
        else if (entry.kind === "directory") walk(child);
        else if (entry.kind === "file" && isRecordFile(entry.name)) found.push(...read(child));
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

/**
 * Where Git or repository-db keep files out of a commit: Git's own metadata,
 * the engine's local state and its derived output. Evidence there would not
 * reach anyone else.
 */
const UNPUBLISHED = [".git", ".repository-db", "generated"];

/**
 * Every local evidence of the roadmaps names a file the data repository
 * publishes: it exists, is a regular file, is reached only through real
 * directories, and lies outside `UNPUBLISHED`. (That the path is portable and
 * relative is the Zod schema's rule.)
 *
 * Mission Control 3.x also required the file to be tracked or staged by Git.
 * repository-db runs the validator before it stages a publish, so evidence
 * added in the same draft is neither; and in the checkout of a pull request
 * every file present is tracked. What would not reach others is a file Git
 * ignores, and in a Mission Control data repository that is what
 * `UNPUBLISHED` names.
 */
export function checkEvidence(
  reader: DataReader,
  roadmaps: readonly ParsedRecord<Roadmap>[],
): RuleIssue[] {
  const issues: RuleIssue[] = [];
  for (const { value } of roadmaps) {
    const record = value.roadmap_code;
    for (const step of value.steps) {
      for (const evidence of step.evidence_refs ?? []) {
        if (!("path" in evidence)) continue;
        const path = evidence.path;
        const params = { step: step.id, path };
        const first = (path.split("/")[0] ?? "").toLowerCase();
        if (UNPUBLISHED.includes(first)) {
          issues.push({
            record,
            code: "evidence_excluded",
            params,
            message: `${step.id}: the evidence ${path} lies in ${first}/, which is never published`,
          });
          continue;
        }
        const kind = reader.kind(path);
        if (typeof kind === "object") {
          issues.push({
            record,
            code: "evidence_link",
            params: { ...params, link: kind.link },
            message: `${step.id}: the evidence ${path} is reached through the symbolic link ${kind.link}`,
          });
        } else if (kind === "missing") {
          issues.push({
            record,
            code: "evidence_missing",
            params,
            message: `${step.id}: the evidence ${path} does not exist in the data repository (names are case-sensitive)`,
          });
        } else if (kind !== "file") {
          issues.push({
            record,
            code: "evidence_not_file",
            params,
            message: `${step.id}: the evidence ${path} is not a file`,
          });
        }
      }
    }
  }
  return issues;
}

/** The digest of a file's content with every CRLF read as LF, as the lock records it. */
export function historyDigestOf(bytes: Uint8Array): string {
  const normalized = new Uint8Array(bytes.length);
  let length = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] === 13 && bytes[index + 1] === 10) continue;
    normalized[length] = bytes[index] ?? 0;
    length += 1;
  }
  return `sha256:${createHash("sha256").update(normalized.subarray(0, length)).digest("hex")}`;
}

interface HistoryFiles {
  files: Map<string, string>;
  issues: RuleIssue[];
}

/**
 * The files of the frozen history with their digests: everything under
 * `<data>/mission-control/` except what Mission Control 4.x reads (the
 * settings, `plans/`, `roadmaps/`) and the lock itself. That is the 3.x
 * ledgers, changesets, import reviews and reports, and anything else placed
 * there, so a new file is never let in unnoticed.
 */
function historyFiles(reader: DataReader, dataDir: string): HistoryFiles {
  const root = `${dataDir}/mission-control`;
  const files = new Map<string, string>();
  const issues: RuleIssue[] = [];
  if (reader.kind(root) !== "directory") return { files, issues };
  const skip = new Set(["mission-control.config.json", HISTORY_LOCK_FILE, "plans", "roadmaps"]);
  const walk = (path: string, top: boolean) => {
    for (const entry of reader.list(path)) {
      if (top && skip.has(entry.name)) continue;
      const child = `${path}/${entry.name}`;
      if (entry.kind === "link") issues.push(linkRefused(child));
      else if (entry.kind === "directory") walk(child, false);
      else if (entry.kind === "file") {
        const bytes = reader.bytes(child);
        if (bytes) files.set(child, historyDigestOf(bytes));
      }
    }
  };
  walk(root, true);
  return { files, issues };
}

const lockPathOf = (dataDir: string) => `${dataDir}/mission-control/${HISTORY_LOCK_FILE}`;

function readLock(
  reader: DataReader,
  dataDir: string,
): { lock: HistoryLock | null; issues: RuleIssue[] } {
  const path = lockPathOf(dataDir);
  const kind = reader.kind(path);
  if (typeof kind === "object") return { lock: null, issues: [linkRefused(kind.link)] };
  if (kind === "missing") return { lock: null, issues: [] };
  const bytes = reader.bytes(path);
  let raw: unknown;
  try {
    raw = JSON.parse(decoder.decode(bytes ?? new Uint8Array()));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      lock: null,
      issues: [
        {
          record: path,
          code: "history_lock_invalid",
          params: { detail },
          message: `${path} is not valid JSON: ${detail}`,
        },
      ],
    };
  }
  const parsed = historyLock.safeParse(raw);
  if (!parsed.success) return { lock: null, issues: schemaIssues(parsed.error, path) };
  const area = `${dataDir}/mission-control/`;
  const outside = Object.keys(parsed.data.files).filter((file) => {
    if (!file.startsWith(area)) return true;
    const first = file.slice(area.length).split("/")[0] ?? "";
    return ["mission-control.config.json", HISTORY_LOCK_FILE, "plans", "roadmaps"].includes(first);
  });
  if (outside.length > 0) {
    return {
      lock: null,
      issues: outside.map((file) => ({
        record: path,
        code: "history_lock_invalid" as const,
        params: { detail: file },
        message: `${path} names ${file}, which is not part of the history (only files under ${area} other than the settings, plans/ and roadmaps/)`,
      })),
    };
  }
  return { lock: parsed.data, issues: [] };
}

/**
 * The history is as frozen: every file of `historyFiles` is in the lock with
 * the same digest, and every file of the lock is there. Without a lock the
 * frozen history is empty.
 */
export function checkHistory(reader: DataReader, dataDir = "data"): RuleIssue[] {
  const { lock, issues } = readLock(reader, dataDir);
  if (issues.length > 0) return issues;
  const current = historyFiles(reader, dataDir);
  const frozen = new Map(Object.entries(lock?.files ?? {}));
  const found: RuleIssue[] = [...current.issues];
  const refused = new Set(current.issues.map((issue) => issue.record));
  const lockPath = lockPathOf(dataDir);
  for (const [path, digest] of current.files) {
    const expected = frozen.get(path);
    if (expected === undefined) {
      found.push({
        record: path,
        code: "history_added",
        params: { path },
        message: lock
          ? `not part of the frozen history (${lockPath}); Mission Control 4.x writes nothing there`
          : `not part of a frozen history: there is no ${lockPath}. Freeze the 3.x history once with \`${HISTORY_FREEZE_COMMAND}\``,
      });
    } else if (expected !== digest) {
      found.push({
        record: path,
        code: "history_changed",
        params: { path },
        message: `changed since the history was frozen (${lockPath})`,
      });
    }
  }
  for (const path of frozen.keys()) {
    const onTheWay = [...refused].some((link) => path === link || path.startsWith(`${link}/`));
    if (!current.files.has(path) && !onTheWay) {
      found.push({
        record: path,
        code: "history_removed",
        params: { path },
        message: `part of the frozen history (${lockPath}) but gone`,
      });
    }
  }
  return found;
}

/**
 * A new lock of the history as it is now, or the issues that stop a freeze
 * (a symbolic link in the history). `previous` says what the freeze changes.
 */
export function freezeHistory(
  reader: DataReader,
  dataDir = "data",
): {
  path: string;
  text: string;
  count: number;
  changes: { added: string[]; changed: string[]; removed: string[] };
  issues: RuleIssue[];
} {
  const path = lockPathOf(dataDir);
  const current = historyFiles(reader, dataDir);
  const lockKind = reader.kind(path);
  const issues = [
    ...current.issues,
    ...(typeof lockKind === "object" ? [linkRefused(lockKind.link)] : []),
  ];
  const before = readLock(reader, dataDir).lock?.files ?? {};
  const sorted = [...current.files.keys()].sort();
  const lock: HistoryLock = {
    schema_version: HISTORY_SCHEMA_VERSION,
    generated_by: HISTORY_FREEZE_COMMAND,
    files: Object.fromEntries(sorted.map((file) => [file, current.files.get(file) ?? ""])),
  };
  return {
    path,
    text: `${JSON.stringify(lock, null, 2)}\n`,
    count: sorted.length,
    changes: {
      added: sorted.filter((file) => !(file in before)),
      changed: sorted.filter((file) => file in before && before[file] !== current.files.get(file)),
      removed: Object.keys(before).filter((file) => !current.files.has(file)),
    },
    issues,
  };
}

/** Each issue once: a link on the way is found by more than one check. */
function distinct(issues: readonly RuleIssue[]): RuleIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.record}\u0000${issue.code}\u0000${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Every issue of a data repository checkout: the records (files, schemas,
 * rules across records), their evidence and the frozen history.
 */
export function checkData(reader: DataReader, parsed: ParsedData, dataDir = "data"): RuleIssue[] {
  return distinct([
    ...checkParsedData(parsed),
    ...checkEvidence(reader, parsed.roadmaps),
    ...checkHistory(reader, dataDir),
  ]);
}

export function checkDataFiles(
  reader: DataReader,
  parseYaml: (text: string) => unknown,
): RuleIssue[] {
  return checkData(reader, parseDataFiles(collectDataFiles(reader), parseYaml));
}
