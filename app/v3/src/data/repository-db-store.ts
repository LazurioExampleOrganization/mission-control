import { posix } from "node:path";
import {
  assertDataPath,
  createSyncHost,
  type DraftPanelRecordInput,
  parseYaml,
  type RepositoryDb,
  RepositoryDbError,
  recordRevisionFromBytes,
  type SyncHost,
  toStableYaml,
  writeFileAtomic,
  writeRecordDraft,
} from "@lazurio/repository-db";
import type { MissionControlConfig } from "../domain/config.ts";
import { comparePlans, type Plan } from "../domain/plan.ts";
import type { Roadmap } from "../domain/roadmap.ts";
import type { RuleIssue } from "../domain/rules.ts";
import { DEFAULT_LOCALE } from "../i18n/locale.ts";
import {
  checkData,
  checkEvidence,
  collectDataFiles,
  directoryReader,
  missionControlPaths,
  type ParsedData,
  parseDataFiles,
  ruleInputOf,
} from "./files.ts";
import { assertRulesFor, parsePlan, parseRoadmap, recordFileName } from "./records.ts";
import { reviewAdapter } from "./review-adapter.ts";
import type {
  DiscardScope,
  DraftCard,
  MissionControlStore,
  Revision,
  Stored,
  StoreEvent,
} from "./store.ts";
import { StoreError } from "./store.ts";

/** `Repository-Db-Source` of every publish from this App. */
const SOURCE = "mission-control-v3";

export interface RepositoryDbStoreOptions {
  /** The data checkout, the Module's `db/`. It may not exist yet. */
  mountRoot: string;
  /** The data repository this App serves; another one is refused. */
  expect?: { remote: string; branch: string; within?: string };
  /** Background fetch cadence; `0` runs no timer (tests). */
  intervalMs?: number;
}

interface FileRecord<T> {
  path: string;
  value: T;
  revision: Revision;
}

interface Snapshot {
  config: MissionControlConfig;
  plans: FileRecord<Plan>[];
  roadmaps: FileRecord<Roadmap>[];
  /** The parsed data as the shared check sees it (`files.ts`). */
  parsed: ParsedData;
}

/**
 * Mission Control's storage over repository-db v3.
 *
 * The records keep the layout every v3 data repository already has:
 * `data/mission-control/plans/<year>/<month>/<CODE>-<slug>.yaml` and
 * `data/mission-control/roadmaps/<year>/<CODE>-<slug>.yaml`. Every read goes
 * through the sync host's `read`, every write through its queue (`run`) and
 * the engine's `writeRecordDraft`, so the App never runs Git on its data.
 */
