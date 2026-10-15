import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { WORKSPACE_ROOT } from "./plans.ts";

const LEDGER_FILES = new Set([
	"TODO.tasks.json",
	"DONE.tasks.json",
	"ISSUES.open.json",
]);
const IGNORED_DIRS = new Set([
	".git",
	".claude",
	".agents",
	".build",
	".next",
	".turbo",
	"build",
	"dist",
	"node_modules",
	"runtime",
	"logs",
]);

export type WorkColumnId =
	| "planned"
	| "in_progress"
	| "review"
	| "blocked"
	| "done"
	| "issues";

export type WorkItem = {
	id: string;
	kind: "todo" | "done" | "issue";
	column: WorkColumnId;
	title: string;
	status: string;
	priority?: string;
	severity?: string;
	assignee?: string;
	owner?: string;
	updated_at?: string;
	summary?: string;
	tags: string[];
	ledger_path: string;
	scope_id?: string;
	scope_name?: string;
	planning?: {
		plan_id?: string;
		path?: string;
		source?: string;
		role?: string;
	};
	has_plan: boolean;
};

export type WorkBoardColumn = {
	id: WorkColumnId;
	title: string;
	items: WorkItem[];
};

export type WorkBoardLedger = {
	path: string;
	kind: "todo" | "done" | "issues";
	scope_id?: string;
	scope_name?: string;
	item_count: number;
};

export type WorkBoard = {
	generated_at: string;
	workspace_root: string;
	roles: Array<{
		id: "workspace-admin" | "workspace-manager" | "power-user";
		name: string;
		person: string;
		scope: "all" | "operations" | "execution";
	}>;
	ledgers: WorkBoardLedger[];
	columns: WorkBoardColumn[];
	planning_coverage: {
		todo_total: number;
		todo_with_plan: number;
		todo_without_plan: number;
		missing_plan_task_ids: string[];
	};
};

type RawTask = {
	id?: string;
	title?: string;
	status?: string;
	priority?: string;
	severity?: string;
	assignee?: string;
	owner?: string;
	updated_at?: string;
	summary?: string;
	question?: string;
	current_decision?: string;
	tags?: unknown;
	planning?: WorkItem["planning"];
};

type LedgerData = {
	scope?: {
		id?: string;
		name?: string;
	};
	tasks?: RawTask[];
	issues?: RawTask[];
};

async function listLedgerFiles(dir: string): Promise<string[]> {
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
			if (entry.isDirectory()) return listLedgerFiles(fullPath);
			if (entry.isFile() && LEDGER_FILES.has(entry.name)) return [fullPath];
			return [];
		}),
	);
	return nested.flat();
}

function ledgerKind(filePath: string): WorkBoardLedger["kind"] {
	const name = path.basename(filePath);
	if (name === "DONE.tasks.json") return "done";
	if (name === "ISSUES.open.json") return "issues";
	return "todo";
}

function taskColumn(kind: WorkBoardLedger["kind"], status = ""): WorkColumnId {
	if (kind === "issues") return "issues";
	if (kind === "done") return "done";
	if (status === "in_progress" || status === "active") return "in_progress";
	if (status === "review") return "review";
	if (status === "blocked") return "blocked";
	if (status === "done" || status === "closed" || status === "archived") {
		return "done";
	}
	return "planned";
}

function stringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

function itemSummary(raw: RawTask): string {
	return raw.summary || raw.question || raw.current_decision || "";
}

function toWorkItem(
	raw: RawTask,
	ledger: WorkBoardLedger,
	index: number,
): WorkItem {
	const status = raw.status || (ledger.kind === "done" ? "done" : "open");
	const planning = raw.planning;
	const hasPlan =
		ledger.kind !== "todo" ||
		Boolean(planning?.source === "mission-control" && planning.plan_id);
	return {
		id: raw.id || `${ledger.path}#${index + 1}`,
		kind: ledger.kind === "issues" ? "issue" : ledger.kind,
		column: taskColumn(ledger.kind, status),
		title: raw.title || "(bez názvu)",
		status,
		priority: raw.priority,
		severity: raw.severity,
		assignee: raw.assignee,
		owner: raw.owner,
		updated_at: raw.updated_at,
		summary: itemSummary(raw),
		tags: stringArray(raw.tags),
		ledger_path: ledger.path,
		scope_id: ledger.scope_id,
		scope_name: ledger.scope_name,
		planning,
		has_plan: hasPlan,
	};
}

async function readLedger(filePath: string): Promise<{
	ledger: WorkBoardLedger;
	items: WorkItem[];
}> {
	const relativePath = path.relative(WORKSPACE_ROOT, filePath);
	const kind = ledgerKind(filePath);
	try {
		const parsed = JSON.parse(await readFile(filePath, "utf8")) as LedgerData;
		const rawItems = kind === "issues" ? (parsed.issues ?? []) : (parsed.tasks ?? []);
		const ledger: WorkBoardLedger = {
			path: relativePath,
			kind,
			scope_id: parsed.scope?.id,
			scope_name: parsed.scope?.name,
			item_count: rawItems.length,
		};
		return {
			ledger,
			items: rawItems.map((item, index) => toWorkItem(item, ledger, index)),
		};
	} catch {
		return {
			ledger: {
				path: relativePath,
				kind,
				item_count: 0,
			},
			items: [],
		};
	}
}

function emptyColumns(): WorkBoardColumn[] {
	return [
		{ id: "planned", title: "TODO", items: [] },
		{ id: "in_progress", title: "IN_PROGRESS", items: [] },
		{ id: "review", title: "CODE_REVIEW", items: [] },
		{ id: "blocked", title: "BLOCKED", items: [] },
		{ id: "done", title: "DONE", items: [] },
		{ id: "issues", title: "ISSUES", items: [] },
	];
}

export async function buildWorkBoard(): Promise<WorkBoard> {
	const files = await listLedgerFiles(WORKSPACE_ROOT);
	const records = await Promise.all(files.map(readLedger));
	const ledgers = records.map((record) => record.ledger);
	const items = records.flatMap((record) => record.items);
	const columns = emptyColumns();
	const columnById = new Map(columns.map((column) => [column.id, column]));
	for (const item of items) {
		columnById.get(item.column)?.items.push(item);
	}
	for (const column of columns) {
		column.items.sort((a, b) =>
			(b.updated_at || "").localeCompare(a.updated_at || "") ||
			a.title.localeCompare(b.title),
		);
	}
	const todoItems = items.filter((item) => item.kind === "todo");
	const missingPlan = todoItems.filter((item) => !item.has_plan);
	return {
		generated_at: new Date().toISOString(),
		workspace_root: WORKSPACE_ROOT,
		roles: [
			{
				id: "workspace-admin",
				name: "Administrátor pracovního prostoru",
				person: "jannovak",
				scope: "all",
			},
			{
				id: "workspace-manager",
				name: "Správce pracovního prostoru",
				person: "petr",
				scope: "operations",
			},
			{
				id: "power-user",
				name: "Pokročilý uživatel",
				person: "team",
				scope: "execution",
			},
		],
		ledgers,
		columns,
		planning_coverage: {
			todo_total: todoItems.length,
			todo_with_plan: todoItems.length - missingPlan.length,
			todo_without_plan: missingPlan.length,
			missing_plan_task_ids: missingPlan.map((item) => item.id),
		},
	};
}
