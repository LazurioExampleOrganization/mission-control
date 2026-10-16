import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { MissionTodoOutputMaterializationWarning } from './agent-work/contract.ts';
import type { PlanRecord } from './model.ts';
import {
	listWorkspaceLedgerFiles,
	missionControlDataRelative,
	PLAN_CODE_RE,
	workspaceRelative,
} from './paths.ts';
import { listPlanRecords } from './store.ts';

export type WorkItem = {
	id: string;
	kind: 'todo' | 'done' | 'issue';
	title: string;
	status: string;
	priority?: string;
	severity?: string;
	dev_code?: string;
	has_plan: boolean;
	planning_status:
		| 'none'
		| 'linked'
		| 'missing_plan'
		| 'dev_code_mismatch'
		| 'missing_dev_code'
		| 'planning_references_disagree';
	planning_errors?: Array<{ code: string; message: string }>;
	plan?: { id: string; dev_code: string; title: string; path: string };
	planning?: { plan_id?: string; path?: string; source?: string };
	ledger_path: string;
	scope_id?: string;
	scope_name?: string;
};

export type RawWorkItem = Omit<
	WorkItem,
	'has_plan' | 'planning_status' | 'planning_errors' | 'plan'
>;

export type LedgerReadError = {
	ledger_path: string;
	message: string;
};

export type TodoOutputMaterializationWarning = MissionTodoOutputMaterializationWarning;

type PlanIndex = {
	byId: Map<string, PlanRecord>;
	byDevCode: Map<string, PlanRecord>;
	byPath: Map<string, PlanRecord>;
};

type LedgerReadResult = {
	items: RawWorkItem[];
	error?: LedgerReadError;
};

type RawLedger = {
	scope?: { id?: string; name?: string };
	tasks?: Array<Record<string, unknown>>;
	issues?: Array<Record<string, unknown>>;
};

type ParsedLedger = RawLedger | Array<Record<string, unknown>>;

function normalizeDevCode(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined;
	const normalized = value.trim().toUpperCase();
	return PLAN_CODE_RE.test(normalized) ? normalized : undefined;
}

function buildPlanIndex(records: PlanRecord[]): PlanIndex {
	const byId = new Map<string, PlanRecord>();
	const byDevCode = new Map<string, PlanRecord>();
	const byPath = new Map<string, PlanRecord>();
	for (const record of records) {
		byId.set(record.plan.id, record);
		byDevCode.set(record.plan.dev_code, record);
		byPath.set(record.relativePath, record);
		byPath.set(record.workspacePath, record);
	}
	return { byId, byDevCode, byPath };
}

function planBrief(record: PlanRecord): NonNullable<WorkItem['plan']> {
	return {
		id: record.plan.id,
		dev_code: record.plan.dev_code,
		title: record.plan.title,
		path: record.workspacePath,
	};
}

function uniqueRecords(records: Array<PlanRecord | undefined>): PlanRecord[] {
	const seen = new Set<string>();
	const unique: PlanRecord[] = [];
	for (const record of records) {
		if (!record || seen.has(record.absolutePath)) continue;
		seen.add(record.absolutePath);
		unique.push(record);
	}
	return unique;
}

function planningWantsMissionControl(item: RawWorkItem): boolean {
	return hasExplicitMissionControlLink(item) || Boolean(item.dev_code);
}

function hasExplicitMissionControlLink(item: RawWorkItem | WorkItem): boolean {
	return (
		item.planning?.source === 'mission-control' ||
		Boolean(item.planning?.plan_id) ||
		Boolean(item.planning?.path)
	);
}

