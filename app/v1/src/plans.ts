import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
	type ValidationResult,
	validateFeaturePlan,
} from "./validate.ts";

export const MODULE_ROOT = path.resolve(import.meta.dir, "..", "..", "..");
export const WORKSPACE_ROOT = path.resolve(MODULE_ROOT, "..");
export const PLANS_ROOT = path.join(MODULE_ROOT, "plans");

const SCHEMA_VERSION = "agentmint.mission_control.feature_plan.v1";

export const PLAN_TYPES = [
	"strategy",
	"feature",
	"experiment",
	"ops",
	"decision",
] as const;

export const PLAN_STATUSES = [
	"shaping",
	"ready",
	"in_progress",
	"blocked",
	"done",
	"archived",
] as const;

export type PlanType = (typeof PLAN_TYPES)[number];
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export type PlanLink = {
	label: string;
	path?: string;
	url?: string;
};

export type PlanDecision = {
	date: string;
	decision: string;
	rationale?: string;
};

export type PlanScope = {
	in?: string[];
	out?: string[];
};

export type PlanProposedTask = {
	title: string;
	summary: string;
	priority?: "high" | "medium" | "low";
	tags?: string[];
	acceptance_criteria?: string[];
	risk_notes?: string[];
	links?: PlanLink[];
};

export type PlanningTarget = {
	scope: string;
	todo_tasks_path?: string;
};

export type FeaturePlan = {
	schema_version: string;
	id: string;
	title: string;
	type: PlanType;
	status: PlanStatus;
	owner: string;
	created_at: string;
	updated_at: string;
	context: string;
	goals: string[];
	scope?: PlanScope;
	acceptance_criteria: string[];
	risk_notes?: string[];
	decisions?: PlanDecision[];
	outcome?: string;
	tags?: string[];
	links?: PlanLink[];
	todo_outputs?: string[];
	planning_target?: PlanningTarget;
	proposed_tasks?: PlanProposedTask[];
	[key: string]: unknown;
};

export type PlanRecord = {
	plan: FeaturePlan;
	relativePath: string;
	absolutePath: string;
	validation: ValidationResult;
};

export type PlanSummary = {
	id: string;
	title: string;
	type: PlanType;
	status: PlanStatus;
	owner: string;
	created_at: string;
	updated_at: string;
	relativePath: string;
	context: string;
	goals: string[];
	tags: string[];
	scope?: PlanScope;
	risk_notes: string[];
	decisions: PlanDecision[];
	links: PlanLink[];
	planning_target?: PlanningTarget;
	proposed_tasks: PlanProposedTask[];
	valid: boolean;
};

export function today(): string {
	return new Date().toISOString().slice(0, 10);
}

export function slugify(value: string): string {
	const normalized = value
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return normalized || "plan";
}

function relative(absolutePath: string): string {
	return path.relative(MODULE_ROOT, absolutePath);
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await access(filePath);
		return true;
	} catch {
		return false;
	}
}

async function listYamlFiles(dir: string): Promise<string[]> {
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return [];
	}
	const nested = await Promise.all(
		entries.map(async (entry) => {
			const fullPath = path.join(dir, entry.name);
			if (entry.isDirectory()) return listYamlFiles(fullPath);
			if (entry.isFile() && entry.name.endsWith(".yaml")) return [fullPath];
			return [];
		}),
	);
	return nested.flat();
}

function ensureArray<T>(value: unknown): T[] {
	return Array.isArray(value) ? (value as T[]) : [];
}

function asPlan(raw: unknown, relativePath: string): FeaturePlan {
	const base: FeaturePlan = {
		schema_version: SCHEMA_VERSION,
		id: relativePath.replace(/\.yaml$/, ""),
		title: relativePath,
		type: "strategy",
		status: "shaping",
		owner: "",
		created_at: today(),
		updated_at: today(),
		context: "",
		goals: [],
		acceptance_criteria: [],
	};
	if (raw && typeof raw === "object") {
		return { ...base, ...(raw as Record<string, unknown>) } as FeaturePlan;
	}
	return base;
}

