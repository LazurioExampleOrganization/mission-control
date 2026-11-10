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
import { join, resolve } from "node:path";
import type { MissionControlConfig } from "../domain/config.ts";
import {
  decide,
  type IgnoreDecision,
  type IgnoreLevel,
  parseIgnoreFile,
} from "../domain/gitignore.ts";
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

/**
 * What a path is, read without following a link anywhere on the way. A path
 * that cannot be inspected (a directory on the way that may not be read) is
 * `unreadable`, never taken for missing.
 */
export type PathKind =
  | "missing"
  | "file"
  | "directory"
  | "other"
  | { link: string }
  | { unreadable: string; detail: string };

export interface DirectoryEntry {
  name: string;
  kind: "file" | "directory" | "link" | "other";
}

/** A read or listing that failed: `detail` is the system's error code. */
export interface ReadFailure {
  failed: string;
}

export const isReadFailure = (value: unknown): value is ReadFailure =>
  typeof value === "object" && value !== null && "failed" in value;

/**
 * Read-only access to a data repository checkout. Every path is relative to
 * its root; no read follows a symbolic link or leaves the root. A failure is
 * returned, never swallowed: the check reports it, because a check that could
 * not read a file has not checked it.
 */
export interface DataReader {
  kind(path: string): PathKind;
  /** The entries of a directory, sorted by name, or why it could not be listed. */
  list(path: string): DirectoryEntry[] | ReadFailure;
  /** The bytes of a regular file; null when it is gone or not a file; or why it could not be read. */
  bytes(path: string): Uint8Array | null | ReadFailure;
  /**
   * The checkout's own exclude file, `info/exclude` of its Git directory
   * (`.git/`, or the common directory of a linked worktree): null when there
   * is none. It holds ignore rules of this checkout only, which `git add
   * --all` honours when repository-db publishes from it.
   */
  gitInfoExclude?(): string | null | ReadFailure;
}

/** How a check names the exclude file in messages, wherever the Git directory is. */
export const GIT_INFO_EXCLUDE = ".git/info/exclude";

const failure = (error: unknown): ReadFailure => ({
  failed: (error as NodeJS.ErrnoException)?.code ?? (error instanceof Error ? error.name : "error"),
});

/**
 * The checkout at `root` on disk. It checks every component of a path with
 * `lstat`, as repository-db's `assertDataPath` does, opens files with
 * `O_NOFOLLOW` as its `readDataFile` does, and takes names letter for letter:
 * on a file system that ignores case, `Plans/` is not `plans/`, as it would
 * not be on the Linux runner of a pull request.
 */
export function directoryReader(root: string): DataReader {
  const absolute = (path: string) => join(root, ...path.split("/"));
  return {
    kind(path) {
      const parts = path.split("/");
      let parent = root;
      for (let index = 0; index < parts.length; index += 1) {
        const part = parts[index] ?? "";
        const here = parts.slice(0, index + 1).join("/");
        const current = join(parent, part);
        let stat: ReturnType<typeof lstatSync>;
        try {
          stat = lstatSync(current);
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === "ENOENT" || code === "ENOTDIR") return "missing";
          return {
            unreadable: index === 0 ? "." : parts.slice(0, index).join("/"),
            detail: failure(error).failed,
          };
        }
        let names: string[];
        try {
          names = readdirSync(parent);
        } catch (error) {
          return {
            unreadable: index === 0 ? "." : parts.slice(0, index).join("/"),
            detail: failure(error).failed,
          };
        }
        if (!names.includes(part)) return "missing";
        if (stat.isSymbolicLink()) return { link: here };
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
      } catch (error) {
        return failure(error);
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
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        return code === "ENOENT" || code === "ENOTDIR" ? null : failure(error);
      }
      try {
        return fstatSync(fd).isFile() ? readFileSync(fd) : null;
      } catch (error) {
        return failure(error);
      } finally {
        closeSync(fd);
      }
    },
    gitInfoExclude() {
      // Git metadata, read as Git reads it: `.git` is the Git directory, or a
      // file naming it (`gitdir: …`) for a linked worktree, whose shared files
      // are in the directory its `commondir` names. Nothing here is data.
      const read = (path: string): string | null | ReadFailure => {
        try {
          return readFileSync(path, "utf8");
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          return code === "ENOENT" || code === "ENOTDIR" ? null : failure(error);
        }
      };
      const dotGit = join(root, ".git");
      let stat: ReturnType<typeof lstatSync>;
      try {
        stat = lstatSync(dotGit);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        return code === "ENOENT" ? null : failure(error);
      }
      let gitDir: string;
      if (stat.isDirectory()) gitDir = dotGit;
      else if (stat.isFile()) {
        const pointer = read(dotGit);
        if (pointer === null || isReadFailure(pointer)) return pointer;
        const match = /^gitdir:\s*(.+?)\s*$/m.exec(pointer);
        if (!match?.[1]) return null;
        gitDir = resolve(root, match[1]);
      } else return { failed: stat.isSymbolicLink() ? "symbolic link" : "not a directory" };
      const commonDir = read(join(gitDir, "commondir"));
      if (isReadFailure(commonDir)) return commonDir;
      const common = commonDir?.trim() ? resolve(gitDir, commonDir.trim()) : gitDir;
      return read(join(common, "info", "exclude"));
    },
  };
}

