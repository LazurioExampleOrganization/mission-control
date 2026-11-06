import { resolve } from "node:path";

/** The Module root: `app/v3/src/cli` → four levels up. */
export const MODULE_ROOT = resolve(import.meta.dir, "..", "..", "..", "..");
/** The data repository skeleton an adopting Organization starts from. */
export const DATA_REPO_TEMPLATE = resolve(MODULE_ROOT, "templates", "data-repo");
/** Fictional example records for the "example data" start. */
export const SAMPLE_DATA = resolve(MODULE_ROOT, "templates", "sample-data");
/** The Module's data checkout. */
export const DATA_MOUNT = resolve(MODULE_ROOT, "db");
