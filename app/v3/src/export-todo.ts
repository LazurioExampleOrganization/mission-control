import { readFile } from 'node:fs/promises';
import {
	defaultPriorityRank,
	type MissionControlPlan,
	type PlanLink,
	type PlanPriority,
	type ProposedTask as PlanProposedTask,
} from './model.ts';
import {
	listWorkspaceLedgerFiles,
	missionControlDataRelative,
	PLAN_CODE_PLACEHOLDER,
	PLAN_CODE_RE,
	resolveConfiguredMissionControlPath,
} from './paths.ts';
import {
	assertDirectCanonicalWriteAllowed,
	atomicReplaceFile,
	getPlanByIdOrDevCode,
} from './store.ts';
import { validatePlanShape } from './validate.ts';

const EXPORT_RESERVATION_LEDGER_FILES = new Set(['TODO.tasks.json', 'DONE.tasks.json']);
const TODO_LEDGER_RE = /(^|\/)TODO\.tasks\.json$/;

export type TodoExportTask = {
	id: string;
	title: string;
	status: 'open';
	priority: PlanPriority;
	priority_rank: number;
	assignee: 'agent';
	priority_decider: string;
	priority_reason: string;
	created_at: string;
	updated_at: string;
	tags: string[];
	dev_code: string;
	summary: string;
	risk_notes: string[];
	acceptance_criteria: string[];
	blocked_by?: string[];
	links: PlanLink[];
	planning: {
		plan_id: string;
		path: string;
		source: 'mission-control';
		role: 'planning_source';
	};
	source: 'mission-control';
};

export function remapTodoDependencyIds(
	blockedBy: string[] | undefined,
	idMap: ReadonlyMap<string, string>,
): string[] | undefined {
	return blockedBy?.map((id) => idMap.get(id) ?? id);
}

export function remapTodoTaskDependencies(
	tasks: TodoExportTask[],
	reminted: Array<{ from: string; to: string }>,
): TodoExportTask[] {
	if (reminted.length === 0) return tasks;
	const idMap = new Map(reminted.map(({ from, to }) => [from, to]));
	return tasks.map((task) => {
		if (!task.blocked_by || task.blocked_by.length === 0) return task;
		const blockedBy = remapTodoDependencyIds(task.blocked_by, idMap) ?? [];
		return blockedBy.every((id, index) => id === task.blocked_by?.[index])
			? task
			: { ...task, blocked_by: blockedBy };
	});
}

export function assertUnambiguousProposedTasks(
	tasks: Array<Pick<PlanProposedTask, 'id' | 'title'>>,
	devCode: string,
): void {
	const declaredIds = new Set<string>();
	const idsByNormalizedTitle = new Map<string, Array<string | undefined>>();
	for (const task of tasks) {
		if (task.id) {
			if (declaredIds.has(task.id)) {
				throw new Error(`Plan ${devCode} declares duplicate proposed task id ${task.id}`);
			}
			declaredIds.add(task.id);
		}
		const normalizedTitle = task.title.trim().toLowerCase();
		const titleIds = idsByNormalizedTitle.get(normalizedTitle) ?? [];
		if (titleIds.length > 0 && (!task.id || titleIds.some((id) => !id))) {
			throw new Error(
				`Plan ${devCode} declares ambiguous duplicate proposed task title ${task.title}`,
			);
		}
		titleIds.push(task.id);
		idsByNormalizedTitle.set(normalizedTitle, titleIds);
	}
}

function proposedTitleCounts(tasks: Array<Pick<PlanProposedTask, 'title'>>): Map<string, number> {
	const counts = new Map<string, number>();
	for (const task of tasks) {
		const title = task.title.trim().toLowerCase();
		counts.set(title, (counts.get(title) ?? 0) + 1);
	}
	return counts;
}

type ExistingTask = {
	id?: string;
	title?: string;
	dev_code?: string;
	tags?: unknown;
	planning?: { plan_id?: string; source?: string };
};

type LedgerTask = ExistingTask & Record<string, unknown>;