function attachPlanningStateToItem(item: RawWorkItem, index: PlanIndex): WorkItem {
	const wantsPlan = planningWantsMissionControl(item);
	if (!wantsPlan) {
		return {
			...item,
			has_plan: false,
			planning_status: 'none',
		};
	}

	const matches = uniqueRecords([
		item.planning?.plan_id ? index.byId.get(item.planning.plan_id) : undefined,
		item.dev_code ? index.byDevCode.get(item.dev_code) : undefined,
		item.planning?.path ? index.byPath.get(item.planning.path) : undefined,
	]);
	const errors: NonNullable<WorkItem['planning_errors']> = [];

	if (matches.length === 0) {
		errors.push({
			code: 'missing_plan',
			message: 'Odkaz nenavazuje na žádný existující Mission Control plán.',
		});
		return {
			...item,
			has_plan: false,
			planning_status: 'missing_plan',
			planning_errors: errors,
		};
	}

	if (matches.length > 1) {
		errors.push({
			code: 'planning_references_disagree',
			message: 'planning.plan_id, planning.path a dev_code neukazují na stejný plán.',
		});
	}

	const plan = matches[0];
	if (item.dev_code && item.dev_code !== plan.plan.dev_code) {
		errors.push({
			code: 'dev_code_mismatch',
			message: `Task má ${item.dev_code}, ale navázaný plán má ${plan.plan.dev_code}.`,
		});
	}

	if (item.kind !== 'issue' && !item.dev_code) {
		errors.push({
			code: 'missing_dev_code',
			message: 'TODO/DONE položka s Mission Control planning vazbou musí nést dev_code.',
		});
	}

	const status = errors.find((error) => error.code === 'missing_dev_code')
		? 'missing_dev_code'
		: errors.find((error) => error.code === 'dev_code_mismatch')
			? 'dev_code_mismatch'
			: errors.find((error) => error.code === 'planning_references_disagree')
				? 'planning_references_disagree'
				: 'linked';

	return {
		...item,
		has_plan: status === 'linked',
		planning_status: status,
		planning_errors: errors.length > 0 ? errors : undefined,
		plan: planBrief(plan),
	};
}

export function attachPlanningState(items: RawWorkItem[], records: PlanRecord[]): WorkItem[] {
	const index = buildPlanIndex(records);
	return items.map((item) => attachPlanningStateToItem(item, index));
}

function kindFor(filePath: string): WorkItem['kind'] {
	const name = path.basename(filePath);
	if (name === 'DONE.tasks.json') return 'done';
	if (name === 'ISSUES.open.json' || name === 'ISSUES.resolved.json') return 'issue';
	return 'todo';
}

const RESOLVED_ISSUE_STATUSES = new Set(['resolved', 'closed', 'done', 'archived']);

function isResolvedIssueStatus(status: string): boolean {
	return RESOLVED_ISSUE_STATUSES.has(status.toLowerCase());
}

function tagsDevCode(raw: Record<string, unknown>): string | undefined {
	const direct = normalizeDevCode(raw.dev_code);
	if (direct) return direct;
	if (Array.isArray(raw.tags)) {
		const tag = raw.tags.find((item) => normalizeDevCode(item));
		const normalized = normalizeDevCode(tag);
		if (normalized) return normalized;
	}
	return undefined;
}

async function readLedger(filePath: string): Promise<LedgerReadResult> {
	const kind = kindFor(filePath);
	try {
		const parsed = JSON.parse(await readFile(filePath, 'utf8')) as ParsedLedger;
		const rows = Array.isArray(parsed)
			? parsed
			: kind === 'issue'
				? (parsed.issues ?? [])
				: (parsed.tasks ?? []);
		const scope = Array.isArray(parsed) ? undefined : parsed.scope;
		const items = rows.map((raw, index): RawWorkItem => {
			const planning =
				raw.planning && typeof raw.planning === 'object'
					? (raw.planning as WorkItem['planning'])
					: undefined;
			return {
				id: typeof raw.id === 'string' ? raw.id : `${workspaceRelative(filePath)}#${index + 1}`,
				kind,
				title: typeof raw.title === 'string' ? raw.title : '(bez názvu)',
				status: typeof raw.status === 'string' ? raw.status : kind === 'done' ? 'done' : 'open',
				priority: typeof raw.priority === 'string' ? raw.priority : undefined,
				severity: typeof raw.severity === 'string' ? raw.severity : undefined,
				dev_code: tagsDevCode(raw),
				planning,
				ledger_path: workspaceRelative(filePath),
				scope_id: scope?.id,
				scope_name: scope?.name,
			};
		});
		return { items };
	} catch (error) {
		return {
			items: [],
			error: {
				ledger_path: workspaceRelative(filePath),
				message: error instanceof Error ? error.message : String(error),
			},
		};
	}
}

