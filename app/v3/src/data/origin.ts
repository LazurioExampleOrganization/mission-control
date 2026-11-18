import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Where a change came from (Module Standard, One data port: author and
 * channel). Mission Control writes through its interface (`ui`); the other
 * channels are the Standard's for Apps that have them.
 */
export type Channel = "ui" | "mcp" | "webmcp" | "import" | "cli";

const CHANNELS: readonly Channel[] = ["ui", "mcp", "webmcp", "import", "cli"];

/** The channel a request states in its header; null when it states none it knows. */
export function channelOf(stated: string | null): Channel | null {
  return CHANNELS.find((channel) => channel === stated) ?? null;
}

export interface Origin {
  /** The person's `subject`; null for a caller without one (a local entry), never invented. */
  subject: string | null;
  /** The channel the caller stated; null when it stated none. */
  channel: Channel | null;
}

const ORIGIN = new AsyncLocalStorage<Origin>();

/** Runs `operation` with `origin` as the origin of every change it makes. */
export function withOrigin<T>(origin: Origin, operation: () => T): T {
  return ORIGIN.run(origin, operation);
}

/** How repository-db records a change's origin; unknown where nobody stated one. */
export function attribution(app: string): {
  kind: "app" | "agent" | "unknown";
  source: string;
  actor?: string;
} {
  const origin = ORIGIN.getStore();
  const actor = origin?.subject ? { actor: origin.subject } : {};
  // A channel nobody stated is unknown, never guessed; the person stays.
  if (!origin?.channel) return { kind: "unknown", source: app, ...actor };
  const agent = origin.channel === "mcp" || origin.channel === "webmcp" || origin.channel === "cli";
  return { kind: agent ? "agent" : "app", source: `${app}/${origin.channel}`, ...actor };
}