type Ledger = {
	schema_version: string;
	scope?: { id?: string; name?: string; path?: string; owner?: string };
	tasks?: LedgerTask[];
};

type ParsedTodoLedger = {
	format: 'array' | 'object';
	tasks: LedgerTask[];
	write: (tasks: LedgerTask[]) => string;
};

function parseTodoLedger(raw: string): ParsedTodoLedger {
	const parsed = JSON.parse(raw) as Ledger | LedgerTask[];
	if (Array.isArray(parsed)) {
		return {
			format: 'array',
			tasks: parsed,
			write: (tasks) => `${JSON.stringify(tasks, null, 2)}\n`,
		};
	}
	return {
		format: 'object',
		tasks: parsed.tasks ?? [],
		write: (tasks) => `${JSON.stringify({ ...parsed, tasks }, null, 2)}\n`,
	};
}

function today(): string {
	return new Date().toISOString().slice(0, 10);
}

function taskTags(plan: MissionControlPlan, proposed: PlanProposedTask): string[] {
	const tags = new Set<string>([plan.dev_code, 'mission-control']);
	for (const tag of proposed.tags ?? []) tags.add(tag);
	return [...tags];
}

function taskSignature(plan: MissionControlPlan, title: string): string {
	return `${plan.dev_code}::${title.trim().toLowerCase()}`;
}

function existingDevCode(task: ExistingTask): string | undefined {
	if (typeof task.dev_code === 'string' && PLAN_CODE_RE.test(task.dev_code.trim().toUpperCase())) {
		return task.dev_code.trim().toUpperCase();
	}
	if (Array.isArray(task.tags)) {
		const tag = task.tags.find(
			(value) => typeof value === 'string' && PLAN_CODE_RE.test(value.trim().toUpperCase()),
		);
		return typeof tag === 'string' ? tag.trim().toUpperCase() : undefined;
	}
	return undefined;
}

type ReservationOwner = { devCode?: string; planId?: string };

function reservationOwnerFromTask(task: ExistingTask): ReservationOwner {
	return {
		devCode: existingDevCode(task),
		planId: task.planning?.source === 'mission-control' ? task.planning.plan_id : undefined,
	};
}

async function loadReservations() {
	const takenIds = new Set<string>();
	const idsBySignature = new Map<string, string>();
	const ownerById = new Map<string, ReservationOwner>();
	for (const file of await listWorkspaceLedgerFiles(undefined, EXPORT_RESERVATION_LEDGER_FILES)) {
		try {
			const parsed = JSON.parse(await readFile(file, 'utf8')) as Ledger | LedgerTask[];
			const tasks = Array.isArray(parsed) ? parsed : (parsed.tasks ?? []);
			for (const task of tasks) {
				if (typeof task.id === 'string') {
					takenIds.add(task.id);
					if (!ownerById.has(task.id)) {
						ownerById.set(task.id, reservationOwnerFromTask(task));
					}
				}
				if (typeof task.id !== 'string' || typeof task.title !== 'string') {
					continue;
				}
				const devCode = existingDevCode(task);
				if (devCode) {
					idsBySignature.set(`${devCode}::${task.title.trim().toLowerCase()}`, task.id);
				}
				if (task.planning?.source === 'mission-control' && task.planning.plan_id) {
					idsBySignature.set(
						`${task.planning.plan_id}::${task.title.trim().toLowerCase()}`,
						task.id,
					);
				}
			}
		} catch {
			// invalid ledgers are handled by workspace validation; export just avoids crashing
		}
	}
	return { takenIds, idsBySignature, ownerById };
}

function reservationOwnedByPlan(
	owner: ReservationOwner | undefined,
	plan: Pick<MissionControlPlan, 'dev_code' | 'id'>,
): boolean {
	return owner?.devCode === plan.dev_code || owner?.planId === plan.id;
}

function nextTaskId(date: string, takenIds: Set<string>) {
	for (let index = 1; index < 1000; index += 1) {
		const id = `task-${date}-${String(index).padStart(3, '0')}`;
		if (!takenIds.has(id)) {
			takenIds.add(id);
			return id;
		}
	}
	throw new Error(`No task id slots left for ${date}`);
}

