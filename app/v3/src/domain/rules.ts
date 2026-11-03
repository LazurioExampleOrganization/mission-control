import type { MissionControlConfig } from "./config.ts";
import { type Plan, planIdFor } from "./plan.ts";
import { periodEnd, periodStart, type Roadmap, roadmapIdFor } from "./roadmap.ts";

/**
 * Rules across records, which a schema of one record cannot express: unique
 * codes, ids that follow from codes, and references between roadmaps and
 * plans. The App checks them in `bun run validate` and before it saves a
 * record; the data repository's own validator checks the shape only.
 */
export interface RuleIssue {
  /** The record the issue is about: a plan or roadmap code, or `config`. */
  record: string;
  message: string;
}

export interface RuleInput {
  config: MissionControlConfig;
  plans: readonly { value: Plan; fileName: string }[];
  roadmaps: readonly { value: Roadmap; fileName: string }[];
}

export function checkRules({ config, plans, roadmaps }: RuleInput): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const planCodes = new Set<string>();
  for (const { value, fileName } of plans) {
    const code = value.dev_code;
    if (planCodes.has(code)) issues.push({ record: code, message: "the plan code is used twice" });
    planCodes.add(code);
    if (value.id !== planIdFor(code)) {
      issues.push({ record: code, message: `the id must be ${planIdFor(code)}` });
    }
    if (!code.startsWith(`${config.plan_prefix}-`)) {
      issues.push({
        record: code,
        message: `the code must start with the Organization's prefix ${config.plan_prefix}`,
      });
    }
    if (!fileName.startsWith(`${code}-`) && fileName !== `${code}.yaml`) {
      issues.push({ record: code, message: `the file name must start with ${code}-` });
    }
    if (value.updated_at < value.created_at) {
      issues.push({ record: code, message: "updated_at is before created_at" });
    }
  }

  const roadmapCodes = new Set<string>();
  let mainRoadmaps = 0;
  for (const { value, fileName } of roadmaps) {
    const code = value.roadmap_code;
    if (roadmapCodes.has(code)) {
      issues.push({ record: code, message: "the roadmap code is used twice" });
    }
    roadmapCodes.add(code);
    if (value.main) mainRoadmaps += 1;
    if (value.main && value.status === "archived") {
      issues.push({ record: code, message: "an archived roadmap cannot be the main roadmap" });
    }
    if (value.id !== roadmapIdFor(code)) {
      issues.push({ record: code, message: `the id must be ${roadmapIdFor(code)}` });
    }
    if (!fileName.startsWith(`${code}-`) && fileName !== `${code}.yaml`) {
      issues.push({ record: code, message: `the file name must start with ${code}-` });
    }
    if (!planCodes.has(value.source_plan)) {
      issues.push({ record: code, message: `the source plan ${value.source_plan} does not exist` });
    }
    const priorityIds = new Set(value.priorities.map((entry) => entry.id));
    if (priorityIds.size !== value.priorities.length) {
      issues.push({ record: code, message: "a priority id is used twice" });
    }
    const stepIds = new Set<string>();
    for (const step of value.steps) {
      if (stepIds.has(step.id)) issues.push({ record: code, message: `${step.id} is used twice` });
      stepIds.add(step.id);
      const timing = step.timing;
      if (
        timing?.from &&
        (periodStart(timing.from) > periodStart(timing.to) ||
          periodEnd(timing.from) > periodEnd(timing.to))
      ) {
        issues.push({ record: code, message: `${step.id} starts or ends after its end (to)` });
      }
      for (const ref of step.priority_refs ?? []) {
        if (!priorityIds.has(ref)) {
          issues.push({ record: code, message: `${step.id} names the unknown priority ${ref}` });
        }
      }
      for (const ref of step.plan_refs ?? []) {
        if (!planCodes.has(ref)) {
          issues.push({ record: code, message: `${step.id} names the unknown plan ${ref}` });
        }
      }
    }
  }
  if (mainRoadmaps > 1) {
    issues.push({ record: "roadmaps", message: "more than one roadmap is marked main" });
  }
  return issues;
}
