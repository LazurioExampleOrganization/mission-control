import { z } from "zod";
import { type MissionControlStore, StoreError } from "../data/store.ts";
import { priority, status } from "../domain/common.ts";
import {
  defaultPriorityRank,
  nextPlanCode,
  PLAN_SCHEMA_VERSION,
  type Plan,
  planIdFor,
} from "../domain/plan.ts";

/**
 * The HTTP API of Mission Control. The browser talks only to this API; the
 * API talks only to the storage port, never to files or Git.
 */
export interface ApiOptions {
  /** Origins a writing request may come from (the App's own, loopback and hosted). */
  allowedOrigins: ReadonlySet<string>;
  /** Today's date for new records; injectable for tests. */
  today?: () => string;
}

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const newPlanInput = z.strictObject({
  title: z.string().trim().min(1),
  owner: z.string().trim().min(1),
  priority,
  status: status.default("shaping"),
  context: z.string().trim().min(1),
  current_problem: z.string().trim().min(1),
  target_state: z.string().trim().min(1),
  acceptance_criteria: z.array(z.string().trim().min(1)).min(1),
  validation: z.array(z.string().trim().min(1)).min(1),
});

const saveInput = z.strictObject({
  record: z.unknown(),
  baseRevision: z.string().nullable(),
});

const publishInput = z.strictObject({
  expectedRevision: z.string().min(1),
  summary: z.string().trim().min(1).optional(),
});

const discardInput = z.strictObject({
  scope: z.union([
    z.strictObject({ kind: z.literal("draft") }),
    z.strictObject({ kind: z.literal("record"), path: z.string().min(1) }),
  ]),
  expectedRevision: z.string().min(1),
});

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function refusal(code: string, message: string, status: number, issues: unknown[] = []) {
  return json({ code, message, issues }, status);
}

const STATUS_BY_CODE: Record<string, number> = {
  bad_request: 400,
  not_found: 404,
  invalid_record: 422,
  validation_failed: 422,
  materialize_failed: 422,
  record_changed: 409,
  draft_changed: 409,
  draft_write_blocked: 409,
  conflict_active: 409,
  publish_conflict: 409,
  pull_blocked_by_draft: 409,
  send_pending: 409,
  publish_push_failed: 502,
  credentials: 401,
  identity_missing: 401,
  config_missing: 503,
  mount_unavailable: 503,
  boundary_violation: 503,
  config_changed: 503,
};

function errorResponse(error: unknown): Response {
  if (error instanceof StoreError) {
    return refusal(error.code, error.message, STATUS_BY_CODE[error.code] ?? 409, [...error.issues]);
  }
  console.error(error);
  return refusal("unexpected", error instanceof Error ? error.message : String(error), 500);
}

async function body<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new StoreError("bad_request", "The request body is not JSON.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new StoreError(
      "bad_request",
      parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
    );
  }
  return parsed.data;
}

/** A write is accepted only as JSON from one of the App's own origins (no cross-site writes). */
function writeRefusal(req: Request, allowedOrigins: ReadonlySet<string>): Response | null {
  if (!WRITE_METHODS.has(req.method)) return null;
  const origin = req.headers.get("origin");
  if (!origin || !allowedOrigins.has(origin)) {
    return refusal("origin_refused", "A change is accepted only from Mission Control itself.", 403);
  }
  if (!(req.headers.get("content-type") ?? "").startsWith("application/json")) {
    return refusal("bad_request", "A change is sent as application/json.", 415);
  }
  return null;
}

