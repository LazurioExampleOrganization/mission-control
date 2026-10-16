import { spawnSync } from 'node:child_process';
import { type Dirent, existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const AGENTS_BLOG_SCHEMA_VERSION = 'companiesascode.agents_blog.v1';
export const AGENT_LEDGER_SCHEMA_VERSION = 'companiesascode.agent_ledgers.v1';

export type AgentLedgerKind = 'blog' | 'todo' | 'done' | 'issues';
export type WorkLedgerFileKind = Exclude<AgentLedgerKind, 'blog'>;
export type ModuleSlotState = 'available' | 'missing_access' | 'planned_slot';
export type AgentLedgerScopeState = ModuleSlotState | 'unknown';

export type AgentLedgerScope = {
	id: string;
	name: string;
	path: string;
	owner: string | null;
	state: AgentLedgerScopeState;
	ledgerFiles: number;
};

export type AgentLedgerLink = {
	label: string;
	path: string | null;
	url: string | null;
};

export type AgentLedgerInvalidFile = {
	path: string;
	kind: AgentLedgerKind;
	errors: string[];
};

export type AgentBlogEntry = {
	id: string;
	title: string;
	createdAt: string;
	updatedAt: string | null;
	agent: string | null;
	scope: AgentLedgerScope;
	sourceTaskId: string | null;
	sourceCustomId: string | null;
	sourceUrl: string | null;
	insightType: string;
	visibilityHint: string;
	contentPotential: string;
	tags: string[];
	summary: string;
	details: string | null;
	links: AgentLedgerLink[];
	filePath: string;
};

export type AgentBlogFile = {
	path: string;
	scope: AgentLedgerScope;
	entries: number;
	invalidEntries: number;
	errors: string[];
};

export type AgentWorkLedgerItemKind = 'todo' | 'done' | 'issue';

export type AgentWorkLedgerItem = {
	id: string;
	kind: AgentWorkLedgerItemKind;
	title: string;
	status: string;
	priority: string | null;
	severity: string | null;
	scope: AgentLedgerScope;
	tags: string[];
	summary: string;
	createdAt: string | null;
	updatedAt: string | null;
	completedAt: string | null;
	links: AgentLedgerLink[];
	filePath: string;
};

export type AgentWorkLedgerFile = {
	path: string;
	kind: 'todo' | 'done' | 'issues';
	scope: AgentLedgerScope;
	items: number;
	invalidItems: number;
	errors: string[];
};

export type AgentLedgerScan = {
	schemaVersion: typeof AGENT_LEDGER_SCHEMA_VERSION;
	workspaceRoot: string;
	scannedAt: string;
	scopes: AgentLedgerScope[];
	invalidFiles: AgentLedgerInvalidFile[];
	blog: {
		schemaVersion: typeof AGENTS_BLOG_SCHEMA_VERSION;
		summary: {
			files: number;
			entries: number;
			invalidFiles: number;
			invalidEntries: number;
		};
		files: AgentBlogFile[];
		entries: AgentBlogEntry[];
	};
	work: {
		summary: {
			files: number;
			todo: number;
			issues: number;
			done: number;
			invalidFiles: number;
			invalidItems: number;
			missingAccessScopes: number;
			plannedScopes: number;
		};
		files: AgentWorkLedgerFile[];
		items: AgentWorkLedgerItem[];
	};
};

export type ScanAgentLedgersOptions = {
	ledgerFiles?: readonly string[];
	workLedgerFiles?: readonly string[];
	rootWorkLedgerFiles?: readonly string[];
};

type JsonRecord = Record<string, unknown>;

type WorkspaceModulesManifest = {
	module_slots?: Array<{
		path?: unknown;
		required_roles?: unknown;
		git?: {
			url?: unknown;
			branch?: unknown;
		};
	}>;
};

const AGENT_LEDGER_FILE_NAMES = new Set([
	'BLOG.agents.json',
	'TODO.tasks.json',
	'DONE.tasks.json',
	'ISSUES.open.json',
	// Parita s work-boardem a src/paths.ts LEDGER_FILE_NAMES: resolved issues
	// jsou auditní archiv rozhodnutí a /api/agent-work je musí vidět taky.
	'ISSUES.resolved.json',
]);

const SKIPPED_DIR_NAMES = new Set([
	'.git',
	'.claude',
	'.codex-tmp',
	'.next',
	'.pr-worktrees',
	'.turbo',
	'.venv',
	'.vite',
	'.worktrees',
	'build',
	'coverage',
	'dist',
	'node_modules',
	'target',
]);

const MAX_LEDGER_SCAN_DEPTH = 7;

function isSkippedDirName(name: string): boolean {
	return SKIPPED_DIR_NAMES.has(name) || name.endsWith('-worktrees');
}

function toWorkspacePath(workspaceRoot: string, absolutePath: string): string {
	const relativePath = path.relative(workspaceRoot, absolutePath);
	return relativePath ? relativePath.split(path.sep).join('/') : '.';
}

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(record: JsonRecord, field: string): string | null {
	const value = record[field];
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function stringArrayField(record: JsonRecord, field: string): string[] {
	const value = record[field];
	if (!Array.isArray(value)) return [];
	return value.filter((item): item is string => typeof item === 'string');
}

function readJsonFile(filePath: string): unknown {
	return JSON.parse(readFileSync(filePath, 'utf8'));
}

function ledgerKindFromFileName(fileName: string): AgentLedgerKind {
	if (fileName === 'BLOG.agents.json') return 'blog';
	if (fileName === 'ISSUES.open.json' || fileName === 'ISSUES.resolved.json') return 'issues';
	if (fileName === 'DONE.tasks.json') return 'done';
	return 'todo';
}

function workLedgerKindFromFileName(fileName: string): WorkLedgerFileKind | null {
	const kind = ledgerKindFromFileName(fileName);
	return kind === 'blog' ? null : kind;
}

function discoverAgentLedgerFiles(workspaceRoot: string): string[] {
	const files: string[] = [];

	function walk(dir: string, depth: number): void {
		let entries: Dirent[];
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}

		for (const entry of entries) {
			if (entry.isFile() && AGENT_LEDGER_FILE_NAMES.has(entry.name)) {
				files.push(path.join(dir, entry.name));
			}
		}

		if (depth >= MAX_LEDGER_SCAN_DEPTH) return;

		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			if (isSkippedDirName(entry.name)) continue;
			walk(path.join(dir, entry.name), depth + 1);
		}
	}

	walk(workspaceRoot, 0);
	return files.sort((left, right) =>
		toWorkspacePath(workspaceRoot, left).localeCompare(toWorkspacePath(workspaceRoot, right)),
	);
}

