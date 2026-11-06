import { z } from "zod";
import { isoDate, link, planCode, priority, status, taskId, text } from "./common.ts";

/**
 * A Mission Control plan: why something is done, for whom, its scope,
 * decisions and acceptance criteria. One plan is one YAML record of the data
 * repository.
 *
 * This schema is the only definition of the shape. The TypeScript type is
 * inferred from it and the JSON Schema of the data repository is generated
 * from it (`bun run schema:export`). The shape is the
 * `companiesascode.mission_control.plan.v2` contract that existing data
 * repositories already hold, so the template reads them unchanged.
 */
export const PLAN_SCHEMA_VERSION = "companiesascode.mission_control.plan.v2";

export const planDecision = z.strictObject({
  date: isoDate,
  decision: text,
  rationale: z.string().optional(),
});

export const proposedTask = z.strictObject({
  id: taskId.optional(),
  title: text,
  summary: text,
  priority: priority.optional(),
  priority_rank: z.int().min(1).optional(),
  assignee: text.optional(),
  priority_decider: text.optional(),
  priority_reason: text.optional(),
  tags: z.array(text).optional(),
  acceptance_criteria: z.array(text).optional(),
  risk_notes: z.array(text).optional(),
  blocked_by: z.array(taskId).optional(),
});

export const pullRequestRef = z.strictObject({
  url: text,
  status: z.string().optional(),
  note: z.string().optional(),
});

export const reviewEvidence = z.strictObject({
  date: isoDate,
  reviewer: text,
  verdict: text,
  evidence: text,
});

export const plan = z.strictObject({
  schema_version: z.literal(PLAN_SCHEMA_VERSION),
  id: z.string().regex(/^mcplan-[a-z]{2,6}-[0-9]{4}$/, "expected mcplan-<prefix>-NNNN"),
  dev_code: planCode,
  title: text,
  status,
  owner: text,
  priority,
  priority_rank: z.int().min(1),
  created_at: isoDate,
  updated_at: isoDate,
  context: text,
  current_problem: text,
  target_state: text,
  scope: z.strictObject({ in: z.array(text), out: z.array(text) }),
  acceptance_criteria: z.array(text).min(1),
  validation: z.array(text).min(1),
  implementation_validation: z.array(text).optional(),
  risk_notes: z.array(text).optional(),
  assumptions: z.array(text).optional(),
  decisions: z.array(planDecision).optional(),
  open_questions: z.array(text).optional(),
  dependencies: z.array(text).optional(),
  github: z
    .strictObject({
      branches: z.array(text).optional(),
      prs: z.array(pullRequestRef).optional(),
    })
    .optional(),
  todo_outputs: z.array(taskId).optional(),
  planning_target: z
    .strictObject({
      scope: text,
      todo_tasks_path: text.regex(/(^|\/)TODO\.tasks\.json$/),
    })
    .optional(),
  proposed_tasks: z.array(proposedTask).optional(),
  legacy_sources: z
    .strictObject({
      clickup: z
        .strictObject({
          task_id: text,
          custom_id: planCode,
          url: text,
          status: z.string().optional(),
          snapshot_path: text.optional(),
        })
        .optional(),
      external_task: z
        .strictObject({
          system: text,
          id: text,
          url: text,
          status: z.string().optional(),
          snapshot_path: text.optional(),
        })
        .optional(),
    })
    .optional(),
  import_review: z
    .strictObject({
      path: text.optional(),
      schema_fit: z.string().optional(),
      schema_changes: z.array(z.string()).optional(),
    })
    .optional(),
  incident_addendum: z
    .strictObject({
      reported_at: text,
      reporter: text,
      authorization: text,
      observed_state: text,
    })
    .optional(),
  review_evidence: z.array(reviewEvidence).optional(),
  links: z.array(link).optional(),
});

export type Plan = z.infer<typeof plan>;
export type PlanDecision = z.infer<typeof planDecision>;
export type ProposedTask = z.infer<typeof proposedTask>;

/** The record id a plan code implies: `EX-0007` → `mcplan-ex-0007`. */
export function planIdFor(code: string): string {
  return `mcplan-${code.toLowerCase()}`;
}

/** The rank a new plan gets from its priority, until someone orders it. */
export function defaultPriorityRank(value: Plan["priority"]): number {
  if (value === "urgent") return 1;
  if (value === "high") return 50;
  if (value === "medium") return 100;
  return 200;
}

/** Plans in their working order: rank first, then code. */
export function comparePlans(left: Plan, right: Plan): number {
  return left.priority_rank - right.priority_rank || left.dev_code.localeCompare(right.dev_code);
}

/** The next free code of a prefix, after the highest code already used. */
export function nextPlanCode(prefix: string, existing: readonly string[]): string {
  let highest = 0;
  for (const code of existing) {
    const match = /^([A-Z]{2,6})-([0-9]{4})$/.exec(code);
    if (match?.[1] === prefix) highest = Math.max(highest, Number(match[2]));
  }
  const next = highest + 1;
  if (next > 9999) throw new Error(`The prefix ${prefix} has no free plan code left.`);
  return `${prefix}-${String(next).padStart(4, "0")}`;
}
