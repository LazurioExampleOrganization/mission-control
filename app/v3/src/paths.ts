import type { Dirent } from 'node:fs';
import { existsSync, readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { portableRelativePath } from './portable-path.ts';

export const APP_ROOT = path.resolve(import.meta.dir, '..');

function resolveOptionalEnvPath(name: string): string | null {
	const value = process.env[name];
	if (!value) return null;
	return path.resolve(value);
}

function missionControlConfigPath(root: string): string {
	return path.join(root, 'mission-control.config.json');
}

function repositoryDbRootPath(root: string): string {
	return path.join(root, 'db');
}

function repositoryDbMissionControlConfigPath(repositoryDbRoot: string): string {
	return path.join(repositoryDbRoot, 'data', 'mission-control', 'mission-control.config.json');
}

function loadRepositoryDbConfig(
	repositoryDbRoot: string,
	schemaRoot: string,
): LoadedMissionControlConfig | null {
	const repositoryDbConfigPath = path.join(repositoryDbRoot, 'repository-db.yaml');
	const repositoryDbMissionConfigPath = repositoryDbMissionControlConfigPath(repositoryDbRoot);
	if (!existsSync(repositoryDbConfigPath) || !existsSync(repositoryDbMissionConfigPath))
		return null;
	const config = readMissionControlConfig(repositoryDbMissionConfigPath);
	if (config.data_mode !== 'repository-db') {
		throw new Error('mission-control.config.json: data_mode musí být repository-db');
	}
	return {
		config,
		pathRoot: repositoryDbRoot,
		schemaRoot,
		configPath: repositoryDbMissionConfigPath,
	};
}

function resolveDefaultMissionControlRoot(): string {
	const standaloneCodeRepoRoot = path.resolve(APP_ROOT, '..');
	if (existsSync(missionControlConfigPath(standaloneCodeRepoRoot))) {
		return standaloneCodeRepoRoot;
	}
	return path.resolve(APP_ROOT, '..', '..');
}

export const MISSION_CONTROL_ROOT =
	resolveOptionalEnvPath('MISSION_CONTROL_ROOT') ?? resolveDefaultMissionControlRoot();
export const WORKSPACE_ROOT =
	resolveOptionalEnvPath('MISSION_CONTROL_WORKSPACE_ROOT') ??
	(MISSION_CONTROL_ROOT === path.resolve(APP_ROOT, '..')
		? MISSION_CONTROL_ROOT
		: path.resolve(MISSION_CONTROL_ROOT, '..'));

// Prefix kódů a cesty drží mission-control.config.json (decision 0017),
// aplikace je nikdy nehardcoduje.
const CONFIG_SCHEMA_VERSION = 'companiesascode.mission_control.config.v1';
const CONFIG_PATH = missionControlConfigPath(MISSION_CONTROL_ROOT);

type MissionControlConfig = {
	schema_version: string;
	plan_prefix: string;
	data_mode?: string;
	plans_dir: string;
	schema_path: string;
	issues_open_path?: string;
	issues_resolved_path?: string;
	todo_tasks_path?: string;
	done_tasks_path?: string;
	organization_admin?: string;
	workspace_admin?: string;
};

type LoadedMissionControlConfig = {
	config: MissionControlConfig;
	pathRoot: string;
	schemaRoot: string;
	configPath: string;
};

function readMissionControlConfig(pathValue: string): MissionControlConfig {
	const raw = JSON.parse(readFileSync(pathValue, 'utf8')) as MissionControlConfig;
	if (raw.schema_version !== CONFIG_SCHEMA_VERSION) {
		throw new Error(
			`mission-control.config.json: schema_version musí být ${CONFIG_SCHEMA_VERSION}`,
		);
	}
	if (!/^[A-Z]{2,6}$/.test(raw.plan_prefix ?? '')) {
		throw new Error(
			`mission-control.config.json: plan_prefix musí být 2-6 velkých písmen, je "${raw.plan_prefix}"`,
		);
	}
	if (!raw.plans_dir || !raw.schema_path) {
		throw new Error('mission-control.config.json: plans_dir a schema_path jsou povinné');
	}
	return raw;
}

function loadMissionControlConfig(): LoadedMissionControlConfig {
	const directRepositoryDbConfig = loadRepositoryDbConfig(
		MISSION_CONTROL_ROOT,
		MISSION_CONTROL_ROOT,
	);
	if (directRepositoryDbConfig) return directRepositoryDbConfig;

	const repositoryDbRoot = repositoryDbRootPath(MISSION_CONTROL_ROOT);
	const mountedRepositoryDbConfig = loadRepositoryDbConfig(repositoryDbRoot, MISSION_CONTROL_ROOT);
	if (mountedRepositoryDbConfig) return mountedRepositoryDbConfig;

	const fallbackConfig = readMissionControlConfig(CONFIG_PATH);
	if (fallbackConfig.data_mode === 'repository-db') {
		throw new Error(
			`Mission Control repository-db mount chybí nebo je neúplný v ${repositoryDbRoot}; očekávám repository-db.yaml a data/mission-control/mission-control.config.json`,
		);
	}
	return {
		config: fallbackConfig,
		pathRoot: WORKSPACE_ROOT,
		schemaRoot: WORKSPACE_ROOT,
		configPath: CONFIG_PATH,
	};
}

const loadedConfig = loadMissionControlConfig();
const config = loadedConfig.config;
export const MISSION_CONTROL_DATA_ROOT = loadedConfig.pathRoot;
export const IS_REPOSITORY_DB_MODE = config.data_mode === 'repository-db';

export function resolveOrganizationAdmin(configValue: {
	organization_admin?: unknown;
	workspace_admin?: unknown;
}): string | null {
	for (const value of [configValue.organization_admin, configValue.workspace_admin]) {
		if (typeof value === 'string' && value.trim()) return value.trim();
	}
	return null;
}

export const PLAN_PREFIX = config.plan_prefix;
export const ORGANIZATION_ADMIN_FROM_CONFIG = resolveOrganizationAdmin(config);
// Backward-compatible export for app consumers that still use the GEN2 name.
export const WORKSPACE_ADMIN_FROM_CONFIG = ORGANIZATION_ADMIN_FROM_CONFIG;
export const PLAN_CODE_RE = new RegExp(`^${PLAN_PREFIX}-[0-9]{4}$`);
export const PLAN_CODE_IN_TEXT_RE = new RegExp(`\\b${PLAN_PREFIX}-[0-9]{4}\\b`, 'g');
export const PLAN_ID_PREFIX = `mcplan-${PLAN_PREFIX.toLowerCase()}-`;
export const PLAN_ID_RE = new RegExp(`^${PLAN_ID_PREFIX}[0-9]{4}$`);
export const PLAN_CODE_PLACEHOLDER = `${PLAN_PREFIX}-XXXX`;

export function planCodeFromNumber(value: number): string {
	return `${PLAN_PREFIX}-${String(value).padStart(4, '0')}`;
}

export function planCodeNumber(code: string): number {
	return Number(code.slice(PLAN_PREFIX.length + 1));
}

export function planIdFromCode(code: string): string {
	return `${PLAN_ID_PREFIX}${code.slice(PLAN_PREFIX.length + 1).toLowerCase()}`;
}

export const PLANS_ROOT = path.resolve(MISSION_CONTROL_DATA_ROOT, config.plans_dir);
export const SCHEMA_PATH = path.resolve(loadedConfig.schemaRoot, config.schema_path);
export const LEDGER_FILE_NAMES = new Set([
	'TODO.tasks.json',
	'DONE.tasks.json',
	'ISSUES.open.json',
	'ISSUES.resolved.json',
]);
export const IGNORED_LEDGER_DIRS = new Set([
	'.git',
	'.build',
	'.claude',
	'.codex-tmp',
	'.next',
	'.nuxt',
	'.pr-worktrees',
	'.svelte-kit',
	'.worktrees',
	'build',
	'coverage',
	'dist',
	'logs',
	'node_modules',
	'runtime',
	'vendor',
]);

function isIgnoredLedgerDir(name: string): boolean {
	return IGNORED_LEDGER_DIRS.has(name) || name.endsWith('-worktrees');
}

export function workspaceRelative(absolutePath: string): string {
	return portableRelativePath(WORKSPACE_ROOT, absolutePath);
}

export function missionControlDataRelative(absolutePath: string): string {
	return portableRelativePath(MISSION_CONTROL_DATA_ROOT, absolutePath);
}

export function missionRelative(absolutePath: string): string {
	return portableRelativePath(MISSION_CONTROL_ROOT, absolutePath);
}

export function resolveWorkspaceContainedPath(relativePath: string): string {
	if (!relativePath || path.isAbsolute(relativePath)) {
		throw new Error(`Workspace path must be relative: ${relativePath}`);
	}
	const normalized = path.normalize(relativePath);
	if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
		throw new Error(`Workspace path must stay inside workspace: ${relativePath}`);
	}
	const resolved = path.resolve(WORKSPACE_ROOT, normalized);
	const boundary = `${WORKSPACE_ROOT}${path.sep}`;
	if (resolved !== WORKSPACE_ROOT && !resolved.startsWith(boundary)) {
		throw new Error(`Workspace path must stay inside workspace: ${relativePath}`);
	}
	return resolved;
}

