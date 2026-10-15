import { buildExportProposal } from "./export.ts";
import {
	createPlan,
	getPlanById,
	listPlanSummaries,
	listPlans,
	updatePlan,
	type PlanType,
	type PlanStatus,
} from "./plans.ts";
import {
	getEntityById,
	getEntityTypes,
	getViewResults,
	isEntityType,
	snapshotAllEntities,
	snapshotEntityType,
} from "./db.ts";
import { renderApp } from "./ui.ts";
import {
	loadFeaturePlanSchema,
	loadSchema,
	validateFeaturePlan,
} from "./validate.ts";
import { buildWorkBoard } from "./work-board.ts";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 5693;

function argValue(name: string): string | undefined {
	const index = process.argv.indexOf(name);
	if (index === -1) return undefined;
	return process.argv[index + 1];
}

function serverHost(): string {
	return argValue("--host") || process.env.HOST || DEFAULT_HOST;
}

function serverPort(): number {
	const raw = argValue("--port") || process.env.PORT;
	const port = Number(raw);
	return Number.isInteger(port) && port > 0 ? port : DEFAULT_PORT;
}

const PLAN_TYPE_SET: Set<PlanType> = new Set([
	"strategy",
	"feature",
	"experiment",
	"ops",
	"decision",
]);
const PLAN_STATUS_SET: Set<PlanStatus> = new Set([
	"shaping",
	"ready",
	"in_progress",
	"blocked",
	"done",
	"archived",
]);

function asType(value: unknown): PlanType | undefined {
	return typeof value === "string" && PLAN_TYPE_SET.has(value as PlanType)
		? (value as PlanType)
		: undefined;
}

function asStatus(value: unknown): PlanStatus | undefined {
	return typeof value === "string" && PLAN_STATUS_SET.has(value as PlanStatus)
		? (value as PlanStatus)
		: undefined;
}

function asStringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

function readPayload(body: unknown): Record<string, unknown> {
	return body && typeof body === "object" && !Array.isArray(body)
		? (body as Record<string, unknown>)
		: {};
}

async function handleListPlans(): Promise<Response> {
	return Response.json({ plans: await listPlanSummaries() });
}

async function handleGetPlan(id: string): Promise<Response> {
	const record = await getPlanById(id);
	if (!record) {
		return Response.json({ error: "not_found" }, { status: 404 });
	}
	return Response.json({ record });
}

async function handleCreatePlan(req: Request): Promise<Response> {
	const body = readPayload(await safeJson(req));
	const title = typeof body.title === "string" ? body.title.trim() : "";
	if (!title) {
		return Response.json(
			{ error: "title_required", errors: [{ path: "title", message: "je povinné" }] },
			{ status: 400 },
		);
	}
	const { record, validation } = await createPlan({
		title,
		type: asType(body.type),
		status: asStatus(body.status),
		owner: typeof body.owner === "string" ? body.owner : undefined,
		context: typeof body.context === "string" ? body.context : undefined,
		goals: asStringArray(body.goals),
		scope: readPayload(body.scope) as { in?: string[]; out?: string[] },
		acceptance_criteria: asStringArray(body.acceptance_criteria),
		risk_notes: asStringArray(body.risk_notes),
		tags: asStringArray(body.tags),
		links: Array.isArray(body.links)
			? (body.links as Array<{ label: string; path?: string; url?: string }>)
			: [],
		planning_target: body.planning_target as
			| { scope: string; todo_tasks_path?: string }
			| undefined,
		proposed_tasks: Array.isArray(body.proposed_tasks)
			? (body.proposed_tasks as Array<{
					title: string;
					summary: string;
					priority?: "high" | "medium" | "low";
				}>)
			: [],
	});
	if (!validation.ok) {
		return Response.json(
			{ record, validation, errors: validation.errors },
			{ status: 422 },
		);
	}
	return Response.json({ record, validation });
}

