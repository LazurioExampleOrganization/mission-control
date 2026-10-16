import { join, relative, sep } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import type { MissionControlPlan, PlanPriority, PlanStatus } from './model.ts';
import { MISSION_CONTROL_DATA_ROOT, WORKSPACE_ROOT, workspaceRelative } from './paths.ts';
import type { MissionControlRoadmap } from './roadmap-model.ts';
import {
	loadMissionControlConfig,
	loadPlans,
	loadRoadmaps,
	validatePlanRecords,
	validateRoadmapRecords,
} from './vendor/mission-control-lib.ts';

type RoadmapRecord = {
	path: string;
	filePath: string;
	roadmap: unknown;
	parseError: string | null;
	source?: string | null;
};

type PlanRecord = {
	path: string;
	filePath: string;
	plan: MissionControlPlan;
	parseError: string | null;
	source?: string | null;
};

export type RoadmapDraftPayload = {
	source_plan?: unknown;
	roadmap_code?: unknown;
	title?: unknown;
	owner?: unknown;
	priority?: unknown;
	status?: unknown;
	summary?: unknown;
	priority_title?: unknown;
	priority_rationale?: unknown;
	step_title?: unknown;
	acceptance_criteria?: unknown;
};

export type RoadmapDraftResult = {
	status: 'dry-run';
	write_applied: false;
	roadmap_code: string;
	workspacePath: string;
	path: string;
	roadmap: MissionControlRoadmap;
	yaml: string;
	validation: {
		ok: boolean;
		failures: string[];
		errors: Array<{ path: string; message: string }>;
	};
};

export class RoadmapCreateDraftError extends Error {
	readonly code: string;
	readonly status: number;

	constructor(code: string, status: number, message: string) {
		super(message);
		this.code = code;
		this.status = status;
	}
}

const ROADMAP_CODE_RE = /^RM-[0-9]{4}$/;
const ROADMAP_STATUSES = [
	'shaping',
	'ready',
	'in_progress',
	'review',
	'blocked',
	'done',
	'archived',
] as const;
const ROADMAP_PRIORITIES = ['urgent', 'high', 'medium', 'low'] as const;

function today(): string {
	return new Date().toISOString().slice(0, 10);
}

function nonEmptyString(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function optionalString(value: unknown): string | undefined {
	return nonEmptyString(value) ?? undefined;
}

function stringList(value: unknown, fallback: string[]): string[] {
	if (value === undefined || value === null || value === '') return fallback;
	if (!Array.isArray(value)) {
		throw new RoadmapCreateDraftError(
			'invalid_field',
			400,
			'acceptance_criteria musí být pole stringů.',
		);
	}
	const strings = value.map((item, index) => {
		const stringValue = nonEmptyString(item);
		if (!stringValue) {
			throw new RoadmapCreateDraftError(
				'invalid_field',
				400,
				`acceptance_criteria[${index}] musí být neprázdný string.`,
			);
		}
		return stringValue;
	});
	return strings.length > 0 ? strings : fallback;
}

function parseStatus(value: unknown): PlanStatus {
	const status = nonEmptyString(value) ?? 'shaping';
	if ((ROADMAP_STATUSES as readonly string[]).includes(status)) return status as PlanStatus;
	throw new RoadmapCreateDraftError(
		'invalid_status',
		400,
		`status musí být jedna z: ${ROADMAP_STATUSES.join(', ')}`,
	);
}

function parsePriority(value: unknown, fallback: PlanPriority): PlanPriority {
	const priority = nonEmptyString(value) ?? fallback;
	if ((ROADMAP_PRIORITIES as readonly string[]).includes(priority)) return priority as PlanPriority;
	throw new RoadmapCreateDraftError(
		'invalid_priority',
		400,
		`priority musí být jedna z: ${ROADMAP_PRIORITIES.join(', ')}`,
	);
}

function nextRoadmapCode(records: RoadmapRecord[]): string {
	const max = records.reduce((highest, record) => {
		const code =
			typeof (record.roadmap as { roadmap_code?: unknown } | null)?.roadmap_code === 'string'
				? (record.roadmap as { roadmap_code: string }).roadmap_code
				: '';
		const match = code.match(/^RM-(\d{4})$/);
		return match ? Math.max(highest, Number(match[1])) : highest;
	}, 0);
	return `RM-${String(max + 1).padStart(4, '0')}`;
}

function roadmapFilePath(
	config: { roadmaps_dir?: string },
	roadmapCode: string,
	title: string,
): string {
	const year = today().slice(0, 4);
	const slug =
		title
			.toLowerCase()
			.normalize('NFKD')
			.replace(/[\u0300-\u036f]/g, '')
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 64) || 'roadmap';
	return join(
		MISSION_CONTROL_DATA_ROOT,
		config.roadmaps_dir ?? 'mission-control/roadmaps',
		year,
		`${roadmapCode}-${slug}.yaml`,
	);
}

