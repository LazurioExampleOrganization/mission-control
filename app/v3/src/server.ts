import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { type Listener, listener, ModuleKitError, onShutdown } from '@lazurio/module-kit';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { buildCurrentAgentWorkResponse } from './agent-work.ts';
import { buildNewPlanDraft } from './create-plan.ts';
import { buildNewRoadmapDraft, RoadmapCreateDraftError } from './create-roadmap.ts';
import { nextDevCode } from './dev-code.ts';
import { buildTodoExportProposal } from './export-todo.ts';
import { IssueResolutionError } from './issue-resolution.ts';
import {
	defaultPriorityRank,
	type MissionControlPlan,
	PLAN_PRIORITIES,
	PLAN_STATUSES,
	type PlanPriority,
	type PlanStatus,
} from './model.ts';
import { IS_REPOSITORY_DB_MODE, missionRelative, workspaceRelative } from './paths.ts';
import { buildProposalsResponse, PROPOSAL_FILES_PREFIX, serveProposalFile } from './proposals.ts';
import {
	handleRepositoryChangesetCreate,
	handleRepositoryChangesetDiscard,
	handleRepositoryChangesetPublish,
	handleRepositoryFreshness,
	handleRepositoryPull,
	handleRepositoryStatus,
} from './repository-api.ts';
import { buildRoadmapStepDraft, RoadmapStepDraftError } from './roadmap-step-draft.ts';
import { buildRoadmapsResponse } from './roadmaps.ts';
import {
	getPlanByIdOrDevCode,
	listPlanRecords,
	listPlanRecordsForValidation,
	planFilePathForDevCode,
	updatePlanYaml,
	writePlan,
} from './store.ts';
import {
	loadPlanSchema,
	planQualityErrors,
	validatePlanRecords,
	validatePlanShape,
	validatePlanUpdate,
} from './validate.ts';
import { buildPlanWork, buildWorkBoard } from './work-board.ts';

const DIST_DIR = resolve(import.meta.dir, '..', 'dist');
const MIME: Record<string, string> = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'application/javascript; charset=utf-8',
	'.mjs': 'application/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.ico': 'image/x-icon',
	'.json': 'application/json; charset=utf-8',
};

async function safeJson(
	req: Request,
): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
	try {
		return { ok: true, value: await req.json() };
	} catch (error) {
		return {
			ok: false,
			response: Response.json(
				{
					error: 'invalid_json',
					message: error instanceof Error ? error.message : String(error),
				},
				{ status: 400 },
			),
		};
	}
}