export function isWorkspaceContainedPath(relativePath: string): boolean {
	try {
		resolveWorkspaceContainedPath(relativePath);
		return true;
	} catch {
		return false;
	}
}

export function resolveMissionControlDataContainedPath(relativePath: string): string {
	if (!relativePath || path.isAbsolute(relativePath)) {
		throw new Error(`Mission Control data path must be relative: ${relativePath}`);
	}
	const normalized = path.normalize(relativePath);
	if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
		throw new Error(`Mission Control data path must stay inside data root: ${relativePath}`);
	}
	const resolved = path.resolve(MISSION_CONTROL_DATA_ROOT, normalized);
	const boundary = `${MISSION_CONTROL_DATA_ROOT}${path.sep}`;
	if (resolved !== MISSION_CONTROL_DATA_ROOT && !resolved.startsWith(boundary)) {
		throw new Error(`Mission Control data path must stay inside data root: ${relativePath}`);
	}
	return resolved;
}

export function isMissionControlDataContainedPath(relativePath: string): boolean {
	try {
		resolveMissionControlDataContainedPath(relativePath);
		return true;
	} catch {
		return false;
	}
}

export function resolveConfiguredMissionControlPath(relativePath: string): string {
	return IS_REPOSITORY_DB_MODE
		? resolveMissionControlDataContainedPath(relativePath)
		: resolveWorkspaceContainedPath(relativePath);
}

