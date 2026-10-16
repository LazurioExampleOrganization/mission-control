import { readFile } from 'node:fs/promises';
import { stringify as stringifyYaml } from 'yaml';
import { MISSION_CONTROL_DATA_ROOT, WORKSPACE_ROOT, workspaceRelative } from './paths.ts';
import type { RoadmapStep } from './roadmap-model.ts';
import {
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
	source?: string;
};

type MissionControlRoadmapObject = {
	roadmap_code?: unknown;
	updated_at?: unknown;
	steps?: unknown;
};

export type RoadmapStepDraftPayload = {
	dry_run?: unknown;
	mode?: unknown;
	step_id?: unknown;
	title?: unknown;
	status?: unknown;
	executable?: unknown;
	priority_refs?: unknown;
	plan_refs?: unknown;
	todo_refs?: unknown;
	issue_refs?: unknown;
	acceptance_criteria?: unknown;
	notes?: unknown;
};

export type RoadmapStepDraftResult = {
	status: 'dry-run';
	write_applied: false;
	roadmap_code: string;
	workspacePath: string;
	step: RoadmapStep;
	yaml: string;
	diff: string;
	validation: {
		ok: boolean;
		failures: string[];
		errors: Array<{ path: string; message: string }>;
	};
};

export class RoadmapStepDraftError extends Error {
	readonly code: string;
	readonly status: number;

	constructor(code: string, status: number, message: string) {
		super(message);
		this.code = code;
		this.status = status;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function nonEmptyString(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function optionalStringArray(value: unknown, field: string): string[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value)) {
		throw new RoadmapStepDraftError('invalid_field', 400, `${field} musí být pole stringů.`);
	}
	if (value.length === 0) {
		throw new RoadmapStepDraftError('invalid_field', 400, `${field} nesmí být prázdné pole.`);
	}
	return value.map((item, index) => {
		const stringValue = nonEmptyString(item);
		if (!stringValue) {
			throw new RoadmapStepDraftError(
				'invalid_field',
				400,
				`${field}[${index}] musí být neprázdný string.`,
			);
		}
		return stringValue;
	});
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== 'boolean') {
		throw new RoadmapStepDraftError('invalid_field', 400, `${field} musí být boolean.`);
	}
	return value;
}

function cloneRoadmap(value: unknown): MissionControlRoadmapObject & Record<string, unknown> {
	if (!isRecord(value)) {
		throw new RoadmapStepDraftError('invalid_roadmap', 422, 'Roadmapa není YAML objekt.');
	}
	return JSON.parse(JSON.stringify(value)) as MissionControlRoadmapObject & Record<string, unknown>;
}

function roadmapCode(value: unknown): string | null {
	return isRecord(value) ? nonEmptyString(value.roadmap_code) : null;
}

function stepsOf(roadmap: MissionControlRoadmapObject): Array<Record<string, unknown>> {
	if (!Array.isArray(roadmap.steps)) {
		throw new RoadmapStepDraftError('invalid_roadmap', 422, 'Roadmapa nemá pole steps.');
	}
	if (!roadmap.steps.every(isRecord)) {
		throw new RoadmapStepDraftError(
			'invalid_roadmap',
			422,
			'Roadmapa obsahuje neplatný Roadmap Step řádek.',
		);
	}
	return roadmap.steps;
}

function nextStepId(steps: Array<Record<string, unknown>>): string {
	const max = steps.reduce((acc, step) => {
		const id = nonEmptyString(step.id);
		const match = id?.match(/^step-(\d+)$/);
		return match ? Math.max(acc, Number(match[1])) : acc;
	}, 0);
	return `step-${String(max + 1).padStart(3, '0')}`;
}

function today(): string {
	return new Date().toISOString().slice(0, 10);
}

function normalizeMode(value: unknown): 'create' | 'update' {
	if (value === 'create' || value === 'update') return value;
	throw new RoadmapStepDraftError('invalid_mode', 400, 'mode musí být `create` nebo `update`.');
}

function findRecord(roadmapCodeValue: string, records: RootRoadmapRecord[]): RootRoadmapRecord {
	const record = records.find((item) => roadmapCode(item.roadmap) === roadmapCodeValue);
	if (!record) {
		throw new RoadmapStepDraftError(
			'roadmap_not_found',
			404,
			`Roadmap ${roadmapCodeValue} neexistuje.`,
		);
	}
	return record;
}

function updateExistingStep(
	steps: Array<Record<string, unknown>>,
	payload: RoadmapStepDraftPayload,
): RoadmapStep {
	const stepId = nonEmptyString(payload.step_id);
	if (!stepId)
		throw new RoadmapStepDraftError('step_id_required', 400, 'Pro update je povinné step_id.');
	const step = steps.find((item) => item.id === stepId);
	if (!step)
		throw new RoadmapStepDraftError('step_not_found', 404, `Roadmap Step ${stepId} neexistuje.`);

	const title = nonEmptyString(payload.title);
	if (title) step.title = title;
	const status = nonEmptyString(payload.status);
	if (status) step.status = status;
	const executable = optionalBoolean(payload.executable, 'executable');
	if (executable !== undefined) step.executable = executable;
	for (const field of [
		'priority_refs',
		'plan_refs',
		'todo_refs',
		'issue_refs',
		'acceptance_criteria',
	] as const) {
		const list = optionalStringArray(payload[field], field);
		if (list !== undefined) step[field] = list;
	}
	const notes = nonEmptyString(payload.notes);
	if (notes) step.notes = notes;
	return step as RoadmapStep;
}