export function assignTodoExportId(
	reservedId: string | undefined,
	declaredId: string | undefined,
	date: string,
	takenIds: Set<string>,
	assignedIds: Set<string>,
): string {
	const id =
		(reservedId && !assignedIds.has(reservedId) ? reservedId : undefined) ??
		(declaredId && !assignedIds.has(declaredId) ? declaredId : undefined) ??
		nextTaskId(date, takenIds);
	takenIds.add(id);
	assignedIds.add(id);
	return id;
}

function planLinks(plan: MissionControlPlan, planPath: string): PlanLink[] {
	const seen = new Set<string>();
	const links: PlanLink[] = [];
	const add = (link: PlanLink) => {
		const key = `${link.label}|${link.path ?? ''}|${link.url ?? ''}`;
		if (seen.has(key)) return;
		seen.add(key);
		links.push(link);
	};
	add({ label: 'Mission Control plan', path: planPath });
	for (const link of plan.links ?? []) add(link);
	return links;
}

function priorityReasonFromSummary(summary: string): string {
	const normalized = summary.replace(/\s+/g, ' ').trim();
	if (normalized.length <= 220) return normalized;
	const clipped = normalized.slice(0, 219);
	const boundary = clipped.lastIndexOf(' ');
	const prefix = boundary > 140 ? clipped.slice(0, boundary) : clipped;
	return `${prefix.trimEnd()}…`;
}

function assertTodoExportTarget(plan: MissionControlPlan): asserts plan is MissionControlPlan & {
	planning_target: { scope: string; todo_tasks_path: string };
	proposed_tasks: PlanProposedTask[];
} {
	if (!plan.planning_target?.todo_tasks_path) {
		throw new Error(`Plan ${plan.dev_code} has no planning_target.todo_tasks_path for TODO export`);
	}
	if (!TODO_LEDGER_RE.test(plan.planning_target.todo_tasks_path)) {
		throw new Error(
			`Plan ${plan.dev_code} cannot export open TODO tasks into ${plan.planning_target.todo_tasks_path}`,
		);
	}
	if (!plan.proposed_tasks || plan.proposed_tasks.length === 0) {
		throw new Error(`Plan ${plan.dev_code} has no proposed_tasks for TODO export`);
	}
}

export function appendTodoTasksToLedgerText(
	raw: string,
	additions: TodoExportTask[],
	existingTaskCount: number,
): string {
	if (additions.length === 0) return raw;
	const serialized = additions
		.map((task) =>
			JSON.stringify(task, null, 2)
				.split('\n')
				.map((line) => `    ${line}`)
				.join('\n'),
		)
		.join(',\n');
	const nextRaw =
		existingTaskCount === 0
			? raw.replace(/"tasks":\s*\[\s*\]/, () => `"tasks": [\n${serialized}\n  ]`)
			: raw.replace(/\n {2}\]\n}\s*$/, () => `,\n${serialized}\n  ]\n}\n`);
	if (nextRaw === raw) {
		throw new Error('Could not append TODO tasks while preserving ledger formatting');
	}
	return nextRaw;
}

function exportTaskWithPreservedFields(existing: LedgerTask, next: TodoExportTask): TodoExportTask {
	return {
		...next,
		created_at: typeof existing.created_at === 'string' ? existing.created_at : next.created_at,
	};
}

export function normalizedJson(value: unknown): string {
	return JSON.stringify(value, (_key, raw) => {
		if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
			const sorted: Record<string, unknown> = {};
			for (const key of Object.keys(raw).sort()) {
				sorted[key] = (raw as Record<string, unknown>)[key];
			}
			return sorted;
		}
		return raw;
	});
}