export function buildPlanningCoverage(items: WorkItem[], ledgerReadErrors: LedgerReadError[] = []) {
	const todoItems = items.filter((item) => item.kind === 'todo');
	const brokenPlanLinks = items.filter(
		(item) =>
			hasExplicitMissionControlLink(item) &&
			item.planning_errors &&
			item.planning_errors.length > 0,
	);
	const devWithoutPlan = todoItems.filter((item) => item.dev_code && !item.has_plan);
	return {
		todo_total: todoItems.length,
		todo_with_plan: todoItems.filter((item) => item.has_plan).length,
		todo_without_plan: todoItems.filter((item) => !item.has_plan).length,
		dev_without_plan: devWithoutPlan.map((item) => ({
			id: item.id,
			dev_code: item.dev_code,
			title: item.title,
			ledger_path: item.ledger_path,
			planning_status: item.planning_status,
			planning_errors: item.planning_errors ?? [],
		})),
		broken_plan_links: brokenPlanLinks.map((item) => ({
			id: item.id,
			kind: item.kind,
			dev_code: item.dev_code,
			title: item.title,
			ledger_path: item.ledger_path,
			planning_status: item.planning_status,
			planning_errors: item.planning_errors ?? [],
		})),
		ledger_read_errors: ledgerReadErrors,
	};
}