function createNewStep(
	steps: Array<Record<string, unknown>>,
	payload: RoadmapStepDraftPayload,
): RoadmapStep {
	const title = nonEmptyString(payload.title);
	if (!title)
		throw new RoadmapStepDraftError(
			'title_required',
			400,
			'Pro nový Roadmap Step je povinný title.',
		);
	const priorityRefs = optionalStringArray(payload.priority_refs, 'priority_refs');
	if (!priorityRefs) {
		throw new RoadmapStepDraftError(
			'priority_refs_required',
			400,
			'Pro nový Roadmap Step je povinné priority_refs.',
		);
	}
	const executable = optionalBoolean(payload.executable, 'executable') ?? true;
	const step: RoadmapStep = {
		id: nextStepId(steps),
		title,
		status: nonEmptyString(payload.status) ?? 'shaping',
		executable,
		priority_refs: priorityRefs,
		plan_refs: optionalStringArray(payload.plan_refs, 'plan_refs') ?? [],
		todo_refs: optionalStringArray(payload.todo_refs, 'todo_refs') ?? [],
		issue_refs: optionalStringArray(payload.issue_refs, 'issue_refs') ?? [],
		acceptance_criteria:
			optionalStringArray(payload.acceptance_criteria, 'acceptance_criteria') ?? [],
	};
	const notes = nonEmptyString(payload.notes);
	if (notes) step.notes = notes;
	steps.push(step as unknown as Record<string, unknown>);
	return step;
}

function lineDiff(oldText: string, newText: string, filePath: string): string {
	const oldLines = oldText.split('\n');
	const newLines = newText.split('\n');
	const rows = oldLines.length + 1;
	const cols = newLines.length + 1;
	const lengths = Array.from({ length: rows }, () => Array<number>(cols).fill(0));
	for (let i = oldLines.length - 1; i >= 0; i -= 1) {
		for (let j = newLines.length - 1; j >= 0; j -= 1) {
			lengths[i][j] =
				oldLines[i] === newLines[j]
					? lengths[i + 1][j + 1] + 1
					: Math.max(lengths[i + 1][j], lengths[i][j + 1]);
		}
	}
	const diff = [`--- a/${filePath}`, `+++ b/${filePath}`];
	let i = 0;
	let j = 0;
	while (i < oldLines.length && j < newLines.length) {
		if (oldLines[i] === newLines[j]) {
			diff.push(` ${oldLines[i]}`);
			i += 1;
			j += 1;
		} else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
			diff.push(`-${oldLines[i]}`);
			i += 1;
		} else {
			diff.push(`+${newLines[j]}`);
			j += 1;
		}
	}
	while (i < oldLines.length) {
		diff.push(`-${oldLines[i]}`);
		i += 1;
	}
	while (j < newLines.length) {
		diff.push(`+${newLines[j]}`);
		j += 1;
	}
	return diff.join('\n');
}

export async function buildRoadmapStepDraft(
	roadmapCodeValue: string,
	payload: RoadmapStepDraftPayload,
): Promise<RoadmapStepDraftResult> {
	if (payload.dry_run !== true) {
		throw new RoadmapStepDraftError(
			'dry_run_required',
			400,
			'Roadmap Step draft endpoint vyžaduje explicitní dry_run: true.',
		);
	}
	const mode = normalizeMode(payload.mode);
	const config = loadMissionControlConfig(MISSION_CONTROL_DATA_ROOT);
	const planRecords = loadPlans(MISSION_CONTROL_DATA_ROOT, config);
	const roadmapRecords: RootRoadmapRecord[] = loadRoadmaps(
		MISSION_CONTROL_DATA_ROOT,
		config,
	) as RootRoadmapRecord[];
	const record = findRecord(roadmapCodeValue, roadmapRecords);
	const originalYaml = record.source ?? (await readFile(record.filePath, 'utf8'));
	const nextRoadmap = cloneRoadmap(record.roadmap);
	const steps = stepsOf(nextRoadmap);
	const step =
		mode === 'create' ? createNewStep(steps, payload) : updateExistingStep(steps, payload);
	nextRoadmap.updated_at = today();

	const nextYaml = stringifyYaml(nextRoadmap);
	const futureRecords = roadmapRecords.map((item) =>
		item === record ? { ...item, roadmap: nextRoadmap, source: nextYaml } : item,
	);
	const failures = [
		...validatePlanRecords(planRecords, config, MISSION_CONTROL_DATA_ROOT, WORKSPACE_ROOT),
		...validateRoadmapRecords(futureRecords, config, MISSION_CONTROL_DATA_ROOT, planRecords),
	];
	const workspacePath = workspaceRelative(record.filePath);
	return {
		status: 'dry-run',
		write_applied: false,
		roadmap_code: roadmapCodeValue,
		workspacePath,
		step,
		yaml: nextYaml,
		diff: lineDiff(originalYaml, nextYaml, workspacePath),
		validation: {
			ok: failures.length === 0,
			failures,
			errors: failures.map((message) => ({ path: workspacePath, message })),
		},
	};
}