function isObject(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function parseOption<T extends string>(
	value: unknown,
	options: readonly T[],
	field: string,
	fallback: T,
): { ok: true; value: T } | { ok: false; response: Response } {
	if (value === undefined || value === null || value === '') {
		return { ok: true, value: fallback };
	}
	if (typeof value === 'string' && (options as readonly string[]).includes(value)) {
		return { ok: true, value: value as T };
	}
	return {
		ok: false,
		response: Response.json(
			{
				error: 'invalid_enum',
				message: `${field} musí být jedna z hodnot: ${options.join(', ')}`,
			},
			{ status: 400 },
		),
	};
}

function positiveInteger(value: unknown, fallback: number): number {
	const number = Number(value);
	return Number.isInteger(number) && number > 0 ? number : fallback;
}

function repositoryDbDirectWriteBlocked(): Response | null {
	if (!IS_REPOSITORY_DB_MODE) return null;
	return Response.json(
		{
			error: 'repository_db_changeset_required',
			message:
				'Kanonická Mission Control data v repository-db režimu upravte jako lokální draft na stránce Repository a poté je publikujte.',
		},
		{ status: 409 },
	);
}

async function createPlanFromYaml(yaml: string): Promise<Response> {
	const writeBlock = repositoryDbDirectWriteBlocked();
	if (writeBlock) return writeBlock;
	let parsed: unknown;
	try {
		parsed = parseYaml(yaml);
	} catch (error) {
		return Response.json(
			{
				error: 'invalid_yaml',
				message: error instanceof Error ? error.message : String(error),
			},
			{ status: 422 },
		);
	}
	const validation = validatePlanShape(parsed);
	if (!validation.ok) {
		return Response.json({ validation, errors: validation.errors }, { status: 422 });
	}
	const plan = parsed as MissionControlPlan;
	if (await getPlanByIdOrDevCode(plan.dev_code)) {
		return Response.json(
			{ error: 'plan_exists', message: `Plan ${plan.dev_code} už existuje.` },
			{ status: 409 },
		);
	}
	const qualityErrors = planQualityErrors(plan);
	if (qualityErrors.length > 0) {
		return Response.json(
			{
				validation: { ok: false, errors: qualityErrors },
				errors: qualityErrors,
			},
			{ status: 422 },
		);
	}
	const filePath = planFilePathForDevCode(plan.dev_code, plan.title);
	const records = await listPlanRecords();
	const futureValidation = validatePlanRecords([
		...records,
		{
			plan,
			absolutePath: filePath,
			relativePath: missionRelative(filePath),
			workspacePath: workspaceRelative(filePath),
		},
	]);
	if (!futureValidation.ok) {
		return Response.json(
			{ validation: futureValidation, errors: futureValidation.errors },
			{ status: 422 },
		);
	}
	await writePlan(plan, filePath);
	const record = await getPlanByIdOrDevCode(plan.dev_code);
	if (!record) {
		return Response.json({ error: 'created_plan_not_found' }, { status: 500 });
	}
	return Response.json(
		{ record, yaml: await readFile(record.absolutePath, 'utf8'), validation: futureValidation },
		{ status: 201 },
	);
}

async function handlePlanDetail(id: string): Promise<Response> {
	const record = await getPlanByIdOrDevCode(id);
	if (!record) return Response.json({ error: 'not_found' }, { status: 404 });
	const yaml = await readFile(record.absolutePath, 'utf8');
	return Response.json({ ...record, yaml });
}

async function handlePlanUpdate(id: string, req: Request): Promise<Response> {
	const writeBlock = repositoryDbDirectWriteBlocked();
	if (writeBlock) return writeBlock;
	const record = await getPlanByIdOrDevCode(id);
	if (!record) return Response.json({ error: 'not_found' }, { status: 404 });
	const parsedBody = await safeJson(req);
	if (!parsedBody.ok) return parsedBody.response;
	const body = parsedBody.value as { yaml?: unknown } | null;
	if (!body || typeof body.yaml !== 'string') {
		return Response.json({ error: 'yaml_required' }, { status: 400 });
	}
	let parsed: unknown;
	try {
		parsed = parseYaml(body.yaml);
	} catch (error) {
		return Response.json(
			{
				error: 'invalid_yaml',
				message: error instanceof Error ? error.message : String(error),
			},
			{ status: 422 },
		);
	}
	const validation = validatePlanShape(parsed);
	if (!validation.ok) {
		return Response.json({ validation, errors: validation.errors }, { status: 422 });
	}
	const plan = parsed as MissionControlPlan;
	if (plan.id !== record.plan.id || plan.dev_code !== record.plan.dev_code) {
		return Response.json(
			{
				error: 'immutable_identity',
				message: 'Plan id a dev_code nejde měnit přes editor bez rename/migration flow.',
			},
			{ status: 409 },
		);
	}
	const futureValidation = validatePlanUpdate(await listPlanRecords(), record.absolutePath, plan);
	if (!futureValidation.ok) {
		return Response.json(
			{ validation: futureValidation, errors: futureValidation.errors },
			{ status: 422 },
		);
	}
	await updatePlanYaml(record.absolutePath, body.yaml);
	const updated = await getPlanByIdOrDevCode(plan.dev_code);
	return Response.json({ record: updated, validation: futureValidation });
}

async function handlePlanCreate(req: Request): Promise<Response> {
	const parsedBody = await safeJson(req);
	if (!parsedBody.ok) return parsedBody.response;
	const body = parsedBody.value;
	if (!isObject(body)) {
		return Response.json({ error: 'json_required' }, { status: 400 });
	}
	if (typeof body.yaml === 'string') {
		return createPlanFromYaml(body.yaml);
	}
	const title = typeof body.title === 'string' ? body.title.trim() : '';
	if (!title) {
		return Response.json(
			{ error: 'title_required', message: 'Název plánu je povinný.' },
			{ status: 400 },
		);
	}
	const todoTasksPath =
		typeof body.todo_tasks_path === 'string' && body.todo_tasks_path.trim()
			? body.todo_tasks_path.trim()
			: undefined;
	const parsedPriority = parseOption<PlanPriority>(
		body.priority,
		PLAN_PRIORITIES,
		'priority',
		'medium',
	);
	if (!parsedPriority.ok) return parsedPriority.response;
	const parsedStatus = parseOption<PlanStatus>(body.status, PLAN_STATUSES, 'status', 'shaping');
	if (!parsedStatus.ok) return parsedStatus.response;
	const priority = parsedPriority.value;
	const status = parsedStatus.value;
	let draft: Awaited<ReturnType<typeof buildNewPlanDraft>>;
	try {
		draft = await buildNewPlanDraft({
			title,
			owner: typeof body.owner === 'string' && body.owner.trim() ? body.owner.trim() : undefined,
			status,
			priority,
			priorityRank: positiveInteger(body.priority_rank, defaultPriorityRank(priority)),
			todoTasksPath,
			scope:
				typeof body.scope === 'string' && body.scope.trim()
					? body.scope.trim()
					: 'companiesascode-root',
		});
	} catch (error) {
		return Response.json(
			{
				error: 'create_failed',
				message: error instanceof Error ? error.message : String(error),
			},
			{ status: 422 },
		);
	}
	const records = await listPlanRecords();
	const futureRecords = [
		...records,
		{
			plan: draft.plan,
			absolutePath: draft.path,
			relativePath: missionRelative(draft.path),
			workspacePath: workspaceRelative(draft.path),
		},
	];
	const futureValidation = validatePlanRecords(futureRecords);
	if (body.dry_run === true) {
		// Dry-run nesmí spadnout na kurátorských quality errors: draft záměrně
		// obsahuje placeholdery, které kolega doplní až v YAML editoru.
		// Shape/identity chyby (schéma, duplicitní kódy) blokují i dry-run.
		const blockingValidation = validatePlanRecords(futureRecords, { quality: false });
		if (!blockingValidation.ok) {
			return Response.json(
				{ validation: blockingValidation, errors: blockingValidation.errors },
				{ status: 422 },
			);
		}
		return Response.json({
			status: 'dry-run',
			dev_code: draft.plan.dev_code,
			plan_path: workspaceRelative(draft.path),
			plan: draft.plan,
			yaml: stringifyYaml(draft.plan),
			// Plný report včetně quality gate je informativní, ne blokační.
			validation: futureValidation,
		});
	}
	const writeBlock = repositoryDbDirectWriteBlocked();
	if (writeBlock) return writeBlock;
	if (!futureValidation.ok) {
		return Response.json(
			{ validation: futureValidation, errors: futureValidation.errors },
			{ status: 422 },
		);
	}
	const qualityErrors = planQualityErrors(draft.plan);
	if (qualityErrors.length > 0) {
		return Response.json(
			{
				validation: { ok: false, errors: qualityErrors },
				errors: qualityErrors,
			},
			{ status: 422 },
		);
	}
	await writePlan(draft.plan, draft.path);
	const record = await getPlanByIdOrDevCode(draft.plan.dev_code);
	if (!record) {
		return Response.json({ error: 'created_plan_not_found' }, { status: 500 });
	}
	return Response.json(
		{
			record,
			yaml: await readFile(record.absolutePath, 'utf8'),
			validation: futureValidation,
		},
		{ status: 201 },
	);
}

async function handleRoadmapStepDraft(roadmapCode: string, req: Request): Promise<Response> {
	const parsedBody = await safeJson(req);
	if (!parsedBody.ok) return parsedBody.response;
	const body = parsedBody.value;
	if (!isObject(body)) {
		return Response.json({ error: 'json_required' }, { status: 400 });
	}
	try {
		return Response.json(await buildRoadmapStepDraft(roadmapCode, body));
	} catch (error) {
		if (error instanceof RoadmapStepDraftError) {
			return Response.json({ error: error.code, message: error.message }, { status: error.status });
		}
		return Response.json(
			{
				error: 'roadmap_step_draft_failed',
				message: error instanceof Error ? error.message : String(error),
			},
			{ status: 500 },
		);
	}
}

async function handleRoadmapDraft(req: Request): Promise<Response> {
	const parsedBody = await safeJson(req);
	if (!parsedBody.ok) return parsedBody.response;
	const body = parsedBody.value;
	if (!isObject(body)) {
		return Response.json({ error: 'json_required' }, { status: 400 });
	}
	try {
		return Response.json(buildNewRoadmapDraft(body));
	} catch (error) {
		if (error instanceof RoadmapCreateDraftError) {
			return Response.json({ error: error.code, message: error.message }, { status: error.status });
		}
		return Response.json(
			{
				error: 'roadmap_draft_failed',
				message: error instanceof Error ? error.message : String(error),
			},
			{ status: 500 },
		);
	}
}

function handleIssueResolve(): Response {
	const error = new IssueResolutionError();
	return Response.json({ error: error.code, message: error.message }, { status: error.status });
}

async function validateAllPlanFiles() {
	const { records, errors: fileErrors } = await listPlanRecordsForValidation();
	const validation = validatePlanRecords(records);
	const errors = [...fileErrors, ...validation.errors];
	return { ok: errors.length === 0, errors };
}

function decodePathSegment(value: string): string | null {
	try {
		return decodeURIComponent(value);
	} catch {
		return null;
	}
}

async function serveStatic(pathname: string): Promise<Response | null> {
	const cleaned = decodePathSegment(pathname === '/' ? '/index.html' : pathname);
	if (cleaned === null) return null;
	const safe = normalize(cleaned).replace(/^[\\/]+/, '');
	if (safe.includes('..')) return null;
	const filePath = join(DIST_DIR, safe);
	if (!filePath.startsWith(`${DIST_DIR}${sep}`) && filePath !== DIST_DIR) {
		return null;
	}
	try {
		const stats = await stat(filePath);
		if (!stats.isFile()) {
			if (stats.isDirectory()) {
				const fallback = join(filePath, 'index.html');
				const fallbackStats = await stat(fallback).catch(() => null);
				if (fallbackStats?.isFile()) {
					return new Response(await readFile(fallback), {
						headers: {
							'content-type': 'text/html; charset=utf-8',
							'x-content-type-options': 'nosniff',
						},
					});
				}
			}
			return null;
		}
		const ext = extname(filePath).toLowerCase();
		const headers: Record<string, string> = {
			'content-type': MIME[ext] ?? 'application/octet-stream',
			'x-content-type-options': 'nosniff',
		};
		return new Response(await readFile(filePath), { headers });
	} catch {
		return null;
	}
}

const API_WRITE_METHODS = new Set(['POST', 'PUT', 'DELETE']);

export type LocalHttpSecurityContext = {
	allowedHosts: ReadonlySet<string>;
	allowedOrigins: ReadonlySet<string>;
	sessionToken: string;
};

function hostWithPort(host: string, port: number): string {
	return host.includes(':') && !host.startsWith('[') ? `[${host}]:${port}` : `${host}:${port}`;
}

// DNS name of lowercase labels (letters, digits, inner hyphens), at least two
// labels, alphabetic TLD. Rejects IP literals, uppercase and IDN/punycode-free
// unicode so the allowlist only ever carries the exact hosted hostname.
const EXTERNAL_ORIGIN_HOSTNAME =
	/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Parses the hosted external origin injected by Launchpad
 * (`LAZURIO_RUNTIME_LISTENER_WEB_EXTERNAL_ORIGIN`). Fails closed: anything that
 * is not exactly an absolute `https://<dns-name>[:port]` origin is rejected so
 * a misconfigured gateway can never widen the Host/Origin allowlist.
 */
export function parseExternalOrigin(value: string): { host: string; origin: string } {
	const reject = (reason: string): never => {
		throw new Error(
			`Neplatný LAZURIO_RUNTIME_LISTENER_WEB_EXTERNAL_ORIGIN "${value}": ${reason}. Očekává se absolutní https origin bez cesty, např. https://mission-control.<vm>.<organization>.lazurio.io.`,
		);
	};
	if (value.trim() !== value || value === '') {
		return reject('hodnota je prázdná nebo obsahuje okrajové bílé znaky');
	}
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return reject('hodnota není parsovatelná URL');
	}
	if (url.protocol !== 'https:') {
		return reject('povolený je pouze protokol https');
	}
	if (url.port !== '') {
		return reject(
			'origin nesmí obsahovat port; decision 0146 dává aplikaci jen https://<app>.<vm>.<organization>.lazurio.io',
		);
	}
	if (url.username !== '' || url.password !== '') {
		return reject('origin nesmí obsahovat uživatelské jméno ani heslo');
	}
	if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
		return reject('origin nesmí obsahovat cestu, query ani fragment');
	}
	if (!EXTERNAL_ORIGIN_HOSTNAME.test(url.hostname)) {
		return reject('hostname musí být DNS jméno z lowercase labelů');
	}
	if (url.hostname === 'localhost' || url.hostname.endsWith('.localhost')) {
		return reject('hostname nesmí být loopback jméno localhost ani *.localhost');
	}
	if (value !== url.origin) {
		return reject(
			'hodnota se musí přesně rovnat svému origin (bez koncového lomítka a bez výchozího portu)',
		);
	}
	return { host: url.host, origin: url.origin };
}

