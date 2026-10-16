import type { Dirent } from 'node:fs';
import {
	access,
	link,
	mkdir,
	readdir,
	readFile,
	rename,
	unlink,
	writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
	type MissionControlPlan,
	PLAN_SCHEMA_VERSION,
	type PlanRecord,
	planSortKey,
	type ValidationError,
} from './model.ts';
import {
	IS_REPOSITORY_DB_MODE,
	MISSION_CONTROL_DATA_ROOT,
	MISSION_CONTROL_ROOT,
	PLANS_ROOT,
	workspaceRelative,
} from './paths.ts';
import { planQualityErrors, validatePlanShape } from './validate.ts';

async function exists(filePath: string): Promise<boolean> {
	try {
		await access(filePath);
		return true;
	} catch {
		return false;
	}
}

async function listYamlFiles(dir: string): Promise<string[]> {
	let entries: Dirent[];
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return [];
	}
	const nested = await Promise.all(
		entries.map(async (entry) => {
			const fullPath = path.join(dir, entry.name);
			if (entry.isDirectory()) return listYamlFiles(fullPath);
			if (entry.isFile() && /\.(?:yaml|yml)$/i.test(entry.name)) {
				return [fullPath];
			}
			return [];
		}),
	);
	return nested.flat();
}

export async function readPlanRecord(filePath: string): Promise<PlanRecord> {
	if (path.extname(filePath) !== '.yaml') {
		throw new Error(
			`Invalid Mission Control plan ${workspaceRelative(filePath)}: canonical plan extension must be .yaml`,
		);
	}
	const raw = await readFile(filePath, 'utf8');
	const parsed = parseYaml(raw) as MissionControlPlan;
	const validation = validatePlanShape(parsed);
	if (!validation.ok) {
		const message = validation.errors.map((error) => `${error.path}: ${error.message}`).join(', ');
		throw new Error(`Invalid Mission Control plan ${workspaceRelative(filePath)}: ${message}`);
	}
	return {
		plan: parsed,
		absolutePath: filePath,
		relativePath: path.relative(MISSION_CONTROL_ROOT, filePath),
		workspacePath: workspaceRelative(filePath),
	};
}

async function readPlanRecordUnchecked(filePath: string): Promise<PlanRecord> {
	if (path.extname(filePath) !== '.yaml') {
		throw new Error('canonical plan extension must be .yaml');
	}
	const raw = await readFile(filePath, 'utf8');
	const parsed = parseYaml(raw) as MissionControlPlan;
	return {
		plan: parsed,
		absolutePath: filePath,
		relativePath: path.relative(MISSION_CONTROL_ROOT, filePath),
		workspacePath: workspaceRelative(filePath),
	};
}

export async function listPlanRecords(): Promise<PlanRecord[]> {
	const files = await listYamlFiles(PLANS_ROOT);
	const records = await Promise.all(files.map(readPlanRecord));
	return records.sort((a, b) => {
		const [rankA, codeA] = planSortKey(a.plan);
		const [rankB, codeB] = planSortKey(b.plan);
		return rankA - rankB || codeA.localeCompare(codeB);
	});
}

