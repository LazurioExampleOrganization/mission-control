import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { devNull } from 'node:os';
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { parseDocument, parse as parseYaml, visit } from 'yaml';

/** Parsed YAML/JSON content of Mission Control files; deliberately untyped. */
type ParsedData = any;

export type RootMissionControlConfig = {
	schema_version?: string;
	plan_prefix: string;
	plans_dir: string;
	schema_path: string;
	roadmaps_dir?: string;
	roadmap_schema_path?: string;
	data_mode?: string;
	todo_tasks_path?: string;
	done_tasks_path?: string;
	issues_open_path?: string;
	issues_resolved_path?: string;
	data_boundary?: {
		mode?: string;
		legacy_fallback?: string[];
	};
	[key: string]: any;
};

export type RootPlanRecord = {
	path: string;
	filePath: string;
	plan: ParsedData;
	parseError: string | null;
	source?: string | null;
};

export type RootRoadmapRecord = {
	path: string;
	filePath: string;
	roadmap: ParsedData;
	parseError: string | null;
	source?: string | null;
};

export type RootRoadmapIssueBlocker = {
	step_id: ParsedData;
	step_title: ParsedData;
	issue_id: ParsedData;
	title: ParsedData;
	status: ParsedData;
	severity: ParsedData;
	owner: ParsedData;
	file: ParsedData;
};

export type RootRoadmapNextStep = {
	id: ParsedData;
	title: ParsedData;
	status: ParsedData;
	agent_routing: ParsedData;
	plan_refs: ParsedData[];
	todo_refs: ParsedData[];
	issue_refs: ParsedData[];
	evidence_refs: ParsedData[];
	acceptance_criteria: ParsedData[];
};

export type RootRoadmapExecutionReport = {
	dry_run: boolean;
	roadmap: {
		path: string;
		roadmap_code: ParsedData;
		title: ParsedData;
		status: ParsedData;
		owner: ParsedData;
	} | null;
	validation: { ok: boolean; failures: string[] };
	next_step: RootRoadmapNextStep | null;
	issue_blockers: RootRoadmapIssueBlocker[];
	blockers: string[];
	actions: string[];
};

export type BuildRoadmapExecutionReportOptions = {
	roadmapRecords?: RootRoadmapRecord[];
	validationFailures?: string[];
	roadmapCode?: string;
	issueRecords?: unknown[];
};

export type SummaryInput = {
	plans: RootPlanRecord[];
	roadmaps: RootRoadmapRecord[];
};

type InvalidYamlEntry = { filePath: string; message: string };

type SafeRepositoryDirectory =
	| { directoryPath: string | null; safe: false }
	| { directoryPath: string; safe: true };

type RoadmapLedgerReferenceIds = {
	taskIds: Set<string>;
	issueIds: Set<string>;
	failures: string[];
};

type RoadmapStepReferenceIds = {
	existingPlanCodes: Set<string>;
	existingPriorityIds: Set<ParsedData>;
	existingTaskIds: Set<string>;
	existingIssueIds: Set<string>;
	root: string;
};

const gitNullDevice = process.platform === 'win32' ? 'NUL' : devNull;

const CONFIG_SCHEMA_VERSION = 'companiesascode.mission_control.config.v1';
const PLAN_SCHEMA_VERSION = 'companiesascode.mission_control.plan.v2';
const ROADMAP_SCHEMA_VERSION = 'companiesascode.mission_control.roadmap.v1';
export const PLAN_STATUSES = [
	'shaping',
	'ready',
	'in_progress',
	'review',
	'blocked',
	'done',
	'archived',
];
export const PLAN_PRIORITIES = ['urgent', 'high', 'medium', 'low'];
const DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const TASK_ID_PATTERN = /^task-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{3}$/;
const ISSUE_ID_PATTERN = /^issue-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{3}$/;
const ROADMAP_CODE_PATTERN = /^RM-[0-9]{4}$/;
const ROADMAP_ID_PATTERN = /^mcroadmap-rm-[0-9]{4}$/;
const ROADMAP_PRIORITY_ID_PATTERN = /^priority-[0-9]{3}$/;
const ROADMAP_STEP_ID_PATTERN = /^step-[0-9]{3}$/;
const ROADMAP_EVIDENCE_KINDS = [
	'decision',
	'doc',
	'plan',
	'pull_request',
	'commit',
	'report',
	'validation',
	'external',
];
const gitTrackedPathCache = new Map<string, boolean>();
const jsonSchemaValidatorCache = new WeakMap();
const PLACEHOLDER_PATTERN =
	/^doplnit (kontext|aktuální problém|cílový stav|rozsah|scope|acceptance|ověření|validaci)\b/i;

const gitExecutable = 'git';
const gitLongPathArguments = process.platform === 'win32' ? ['-c', 'core.longpaths=true'] : [];

function missionControlConfigPath(root: string): string {
	const repositoryDbConfigPath = join(root, 'repository-db.yaml');
	const repositoryDbMissionConfigPath = join(
		root,
		'data',
		'mission-control',
		'mission-control.config.json',
	);
	if (existsSync(repositoryDbConfigPath) && existsSync(repositoryDbMissionConfigPath)) {
		return repositoryDbMissionConfigPath;
	}
	return join(root, 'mission-control', 'mission-control.config.json');
}

function normalizeRepositoryDbSchemaPath(root: string, config: Record<string, any>, key: string) {
	const value = config[key];
	if (typeof value !== 'string' || existsSync(join(root, value))) return;
	const appCodeRelative = join('..', value);
	if (existsSync(join(root, appCodeRelative))) {
		config[key] = appCodeRelative;
	}
}

export function loadMissionControlConfig(root: string): RootMissionControlConfig {
	const configPath = missionControlConfigPath(root);
	const config = JSON.parse(readFileSync(configPath, 'utf8'));
	if (
		existsSync(join(root, 'repository-db.yaml')) &&
		configPath.includes(`${sep}data${sep}mission-control${sep}`)
	) {
		normalizeRepositoryDbSchemaPath(root, config, 'schema_path');
		normalizeRepositoryDbSchemaPath(root, config, 'roadmap_schema_path');
	}
	if (config.schema_version !== CONFIG_SCHEMA_VERSION) {
		throw new Error(
			`mission-control.config.json: schema_version musí být ${CONFIG_SCHEMA_VERSION}`,
		);
	}
	if (!/^[A-Z]{2,6}$/.test(config.plan_prefix ?? '')) {
		throw new Error(
			`mission-control.config.json: plan_prefix musí být 2-6 velkých písmen, je "${config.plan_prefix}"`,
		);
	}
	if (typeof config.plans_dir !== 'string' || config.plans_dir.length === 0) {
		throw new Error('mission-control.config.json: plans_dir musí být neprázdný string');
	}
	if (typeof config.schema_path !== 'string' || !existsSync(join(root, config.schema_path))) {
		throw new Error(`mission-control.config.json: schema_path neexistuje: ${config.schema_path}`);
	}
	if (config.roadmaps_dir !== undefined && !isNonEmptyString(config.roadmaps_dir)) {
		throw new Error('mission-control.config.json: roadmaps_dir musí být neprázdný string');
	}
	if (config.roadmap_schema_path !== undefined) {
		if (
			typeof config.roadmap_schema_path !== 'string' ||
			!existsSync(join(root, config.roadmap_schema_path))
		) {
			throw new Error(
				`mission-control.config.json: roadmap_schema_path neexistuje: ${config.roadmap_schema_path}`,
			);
		}
	}
	return config;
}

export function loadPlanSchema(root: string, config: RootMissionControlConfig): ParsedData {
	return JSON.parse(readFileSync(join(root, config.schema_path), 'utf8'));
}

export function loadRoadmapSchema(root: string, config: RootMissionControlConfig): ParsedData {
	if (config.roadmap_schema_path === undefined) {
		return { properties: Object.fromEntries(roadmapAllowedKeys().map((key) => [key, {}])) };
	}
	return JSON.parse(readFileSync(join(root, config.roadmap_schema_path), 'utf8'));
}

function isWithinDirectory(candidate: string, root: string): boolean {
	return candidate === root || candidate.startsWith(`${root}${sep}`);
}

function sameRealPath(left: string, right: string): boolean {
	const leftStat = statSync(left, { bigint: true });
	const rightStat = statSync(right, { bigint: true });
	if (leftStat.dev === rightStat.dev && leftStat.ino !== 0n && leftStat.ino === rightStat.ino) {
		return true;
	}
	const canonicalRealPath = realpathSync.native ?? realpathSync;
	const leftRealPath = canonicalRealPath(left);
	const rightRealPath = canonicalRealPath(right);
	return process.platform === 'win32'
		? leftRealPath.toLowerCase() === rightRealPath.toLowerCase()
		: leftRealPath === rightRealPath;
}

function resolveRepoRelativePath(root: string, value: unknown): string | null {
	if (
		!isNonEmptyString(value) ||
		isAbsolute(value) ||
		/^[A-Za-z]:[\\/]/.test(value) ||
		value.includes('\\')
	) {
		return null;
	}
	const rootPath = resolve(root);
	const candidatePath = resolve(rootPath, value);
	return isWithinDirectory(candidatePath, rootPath) ? candidatePath : null;
}

function normalizeGitTrackedPath(root: string, repoPath: unknown): string | null {
	const resolvedPath = resolveRepoRelativePath(root, repoPath);
	if (resolvedPath === null) {
		return null;
	}
	return relative(resolve(root), resolvedPath).split(sep).join('/');
}

function isBundledTemplateDataRoot(root: string): boolean {
	try {
		const config = JSON.parse(
			readFileSync(join(root, 'data', 'mission-control', 'mission-control.config.json'), 'utf8'),
		);
		const repositoryDbSource = readFileSync(join(root, 'repository-db.yaml'), 'utf8');
		return (
			config.organization_admin === 'REPLACE_WITH_ORGANIZATION_ADMIN' &&
			repositoryDbSource.includes('REPLACE_WITH_ORG/mission-control-data.git')
		);
	} catch {
		return false;
	}
}