export function createLocalHttpSecurityContext({
	host,
	port,
	externalOrigin,
	sessionToken = randomBytes(32).toString('base64url'),
}: {
	host: string;
	port: number;
	externalOrigin?: string;
	sessionToken?: string;
}): LocalHttpSecurityContext {
	if (!isLoopbackHost(host)) {
		throw new Error('Mission Control HTTP security context vyžaduje loopback host.');
	}
	const origin = `http://${hostWithPort(host, port)}`;
	const allowedHosts = new Set([new URL(origin).host]);
	const allowedOrigins = new Set([origin]);
	if (externalOrigin !== undefined) {
		// Hosted profile: the gateway forwards the original Host and the browser
		// sends the public https origin; the bind stays loopback-only.
		const external = parseExternalOrigin(externalOrigin);
		allowedHosts.add(external.host);
		allowedOrigins.add(external.origin);
	}
	return {
		allowedHosts,
		allowedOrigins,
		sessionToken,
	};
}

function tokenMatches(actual: string | null, expected: string): boolean {
	if (actual === null) return false;
	const left = Buffer.from(actual);
	const right = Buffer.from(expected);
	return left.length === right.length && timingSafeEqual(left, right);
}

function guardLocalRequest(
	req: Request,
	pathname: string,
	security: LocalHttpSecurityContext,
): Response | null {
	const host = req.headers.get('host') ?? new URL(req.url).host;
	if (!security.allowedHosts.has(host)) {
		return Response.json(
			{
				error: 'forbidden_host',
				message: 'Mission Control odmítl hostname mimo pevný lokální allowlist.',
			},
			{ status: 403 },
		);
	}
	if (!pathname.startsWith('/api/') || !API_WRITE_METHODS.has(req.method)) {
		return null;
	}
	const origin = req.headers.get('origin');
	if (origin === null || !security.allowedOrigins.has(origin)) {
		return Response.json(
			{
				error: 'forbidden_origin',
				message: 'Zápisové API vyžaduje přesný Origin lokálního Mission Control UI.',
			},
			{ status: 403 },
		);
	}
	if (!tokenMatches(req.headers.get('x-mission-control-session'), security.sessionToken)) {
		return Response.json(
			{
				error: 'invalid_local_session',
				message: 'Lokální Mission Control session vypršela; obnovte aplikaci.',
			},
			{ status: 403 },
		);
	}
	const contentType = req.headers.get('content-type') ?? '';
	if (!contentType.trim().toLowerCase().startsWith('application/json')) {
		return Response.json(
			{
				error: 'unsupported_media_type',
				message: 'Zápisové API vyžaduje content-type application/json.',
			},
			{ status: 415 },
		);
	}
	return null;
}