function normalizeLedgerPath(value: string): string {
	return value.trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

function doneLedgerPathForTodoPath(todoTasksPath: string): string {
	return todoTasksPath.replace(/(^|\/)TODO\.tasks\.json$/, '$1DONE.tasks.json');
}

function planningTargetWasScanned(
	todoTasksPath: string,
	scannedLedgerPaths: ReadonlySet<string>,
): boolean {
	const normalizedTodoPath = normalizeLedgerPath(todoTasksPath);
	const normalizedDonePath = doneLedgerPathForTodoPath(normalizedTodoPath);
	return scannedLedgerPaths.has(normalizedTodoPath) || scannedLedgerPaths.has(normalizedDonePath);
}

export function buildTodoOutputMaterializationWarnings({
	records,
	items,
	scannedLedgerPaths,
}: {
	records: PlanRecord[];
	items: Array<Pick<RawWorkItem, 'id' | 'kind'>>;
	scannedLedgerPaths: string[];
}): TodoOutputMaterializationWarning[] {
	const materializedTaskIds = new Set(
		items.filter((item) => item.kind === 'todo' || item.kind === 'done').map((item) => item.id),
	);
	const scannedLedgerPathSet = new Set(scannedLedgerPaths.map(normalizeLedgerPath));
	const warnings: TodoOutputMaterializationWarning[] = [];

	for (const record of records) {
		const todoOutputs = record.plan.todo_outputs ?? [];
		for (const outputId of todoOutputs) {
			if (materializedTaskIds.has(outputId)) continue;

			const planningTarget = record.plan.planning_target?.todo_tasks_path;
			if (planningTarget && !planningTargetWasScanned(planningTarget, scannedLedgerPathSet)) {
				warnings.push({
					code: 'unscanned_planning_target',
					severity: 'warning',
					plan_id: record.plan.id,
					dev_code: record.plan.dev_code,
					plan_path: record.workspacePath,
					output_id: outputId,
					planning_target: planningTarget,
					message: `${record.plan.dev_code} todo_outputs references ${outputId}, but planning target ${planningTarget} was not scanned; materialization cannot be verified.`,
				});
				continue;
			}

			warnings.push({
				code: 'missing_todo_output',
				severity: 'warning',
				plan_id: record.plan.id,
				dev_code: record.plan.dev_code,
				plan_path: record.workspacePath,
				output_id: outputId,
				message: `${record.plan.dev_code} todo_outputs references ${outputId}, but no TODO/DONE ledger row with that id was scanned.`,
			});
		}
	}

	return warnings;
}

export async function buildWorkBoard() {
	const [files, planRecords] = await Promise.all([listWorkspaceLedgerFiles(), listPlanRecords()]);
	const ledgerResults = await Promise.all(files.map(readLedger));
	const ledgerReadErrors = ledgerResults.flatMap((result) => (result.error ? [result.error] : []));
	const rawItems = ledgerResults.flatMap((result) => result.items);
	const items = attachPlanningState(rawItems, planRecords);
	const ledgerPaths = files.map(workspaceRelative).sort();
	const scannedLedgerPaths = [
		...new Set([...ledgerPaths, ...files.map(missionControlDataRelative)]),
	].sort();
	return {
		generated_at: new Date().toISOString(),
		ledgers: ledgerPaths,
		items,
		planning_coverage: {
			...buildPlanningCoverage(items, ledgerReadErrors),
			todo_output_warnings: buildTodoOutputMaterializationWarnings({
				records: planRecords,
				items,
				scannedLedgerPaths,
			}),
		},
	};
}

export type PlanWorkSummary = {
	plan: { id: string; dev_code: string; title: string; path: string };
	todo_open: WorkItem[];
	todo_other: WorkItem[];
	done: WorkItem[];
	issues_open: WorkItem[];
	issues_resolved: WorkItem[];
	broken_links: WorkItem[];
	close_blockers: string[];
	ledger_read_errors: LedgerReadError[];
};

function itemMatchesPlan(item: WorkItem, plan: PlanRecord): boolean {
	if (item.plan?.id === plan.plan.id) return true;
	if (item.dev_code && item.dev_code === plan.plan.dev_code) return true;
	if (item.planning?.plan_id === plan.plan.id) return true;
	if (
		item.planning?.path &&
		(item.planning.path === plan.relativePath || item.planning.path === plan.workspacePath)
	) {
		return true;
	}
	return false;
}

export async function buildPlanWork(planRecord: PlanRecord): Promise<PlanWorkSummary> {
	const [files, planRecords] = await Promise.all([listWorkspaceLedgerFiles(), listPlanRecords()]);
	const ledgerResults = await Promise.all(files.map(readLedger));
	const ledgerReadErrors = ledgerResults.flatMap((result) => (result.error ? [result.error] : []));
	const rawItems = ledgerResults.flatMap((result) => result.items);
	const items = attachPlanningState(rawItems, planRecords);
	const matching = items.filter((item) => itemMatchesPlan(item, planRecord));
	const todoOpen: WorkItem[] = [];
	const todoOther: WorkItem[] = [];
	const done: WorkItem[] = [];
	const issuesOpen: WorkItem[] = [];
	const issuesResolved: WorkItem[] = [];
	const brokenLinks: WorkItem[] = [];
	for (const item of matching) {
		if (item.planning_errors && item.planning_errors.length > 0) {
			brokenLinks.push(item);
		}
		if (item.kind === 'todo') {
			if (item.status === 'done') {
				done.push(item);
			} else {
				todoOpen.push(item);
			}
			continue;
		}
		if (item.kind === 'done') {
			done.push(item);
			continue;
		}
		if (item.kind === 'issue') {
			if (isResolvedIssueStatus(item.status)) {
				issuesResolved.push(item);
			} else {
				issuesOpen.push(item);
			}
		}
	}
	for (const item of [...todoOpen, ...todoOther]) {
		if (item.kind === 'todo' && item.status !== 'done') {
			todoOther.push(item);
		}
	}
	const closeBlockers: string[] = [];
	if (todoOpen.length > 0) {
		closeBlockers.push(
			`${todoOpen.length} open TODO bez vyřešení nebo carry-over: ${todoOpen.map((item) => item.id).join(', ')}`,
		);
	}
	if (issuesOpen.length > 0) {
		closeBlockers.push(
			`${issuesOpen.length} open ISSUES bez rozhodnutí: ${issuesOpen.map((item) => item.id).join(', ')}`,
		);
	}
	if (brokenLinks.length > 0) {
		closeBlockers.push(
			`${brokenLinks.length} rozbitých planning vazeb: ${brokenLinks.map((item) => item.id).join(', ')}`,
		);
	}
	if (
		(!planRecord.plan.github?.prs || planRecord.plan.github.prs.length === 0) &&
		planRecord.plan.status !== 'shaping' &&
		planRecord.plan.status !== 'ready'
	) {
		closeBlockers.push(
			'Plán nemá zapsaný github.prs[*] — Mission Control finalizace vyžaduje PR metadata.',
		);
	}
	return {
		plan: {
			id: planRecord.plan.id,
			dev_code: planRecord.plan.dev_code,
			title: planRecord.plan.title,
			path: planRecord.workspacePath,
		},
		todo_open: todoOpen,
		todo_other: [],
		done,
		issues_open: issuesOpen,
		issues_resolved: issuesResolved,
		broken_links: brokenLinks,
		close_blockers: closeBlockers,
		ledger_read_errors: ledgerReadErrors,
	};
}