export async function buildTodoExportProposal(planIdOrDevCode: string) {
	const record = await getPlanByIdOrDevCode(planIdOrDevCode);
	if (!record) throw new Error(`Plan not found: ${planIdOrDevCode}`);
	const validation = validatePlanShape(record.plan);
	if (!validation.ok) {
		throw new Error(
			`Plan is invalid: ${validation.errors.map((error) => `${error.path}: ${error.message}`).join(', ')}`,
		);
	}

	const plan = record.plan;
	assertTodoExportTarget(plan);
	const proposed = plan.proposed_tasks;
	const planPath = missionControlDataRelative(record.absolutePath);

	const reservations = await loadReservations();
	const date = today();
	const links = planLinks(plan, planPath);
	assertUnambiguousProposedTasks(proposed, plan.dev_code);
	const titleCounts = proposedTitleCounts(proposed);
	const declaredToExported = new Map<string, string>();
	const assignedIdsInProposal = new Set<string>();
	const assignedIds = proposed.map((task) => {
		const priority = task.priority ?? plan.priority;
		const normalizedTitle = task.title.trim().toLowerCase();
		const reservedId =
			titleCounts.get(normalizedTitle) === 1
				? (reservations.idsBySignature.get(taskSignature(plan, task.title)) ??
					reservations.idsBySignature.get(`${plan.id}::${normalizedTitle}`))
				: undefined;
		// A plan-declared id is only usable when it is free or already owned by
		// this plan; otherwise it would silently collide with an unrelated task
		// in another workspace ledger and the export would drop the task.
		const declaredId =
			task.id &&
			(!reservations.takenIds.has(task.id) ||
				reservationOwnedByPlan(reservations.ownerById.get(task.id), plan))
				? task.id
				: undefined;
		const id = assignTodoExportId(
			reservedId,
			declaredId,
			date,
			reservations.takenIds,
			assignedIdsInProposal,
		);
		if (task.id) declaredToExported.set(task.id, id);
		return { id, priority };
	});
	const tasks = proposed.map((task, index): TodoExportTask => {
		const { id, priority } = assignedIds[index];
		const blockedBy = remapTodoDependencyIds(task.blocked_by, declaredToExported);
		return {
			id,
			title: task.title,
			status: 'open',
			priority,
			priority_rank: defaultPriorityRank(priority) + index,
			assignee: 'agent',
			priority_decider: plan.owner,
			priority_reason: task.priority_reason ?? priorityReasonFromSummary(task.summary),
			created_at: date,
			updated_at: date,
			tags: taskTags(plan, task),
			dev_code: plan.dev_code,
			summary: task.summary,
			risk_notes: task.risk_notes ?? plan.risk_notes ?? [],
			acceptance_criteria:
				task.acceptance_criteria && task.acceptance_criteria.length > 0
					? task.acceptance_criteria
					: plan.acceptance_criteria,
			...(blockedBy && blockedBy.length > 0 ? { blocked_by: blockedBy } : {}),
			links,
			planning: {
				plan_id: plan.id,
				path: planPath,
				source: 'mission-control',
				role: 'planning_source',
			},
			source: 'mission-control',
		};
	});

	return {
		plan_id: plan.id,
		dev_code: plan.dev_code,
		plan_path: planPath,
		target: plan.planning_target ?? null,
		proposed_tasks: tasks,
	};
}