function gitIndexContext(
	root: string,
	repoPath: unknown,
): { repositoryRoot: string; path: string } | null {
	const normalizedPath = normalizeGitTrackedPath(root, repoPath);
	if (normalizedPath === null) return null;
	const rootPath = resolve(root);
	const repositoryRoot = execFileSync(
		gitExecutable,
		[...gitLongPathArguments, '-C', rootPath, 'rev-parse', '--show-toplevel'],
		{
			env: gitEnvironment(),
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		},
	).trim();
	const rootRealPath = realpathSync(rootPath);
	const repositoryRealPath = realpathSync(repositoryRoot);
	if (sameRealPath(rootRealPath, repositoryRealPath)) {
		return { repositoryRoot, path: normalizedPath };
	}
	if (
		!isBundledTemplateDataRoot(rootPath) ||
		!isWithinDirectory(rootRealPath, repositoryRealPath)
	) {
		return null;
	}
	const templatePath = relative(repositoryRealPath, resolve(rootPath, normalizedPath))
		.split(sep)
		.join('/');
	return { repositoryRoot, path: templatePath };
}

function isGitTrackedPath(root: string, repoPath: unknown) {
	const cacheKey = `${resolve(root)}\0${repoPath}`;
	if (gitTrackedPathCache.has(cacheKey)) return gitTrackedPathCache.get(cacheKey);
	let tracked = false;
	try {
		const context = gitIndexContext(root, repoPath);
		if (!context) return false;
		const stageEntries = execFileSync(
			gitExecutable,
			[
				...gitLongPathArguments,
				'-C',
				context.repositoryRoot,
				'ls-files',
				'--stage',
				'--error-unmatch',
				'-z',
				'--',
				context.path,
			],
			{
				env: gitEnvironment(),
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'ignore'],
			},
		)
			.split('\0')
			.filter(Boolean);
		if (stageEntries.length !== 1 || !/^[0-9]{6} [0-9a-f]+ 0\t/.test(stageEntries[0])) {
			gitTrackedPathCache.set(cacheKey, false);
			return false;
		}
		const debugOutput = execFileSync(
			gitExecutable,
			[
				...gitLongPathArguments,
				'-C',
				context.repositoryRoot,
				'ls-files',
				'--debug',
				'--error-unmatch',
				'--',
				context.path,
			],
			{
				env: gitEnvironment(),
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'ignore'],
			},
		);
		const flagMatches = [...debugOutput.matchAll(/\bflags:\s+([0-9a-f]+)\b/gi)];
		tracked =
			flagMatches.length === 1 && (Number.parseInt(flagMatches[0][1], 16) & 0x20000000) === 0;
	} catch {
		tracked = false;
	}
	gitTrackedPathCache.set(cacheKey, tracked);
	return tracked;
}

function canonicalManifestPath(value: unknown): string | null {
	if (typeof value !== 'string' || value === '' || posix.isAbsolute(value)) return null;
	const canonical = posix.normalize(value.replaceAll('\\', '/'));
	if (canonical === '.' || canonical === '..' || canonical.startsWith('../')) return null;
	return canonical;
}

function allowsMissingDeclaredPlanningTarget(workspaceRoot: string, todoPath: unknown): boolean {
	try {
		const manifest = JSON.parse(readFileSync(join(workspaceRoot, 'modules.manifest.json'), 'utf8'));
		const modules = Array.isArray(manifest.modules) ? manifest.modules : null;
		const moduleSlots = Array.isArray(manifest.module_slots) ? manifest.module_slots : null;
		if (modules && moduleSlots) return false;
		const slots = modules ?? moduleSlots;
		if (!slots) return false;
		const targetPath = canonicalManifestPath(todoPath);
		if (!targetPath || posix.basename(targetPath) !== 'TODO.tasks.json') return false;
		const targetParent = posix.dirname(targetPath);
		const matches = slots.filter(
			(slot: ParsedData) => canonicalManifestPath(slot?.path) === targetParent,
		);
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
	} catch {
		return false;
	}
}

function planningTargetRoot(
	root: string,
	todoPath: unknown,
	workspaceRoot: unknown,
): string | null {
	if (typeof todoPath !== 'string' || todoPath.startsWith('data/mission-control/')) {
		return root;
	}
	return typeof workspaceRoot === 'string' && workspaceRoot.trim() !== ''
		? resolve(workspaceRoot)
		: null;
}

function allowsMissingLegacyPlanningTarget(
	root: string,
	todoPath: string,
	workspaceRoot: unknown,
): boolean {
	const targetRoot = planningTargetRoot(root, todoPath, workspaceRoot);
	const manifestAllowsMissing =
		targetRoot !== null &&
		!todoPath.startsWith('data/mission-control/') &&
		allowsMissingDeclaredPlanningTarget(targetRoot, todoPath);
	try {
		const config = loadMissionControlConfig(root);
		if (config.data_mode === 'repository-db' && !todoPath.startsWith('data/mission-control/')) {
			return manifestAllowsMissing || todoPath.startsWith('modules/');
		}
		const legacyFallback = Array.isArray(config.data_boundary?.legacy_fallback)
			? config.data_boundary.legacy_fallback
			: [];
		return (
			config.data_boundary?.mode === 'org-local-v3-pilot' &&
			legacyFallback.includes('TODO.tasks.json') &&
			typeof todoPath === 'string' &&
			(manifestAllowsMissing || todoPath.startsWith('modules/'))
		);
	} catch {
		return false;
	}
}

function asArray(value: unknown): ParsedData[] {
	return Array.isArray(value) ? value : [];
}

function gitEnvironment() {
	const env = { ...process.env };
	const blockedNames = new Set([
		'GIT_ALTERNATE_OBJECT_DIRECTORIES',
		'GIT_COMMON_DIR',
		'GIT_CONFIG',
		'GIT_CONFIG_GLOBAL',
		'GIT_CONFIG_NOSYSTEM',
		'GIT_CONFIG_PARAMETERS',
		'GIT_CONFIG_SYSTEM',
		'GIT_DIR',
		'GIT_INDEX_FILE',
		'GIT_OBJECT_DIRECTORY',
		'GIT_PREFIX',
		'GIT_WORK_TREE',
	]);
	for (const key of Object.keys(env)) {
		const upperKey = key.toUpperCase();
		if (
			blockedNames.has(upperKey) ||
			upperKey === 'GIT_CONFIG_COUNT' ||
			/^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(upperKey)
		) {
			delete env[key];
		}
	}
	env.GIT_CONFIG_GLOBAL = gitNullDevice;
	env.GIT_CONFIG_SYSTEM = gitNullDevice;
	env.GIT_CONFIG_NOSYSTEM = '1';
	env.GIT_LITERAL_PATHSPECS = '1';
	env.LANG = 'C';
	env.LC_ALL = 'C';
	return env;
}

function looksLikeCredentialValue(candidate: string): boolean {
	const value = candidate.trim();
	return (
		/^(?:basic|bearer)\s+\S+/i.test(value) ||
		/(?:^|[^a-z0-9])(?:proxy-)?authorization["']?\s*[:=]\s*["']?(?:basic|bearer)\s+\S+/i.test(
			value,
		) ||
		/(?:^|[^a-z0-9])(?:gh[pousr]_|github_pat_|sk-|xox[baprs]-|ya29\.)[a-z0-9_-]{6,}/i.test(value) ||
		/(?:^|[^A-Z0-9])(?:AKIA|ASIA)[A-Z0-9]{16}(?:$|[^A-Z0-9])/.test(value) ||
		/(?:^|[^A-Za-z0-9])AIza[A-Za-z0-9_-]{20,}(?:$|[^A-Za-z0-9_-])/.test(value) ||
		/(?:^|[^A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}(?:$|[^A-Za-z0-9_-])/.test(
			value,
		) ||
		/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value)
	);
}

function isCredentialParameterName(key: string): boolean {
	const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
	return (
		['auth', 'jwt', 'session', 'sessionid', 'sid', 'sig'].includes(normalizedKey) ||
		/(?:accessid|accesskey|apikey|authorization|credential|password|passwd|privatekey|secret|signature|token)/.test(
			normalizedKey,
		)
	);
}

const maxCredentialDecodePasses = 12;

function decodedCredentialCandidates(candidate: string): {
	candidates: string[];
	truncated: boolean;
} {
	const candidates: string[] = [];
	let current = candidate;
	for (let depth = 0; depth <= maxCredentialDecodePasses; depth += 1) {
		if (!candidates.includes(current)) candidates.push(current);
		try {
			const decoded = decodeURIComponent(current);
			if (decoded === current) return { candidates, truncated: false };
			current = decoded;
		} catch {
			return { candidates, truncated: true };
		}
	}
	return { candidates, truncated: true };
}