export async function route(
	req: Request,
	security: LocalHttpSecurityContext | null = null,
): Promise<Response> {
	const url = new URL(req.url);
	const pathname = url.pathname;
	if (!security && pathname.startsWith('/api/') && API_WRITE_METHODS.has(req.method)) {
		return Response.json(
			{
				error: 'local_security_context_required',
				message: 'Zápisové API není dostupné bez lokálního HTTP security contextu.',
			},
			{ status: 503 },
		);
	}
	const writeGuard = security ? guardLocalRequest(req, pathname, security) : null;
	if (writeGuard) return writeGuard;
	if (pathname === '/api/session' && req.method === 'GET') {
		if (!security) {
			return Response.json({ error: 'session_unavailable' }, { status: 503 });
		}
		return Response.json(
			{ token: security.sessionToken },
			{ headers: { 'cache-control': 'no-store' } },
		);
	}
	if (pathname === '/api/plans' && req.method === 'GET') {
		return Response.json({ records: await listPlanRecords() });
	}
	if (pathname === '/api/roadmaps' && req.method === 'GET') {
		return Response.json(buildRoadmapsResponse());
	}
	if (pathname === '/api/roadmaps/draft' && req.method === 'POST') {
		return handleRoadmapDraft(req);
	}
	const roadmapStepDraftMatch = pathname.match(/^\/api\/roadmaps\/([^/]+)\/steps\/draft$/);
	if (roadmapStepDraftMatch && req.method === 'POST') {
		const roadmapCode = decodePathSegment(roadmapStepDraftMatch[1]);
		if (!roadmapCode) return Response.json({ error: 'malformed_roadmap_code' }, { status: 400 });
		return handleRoadmapStepDraft(roadmapCode, req);
	}
	if (pathname === '/api/plans' && req.method === 'POST') {
		return handlePlanCreate(req);
	}
	if (pathname === '/api/next-dev-code' && req.method === 'GET') {
		const result = await nextDevCode();
		return Response.json(
			url.searchParams.has('reservations')
				? result
				: {
						next_dev_code: result.next_dev_code,
						highest_known: result.highest_known,
						reserved_count: result.reserved_count,
					},
		);
	}
	if (pathname === '/api/schema' && req.method === 'GET') {
		return Response.json(await loadPlanSchema());
	}
	if (pathname === '/api/validate' && req.method === 'GET') {
		return Response.json(await validateAllPlanFiles());
	}
	if (pathname === '/api/repository/status' && req.method === 'GET') {
		return handleRepositoryStatus();
	}
	if (pathname === '/api/repository/freshness' && req.method === 'GET') {
		// fetch=0 (default true) umí volající vypnout, když chce jen levný
		// lokální snapshot bez network fetch (např. rychlý polling tick).
		return handleRepositoryFreshness(undefined, url.searchParams.get('fetch') !== '0');
	}
	if (pathname === '/api/repository/pull' && req.method === 'POST') {
		return handleRepositoryPull();
	}
	if (pathname === '/api/repository/changesets' && req.method === 'POST') {
		return handleRepositoryChangesetCreate(req);
	}
	const repositoryChangesetMatch = pathname.match(/^\/api\/repository\/changesets\/([^/]+)$/);
	if (repositoryChangesetMatch && req.method === 'DELETE') {
		const changesetId = decodePathSegment(repositoryChangesetMatch[1]);
		if (!changesetId) return Response.json({ error: 'malformed_changeset_id' }, { status: 400 });
		return handleRepositoryChangesetDiscard(changesetId);
	}
	const repositoryChangesetActionMatch = pathname.match(
		/^\/api\/repository\/changesets\/([^/]+)\/publish$/,
	);
	if (repositoryChangesetActionMatch && req.method === 'POST') {
		const changesetId = decodePathSegment(repositoryChangesetActionMatch[1]);
		if (!changesetId) return Response.json({ error: 'malformed_changeset_id' }, { status: 400 });
		return handleRepositoryChangesetPublish(changesetId, req);
	}
	if (pathname === '/api/work-board' && req.method === 'GET') {
		return Response.json({ board: await buildWorkBoard() });
	}
	if (pathname === '/api/proposals' && req.method === 'GET') {
		return Response.json(buildProposalsResponse());
	}
	if (pathname.startsWith(PROPOSAL_FILES_PREFIX) && req.method === 'GET') {
		return serveProposalFile(pathname);
	}
	if (pathname === '/api/agent-work' && req.method === 'GET') {
		try {
			return Response.json(await buildCurrentAgentWorkResponse());
		} catch (error) {
			return Response.json(
				{
					error: 'agent_work_failed',
					message: error instanceof Error ? error.message : String(error),
				},
				{ status: 500 },
			);
		}
	}
	if (pathname === '/api/issues/resolve' && req.method === 'POST') {
		return handleIssueResolve();
	}
	const exportMatch = pathname.match(/^\/api\/plans\/([^/]+)\/export$/);
	if (exportMatch && req.method === 'GET') {
		const id = decodePathSegment(exportMatch[1]);
		if (!id) return Response.json({ error: 'malformed_plan_id' }, { status: 400 });
		try {
			return Response.json(await buildTodoExportProposal(id));
		} catch (error) {
			return Response.json(
				{
					error: 'export_failed',
					message: error instanceof Error ? error.message : String(error),
				},
				{ status: 422 },
			);
		}
	}
	const workMatch = pathname.match(/^\/api\/plans\/([^/]+)\/work$/);
	if (workMatch && req.method === 'GET') {
		const id = decodePathSegment(workMatch[1]);
		if (!id) return Response.json({ error: 'malformed_plan_id' }, { status: 400 });
		const record = await getPlanByIdOrDevCode(id);
		if (!record) return Response.json({ error: 'not_found' }, { status: 404 });
		try {
			return Response.json({ work: await buildPlanWork(record) });
		} catch (error) {
			return Response.json(
				{
					error: 'work_failed',
					message: error instanceof Error ? error.message : String(error),
				},
				{ status: 500 },
			);
		}
	}
	const detailMatch = pathname.match(/^\/api\/plans\/([^/]+)$/);
	if (detailMatch && req.method === 'GET') {
		const id = decodePathSegment(detailMatch[1]);
		if (!id) return Response.json({ error: 'malformed_plan_id' }, { status: 400 });
		return handlePlanDetail(id);
	}
	if (detailMatch && req.method === 'PUT') {
		const id = decodePathSegment(detailMatch[1]);
		if (!id) return Response.json({ error: 'malformed_plan_id' }, { status: 400 });
		return handlePlanUpdate(id, req);
	}
	if (req.method === 'GET' && !pathname.startsWith('/api/')) {
		const staticResponse = await serveStatic(pathname);
		if (staticResponse) return staticResponse;
		// SPA fallback: requesty bez extenze (např. /plans/<kód plánu>) směruj
		// na index.html, aby React router uměl převzít routu.
		if (!extname(pathname)) {
			const fallback = await serveStatic('/index.html');
			if (fallback) return fallback;
		}
	}
	return Response.json({ error: 'not_found' }, { status: 404 });
}