function moduleIdFromPath(modulePath: string): string {
	return modulePath === 'infra' ? 'infra' : path.basename(modulePath);
}

function slotHasGit(slot: JsonRecord): boolean {
	const git = slot.git;
	return isRecord(git) && typeof git.url === 'string' && git.url.trim().length > 0;
}

function isGitWorktree(absolutePath: string): boolean {
	if (!existsSync(absolutePath)) return false;
	const result = spawnSync('git', ['-C', absolutePath, 'rev-parse', '--is-inside-work-tree'], {
		encoding: 'utf8',
	});
	return result.status === 0 && result.stdout.trim() === 'true';
}

function resolveModuleSlotState(
	workspaceRoot: string,
	hasGit: boolean,
	modulePath: string,
): ModuleSlotState {
	if (!hasGit) return 'planned_slot';
	const absolutePath = path.join(workspaceRoot, modulePath);
	if (isGitWorktree(absolutePath)) return 'available';
	return 'missing_access';
}

function moduleScopeStates(workspaceRoot: string): AgentLedgerScope[] {
	try {
		const manifestPath = path.join(workspaceRoot, 'company', 'scripts', 'modules.manifest.json');
		const manifest = readJsonFile(manifestPath);
		if (!isRecord(manifest) || !Array.isArray(manifest.module_slots)) {
			return [];
		}

		return (
			(manifest as WorkspaceModulesManifest).module_slots?.flatMap((slot) => {
				if (!isRecord(slot) || typeof slot.path !== 'string') return [];
				const requiredRoles = Array.isArray(slot.required_roles)
					? slot.required_roles.filter((role): role is string => typeof role === 'string')
					: [];
				return [
					{
						id: moduleIdFromPath(slot.path),
						name: moduleIdFromPath(slot.path),
						path: slot.path,
						owner: requiredRoles.length ? requiredRoles.join(', ') : null,
						state: resolveModuleSlotState(workspaceRoot, slotHasGit(slot), slot.path),
						ledgerFiles: 0,
					},
				];
			}) ?? []
		);
	} catch {
		return [];
	}
}