function containsCredentialParameterSyntax(candidate: string): boolean {
	const parameterPattern = /(?:^|[?&#;])([^=?&#;]+)=/g;
	const serializedFieldPattern =
		/(?:^|[?&#;,{[])\s*(?:\\?["'])?([^"'\\:=?&#;,[\]{}]+?)(?:\\?["'])?\s*:/g;
	return [parameterPattern, serializedFieldPattern].some((pattern) =>
		[...candidate.matchAll(pattern)].some((match) => isCredentialParameterName(match[1])),
	);
}

function parseNestedHttpUrl(candidate: string): URL | null {
	if (!/^(?:https?:\/\/|[/?#])/i.test(candidate)) return null;
	try {
		const nestedUrl = new URL(candidate, 'https://credential-scan.invalid/');
		return ['http:', 'https:'].includes(nestedUrl.protocol) ? nestedUrl : null;
	} catch {
		return null;
	}
}

function hasCredentialMaterialInCandidate(candidate: string, depth: number): boolean {
	if (
		looksLikeCredentialValue(candidate) ||
		containsCredentialParameterSyntax(candidate) ||
		(candidate.includes('=') && hasCredentialLikeParameters(new URLSearchParams(candidate), depth))
	) {
		return true;
	}
	const nestedUrl = parseNestedHttpUrl(candidate);
	return Boolean(nestedUrl && (depth >= 3 || hasCredentialMaterialInUrl(nestedUrl, depth + 1)));
}

function hasCredentialLikeParameters(parameters: URLSearchParams, depth: number): boolean {
	for (const [key, parameterValue] of parameters.entries()) {
		const decodedKey = decodedCredentialCandidates(key);
		if (decodedKey.truncated || decodedKey.candidates.some(isCredentialParameterName)) {
			return true;
		}
		const decoded = decodedCredentialCandidates(parameterValue);
		if (decoded.truncated) return true;
		for (const candidate of decoded.candidates) {
			if (hasCredentialMaterialInCandidate(candidate, depth)) return true;
		}
	}
	return false;
}

function hasCredentialMaterialInUrl(url: URL, depth: number): boolean {
	const fragment = decodedCredentialCandidates(url.hash.slice(1));
	const decodedPathComponents = url.pathname
		.split('/')
		.filter(Boolean)
		.map((component) => decodedCredentialCandidates(component));
	const hostnameCandidates = decodedCredentialCandidates(url.hostname);
	return (
		Boolean(url.username || url.password) ||
		hostnameCandidates.truncated ||
		hostnameCandidates.candidates.some(looksLikeCredentialValue) ||
		hasCredentialLikeParameters(url.searchParams, depth) ||
		decodedPathComponents.some(
			(component) =>
				component.truncated ||
				component.candidates.some((candidate) =>
					hasCredentialMaterialInCandidate(candidate, depth),
				),
		) ||
		fragment.truncated ||
		fragment.candidates.some((candidate) => hasCredentialMaterialInCandidate(candidate, depth))
	);
}

function isExternalHttpUrl(value: unknown): boolean {
	if (typeof value !== 'string') return false;
	const rawCandidates = decodedCredentialCandidates(value);
	if (rawCandidates.truncated || rawCandidates.candidates.some(looksLikeCredentialValue)) {
		return false;
	}
	try {
		const url = new URL(value);
		return (
			['http:', 'https:'].includes(url.protocol) &&
			Boolean(url.hostname) &&
			!hasCredentialMaterialInUrl(url, 0)
		);
	} catch {
		return false;
	}
}

const windowsDeviceNamePattern = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

function isSafePortableRoadmapPath(value: unknown): boolean {
	if (
		typeof value !== 'string' ||
		value.length === 0 ||
		value.trim() !== value ||
		value.startsWith('/') ||
		// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are deliberately rejected in portable paths.
		/[<>:"\\|?*\u0000-\u001f\u007f]/.test(value)
	) {
		return false;
	}
	const segments = value.split('/');
	return (
		segments[0]?.toLowerCase() !== '.git' &&
		segments.every(
			(segment) =>
				segment.length > 0 &&
				segment !== '.' &&
				segment !== '..' &&
				!segment.endsWith('.') &&
				!segment.endsWith(' ') &&
				!windowsDeviceNamePattern.test(segment),
		)
	);
}

function isPortableRoadmapLinkPath(root: string, value: unknown): boolean {
	if (!isSafePortableRoadmapPath(value)) return false;
	const resolvedPath = resolveRepoRelativePath(root, value);
	if (!resolvedPath) return false;
	const normalizedPath = relative(resolve(root), resolvedPath).split(sep).join('/');
	if (normalizedPath.split('/')[0]?.toLowerCase() === '.git') return false;
	const realRoot = realpathSync(root);
	let currentPath = resolve(root);
	const segments = normalizedPath.split('/');
	for (const [index, segment] of segments.entries()) {
		currentPath = join(currentPath, segment);
		let stats: import('node:fs').Stats;
		try {
			stats = lstatSync(currentPath);
		} catch (error) {
			return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
		}
		if (stats.isSymbolicLink()) return false;
		if (index < segments.length - 1 && !stats.isDirectory()) return false;
		if (!isWithinDirectory(realpathSync(currentPath), realRoot)) return false;
	}
	return true;
}

function collectYamlFiles(
	dir: string,
	found: string[],
	rootReal: string = realpathSync(dir),
	invalidEntries: InvalidYamlEntry[] | null = null,
): string[] {
	for (const entry of readdirSync(dir)) {
		const entryPath = join(dir, entry);
		const entryStats = lstatSync(entryPath);
		if (entryStats.isSymbolicLink()) {
			invalidEntries?.push({
				filePath: entryPath,
				message: 'YAML source tree nesmí obsahovat symlinky',
			});
			continue;
		}
		const entryReal = realpathSync(entryPath);
		if (!isWithinDirectory(entryReal, rootReal)) {
			continue;
		}
		if (entryStats.isDirectory()) {
			collectYamlFiles(entryPath, found, rootReal, invalidEntries);
		} else if (entry.endsWith('.yaml') || entry.endsWith('.yml')) {
			found.push(entryPath);
		} else if (/\.(?:yaml|yml)$/i.test(entry)) {
			invalidEntries?.push({
				filePath: entryPath,
				message: 'YAML přípona musí být lowercase .yaml nebo .yml',
			});
		}
	}
	return found;
}

function collectPlanFiles(
	dir: string,
	found: string[],
	rootReal: string,
	invalidEntries: InvalidYamlEntry[] | null,
): string[] {
	return collectYamlFiles(dir, found, rootReal, invalidEntries).filter((filePath) => {
		if (!filePath.endsWith('.yml')) {
			return true;
		}
		invalidEntries?.push({
			filePath,
			message: 'kanonický plán musí používat příponu .yaml',
		});
		return false;
	});
}

function resolveSafeRepositoryDirectory(
	root: string,
	configuredPath: unknown,
): SafeRepositoryDirectory {
	const rootPath = resolve(root);
	const directoryPath = resolveRepoRelativePath(rootPath, configuredPath);
	if (!directoryPath) {
		return { directoryPath: null, safe: false };
	}
	const rootReal = realpathSync(rootPath);
	const fromRoot = relative(rootPath, directoryPath);
	let currentPath = rootPath;
	for (const segment of fromRoot.split(sep).filter(Boolean)) {
		currentPath = join(currentPath, segment);
		let stats: import('node:fs').Stats;
		try {
			stats = lstatSync(currentPath);
		} catch (error) {
			return (error as NodeJS.ErrnoException)?.code === 'ENOENT'
				? { directoryPath, safe: true }
				: { directoryPath, safe: false };
		}
		if (
			stats.isSymbolicLink() ||
			!stats.isDirectory() ||
			!isWithinDirectory(realpathSync(currentPath), rootReal)
		) {
			return { directoryPath, safe: false };
		}
	}
	return { directoryPath, safe: true };
}

export function loadPlans(root: string, config: RootMissionControlConfig): RootPlanRecord[] {
	const configuredPath = config.plans_dir;
	const { directoryPath: plansDir, safe } = resolveSafeRepositoryDirectory(root, configuredPath);
	if (!safe) {
		return [
			{
				path: configuredPath,
				filePath: plansDir ?? resolve(root),
				plan: null,
				parseError: 'plans_dir musí být skutečný adresář bez symlinků uvnitř datového repozitáře',
				source: null,
			},
		];
	}
	if (!existsSync(plansDir)) {
		return [];
	}
	const invalidEntries: InvalidYamlEntry[] = [];
	const planFiles = collectPlanFiles(plansDir, [], realpathSync(plansDir), invalidEntries).sort();
	const plans: RootPlanRecord[] = invalidEntries.map(({ filePath, message }) => ({
		path: relative(root, filePath).split(sep).join('/'),
		filePath,
		plan: null,
		parseError: message,
		source: null,
	}));
	for (const filePath of planFiles) {
		const relPath = relative(root, filePath).split(sep).join('/');
		let plan = null;
		let parseError = null;
		try {
			const source = readFileSync(filePath, 'utf8');
			plan = parseYaml(source);
			plans.push({ path: relPath, filePath, plan, parseError, source });
			continue;
		} catch (error) {
			parseError = `YAML parse selhal: ${(error as Error).message}`;
		}
		plans.push({ path: relPath, filePath, plan, parseError, source: null });
	}
	return plans;
}

export function loadRoadmaps(root: string, config: RootMissionControlConfig): RootRoadmapRecord[] {
	const configuredPath = config.roadmaps_dir ?? 'mission-control/roadmaps';
	const { directoryPath: roadmapsDir, safe } = resolveSafeRepositoryDirectory(root, configuredPath);
	if (!safe) {
		return [
			{
				path: configuredPath,
				filePath: roadmapsDir ?? resolve(root),
				roadmap: null,
				parseError:
					'roadmaps_dir musí být skutečný adresář bez symlinků uvnitř datového repozitáře',
				source: null,
			},
		];
	}
	if (!existsSync(roadmapsDir)) {
		if (config.data_mode !== 'repository-db') {
			return [];
		}
		return [
			{
				path: configuredPath,
				filePath: roadmapsDir,
				roadmap: null,
				parseError: `roadmaps_dir neexistuje: ${configuredPath}`,
				source: null,
			},
		];
	}
	const invalidEntries: InvalidYamlEntry[] = [];
	const roadmapFiles = collectYamlFiles(
		roadmapsDir,
		[],
		realpathSync(roadmapsDir),
		invalidEntries,
	).sort();
	const roadmaps: RootRoadmapRecord[] = invalidEntries.map(({ filePath, message }) => ({
		path: relative(root, filePath).split(sep).join('/'),
		filePath,
		roadmap: null,
		parseError: message,
		source: null,
	}));
	for (const filePath of roadmapFiles) {
		const relPath = relative(root, filePath).split(sep).join('/');
		let roadmap = null;
		let parseError = null;
		try {
			const source = readFileSync(filePath, 'utf8');
			roadmap = parseYaml(source);
			roadmaps.push({ path: relPath, filePath, roadmap, parseError, source });
			continue;
		} catch (error) {
			parseError = `YAML parse selhal: ${(error as Error).message}`;
		}
		roadmaps.push({ path: relPath, filePath, roadmap, parseError, source: null });
	}
	return roadmaps;
}

function pushIf(failures: string[], path: string, condition: unknown, message: string): void {
	if (condition) {
		failures.push(`${path}: ${message}`);
	}
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0;
}

function isValidDate(value: unknown): boolean {
	if (!isNonEmptyString(value) || !DATE_PATTERN.test(value)) {
		return false;
	}
	const [year, month, day] = value.split('-').map(Number);
	const date = new Date(Date.UTC(year, month - 1, day));
	return (
		date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
	);
}

function validateKnownKeys(
	failures: string[],
	path: string,
	value: object,
	allowedKeys: string[],
	label: string,
): void {
	const extraKeys = Object.keys(value).filter((key) => !allowedKeys.includes(key));
	pushIf(
		failures,
		path,
		extraKeys.length > 0,
		`${label} obsahuje neznámá pole: ${extraKeys.join(', ')}`,
	);
}

function validateJsonSchema(
	failures: string[],
	path: string,
	value: unknown,
	schema: ParsedData,
	{ compileLabel, errorLabel }: { compileLabel: string; errorLabel: string },
): boolean {
	const cacheableSchema =
		schema !== null && (typeof schema === 'object' || typeof schema === 'function');
	let compiled = cacheableSchema ? jsonSchemaValidatorCache.get(schema) : undefined;
	if (compiled === undefined) {
		try {
			compiled = {
				validate: new Ajv2020({ allErrors: true, strict: false }).compile(schema),
				error: null,
			};
		} catch (error) {
			compiled = {
				validate: null,
				error: error instanceof Error ? error.message : String(error),
			};
		}
		if (cacheableSchema) {
			jsonSchemaValidatorCache.set(schema, compiled);
		}
	}
	if (compiled.error !== null) {
		failures.push(`${path}: ${compileLabel} nelze zkompilovat: ${compiled.error}`);
		return false;
	}
	if (compiled.validate(value)) {
		return true;
	}
	for (const error of compiled.validate.errors ?? []) {
		failures.push(
			`${path}: ${errorLabel} ${error.instancePath || '(root)'} ${error.message ?? 'není validní'}`,
		);
	}
	return true;
}

function schemaPropertyKeys(schema: ParsedData): string[] | null {
	if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) {
		return null;
	}
	const properties = schema.properties;
	if (properties === null || typeof properties !== 'object' || Array.isArray(properties)) {
		return null;
	}
	return Object.keys(properties);
}

function yamlBlockScalarLineIndexes(source: string): Set<number> {
	const ranges: Array<[number, number]> = [];
	const document = parseDocument(source);
	visit(document, {
		Scalar(_key, node) {
			if (
				['BLOCK_LITERAL', 'BLOCK_FOLDED'].includes(node.type as string) &&
				Array.isArray(node.range)
			) {
				ranges.push([node.range[0], node.range[2] ?? node.range[1]]);
			}
		},
	});
	const indexes = new Set<number>();
	let offset = 0;
	for (const [lineIndex, line] of source.split(/\r?\n/).entries()) {
		if (ranges.some(([start, end]) => offset >= start && offset < end)) {
			indexes.add(lineIndex);
		}
		offset += line.length;
		if (source.startsWith('\r\n', offset)) offset += 2;
		else if (source[offset] === '\n') offset += 1;
	}
	return indexes;
}

function validateNoUnquotedHashScalars(
	failures: string[],
	path: string,
	source: unknown,
	fieldNames: string[],
): void {
	if (!isNonEmptyString(source)) {
		return;
	}
	const blockScalarLineIndexes = yamlBlockScalarLineIndexes(source);
	const watchedFields = new Set(fieldNames);
	source.split(/\r?\n/).forEach((line, index) => {
		if (blockScalarLineIndexes.has(index)) return;
		const match = line.match(/^\s*(?:-\s*)?([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
		if (!match || !watchedFields.has(match[1])) {
			return;
		}
		const [, field, rawValue] = match;
		const trimmedValue = rawValue.trimStart();
		if (
			trimmedValue.length === 0 ||
			trimmedValue.startsWith('"') ||
			trimmedValue.startsWith("'") ||
			trimmedValue.startsWith('>') ||
			trimmedValue.startsWith('|')
		) {
			return;
		}
		const hashIndex = rawValue.indexOf('#');
		if (hashIndex === -1) {
			return;
		}
		const beforeHash = rawValue.slice(0, hashIndex);
		if (beforeHash.trim().length === 0 || !/\s/.test(rawValue[hashIndex - 1] ?? '')) {
			return;
		}
		failures.push(
			`${path}: řádek ${index + 1} ${field} obsahuje nequoted #; quote-ni hodnotu nebo použij block scalar, jinak YAML zbytek řádku zahodí jako komentář`,
		);
	});
}

function validateStringArray(
	failures: string[],
	path: string,
	value: unknown,
	field: string,
	{ minItems = 0 }: { minItems?: number } = {},
): void {
	if (value === undefined) {
		pushIf(failures, path, minItems > 0, `chybí povinné pole ${field}`);
		return;
	}
	if (!Array.isArray(value)) {
		failures.push(`${path}: ${field} musí být pole`);
		return;
	}
	pushIf(failures, path, value.length < minItems, `${field} musí mít aspoň ${minItems} položek`);
	value.forEach((item, index) => {
		pushIf(failures, path, !isNonEmptyString(item), `${field}[${index}] musí být neprázdný string`);
	});
}

function validatePlaceholders(failures: string[], path: string, plan: ParsedData): void {
	const flatTexts = [
		plan.context,
		plan.current_problem,
		plan.target_state,
		...(Array.isArray(plan.scope?.in) ? plan.scope.in : []),
		...(Array.isArray(plan.scope?.out) ? plan.scope.out : []),
		...(Array.isArray(plan.acceptance_criteria) ? plan.acceptance_criteria : []),
		...(Array.isArray(plan.validation) ? plan.validation : []),
	];
	for (const text of flatTexts) {
		if (typeof text === 'string' && PLACEHOLDER_PATTERN.test(text.trim())) {
			failures.push(
				`${path}: kurátorský placeholder "${text.slice(0, 40)}..." nesmí zůstat v plánu`,
			);
		}
	}
}

export function validatePlanShape(
	record: RootPlanRecord,
	config: RootMissionControlConfig,
	root: string,
	schema: ParsedData,
	workspaceRoot: unknown,
): string[] {
	const failures: string[] = [];
	const { path, filePath, plan, parseError } = record;

	if (parseError) {
		return [`${path}: ${parseError}`];
	}
	if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
		return [`${path}: plán musí být YAML objekt`];
	}

	validateNoUnquotedHashScalars(failures, path, record.source, ['decision', 'rationale']);

	const prefix = config.plan_prefix;
	const devCodePattern = new RegExp(`^${prefix}-[0-9]{4}$`);
	const idPattern = new RegExp(`^mcplan-${prefix.toLowerCase()}-[0-9]{4}$`);

	if (
		!validateJsonSchema(failures, path, plan, schema, {
			compileLabel: 'schéma plánu',
			errorLabel: 'plan schema',
		})
	) {
		return failures;
	}
	const schemaKeys = schemaPropertyKeys(schema);
	if (schemaKeys !== null) {
		validateKnownKeys(failures, path, plan, schemaKeys, 'plán');
	}

	pushIf(
		failures,
		path,
		plan.schema_version !== PLAN_SCHEMA_VERSION,
		`schema_version musí být ${PLAN_SCHEMA_VERSION}`,
	);
	pushIf(
		failures,
		path,
		!isNonEmptyString(plan.dev_code) || !devCodePattern.test(plan.dev_code),
		`dev_code musí mít tvar ${prefix}-XXXX`,
	);
	pushIf(
		failures,
		path,
		!isNonEmptyString(plan.id) || !idPattern.test(plan.id),
		`id musí mít tvar mcplan-${prefix.toLowerCase()}-XXXX`,
	);
	if (isNonEmptyString(plan.dev_code) && isNonEmptyString(plan.id)) {
		pushIf(
			failures,
			path,
			plan.id !== `mcplan-${plan.dev_code.toLowerCase()}`,
			'id musí odpovídat dev_code (mcplan-<lowercase dev_code>)',
		);
	}
	const clickup = plan.legacy_sources?.clickup;
	if (typeof clickup?.custom_id === 'string') {
		pushIf(
			failures,
			path,
			!devCodePattern.test(clickup.custom_id),
			`legacy_sources.clickup.custom_id musí mít tvar ${prefix}-XXXX`,
		);
	}
	if (isNonEmptyString(plan.dev_code)) {
		pushIf(
			failures,
			path,
			!basename(filePath).startsWith(`${plan.dev_code}-`),
			`název souboru musí začínat ${plan.dev_code}-`,
		);
	}
	pushIf(failures, path, !isNonEmptyString(plan.title), 'chybí title');
	pushIf(
		failures,
		path,
		!PLAN_STATUSES.includes(plan.status),
		`status musí být jeden z: ${PLAN_STATUSES.join(', ')}`,
	);
	pushIf(failures, path, !isNonEmptyString(plan.owner), 'chybí owner');
	pushIf(
		failures,
		path,
		!PLAN_PRIORITIES.includes(plan.priority),
		`priority musí být jedna z: ${PLAN_PRIORITIES.join(', ')}`,
	);
	pushIf(
		failures,
		path,
		!Number.isInteger(plan.priority_rank) || plan.priority_rank < 1,
		'priority_rank musí být celé číslo >= 1',
	);
	for (const field of ['created_at', 'updated_at']) {
		pushIf(failures, path, !isValidDate(plan[field]), `${field} musí být reálné datum YYYY-MM-DD`);
	}
	if (isValidDate(plan.created_at)) {
		const [year, month] = plan.created_at.split('-');
		const expectedDir = `${config.plans_dir}/${year}/${month}`;
		pushIf(
			failures,
			path,
			dirname(path) !== expectedDir,
			`plán musí ležet v ${expectedDir}/ podle created_at`,
		);
	}
	for (const field of ['context', 'current_problem', 'target_state']) {
		pushIf(failures, path, !isNonEmptyString(plan[field]), `chybí povinné pole ${field}`);
	}

	if (!plan.scope || typeof plan.scope !== 'object' || Array.isArray(plan.scope)) {
		failures.push(`${path}: chybí scope s poli in a out`);
	} else {
		validateStringArray(failures, path, plan.scope.in, 'scope.in', { minItems: 1 });
		validateStringArray(failures, path, plan.scope.out, 'scope.out', { minItems: 1 });
		validateKnownKeys(failures, path, plan.scope, ['in', 'out'], 'scope');
	}

	validateStringArray(failures, path, plan.acceptance_criteria, 'acceptance_criteria', {
		minItems: 1,
	});
	validateStringArray(failures, path, plan.validation, 'validation', { minItems: 1 });
	validateStringArray(failures, path, plan.risk_notes, 'risk_notes');
	validateStringArray(failures, path, plan.assumptions, 'assumptions');
	validateStringArray(failures, path, plan.open_questions, 'open_questions');
	validateStringArray(failures, path, plan.dependencies, 'dependencies');

	if (plan.decisions !== undefined) {
		if (!Array.isArray(plan.decisions)) {
			failures.push(`${path}: decisions musí být pole`);
		} else {
			plan.decisions.forEach((decision: ParsedData, index: number) => {
				if (!decision || typeof decision !== 'object' || Array.isArray(decision)) {
					failures.push(`${path}: decisions[${index}] musí být objekt`);
					return;
				}
				pushIf(
					failures,
					path,
					!isValidDate(decision.date),
					`decisions[${index}].date musí být reálné datum YYYY-MM-DD`,
				);
				pushIf(
					failures,
					path,
					!isNonEmptyString(decision.decision),
					`decisions[${index}].decision musí být neprázdný string`,
				);
				pushIf(
					failures,
					path,
					decision.rationale !== undefined && typeof decision.rationale !== 'string',
					`decisions[${index}].rationale musí být string`,
				);
				validateKnownKeys(
					failures,
					path,
					decision,
					['date', 'decision', 'rationale'],
					`decisions[${index}]`,
				);
			});
		}
	}

	if (plan.github !== undefined) {
		if (!plan.github || typeof plan.github !== 'object' || Array.isArray(plan.github)) {
			failures.push(`${path}: github musí být objekt`);
		} else {
			validateKnownKeys(failures, path, plan.github, ['branches', 'prs'], 'github');
			validateStringArray(failures, path, plan.github.branches, 'github.branches');
			if (plan.github.prs !== undefined) {
				if (!Array.isArray(plan.github.prs)) {
					failures.push(`${path}: github.prs musí být pole`);
				} else {
					plan.github.prs.forEach((pr: ParsedData, index: number) => {
						if (!pr || typeof pr !== 'object' || Array.isArray(pr)) {
							failures.push(`${path}: github.prs[${index}] musí být objekt`);
							return;
						}
						pushIf(
							failures,
							path,
							!isNonEmptyString(pr.url),
							`github.prs[${index}].url musí být neprázdný string`,
						);
						validateKnownKeys(
							failures,
							path,
							pr,
							['url', 'status', 'note'],
							`github.prs[${index}]`,
						);
					});
				}
			}
		}
	}

	if (plan.todo_outputs !== undefined) {
		if (!Array.isArray(plan.todo_outputs)) {
			failures.push(`${path}: todo_outputs musí být pole`);
		} else {
			plan.todo_outputs.forEach((taskId: ParsedData, index: number) => {
				pushIf(
					failures,
					path,
					!TASK_ID_PATTERN.test(taskId ?? ''),
					`todo_outputs[${index}] musí mít tvar task-YYYY-MM-DD-NNN`,
				);
			});
		}
	}

	const hasProposedTasks = Array.isArray(plan.proposed_tasks) && plan.proposed_tasks.length > 0;
	const hasPlanningTarget = plan.planning_target !== undefined;
	pushIf(
		failures,
		path,
		hasProposedTasks && !hasPlanningTarget,
		'proposed_tasks vyžadují planning_target',
	);
	pushIf(
		failures,
		path,
		hasPlanningTarget && !hasProposedTasks,
		'planning_target bez proposed_tasks nedává smysl',
	);

	if (hasPlanningTarget) {
		const target = plan.planning_target;
		if (!target || typeof target !== 'object' || Array.isArray(target)) {
			failures.push(`${path}: planning_target musí být objekt`);
		} else {
			validateKnownKeys(failures, path, target, ['scope', 'todo_tasks_path'], 'planning_target');
			pushIf(
				failures,
				path,
				!isNonEmptyString(target.scope),
				'planning_target.scope musí být neprázdný string',
			);
			const todoPath = target.todo_tasks_path;
			const targetRoot = planningTargetRoot(root, todoPath, workspaceRoot);
			const resolvedTodoPath = targetRoot ? resolveRepoRelativePath(targetRoot, todoPath) : null;
			if (!isNonEmptyString(todoPath) || !/(^|\/)TODO\.tasks\.json$/.test(todoPath)) {
				failures.push(`${path}: planning_target.todo_tasks_path musí končit TODO.tasks.json`);
			} else if (!targetRoot) {
				failures.push(
					`${path}: planning_target.todo_tasks_path vyžaduje explicitní Workspace root`,
				);
			} else if (!resolvedTodoPath) {
				failures.push(
					`${path}: planning_target.todo_tasks_path musí být relativní cesta uvnitř repa`,
				);
			} else if (
				!existsSync(resolvedTodoPath) &&
				!allowsMissingLegacyPlanningTarget(root, todoPath, workspaceRoot)
			) {
				failures.push(`${path}: planning_target.todo_tasks_path neexistuje: ${todoPath}`);
			}
		}
	}

	if (hasProposedTasks) {
		plan.proposed_tasks.forEach((task: ParsedData, index: number) => {
			if (!task || typeof task !== 'object' || Array.isArray(task)) {
				failures.push(`${path}: proposed_tasks[${index}] musí být objekt`);
				return;
			}
			validateKnownKeys(
				failures,
				path,
				task,
				[
					'id',
					'title',
					'summary',
					'priority',
					'priority_reason',
					'tags',
					'acceptance_criteria',
					'risk_notes',
					'blocked_by',
				],
				`proposed_tasks[${index}]`,
			);
			pushIf(
				failures,
				path,
				task.id !== undefined && !TASK_ID_PATTERN.test(task.id ?? ''),
				`proposed_tasks[${index}].id musí mít tvar task-YYYY-MM-DD-NNN`,
			);
			pushIf(
				failures,
				path,
				!isNonEmptyString(task.title),
				`proposed_tasks[${index}].title musí být neprázdný string`,
			);
			pushIf(
				failures,
				path,
				!isNonEmptyString(task.summary),
				`proposed_tasks[${index}].summary musí být neprázdný string`,
			);
			pushIf(
				failures,
				path,
				task.priority !== undefined && !PLAN_PRIORITIES.includes(task.priority),
				`proposed_tasks[${index}].priority musí být jedna z: ${PLAN_PRIORITIES.join(', ')}`,
			);
			validateStringArray(failures, path, task.tags, `proposed_tasks[${index}].tags`);
			validateStringArray(
				failures,
				path,
				task.acceptance_criteria,
				`proposed_tasks[${index}].acceptance_criteria`,
			);
			validateStringArray(failures, path, task.risk_notes, `proposed_tasks[${index}].risk_notes`);
		});
	}

	if (plan.links !== undefined) {
		if (!Array.isArray(plan.links)) {
			failures.push(`${path}: links musí být pole`);
		} else {
			plan.links.forEach((link: ParsedData, index: number) => {
				if (!link || typeof link !== 'object' || Array.isArray(link)) {
					failures.push(`${path}: links[${index}] musí být objekt`);
					return;
				}
				validateKnownKeys(failures, path, link, ['label', 'path', 'url'], `links[${index}]`);
				pushIf(
					failures,
					path,
					!isNonEmptyString(link.label),
					`links[${index}].label musí být neprázdný string`,
				);
				pushIf(
					failures,
					path,
					!isNonEmptyString(link.path) && !isNonEmptyString(link.url),
					`links[${index}] musí mít path nebo url`,
				);
			});
		}
	}

	validatePlaceholders(failures, path, plan);
	return failures;
}

function roadmapAllowedKeys(): string[] {
	return [
		'schema_version',
		'id',
		'roadmap_code',
		'title',
		'status',
		'owner',
		'priority',
		'created_at',
		'updated_at',
		'source_plan',
		'summary',
		'agent_lane',
		'priorities',
		'steps',
		'links',
	];
}

function collectExistingPlanCodes(planRecords: RootPlanRecord[]): Set<string> {
	const codes = new Set<string>();
	for (const { plan } of planRecords) {
		if (isNonEmptyString(plan?.dev_code)) {
			codes.add(plan.dev_code);
		}
	}
	return codes;
}

function collectIdsFromLedger(
	root: string,
	ledgerPathValue: string,
	collectionKey: string,
	ids: Set<string>,
	failures: string[],
): void {
	const ledgerPath = join(root, ledgerPathValue);
	if (!existsSync(ledgerPath)) {
		return;
	}
	let data: ParsedData;
	try {
		data = JSON.parse(readFileSync(ledgerPath, 'utf8'));
	} catch (error) {
		failures.push(`${ledgerPathValue}: JSON parse selhal: ${(error as Error).message}`);
		return;
	}
	const rows = Array.isArray(data) ? data : data[collectionKey];
	if (!Array.isArray(rows)) {
		failures.push(`${ledgerPathValue}: ${collectionKey} musí být pole`);
		return;
	}
	for (const item of rows) {
		if (isNonEmptyString(item?.id)) {
			ids.add(item.id);
		}
	}
}

function collectRoadmapReferenceIds(
	root: string,
	config: Record<string, any> = {},
): RoadmapLedgerReferenceIds {
	const failures: string[] = [];
	const taskIds = new Set<string>();
	const issueIds = new Set<string>();
	collectIdsFromLedger(
		root,
		config.todo_tasks_path ?? 'TODO.tasks.json',
		'tasks',
		taskIds,
		failures,
	);
	collectIdsFromLedger(
		root,
		config.done_tasks_path ?? 'DONE.tasks.json',
		'tasks',
		taskIds,
		failures,
	);
	collectIdsFromLedger(
		root,
		config.issues_open_path ?? 'ISSUES.open.json',
		'issues',
		issueIds,
		failures,
	);
	collectIdsFromLedger(
		root,
		config.issues_resolved_path ?? 'ISSUES.resolved.json',
		'issues',
		issueIds,
		failures,
	);
	return { taskIds, issueIds, failures };
}

function validateRoadmapPriority(
	failures: string[],
	path: string,
	priority: ParsedData,
	index: number,
): void {
	if (!priority || typeof priority !== 'object' || Array.isArray(priority)) {
		failures.push(`${path}: priorities[${index}] musí být objekt`);
		return;
	}
	validateKnownKeys(
		failures,
		path,
		priority,
		['id', 'title', 'rank', 'rationale'],
		`priorities[${index}]`,
	);
	pushIf(
		failures,
		path,
		!isNonEmptyString(priority.id) || !ROADMAP_PRIORITY_ID_PATTERN.test(priority.id),
		`priorities[${index}].id musí mít tvar priority-001`,
	);
	pushIf(
		failures,
		path,
		!isNonEmptyString(priority.title),
		`priorities[${index}].title musí být neprázdný string`,
	);
	pushIf(
		failures,
		path,
		!Number.isInteger(priority.rank) || priority.rank < 1,
		`priorities[${index}].rank musí být celé číslo >= 1`,
	);
	pushIf(
		failures,
		path,
		priority.rationale !== undefined && typeof priority.rationale !== 'string',
		`priorities[${index}].rationale musí být string`,
	);
}

function validateRoadmapStep(
	failures: string[],
	path: string,
	step: ParsedData,
	index: number,
	referenceIds: RoadmapStepReferenceIds,
): void {
	if (!step || typeof step !== 'object' || Array.isArray(step)) {
		failures.push(`${path}: steps[${index}] musí být objekt`);
		return;
	}
	const { existingPlanCodes, existingPriorityIds, existingTaskIds, existingIssueIds } =
		referenceIds;
	validateKnownKeys(
		failures,
		path,
		step,
		[
			'id',
			'title',
			'status',
			'executable',
			'priority_refs',
			'plan_refs',
			'todo_refs',
			'issue_refs',
			'evidence_refs',
			'acceptance_criteria',
			'notes',
		],
		`steps[${index}]`,
	);
	pushIf(
		failures,
		path,
		!isNonEmptyString(step.id) || !ROADMAP_STEP_ID_PATTERN.test(step.id),
		`steps[${index}].id musí mít tvar step-001`,
	);
	pushIf(
		failures,
		path,
		!isNonEmptyString(step.title),
		`steps[${index}].title musí být neprázdný string`,
	);
	pushIf(
		failures,
		path,
		!PLAN_STATUSES.includes(step.status),
		`steps[${index}].status musí být jeden z: ${PLAN_STATUSES.join(', ')}`,
	);
	pushIf(
		failures,
		path,
		typeof step.executable !== 'boolean',
		`steps[${index}].executable musí být boolean`,
	);

	validateStringArray(failures, path, step.priority_refs, `steps[${index}].priority_refs`);
	if (Array.isArray(step.priority_refs)) {
		pushIf(
			failures,
			path,
			step.priority_refs.length === 0,
			`steps[${index}].priority_refs musí být neprázdné pole`,
		);
		step.priority_refs.forEach((priorityRef: ParsedData, priorityIndex: number) => {
			if (!isNonEmptyString(priorityRef)) {
				return;
			}
			if (!ROADMAP_PRIORITY_ID_PATTERN.test(priorityRef)) {
				failures.push(
					`${path}: steps[${index}].priority_refs[${priorityIndex}] musí mít tvar priority-001`,
				);
			} else if (!existingPriorityIds.has(priorityRef)) {
				failures.push(
					`${path}: steps[${index}].priority_refs[${priorityIndex}] odkazuje na neexistující prioritu ${priorityRef}`,
				);
			}
		});
	}

	validateStringArray(failures, path, step.plan_refs, `steps[${index}].plan_refs`);
	validateStringArray(failures, path, step.todo_refs, `steps[${index}].todo_refs`);
	validateStringArray(failures, path, step.issue_refs, `steps[${index}].issue_refs`);
	const hasEvidenceRef = validateRoadmapEvidenceRefs(
		failures,
		path,
		step.evidence_refs,
		`steps[${index}].evidence_refs`,
		index,
		referenceIds.root,
	);
	validateStringArray(
		failures,
		path,
		step.acceptance_criteria,
		`steps[${index}].acceptance_criteria`,
	);
	pushIf(
		failures,
		path,
		step.notes !== undefined && typeof step.notes !== 'string',
		`steps[${index}].notes musí být string`,
	);
	pushIf(
		failures,
		path,
		step.status === 'done' && !hasEvidenceRef,
		`steps[${index}] status=done vyžaduje aspoň jeden evidence_refs záznam`,
	);

	const hasTraceablePlanRef = validateRoadmapRefs(
		failures,
		path,
		step.plan_refs,
		`steps[${index}].plan_refs`,
		existingPlanCodes,
		/^([A-Z]{2,6})-[0-9]{4}$/,
		'plán',
		'musí mít tvar DEV-0001',
	);
	const hasTraceableTaskRef = validateRoadmapRefs(
		failures,
		path,
		step.todo_refs,
		`steps[${index}].todo_refs`,
		existingTaskIds,
		TASK_ID_PATTERN,
		'task',
		'musí mít tvar task-YYYY-MM-DD-NNN',
	);
	const hasTraceableIssueRef = validateRoadmapRefs(
		failures,
		path,
		step.issue_refs,
		`steps[${index}].issue_refs`,
		existingIssueIds,
		ISSUE_ID_PATTERN,
		'issue',
		'musí mít tvar issue-YYYY-MM-DD-NNN',
	);

	if (
		step.executable === true &&
		!hasTraceablePlanRef &&
		!hasTraceableTaskRef &&
		!hasTraceableIssueRef
	) {
		failures.push(
			`${path}: steps[${index}] executable=true vyžaduje aspoň jeden dohledatelný plan_refs, todo_refs nebo issue_refs odkaz`,
		);
	}
}

function validateRoadmapAgentLane(failures: string[], path: string, agentLane: ParsedData): void {
	if (agentLane === undefined) {
		return;
	}
	if (!agentLane || typeof agentLane !== 'object' || Array.isArray(agentLane)) {
		failures.push(`${path}: agent_lane musí být objekt`);
		return;
	}
	validateKnownKeys(
		failures,
		path,
		agentLane,
		['reviewers', 'execution_agents', 'escalation_policy'],
		'agent_lane',
	);
	validateStringArray(failures, path, agentLane.reviewers, 'agent_lane.reviewers', {
		minItems: 1,
	});
	validateStringArray(failures, path, agentLane.execution_agents, 'agent_lane.execution_agents', {
		minItems: 1,
	});
	pushIf(
		failures,
		path,
		!isNonEmptyString(agentLane.escalation_policy),
		'agent_lane.escalation_policy musí být neprázdný string',
	);
}

function validateRoadmapEvidenceRefs(
	failures: string[],
	path: string,
	refs: unknown,
	label: string,
	_stepIndex: number,
	root: string,
): boolean {
	if (refs === undefined) {
		return false;
	}
	if (!Array.isArray(refs)) {
		failures.push(`${path}: ${label} musí být pole`);
		return false;
	}
	if (refs.length === 0) {
		failures.push(`${path}: ${label} musí být neprázdné pole`);
		return false;
	}

	let hasEvidenceRef = false;
	refs.forEach((evidence, evidenceIndex) => {
		const evidenceLabel = `${label}[${evidenceIndex}]`;
		if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
			failures.push(`${path}: ${evidenceLabel} musí být objekt`);
			return;
		}
		validateKnownKeys(
			failures,
			path,
			evidence,
			['label', 'kind', 'path', 'url', 'verification'],
			evidenceLabel,
		);
		pushIf(
			failures,
			path,
			!isNonEmptyString(evidence.label),
			`${evidenceLabel}.label musí být neprázdný string`,
		);
		pushIf(
			failures,
			path,
			!ROADMAP_EVIDENCE_KINDS.includes(evidence.kind),
			`${evidenceLabel}.kind musí být jedna z: ${ROADMAP_EVIDENCE_KINDS.join(', ')}`,
		);

		const hasPath = isNonEmptyString(evidence.path);
		const hasUrl = isNonEmptyString(evidence.url);
		pushIf(failures, path, !hasPath && !hasUrl, `${evidenceLabel} musí mít path nebo url`);
		pushIf(failures, path, hasPath && hasUrl, `${evidenceLabel} nesmí kombinovat path a url`);

		if (hasPath) {
			const evidencePath = evidence.path;
			const resolvedEvidencePath = isSafePortableRoadmapPath(evidencePath)
				? resolveRepoRelativePath(root, evidencePath)
				: null;
			if (!resolvedEvidencePath) {
				failures.push(`${path}: ${evidenceLabel}.path musí být relativní cesta uvnitř repa`);
			} else if (!existsSync(resolvedEvidencePath)) {
				failures.push(`${path}: ${evidenceLabel}.path neexistuje: ${evidencePath}`);
			} else if (!lstatSync(resolvedEvidencePath).isFile()) {
				failures.push(`${path}: ${evidenceLabel}.path musí být soubor: ${evidencePath}`);
			} else if (!isWithinDirectory(realpathSync(resolvedEvidencePath), realpathSync(root))) {
				failures.push(`${path}: ${evidenceLabel}.path musí být relativní cesta uvnitř repa`);
			} else if (!isGitTrackedPath(root, evidencePath)) {
				failures.push(
					`${path}: ${evidenceLabel}.path musí být git-tracked repo soubor nebo staged repo soubor: ${evidencePath}`,
				);
			} else {
				hasEvidenceRef = true;
			}
		}

		if (hasUrl) {
			if (evidence.verification !== 'external') {
				failures.push(
					`${path}: ${evidenceLabel}.url vyžaduje verification: external, protože URL nejde ověřit lokálním repo validátorem`,
				);
			} else if (!isExternalHttpUrl(evidence.url)) {
				failures.push(`${path}: ${evidenceLabel}.url musí být credential-free externí http(s) URL`);
			} else {
				hasEvidenceRef = true;
			}
		}

		pushIf(
			failures,
			path,
			evidence.verification !== undefined && evidence.verification !== 'external',
			`${evidenceLabel}.verification musí být external`,
		);
	});

	return hasEvidenceRef;
}

function validateRoadmapRefs(
	failures: string[],
	path: string,
	refs: unknown,
	label: string,
	existingIds: Set<string>,
	pattern: RegExp,
	noun: string,
	shapeMessage: string,
): boolean {
	if (!Array.isArray(refs)) {
		return false;
	}
	let hasExistingRef = false;
	refs.forEach((ref, refIndex) => {
		if (!isNonEmptyString(ref)) {
			return;
		}
		if (!pattern.test(ref)) {
			failures.push(`${path}: ${label}[${refIndex}] ${shapeMessage}`);
		} else if (!existingIds.has(ref)) {
			failures.push(`${path}: ${label}[${refIndex}] odkazuje na neexistující ${noun} ${ref}`);
		} else {
			hasExistingRef = true;
		}
	});
	return hasExistingRef;
}

export function validateRoadmapShape(
	record: RootRoadmapRecord,
	_config: RootMissionControlConfig,
	root: string,
	schema: ParsedData,
	planRecords: RootPlanRecord[],
	ledgerReferenceIds: RoadmapLedgerReferenceIds,
): string[] {
	const failures: string[] = [];
	const { path, filePath, roadmap, parseError } = record;

	if (parseError) {
		return [`${path}: ${parseError}`];
	}
	if (!roadmap || typeof roadmap !== 'object' || Array.isArray(roadmap)) {
		return [`${path}: roadmapa musí být YAML objekt`];
	}

	validateNoUnquotedHashScalars(failures, path, record.source, ['label']);

	const existingPlanCodes = collectExistingPlanCodes(planRecords);
	if (
		!validateJsonSchema(failures, path, roadmap, schema, {
			compileLabel: 'schéma roadmapy',
			errorLabel: 'roadmap schema',
		})
	) {
		return failures;
	}
	const schemaKeys = schemaPropertyKeys(schema) ?? [];
	validateKnownKeys(
		failures,
		path,
		roadmap,
		schemaKeys.length > 0 ? schemaKeys : roadmapAllowedKeys(),
		'roadmapa',
	);
	pushIf(
		failures,
		path,
		roadmap.schema_version !== ROADMAP_SCHEMA_VERSION,
		`schema_version musí být ${ROADMAP_SCHEMA_VERSION}`,
	);
	pushIf(
		failures,
		path,
		!isNonEmptyString(roadmap.roadmap_code) || !ROADMAP_CODE_PATTERN.test(roadmap.roadmap_code),
		'roadmap_code musí mít tvar RM-XXXX',
	);
	pushIf(
		failures,
		path,
		!isNonEmptyString(roadmap.id) || !ROADMAP_ID_PATTERN.test(roadmap.id),
		'id musí mít tvar mcroadmap-rm-XXXX',
	);
	if (isNonEmptyString(roadmap.roadmap_code) && isNonEmptyString(roadmap.id)) {
		pushIf(
			failures,
			path,
			roadmap.id !== `mcroadmap-${roadmap.roadmap_code.toLowerCase()}`,
			'id musí odpovídat roadmap_code (mcroadmap-<lowercase roadmap_code>)',
		);
	}
	if (isNonEmptyString(roadmap.roadmap_code)) {
		pushIf(
			failures,
			path,
			!basename(filePath).startsWith(`${roadmap.roadmap_code}-`),
			`název souboru musí začínat ${roadmap.roadmap_code}-`,
		);
	}
	pushIf(failures, path, !isNonEmptyString(roadmap.title), 'chybí title');
	pushIf(
		failures,
		path,
		!PLAN_STATUSES.includes(roadmap.status),
		`status musí být jeden z: ${PLAN_STATUSES.join(', ')}`,
	);
	pushIf(failures, path, !isNonEmptyString(roadmap.owner), 'chybí owner');
	pushIf(
		failures,
		path,
		!PLAN_PRIORITIES.includes(roadmap.priority),
		`priority musí být jedna z: ${PLAN_PRIORITIES.join(', ')}`,
	);
	for (const field of ['created_at', 'updated_at']) {
		pushIf(
			failures,
			path,
			!isValidDate(roadmap[field]),
			`${field} musí být reálné datum YYYY-MM-DD`,
		);
	}
	pushIf(failures, path, !isNonEmptyString(roadmap.summary), 'chybí summary');
	validateRoadmapAgentLane(failures, path, roadmap.agent_lane);
	pushIf(failures, path, !isNonEmptyString(roadmap.source_plan), 'chybí source_plan');
	if (isNonEmptyString(roadmap.source_plan) && !existingPlanCodes.has(roadmap.source_plan)) {
		failures.push(`${path}: source_plan odkazuje na neexistující plán ${roadmap.source_plan}`);
	}

	if (!Array.isArray(roadmap.priorities) || roadmap.priorities.length === 0) {
		failures.push(`${path}: priorities musí být neprázdné pole`);
	} else {
		const seenPriorityIds = new Set();
		roadmap.priorities.forEach((priority: ParsedData, index: number) => {
			validateRoadmapPriority(failures, path, priority, index);
			if (isNonEmptyString(priority?.id)) {
				if (seenPriorityIds.has(priority.id)) {
					failures.push(`${path}: duplicitní priorities[${index}].id ${priority.id}`);
				}
				seenPriorityIds.add(priority.id);
			}
		});
	}

	const existingPriorityIds = new Set(
		Array.isArray(roadmap.priorities)
			? roadmap.priorities
					.map((priority: ParsedData) => priority?.id)
					.filter((id: ParsedData) => isNonEmptyString(id))
			: [],
	);

	if (!Array.isArray(roadmap.steps) || roadmap.steps.length === 0) {
		failures.push(`${path}: steps musí být neprázdné pole`);
	} else {
		const seenStepIds = new Set();
		roadmap.steps.forEach((step: ParsedData, index: number) => {
			validateRoadmapStep(failures, path, step, index, {
				existingPlanCodes,
				existingPriorityIds,
				existingTaskIds: ledgerReferenceIds.taskIds,
				existingIssueIds: ledgerReferenceIds.issueIds,
				root,
			});
			if (isNonEmptyString(step?.id)) {
				if (seenStepIds.has(step.id)) {
					failures.push(`${path}: duplicitní steps[${index}].id ${step.id}`);
				}
				seenStepIds.add(step.id);
			}
		});
	}

	if (roadmap.links !== undefined) {
		if (!Array.isArray(roadmap.links)) {
			failures.push(`${path}: links musí být pole`);
		} else {
			roadmap.links.forEach((link: ParsedData, index: number) => {
				if (!link || typeof link !== 'object' || Array.isArray(link)) {
					failures.push(`${path}: links[${index}] musí být objekt`);
					return;
				}
				validateKnownKeys(failures, path, link, ['label', 'path', 'url'], `links[${index}]`);
				pushIf(
					failures,
					path,
					!isNonEmptyString(link.label),
					`links[${index}].label musí být neprázdný string`,
				);
				pushIf(
					failures,
					path,
					!isNonEmptyString(link.path) && !isNonEmptyString(link.url),
					`links[${index}] musí mít path nebo url`,
				);
				if (isNonEmptyString(link.path) && !isPortableRoadmapLinkPath(root, link.path)) {
					failures.push(
						`${path}: links[${index}].path musí být portable repo-relative cesta uvnitř data repozitáře`,
					);
				}
				if (isNonEmptyString(link.url) && !isExternalHttpUrl(link.url)) {
					failures.push(
						`${path}: links[${index}].url musí být credential-free externí http(s) URL`,
					);
				}
			});
		}
	}

	return failures;
}

export function validateRoadmapRecords(
	records: RootRoadmapRecord[],
	config: RootMissionControlConfig,
	root: string,
	planRecords: RootPlanRecord[] = [],
): string[] {
	gitTrackedPathCache.clear();
	const schema = loadRoadmapSchema(root, config);
	const ledgerReferenceIds = collectRoadmapReferenceIds(root, config);
	const failures = [...ledgerReferenceIds.failures];
	for (const record of records) {
		failures.push(
			...validateRoadmapShape(record, config, root, schema, planRecords, ledgerReferenceIds),
		);
	}
	const seenIds = new Map();
	const seenCodes = new Map();
	for (const { path, roadmap } of records) {
		if (!roadmap || typeof roadmap !== 'object') {
			continue;
		}
		if (isNonEmptyString(roadmap.id)) {
			if (seenIds.has(roadmap.id)) {
				failures.push(`${path}: duplicitní id ${roadmap.id} (poprvé v ${seenIds.get(roadmap.id)})`);
			} else {
				seenIds.set(roadmap.id, path);
			}
		}
		if (isNonEmptyString(roadmap.roadmap_code)) {
			if (seenCodes.has(roadmap.roadmap_code)) {
				failures.push(
					`${path}: duplicitní roadmap_code ${roadmap.roadmap_code} (poprvé v ${seenCodes.get(roadmap.roadmap_code)})`,
				);
			} else {
				seenCodes.set(roadmap.roadmap_code, path);
			}
		}
	}
	return failures;
}

function isTransitionCompatibilityMode(
	config: RootMissionControlConfig | null | undefined,
): boolean {
	return config?.data_boundary?.mode === 'org-local-v3-pilot';
}

function suppressTransitionLegacyPlanFailure(
	failure: string,
	config: RootMissionControlConfig,
): boolean {
	if (!isTransitionCompatibilityMode(config)) return false;
	if (failure.includes('nequoted #')) return true;
	if (failure.includes('links[') && failure.includes('musí mít path nebo url')) return true;
	if (failure.includes('proposed_tasks[') && failure.includes('obsahuje neznámá pole:')) {
		return /priority_reason|blocked_by/.test(failure);
	}
	return false;
}

export function validatePlanRecords(
	records: RootPlanRecord[],
	config: RootMissionControlConfig,
	root: string,
	workspaceRoot: string | null = process.env.MISSION_CONTROL_WORKSPACE_ROOT ?? null,
): string[] {
	const schema = loadPlanSchema(root, config);
	const failures: string[] = [];
	for (const record of records) {
		failures.push(...validatePlanShape(record, config, root, schema, workspaceRoot));
	}
	const seenIds = new Map();
	const seenDevCodes = new Map();
	for (const { path, plan } of records) {
		if (!plan || typeof plan !== 'object') {
			continue;
		}
		if (isNonEmptyString(plan.id)) {
			if (seenIds.has(plan.id)) {
				failures.push(`${path}: duplicitní id ${plan.id} (poprvé v ${seenIds.get(plan.id)})`);
			} else {
				seenIds.set(plan.id, path);
			}
		}
		if (isNonEmptyString(plan.dev_code)) {
			if (seenDevCodes.has(plan.dev_code)) {
				failures.push(
					`${path}: duplicitní dev_code ${plan.dev_code} (poprvé v ${seenDevCodes.get(plan.dev_code)})`,
				);
			} else {
				seenDevCodes.set(plan.dev_code, path);
			}
		}
	}
	return failures.filter((failure) => !suppressTransitionLegacyPlanFailure(failure, config));
}

function collectReservedNumbers(value: unknown, prefix: string, reserved: Set<number>): void {
	if (typeof value === 'string') {
		const pattern = new RegExp(`\\b${prefix}-([0-9]{4})\\b`, 'g');
		for (const match of value.matchAll(pattern)) {
			reserved.add(Number(match[1]));
		}
		return;
	}
	if (Array.isArray(value)) {
		for (const item of value) {
			collectReservedNumbers(item, prefix, reserved);
		}
		return;
	}
	if (value && typeof value === 'object') {
		for (const item of Object.values(value)) {
			collectReservedNumbers(item, prefix, reserved);
		}
	}
}

export function nextDevCode(root: string, config: RootMissionControlConfig): string {
	const reserved = new Set<number>();
	for (const { path, plan, parseError } of loadPlans(root, config)) {
		if (parseError) {
			throw new Error(`${path}: ${parseError} — oprav YAML, než si vezmeš další kód`);
		}
		collectReservedNumbers(plan, config.plan_prefix, reserved);
	}
	for (const ledgerName of ['TODO.tasks.json', 'DONE.tasks.json', 'ISSUES.open.json']) {
		const ledgerPath = join(root, ledgerName);
		if (existsSync(ledgerPath)) {
			collectReservedNumbers(
				JSON.parse(readFileSync(ledgerPath, 'utf8')),
				config.plan_prefix,
				reserved,
			);
		}
	}
	let max = 0;
	for (const number of reserved) {
		if (number > max) {
			max = number;
		}
	}
	if (max >= 9999) {
		throw new Error(
			`prefix ${config.plan_prefix} vyčerpal 4místná čísla; rozhodni o rozšíření formátu`,
		);
	}
	return `${config.plan_prefix}-${String(max + 1).padStart(4, '0')}`;
}

export function buildRoadmapExecutionReport({
	roadmapRecords,
	validationFailures = [],
	roadmapCode,
	issueRecords = [],
}: BuildRoadmapExecutionReportOptions = {}): RootRoadmapExecutionReport {
	const records = Array.isArray(roadmapRecords) ? roadmapRecords : [];
	const selectedRecord = roadmapCode
		? records.find((record) => record.roadmap?.roadmap_code === roadmapCode)
		: (records.find((record) => record.roadmap?.status === 'in_progress') ?? records[0]);

	if (!selectedRecord?.roadmap) {
		const missingFailure = roadmapCode
			? `roadmap ${roadmapCode} nebyla nalezena`
			: 'Nebyla nalezena žádná roadmapa.';
		const failures = [...validationFailures, missingFailure];
		return {
			dry_run: true,
			roadmap: null,
			validation: { ok: false, failures },
			next_step: null,
			issue_blockers: [],
			blockers: [missingFailure],
			actions: [],
		};
	}

	const roadmap = selectedRecord.roadmap;
	const steps = Array.isArray(roadmap.steps) ? roadmap.steps : [];
	const validationOk = validationFailures.length === 0;
	const blockedSteps = steps.filter(
		(step: ParsedData) => step?.executable === true && step.status === 'blocked',
	);
	const blockers = validationOk ? [] : ['Mission Control validace není zelená.'];
	for (const blockedStep of blockedSteps) {
		blockers.push(`Roadmap Step ${blockedStep.id} je blocked: ${blockedStep.title}`);
	}
	const candidateStep =
		blockers.length > 0
			? null
			: (steps.find(
					(step: ParsedData) => step?.executable === true && step.status === 'in_progress',
				) ??
				steps.find((step: ParsedData) => step?.executable === true && step.status === 'ready'));
	const issueBlockers = candidateStep ? buildRoadmapIssueBlockers(candidateStep, issueRecords) : [];
	for (const issueBlocker of issueBlockers) {
		blockers.push(formatRoadmapIssueBlocker(issueBlocker));
	}
	const nextStep = issueBlockers.length > 0 ? null : candidateStep;
	const actions: string[] = [];
	if (!validationOk) {
		actions.push('Opravit Mission Control validaci před pokračováním.');
	}
	if (blockedSteps.length > 0) {
		actions.push('Vyřešit blokované Roadmap Steps před pokračováním.');
	}
	if (issueBlockers.length > 0) {
		actions.push('Vyřešit otevřené issue refs před pokračováním.');
	}
	if (nextStep) {
		actions.push(`Pokračovat na ${nextStep.id}: ${nextStep.title}`);
	}
	actions.push('Dry-run nic nezapsal do workspace.');

	return {
		dry_run: true,
		roadmap: {
			path: selectedRecord.path,
			roadmap_code: roadmap.roadmap_code,
			title: roadmap.title,
			status: roadmap.status,
			owner: roadmap.owner,
		},
		validation: { ok: validationFailures.length === 0, failures: validationFailures },
		next_step: nextStep
			? {
					id: nextStep.id,
					title: nextStep.title,
					status: nextStep.status,
					agent_routing: roadmap.owner,
					plan_refs: asArray(nextStep.plan_refs),
					todo_refs: asArray(nextStep.todo_refs),
					issue_refs: asArray(nextStep.issue_refs),
					evidence_refs: asArray(nextStep.evidence_refs),
					acceptance_criteria: asArray(nextStep.acceptance_criteria),
				}
			: null,
		issue_blockers: issueBlockers,
		blockers,
		actions,
	};
}

function buildRoadmapIssueBlockers(
	step: ParsedData,
	issueRecords: unknown,
): RootRoadmapIssueBlocker[] {
	const openIssuesById = new Map();
	for (const issue of Array.isArray(issueRecords) ? issueRecords : []) {
		if (!isNonEmptyString(issue?.id)) {
			continue;
		}
		if (!openIssuesById.has(issue.id)) {
			openIssuesById.set(issue.id, issue);
		}
	}
	return asArray(step.issue_refs)
		.map((issueId) => openIssuesById.get(issueId))
		.filter(Boolean)
		.map((issue) => ({
			step_id: step.id,
			step_title: step.title,
			issue_id: issue.id,
			title: issue.title ?? '<bez názvu>',
			status: issue.status ?? 'open',
			severity: issue.severity ?? 'unknown',
			owner: issue.owner ?? 'unknown',
			file: issue.file ?? 'ISSUES.open.json',
		}));
}

function formatRoadmapIssueBlocker(issueBlocker: RootRoadmapIssueBlocker): string {
	return `Roadmap Step ${issueBlocker.step_id} čeká na issue ${issueBlocker.issue_id}: ${issueBlocker.title} (owner: ${issueBlocker.owner}, severity: ${issueBlocker.severity}, source: ${issueBlocker.file})`;
}

export function formatRoadmapExecutionReport(report: RootRoadmapExecutionReport): string {
	const lines = ['Mission Control roadmap loop (dry-run)'];
	if (!report.roadmap) {
		lines.push('Roadmap: nenalezena');
	} else {
		lines.push(`Roadmap: ${report.roadmap.roadmap_code} — ${report.roadmap.title}`);
		lines.push(`Stav: ${report.roadmap.status}`);
		lines.push(`Routování ownera: ${report.roadmap.owner}`);
	}
	lines.push(`Validace: ${report.validation.ok ? 'OK' : 'FAIL'}`);
	if (report.next_step) {
		lines.push(`Další krok: ${report.next_step.id} — ${report.next_step.title}`);
		lines.push(`Stav kroku: ${report.next_step.status}`);
		lines.push(`Routování agenta: ${report.next_step.agent_routing}`);
		if (report.next_step.plan_refs.length > 0) {
			lines.push(`Plan refs: ${report.next_step.plan_refs.join(', ')}`);
		}
		if (report.next_step.todo_refs.length > 0) {
			lines.push(`TODO refs: ${report.next_step.todo_refs.join(', ')}`);
		}
		if (report.next_step.issue_refs.length > 0) {
			lines.push(`Issue refs: ${report.next_step.issue_refs.join(', ')}`);
		}
		if (report.next_step.evidence_refs.length > 0) {
			const evidenceLabels = report.next_step.evidence_refs
				.map((evidence) => (evidence && typeof evidence === 'object' ? evidence.label : undefined))
				.filter((label) => typeof label === 'string' && label.length > 0);
			if (evidenceLabels.length > 0) {
				lines.push(`Evidence refs: ${evidenceLabels.join(', ')}`);
			}
		}
	} else if (report.blockers.length > 0) {
		lines.push('Další krok: routování zastaveno blokery/validací');
	} else {
		lines.push('Další krok: žádný executable step není ready/in_progress');
	}
	if (report.issue_blockers?.length > 0) {
		lines.push('Issue blockers:');
		for (const issueBlocker of report.issue_blockers) {
			lines.push(`- ${formatRoadmapIssueBlocker(issueBlocker)}`);
		}
	}
	if (report.blockers.length > 0) {
		lines.push('Blokery:');
		for (const blocker of report.blockers) lines.push(`- ${blocker}`);
	}
	lines.push('Dry-run: workspace nebyl změněn.');
	return lines.join('\n');
}

function formatStatusSummary(records: Array<Record<string, any>>, fieldName: string): string {
	const byStatus = new Map();
	for (const record of records) {
		const item = record[fieldName];
		if (item?.status) {
			byStatus.set(item.status, (byStatus.get(item.status) ?? 0) + 1);
		}
	}
	return [...byStatus.entries()].map(([status, count]) => `${status}=${count}`).join(', ');
}

export function formatPlansSummary(records: RootPlanRecord[]): string {
	const statusSummary = formatStatusSummary(records, 'plan');
	return `Mission Control plány v pořádku: ${records.length} plánů${
		statusSummary ? ` (${statusSummary})` : ''
	}`;
}

export function formatRoadmapsSummary(records: RootRoadmapRecord[]): string {
	const statusSummary = formatStatusSummary(records, 'roadmap');
	return `${records.length} roadmap${statusSummary ? ` (${statusSummary})` : ''}`;
}

export function formatMissionControlSummary({ plans, roadmaps }: SummaryInput): string {
	const planStatusSummary = formatStatusSummary(plans, 'plan');
	const roadmapSummary = formatRoadmapsSummary(roadmaps);
	return `Mission Control v pořádku: ${plans.length} plánů${
		planStatusSummary ? ` (${planStatusSummary})` : ''
	}; ${roadmapSummary}`;
}
