import { DATA_REPO_TEMPLATE, SAMPLE_DATA, sampleDataFor } from "../../src/cli/paths.ts";
import { readDataDirectory } from "../../src/data/directory.ts";
import type { MissionControlConfig } from "../../src/domain/config.ts";
import type { Plan } from "../../src/domain/plan.ts";
import type { Roadmap } from "../../src/domain/roadmap.ts";
import type { Locale } from "../../src/i18n/locale.ts";

export { DATA_REPO_TEMPLATE, SAMPLE_DATA, sampleDataFor };

/** The fictional example records this repository ships in one language, parsed. */
export function sampleData(locale: Locale = "en"): {
  config: MissionControlConfig;
  plans: Plan[];
  roadmaps: Roadmap[];
} {
  const data = readDataDirectory(sampleDataFor(locale));
  if (!data.config || data.problems.length > 0) {
    throw new Error(`invalid sample data: ${JSON.stringify(data.problems)}`);
  }
  return {
    config: data.config,
    plans: data.plans.map((entry) => entry.value),
    roadmaps: data.roadmaps.map((entry) => entry.value),
  };
}

/** A new plan that passes every rule of the sample data. */
export function newPlan(code = "EX-0005", title = "Shared glossary review"): Plan {
  return {
    schema_version: "companiesascode.mission_control.plan.v2",
    id: `mcplan-${code.toLowerCase()}`,
    dev_code: code,
    title,
    status: "shaping",
    owner: "robinlee",
    priority: "medium",
    priority_rank: 100,
    created_at: "2026-11-02",
    updated_at: "2026-11-02",
    context: "Terms drift between colleagues and agents.",
    current_problem: "The glossary is not reviewed on a schedule.",
    target_state: "A quarterly glossary review with an owner.",
    scope: { in: ["Quarterly review"], out: [] },
    acceptance_criteria: ["The review happens once a quarter."],
    validation: ["The glossary names the date it was last reviewed."],
  };
}
