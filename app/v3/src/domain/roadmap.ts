import { z } from "zod";
import { isoDate, planCode, priority, status, taskId, text } from "./common.ts";

/**
 * A roadmap orders plans into steps over time. One roadmap is one YAML record
 * of the data repository (`companiesascode.mission_control.roadmap.v1`).
 */
export const ROADMAP_SCHEMA_VERSION = "companiesascode.mission_control.roadmap.v1";

/** `2026-03` or `2026-Q2`. */
const period = z
  .string()
  .regex(/^[0-9]{4}-(?:0[1-9]|1[0-2]|Q[1-4])$/, "expected YYYY-MM or YYYY-Qn");

export const CONFIDENCES = ["committed", "likely", "tentative"] as const;

export const stepTiming = z.strictObject({
  from: period.optional(),
  to: period,
  confidence: z.enum(CONFIDENCES).optional(),
});

const EVIDENCE_KINDS = [
  "decision",
  "doc",
  "plan",
  "pull_request",
  "commit",
  "report",
  "validation",
  "external",
] as const;

/** Evidence inside the data repository (`path`) or outside it (`url`, verified externally). */
export const evidenceRef = z.union([
  z.strictObject({ label: text, kind: z.enum(EVIDENCE_KINDS), path: text }),
  z.strictObject({
    label: text,
    kind: z.enum(EVIDENCE_KINDS),
    url: text.regex(/^https?:\/\//),
    verification: z.literal("external"),
  }),
]);

export const roadmapStep = z
  .strictObject({
    id: z.string().regex(/^step-[0-9]{3}$/, "expected step-NNN"),
    title: text,
    status,
    executable: z.boolean(),
    timing: stepTiming.optional(),
    priority_refs: z
      .array(z.string().regex(/^priority-[0-9]{3}$/))
      .min(1)
      .optional(),
    plan_refs: z.array(planCode).min(1).optional(),
    todo_refs: z.array(taskId).min(1).optional(),
    issue_refs: z
      .array(z.string().regex(/^issue-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{3}$/))
      .min(1)
      .optional(),
    acceptance_criteria: z.array(text).optional(),
    notes: z.string().optional(),
    evidence_refs: z.array(evidenceRef).min(1).optional(),
  })
  .superRefine((step, context) => {
    if (step.executable && !step.plan_refs && !step.todo_refs && !step.issue_refs) {
      context.addIssue({
        code: "custom",
        path: ["executable"],
        message: "an executable step names at least one plan, task or issue",
        params: { rule: "executable_step_refs" },
      });
    }
    if (step.status === "done" && !step.evidence_refs) {
      context.addIssue({
        code: "custom",
        path: ["evidence_refs"],
        message: "a done step names its evidence",
        params: { rule: "done_step_evidence" },
      });
    }
  });

export const roadmapPriority = z.strictObject({
  id: z.string().regex(/^priority-[0-9]{3}$/, "expected priority-NNN"),
  title: text,
  rank: z.int().min(1),
  rationale: z.string().optional(),
});

export const roadmap = z.strictObject({
  schema_version: z.literal(ROADMAP_SCHEMA_VERSION),
  id: z.string().regex(/^mcroadmap-rm-[0-9]{4}$/, "expected mcroadmap-rm-NNNN"),
  roadmap_code: z.string().regex(/^RM-[0-9]{4}$/, "expected RM-NNNN"),
  title: text,
  status,
  owner: text,
  priority,
  created_at: isoDate,
  updated_at: isoDate,
  source_plan: planCode,
  summary: text,
  main: z.boolean().optional(),
  agent_lane: z
    .strictObject({
      reviewers: z.array(text).min(1),
      execution_agents: z.array(text).min(1),
      escalation_policy: text,
    })
    .optional(),
  priorities: z.array(roadmapPriority).min(1),
  steps: z.array(roadmapStep).min(1),
  links: z
    .array(
      z.union([
        z.strictObject({ label: text, path: text, url: text.optional() }),
        z.strictObject({ label: text, url: text }),
      ]),
    )
    .optional(),
});

export type Roadmap = z.infer<typeof roadmap>;
export type RoadmapStep = z.infer<typeof roadmapStep>;
export type StepTiming = z.infer<typeof stepTiming>;

/** The record id a roadmap code implies: `RM-0001` → `mcroadmap-rm-0001`. */
export function roadmapIdFor(code: string): string {
  return `mcroadmap-${code.toLowerCase()}`;
}

/** Steps someone can start now: executable, ready, in their roadmap order. */
export function nextSteps(value: Roadmap): RoadmapStep[] {
  return value.steps.filter((step) => step.executable && step.status === "ready");
}

/** How far a roadmap is: done steps out of all steps that are not archived. */
export function progress(value: Roadmap): { done: number; total: number } {
  const counted = value.steps.filter((step) => step.status !== "archived");
  return {
    done: counted.filter((step) => step.status === "done").length,
    total: counted.length,
  };
}

/** The first month a period covers, for ordering: `2026-Q2` → `2026-04`. */
export function periodStart(value: string): string {
  const quarter = /^([0-9]{4})-Q([1-4])$/.exec(value);
  if (!quarter) return value;
  const month = (Number(quarter[2]) - 1) * 3 + 1;
  return `${quarter[1]}-${String(month).padStart(2, "0")}`;
}

/** The last month a period covers: `2026-Q2` → `2026-06`. */
export function periodEnd(value: string): string {
  const quarter = /^([0-9]{4})-Q([1-4])$/.exec(value);
  if (!quarter) return value;
  return `${quarter[1]}-${String(Number(quarter[2]) * 3).padStart(2, "0")}`;
}