async function handleUpdatePlan(
	id: string,
	req: Request,
): Promise<Response> {
	const body = readPayload(await safeJson(req));
	const result = await updatePlan(id, {
		title: typeof body.title === "string" ? body.title : undefined,
		type: asType(body.type),
		status: asStatus(body.status),
		owner: typeof body.owner === "string" ? body.owner : undefined,
		context: typeof body.context === "string" ? body.context : undefined,
		goals: Array.isArray(body.goals) ? asStringArray(body.goals) : undefined,
		scope: body.scope as { in?: string[]; out?: string[] } | undefined,
		acceptance_criteria: Array.isArray(body.acceptance_criteria)
			? asStringArray(body.acceptance_criteria)
			: undefined,
		risk_notes: Array.isArray(body.risk_notes)
			? asStringArray(body.risk_notes)
			: undefined,
		tags: Array.isArray(body.tags) ? asStringArray(body.tags) : undefined,
		links: Array.isArray(body.links)
			? (body.links as Array<{ label: string; path?: string; url?: string }>)
			: undefined,
		todo_outputs: Array.isArray(body.todo_outputs)
			? asStringArray(body.todo_outputs)
			: undefined,
		planning_target: body.planning_target as
			| { scope: string; todo_tasks_path?: string }
			| undefined,
		proposed_tasks: Array.isArray(body.proposed_tasks)
			? (body.proposed_tasks as Array<{
					title: string;
					summary: string;
					priority?: "high" | "medium" | "low";
				}>)
			: undefined,
		decisions: Array.isArray(body.decisions)
			? (body.decisions as Array<{
					date: string;
					decision: string;
					rationale?: string;
				}>)
			: undefined,
		outcome: typeof body.outcome === "string" ? body.outcome : undefined,
	});
	if (!result.ok) {
		return Response.json({ error: result.error }, { status: 404 });
	}
	if (!result.validation.ok) {
		return Response.json(
			{
				record: result.record,
				validation: result.validation,
				errors: result.validation.errors,
			},
			{ status: 422 },
		);
	}
	return Response.json({ record: result.record, validation: result.validation });
}

async function handleValidatePlan(req: Request): Promise<Response> {
	const body = readPayload(await safeJson(req));
	const validation = await validateFeaturePlan(body);
	return Response.json(validation);
}

async function handleExportPlan(id: string): Promise<Response> {
	const record = await getPlanById(id);
	if (!record) {
		return Response.json({ error: "not_found" }, { status: 404 });
	}
	if (!record.validation.ok) {
		return Response.json(
			{
				error: "plan_invalid",
				validation: record.validation,
			},
			{ status: 422 },
		);
	}
	const result = await buildExportProposal(record);
	return Response.json(result);
}

async function handleSchema(): Promise<Response> {
	const schema = await loadFeaturePlanSchema();
	return Response.json(schema);
}

async function handleWorkBoard(): Promise<Response> {
	return Response.json({ board: await buildWorkBoard() });
}

async function handleEntityIndex(): Promise<Response> {
	const snapshots = await snapshotAllEntities();
	const total = snapshots.reduce((sum, snapshot) => sum + snapshot.count, 0);
	const invalid = snapshots.reduce((sum, snapshot) => sum + snapshot.invalid, 0);
	return Response.json({
		types: getEntityTypes(),
		total,
		invalid,
		snapshots,
	});
}

async function handleEntityList(type: string): Promise<Response> {
	if (!isEntityType(type)) {
		return Response.json({ error: "unknown_entity_type" }, { status: 404 });
	}
	const snapshot = await snapshotEntityType(type);
	return Response.json(snapshot);
}

async function handleEntityDetail(
	type: string,
	id: string,
): Promise<Response> {
	if (!isEntityType(type)) {
		return Response.json({ error: "unknown_entity_type" }, { status: 404 });
	}
	const record = await getEntityById(type, id);
	if (!record) {
		return Response.json({ error: "not_found" }, { status: 404 });
	}
	return Response.json({ record });
}

async function handleViewResults(id: string): Promise<Response> {
	const result = await getViewResults(id);
	if (!result) {
		return Response.json({ error: "not_found" }, { status: 404 });
	}
	return Response.json({ result });
}

async function handleEntitySchema(type: string): Promise<Response> {
	if (!isEntityType(type)) {
		return Response.json({ error: "unknown_entity_type" }, { status: 404 });
	}
	const schema = await loadSchema(type);
	return Response.json(schema);
}

