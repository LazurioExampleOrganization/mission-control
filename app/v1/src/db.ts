import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import {
	loadSchema,
	validateAgainstSchema,
	type SchemaNode,
	type ValidationError,
	type ValidationResult,
} from "./validate.ts";

export const MODULE_ROOT = path.resolve(import.meta.dir, "..", "..", "..");
export const DATA_VERSION = "v1";
export const DATA_DIR = path.join("data", DATA_VERSION);
export const DATA_ROOT = path.join(MODULE_ROOT, DATA_DIR);

/**
 * Entity types modeled after Linear's conceptual core, kept as Git-native YAML
 * files. Each entity type has a stable id pattern, its own JSON Schema, and a
 * directory in data/v1/. UI never materializes derived state; views compute on
 * read.
 */
export const ENTITY_TYPES = [
	"workspace",
	"team",
	"workflow",
	"label",
	"view",
	"initiative",
	"project",
	"issue",
	"triage_item",
	"cycle",
	"update",
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];

type EntityConfig = {
	schemaName: string;
	dir: string;
	idPrefix: string;
	idPattern: RegExp;
	singleton?: boolean;
	singletonFile?: string;
};

const ENTITY_REGISTRY: Record<EntityType, EntityConfig> = {
	workspace: {
		schemaName: "workspace",
		dir: ".",
		idPrefix: "",
		idPattern: /^[a-z][a-z0-9-]*$/,
		singleton: true,
		singletonFile: "workspace.yaml",
	},
	team: {
		schemaName: "team",
		dir: "teams",
		idPrefix: "team-",
		idPattern: /^team-[a-z][a-z0-9-]*$/,
	},
	workflow: {
		schemaName: "workflow",
		dir: "workflows",
		idPrefix: "wf-",
		idPattern: /^wf-[a-z][a-z0-9-]*$/,
	},
	label: {
		schemaName: "label",
		dir: "labels",
		idPrefix: "label-",
		idPattern: /^label-[a-z][a-z0-9-]*$/,
	},
	view: {
		schemaName: "view",
		dir: "views",
		idPrefix: "view-",
		idPattern: /^view-[a-z][a-z0-9-]*$/,
	},
	initiative: {
		schemaName: "initiative",
		dir: "initiatives",
		idPrefix: "init-",
		idPattern: /^init-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{3}$/,
	},
	project: {
		schemaName: "project",
		dir: "projects",
		idPrefix: "proj-",
		idPattern: /^proj-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{3}$/,
	},
	issue: {
		schemaName: "issue",
		dir: "issues",
		idPrefix: "mci-",
		idPattern: /^mci-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{3}$/,
	},
	triage_item: {
		schemaName: "triage_item",
		dir: "triage",
		idPrefix: "tri-",
		idPattern: /^tri-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{3}$/,
	},
	cycle: {
		schemaName: "cycle",
		dir: "cycles",
		idPrefix: "cycle-",
		idPattern: /^cycle-[0-9]{4}-[0-9]{2}$/,
	},
	update: {
		schemaName: "update",
		dir: "updates",
		idPrefix: "upd-",
		idPattern: /^upd-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{3}$/,
	},
};

export type EntityRecord = {
	type: EntityType;
	id: string;
	title: string;
	status: string | null;
	owner: string | null;
	created_at: string | null;
	updated_at: string | null;
	data: Record<string, unknown>;
	relativePath: string;
	absolutePath: string;
	validation: ValidationResult;
};

export type EntitySummary = {
	type: EntityType;
	id: string;
	title: string;
	status: string | null;
	owner: string | null;
	assignee: string | null;
	priority: string | null;
	team_id: string | null;
	workflow_id: string | null;
	project_id: string | null;
	cycle_id: string | null;
	labels: string[];
	updated_at: string | null;
	relativePath: string;
	valid: boolean;
	error_count: number;
};

export type ViewQueryResult = {
	view: EntityRecord;
	entity_type: EntityType;
	display: "list" | "board" | "timeline";
	group_by: string | null;
	sort: Record<string, unknown> | null;
	filters: Array<Record<string, unknown>>;
	records: EntitySummary[];
	groups: Array<{
		key: string;
		title: string;
		records: EntitySummary[];
	}>;
};

