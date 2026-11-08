import { join, resolve } from "node:path";
import { z } from "zod";
import { missionControlConfig } from "../domain/config.ts";
import { PLAN_SCHEMA_VERSION, plan } from "../domain/plan.ts";
import { ROADMAP_SCHEMA_VERSION, roadmap } from "../domain/roadmap.ts";
import { DATA_REPO_TEMPLATE } from "./paths.ts";

/**
 * What Mission Control generates into its data repository template; output,
 * never edited by hand. `--write` writes it, `--check` fails when it is stale.
 *
 * - `schemas/*.schema.json`: JSON Schemas of the records, generated from the
 *   Zod schemas of `src/domain/`, for editors and other languages.
 * - `scripts/mission-control-check.js`: the App's own check of the data
 *   (`src/data/files.ts`: the Zod schemas with their refinements, the rules
 *   across records and the engine's YAML parser) as one dependency-free
 *   bundle, which the data repository's validator runs.
 */
const SCHEMAS = [
  {
    file: "plan.schema.json",
    id: PLAN_SCHEMA_VERSION,
    title: "Mission Control plan",
    schema: plan,
  },
  {
    file: "roadmap.schema.json",
    id: ROADMAP_SCHEMA_VERSION,
    title: "Mission Control roadmap",
    schema: roadmap,
  },
  {
    file: "config.schema.json",
    id: "companiesascode.mission_control.config.v1",
    title: "Mission Control settings",
    schema: missionControlConfig,
  },
] as const;

export const CHECK_BUNDLE = "scripts/mission-control-check.js";

export function renderSchemas(): { file: string; text: string }[] {
  return SCHEMAS.map(({ file, id, title, schema }) => {
    const generated = z.toJSONSchema(schema, { target: "draft-2020-12", io: "input" });
    const { $schema, ...rest } = generated as Record<string, unknown>;
    const document = {
      $schema,
      $id: id,
      title,
      $comment:
        "Generated from the Zod schemas of Mission Control (app/v3/src/domain) by `bun run schema:export`. Do not edit.",
      ...rest,
    };
    return { file: `schemas/${file}`, text: `${JSON.stringify(document, null, 2)}\n` };
  });
}

/** The check bundle: minified, so it carries no path of the machine that built it. */
export async function renderCheckBundle(): Promise<{ file: string; text: string }> {
  const result = await Bun.build({
    entrypoints: [resolve(import.meta.dir, "..", "data", "check-entry.ts")],
    target: "bun",
    format: "esm",
    minify: true,
  });
  const [output] = result.outputs;
  if (!result.success || !output) {
    throw new Error(`The check bundle did not build: ${result.logs.join("\n")}`);
  }
  const code = (await output.text()).replace(/\r\n/g, "\n");
  const pragma = "// @bun\n";
  const body = code.startsWith(pragma) ? code.slice(pragma.length) : code;
  const header =
    "// Mission Control's check of its data, built from app/v3/src/data/files.ts by `bun run schema:export`. Do not edit.\n";
  return {
    file: CHECK_BUNDLE,
    text: `${pragma}${header}${body.endsWith("\n") ? body : `${body}\n`}`,
  };
}

export async function renderOutputs(): Promise<{ file: string; text: string }[]> {
  return [...renderSchemas(), await renderCheckBundle()];
}

if (import.meta.main) {
  const mode = process.argv[2];
  if (mode !== "--write" && mode !== "--check") {
    console.error("usage: schema.ts --write | --check");
    process.exit(2);
  }
  const stale: string[] = [];
  for (const { file, text } of await renderOutputs()) {
    const path = join(DATA_REPO_TEMPLATE, ...file.split("/"));
    const current = await Bun.file(path)
      .text()
      .catch(() => null);
    if (current === text) continue;
    if (mode === "--write") await Bun.write(path, text);
    else stale.push(path);
  }
  if (stale.length > 0) {
    console.error(`Stale generated files, run \`bun run schema:export\`:\n${stale.join("\n")}`);
    process.exit(1);
  }
  console.log(
    mode === "--write"
      ? "JSON Schemas and the check bundle written."
      : "JSON Schemas and the check bundle are current.",
  );
}