function entityRoute(
	pathname: string,
	prefix: string,
): { type: string; id?: string } | null {
	const match = pathname.match(
		new RegExp(`^${prefix}/([^/]+)(?:/([^/]+))?$`),
	);
	if (!match) return null;
	const type = decodeURIComponent(match[1] ?? "");
	const id = match[2] ? decodeURIComponent(match[2]) : undefined;
	return { type, id };
}

async function safeJson(req: Request): Promise<unknown> {
	try {
		return await req.json();
	} catch {
		return {};
	}
}

function notFound(): Response {
	return new Response("Nenalezeno", { status: 404 });
}

function planRouteId(pathname: string, suffix = ""): string | null {
	const match = pathname.match(
		new RegExp(`^/api/plans/([^/]+)${suffix ? `/${suffix}` : ""}$`),
	);
	return match ? decodeURIComponent(match[1]) : null;
}

function viewResultsRouteId(pathname: string): string | null {
	const match = pathname.match(/^\/api\/views\/([^/]+)\/results$/);
	return match ? decodeURIComponent(match[1]) : null;
}

async function handle(req: Request): Promise<Response> {
	const url = new URL(req.url);
	const pathname = url.pathname;

	if (pathname === "/health") {
		const [plans, entitySnapshots] = await Promise.all([
			listPlans(),
			snapshotAllEntities(),
		]);
		const entityTotal = entitySnapshots.reduce(
			(sum, snapshot) => sum + snapshot.count,
			0,
		);
		const entityInvalid = entitySnapshots.reduce(
			(sum, snapshot) => sum + snapshot.invalid,
			0,
		);
		return Response.json({
			ok: true,
			app: "mission-control",
			plans: plans.length,
			invalid_plans: plans.filter((record) => !record.validation.ok).length,
			entities: entityTotal,
			invalid_entities: entityInvalid,
			entity_types: entitySnapshots.map((snapshot) => ({
				type: snapshot.type,
				count: snapshot.count,
				invalid: snapshot.invalid,
			})),
		});
	}

	if (pathname === "/api/schema" && req.method === "GET") {
		return handleSchema();
	}

	if (pathname === "/api/work-board" && req.method === "GET") {
		return handleWorkBoard();
	}

	const viewResultsId = viewResultsRouteId(pathname);
	if (viewResultsId && req.method === "GET") {
		return handleViewResults(viewResultsId);
	}

	if (pathname === "/api/entities" && req.method === "GET") {
		return handleEntityIndex();
	}

	const schemaMatch = entityRoute(pathname, "/api/schemas");
	if (schemaMatch && !schemaMatch.id && req.method === "GET") {
		return handleEntitySchema(schemaMatch.type);
	}

	const entityMatch = entityRoute(pathname, "/api/entities");
	if (entityMatch && req.method === "GET") {
		return entityMatch.id
			? handleEntityDetail(entityMatch.type, entityMatch.id)
			: handleEntityList(entityMatch.type);
	}

	if (pathname === "/api/plans") {
		if (req.method === "GET") return handleListPlans();
		if (req.method === "POST") return handleCreatePlan(req);
	}

	if (pathname === "/api/plans/validate" && req.method === "POST") {
		return handleValidatePlan(req);
	}

	const exportId = planRouteId(pathname, "export");
	if (exportId && req.method === "POST") {
		return handleExportPlan(exportId);
	}

	const planId = planRouteId(pathname);
	if (planId) {
		if (req.method === "GET") return handleGetPlan(planId);
		if (req.method === "PUT") return handleUpdatePlan(planId, req);
	}

	if (pathname === "/") {
		return new Response(renderApp(), {
			headers: { "Content-Type": "text/html; charset=utf-8" },
		});
	}

	return notFound();
}

const host = serverHost();
const port = serverPort();

Bun.serve({
	hostname: host,
	port,
	fetch: handle,
	error(error) {
		console.error("[mission-control]", error);
		return Response.json(
			{ error: "internal_error", message: String(error) },
			{ status: 500 },
		);
	},
});

console.log(`Mission Control listening on http://${host}:${port}`);