function dataRootRelative(absolutePath: string): string {
	return relative(MISSION_CONTROL_DATA_ROOT, absolutePath).split(sep).join('/');
}

function findSourcePlan(records: PlanRecord[], sourcePlan: string): MissionControlPlan {
	const record = records.find(
		(item) => item.plan?.dev_code === sourcePlan || item.plan?.id === sourcePlan,
	);
	if (!record) {
		throw new RoadmapCreateDraftError(
			'source_plan_not_found',
			404,
			`Source plan ${sourcePlan} neexistuje.`,
		);
	}
	return record.plan;
}

export function buildNewRoadmapDraft(payload: RoadmapDraftPayload): RoadmapDraftResult {
	const config = loadMissionControlConfig(MISSION_CONTROL_DATA_ROOT);
	const planRecords = loadPlans(MISSION_CONTROL_DATA_ROOT, config) as PlanRecord[];
	const roadmapRecords = loadRoadmaps(MISSION_CONTROL_DATA_ROOT, config) as RoadmapRecord[];
	const sourcePlanCode = nonEmptyString(payload.source_plan);
	if (!sourcePlanCode) {
		throw new RoadmapCreateDraftError('source_plan_required', 400, 'source_plan je povinný.');
	}
	const sourcePlan = findSourcePlan(planRecords, sourcePlanCode);
	const roadmapCode = nonEmptyString(payload.roadmap_code) ?? nextRoadmapCode(roadmapRecords);
	if (!ROADMAP_CODE_RE.test(roadmapCode)) {
		throw new RoadmapCreateDraftError(
			'invalid_roadmap_code',
			400,
			'roadmap_code musí mít tvar RM-0001.',
		);
	}
	if (
		roadmapRecords.some(
			(record) =>
				(record.roadmap as { roadmap_code?: unknown } | null)?.roadmap_code === roadmapCode,
		)
	) {
		throw new RoadmapCreateDraftError('roadmap_exists', 409, `Roadmap ${roadmapCode} už existuje.`);
	}
	const title = nonEmptyString(payload.title) ?? `Roadmap: ${sourcePlan.title}`;
	const priority = parsePriority(payload.priority, sourcePlan.priority);
	const date = today();
	const roadmap: MissionControlRoadmap = {
		schema_version: 'companiesascode.mission_control.roadmap.v1',
		id: `mcroadmap-${roadmapCode.toLowerCase()}`,
		roadmap_code: roadmapCode,
		title,
		status: parseStatus(payload.status),
		owner: optionalString(payload.owner) ?? sourcePlan.owner,
		priority,
		created_at: date,
		updated_at: date,
		source_plan: sourcePlan.dev_code,
		summary: optionalString(payload.summary) ?? sourcePlan.target_state ?? sourcePlan.context,
		priorities: [
			{
				id: 'priority-001',
				title: optionalString(payload.priority_title) ?? `Dodat ${sourcePlan.dev_code}`,
				rank: 1,
				rationale: optionalString(payload.priority_rationale) ?? sourcePlan.current_problem,
			},
		],
		steps: [
			{
				id: 'step-001',
				title: optionalString(payload.step_title) ?? `Zpracovat ${sourcePlan.dev_code}`,
				status: 'ready',
				executable: true,
				priority_refs: ['priority-001'],
				plan_refs: [sourcePlan.dev_code],
				acceptance_criteria: stringList(
					payload.acceptance_criteria,
					sourcePlan.acceptance_criteria,
				),
			},
		],
	};
	const path = roadmapFilePath(config, roadmapCode, title);
	const workspacePath = workspaceRelative(path);
	const recordPath = dataRootRelative(path);
	const futureRecords: RoadmapRecord[] = [
		...roadmapRecords,
		{ path: recordPath, filePath: path, roadmap, parseError: null, source: stringifyYaml(roadmap) },
	];
	const failures = [
		...validatePlanRecords(planRecords, config, MISSION_CONTROL_DATA_ROOT, WORKSPACE_ROOT),
		...validateRoadmapRecords(futureRecords, config, MISSION_CONTROL_DATA_ROOT, planRecords),
	];
	return {
		status: 'dry-run',
		write_applied: false,
		roadmap_code: roadmapCode,
		workspacePath,
		path: recordPath,
		roadmap,
		yaml: stringifyYaml(roadmap),
		validation: {
			ok: failures.length === 0,
			failures,
			errors: failures.map((message) => ({ path: workspacePath, message })),
		},
	};
}