function isLoopbackHost(host: string): boolean {
	return host === '127.0.0.1' || host === '::1' || host === 'localhost';
}

async function fetchWithErrors(
	req: Request,
	security: LocalHttpSecurityContext,
): Promise<Response> {
	try {
		return await route(req, security);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(
			'[mission-control] request failed',
			req.method,
			new URL(req.url).pathname,
			message,
		);
		return Response.json({ error: 'internal_error', message }, { status: 500 });
	}
}

/** Exit code for every start-time configuration error (Lazurio Module Standard 4.2). */
const CONFIGURATION_ERROR_EXIT = 2;

function exitOnConfigurationError(message: string): never {
	console.error(`[mission-control] ${message}`);
	process.exit(CONFIGURATION_ERROR_EXIT);
}

type StartConfiguration = {
	host: string;
	port: number;
	externalOrigin: string | undefined;
	security: LocalHttpSecurityContext;
};

/**
 * Host and port come only from the Launchpad's listener environment
 * (`LAZURIO_RUNTIME_LISTENER_WEB_HOST`/`_PORT`, Lazurio Module Standard 4.2).
 * On a hosted Environment (decision 0146) Launchpad also injects
 * `LAZURIO_RUNTIME_LISTENER_WEB_EXTERNAL_ORIGIN`; the local profile leaves it
 * unset (an empty value counts as unset) and any other value is validated
 * fail-closed by module-kit and then by parseExternalOrigin. Every invalid or
 * missing value - listener variables, a non-loopback host, either class of
 * invalid origin - stops the start with the same configuration-error exit 2.
 */