export async function listWorkspaceLedgerFiles(
	dir = WORKSPACE_ROOT,
	fileNames = LEDGER_FILE_NAMES,
): Promise<string[]> {
	if (IS_REPOSITORY_DB_MODE && dir === WORKSPACE_ROOT) {
		const configuredPaths = [
			config.todo_tasks_path ?? 'data/mission-control/TODO.tasks.json',
			config.done_tasks_path ?? 'data/mission-control/DONE.tasks.json',
			config.issues_open_path ?? 'data/mission-control/ISSUES.open.json',
			config.issues_resolved_path ?? 'data/mission-control/ISSUES.resolved.json',
		];
		return [
			...new Set(
				configuredPaths
					.filter((configuredPath) => fileNames.has(path.basename(configuredPath)))
					.map(resolveMissionControlDataContainedPath),
			),
		].sort();
	}
	let entries: Dirent[];
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return [];
	}
	const nested = await Promise.all(
		entries.map(async (entry) => {
			if (isIgnoredLedgerDir(entry.name)) return [];
			const fullPath = path.join(dir, entry.name);
			if (entry.isDirectory()) return listWorkspaceLedgerFiles(fullPath, fileNames);
			if (entry.isFile() && fileNames.has(entry.name)) return [fullPath];
			return [];
		}),
	);
	return nested.flat();
}