export function createApi(store: MissionControlStore, options: ApiOptions) {
  const today = options.today ?? (() => new Date().toISOString().slice(0, 10));

  async function createPlan(req: Request): Promise<Response> {
    const input = await body(req, newPlanInput);
    const [config, plans] = await Promise.all([store.config(), store.listPlans()]);
    const code = nextPlanCode(
      config.plan_prefix,
      plans.map((entry) => entry.value.dev_code),
    );
    const date = today();
    const value: Plan = {
      schema_version: PLAN_SCHEMA_VERSION,
      id: planIdFor(code),
      dev_code: code,
      title: input.title,
      status: input.status,
      owner: input.owner,
      priority: input.priority,
      priority_rank: defaultPriorityRank(input.priority),
      created_at: date,
      updated_at: date,
      context: input.context,
      current_problem: input.current_problem,
      target_state: input.target_state,
      scope: { in: [], out: [] },
      acceptance_criteria: input.acceptance_criteria,
      validation: input.validation,
    };
    return json(await store.savePlan(value, null), 201);
  }

  async function savePlan(code: string, req: Request): Promise<Response> {
    const input = await body(req, saveInput);
    const record = input.record as Partial<Plan> | null;
    if (!record || typeof record !== "object" || record.dev_code !== code) {
      throw new StoreError("bad_request", `The record is not the plan ${code}.`);
    }
    return json(
      await store.savePlan({ ...(record as Plan), updated_at: today() }, input.baseRevision),
    );
  }

  async function saveRoadmap(code: string, req: Request): Promise<Response> {
    const input = await body(req, saveInput);
    const record = input.record as { roadmap_code?: unknown } | null;
    if (!record || typeof record !== "object" || record.roadmap_code !== code) {
      throw new StoreError("bad_request", `The record is not the roadmap ${code}.`);
    }
    return json(
      await store.saveRoadmap(
        { ...(record as Parameters<MissionControlStore["saveRoadmap"]>[0]), updated_at: today() },
        input.baseRevision,
      ),
    );
  }

  function events(req: Request): Response {
    let stop = () => {};
    const stream = new ReadableStream<string>({
      start(controller) {
        controller.enqueue(": connected\n\n");
        const unsubscribe = store.subscribe((event) => {
          controller.enqueue(`event: ${event.type}\ndata: {}\n\n`);
        });
        const keepAlive = setInterval(() => controller.enqueue(": keep-alive\n\n"), 25_000);
        stop = () => {
          clearInterval(keepAlive);
          unsubscribe();
        };
        req.signal.addEventListener("abort", () => {
          stop();
          controller.close();
        });
      },
      cancel() {
        stop();
      },
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        connection: "keep-alive",
      },
    });
  }

  async function route(req: Request, url: URL): Promise<Response> {
    const { pathname } = url;
    const method = req.method;
    const plan = /^\/api\/plans\/([^/]+)$/.exec(pathname);
    const roadmapMatch = /^\/api\/roadmaps\/([^/]+)$/.exec(pathname);
    const code = decodeURIComponent((plan ?? roadmapMatch)?.[1] ?? "");

    if (pathname === "/api/status" && method === "GET") return json(await store.available());
    if (pathname === "/api/config" && method === "GET") return json(await store.config());
    if (pathname === "/api/plans" && method === "GET") return json(await store.listPlans());
    if (pathname === "/api/plans" && method === "POST") return createPlan(req);
    if (plan && method === "GET") {
      const found = await store.getPlan(code);
      return found ? json(found) : refusal("not_found", `The plan ${code} does not exist.`, 404);
    }
    if (plan && method === "PUT") return savePlan(code, req);
    if (pathname === "/api/roadmaps" && method === "GET") return json(await store.listRoadmaps());
    if (roadmapMatch && method === "GET") {
      const found = await store.getRoadmap(code);
      return found ? json(found) : refusal("not_found", `The roadmap ${code} does not exist.`, 404);
    }
    if (roadmapMatch && method === "PUT") return saveRoadmap(code, req);
    if (pathname === "/api/check" && method === "GET") return json(await store.check());
    if (pathname === "/api/draft" && method === "GET") return json(await store.draft());
    if (pathname === "/api/draft/publish" && method === "POST") {
      const input = await body(req, publishInput);
      await store.publish(input.summary ? input : { expectedRevision: input.expectedRevision });
      return json({ ok: true });
    }
    if (pathname === "/api/draft/finish-send" && method === "POST") {
      const input = await body(req, z.strictObject({ expectedHead: z.string().min(1) }));
      await store.finishSend(input.expectedHead);
      return json({ ok: true });
    }
    if (pathname === "/api/draft/discard" && method === "POST") {
      const input = await body(req, discardInput);
      await store.discard(input.scope, input.expectedRevision);
      return json({ ok: true });
    }
    if (pathname === "/api/draft/pull" && method === "POST") {
      await store.pull();
      return json({ ok: true });
    }
    if (pathname === "/api/events" && method === "GET") return events(req);
    return refusal("not_found", `${method} ${pathname} is not part of the API.`, 404);
  }

  /** Answers an `/api/…` request; every other path is not the API's. */
  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const refused = writeRefusal(req, options.allowedOrigins);
    if (refused) return refused;
    try {
      return await route(req, url);
    } catch (error) {
      return errorResponse(error);
    }
  };
}
