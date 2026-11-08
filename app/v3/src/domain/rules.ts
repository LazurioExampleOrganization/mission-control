import type { MissionControlConfig } from "./config.ts";
import { type Plan, planIdFor } from "./plan.ts";
import { periodEnd, periodStart, type Roadmap, roadmapIdFor } from "./roadmap.ts";

/**
 * Rules across records, which a schema of one record cannot express: unique
 * codes, ids that follow from codes, and references between roadmaps and
 * plans. The App checks them before it saves a record and in its data check;
 * the data repository's validator runs this same code (`src/data/files.ts`).
 */

/** Why a record is refused, independent of the language it is shown in. */
export type RuleIssueCode =
  | "plan_code_twice"
  | "id_mismatch"
  | "prefix_mismatch"
  | "file_name"
  | "updated_before_created"
  | "roadmap_code_twice"
  | "archived_main"
  | "source_plan_missing"
  | "priority_id_twice"
  | "step_id_twice"
  | "step_timing"
  | "step_unknown_priority"
  | "step_unknown_plan"
  | "main_twice"
  /** A record does not match its Zod schema; `params.path`, `params.kind`, `params.rule`. */
  | "schema"
  /** A file is not valid YAML or JSON. */
  | "unreadable"
  | "config_missing"
  /** A path of the data is a symbolic link, which is never followed. */
  | "link_refused"
  /** The empty start of the data repository template holds records. */
  | "empty_start";

export interface RuleIssue {
  /** The record the issue is about: a plan or roadmap code, a file, or `config`. */
  record: string;
  code: RuleIssueCode;
  /** Values the wording names (a code, a step id); never translated. */
  params?: Record<string, string>;
  /** The issue in English, for agents, the CLI and logs. The UI words `code`. */
  message: string;
}

export interface RuleInput {
  config: MissionControlConfig;
  plans: readonly { value: Plan; fileName: string }[];
  roadmaps: readonly { value: Roadmap; fileName: string }[];
}

const issue = (
  record: string,
  code: RuleIssueCode,
  message: string,
  params?: Record<string, string>,
): RuleIssue => (params ? { record, code, params, message } : { record, code, message });

export function checkRules({ config, plans, roadmaps }: RuleInput): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const planCodes = new Set<string>();
  for (const { value, fileName } of plans) {
    const code = value.dev_code;
    if (planCodes.has(code))
      issues.push(issue(code, "plan_code_twice", "the plan code is used twice"));
    planCodes.add(code);
    if (value.id !== planIdFor(code)) {
      const expected = planIdFor(code);
      issues.push(issue(code, "id_mismatch", `the id must be ${expected}`, { expected }));
    }
    if (!code.startsWith(`${config.plan_prefix}-`)) {
      const prefix = config.plan_prefix;
      issues.push(
        issue(
          code,
          "prefix_mismatch",
          `the code must start with the Organization's prefix ${prefix}`,
          {
            prefix,
          },
        ),
      );
    }
    if (!fileName.startsWith(`${code}-`) && fileName !== `${code}.yaml`) {
      issues.push(issue(code, "file_name", `the file name must start with ${code}-`, { code }));
    }
    if (value.updated_at < value.created_at) {
      issues.push(issue(code, "updated_before_created", "updated_at is before created_at"));
    }
  }

  const roadmapCodes = new Set<string>();
  let mainRoadmaps = 0;
  for (const { value, fileName } of roadmaps) {
    const code = value.roadmap_code;
    if (roadmapCodes.has(code)) {
      issues.push(issue(code, "roadmap_code_twice", "the roadmap code is used twice"));
    }
    roadmapCodes.add(code);
    if (value.main) mainRoadmaps += 1;
    if (value.main && value.status === "archived") {
      issues.push(issue(code, "archived_main", "an archived roadmap cannot be the main roadmap"));
    }
    if (value.id !== roadmapIdFor(code)) {
      const expected = roadmapIdFor(code);
      issues.push(issue(code, "id_mismatch", `the id must be ${expected}`, { expected }));
    }
    if (!fileName.startsWith(`${code}-`) && fileName !== `${code}.yaml`) {
      issues.push(issue(code, "file_name", `the file name must start with ${code}-`, { code }));
    }
    if (!planCodes.has(value.source_plan)) {
      const plan = value.source_plan;
      issues.push(
        issue(code, "source_plan_missing", `the source plan ${plan} does not exist`, { plan }),
      );
    }
    const priorityIds = new Set(value.priorities.map((entry) => entry.id));
    if (priorityIds.size !== value.priorities.length) {
      issues.push(issue(code, "priority_id_twice", "a priority id is used twice"));
    }
    const stepIds = new Set<string>();
    for (const step of value.steps) {
      if (stepIds.has(step.id)) {
        issues.push(issue(code, "step_id_twice", `${step.id} is used twice`, { step: step.id }));
      }
      stepIds.add(step.id);
      const timing = step.timing;
      if (
        timing?.from &&
        (periodStart(timing.from) > periodStart(timing.to) ||
          periodEnd(timing.from) > periodEnd(timing.to))
      ) {
        issues.push(
          issue(code, "step_timing", `${step.id} starts or ends after its end (to)`, {
            step: step.id,
          }),
        );
      }
      for (const ref of step.priority_refs ?? []) {
        if (!priorityIds.has(ref)) {
          issues.push(
            issue(code, "step_unknown_priority", `${step.id} names the unknown priority ${ref}`, {
              step: step.id,
              ref,
            }),
          );
        }
      }
      for (const ref of step.plan_refs ?? []) {
        if (!planCodes.has(ref)) {
          issues.push(
            issue(code, "step_unknown_plan", `${step.id} names the unknown plan ${ref}`, {
              step: step.id,
              ref,
            }),
          );
        }
      }
    }
  }
  if (mainRoadmaps > 1) {
    issues.push(issue("roadmaps", "main_twice", "more than one roadmap is marked main"));
  }
  return issues;
}