export function createRepositoryDbStore(options: RepositoryDbStoreOptions): MissionControlStore {
  const { mountRoot } = options;
  const host: SyncHost = createSyncHost({
    mountRoot,
    intervalMs: options.intervalMs ?? 30_000,
    ...(options.expect ? { expect: options.expect } : {}),
    recordOf: (path, collectionRecord) => {
      const match = /\/(plans|roadmaps)\/(?:.+\/)?([A-Z]{2,6}-[0-9]{4})[^/]*\.yaml$/.exec(path);
      if (match?.[1] && match[2]) return { collection: match[1], id: match[2] };
      return collectionRecord;
    },
  });
  if ((options.intervalMs ?? 30_000) > 0) host.start();

  /**
   * The checkout as the shared check of `files.ts` reads it, for the records,
   * their evidence and the frozen history alike: every component checked,
   * no link followed, as the engine's own reads, and a file or directory that
   * cannot be read reported as an issue rather than skipped. Used only inside
   * the sync host's `read` and `run`.
   */
  const reader = directoryReader(mountRoot);
  const pathsOf = (db: RepositoryDb) => missionControlPaths(db.config.layout.data);

  const revisionOf = (text: string): Revision => recordRevisionFromBytes(Buffer.from(text, "utf8"));

  /**
   * Every record of the checkout, read and parsed by the same code as the
   * data repository's validator.
   */
  function snapshot(db: RepositoryDb): Snapshot {
    const files = collectDataFiles(reader, db.config.layout.data);
    const { plans, roadmaps } = files;
    const parsed = parseDataFiles(files, parseYaml);
    if (!parsed.config) {
      const blocked = parsed.issues.filter(
        (issue) =>
          issue.code !== "config_missing" &&
          (issue.record === files.configPath || files.configPath.startsWith(`${issue.record}/`)),
      );
      if (blocked.length === 0) {
        throw new StoreError(
          "config_missing",
          `${files.configPath} is missing: the data repository has no Mission Control settings yet.`,
        );
      }
      throw new StoreError(
        "invalid_record",
        `${files.configPath}: ${blocked.map((issue) => `${issue.record}: ${issue.message}`).join("; ")}`,
        blocked,
      );
    }
    const texts = new Map([...plans, ...roadmaps].map((file) => [file.path, file.text]));
    const stored = <T>(entry: { path: string; value: T }): FileRecord<T> => ({
      path: entry.path,
      value: entry.value,
      revision: revisionOf(texts.get(entry.path) ?? ""),
    });
    return {
      config: parsed.config,
      plans: parsed.plans.map(stored).sort((left, right) => comparePlans(left.value, right.value)),
      roadmaps: parsed.roadmaps
        .map(stored)
        .sort((left, right) => left.value.roadmap_code.localeCompare(right.value.roadmap_code)),
      parsed,
    };
  }

  const ruleInput = (data: Snapshot) =>
    ruleInputOf({
      config: data.config,
      plans: data.plans.map((entry) => ({ ...entry, fileName: posix.basename(entry.path) })),
      roadmaps: data.roadmaps.map((entry) => ({ ...entry, fileName: posix.basename(entry.path) })),
    });

  function writeRecord<T>(
    db: RepositoryDb,
    path: string,
    value: T,
    baseRevision: Revision | null,
  ): Revision {
    const text = toStableYaml(value);
    const absolute = assertDataPath(mountRoot, path);
    writeRecordDraft(mountRoot, absolute, { baseRevision }, () => {
      writeFileAtomic(assertDataPath(mountRoot, path), text);
    });
    db.recordOrigin([path], { kind: "app", source: SOURCE });
    return recordRevisionFromBytes(Buffer.from(text, "utf8"));
  }

  function save<T>(
    kind: "plan" | "roadmap",
    code: string,
    value: T,
    baseRevision: Revision | null,
    newPath: (db: RepositoryDb) => string,
    replace: (data: Snapshot, path: string) => void,
    files: (path: string) => RuleIssue[] = () => [],
  ): Promise<Stored<T>> {
    return engine(() =>
      host.run(`save-${kind}`, (db) => {
        const data = snapshot(db);
        const existing = (kind === "plan" ? data.plans : data.roadmaps).find((entry) =>
          kind === "plan"
            ? (entry.value as Plan).dev_code === code
            : (entry.value as Roadmap).roadmap_code === code,
        );
        if (baseRevision === null && existing) {
          throw new StoreError("record_changed", `${code} already exists.`);
        }
        if (baseRevision !== null && !existing) {
          throw new StoreError("record_changed", `${code} no longer exists.`);
        }
        const path = existing?.path ?? newPath(db);
        replace(data, path);
        assertRulesFor(code, ruleInput(data));
        const refused = files(path);
        if (refused.length > 0) {
          throw new StoreError(
            "invalid_record",
            `${code}: ${refused.map((issue) => issue.message).join("; ")}`,
            refused,
          );
        }
        const revision = writeRecord(db, path, value, baseRevision);
        return { value, revision };
      }),
    );
  }

  return {
    async available() {
      try {
        await host.read(() => true);
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          code: error instanceof RepositoryDbError ? error.code : "mount_unavailable",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
    config: () => engine(() => host.read((db) => snapshot(db).config)),
    listPlans: () =>
      engine(() =>
        host.read((db) => snapshot(db).plans.map(({ value, revision }) => ({ value, revision }))),
      ),
    getPlan: (code) =>
      engine(() =>
        host.read((db) => {
          const found = snapshot(db).plans.find((entry) => entry.value.dev_code === code);
          return found ? { value: found.value, revision: found.revision } : null;
        }),
      ),
    savePlan: async (input, baseRevision) => {
      const value = parsePlan(input, input.dev_code);
      return save(
        "plan",
        value.dev_code,
        value,
        baseRevision,
        (db) => {
          const [year, month] = value.created_at.split("-");
          return `${pathsOf(db).plans}/${year}/${month}/${recordFileName(value.dev_code, value.title)}`;
        },
        (data, path) => {
          data.plans = [
            ...data.plans.filter((entry) => entry.path !== path),
            { path, value, revision: "" },
          ];
        },
      );
    },
    listRoadmaps: () =>
      engine(() =>
        host.read((db) =>
          snapshot(db).roadmaps.map(({ value, revision }) => ({ value, revision })),
        ),
      ),
    getRoadmap: (code) =>
      engine(() =>
        host.read((db) => {
          const found = snapshot(db).roadmaps.find((entry) => entry.value.roadmap_code === code);
          return found ? { value: found.value, revision: found.revision } : null;
        }),
      ),
    saveRoadmap: async (input, baseRevision) => {
      const value = parseRoadmap(input, input.roadmap_code);
      return save(
        "roadmap",
        value.roadmap_code,
        value,
        baseRevision,
        (db) => {
          const [year] = value.created_at.split("-");
          return `${pathsOf(db).roadmaps}/${year}/${recordFileName(value.roadmap_code, value.title)}`;
        },
        (data, path) => {
          data.roadmaps = [
            ...data.roadmaps.filter((entry) => entry.path !== path),
            { path, value, revision: "" },
          ];
        },
        // A roadmap's evidence must name files the data repository publishes.
        (path) => checkEvidence(reader, [{ path, fileName: posix.basename(path), value }]),
      );
    },
    check() {
      return engine(() =>
        host.read((db) => {
          return checkData(reader, snapshot(db).parsed, db.config.layout.data);
        }),
      );
    },
    async draft(locale = DEFAULT_LOCALE): Promise<DraftCard> {
      // The host computes its status in the background; before the first
      // check (or without a timer) it is computed now.
      let status = host.status();
      if (!status.sync) status = await host.refresh().catch(() => host.status());
      if (!status.available) {
        return {
          status: null,
          unavailableReason: status.error?.message ?? "The data checkout is not available yet.",
        };
      }
      return engine(() =>
        host.read(async (db) => {
          const review = await db.review({ adapters: [reviewAdapter(locale)] });
          const paths = review.resources.flatMap(
            (resource) => resource.changes[0]?.technicalRefs[0]?.path ?? [],
          );
          const reverts = db.canRevertRecords(paths);
          const records: DraftPanelRecordInput[] = review.resources.map((resource) => {
            const technicalPath = resource.changes[0]?.technicalRefs[0]?.path ?? "";
            return {
              resource,
              technicalPath,
              revert: reverts.get(technicalPath) ?? { supported: false },
            };
          });
          const card: DraftCard = {
            status: status.sync,
            conflict: status.conflict,
            pullBlocked: status.pullBlocked,
            publishReadiness: review.publishReadiness,
            records,
          };
          if (review.draftRevision !== undefined) card.revision = review.draftRevision;
          if (status.draftOwner) card.draftOwner = { actor: status.draftOwner.actor };
          return card;
        }),
      );
    },
    async publish({ expectedRevision, actor, summary }) {
      await engine(() =>
        host.run("publish", (db) =>
          db.publish({
            expectedRevision,
            source: SOURCE,
            ...(actor ? { actor } : {}),
            ...(summary ? { summary } : {}),
          }),
        ),
      );
    },
    async finishSend(expectedHead) {
      await engine(() => host.run("finish-send", (db) => db.finishSend({ expectedHead })));
    },
    async discard(scope: DiscardScope, expectedRevision) {
      await engine(() => host.run("discard", (db) => db.discard({ scope, expectedRevision })));
    },
    async pull() {
      await engine(() => host.run("pull", (db) => db.pull()));
    },
    subscribe(listener: (event: StoreEvent) => void) {
      return host.subscribe((event) => {
        if (event.type === "remote-pulled") listener({ type: "records-changed" });
        listener({ type: "draft-changed" });
      });
    },
    close() {
      host.stop();
    },
  };
}

/** Engine errors keep their code, so the UI words them as the engine documents. */
async function engine<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof StoreError) throw error;
    if (error instanceof RepositoryDbError) throw new StoreError(error.code, error.message);
    throw error;
  }
}
