import { join } from "node:path";
import { DATA_REPO_TEMPLATE, SAMPLE_DATA } from "../../src/cli/paths.ts";
import { readDataDirectory } from "../../src/data/directory.ts";
import type { MissionControlConfig } from "../../src/domain/config.ts";
import type { Plan } from "../../src/domain/plan.ts";
import type { Roadmap } from "../../src/domain/roadmap.ts";

export { DATA_REPO_TEMPLATE, SAMPLE_DATA };

/** The fictional example records this repository ships, parsed. */
export function sampleData(): { config: MissionControlConfig; plans: Plan[]; roadmaps: Roadmap[] } {
  const data = readDataDirectory(join(SAMPLE_DATA, "data"));
  if (!data.config || data.issues.length > 0) {
    throw new Error(`invalid sample data: ${JSON.stringify(data.issues)}`);
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
