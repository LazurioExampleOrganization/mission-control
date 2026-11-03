import { z } from "zod";

/** A calendar date as Mission Control stores it: `YYYY-MM-DD`, no time zone. */
export const isoDate = z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/, "expected YYYY-MM-DD");

/** A non-empty line of text. */
export const text = z.string().min(1);

/** The lifecycle shared by plans, roadmaps and roadmap steps. */
export const STATUSES = [
  "shaping",
  "ready",
  "in_progress",
  "review",
  "blocked",
  "done",
  "archived",
] as const;
export const status = z.enum(STATUSES);
export type Status = z.infer<typeof status>;

export const PRIORITIES = ["urgent", "high", "medium", "low"] as const;
export const priority = z.enum(PRIORITIES);
export type Priority = z.infer<typeof priority>;

/** A plan code: the Organization's prefix and four digits, e.g. `EX-0007`. */
export const PLAN_CODE = /^[A-Z]{2,6}-[0-9]{4}$/;
export const planCode = z.string().regex(PLAN_CODE, "expected a plan code such as EX-0007");

/** A task id of the task ledgers: `task-YYYY-MM-DD-NNN`. */
export const taskId = z
  .string()
  .regex(/^task-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{3}$/, "expected task-YYYY-MM-DD-NNN");

export const link = z.strictObject({
  label: text,
  path: text.optional(),
  url: text.optional(),
});
