import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
	type FeaturePlan,
	type PlanLink,
	type PlanProposedTask,
	type PlanRecord,
	WORKSPACE_ROOT,
} from "./plans.ts";

export type ProposedTask = {
	id: string;
	title: string;
	status: "open";
	priority: "high" | "medium" | "low";
	priority_rank: number;
	assignee: "agent";
	priority_decider: string;
	priority_reason: string;
	created_at: string;
	updated_at: string;
	tags: string[];
	summary: string;
	risk_notes: string[];
	acceptance_criteria: string[];
	links: PlanLink[];
	planning: {
		plan_id: string;
		path: string;
		source: "mission-control";
		role: "planning_source";
	};
	source: "mission-control";
};

export type ExportResult = {
	plan_id: string;
	plan_path: string;
	target: {
		scope: string;
		todo_tasks_path?: string;
		resolved_path?: string;
	} | null;
	warnings: string[];
	proposed_tasks: ProposedTask[];
};

const PRIORITY_RANKS: Record<"high" | "medium" | "low", number> = {
	high: 50,
	medium: 100,
	low: 200,
};
const TASK_LEDGER_FILES = new Set(["TODO.tasks.json", "DONE.tasks.json"]);
const IGNORED_DIRS = new Set([".git", "node_modules", ".build", "dist"]);

type ExistingTask = {
	id?: string;
	title?: string;
	source?: string;
	planning?: {
		plan_id?: string;
		source?: string;
	};
};

type TaskReservations = {
	takenIds: Set<string>;
	idsByPlanTitle: Map<string, string>;
};

function today(): string {
	return new Date().toISOString().slice(0, 10);
}

function nextTaskId(date: string, taken: Set<string>): string {
	let counter = 1;
	while (counter < 1000) {
		const candidate = `task-${date}-${String(counter).padStart(3, "0")}`;
		if (!taken.has(candidate)) {
			taken.add(candidate);
			return candidate;
		}
		counter += 1;
	}
	throw new Error("Exhausted task id slots for date " + date);
}

function planTaskRank(plan: FeaturePlan, index: number): number {
	const priority = plan.proposed_tasks?.[index]?.priority;
	const base = priority ? PRIORITY_RANKS[priority] : PRIORITY_RANKS.medium;
	return base + index;
}

function planTaskPriority(
	plan: FeaturePlan,
	index: number,
): "high" | "medium" | "low" {
	return plan.proposed_tasks?.[index]?.priority ?? "medium";
}

function planTaskTags(plan: FeaturePlan, proposed: PlanProposedTask): string[] {
	const tags = new Set<string>();
	for (const tag of plan.tags ?? []) tags.add(tag);
	for (const tag of proposed.tags ?? []) tags.add(tag);
	tags.add("mission-control");
	return [...tags];
}

function planTaskAcceptance(
	plan: FeaturePlan,
	proposed: PlanProposedTask,
): string[] {
	if (proposed.acceptance_criteria && proposed.acceptance_criteria.length > 0) {
		return proposed.acceptance_criteria;
	}
	return [...plan.acceptance_criteria];
}

function planTaskRisks(
	plan: FeaturePlan,
	proposed: PlanProposedTask,
): string[] {
	if (proposed.risk_notes && proposed.risk_notes.length > 0) {
		return proposed.risk_notes;
	}
	return plan.risk_notes ?? [];
}

function planTaskLinks(
	plan: FeaturePlan,
	planRelativeToWorkspace: string,
	proposed: PlanProposedTask,
): PlanLink[] {
	const links: PlanLink[] = [];
	const seen = new Set<string>();
	const addLink = (link: PlanLink) => {
		const key = `${link.label}|${link.path ?? ""}|${link.url ?? ""}`;
		if (seen.has(key)) return;
		seen.add(key);
		links.push({ ...link });
	};
	addLink({ label: "Plán Mission Controlu", path: planRelativeToWorkspace });
	for (const link of plan.links ?? []) addLink(link);
	for (const link of proposed.links ?? []) addLink(link);
	return links;
}

async function listTaskLedgerFiles(dir: string): Promise<string[]> {
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return [];
	}
	const nested = await Promise.all(
		entries.map(async (entry) => {
			if (IGNORED_DIRS.has(entry.name)) return [];
			const fullPath = path.join(dir, entry.name);
			if (entry.isDirectory()) return listTaskLedgerFiles(fullPath);
			if (entry.isFile() && TASK_LEDGER_FILES.has(entry.name)) return [fullPath];
			return [];
		}),
	);
	return nested.flat();
}

function taskSignature(planId: string, title: string): string {
	return `${planId}::${title.trim().toLowerCase()}`;
}