export async function listPlanRecordsForValidation(): Promise<{
	records: PlanRecord[];
	errors: ValidationError[];
}> {
	const files = await listYamlFiles(PLANS_ROOT);
	const records: PlanRecord[] = [];
	const errors: ValidationError[] = [];
	for (const file of files) {
		try {
			records.push(await readPlanRecordUnchecked(file));
		} catch (error) {
			errors.push({
				path: workspaceRelative(file),
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}
	return { records, errors };
}

export async function getPlanByIdOrDevCode(idOrDevCode: string): Promise<PlanRecord | null> {
	const normalized = idOrDevCode.toUpperCase();
	const normalizedId = idOrDevCode.toLowerCase();
	const records = await listPlanRecords();
	return (
		records.find(
			(record) =>
				record.plan.id.toLowerCase() === normalizedId || record.plan.dev_code === normalized,
		) ?? null
	);
}

export function planFilePathForDevCode(devCode: string, title: string, date = new Date()): string {
	const dateRoot = path.join(
		PLANS_ROOT,
		String(date.getFullYear()),
		String(date.getMonth() + 1).padStart(2, '0'),
	);
	const slug = title
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return path.join(dateRoot, `${devCode}-${slug || 'plan'}.yaml`);
}

export async function writePlan(plan: MissionControlPlan, filePath: string) {
	assertDirectCanonicalWriteAllowed(filePath);
	assertWritablePlan(plan, plan.dev_code);
	await mkdir(path.dirname(filePath), { recursive: true });
	if (await exists(filePath)) {
		throw new Error(`Plan already exists: ${workspaceRelative(filePath)}`);
	}
	await atomicWriteNewFile(filePath, stringifyYaml(plan));
}

function planLabel(plan: unknown, fallback: string): string {
	if (plan && typeof plan === 'object' && 'dev_code' in plan) {
		const devCode = (plan as { dev_code?: unknown }).dev_code;
		if (typeof devCode === 'string' && devCode.trim()) return devCode;
	}
	return fallback;
}

function assertWritablePlan(plan: unknown, label: string): asserts plan is MissionControlPlan {
	const validation = validatePlanShape(plan);
	if (!validation.ok) {
		throw new Error(
			`Invalid plan ${planLabel(plan, label)}: ${validation.errors.map((error) => `${error.path}: ${error.message}`).join(', ')}`,
		);
	}
	const writablePlan = plan as MissionControlPlan;
	const qualityErrors = planQualityErrors(writablePlan);
	if (qualityErrors.length > 0) {
		const message = qualityErrors.map((error) => `${error.path}: ${error.message}`).join(', ');
		throw new Error(`Plan ${writablePlan.dev_code} failed quality gate: ${message}`);
	}
	if (writablePlan.schema_version !== PLAN_SCHEMA_VERSION) {
		throw new Error(`Invalid schema_version for ${writablePlan.dev_code}`);
	}
}

export async function updatePlanYaml(filePath: string, yamlText: string) {
	assertDirectCanonicalWriteAllowed(filePath);
	const parsed = parseYaml(yamlText);
	assertWritablePlan(parsed, workspaceRelative(filePath));
	await atomicReplaceFile(filePath, yamlText);
}

export async function atomicWriteNewFile(filePath: string, content: string) {
	assertDirectCanonicalWriteAllowed(filePath);
	await mkdir(path.dirname(filePath), { recursive: true });
	const tempPath = tempFilePath(filePath);
	await writeFile(tempPath, content, { encoding: 'utf8', flag: 'wx' });
	try {
		await link(tempPath, filePath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
			throw new Error(`File already exists: ${workspaceRelative(filePath)}`);
		}
		throw error;
	} finally {
		await unlink(tempPath).catch(() => undefined);
	}
}

export async function atomicReplaceFile(filePath: string, content: string) {
	assertDirectCanonicalWriteAllowed(filePath);
	await mkdir(path.dirname(filePath), { recursive: true });
	const tempPath = tempFilePath(filePath);
	await writeFile(tempPath, content, { encoding: 'utf8', flag: 'wx' });
	try {
		await rename(tempPath, filePath);
	} catch (error) {
		await unlink(tempPath).catch(() => undefined);
		throw error;
	}
}

export function assertDirectCanonicalWriteAllowed(filePath: string): void {
	if (!IS_REPOSITORY_DB_MODE) return;
	const root = path.resolve(MISSION_CONTROL_DATA_ROOT);
	const target = path.resolve(filePath);
	const relativePath = path.relative(root, target);
	const isContained =
		relativePath === '' ||
		(relativePath !== '..' &&
			!relativePath.startsWith(`..${path.sep}`) &&
			!path.isAbsolute(relativePath));
	if (isContained) {
		throw new Error(
			'repository_db_direct_write_blocked: prepare a local draft on the Repository page and publish its reviewed revision',
		);
	}
}

function tempFilePath(filePath: string): string {
	return path.join(
		path.dirname(filePath),
		`.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
	);
}
