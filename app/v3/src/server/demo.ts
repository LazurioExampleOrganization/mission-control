import { join } from "node:path";
import { SAMPLE_DATA } from "../cli/paths.ts";
import { readDataDirectory } from "../data/directory.ts";
import { createMemoryStore } from "../data/memory-store.ts";
import { serve } from "./serve.ts";

/**
 * `bun run dev:demo`: the App over the fictional example data, held in
 * memory. Nothing is read from or written to a data repository, and every
 * change is gone when the process ends. For trying the template and for the
 * Marketplace screenshots; never the start of a real Module.
 */
const sample = readDataDirectory(join(SAMPLE_DATA, "data"));
if (!sample.config || sample.issues.length > 0) {
  console.error("templates/sample-data is not valid; run `bun run validate:seed`.");
  process.exit(1);
}
const config = sample.config;

await serve(
  () =>
    createMemoryStore({
      config,
      plans: sample.plans.map((entry) => entry.value),
      roadmaps: sample.roadmaps.map((entry) => entry.value),
    }),
  "demo (example data in memory)",
);