export async function readPlanRecord(absolutePath: string): Promise<PlanRecord> {
	const raw = await readFile(absolutePath, "utf8");
	let parsed: unknown = {};
	try {
		parsed = parseYaml(raw) ?? {};
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "chyba parsování YAML";
		return {
			plan: asPlan({}, relative(absolutePath)),
			relativePath: relative(absolutePath),
			absolutePath,
			validation: {
				ok: false,
				errors: [{ path: "(file)", message: `Chyba parsování YAML: ${message}` }],
			},
		};
	}
	const plan = asPlan(parsed, relative(absolutePath));
	const validation = await validateFeaturePlan(plan);
	return {
		plan,
		relativePath: relative(absolutePath),
		absolutePath,
		validation,
	};
}

export async function listPlans(): Promise<PlanRecord[]> {
	const files = await listYamlFiles(PLANS_ROOT);
	const records = await Promise.all(files.map(readPlanRecord));
	return records.sort((a, b) =>
		b.plan.updated_at.localeCompare(a.plan.updated_at),
	);
}

export async function listPlanSummaries(): Promise<PlanSummary[]> {
	const records = await listPlans();
	return records.map(toSummary);
}

export function toSummary(record: PlanRecord): PlanSummary {
	const { plan, relativePath, validation } = record;
	return {
		id: plan.id,
		title: plan.title,
		type: plan.type,
		status: plan.status,
		owner: plan.owner,
		created_at: plan.created_at,
		updated_at: plan.updated_at,
		relativePath,
		context: plan.context,
		goals: ensureArray<string>(plan.goals),
		tags: ensureArray<string>(plan.tags),
		scope: plan.scope,
		risk_notes: ensureArray<string>(plan.risk_notes),
		decisions: ensureArray<PlanDecision>(plan.decisions),
		links: ensureArray<PlanLink>(plan.links),
		planning_target: plan.planning_target,
		proposed_tasks: ensureArray<PlanProposedTask>(plan.proposed_tasks),
		valid: validation.ok,
	};
}

export async function getPlanById(id: string): Promise<PlanRecord | null> {
	const records = await listPlans();
	return records.find((record) => record.plan.id === id) ?? null;
}

export async function nextPlanId(date: string): Promise<string> {
	const files = await listYamlFiles(PLANS_ROOT);
	let highest = 0;
	const prefix = `plan-${date}-`;
	await Promise.all(
		files.map(async (file) => {
			const raw = await readFile(file, "utf8");
			let parsed: unknown;
			try {
				parsed = parseYaml(raw);
			} catch {
				return;
			}
			const id =
				parsed && typeof parsed === "object"
					? String((parsed as Record<string, unknown>).id ?? "")
					: "";
			if (!id.startsWith(prefix)) return;
			const tail = Number(id.slice(prefix.length));
			if (Number.isInteger(tail)) highest = Math.max(highest, tail);
		}),
	);
	return `${prefix}${String(highest + 1).padStart(3, "0")}`;
}

async function uniquePlanPath(
	dayDir: string,
	title: string,
): Promise<string> {
	const slug = slugify(title);
	let candidate = path.join(dayDir, `${slug}.yaml`);
	let index = 1;
	while (await fileExists(candidate)) {
		index += 1;
		candidate = path.join(dayDir, `${slug}-${index}.yaml`);
	}
	return candidate;
}

export type CreatePlanInput = {
	title: string;
	type?: PlanType;
	status?: PlanStatus;
	owner?: string;
	context?: string;
	goals?: string[];
	scope?: PlanScope;
	acceptance_criteria?: string[];
	risk_notes?: string[];
	tags?: string[];
	links?: PlanLink[];
	planning_target?: PlanningTarget;
	proposed_tasks?: PlanProposedTask[];
};

function cleanArray(items: unknown): string[] {
	if (!Array.isArray(items)) return [];
	return items
		.map((item) => (typeof item === "string" ? item.trim() : ""))
		.filter((item) => item.length > 0);
}

function cleanLinks(items: unknown): PlanLink[] {
	if (!Array.isArray(items)) return [];
	return items
		.map((item) => {
			if (!item || typeof item !== "object") return null;
			const obj = item as Record<string, unknown>;
			const label = typeof obj.label === "string" ? obj.label.trim() : "";
			if (!label) return null;
			const link: PlanLink = { label };
			if (typeof obj.path === "string" && obj.path.trim())
				link.path = obj.path.trim();
			if (typeof obj.url === "string" && obj.url.trim())
				link.url = obj.url.trim();
			return link;
		})
		.filter((link): link is PlanLink => link !== null);
}

