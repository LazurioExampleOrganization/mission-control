import { z } from "zod";
import { portablePath } from "./common.ts";

/**
 * The frozen history of a data repository. Mission Control 3.x kept ledgers,
 * changesets, import reviews and reports beside the records
 * (`TODO.tasks.json`, `DONE.tasks.json`, `ISSUES.*.json`, `changesets/`,
 * `import-reviews/`, `reports/`). Mission Control 4.x neither reads nor
 * writes them; they stay as they were when the 3.x validator last accepted
 * them. `history.lock.json` names every such file with the digest of its
 * content, and the data check refuses any change: a changed, removed or added
 * file. A deliberate change of the history is a new freeze
 * (`bun scripts/validate.ts --freeze-history` in the data repository), seen
 * and reviewed as a change of the lock in its pull request.
 */
export const HISTORY_SCHEMA_VERSION = "mission-control.history.v1";
export const HISTORY_FREEZE_COMMAND = "bun scripts/validate.ts --freeze-history";

/** `sha256:` and the hex digest of the content, line endings read as LF. */
export const historyDigest = z
  .string()
  .regex(/^sha256:[0-9a-f]{64}$/, "expected sha256:<64 hex digits>");

export const historyLock = z.strictObject({
  schema_version: z.literal(HISTORY_SCHEMA_VERSION),
  generated_by: z.literal(HISTORY_FREEZE_COMMAND),
  files: z.record(portablePath, historyDigest),
});

export type HistoryLock = z.infer<typeof historyLock>;
