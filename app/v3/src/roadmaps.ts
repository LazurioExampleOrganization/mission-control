import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
	IS_REPOSITORY_DB_MODE,
	MISSION_CONTROL_DATA_ROOT,
	MISSION_CONTROL_ROOT,
	PLAN_CODE_RE,
	WORKSPACE_ROOT,
} from './paths.ts';
import { portableRelativePath } from './portable-path.ts';
import type {
	MissionControlRoadmap,
	RoadmapAgentLane,
	RoadmapIssueBlocker,
	RoadmapLinkedWorkItem,
	RoadmapNextStep,
	RoadmapReleaseGate,
	RoadmapResolutionEvidence,
	RoadmapRuntimeLane,
	RoadmapsApiResponse,
} from './roadmap-model.ts';
import {
	buildRoadmapExecutionReport,
	loadMissionControlConfig,
	loadPlans,
	loadRoadmaps,
	validatePlanRecords,
	validateRoadmapRecords,
} from './vendor/mission-control-lib.ts';

type RootRoadmapRecord = {
	path: string;
	filePath: string;
	roadmap: unknown;
	parseError: string | null;
};

function isRoadmap(value: unknown): value is MissionControlRoadmap {
	return Boolean(
		value &&
			typeof value === 'object' &&
			'roadmap_code' in value &&
			typeof (value as { roadmap_code?: unknown }).roadmap_code === 'string',
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

type ConfiguredLedgerKey =
	| 'issues_open_path'
	| 'issues_resolved_path'
	| 'todo_tasks_path'
	| 'done_tasks_path';

const LEDGER_FALLBACKS: Record<
	ConfiguredLedgerKey,
	{ compatibility: string; repositoryDb: string }
> = {
	issues_open_path: {
		compatibility: 'ISSUES.open.json',
		repositoryDb: 'data/mission-control/ISSUES.open.json',
	},
	issues_resolved_path: {
		compatibility: 'ISSUES.resolved.json',
		repositoryDb: 'data/mission-control/ISSUES.resolved.json',
	},
	todo_tasks_path: {
		compatibility: 'TODO.tasks.json',
		repositoryDb: 'data/mission-control/TODO.tasks.json',
	},
	done_tasks_path: {
		compatibility: 'DONE.tasks.json',
		repositoryDb: 'data/mission-control/DONE.tasks.json',
	},
};

export function configuredLedgerRelativePath(
	config: unknown,
	key: ConfiguredLedgerKey,
	repositoryDbMode = IS_REPOSITORY_DB_MODE,
): string {
	const configured = isRecord(config) ? config[key] : undefined;
	if (typeof configured === 'string' && configured.trim()) return configured;
	const fallback = LEDGER_FALLBACKS[key];
	return repositoryDbMode ? fallback.repositoryDb : fallback.compatibility;
}

function configuredLedgerPath(config: unknown, key: ConfiguredLedgerKey): string {
	return path.resolve(MISSION_CONTROL_DATA_ROOT, configuredLedgerRelativePath(config, key));
}

export function readIssueRecordsFromFile(
	filePath: string,
	issueSource: 'open_issue' | 'resolved_issue',
	root = MISSION_CONTROL_DATA_ROOT,
): unknown[] {
	const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
	const rows = Array.isArray(parsed)
		? parsed
		: isRecord(parsed) && Array.isArray(parsed.issues)
			? parsed.issues
			: [];
	const scope = isRecord(parsed) ? parsed.scope : undefined;
	const file = portableRelativePath(root, filePath) || path.basename(filePath);
	return rows.filter(isRecord).map((issue) => ({
		...issue,
		scope,
		file,
		issue_source: issueSource,
	}));
}

function loadConfiguredIssues(
	config: unknown,
	key: 'issues_open_path' | 'issues_resolved_path',
	issueSource: 'open_issue' | 'resolved_issue',
): unknown[] {
	try {
		return readIssueRecordsFromFile(configuredLedgerPath(config, key), issueSource);
	} catch {
		return [];
	}
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0;
}

function strings(value: unknown): string[] {
	return Array.isArray(value) ? value.filter(isNonEmptyString) : [];
}

function fieldString(record: Record<string, unknown>, key: string, fallback: string): string {
	const value = record[key];
	return isNonEmptyString(value) ? value : fallback;
}

function recordsById(records: unknown[]): Map<string, Record<string, unknown>> {
	const byId = new Map<string, Record<string, unknown>>();
	for (const record of records) {
		if (!isRecord(record) || !isNonEmptyString(record.id) || byId.has(record.id)) continue;
		byId.set(record.id, record);
	}
	return byId;
}

function issueBlockerForStep(
	step: Record<string, unknown>,
	issue: Record<string, unknown>,
): RoadmapIssueBlocker {
	return {
		step_id: fieldString(step, 'id', '<bez kroku>'),
		step_title: fieldString(step, 'title', '<bez názvu kroku>'),
		issue_id: fieldString(issue, 'id', '<bez issue>'),
		title: fieldString(issue, 'title', '<bez názvu>'),
		status: fieldString(issue, 'status', 'open'),
		severity: fieldString(issue, 'severity', 'unknown'),
		owner: fieldString(issue, 'owner', 'unknown'),
		file: fieldString(issue, 'file', 'ISSUES.open.json'),
	};
}

function normalizeIssueBlockers(records: unknown[]): RoadmapIssueBlocker[] {
	return records.filter(isRecord).map((record) => ({
		step_id: fieldString(record, 'step_id', '<bez kroku>'),
		step_title: fieldString(record, 'step_title', '<bez názvu kroku>'),
		issue_id: fieldString(record, 'issue_id', '<bez issue>'),
		title: fieldString(record, 'title', '<bez názvu>'),
		status: fieldString(record, 'status', 'open'),
		severity: fieldString(record, 'severity', 'unknown'),
		owner: fieldString(record, 'owner', 'unknown'),
		file: fieldString(record, 'file', 'ISSUES.open.json'),
	}));
}

function buildStepIssueBlockers(
	roadmap: MissionControlRoadmap,
	issueRecords: unknown[],
): RoadmapIssueBlocker[] {
	const openIssuesById = recordsById(issueRecords);
	const blockers: RoadmapIssueBlocker[] = [];
	const steps = Array.isArray(roadmap.steps) ? roadmap.steps : [];
	for (const step of steps) {
		if (!isRecord(step) || !isNonEmptyString(step.id) || !isNonEmptyString(step.title)) continue;
		for (const issueId of strings(step.issue_refs)) {
			const issue = openIssuesById.get(issueId);
			if (issue) blockers.push(issueBlockerForStep(step, issue));
		}
	}
	return blockers;
}

function dedupeIssueBlockers(blockers: RoadmapIssueBlocker[]): RoadmapIssueBlocker[] {
	const seen = new Set<string>();
	return blockers.filter((blocker) => {
		const key = `${blocker.step_id}\u0000${blocker.issue_id}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function buildResolutionEvidence(
	roadmap: MissionControlRoadmap,
	resolvedIssueRecords: unknown[],
): RoadmapResolutionEvidence[] {
	const resolvedIssuesById = recordsById(resolvedIssueRecords);
	const evidence: RoadmapResolutionEvidence[] = [];
	const steps = Array.isArray(roadmap.steps) ? roadmap.steps : [];
	for (const step of steps) {
		if (!isRecord(step) || !isNonEmptyString(step.id) || !isNonEmptyString(step.title)) continue;
		for (const issueId of strings(step.issue_refs)) {
			const issue = resolvedIssuesById.get(issueId);
			if (!issue) continue;
			const resolution = isRecord(issue.resolution) ? issue.resolution : {};
			const resolvedFrom = isRecord(issue.resolved_from) ? issue.resolved_from : {};
			const item: RoadmapResolutionEvidence = {
				step_id: step.id,
				step_title: step.title,
				issue_id: fieldString(issue, 'id', issueId),
				title: fieldString(issue, 'title', '<bez názvu>'),
				resolved_at: fieldString(issue, 'resolved_at', '<bez času>'),
				resolved_by: fieldString(issue, 'resolved_by', 'unknown'),
				decision: fieldString(resolution, 'decision', '<bez rozhodnutí>'),
				source_ledger_path: fieldString(resolvedFrom, 'open_ledger_path', 'ISSUES.open.json'),
				resolved_ledger_path: fieldString(issue, 'file', 'ISSUES.resolved.json'),
			};
			for (const [sourceKey, targetKey] of [
				['rationale', 'rationale'],
				['selected_option', 'selected_option'],
				['follow_up', 'follow_up'],
			] as const) {
				if (isNonEmptyString(resolution[sourceKey])) item[targetKey] = resolution[sourceKey];
			}
			evidence.push(item);
		}
	}
	return evidence;
}

type PlanLike = {
	path?: unknown;
	filePath?: unknown;
	plan: {
		id?: unknown;
		dev_code?: unknown;
		status?: unknown;
		github?: unknown;
	};
	workspacePath?: unknown;
	relativePath?: unknown;
};

type WorkLedgerItem = RoadmapLinkedWorkItem & { tags: string[]; planning_plan_id?: string };
type WorkLedgerReadError = { ledger_path: string; message: string };

type WorkLedgerReadResult = {
	items: WorkLedgerItem[];
	ledgerReadErrors: WorkLedgerReadError[];
};

const GIT_ENV_KEYS = [
	'GIT_ALTERNATE_OBJECT_DIRECTORIES',
	'GIT_COMMON_DIR',
	'GIT_DIR',
	'GIT_INDEX_FILE',
	'GIT_OBJECT_DIRECTORY',
	'GIT_PREFIX',
	'GIT_WORK_TREE',
];

function gitEnvironment(): Record<string, string | undefined> {
	const env: Record<string, string | undefined> = { ...process.env, GIT_OPTIONAL_LOCKS: '0' };
	for (const key of GIT_ENV_KEYS) delete env[key];
	return env;
}

type RuntimeSnapshot = Pick<RoadmapRuntimeLane, 'source' | 'path' | 'branch' | 'head' | 'dirty'>;

function gitText(args: string[], fallback = 'unknown'): string {
	const result = spawnSync('git', args, {
		cwd: WORKSPACE_ROOT,
		encoding: 'utf8',
		env: gitEnvironment(),
	});
	if (result.status !== 0) return fallback;
	return result.stdout.trim() || fallback;
}

function normalizeDevCode(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined;
	const normalized = value.trim().toUpperCase();
	return PLAN_CODE_RE.test(normalized) ? normalized : undefined;
}

function tags(value: unknown): string[] {
	return Array.isArray(value) ? value.filter(isNonEmptyString) : [];
}

function devCodeFromTask(record: Record<string, unknown>, taskTags: string[]): string | undefined {
	return normalizeDevCode(record.dev_code) ?? taskTags.map(normalizeDevCode).find(Boolean);
}

type WorkLedgerSource = {
	path: string;
	kind: 'todo' | 'done';
	required: boolean;
};

export function readWorkLedgerItemsFromFiles(
	sources: WorkLedgerSource[],
	workspaceRoot = WORKSPACE_ROOT,
): WorkLedgerReadResult {
	const items: WorkLedgerItem[] = [];
	const ledgerReadErrors: WorkLedgerReadError[] = [];
	for (const source of sources) {
		const filePath = source.path;
		let parsed: unknown;
		const ledgerPath = portableRelativePath(workspaceRoot, filePath);
		try {
			parsed = JSON.parse(readFileSync(filePath, 'utf8'));
		} catch (error) {
			if (isRecord(error) && error.code === 'ENOENT' && source.required === false) continue;
			ledgerReadErrors.push({
				ledger_path: ledgerPath,
				message: error instanceof Error ? error.message : String(error),
			});
			continue;
		}
		const rows = Array.isArray(parsed)
			? parsed
			: isRecord(parsed) && Array.isArray(parsed.tasks)
				? parsed.tasks
				: null;
		if (!rows) {
			ledgerReadErrors.push({
				ledger_path: ledgerPath,
				message: 'Ledger root is neither an array nor an object with a tasks array.',
			});
			continue;
		}
		const kind = source.kind;
		for (const row of rows) {
			if (!isRecord(row) || !isNonEmptyString(row.id)) continue;
			const planning = isRecord(row.planning) ? row.planning : {};
			const taskTags = tags(row.tags);
			items.push({
				id: row.id,
				kind,
				title: fieldString(row, 'title', '(bez názvu)'),
				status: fieldString(row, 'status', kind === 'done' ? 'done' : 'open'),
				ledger_path: ledgerPath,
				dev_code: devCodeFromTask(row, taskTags),
				planning_path: isNonEmptyString(planning.path) ? planning.path : undefined,
				planning_plan_id: isNonEmptyString(planning.plan_id) ? planning.plan_id : undefined,
				tags: taskTags,
			});
		}
	}
	return { items, ledgerReadErrors };
}

function readWorkLedgerItems(config: unknown): WorkLedgerReadResult {
	const hasConfiguredPath = (key: 'todo_tasks_path' | 'done_tasks_path') =>
		isRecord(config) && isNonEmptyString(config[key]);
	return readWorkLedgerItemsFromFiles([
		{
			path: configuredLedgerPath(config, 'todo_tasks_path'),
			kind: 'todo',
			required: IS_REPOSITORY_DB_MODE || hasConfiguredPath('todo_tasks_path'),
		},
		{
			path: configuredLedgerPath(config, 'done_tasks_path'),
			kind: 'done',
			required: IS_REPOSITORY_DB_MODE || hasConfiguredPath('done_tasks_path'),
		},
	]);
}

function planRefsForRoadmap(roadmap: MissionControlRoadmap): Set<string> {
	const refs = new Set<string>([roadmap.source_plan]);
	for (const step of Array.isArray(roadmap.steps) ? roadmap.steps : []) {
		if (!isRecord(step)) continue;
		for (const ref of strings(step.plan_refs)) refs.add(ref);
	}
	return refs;
}

function todoRefsForRoadmap(roadmap: MissionControlRoadmap): Set<string> {
	const refs = new Set<string>();
	for (const step of Array.isArray(roadmap.steps) ? roadmap.steps : []) {
		if (!isRecord(step)) continue;
		for (const ref of strings(step.todo_refs)) refs.add(ref);
	}
	return refs;
}

function activePlanRefsForRoadmap(roadmap: MissionControlRoadmap): Set<string> {
	const refs = new Set<string>();
	for (const step of Array.isArray(roadmap.steps) ? roadmap.steps : []) {
		if (!isRecord(step)) continue;
		const status = fieldString(step, 'status', '');
		if (!['ready', 'in_progress', 'review', 'blocked'].includes(status)) continue;
		for (const ref of strings(step.plan_refs)) refs.add(ref);
	}
	return refs;
}

function currentStepRefsForRoadmap(
	roadmap: MissionControlRoadmap,
	nextStep: RoadmapNextStep | null,
	field: 'plan_refs' | 'todo_refs',
): Set<string> {
	if (nextStep) return new Set(strings(nextStep[field]));
	const executableSteps = (Array.isArray(roadmap.steps) ? roadmap.steps : []).filter(
		(step) => isRecord(step) && step.executable !== false,
	);
	const inProgressStep = executableSteps.find(
		(step) => fieldString(step, 'status', '') === 'in_progress',
	);
	const readyStep = executableSteps.find((step) => fieldString(step, 'status', '') === 'ready');
	const reviewStep = executableSteps.find((step) => fieldString(step, 'status', '') === 'review');
	const blockedStep = executableSteps.find((step) => fieldString(step, 'status', '') === 'blocked');
	const step = inProgressStep ?? readyStep ?? reviewStep ?? blockedStep;
	return new Set(isRecord(step) ? strings(step[field]) : []);
}

function isGitHubPullRequestUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return (
			['http:', 'https:'].includes(url.protocol) &&
			url.hostname.toLowerCase() === 'github.com' &&
			/^\/[^/]+\/[^/]+\/pull\/\d+\/?$/.test(url.pathname)
		);
	} catch {
		return false;
	}
}

function planHasPrEvidence(plan: PlanLike, requireMerged: boolean): boolean {
	const github = isRecord(plan.plan.github) ? plan.plan.github : {};
	const prs = Array.isArray(github.prs) ? github.prs : [];
	return prs.some((pr) => {
		if (!isRecord(pr) || !isNonEmptyString(pr.url) || !isGitHubPullRequestUrl(pr.url)) return false;
		if (!requireMerged) return true;
		const status = fieldString(pr, 'status', '').toLowerCase();
		return ['merged', 'done'].includes(status);
	});
}

function activePlanRefsMissingPrEvidence(
	roadmap: MissionControlRoadmap,
	nextStep: RoadmapNextStep | null,
	planRecords: unknown[],
	workSummary: Pick<ReturnType<typeof buildWorkSummary>, 'linked_items'>,
): string[] {
	const plansByCode = planIndexByCode(planRecords);
	let currentTodoRefs = currentStepRefsForRoadmap(roadmap, nextStep, 'todo_refs');
	let currentPlanRefs = currentStepRefsForRoadmap(roadmap, nextStep, 'plan_refs');
	if (currentPlanRefs.size === 0) {
		const executableSteps = (Array.isArray(roadmap.steps) ? roadmap.steps : []).filter(
			(step) => isRecord(step) && step.executable !== false,
		);
		let closeoutStep: Record<string, unknown> | undefined;
		for (let index = executableSteps.length - 1; index >= 0; index -= 1) {
			const step = executableSteps[index];
			if (isRecord(step) && ['done', 'archived'].includes(fieldString(step, 'status', ''))) {
				closeoutStep = step;
				break;
			}
		}
		currentPlanRefs = new Set(isRecord(closeoutStep) ? strings(closeoutStep.plan_refs) : []);
		currentTodoRefs = new Set(isRecord(closeoutStep) ? strings(closeoutStep.todo_refs) : []);
	}
	const todoDevCodes = new Set<string>();
	for (const item of workSummary.linked_items) {
		if (currentTodoRefs.has(item.id) && isNonEmptyString(item.dev_code))
			todoDevCodes.add(item.dev_code);
	}
	// Current step plan_refs are the source of truth. TODO dev_codes narrow broad context refs
	// (e.g. ACME-0021/ACME-0022/ACME-0024) down to the current implementation slice.
	const refs = new Set<string>(
		todoDevCodes.size > 0
			? [...currentPlanRefs].filter((planCode) => todoDevCodes.has(planCode))
			: currentPlanRefs,
	);
	for (const devCode of todoDevCodes) {
		if (!currentPlanRefs.has(devCode)) refs.add(devCode);
	}
	const missing: string[] = [];
	for (const planCode of refs) {
		const plan = plansByCode.get(planCode);
		if (!plan) continue;
		const planStatus = fieldString(plan.plan, 'status', '').toLowerCase();
		const requireMerged = roadmap.status === 'done' || planStatus === 'done';
		if (!planHasPrEvidence(plan, requireMerged)) missing.push(planCode);
	}
	return missing.sort();
}

function planIndexByCode(planRecords: unknown[]): Map<string, PlanLike> {
	const index = new Map<string, PlanLike>();
	for (const record of planRecords) {
		if (!isRecord(record) || !isRecord(record.plan) || !isNonEmptyString(record.plan.dev_code))
			continue;
		index.set(record.plan.dev_code, record as PlanLike);
	}
	return index;
}

function itemMatchesPlan(item: WorkLedgerItem, planCode: string, plan: PlanLike): boolean {
	if (item.dev_code === planCode) return true;
	if (isNonEmptyString(plan.path) && item.planning_path === plan.path) return true;
	if (isNonEmptyString(plan.workspacePath) && item.planning_path === plan.workspacePath)
		return true;
	if (isNonEmptyString(plan.relativePath) && item.planning_path === plan.relativePath) return true;
	if (isNonEmptyString(plan.plan.id) && item.planning_plan_id === plan.plan.id) return true;
	return false;
}

function itemMatchesRoadmap(
	item: WorkLedgerItem,
	roadmap: MissionControlRoadmap,
	planRefs: ReadonlySet<string>,
	roadmapTodoRefs: ReadonlySet<string>,
	plansByCode: ReadonlyMap<string, PlanLike>,
): boolean {
	if (roadmapTodoRefs.has(item.id)) return true;
	if (item.tags.includes(roadmap.roadmap_code)) return true;
	for (const planCode of planRefs) {
		const plan = plansByCode.get(planCode);
		if (plan && itemMatchesPlan(item, planCode, plan)) return true;
	}
	return false;
}

function itemBlocksRelease(
	item: WorkLedgerItem,
	roadmapCode: string,
	activePlanRefs: ReadonlySet<string>,
	roadmapTodoRefs: ReadonlySet<string>,
	plansByCode: ReadonlyMap<string, PlanLike>,
): boolean {
	if (roadmapTodoRefs.has(item.id)) return true;
	if (item.tags.includes(roadmapCode)) return true;
	for (const planCode of activePlanRefs) {
		const plan = plansByCode.get(planCode);
		if (plan && itemMatchesPlan(item, planCode, plan)) return true;
	}
	return false;
}

function buildWorkSummary(
	roadmap: MissionControlRoadmap,
	workItems: WorkLedgerItem[],
	planRecords: unknown[],
	ledgerReadErrors: WorkLedgerReadError[],
) {
	const planRefs = planRefsForRoadmap(roadmap);
	const activePlanRefs = activePlanRefsForRoadmap(roadmap);
	const roadmapTodoRefs = todoRefsForRoadmap(roadmap);
	const plansByCode = planIndexByCode(planRecords);
	const openStatuses = new Set(['open', 'todo', 'in_progress', 'ready', 'blocked', 'review']);
	const linkedItems = workItems
		.filter((item) => itemMatchesRoadmap(item, roadmap, planRefs, roadmapTodoRefs, plansByCode))
		.map((item) => ({
			...item,
			blocks_release:
				item.kind === 'todo' &&
				openStatuses.has(item.status) &&
				itemBlocksRelease(item, roadmap.roadmap_code, activePlanRefs, roadmapTodoRefs, plansByCode),
		}))
		.sort((left, right) => left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id));
	const linkedIds = new Set(linkedItems.map((item) => item.id));
	return {
		blocking_open_todo_count: linkedItems.filter((item) => item.blocks_release).length,
		non_blocking_open_todo_count: linkedItems.filter(
			(item) => item.kind === 'todo' && openStatuses.has(item.status) && !item.blocks_release,
		).length,
		done_count: linkedItems.filter((item) => item.kind === 'done' || item.status === 'done').length,
		linked_items: linkedItems.map(
			({ tags: _tags, planning_plan_id: _planningPlanId, ...item }) => item,
		),
		missing_todo_refs: [...roadmapTodoRefs].filter((id) => !linkedIds.has(id)).sort(),
		ledger_read_errors: ledgerReadErrors,
	};
}

function isWorktreeRoot(root: string): boolean {
	return root.split(/[\\/]+/).includes('.worktrees');
}

function safeCheckoutPath(root: string): string {
	const parts = root.split(/[\\/]+/).filter(Boolean);
	const worktreeIndex = parts.lastIndexOf('.worktrees');
	if (worktreeIndex >= 0 && parts[worktreeIndex + 1])
		return `.worktrees/${parts[worktreeIndex + 1]}`;
	return path.basename(root) || 'workspace';
}

function buildRuntimeSnapshot(): RuntimeSnapshot {
	const branch = gitText(['branch', '--show-current']);
	const head = gitText(['rev-parse', '--short=12', 'HEAD']);
	const dirty = gitText(['--no-optional-locks', 'status', '--porcelain'], '').length > 0;
	const source: RoadmapRuntimeLane['source'] = isWorktreeRoot(WORKSPACE_ROOT)
		? 'worktree'
		: branch === 'main'
			? 'main'
			: branch !== 'unknown'
				? 'branch'
				: head !== 'unknown'
					? 'detached'
					: 'unknown';
	return { source, path: safeCheckoutPath(WORKSPACE_ROOT), branch, head, dirty };
}

function buildRuntimeLane(
	planRecords: unknown[],
	allowedPlanRefs: ReadonlySet<string>,
	runtimeSnapshot: RuntimeSnapshot,
): RoadmapRuntimeLane {
	const prs: RoadmapRuntimeLane['prs'] = [];
	const seen = new Set<string>();
	for (const record of planRecords) {
		if (!isRecord(record) || !isRecord(record.plan) || !isNonEmptyString(record.plan.dev_code))
			continue;
		if (!allowedPlanRefs.has(record.plan.dev_code)) continue;
		const github = isRecord(record.plan.github) ? record.plan.github : {};
		const prRows = Array.isArray(github.prs) ? github.prs : [];
		for (const pr of prRows) {
			if (
				!isRecord(pr) ||
				!isNonEmptyString(pr.url) ||
				!isGitHubPullRequestUrl(pr.url) ||
				seen.has(pr.url)
			)
				continue;
			seen.add(pr.url);
			prs.push({
				plan_ref: record.plan.dev_code,
				url: pr.url,
				status: isNonEmptyString(pr.status) ? pr.status : undefined,
				note: isNonEmptyString(pr.note) ? pr.note : undefined,
			});
		}
	}
	return { ...runtimeSnapshot, prs };
}

function buildAgentLane(roadmap: MissionControlRoadmap): RoadmapAgentLane {
	const source = isRecord(roadmap.agent_lane) ? roadmap.agent_lane : null;
	const reviewers = source ? strings(source.reviewers) : [];
	const executionAgents = source ? strings(source.execution_agents) : [];
	const warnings: string[] = [];
	if (!source) warnings.push('Roadmap nemá explicitní agent_lane metadata.');
	if (reviewers.length === 0) warnings.push('Chybí explicitní revieweři.');
	if (executionAgents.length === 0) warnings.push('Chybí explicitní exekuční agenti.');
	if (source && !isNonEmptyString(source.escalation_policy))
		warnings.push('Chybí explicitní escalation_policy.');
	const escalationPolicy =
		source && isNonEmptyString(source.escalation_policy)
			? source.escalation_policy
			: 'Agent lane source metadata chybí; použij repo/organization PR workflow a explicitně doplň role.';
	return {
		owner: roadmap.owner,
		reviewers,
		execution_agents: executionAgents,
		escalation_policy: escalationPolicy,
		status: warnings.length === 0 ? 'pass' : 'warning',
		source: source ? 'roadmap' : 'missing',
		warnings,
	};
}

function buildReleaseGate({
	roadmap,
	validationFailures,
	workSummary,
	runtimeLane,
	agentLane,
	nextStep,
	issueBlockers,
	missingPrEvidenceRefs,
}: {
	roadmap: MissionControlRoadmap;
	validationFailures: string[];
	workSummary: ReturnType<typeof buildWorkSummary>;
	runtimeLane: RoadmapRuntimeLane;
	agentLane: RoadmapAgentLane;
	nextStep: RoadmapNextStep | null;
	issueBlockers: RoadmapIssueBlocker[];
	missingPrEvidenceRefs: string[];
}): RoadmapReleaseGate {
	const executableSteps = (Array.isArray(roadmap.steps) ? roadmap.steps : []).filter(
		(step) => isRecord(step) && step.executable !== false,
	);
	const closedStepStatuses = new Set(['done', 'archived']);
	const doneStepCount = executableSteps.filter(
		(step) => fieldString(step, 'status', '') === 'done',
	).length;
	const openStepCount = executableSteps.filter(
		(step) => !closedStepStatuses.has(fieldString(step, 'status', '')),
	).length;
	const validationOk = validationFailures.length === 0;
	const validationDetail = validationOk
		? 'OK'
		: `${validationFailures.length} validačních chyb Mission Control.`;
	const blockers: string[] = [];
	if (!validationOk) blockers.push('Mission Control validace není zelená.');
	if (openStepCount > 0)
		blockers.push(`${openStepCount} spustitelný Roadmap Step ještě není done.`);
	if (workSummary.blocking_open_todo_count > 0)
		blockers.push(
			`${workSummary.blocking_open_todo_count} navázaných TODO položek je stále otevřených.`,
		);
	if (workSummary.ledger_read_errors.length > 0)
		blockers.push(
			`${workSummary.ledger_read_errors.length} TODO/DONE ledgerů se nepodařilo přečíst.`,
		);
	if (issueBlockers.length > 0)
		blockers.push(`${issueBlockers.length} lidský blocker issue čeká na rozhodnutí.`);
	if (missingPrEvidenceRefs.length > 0)
		blockers.push(`Chybí PR metadata pro aktivní plan refs: ${missingPrEvidenceRefs.join(', ')}.`);
	if (
		runtimeLane.source === 'unknown' ||
		runtimeLane.branch === 'unknown' ||
		runtimeLane.head === 'unknown'
	)
		blockers.push('Runtime vrstva nedokáže spolehlivě určit checkout/branch/head.');
	if (workSummary.missing_todo_refs.length > 0)
		blockers.push(`Chybí TODO/DONE refs: ${workSummary.missing_todo_refs.join(', ')}.`);
	const checks: RoadmapReleaseGate['checks'] = [
		{
			id: 'validation',
			label: 'Mission Control validace',
			status: validationOk ? 'pass' : 'blocker',
			detail: validationDetail,
		},
		{
			id: 'roadmap-steps',
			label: 'Kroky roadmapy',
			status: openStepCount === 0 ? 'pass' : 'blocker',
			detail:
				openStepCount === 0
					? 'Všechny spustitelné kroky jsou done nebo archived.'
					: `${openStepCount} otevřených spustitelných kroků.`,
		},
		{
			id: 'linked-work',
			label: 'Uzavření TODO/DONE',
			status:
				workSummary.missing_todo_refs.length === 0 && workSummary.blocking_open_todo_count === 0
					? 'pass'
					: 'blocker',
			detail: `${workSummary.blocking_open_todo_count} release-blocking TODO, ${workSummary.non_blocking_open_todo_count} navázaných evidence TODO, ${workSummary.done_count} DONE, ${workSummary.missing_todo_refs.length} chybějících refs.`,
		},
		{
			id: 'ledger-read',
			label: 'Čtení TODO/DONE ledgerů',
			status: workSummary.ledger_read_errors.length === 0 ? 'pass' : 'blocker',
			detail:
				workSummary.ledger_read_errors.length === 0
					? 'Všechny TODO/DONE ledgery přečteny.'
					: workSummary.ledger_read_errors
							.map((error) => `${error.ledger_path}: ${error.message}`)
							.join('; '),
		},
		{
			id: 'pr-evidence',
			label: 'PR evidence',
			status: missingPrEvidenceRefs.length === 0 ? 'pass' : 'blocker',
			detail:
				missingPrEvidenceRefs.length === 0
					? 'Aktivní plan refs mají PR metadata.'
					: `Chybí: ${missingPrEvidenceRefs.join(', ')}`,
		},
		{
			id: 'runtime-lane',
			label: 'Runtime vrstva',
			status:
				runtimeLane.source === 'unknown' ||
				runtimeLane.branch === 'unknown' ||
				runtimeLane.head === 'unknown'
					? 'blocker'
					: runtimeLane.dirty
						? 'warning'
						: 'pass',
			detail: `${runtimeLane.source.toUpperCase()} · ${runtimeLane.branch} · ${runtimeLane.head}${runtimeLane.dirty ? ' · dirty' : ''}`,
		},
		{
			id: 'agent-lane',
			label: 'Vrstva AI kolegů',
			status: agentLane.status,
			detail:
				agentLane.warnings.length === 0
					? `Vlastník ${agentLane.owner}; revieweři ${agentLane.reviewers.join(', ')}; exekuce ${agentLane.execution_agents.join(', ')}.`
					: agentLane.warnings.join(' '),
		},
	];
	const status: RoadmapReleaseGate['status'] =
		blockers.length > 0 ? 'blocked' : roadmap.status === 'done' ? 'done' : 'ready';
	const nextAction = nextStep
		? `Dokončit ${nextStep.id} — ${nextStep.title}.`
		: status === 'done'
			? 'Roadmapa je uzavřená.'
			: status === 'blocked'
				? `Odblokovat release bránu: ${blockers[0]}`
				: 'Release brána je připravená k closeoutu.';
	return {
		status,
		open_step_count: openStepCount,
		done_step_count: doneStepCount,
		blockers,
		checks,
		next_action: nextAction,
	};
}

function failuresForRoadmap(record: RootRoadmapRecord, failures: string[]): string[] {
	return failures.filter((failure) => failure.startsWith(`${record.path}:`));
}

function nextStepFromReport(value: unknown): RoadmapNextStep | null {
	if (!value || typeof value !== 'object') return null;
	const step = value as RoadmapNextStep;
	return {
		id: step.id,
		title: step.title,
		status: step.status,
		plan_refs: step.plan_refs ?? [],
		todo_refs: step.todo_refs ?? [],
		issue_refs: step.issue_refs ?? [],
		evidence_refs: step.evidence_refs ?? [],
		acceptance_criteria: step.acceptance_criteria ?? [],
	};
}

type BuildRoadmapsResponseOptions = {
	additionalValidationFailures?: string[];
	workLedgerOverride?: WorkLedgerReadResult;
};

export function buildRoadmapsResponse(
	options: BuildRoadmapsResponseOptions = {},
): RoadmapsApiResponse {
	const config = loadMissionControlConfig(MISSION_CONTROL_DATA_ROOT);
	const planRecords = loadPlans(MISSION_CONTROL_DATA_ROOT, config);
	const roadmapRecords: RootRoadmapRecord[] = loadRoadmaps(
		MISSION_CONTROL_DATA_ROOT,
		config,
	) as RootRoadmapRecord[];
	const validationFailures = [
		...validatePlanRecords(planRecords, config, MISSION_CONTROL_DATA_ROOT, WORKSPACE_ROOT),
		...validateRoadmapRecords(roadmapRecords, config, MISSION_CONTROL_DATA_ROOT, planRecords),
		...(options.additionalValidationFailures ?? []),
	];
	const issueRecords = loadConfiguredIssues(config, 'issues_open_path', 'open_issue');
	const resolvedIssueRecords = loadConfiguredIssues(
		config,
		'issues_resolved_path',
		'resolved_issue',
	);
	const workLedger = options.workLedgerOverride ?? readWorkLedgerItems(config);
	const runtimeSnapshot = buildRuntimeSnapshot();
	const roadmaps = roadmapRecords
		.filter((record): record is RootRoadmapRecord & { roadmap: MissionControlRoadmap } =>
			isRoadmap(record.roadmap),
		)
		.map((record) => {
			const report = buildRoadmapExecutionReport({
				roadmapRecords,
				validationFailures,
				roadmapCode: record.roadmap.roadmap_code,
				issueRecords,
			});
			const roadmapFailures = failuresForRoadmap(record, validationFailures);
			const nextStep = nextStepFromReport(report.next_step);
			const issueBlockers = normalizeIssueBlockers(report.issue_blockers);
			const stepIssueBlockers = buildStepIssueBlockers(record.roadmap, issueRecords);
			const releaseIssueBlockers = dedupeIssueBlockers([...issueBlockers, ...stepIssueBlockers]);
			const planRefs = planRefsForRoadmap(record.roadmap);
			const runtimeLane = buildRuntimeLane(planRecords, planRefs, runtimeSnapshot);
			const agentLane = buildAgentLane(record.roadmap);
			const workSummary = buildWorkSummary(
				record.roadmap,
				workLedger.items,
				planRecords,
				workLedger.ledgerReadErrors,
			);
			const missingPrEvidenceRefs = activePlanRefsMissingPrEvidence(
				record.roadmap,
				nextStep,
				planRecords,
				workSummary,
			);
			return {
				roadmap: record.roadmap,
				relativePath: portableRelativePath(MISSION_CONTROL_ROOT, record.filePath),
				workspacePath: record.path,
				validation: { ok: roadmapFailures.length === 0, failures: roadmapFailures },
				next_step: nextStep,
				issue_blockers: issueBlockers,
				step_issue_blockers: stepIssueBlockers,
				resolution_evidence: buildResolutionEvidence(record.roadmap, resolvedIssueRecords),
				work_summary: workSummary,
				runtime_lane: runtimeLane,
				agent_lane: agentLane,
				release_gate: buildReleaseGate({
					roadmap: record.roadmap,
					validationFailures,
					workSummary,
					runtimeLane,
					agentLane,
					nextStep,
					issueBlockers: releaseIssueBlockers,
					missingPrEvidenceRefs,
				}),
				blockers: report.blockers,
				actions: report.actions,
			};
		})
		.sort((a, b) => a.roadmap.roadmap_code.localeCompare(b.roadmap.roadmap_code));

	return {
		roadmaps,
		validation: { ok: validationFailures.length === 0, failures: validationFailures },
	};
}
