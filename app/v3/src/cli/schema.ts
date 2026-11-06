import { join } from "node:path";
import { z } from "zod";
import { missionControlConfig } from "../domain/config.ts";
import { PLAN_SCHEMA_VERSION, plan } from "../domain/plan.ts";
import { ROADMAP_SCHEMA_VERSION, roadmap } from "../domain/roadmap.ts";
import { DATA_REPO_TEMPLATE } from "./paths.ts";

/**
 * The JSON Schemas of the data repository, generated from the Zod schemas of
 * `src/domain/`. They are output, never edited by hand: `--write` writes them
 * into the data repository template, `--check` fails when they are stale.
 */
const OUTPUTS = [
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

export function renderSchemas(): { file: string; text: string }[] {
  return OUTPUTS.map(({ file, id, title, schema }) => {
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
    return { file, text: `${JSON.stringify(document, null, 2)}\n` };
  });
}

if (import.meta.main) {
  const mode = process.argv[2];
  if (mode !== "--write" && mode !== "--check") {
    console.error("usage: schema.ts --write | --check");
    process.exit(2);
  }
  const stale: string[] = [];
  for (const { file, text } of renderSchemas()) {
    const path = join(DATA_REPO_TEMPLATE, "schemas", file);
    const current = await Bun.file(path)
      .text()
      .catch(() => null);
    if (current === text) continue;
    if (mode === "--write") await Bun.write(path, text);
    else stale.push(path);
  }
  if (stale.length > 0) {
    console.error(
      `Stale generated JSON Schema, run \`bun run schema:export\`:\n${stale.join("\n")}`,
    );
    process.exit(1);
  }
  console.log(mode === "--write" ? "JSON Schemas written." : "JSON Schemas are current.");
}