export async function applyProposal(proposal: Awaited<ReturnType<typeof buildTodoExportProposal>>) {
	if (!proposal.target?.todo_tasks_path) {
		throw new Error('Plan has no planning_target.todo_tasks_path');
	}
	if (!TODO_LEDGER_RE.test(proposal.target.todo_tasks_path)) {
		throw new Error(`TODO export can only apply into TODO.tasks.json`);
	}
	const targetPath = resolveConfiguredMissionControlPath(proposal.target.todo_tasks_path);
	assertDirectCanonicalWriteAllowed(targetPath);
	const raw = await readFile(targetPath, 'utf8');
	const ledger = parseTodoLedger(raw);
	const tasks = ledger.tasks;
	const reservations = await loadReservations();
	const existing = new Set<string>(reservations.takenIds);
	for (const task of tasks) {
		if (typeof task.id === 'string') existing.add(task.id);
	}
	const targetIndexes = new Map<string, number>();
	tasks.forEach((task, index) => {
		if (typeof task.id === 'string') targetIndexes.set(task.id, index);
	});
	let additions: TodoExportTask[] = [];
	const reminted: Array<{ from: string; to: string }> = [];
	const updatedIndexes = new Set<number>();
	const touchedIndexes = new Set<number>();
	const proposalPlan = { dev_code: proposal.dev_code, id: proposal.plan_id };
	for (const task of proposal.proposed_tasks) {
		const targetIndex = targetIndexes.get(task.id);
		if (targetIndex !== undefined) {
			if (!reservationOwnedByPlan(reservationOwnerFromTask(tasks[targetIndex]), proposalPlan)) {
				const remintedId = nextTaskId(today(), existing);
				reminted.push({ from: task.id, to: remintedId });
				additions.push({ ...task, id: remintedId });
				continue;
			}
			touchedIndexes.add(targetIndex);
			const nextTask = exportTaskWithPreservedFields(tasks[targetIndex], task);
			if (normalizedJson(tasks[targetIndex]) !== normalizedJson(nextTask)) {
				tasks[targetIndex] = nextTask;
				updatedIndexes.add(targetIndex);
			}
			continue;
		}
		if (existing.has(task.id)) {
			const owner = reservations.ownerById.get(task.id);
			const sameTask =
				owner && (owner.devCode === task.dev_code || owner.planId === task.planning.plan_id);
			// The same plan task already lives in another ledger (plan was
			// retargeted): keep it there instead of duplicating it here.
			if (sameTask) continue;
			// A foreign task holds this id: remint instead of dropping the
			// export, and surface the old -> new mapping to the caller so logs
			// and follow-up lookups do not chase the colliding id.
			const remintedId = nextTaskId(today(), existing);
			existing.add(remintedId);
			reminted.push({ from: task.id, to: remintedId });
			additions.push({ ...task, id: remintedId });
			continue;
		}
		additions.push(task);
		existing.add(task.id);
	}
	additions = remapTodoTaskDependencies(additions, reminted);
	if (reminted.length > 0) {
		const remintedMap = new Map(reminted.map(({ from, to }) => [from, to]));
		for (const targetIndex of touchedIndexes) {
			const task = tasks[targetIndex] as TodoExportTask;
			if (!task.blocked_by || task.blocked_by.length === 0) continue;
			const blockedBy = task.blocked_by.map((id) => remintedMap.get(id) ?? id);
			if (blockedBy.every((id, index) => id === task.blocked_by?.[index])) {
				continue;
			}
			tasks[targetIndex] = { ...task, blocked_by: blockedBy };
			updatedIndexes.add(targetIndex);
		}
	}
	const updated = updatedIndexes.size;
	if (additions.length === 0 && updated === 0) {
		return {
			target_path: proposal.target.todo_tasks_path,
			added: 0,
			updated: 0,
			reminted,
		};
	}

	const rewriteWholeLedger = ledger.format === 'array' || updated > 0;
	if (rewriteWholeLedger) {
		tasks.push(...additions);
	}
	const nextRaw = rewriteWholeLedger
		? ledger.write(tasks)
		: appendTodoTasksToLedgerText(raw, additions, tasks.length);
	await atomicReplaceFile(targetPath, nextRaw);
	return {
		target_path: proposal.target.todo_tasks_path,
		added: additions.length,
		updated,
		reminted,
	};
}

function argValue(name: string): string | undefined {
	const index = process.argv.indexOf(name);
	return index === -1 ? undefined : process.argv[index + 1];
}

if (import.meta.main) {
	const plan = argValue('--plan');
	if (!plan) {
		console.error(`Usage: bun run export -- --plan ${PLAN_CODE_PLACEHOLDER} [--apply]`);
		process.exit(1);
	}
	const proposal = await buildTodoExportProposal(plan);
	if (process.argv.includes('--apply')) {
		const result = await applyProposal(proposal);
		console.log(JSON.stringify({ ...proposal, apply: result }, null, 2));
	} else {
		console.log(JSON.stringify(proposal, null, 2));
	}
}
