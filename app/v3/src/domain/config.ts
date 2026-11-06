import { z } from "zod";

/**
 * The Organization's Mission Control settings, kept in its data repository
 * (`data/mission-control/mission-control.config.json`). The App reads only
 * what it needs; older data repositories carry more keys, which it ignores.
 */
export const CONFIG_SCHEMA_VERSION = "companiesascode.mission_control.config.v1";

export const missionControlConfig = z.object({
  schema_version: z.literal(CONFIG_SCHEMA_VERSION),
  plan_prefix: z.string().regex(/^[A-Z]{2,6}$/, "expected 2-6 capital letters"),
  organization_admin: z.string().min(1).optional(),
});

export type MissionControlConfig = z.infer<typeof missionControlConfig>;