function startConfiguration(): StartConfiguration {
	let web: Listener;
	try {
		web = listener('web');
	} catch (error) {
		if (!(error instanceof ModuleKitError)) throw error;
		return exitOnConfigurationError(`Start through the Lazurio lifecycle: ${error.message}`);
	}
	const { host, port } = web;
	if (!isLoopbackHost(host)) {
		// Server nemá auth a nese write routy; mimo loopback se nesmí spustit.
		return exitOnConfigurationError(
			`Chyba: bind na ${host}:${port} by vystavil write API bez autentizace mimo loopback. Server se spouští jen na 127.0.0.1, ::1 nebo localhost.`,
		);
	}
	const externalOrigin = web.externalOrigin ?? undefined;
	try {
		return {
			host,
			port,
			externalOrigin,
			security: createLocalHttpSecurityContext({ host, port, externalOrigin }),
		};
	} catch (error) {
		return exitOnConfigurationError(error instanceof Error ? error.message : String(error));
	}
}

function startServer(): void {
	const { host, port, externalOrigin, security } = startConfiguration();
	const server = Bun.serve({
		hostname: host,
		port,
		fetch: (req) => fetchWithErrors(req, security),
		error(error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error('[mission-control] unhandled server error', message);
			return Response.json({ error: 'internal_error', message }, { status: 500 });
		},
	});
	onShutdown(() => server.stop(true));

	console.log(`Mission Control v3 running at http://${server.hostname}:${server.port}`);
	if (externalOrigin !== undefined) {
		console.log(`Mission Control v3 accepts hosted origin ${externalOrigin}`);
	}
}

if (import.meta.main) {
	startServer();
}
