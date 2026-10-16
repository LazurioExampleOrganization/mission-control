import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020';
import type { MissionControlPlan, PlanRecord, ValidationError, ValidationResult } from './model.ts';
import {
	isMissionControlDataContainedPath,
	isWorkspaceContainedPath,
	MISSION_CONTROL_DATA_ROOT,
	PLAN_CODE_RE,
	PLAN_PREFIX,
	PLANS_ROOT,
	resolveMissionControlDataContainedPath,
	resolveWorkspaceContainedPath,
	SCHEMA_PATH,
	WORKSPACE_ROOT,
} from './paths.ts';
import { portableRelativePath } from './portable-path.ts';

function add(errors: ValidationError[], path: string, message: string) {
	errors.push({ path, message });
}

function isObject(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

type WorkspaceSlot = {
	path?: unknown;
	status?: unknown;
	materialization?: unknown;
	default_access?: unknown;
	git?: { url?: unknown };
	repository_db?: { repo?: unknown; url?: unknown };
};

type WorkspaceManifest = {
	modules?: unknown;
	module_slots?: unknown;
};

function canonicalManifestPath(value: unknown): string | null {
	if (typeof value !== 'string' || value === '' || path.posix.isAbsolute(value)) return null;
	const canonical = path.posix.normalize(value.replaceAll('\\', '/'));
	if (canonical === '.' || canonical === '..' || canonical.startsWith('../')) return null;
	return canonical;
}

export function allowsMissingDeclaredPlanningTarget(
	todoTasksPath: string,
	manifest: WorkspaceManifest,
): boolean {
	const modules = Array.isArray(manifest.modules) ? manifest.modules : null;
	const moduleSlots = Array.isArray(manifest.module_slots) ? manifest.module_slots : null;
	if (modules && moduleSlots) return false;
	const slots = (modules ?? moduleSlots) as WorkspaceSlot[] | null;
	if (!slots) return false;
	const targetPath = canonicalManifestPath(todoTasksPath);
	if (!targetPath || path.posix.basename(targetPath) !== 'TODO.tasks.json') return false;
	const targetParent = path.posix.dirname(targetPath);
	const matches = slots.filter((slot) => canonicalManifestPath(slot?.path) === targetParent);
	if (matches.length !== 1) return false;
	const slot = matches[0];
	const status = String(slot.status ?? '').toLowerCase();
	const materialization = String(slot.materialization ?? '').toLowerCase();
	if (
		['planned', 'planned_slot'].includes(status) ||
		['planned', 'planned_slot'].includes(materialization)
	) {
		return true;
	}
	const access = String(slot.default_access ?? '').toLowerCase();
	if (['role_based', 'restricted'].includes(access)) return true;
	const hasRepositoryLocator = [
		slot.git?.url,
		slot.repository_db?.repo,
		slot.repository_db?.url,
	].some((value) => typeof value === 'string' && value.trim() !== '');
	return !hasRepositoryLocator;
}

function allowsMissingManifestPlanningTarget(todoTasksPath: string): boolean {
	try {
		const manifest = JSON.parse(
			readFileSync(path.join(WORKSPACE_ROOT, 'modules.manifest.json'), 'utf8'),
		) as WorkspaceManifest;
		return allowsMissingDeclaredPlanningTarget(todoTasksPath, manifest);
	} catch {
		return false;
	}
}

function allowsMissingLegacyPlanningTarget(todoTasksPath: string): boolean {
	if (
		MISSION_CONTROL_DATA_ROOT !== WORKSPACE_ROOT &&
		!todoTasksPath.startsWith('data/mission-control/')
	) {
		return (
			allowsMissingManifestPlanningTarget(todoTasksPath) || todoTasksPath.startsWith('modules/')
		);
	}
	try {
		const config = JSON.parse(
			readFileSync(
				path.join(WORKSPACE_ROOT, 'mission-control', 'mission-control.config.json'),
				'utf8',
			),
		) as { data_boundary?: { mode?: unknown; legacy_fallback?: unknown } };
		const transitionMode = config.data_boundary?.mode === 'org-local-v3-pilot';
		const legacyFallback = Array.isArray(config.data_boundary?.legacy_fallback)
			? config.data_boundary.legacy_fallback
			: [];
		const keepsLegacyFallback = legacyFallback.includes('TODO.tasks.json');
		return (
			transitionMode &&
			keepsLegacyFallback &&
			(allowsMissingManifestPlanningTarget(todoTasksPath) || todoTasksPath.startsWith('modules/'))
		);
	} catch {
		return false;
	}
}

let compiledSchema: ValidateFunction | undefined;

function planSchemaValidator() {
	if (!compiledSchema) {
		const ajv = new Ajv2020({ allErrors: true, strict: false });
		compiledSchema = ajv.compile(JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')));
	}
	return compiledSchema;
}

function pointerToPath(pointer: string): string {
	if (!pointer) return '(root)';
	return pointer
		.slice(1)
		.split('/')
		.map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
		.join('.');
}

function ajvErrorPath(error: ErrorObject): string {
	if (error.keyword === 'required') {
		const missing = error.params as { missingProperty?: string };
		const base = pointerToPath(error.instancePath);
		return base === '(root)'
			? (missing.missingProperty ?? base)
			: `${base}.${missing.missingProperty ?? '(missing)'}`;
	}
	if (error.keyword === 'additionalProperties') {
		const extra = error.params as { additionalProperty?: string };
		const base = pointerToPath(error.instancePath);
		return base === '(root)'
			? (extra.additionalProperty ?? base)
			: `${base}.${extra.additionalProperty ?? '(extra)'}`;
	}
	return pointerToPath(error.instancePath);
}

function ajvErrorMessage(error: ErrorObject): string {
	if (error.keyword === 'required') return 'je povinné pole';
	if (error.keyword === 'additionalProperties') return 'není povolené pole';
	if (error.keyword === 'minItems') return 'nesmí být prázdné';
	if (error.keyword === 'minLength') return 'musí být neprázdný string';
	if (error.keyword === 'type') return `má neplatný typ (${error.message})`;
	if (error.keyword === 'enum' || error.keyword === 'const') {
		return `má neplatnou hodnotu (${error.message})`;
	}
	if (error.keyword === 'pattern') return `neodpovídá požadovanému tvaru`;
	return error.message ?? 'není validní';
}

export type ValidatePlanShapeOptions = {
	planPrefix?: string;
};

export function validatePlanShape(
	plan: unknown,
	options: ValidatePlanShapeOptions = {},
): ValidationResult {
	const errors: ValidationError[] = [];
	if (!isObject(plan)) {
		return { ok: false, errors: [{ path: '(root)', message: 'není objekt' }] };
	}
	const planPrefix = options.planPrefix ?? PLAN_PREFIX;
	if (!/^[A-Z]{2,6}$/.test(planPrefix)) {
		throw new Error(`Neplatný plan prefix pro validaci: ${planPrefix}`);
	}
	const planCodeRe = new RegExp(`^${planPrefix}-[0-9]{4}$`);
	const planIdPrefix = `mcplan-${planPrefix.toLowerCase()}-`;
	const planIdRe = new RegExp(`^${planIdPrefix}[0-9]{4}$`);

	const validator = planSchemaValidator();
	if (!validator(plan)) {
		for (const error of validator.errors ?? []) {
			add(errors, ajvErrorPath(error), ajvErrorMessage(error));
		}
	}
	if (typeof plan.id === 'string' && !planIdRe.test(plan.id)) {
		add(errors, 'id', `musí mít tvar ${planIdPrefix}XXXX`);
	}
	if (typeof plan.dev_code === 'string' && !planCodeRe.test(plan.dev_code)) {
		add(errors, 'dev_code', `musí mít tvar ${planPrefix}-XXXX`);
	}
	if (
		typeof plan.id === 'string' &&
		typeof plan.dev_code === 'string' &&
		planCodeRe.test(plan.dev_code) &&
		plan.id !== `mcplan-${plan.dev_code.toLowerCase()}`
	) {
		add(errors, 'id', 'musí odpovídat dev_code');
	}
	const clickup =
		isObject(plan.legacy_sources) && isObject(plan.legacy_sources.clickup)
			? plan.legacy_sources.clickup
			: null;
	if (clickup && typeof clickup.custom_id === 'string' && !planCodeRe.test(clickup.custom_id)) {
		add(errors, 'legacy_sources.clickup.custom_id', `musí mít tvar ${planPrefix}-XXXX`);
	}
	if (
		Array.isArray(plan.proposed_tasks) &&
		plan.proposed_tasks.length > 0 &&
		!isObject(plan.planning_target)
	) {
		add(errors, 'planning_target', 'je povinný pro proposed_tasks export');
	}
	if (isObject(plan.planning_target) && typeof plan.planning_target.todo_tasks_path === 'string') {
		const todoTasksPath = plan.planning_target.todo_tasks_path;
		const usesMissionControlDataRoot = todoTasksPath.startsWith('data/mission-control/');
		const isContained = usesMissionControlDataRoot
			? isMissionControlDataContainedPath(todoTasksPath)
			: isWorkspaceContainedPath(todoTasksPath);
		if (!isContained) {
			add(errors, 'planning_target.todo_tasks_path', 'musí být relativní cesta uvnitř workspace');
		} else if (
			!existsSync(
				usesMissionControlDataRoot
					? resolveMissionControlDataContainedPath(todoTasksPath)
					: resolveWorkspaceContainedPath(todoTasksPath),
			)
		) {
			// Organization_GEN3 starts with legacy GEN2 plans whose module TODO ledgers
			// have not all been materialized in the transition root yet. In the MCv3
			// compatibility pilot, keep those as readable fallback references instead
			// of blocking validation for every historical plan. New root-level plans
			// such as DEV-0001 still point at an existing TODO.tasks.json.
			if (!allowsMissingLegacyPlanningTarget(todoTasksPath)) {
				add(
					errors,
					'planning_target.todo_tasks_path',
					`odkazovaný soubor neexistuje: ${todoTasksPath}`,
				);
			}
		}
	}

	return { ok: errors.length === 0, errors };
}

export function planQualityErrors(plan: MissionControlPlan): ValidationError[] {
	const errors: ValidationError[] = [];
	const placeholders = [
		/^Doplnit (kontext|aktuální problém|cílový stav|nejbližší proveditelný scope|co zůstává mimo scope|ověřitelná acceptance criteria|minimální ověření|kurátorský)\b/i,
		// Parita s root scripts/mission-control-lib.mjs PLACEHOLDER_PATTERN.
		/^doplnit (kontext|aktuální problém|cílový stav|rozsah|scope|acceptance|ověření|validaci)\b/i,
	];
	const check = (path: string, value: unknown) => {
		if (
			typeof value === 'string' &&
			placeholders.some((placeholder) => placeholder.test(value.trim()))
		) {
			add(errors, path, 'nesmí zůstat placeholder text');
		}
	};
	check('context', plan.context);
	check('current_problem', plan.current_problem);
	check('target_state', plan.target_state);
	plan.scope.in.forEach((item, index) => check(`scope.in.${index}`, item));
	plan.scope.out.forEach((item, index) => check(`scope.out.${index}`, item));
	plan.acceptance_criteria.forEach((item, index) => check(`acceptance_criteria.${index}`, item));
	plan.validation.forEach((item, index) => check(`validation.${index}`, item));
	if (plan.planning_target && (!plan.proposed_tasks || plan.proposed_tasks.length === 0)) {
		add(errors, 'proposed_tasks', 'jsou povinné pro plán s planning_target');
	}
	return errors;
}

export function validatePlanQuality(plan: MissionControlPlan): ValidationResult {
	const errors = planQualityErrors(plan);
	return { ok: errors.length === 0, errors };
}

const PLANS_DIR_WORKSPACE_REL = portableRelativePath(WORKSPACE_ROOT, PLANS_ROOT);

// Parita s root scripts/check-mission-control.mjs: název souboru začíná
// dev_code prefixem a adresář odpovídá plans/YYYY/MM podle created_at.
function planFilePlacementErrors(record: PlanRecord): ValidationError[] {
	const errors: ValidationError[] = [];
	if (!isObject(record.plan)) return errors;
	const devCode = record.plan.dev_code;
	if (
		typeof devCode === 'string' &&
		PLAN_CODE_RE.test(devCode) &&
		!path.posix.basename(record.workspacePath).startsWith(`${devCode}-`)
	) {
		add(errors, record.relativePath, `název souboru musí začínat ${devCode}-`);
	}
	const createdAt = record.plan.created_at;
	if (typeof createdAt === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(createdAt)) {
		const [year, month] = createdAt.split('-');
		const expectedDir = path.posix.join(PLANS_DIR_WORKSPACE_REL, year, month);
		if (path.posix.dirname(record.workspacePath) !== expectedDir) {
			add(errors, record.relativePath, `plán musí ležet v ${expectedDir}/ podle created_at`);
		}
	}
	return errors;
}

export type ValidatePlanRecordsOptions = {
	// Dry-run draft záměrně obsahuje kurátorské placeholdery; quality gate se
	// tam jen reportuje, neblokuje. Shape/identity kontroly běží vždy.
	quality?: boolean;
};

export function validatePlanRecords(
	records: PlanRecord[],
	options: ValidatePlanRecordsOptions = {},
): ValidationResult {
	const includeQuality = options.quality !== false;
	const errors: ValidationError[] = [];
	const devCodes = new Map<string, string>();
	const ids = new Map<string, string>();

	for (const record of records) {
		const result = validatePlanShape(record.plan);
		for (const error of result.errors) {
			add(errors, `${record.relativePath}:${error.path}`, error.message);
		}
		if (!isObject(record.plan)) continue;
		errors.push(...planFilePlacementErrors(record));
		const qualityErrors = includeQuality && result.ok ? planQualityErrors(record.plan) : [];
		for (const error of qualityErrors) {
			add(errors, `${record.relativePath}:${error.path}`, error.message);
		}
		const devCode = record.plan.dev_code;
		if (devCode) {
			const previous = devCodes.get(devCode);
			if (previous) {
				add(errors, record.relativePath, `duplicitní dev_code ${devCode} (také ${previous})`);
			}
			devCodes.set(devCode, record.relativePath);
		}
		const id = record.plan.id;
		if (id) {
			const previous = ids.get(id);
			if (previous) {
				add(errors, record.relativePath, `duplicitní id ${id} (také ${previous})`);
			}
			ids.set(id, record.relativePath);
		}
	}

	return { ok: errors.length === 0, errors };
}

export function validatePlanUpdate(
	records: PlanRecord[],
	currentAbsolutePath: string,
	nextPlan: MissionControlPlan,
): ValidationResult {
	const replaced = records.map((record) =>
		record.absolutePath === currentAbsolutePath ? { ...record, plan: nextPlan } : record,
	);
	return validatePlanRecords(replaced);
}

let schemaPromise: Promise<unknown> | undefined;

export function loadPlanSchema(): Promise<unknown> {
	if (!schemaPromise) {
		schemaPromise = readFile(SCHEMA_PATH, 'utf8').then((raw) => JSON.parse(raw));
	}
	return schemaPromise;
}

export type { MissionControlPlan };