function baseScopes(workspaceRoot: string): AgentLedgerScope[] {
	const candidates: AgentLedgerScope[] = [
		{
			id: 'companiesascode-root',
			name: 'CompaniesAsCode root',
			path: '.',
			owner: 'founder',
			state: 'available',
			ledgerFiles: 0,
		},
		...moduleScopeStates(workspaceRoot),
	];

	const scopes = new Map<string, AgentLedgerScope>();
	for (const scope of candidates) {
		scopes.set(scope.path, scope);
	}
	return [...scopes.values()];
}

function fallbackScopeFromPath(relativeFilePath: string): AgentLedgerScope {
	const dir = path.dirname(relativeFilePath);
	const scopePath = dir === '.' ? '.' : dir;
	const id =
		scopePath === '.'
			? 'companiesascode-root'
			: scopePath.replace(/^modules\//, '').replace(/[^a-zA-Z0-9_-]+/g, '-');
	return {
		id,
		name: id,
		path: scopePath,
		owner: null,
		state: 'available',
		ledgerFiles: 0,
	};
}

function scopeFromDocument(
	document: JsonRecord,
	relativeFilePath: string,
	scopeByPath: Map<string, AgentLedgerScope>,
): AgentLedgerScope {
	const rawScope = document.scope;
	const fallback = fallbackScopeFromPath(relativeFilePath);
	if (!isRecord(rawScope)) {
		return scopeByPath.get(fallback.path) ?? fallback;
	}

	const declaredPath = stringField(rawScope, 'path');
	const normalizedPath = declaredPath ?? fallback.path;
	const known = scopeByPath.get(normalizedPath);
	return {
		id: stringField(rawScope, 'id') ?? known?.id ?? fallback.id,
		name: stringField(rawScope, 'name') ?? known?.name ?? fallback.name,
		path: normalizedPath,
		owner: stringField(rawScope, 'owner') ?? known?.owner ?? null,
		state: known?.state ?? fallback.state,
		ledgerFiles: known?.ledgerFiles ?? 0,
	};
}

function normalizeLinks(record: JsonRecord): AgentLedgerLink[] {
	const rawLinks = record.links;
	if (!Array.isArray(rawLinks)) return [];
	return rawLinks.flatMap((link) => {
		if (!isRecord(link)) return [];
		const label = stringField(link, 'label');
		if (!label) return [];
		const pathValue = stringField(link, 'path');
		const urlValue = stringField(link, 'url');
		return [
			{
				label,
				path: pathValue,
				url: urlValue ?? (pathValue?.startsWith('http') ? pathValue : null),
			},
		];
	});
}

function normalizeSourceField(record: JsonRecord): JsonRecord {
	const source = record.source;
	if (isRecord(source)) return source;
	return {};
}

function validateRequiredString(record: JsonRecord, field: string, errors: string[]): string {
	const value = stringField(record, field);
	if (value) return value;
	errors.push(`missing ${field}`);
	return '';
}

function parseBlogFile(
	workspaceRoot: string,
	filePath: string,
	scopeByPath: Map<string, AgentLedgerScope>,
): {
	file: AgentBlogFile | null;
	entries: AgentBlogEntry[];
	invalidFile: AgentLedgerInvalidFile | null;
} {
	const relativePath = toWorkspacePath(workspaceRoot, filePath);
	const fileErrors: string[] = [];
	let document: unknown;
	try {
		document = readJsonFile(filePath);
	} catch (error) {
		return {
			file: null,
			entries: [],
			invalidFile: {
				path: relativePath,
				kind: 'blog',
				errors: [error instanceof Error ? error.message : String(error)],
			},
		};
	}

	if (!isRecord(document)) {
		return {
			file: null,
			entries: [],
			invalidFile: {
				path: relativePath,
				kind: 'blog',
				errors: ['BLOG.agents.json must be a JSON object'],
			},
		};
	}

	if (stringField(document, 'schema_version') !== AGENTS_BLOG_SCHEMA_VERSION) {
		fileErrors.push(`schema_version must be ${AGENTS_BLOG_SCHEMA_VERSION}`);
	}

	const scope = scopeFromDocument(document, relativePath, scopeByPath);
	const rawEntries = document.entries;
	if (!Array.isArray(rawEntries)) {
		fileErrors.push('entries must be an array');
	}

	const entries: AgentBlogEntry[] = [];
	let invalidEntries = 0;

	for (const [index, rawEntry] of (Array.isArray(rawEntries) ? rawEntries : []).entries()) {
		if (!isRecord(rawEntry)) {
			invalidEntries += 1;
			fileErrors.push(`entries[${index}] must be an object`);
			continue;
		}

		const entryErrors: string[] = [];
		const id = validateRequiredString(rawEntry, 'id', entryErrors);
		const title = validateRequiredString(rawEntry, 'title', entryErrors);
		const createdAt = validateRequiredString(rawEntry, 'created_at', entryErrors);
		const summary = validateRequiredString(rawEntry, 'summary', entryErrors);
		if (entryErrors.length > 0) {
			invalidEntries += 1;
			fileErrors.push(`entries[${index}]: ${entryErrors.join(', ')}`);
			continue;
		}

		const source = normalizeSourceField(rawEntry);
		entries.push({
			id,
			title,
			createdAt,
			updatedAt: stringField(rawEntry, 'updated_at'),
			agent: stringField(rawEntry, 'agent'),
			scope,
			sourceTaskId: stringField(source, 'task_id'),
			sourceCustomId: stringField(source, 'custom_id') ?? stringField(source, 'task_id'),
			sourceUrl: stringField(source, 'url'),
			insightType: stringField(rawEntry, 'insight_type') ?? 'note',
			visibilityHint: stringField(rawEntry, 'visibility_hint') ?? 'internal',
			contentPotential: stringField(rawEntry, 'content_potential') ?? 'none',
			tags: stringArrayField(rawEntry, 'tags'),
			summary,
			details: stringField(rawEntry, 'details'),
			links: normalizeLinks(rawEntry),
			filePath: relativePath,
		});
	}

	const file = {
		path: relativePath,
		scope,
		entries: entries.length,
		invalidEntries,
		errors: fileErrors,
	};

	return {
		file,
		entries,
		invalidFile:
			fileErrors.length > 0 ? { path: relativePath, kind: 'blog', errors: fileErrors } : null,
	};
}

function workItemKind(kind: WorkLedgerFileKind): AgentWorkLedgerItemKind {
	return kind === 'issues' ? 'issue' : kind;
}

function parseWorkLedgerFile(
	workspaceRoot: string,
	filePath: string,
	scopeByPath: Map<string, AgentLedgerScope>,
	rootWorkLedgerFiles: ReadonlySet<string>,
): {
	file: AgentWorkLedgerFile | null;
	items: AgentWorkLedgerItem[];
	invalidFile: AgentLedgerInvalidFile | null;
} {
	const relativePath = toWorkspacePath(workspaceRoot, filePath);
	const ledgerKind = workLedgerKindFromFileName(path.basename(filePath));
	if (!ledgerKind) {
		throw new Error('parseWorkLedgerFile called with BLOG.agents.json');
	}
	const collectionName = ledgerKind === 'issues' ? 'issues' : 'tasks';
	const fileErrors: string[] = [];

	let document: unknown;
	try {
		document = readJsonFile(filePath);
	} catch (error) {
		return {
			file: null,
			items: [],
			invalidFile: {
				path: relativePath,
				kind: ledgerKind,
				errors: [error instanceof Error ? error.message : String(error)],
			},
		};
	}

	if (!isRecord(document) && !Array.isArray(document)) {
		return {
			file: null,
			items: [],
			invalidFile: {
				path: relativePath,
				kind: ledgerKind,
				errors: [`${path.basename(filePath)} must be a JSON object or array`],
			},
		};
	}

	const scope = rootWorkLedgerFiles.has(path.resolve(filePath))
		? (scopeByPath.get('.') ?? fallbackScopeFromPath('.'))
		: scopeFromDocument(isRecord(document) ? document : {}, relativePath, scopeByPath);
	const rawItems = Array.isArray(document) ? document : document[collectionName];
	if (!Array.isArray(rawItems)) {
		fileErrors.push(`${collectionName} must be an array`);
	}

	const items: AgentWorkLedgerItem[] = [];
	let invalidItems = 0;

	for (const [index, rawItem] of (Array.isArray(rawItems) ? rawItems : []).entries()) {
		if (!isRecord(rawItem)) {
			invalidItems += 1;
			fileErrors.push(`${collectionName}[${index}] must be an object`);
			continue;
		}

		const id = stringField(rawItem, 'id');
		const title = stringField(rawItem, 'title');
		if (!id || !title) {
			invalidItems += 1;
			fileErrors.push(`${collectionName}[${index}] missing id or title`);
			continue;
		}

		const summary =
			stringField(rawItem, 'summary') ??
			stringField(rawItem, 'question') ??
			stringField(rawItem, 'outcome') ??
			'';
		items.push({
			id,
			kind: workItemKind(ledgerKind),
			title,
			status: stringField(rawItem, 'status') ?? 'unknown',
			priority: stringField(rawItem, 'priority'),
			severity: stringField(rawItem, 'severity'),
			scope,
			tags: stringArrayField(rawItem, 'tags'),
			summary,
			createdAt: stringField(rawItem, 'created_at'),
			updatedAt: stringField(rawItem, 'updated_at'),
			completedAt: stringField(rawItem, 'completed_at'),
			links: normalizeLinks(rawItem),
			filePath: relativePath,
		});
	}

	const file = {
		path: relativePath,
		kind: ledgerKind,
		scope,
		items: items.length,
		invalidItems,
		errors: fileErrors,
	};

	return {
		file,
		items,
		invalidFile:
			fileErrors.length > 0 ? { path: relativePath, kind: ledgerKind, errors: fileErrors } : null,
	};
}

function countLedgerFiles(
	scopes: AgentLedgerScope[],
	files: Array<{ scope: AgentLedgerScope }>,
): AgentLedgerScope[] {
	const counts = new Map<string, number>();
	for (const file of files) {
		counts.set(file.scope.path, (counts.get(file.scope.path) ?? 0) + 1);
	}
	return scopes
		.map((scope) => ({
			...scope,
			ledgerFiles: counts.get(scope.path) ?? 0,
		}))
		.sort((left, right) => {
			const stateOrder = {
				available: 0,
				missing_access: 1,
				planned_slot: 2,
				unknown: 3,
			} satisfies Record<AgentLedgerScopeState, number>;
			return (
				stateOrder[left.state] - stateOrder[right.state] || left.path.localeCompare(right.path)
			);
		});
}

export function scanAgentLedgers(
	workspaceRoot: string,
	options: ScanAgentLedgersOptions = {},
): AgentLedgerScan {
	const scopes = baseScopes(workspaceRoot);
	const scopeByPath = new Map(scopes.map((scope) => [scope.path, scope]));
	const blogFiles: AgentBlogFile[] = [];
	const blogEntries: AgentBlogEntry[] = [];
	const workFiles: AgentWorkLedgerFile[] = [];
	const workItems: AgentWorkLedgerItem[] = [];
	const invalidFiles: AgentLedgerInvalidFile[] = [];
	const rootWorkLedgerFiles = new Set(
		(options.rootWorkLedgerFiles ?? []).map((filePath) => path.resolve(filePath)),
	);

	const discoveredLedgerFiles =
		options.ledgerFiles || !options.workLedgerFiles ? [] : discoverAgentLedgerFiles(workspaceRoot);
	const ledgerFiles = [
		...new Set(
			options.ledgerFiles ??
				(options.workLedgerFiles
					? [
							...discoveredLedgerFiles.filter(
								(filePath) => ledgerKindFromFileName(path.basename(filePath)) === 'blog',
							),
							...options.workLedgerFiles,
						]
					: discoverAgentLedgerFiles(workspaceRoot)),
		),
	].sort((left, right) =>
		toWorkspacePath(workspaceRoot, left).localeCompare(toWorkspacePath(workspaceRoot, right)),
	);
	for (const filePath of ledgerFiles) {
		const kind = ledgerKindFromFileName(path.basename(filePath));
		if (kind === 'blog') {
			const result = parseBlogFile(workspaceRoot, filePath, scopeByPath);
			if (result.file) blogFiles.push(result.file);
			blogEntries.push(...result.entries);
			if (result.invalidFile) invalidFiles.push(result.invalidFile);
			continue;
		}

		const result = parseWorkLedgerFile(workspaceRoot, filePath, scopeByPath, rootWorkLedgerFiles);
		if (result.file) workFiles.push(result.file);
		workItems.push(...result.items);
		if (result.invalidFile) invalidFiles.push(result.invalidFile);
	}

	const allFiles = [...blogFiles, ...workFiles];
	const resolvedScopes = countLedgerFiles(scopes, allFiles);
	const invalidBlogFiles = invalidFiles.filter((file) => file.kind === 'blog');
	const invalidWorkFiles = invalidFiles.filter((file) => file.kind !== 'blog');
	const missingAccessScopes = resolvedScopes.filter(
		(scope) => scope.state === 'missing_access',
	).length;
	const plannedScopes = resolvedScopes.filter((scope) => scope.state === 'planned_slot').length;

	return {
		schemaVersion: AGENT_LEDGER_SCHEMA_VERSION,
		workspaceRoot,
		scannedAt: new Date().toISOString(),
		scopes: resolvedScopes,
		invalidFiles,
		blog: {
			schemaVersion: AGENTS_BLOG_SCHEMA_VERSION,
			summary: {
				files: blogFiles.length,
				entries: blogEntries.length,
				invalidFiles: invalidBlogFiles.length,
				invalidEntries: blogFiles.reduce((total, file) => total + file.invalidEntries, 0),
			},
			files: blogFiles,
			entries: blogEntries.sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
		},
		work: {
			summary: {
				files: workFiles.length,
				todo: workItems.filter((item) => item.kind === 'todo').length,
				issues: workItems.filter((item) => item.kind === 'issue').length,
				done: workItems.filter((item) => item.kind === 'done').length,
				invalidFiles: invalidWorkFiles.length,
				invalidItems: workFiles.reduce((total, file) => total + file.invalidItems, 0),
				missingAccessScopes,
				plannedScopes,
			},
			files: workFiles,
			items: workItems.sort((left, right) => {
				const leftDate = left.updatedAt ?? left.createdAt ?? '';
				const rightDate = right.updatedAt ?? right.createdAt ?? '';
				return rightDate.localeCompare(leftDate) || left.id.localeCompare(right.id);
			}),
		},
	};
}