function cleanProposedTasks(items: unknown): PlanProposedTask[] {
	if (!Array.isArray(items)) return [];
	return items
		.map((item) => {
			if (!item || typeof item !== "object") return null;
			const obj = item as Record<string, unknown>;
			const title = typeof obj.title === "string" ? obj.title.trim() : "";
			const summary = typeof obj.summary === "string" ? obj.summary.trim() : "";
			if (!title || !summary) return null;
			const task: PlanProposedTask = { title, summary };
			if (
				typeof obj.priority === "string" &&
				["high", "medium", "low"].includes(obj.priority)
			) {
				task.priority = obj.priority as "high" | "medium" | "low";
			}
			const tags = cleanArray(obj.tags);
			if (tags.length > 0) task.tags = tags;
			const ac = cleanArray(obj.acceptance_criteria);
			if (ac.length > 0) task.acceptance_criteria = ac;
			const rn = cleanArray(obj.risk_notes);
			if (rn.length > 0) task.risk_notes = rn;
			const links = cleanLinks(obj.links);
			if (links.length > 0) task.links = links;
			return task;
		})
		.filter((task): task is PlanProposedTask => task !== null);
}

function normaliseScope(value: unknown): PlanScope | undefined {
	if (!value || typeof value !== "object") return undefined;
	const obj = value as Record<string, unknown>;
	const result: PlanScope = {};
	const inItems = cleanArray(obj.in);
	const outItems = cleanArray(obj.out);
	if (inItems.length > 0) result.in = inItems;
	if (outItems.length > 0) result.out = outItems;
	return result.in || result.out ? result : undefined;
}

function normalisePlanningTarget(value: unknown): PlanningTarget | undefined {
	if (!value || typeof value !== "object") return undefined;
	const obj = value as Record<string, unknown>;
	const scope = typeof obj.scope === "string" ? obj.scope.trim() : "";
	if (!scope) return undefined;
	const target: PlanningTarget = { scope };
	if (
		typeof obj.todo_tasks_path === "string" &&
		obj.todo_tasks_path.trim()
	) {
		target.todo_tasks_path = obj.todo_tasks_path.trim();
	}
	return target;
}

function buildPlan(input: CreatePlanInput, id: string): FeaturePlan {
	const date = today();
	const goals = cleanArray(input.goals);
	const acceptance = cleanArray(input.acceptance_criteria);
	const tags = cleanArray(input.tags);
	const risks = cleanArray(input.risk_notes);
	const plan: FeaturePlan = {
		schema_version: SCHEMA_VERSION,
		id,
		title: input.title.trim(),
		type: input.type ?? "strategy",
		status: input.status ?? "shaping",
		owner: input.owner?.trim() || "jannovak",
		created_at: date,
		updated_at: date,
		context:
			(typeof input.context === "string" ? input.context : "").trim() ||
			"Doplnit kontext.",
		goals: goals.length > 0 ? goals : ["Doplnit cíl"],
		acceptance_criteria:
			acceptance.length > 0 ? acceptance : ["Doplnit kritérium"],
	};
	const scope = normaliseScope(input.scope);
	if (scope) plan.scope = scope;
	if (risks.length > 0) plan.risk_notes = risks;
	if (tags.length > 0) plan.tags = tags;
	const links = cleanLinks(input.links);
	if (links.length > 0) plan.links = links;
	const target = normalisePlanningTarget(input.planning_target);
	if (target) plan.planning_target = target;
	const proposed = cleanProposedTasks(input.proposed_tasks);
	if (proposed.length > 0) plan.proposed_tasks = proposed;
	return plan;
}

function serialisePlan(plan: FeaturePlan): string {
	return stringifyYaml(plan, {
		lineWidth: 0,
		blockQuote: "literal",
	});
}

export async function createPlan(
	input: CreatePlanInput,
): Promise<{ record: PlanRecord; validation: ValidationResult }> {
	const date = today();
	const dayDir = path.join(PLANS_ROOT, date.slice(0, 4), date.slice(5, 7));
	await mkdir(dayDir, { recursive: true });
	const id = await nextPlanId(date);
	const filePath = await uniquePlanPath(dayDir, input.title);
	const plan = buildPlan(input, id);
	const validation = await validateFeaturePlan(plan);
	await writeFile(filePath, serialisePlan(plan), "utf8");
	return {
		record: {
			plan,
			relativePath: relative(filePath),
			absolutePath: filePath,
			validation,
		},
		validation,
	};
}

