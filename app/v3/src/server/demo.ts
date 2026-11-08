import { sampleDataFor } from "../cli/paths.ts";
import { readDataDirectory } from "../data/directory.ts";
import { createMemoryStore } from "../data/memory-store.ts";
import { DEFAULT_LOCALE, isLocale, LOCALES } from "../i18n/locale.ts";
import { serve } from "./serve.ts";

/**
 * `bun run dev:demo`: the App over the fictional example data, held in
 * memory. Nothing is read from or written to a data repository, and every
 * change is gone when the process ends. For trying the template and for the
 * Marketplace screenshots; never the start of a real Module.
 *
 * `bun run dev:demo -- --locale en` serves the English example data and tells
 * the client to speak English; the default is Czech.
 */
const args = process.argv.slice(2);
const requested = args.includes("--locale") ? args[args.indexOf("--locale") + 1] : DEFAULT_LOCALE;
if (!isLocale(requested)) {
  console.error(`--locale takes one of: ${LOCALES.join(", ")}`);
  process.exit(2);
}
const sample = readDataDirectory(sampleDataFor(requested));
if (!sample.config || sample.problems.length > 0) {
  console.error(`templates/sample-data/${requested} is not valid; run \`bun run validate:seed\`.`);
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
  `demo (example data in memory, ${requested})`,
  { locale: requested },
);