type EntityGraph = {
	recordsByType: Map<EntityType, EntityRecord[]>;
	recordsByKey: Map<string, EntityRecord>;
};

async function pathExists(target: string): Promise<boolean> {
	try {
		await stat(target);
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

function entityKey(type: EntityType, id: string): string {
	return `${type}:${id}`;
}

function asString(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

function deriveTitle(
	data: Record<string, unknown>,
	fallback: string,
): string {
	const explicit = asString(data.title) || asString(data.name);
	return explicit ?? fallback;
}

async function loadEntityFile(
	type: EntityType,
	absolutePath: string,
	schema: SchemaNode,
): Promise<EntityRecord> {
	const raw = await readFile(absolutePath, "utf8");
	const fallbackId = path.basename(absolutePath, ".yaml");
	let parsed: unknown = {};
	try {
		parsed = parseYaml(raw) ?? {};
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "chyba parsování YAML";
		return {
			type,
			id: fallbackId,
			title: fallbackId,
			status: null,
			owner: null,
			created_at: null,
			updated_at: null,
			data: {},
			relativePath: path.relative(MODULE_ROOT, absolutePath),
			absolutePath,
			validation: {
				ok: false,
				errors: [{ path: "(file)", message: `Chyba parsování YAML: ${message}` }],
			},
		};
	}
	const data =
		parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: {};
	const validation = validateAgainstSchema(data, schema);
	return {
		type,
		id: asString(data.id) ?? fallbackId,
		title: deriveTitle(data, fallbackId),
		status: asString(data.status),
		owner: asString(data.owner) ?? asString(data.author),
		created_at: asString(data.created_at),
		updated_at: asString(data.updated_at),
		data,
		relativePath: path.relative(MODULE_ROOT, absolutePath),
		absolutePath,
		validation,
	};
}

async function listEntitiesWithoutIntegrity(
	type: EntityType,
): Promise<EntityRecord[]> {
	const config = ENTITY_REGISTRY[type];
	const schema = await loadSchema(config.schemaName);
	if (config.singleton) {
		const target = path.join(DATA_ROOT, config.singletonFile ?? `${type}.yaml`);
		if (!(await pathExists(target))) return [];
		return [await loadEntityFile(type, target, schema)];
	}
	const dir = path.join(DATA_ROOT, config.dir);
	const files = await listYamlFiles(dir);
	const records = await Promise.all(
		files.map((file) => loadEntityFile(type, file, schema)),
	);
	return sortRecords(records);
}

function sortRecords(records: EntityRecord[]): EntityRecord[] {
	return records.sort(
		(a, b) =>
			(b.updated_at ?? "").localeCompare(a.updated_at ?? "") ||
			a.id.localeCompare(b.id),
	);
}

function appendIntegrityErrors(
	record: EntityRecord,
	errors: ValidationError[],
): EntityRecord {
	if (errors.length === 0) return record;
	return {
		...record,
		validation: {
			ok: false,
			errors: [...record.validation.errors, ...errors],
		},
	};
}

function asStringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

function nestedValue(source: unknown, dottedPath: string): unknown {
	if (!source || typeof source !== "object") return undefined;
	return dottedPath.split(".").reduce<unknown>((current, segment) => {
		if (!current || typeof current !== "object") return undefined;
		return (current as Record<string, unknown>)[segment];
	}, source);
}

export function resolveRecordField(
	record: EntityRecord | EntitySummary,
	field: string,
): unknown {
	if (field in record) return (record as unknown as Record<string, unknown>)[field];
	const full = record as EntityRecord;
	if (field.startsWith("data.")) return nestedValue(full.data, field.slice(5));
	if (full.data && typeof full.data === "object") {
		const direct = full.data[field];
		if (direct !== undefined) return direct;
		return nestedValue(full.data, field);
	}
	return undefined;
}

function safeRelativePath(value: string): boolean {
	return value.length > 0 && !value.startsWith("/") && !value.includes("..");
}

function localPathExists(value: string): boolean {
	const workspaceRoot = path.dirname(MODULE_ROOT);
	const candidates = value.startsWith("mission-control/")
		? [path.join(workspaceRoot, value)]
		: [path.join(MODULE_ROOT, value), path.join(workspaceRoot, value)];
	return candidates.some((candidate) => existsSync(candidate));
}

async function buildEntityGraph(): Promise<EntityGraph> {
	const pairs = await Promise.all(
		ENTITY_TYPES.map(async (type) => [type, await listEntitiesWithoutIntegrity(type)] as const),
	);
	const recordsByType = new Map<EntityType, EntityRecord[]>();
	const recordsByKey = new Map<string, EntityRecord>();
	const duplicateErrors = new Map<string, ValidationError[]>();
	const addDuplicateError = (key: string, message: string) => {
		const list = duplicateErrors.get(key) ?? [];
		list.push({ path: "id", message });
		duplicateErrors.set(key, list);
	};
	for (const [type, records] of pairs) {
		recordsByType.set(type, records);
		for (const record of records) {
			const key = entityKey(type, record.id);
			const previous = recordsByKey.get(key);
			if (previous) {
				addDuplicateError(
					key,
					`duplicate ${type} id ${record.id} also found in ${previous.relativePath}`,
				);
			}
			recordsByKey.set(key, record);
		}
	}

	const integrityErrors = validateGraph(recordsByType, recordsByKey);
	for (const [key, errors] of duplicateErrors.entries()) {
		integrityErrors.set(key, [...(integrityErrors.get(key) ?? []), ...errors]);
	}
	for (const [type, records] of recordsByType.entries()) {
		recordsByType.set(
			type,
			records.map((record) =>
				appendIntegrityErrors(
					record,
					integrityErrors.get(entityKey(type, record.id)) ?? [],
				),
			),
		);
	}
	recordsByKey.clear();
	for (const [type, records] of recordsByType.entries()) {
		for (const record of records) recordsByKey.set(entityKey(type, record.id), record);
	}
	return { recordsByType, recordsByKey };
}

function validateGraph(
	recordsByType: Map<EntityType, EntityRecord[]>,
	recordsByKey: Map<string, EntityRecord>,
): Map<string, ValidationError[]> {
	const errors = new Map<string, ValidationError[]>();
	const exists = (type: EntityType, id: unknown): boolean =>
		typeof id === "string" && recordsByKey.has(entityKey(type, id));
	const recordOf = (type: EntityType, id: unknown): EntityRecord | undefined =>
		typeof id === "string" ? recordsByKey.get(entityKey(type, id)) : undefined;
	const add = (record: EntityRecord, pathName: string, message: string) => {
		const key = entityKey(record.type, record.id);
		const list = errors.get(key) ?? [];
		list.push({ path: pathName, message });
		errors.set(key, list);
	};
	const requireRef = (
		record: EntityRecord,
		pathName: string,
		type: EntityType,
		id: unknown,
	) => {
		if (id === undefined || id === null || id === "") return;
		if (!exists(type, id)) add(record, pathName, `odkazuje na chybějící ${type} ${String(id)}`);
	};
	const requireManyRefs = (
		record: EntityRecord,
		pathName: string,
		type: EntityType,
		ids: unknown,
	) => {
		asStringArray(ids).forEach((id, index) =>
			requireRef(record, `${pathName}[${index}]`, type, id),
		);
	};
	const requirePath = (record: EntityRecord, pathName: string, value: unknown) => {
		if (typeof value !== "string" || value.trim() === "") return;
		if (!safeRelativePath(value)) {
			add(record, pathName, "musí být relativní cesta uvnitř mission-control");
			return;
		}
		if (!localPathExists(value)) {
			add(record, pathName, `odkazuje na chybějící cestu ${value}`);
		}
	};
	const requireLinks = (record: EntityRecord) => {
		if (!Array.isArray(record.data.links)) return;
		record.data.links.forEach((link, index) => {
			if (!link || typeof link !== "object") return;
			requirePath(record, `links[${index}].path`, (link as Record<string, unknown>).path);
		});
	};
	const requireTeamMember = (
		record: EntityRecord,
		pathName: string,
		member: unknown,
		teamId: unknown,
	) => {
		if (typeof member !== "string" || member.trim() === "") return;
		const team = recordOf("team", teamId);
		const members = asStringArray(team?.data.members);
		if (team && members.length > 0 && !members.includes(member)) {
			add(record, pathName, `${member} není uvedený v ${team.id}.members`);
		}
	};
	const requireLabelRefs = (
		record: EntityRecord,
		pathName: string,
		ids: unknown,
		teamId: unknown,
	) => {
		asStringArray(ids).forEach((id, index) => {
			const labelPath = `${pathName}[${index}]`;
			requireRef(record, labelPath, "label", id);
			const label = recordOf("label", id);
			if (
				label &&
				typeof teamId === "string" &&
				typeof label.data.team_id === "string" &&
				label.data.team_id !== teamId
			) {
				add(record, labelPath, `${id} patří do ${label.data.team_id}, ne do ${teamId}`);
			}
		});
	};
	const requireIssueRef = (record: EntityRecord, pathName: string, id: unknown) => {
		if (id === record.id) {
			add(record, pathName, "nesmí odkazovat samo na sebe");
			return;
		}
		requireRef(record, pathName, "issue", id);
	};
	const requireStatusTerminalReason = (
		record: EntityRecord,
		status: unknown,
		requiredField: string,
	) => {
		if (
			record.data.status === status &&
			typeof record.data[requiredField] !== "string"
		) {
			add(record, requiredField, `je povinné, když je stav ${String(status)}`);
		}
	};
	const knownViewFields: Partial<Record<EntityType, Set<string>>> = {
		initiative: new Set([
			"id",
			"title",
			"status",
			"owner",
			"created_at",
			"updated_at",
			"context",
			"target_date",
			"projects",
			"tags",
		]),
		project: new Set([
			"id",
			"title",
			"status",
			"owner",
			"created_at",
			"updated_at",
			"team_id",
			"initiative_id",
			"starts_at",
			"target_date",
			"labels",
			"tags",
		]),
		issue: new Set([
			"id",
			"title",
			"status",
			"owner",
			"created_at",
			"updated_at",
			"workflow_id",
			"team_id",
			"priority",
			"assignee",
			"project_id",
			"cycle_id",
			"labels",
			"tags",
			"todo_task_id",
		]),
		triage_item: new Set([
			"id",
			"title",
			"status",
			"owner",
			"created_at",
			"updated_at",
			"source",
			"submitter",
			"proposed_team",
			"proposed_labels",
			"promoted_to_issue",
			"duplicate_of",
			"tags",
		]),
		cycle: new Set([
			"id",
			"title",
			"name",
			"status",
			"owner",
			"created_at",
			"updated_at",
			"team_id",
			"starts_at",
			"ends_at",
			"issues",
		]),
		update: new Set([
			"id",
			"title",
			"status",
			"owner",
			"created_at",
			"updated_at",
			"entity_type",
			"entity_id",
			"kind",
			"audience",
		]),
	};
	const requireViewField = (
		record: EntityRecord,
		pathName: string,
		entityType: EntityType,
		field: unknown,
	) => {
		if (typeof field !== "string" || field.trim() === "") return;
		const normalized = field.startsWith("data.") ? field.slice(5) : field;
		if (!knownViewFields[entityType]?.has(normalized)) {
			add(record, pathName, `${field} není známé pole pohledu pro ${entityType}`);
		}
	};
	const workflowStatuses = new Set<string>();
	for (const workflow of recordsByType.get("workflow") ?? []) {
		const statuses = Array.isArray(workflow.data.statuses)
			? (workflow.data.statuses as Array<Record<string, unknown>>)
			: [];
		for (const status of statuses) {
			if (typeof status.id === "string") workflowStatuses.add(status.id);
		}
	}

	for (const records of recordsByType.values()) {
		for (const record of records) requireLinks(record);
	}

	for (const record of recordsByType.get("workspace") ?? []) {
		requireRef(record, "default_team", "team", record.data.default_team);
		requireRef(record, "default_workflow", "workflow", record.data.default_workflow);
	}
	for (const record of recordsByType.get("team") ?? []) {
		requireRef(record, "workflow_id", "workflow", record.data.workflow_id);
		requireTeamMember(
			record,
			"default_assignee",
			record.data.default_assignee,
			record.id,
		);
		requireLabelRefs(record, "labels", record.data.labels, record.id);
	}
	for (const record of recordsByType.get("label") ?? []) {
		requireRef(record, "team_id", "team", record.data.team_id);
	}
	for (const record of recordsByType.get("initiative") ?? []) {
		requireManyRefs(record, "projects", "project", record.data.projects);
		const planning = record.data.planning_source as Record<string, unknown> | undefined;
		requirePath(record, "planning_source.path", planning?.path);
	}
	for (const record of recordsByType.get("project") ?? []) {
		requireRef(record, "team_id", "team", record.data.team_id);
		requireRef(record, "initiative_id", "initiative", record.data.initiative_id);
		requireTeamMember(record, "owner", record.data.owner, record.data.team_id);
		requireLabelRefs(record, "labels", record.data.labels, record.data.team_id);
		const planning = record.data.planning_source as Record<string, unknown> | undefined;
		requirePath(record, "planning_source.path", planning?.path);
	}
	for (const record of recordsByType.get("issue") ?? []) {
		requireRef(record, "team_id", "team", record.data.team_id);
		requireRef(record, "workflow_id", "workflow", record.data.workflow_id);
		requireRef(record, "project_id", "project", record.data.project_id);
		requireRef(record, "cycle_id", "cycle", record.data.cycle_id);
		requireTeamMember(record, "owner", record.data.owner, record.data.team_id);
		requireTeamMember(record, "assignee", record.data.assignee, record.data.team_id);
		requireLabelRefs(record, "labels", record.data.labels, record.data.team_id);
		if (Array.isArray(record.data.relations)) {
			record.data.relations.forEach((relation, index) => {
				if (!relation || typeof relation !== "object") return;
				requireIssueRef(
					record,
					`relations[${index}].target_id`,
					(relation as Record<string, unknown>).target_id,
				);
			});
		}
		const workflow =
			typeof record.data.workflow_id === "string"
				? recordsByKey.get(entityKey("workflow", record.data.workflow_id))
				: undefined;
		const statuses = Array.isArray(workflow?.data.statuses)
			? (workflow.data.statuses as Array<Record<string, unknown>>)
			: [];
		if (
			workflow &&
			typeof record.data.status === "string" &&
			!statuses.some((status) => status.id === record.data.status)
		) {
			add(
				record,
				"status",
				`stav ${record.data.status} není definovaný v pracovním postupu ${workflow.id}`,
			);
		}
		const planning = record.data.planning as Record<string, unknown> | undefined;
		requirePath(record, "planning.path", planning?.path);
	}
	for (const record of recordsByType.get("triage_item") ?? []) {
		requireRef(record, "proposed_team", "team", record.data.proposed_team);
		requireLabelRefs(
			record,
			"proposed_labels",
			record.data.proposed_labels,
			record.data.proposed_team,
		);
		requireRef(record, "promoted_to_issue", "issue", record.data.promoted_to_issue);
		const duplicateOf = record.data.duplicate_of;
		if (typeof duplicateOf === "string") {
			const targetType = duplicateOf.startsWith("tri-") ? "triage_item" : "issue";
			requireRef(record, "duplicate_of", targetType, duplicateOf);
		}
		requireStatusTerminalReason(record, "triaged", "promoted_to_issue");
		requireStatusTerminalReason(record, "duplicate", "duplicate_of");
		if (
			(record.data.status === "rejected" || record.data.status === "deferred") &&
			typeof record.data.decision_reason !== "string"
		) {
			add(record, "decision_reason", `je povinné, když je stav ${record.data.status}`);
		}
	}
	for (const record of recordsByType.get("cycle") ?? []) {
		requireRef(record, "team_id", "team", record.data.team_id);
		requireManyRefs(record, "issues", "issue", record.data.issues);
		asStringArray(record.data.issues).forEach((issueId, index) => {
			const issue = recordOf("issue", issueId);
			if (issue && issue.data.cycle_id !== record.id) {
				add(
					record,
					`issues[${index}]`,
					`${issueId} musí zpětně odkazovat přes cycle_id ${record.id}`,
				);
			}
		});
	}
	for (const record of recordsByType.get("update") ?? []) {
		const targetType = record.data.entity_type;
		const targetId = record.data.entity_id;
		if (typeof targetType === "string" && isEntityType(targetType)) {
			requireRef(record, "entity_id", targetType, targetId);
		}
	}
	for (const record of recordsByType.get("view") ?? []) {
		const entityType = record.data.entity_type;
		if (typeof entityType !== "string" || !isEntityType(entityType)) continue;
		if (Array.isArray(record.data.filters)) {
			record.data.filters.forEach((filter, index) => {
				if (!filter || typeof filter !== "object") return;
				const field = (filter as Record<string, unknown>).field;
				requireViewField(record, `filters[${index}].field`, entityType, field);
				if (entityType === "issue" && field === "status") {
					const value = (filter as Record<string, unknown>).value;
					const statuses = Array.isArray(value) ? value : [value];
					statuses.forEach((status, statusIndex) => {
						if (
							typeof status === "string" &&
							workflowStatuses.size > 0 &&
							!workflowStatuses.has(status)
						) {
							add(
								record,
								`filters[${index}].value[${statusIndex}]`,
								`${status} není definovaný v žádném pracovním postupu`,
							);
						}
					});
				}
			});
		}
		const sort = record.data.sort as Record<string, unknown> | undefined;
		requireViewField(record, "sort.field", entityType, sort?.field);
		requireViewField(record, "group_by", entityType, record.data.group_by);
	}

	return errors;
}

export function entityConfig(type: EntityType): EntityConfig {
	return ENTITY_REGISTRY[type];
}

export function getEntityTypes(): readonly EntityType[] {
	return ENTITY_TYPES;
}

export function isEntityType(value: string): value is EntityType {
	return (ENTITY_TYPES as readonly string[]).includes(value);
}

export async function listEntities(type: EntityType): Promise<EntityRecord[]> {
	const graph = await buildEntityGraph();
	return graph.recordsByType.get(type) ?? [];
}

export async function getEntityById(
	type: EntityType,
	id: string,
): Promise<EntityRecord | null> {
	const all = await listEntities(type);
	return all.find((record) => record.id === id) ?? null;
}

export type EntitySnapshot = {
	type: EntityType;
	count: number;
	invalid: number;
	id_prefix: string;
	dir: string;
	singleton: boolean;
	records: EntitySummary[];
};

export async function snapshotEntityType(
	type: EntityType,
): Promise<EntitySnapshot> {
	const config = ENTITY_REGISTRY[type];
	const records = await listEntities(type);
	return {
		type,
		count: records.length,
		invalid: records.filter((record) => !record.validation.ok).length,
		id_prefix: config.idPrefix,
		dir: config.singleton ? (config.singletonFile ?? `${type}.yaml`) : config.dir,
		singleton: Boolean(config.singleton),
		records: records.map(toSummary),
	};
}

export async function snapshotAllEntities(): Promise<EntitySnapshot[]> {
	const graph = await buildEntityGraph();
	return ENTITY_TYPES.map((type) =>
		snapshotFromRecords(type, graph.recordsByType.get(type) ?? []),
	);
}

export function toSummary(record: EntityRecord): EntitySummary {
	return {
		type: record.type,
		id: record.id,
		title: record.title,
		status: record.status,
		owner: record.owner,
		assignee: asString(record.data.assignee),
		priority: asString(record.data.priority),
		team_id: asString(record.data.team_id),
		workflow_id: asString(record.data.workflow_id),
		project_id: asString(record.data.project_id),
		cycle_id: asString(record.data.cycle_id),
		labels: asStringArray(record.data.labels),
		updated_at: record.updated_at,
		relativePath: record.relativePath,
		valid: record.validation.ok,
		error_count: record.validation.errors.length,
	};
}

function snapshotFromRecords(
	type: EntityType,
	records: EntityRecord[],
): EntitySnapshot {
	const config = ENTITY_REGISTRY[type];
	return {
		type,
		count: records.length,
		invalid: records.filter((record) => !record.validation.ok).length,
		id_prefix: config.idPrefix,
		dir: config.singleton ? (config.singletonFile ?? `${type}.yaml`) : config.dir,
		singleton: Boolean(config.singleton),
		records: records.map(toSummary),
	};
}

type ViewFilter = {
	field?: unknown;
	operator?: unknown;
	value?: unknown;
};

function valueMatchesFilter(value: unknown, filter: ViewFilter): boolean {
	const operator = typeof filter.operator === "string" ? filter.operator : "eq";
	const expected = filter.value;
	const valueArray = Array.isArray(value) ? value : null;
	switch (operator) {
		case "eq":
			return valueArray ? valueArray.includes(expected) : value === expected;
		case "neq":
			return valueArray ? !valueArray.includes(expected) : value !== expected;
		case "in":
			if (!Array.isArray(expected)) return false;
			return valueArray
				? valueArray.some((item) => expected.includes(item))
				: expected.includes(value);
		case "not_in":
			if (!Array.isArray(expected)) return false;
			return valueArray
				? !valueArray.some((item) => expected.includes(item))
				: !expected.includes(value);
		case "contains":
			return valueArray
				? valueArray.includes(expected)
				: String(value ?? "").includes(String(expected ?? ""));
		case "starts_with":
			return String(value ?? "").startsWith(String(expected ?? ""));
		case "exists":
			return value !== undefined && value !== null && value !== "";
		case "missing":
			return value === undefined || value === null || value === "";
		default:
			return true;
	}
}

export function applyViewFilters(
	records: EntityRecord[],
	filters: Array<Record<string, unknown>>,
): EntityRecord[] {
	return records.filter((record) =>
		filters.every((filter) => {
			if (typeof filter.field !== "string") return true;
			return valueMatchesFilter(resolveRecordField(record, filter.field), filter);
		}),
	);
}

function sortByView(records: EntityRecord[], sort: unknown): EntityRecord[] {
	if (!sort || typeof sort !== "object") return records;
	const field = (sort as Record<string, unknown>).field;
	if (typeof field !== "string") return records;
	const direction = (sort as Record<string, unknown>).direction === "asc" ? "asc" : "desc";
	return records.slice().sort((a, b) => {
		const left = String(resolveRecordField(a, field) ?? "");
		const right = String(resolveRecordField(b, field) ?? "");
		return direction === "asc"
			? left.localeCompare(right)
			: right.localeCompare(left);
	});
}

function groupRecords(
	records: EntityRecord[],
	groupBy: string | null,
): ViewQueryResult["groups"] {
	if (!groupBy) return [];
	const buckets = new Map<string, EntityRecord[]>();
	for (const record of records) {
		const value = resolveRecordField(record, groupBy);
		const keys = Array.isArray(value) ? value : [value ?? "none"];
		for (const keyValue of keys) {
			const key = String(keyValue ?? "none");
			const list = buckets.get(key) ?? [];
			list.push(record);
			buckets.set(key, list);
		}
	}
	return [...buckets.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([key, groupedRecords]) => ({
			key,
			title: key === "none" ? "Bez hodnoty" : key,
			records: groupedRecords.map(toSummary),
		}));
}

export async function getViewResults(viewId: string): Promise<ViewQueryResult | null> {
	const graph = await buildEntityGraph();
	const view = graph.recordsByKey.get(entityKey("view", viewId));
	if (!view) return null;
	const entityType = view.data.entity_type;
	if (typeof entityType !== "string" || !isEntityType(entityType)) return null;
	const filters = Array.isArray(view.data.filters)
		? (view.data.filters as Array<Record<string, unknown>>)
		: [];
	const filtered = applyViewFilters(graph.recordsByType.get(entityType) ?? [], filters);
	const sorted = sortByView(filtered, view.data.sort);
	const display =
		view.data.display === "board" || view.data.display === "timeline"
			? view.data.display
			: "list";
	const groupBy =
		typeof view.data.group_by === "string" && view.data.group_by.trim() !== ""
			? view.data.group_by
			: display === "board"
				? "status"
				: null;
	return {
		view,
		entity_type: entityType,
		display,
		group_by: groupBy,
		sort:
			view.data.sort && typeof view.data.sort === "object"
				? (view.data.sort as Record<string, unknown>)
				: null,
		filters,
		records: sorted.map(toSummary),
		groups: groupRecords(sorted, groupBy),
	};
}