export interface DataFile {
  path: string;
  text: string;
}

export interface DataFiles {
  /** Where the settings are looked for (`<data>/mission-control/mission-control.config.json`). */
  configPath: string;
  config: DataFile | null;
  plans: DataFile[];
  roadmaps: DataFile[];
  /** Paths refused or not readable while collecting. */
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

/** A file or directory the check could not read, so did not check. */
export function readFailed(path: string, detail: string): RuleIssue {
  return {
    record: path,
    code: "read_failed",
    params: { path, detail },
    message: `cannot be read (${detail}); the check could not cover it`,
  };
}

/** The issue a path's kind raises on the way, or null when it can be read. */
function wayIssue(kind: PathKind): RuleIssue | null {
  if (typeof kind !== "object") return null;
  return "link" in kind ? linkRefused(kind.link) : readFailed(kind.unreadable, kind.detail);
}

const decoder = new TextDecoder();

/** Paths of a data repository whose data directory is `dataDir` (the engine's layout). */
export const missionControlPaths = (dataDir = "data") => ({
  root: `${dataDir}/mission-control`,
  config: `${dataDir}/mission-control/mission-control.config.json`,
  plans: `${dataDir}/mission-control/plans`,
  roadmaps: `${dataDir}/mission-control/roadmaps`,
  lock: `${dataDir}/mission-control/${HISTORY_LOCK_FILE}`,
});

/**
 * Reads the Mission Control records of a data repository: the settings and
 * every plan and roadmap. A symbolic link in any component of a path (the
 * `data` directory, a record directory, a record, the settings) is refused,
 * and a file or directory that cannot be read is reported; neither is skipped
 * silently.
 */
export function collectDataFiles(reader: DataReader, dataDir = "data"): DataFiles {
  const paths = missionControlPaths(dataDir);
  const issues: RuleIssue[] = [];
  // A link or an unreadable directory high up (`data`) lies on the way to
  // every file; it is named once.
  const report = (issue: RuleIssue | null) => {
    if (issue && !issues.some((known) => known.record === issue.record)) issues.push(issue);
  };
  const read = (path: string): DataFile[] => {
    const bytes = reader.bytes(path);
    if (isReadFailure(bytes)) {
      report(readFailed(path, bytes.failed));
      return [];
    }
    return bytes ? [{ path, text: decoder.decode(bytes) }] : [];
  };

  let config: DataFile | null = null;
  const configKind = reader.kind(paths.config);
  report(wayIssue(configKind));
  if (configKind === "file") config = read(paths.config)[0] ?? null;
  else if (configKind === "directory" || configKind === "other") {
    report(readFailed(paths.config, "not a file"));
  }

  const records = (directory: string): DataFile[] => {
    const kind = reader.kind(directory);
    report(wayIssue(kind));
    if (kind !== "directory") return [];
    const found: DataFile[] = [];
    const walk = (path: string) => {
      const entries = reader.list(path);
      if (isReadFailure(entries)) {
        report(readFailed(path, entries.failed));
        return;
      }
      for (const entry of entries) {
        const child = `${path}/${entry.name}`;
        if (entry.kind === "link") report(linkRefused(child));
        else if (entry.kind === "directory") walk(child);
        else if (entry.kind === "file" && isRecordFile(entry.name)) found.push(...read(child));
      }
    };
    walk(directory);
    return found;
  };

  const plans = records(paths.plans);
  const roadmaps = records(paths.roadmaps);
  return { configPath: paths.config, config, plans, roadmaps, issues };
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
    const path = files.configPath;
    const refusedOnTheWay = files.issues.some(
      (issue) => path === issue.record || path.startsWith(`${issue.record}/`),
    );
    if (!refusedOnTheWay) {
      issues.push({
        record: path,
        code: "config_missing",
        message: `${path} is missing: the data repository has no Mission Control settings`,
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
 * Git's ignore rules for paths of the checkout, read through the reader: the
 * `.gitignore` of the root and of every directory on a path, and
 * `.git/info/exclude`. A rule file that is a symbolic link or cannot be read
 * is an issue, and the decision then is not trusted (the evidence is not
 * passed silently). Rule files are read once per check.
 */
export class IgnoreRules {
  private readonly files = new Map<string, IgnoreLevel | null>();
  private exclude: IgnoreLevel | null | undefined;
  readonly issues: RuleIssue[] = [];

  constructor(private readonly reader: DataReader) {}

  private report(issue: RuleIssue) {
    if (!this.issues.some((known) => known.record === issue.record && known.code === issue.code)) {
      this.issues.push(issue);
    }
  }

  /** The `.gitignore` of a directory ("" for the root), or null when it has none. */
  private level(directory: string): IgnoreLevel | null {
    const known = this.files.get(directory);
    if (known !== undefined) return known;
    const path = directory === "" ? ".gitignore" : `${directory}/.gitignore`;
    let level: IgnoreLevel | null = null;
    const kind = this.reader.kind(path);
    const way = wayIssue(kind);
    if (way) this.report(way);
    else if (kind === "file") {
      const bytes = this.reader.bytes(path);
      if (isReadFailure(bytes)) this.report(readFailed(path, bytes.failed));
      else if (bytes) level = { base: directory, rules: parseIgnoreFile(bytes, path) };
    }
    this.files.set(directory, level);
    return level;
  }

  private infoExclude(): IgnoreLevel | null {
    if (this.exclude !== undefined) return this.exclude;
    const text = this.reader.gitInfoExclude?.() ?? null;
    if (isReadFailure(text)) {
      this.report(readFailed(GIT_INFO_EXCLUDE, text.failed));
      this.exclude = null;
    } else {
      this.exclude =
        text === null ? null : { base: "", rules: parseIgnoreFile(text, GIT_INFO_EXCLUDE) };
    }
    return this.exclude;
  }

  /**
   * Git's decision for a file, in two views, each with the rule that decides:
   *
   * - `local`: what `git add --all` does in this checkout, with every rule
   *   file on the path (Git reads a `.gitignore` even when it ignores the
   *   file itself) and `.git/info/exclude`;
   * - `published`: what this same check decides on the checkout of the
   *   published commit, with only the rule files that commit carries.
   *
   * A nested `.gitignore` that the rules leave out (`local`, or `published`
   * above it) is not in the published commit, so it does not count there;
   * those are listed in `unpublished`. The root `.gitignore` always counts:
   * no shallower rule file can be cancelled by it, so leaving it out could
   * only make the published view ignore less. `.git/info/exclude` belongs to
   * this checkout alone and counts only in `local`; its rules come after
   * every `.gitignore` and can only add exclusions. So a file neither view
   * ignores is staged here and passes on the published checkout too.
   */
  explain(path: string): {
    local: IgnoreDecision | null;
    published: IgnoreDecision | null;
    unpublished: string[];
  } {
    const parts = path.split("/");
    const local: IgnoreLevel[] = [];
    const published: IgnoreLevel[] = [];
    const unpublished: string[] = [];
    const withExclude = (levels: IgnoreLevel[]) => {
      const exclude = this.infoExclude();
      return exclude ? [...levels, exclude] : levels;
    };
    const ignoredIn = (levels: IgnoreLevel[], target: string, isDirectory: boolean) => {
      const decision = decide(levels, target, isDirectory);
      return decision?.ignored ? decision : null;
    };
    const enter = (directory: string, publishedExcluded = false) => {
      const level = this.level(directory);
      if (!level) return;
      local.unshift(level);
      // Below a directory the published view excludes, it decides nothing more.
      if (publishedExcluded) return;
      const rules = directory === "" ? ".gitignore" : `${directory}/.gitignore`;
      // A rule file applies to itself.
      const leftOut =
        directory !== "" &&
        (ignoredIn(withExclude(local), rules, false) ||
          ignoredIn([level, ...published], rules, false));
      if (leftOut) unpublished.push(rules);
      else published.unshift(level);
    };
    // The two views walk the path on their own: Git does not look into a
    // directory its view excludes, nor read the rules there, and the other
    // view goes on.
    let publishedDirectory: IgnoreDecision | null = null;
    enter("");
    for (let index = 0; index < parts.length - 1; index += 1) {
      const directory = parts.slice(0, index + 1).join("/");
      const localDirectory = ignoredIn(withExclude(local), directory, true);
      if (localDirectory) {
        return { local: localDirectory, published: publishedDirectory, unpublished };
      }
      publishedDirectory ??= ignoredIn(published, directory, true);
      enter(directory, publishedDirectory !== null);
    }
    return {
      local: ignoredIn(withExclude(local), path, false),
      published: publishedDirectory ?? ignoredIn(published, path, false),
      unpublished,
    };
  }

  /**
   * Whether the file is left out in either view of `explain`: by `git add
   * --all` here, or by this check on the published checkout. Null when
   * neither leaves it out, or when a rule file on the way could not be read
   * (that is an issue of its own).
   */
  ignoredFile(path: string): { decision: IgnoreDecision; unpublished: string[] } | null {
    const before = this.issues.length;
    const view = this.explain(path);
    if (this.issues.length > before) return null;
    const decision = view.local ?? view.published;
    return decision ? { decision, unpublished: view.local ? [] : view.unpublished } : null;
  }
}

/**
 * Every local evidence of the roadmaps names a file the data repository
 * publishes: it exists, is a regular file, is reached only through real
 * directories, lies outside `UNPUBLISHED`, and Git's ignore rules do not
 * leave it out (`.gitignore` files on its path and `.git/info/exclude`).
 * (That the path is portable and relative is the Zod schema's rule.)
 *
 * Mission Control 3.x required the file to be tracked or staged by Git.
 * repository-db runs the validator before it stages a publish, so evidence
 * added in the same draft is neither; and in the checkout of a pull request
 * every file present is tracked. What would not reach others is a file
 * `git add --all` leaves out, and that is what the ignore rules decide. They
 * are read from the checkout, not asked of Git, so the App, the validator
 * before a publish and CI give one answer. A file once force-added despite a
 * rule is refused too: make the rule explicit with a `!` pattern instead.
 */
export function checkEvidence(
  reader: DataReader,
  roadmaps: readonly ParsedRecord<Roadmap>[],
): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const ignore = new IgnoreRules(reader);
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
        if (typeof kind === "object" && "unreadable" in kind) {
          // The check could not look; that is not the evidence's fault, and
          // it is not a pass either.
          issues.push(readFailed(kind.unreadable, kind.detail));
        } else if (typeof kind === "object") {
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
        } else {
          const ignored = ignore.ignoredFile(path);
          if (ignored) {
            const { decision, unpublished } = ignored;
            const { pattern, source } = decision.rule;
            const what = decision.path === path ? "" : ` (its directory ${decision.path})`;
            const why =
              unpublished.length > 0
                ? `; ${unpublished.join(", ")}, which would let it in here, is itself left out of the commit`
                : "";
            issues.push({
              record,
              code: "evidence_ignored",
              params: {
                ...params,
                pattern,
                source,
                ignored: decision.path,
                ...(unpublished.length > 0 ? { unpublished: unpublished.join(", ") } : {}),
              },
              message: `${step.id}: the evidence ${path}${what} is left out of the published commit by the rule ${pattern} in ${source}${why}`,
            });
          }
        }
      }
    }
  }
  return [...issues, ...ignore.issues];
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
  const kind = reader.kind(root);
  const way = wayIssue(kind);
  if (way) issues.push(way);
  if (kind !== "directory") return { files, issues };
  const skip = new Set(["mission-control.config.json", HISTORY_LOCK_FILE, "plans", "roadmaps"]);
  const walk = (path: string, top: boolean) => {
    const entries = reader.list(path);
    if (isReadFailure(entries)) {
      issues.push(readFailed(path, entries.failed));
      return;
    }
    for (const entry of entries) {
      if (top && skip.has(entry.name)) continue;
      const child = `${path}/${entry.name}`;
      if (entry.kind === "link") issues.push(linkRefused(child));
      else if (entry.kind === "directory") walk(child, false);
      else if (entry.kind === "file") {
        const bytes = reader.bytes(child);
        if (isReadFailure(bytes)) issues.push(readFailed(child, bytes.failed));
        else if (bytes) files.set(child, historyDigestOf(bytes));
        else issues.push(readFailed(child, "gone while read"));
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
  const way = wayIssue(kind);
  if (way) return { lock: null, issues: [way] };
  if (kind === "missing") return { lock: null, issues: [] };
  const bytes = kind === "file" ? reader.bytes(path) : null;
  if (isReadFailure(bytes)) return { lock: null, issues: [readFailed(path, bytes.failed)] };
  if (!bytes) return { lock: null, issues: [readFailed(path, "not a file")] };
  let raw: unknown;
  try {
    raw = JSON.parse(decoder.decode(bytes));
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
    // A file under a link or an unreadable directory was not looked at: it is
    // reported there, not as removed.
    const onTheWay = [...refused].some(
      (blocked) => blocked === "." || path === blocked || path.startsWith(`${blocked}/`),
    );
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
 * A new lock of the history as it is now, or the issues that stop a freeze:
 * a symbolic link, or any file or directory of the history (or the lock) that
 * cannot be read. A freeze never writes a lock that leaves out what it could
 * not read. `changes` says what the freeze changes against the previous lock.
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
  const previous = readLock(reader, dataDir);
  // An invalid previous lock is what a freeze replaces; a lock that cannot be
  // read or written is not.
  const issues = distinct([
    ...current.issues,
    ...previous.issues.filter(
      (issue) => issue.code === "link_refused" || issue.code === "read_failed",
    ),
  ]);
  const before = previous.lock?.files ?? {};
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