async function addReservationsFromFile(
	filePath: string,
	reservations: TaskReservations,
) {
	try {
		const raw = await readFile(filePath, "utf8");
		const parsed = JSON.parse(raw) as { tasks?: ExistingTask[] };
		for (const task of parsed.tasks ?? []) {
			if (typeof task.id === "string") reservations.takenIds.add(task.id);
			if (
				typeof task.id === "string" &&
				typeof task.title === "string" &&
				task.source === "mission-control" &&
				task.planning?.source === "mission-control" &&
				typeof task.planning.plan_id === "string"
			) {
				reservations.idsByPlanTitle.set(
					taskSignature(task.planning.plan_id, task.title),
					task.id,
				);
			}
		}
	} catch {
		// missing or unparseable file — ignore for reservation purposes
	}
}

async function loadTaskReservations(
	targetPath?: string,
): Promise<TaskReservations> {
	const reservations: TaskReservations = {
		takenIds: new Set<string>(),
		idsByPlanTitle: new Map<string, string>(),
	};
	const files = await listTaskLedgerFiles(WORKSPACE_ROOT);
	await Promise.all(
		files.map((file) => addReservationsFromFile(file, reservations)),
	);
	if (targetPath) await addReservationsFromFile(targetPath, reservations);
	return reservations;
}

function planRelativeToWorkspace(record: PlanRecord): string {
	return path.relative(WORKSPACE_ROOT, record.absolutePath);
}

function planSummaryFor(
	plan: FeaturePlan,
	proposed: PlanProposedTask,
): string {
	return proposed.summary || plan.context.split("\n")[0] || plan.title;
}

function planPriorityReason(plan: FeaturePlan): string {
	const text = (plan.context || "").trim().split("\n")[0] || plan.title;
	return text.length > 200 ? text.slice(0, 197) + "…" : text;
}

export async function buildExportProposal(
	record: PlanRecord,
): Promise<ExportResult> {
	const plan = record.plan;
	const warnings: string[] = [];
	const proposedSource = plan.proposed_tasks ?? [];
	if (proposedSource.length === 0) {
		warnings.push(
			"Plán nemá pole proposed_tasks. Export navrhne jeden obecný úkol ze shrnutí plánu.",
		);
	}

	const target = plan.planning_target ?? null;
	let resolvedTargetPath: string | undefined;
	if (target?.todo_tasks_path) {
		resolvedTargetPath = path.resolve(WORKSPACE_ROOT, target.todo_tasks_path);
	}
	if (!target) {
		warnings.push(
			"Plán nemá planning_target. Export jen vypisuje návrh; vyber cíl a doplň ho před materializací.",
		);
	}

	const reservations = await loadTaskReservations(resolvedTargetPath);
	const date = today();
	const planRelative = planRelativeToWorkspace(record);

	const fallback: PlanProposedTask[] =
		proposedSource.length > 0
			? proposedSource
			: [
					{
						title: `Materializovat ${plan.title}`,
						summary: planSummaryFor(plan, { title: "", summary: "" }),
					},
				];

	let existingMaterializedCount = 0;
	const proposed: ProposedTask[] = fallback.map((source, index) => {
		const existingId = reservations.idsByPlanTitle.get(
			taskSignature(plan.id, source.title),
		);
		if (existingId) existingMaterializedCount += 1;
		return {
			id: existingId ?? nextTaskId(date, reservations.takenIds),
			title: source.title,
			status: "open",
			priority: planTaskPriority(plan, index),
			priority_rank: planTaskRank(plan, index),
			assignee: "agent",
			priority_decider: plan.owner || "jannovak",
			priority_reason: planPriorityReason(plan),
			created_at: date,
			updated_at: date,
			tags: planTaskTags(plan, source),
			summary: planSummaryFor(plan, source),
			risk_notes: planTaskRisks(plan, source),
			acceptance_criteria: planTaskAcceptance(plan, source),
			links: planTaskLinks(plan, planRelative, source),
			planning: {
				plan_id: plan.id,
				path: planRelative,
				source: "mission-control",
				role: "planning_source",
			},
			source: "mission-control",
		};
	});

	if (existingMaterializedCount > 0) {
		warnings.push(
			`${existingMaterializedCount} úkol(ů) už existuje pro tento plán; export zachoval jejich ID a --apply je nepřidá znovu.`,
		);
	}

	return {
		plan_id: plan.id,
		plan_path: planRelative,
		target: target
			? {
					scope: target.scope,
					todo_tasks_path: target.todo_tasks_path,
					resolved_path: resolvedTargetPath
						? path.relative(WORKSPACE_ROOT, resolvedTargetPath)
						: undefined,
				}
			: null,
		warnings,
		proposed_tasks: proposed,
	};
}