export type UpdatePlanInput = {
	title?: string;
	type?: PlanType;
	status?: PlanStatus;
	owner?: string;
	context?: string;
	goals?: string[];
	scope?: PlanScope;
	acceptance_criteria?: string[];
	risk_notes?: string[];
	tags?: string[];
	links?: PlanLink[];
	todo_outputs?: string[];
	planning_target?: PlanningTarget;
	proposed_tasks?: PlanProposedTask[];
	decisions?: PlanDecision[];
	outcome?: string;
};

function applyUpdate(
	existing: FeaturePlan,
	patch: UpdatePlanInput,
): FeaturePlan {
	const next: FeaturePlan = { ...existing };

	if (patch.title !== undefined) next.title = patch.title.trim();
	if (patch.type !== undefined) next.type = patch.type;
	if (patch.status !== undefined) next.status = patch.status;
	if (patch.owner !== undefined) next.owner = patch.owner.trim();
	if (patch.context !== undefined) next.context = patch.context;
	if (patch.outcome !== undefined) next.outcome = patch.outcome;

	if (patch.goals !== undefined) {
		const cleaned = cleanArray(patch.goals);
		next.goals = cleaned.length > 0 ? cleaned : existing.goals;
	}
	if (patch.acceptance_criteria !== undefined) {
		const cleaned = cleanArray(patch.acceptance_criteria);
		next.acceptance_criteria =
			cleaned.length > 0 ? cleaned : existing.acceptance_criteria;
	}
	if (patch.risk_notes !== undefined) {
		const cleaned = cleanArray(patch.risk_notes);
		if (cleaned.length > 0) next.risk_notes = cleaned;
		else delete next.risk_notes;
	}
	if (patch.tags !== undefined) {
		const cleaned = cleanArray(patch.tags);
		if (cleaned.length > 0) next.tags = cleaned;
		else delete next.tags;
	}
	if (patch.todo_outputs !== undefined) {
		const cleaned = cleanArray(patch.todo_outputs);
		if (cleaned.length > 0) next.todo_outputs = cleaned;
		else delete next.todo_outputs;
	}
	if (patch.scope !== undefined) {
		const scope = normaliseScope(patch.scope);
		if (scope) next.scope = scope;
		else delete next.scope;
	}
	if (patch.links !== undefined) {
		const links = cleanLinks(patch.links);
		if (links.length > 0) next.links = links;
		else delete next.links;
	}
	if (patch.proposed_tasks !== undefined) {
		const proposed = cleanProposedTasks(patch.proposed_tasks);
		if (proposed.length > 0) next.proposed_tasks = proposed;
		else delete next.proposed_tasks;
	}
	if (patch.planning_target !== undefined) {
		const target = normalisePlanningTarget(patch.planning_target);
		if (target) next.planning_target = target;
		else delete next.planning_target;
	}
	if (patch.decisions !== undefined && Array.isArray(patch.decisions)) {
		const cleaned = patch.decisions
			.map((decision) => {
				if (!decision || typeof decision !== "object") return null;
				const obj = decision as Record<string, unknown>;
				const date =
					typeof obj.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(obj.date)
						? obj.date
						: "";
				const text =
					typeof obj.decision === "string" ? obj.decision.trim() : "";
				if (!date || !text) return null;
				const item: PlanDecision = { date, decision: text };
				if (typeof obj.rationale === "string" && obj.rationale.trim()) {
					item.rationale = obj.rationale.trim();
				}
				return item;
			})
			.filter((decision): decision is PlanDecision => decision !== null);
		if (cleaned.length > 0) next.decisions = cleaned;
		else delete next.decisions;
	}

	next.updated_at = today();
	return next;
}

export async function updatePlan(
	id: string,
	patch: UpdatePlanInput,
): Promise<
	| { ok: true; record: PlanRecord; validation: ValidationResult }
	| { ok: false; error: "not_found" }
> {
	const record = await getPlanById(id);
	if (!record) return { ok: false, error: "not_found" };
	const updated = applyUpdate(record.plan, patch);
	const validation = await validateFeaturePlan(updated);
	await writeFile(record.absolutePath, serialisePlan(updated), "utf8");
	return {
		ok: true,
		record: {
			plan: updated,
			relativePath: record.relativePath,
			absolutePath: record.absolutePath,
			validation,
		},
		validation,
	};
}
