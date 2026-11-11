import { z } from "zod";
import { hasCredential } from "./credentials.ts";

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

const WINDOWS_DEVICE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

/**
 * A path inside the data repository that every system reads the same way:
 * relative, `/` between parts, printable ASCII, no `.` or `..` part, no part
 * that Windows refuses (`<>:"\|?*`, a trailing dot or space, `CON`, `NUL`…).
 * The same rule as the Mission Control 3.x data validator.
 */
export function isPortablePath(value: string): boolean {
  if (
    value.length === 0 ||
    value.trim() !== value ||
    value.startsWith("/") ||
    !/^[\x20-\x7e]+$/.test(value) ||
    /[<>:"\\|?*]/.test(value)
  ) {
    return false;
  }
  return value
    .split("/")
    .every(
      (part) =>
        part.length > 0 &&
        part !== "." &&
        part !== ".." &&
        !part.endsWith(".") &&
        !part.endsWith(" ") &&
        !WINDOWS_DEVICE.test(part),
    );
}

/** A repository-relative path, portable across systems (`isPortablePath`). */
export const portablePath = text.superRefine((value, context) => {
  if (!isPortablePath(value)) {
    context.addIssue({
      code: "custom",
      message:
        "expected a portable path relative to the data repository (no ../, no absolute path)",
      params: { rule: "portable_path" },
    });
  }
});

/** A URL that carries no credential (`credentials.ts`). */
export const credentialFreeUrl = text.superRefine((value, context) => {
  if (hasCredential(value)) {
    context.addIssue({
      code: "custom",
      message: "a URL must not carry a credential (user info, a token or key parameter, a secret)",
      params: { rule: "credential_url" },
    });
  }
});

/** An http(s) URL that carries no credential. */
export const httpUrl = credentialFreeUrl.regex(/^https?:\/\//, "expected an http(s) URL");

export const link = z.strictObject({
  label: text,
  path: portablePath.optional(),
  url: credentialFreeUrl.optional(),
});
