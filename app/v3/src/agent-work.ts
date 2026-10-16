import path from 'node:path';
import {
	type AgentBlogEntry,
	type AgentBlogFile,
	type AgentLedgerInvalidFile,
	type AgentLedgerLink,
	type AgentLedgerScan,
	type AgentLedgerScope,
	type AgentWorkLedgerFile,
	type AgentWorkLedgerItem,
	scanAgentLedgers,
} from './agent-ledgers/registry.ts';
import {
	MISSION_AGENT_SECTIONS,
	MISSION_AGENT_WORK_SCHEMA_VERSION,
	type MissionAgentBlogEntry,
	type MissionAgentBlogFile,
	type MissionAgentLedgerInvalidFile,
	type MissionAgentLedgerLink,
	type MissionAgentLedgerScope,
	type MissionAgentWorkCockpit,
	type MissionAgentWorkLedgerFile,
	type MissionAgentWorkLedgerItem,
	type MissionAgentWorkPayload,
	type MissionAgentWorkResponse,
	type MissionTodoOutputMaterializationWarning,
} from './agent-work/contract.ts';
import { WORKSPACE_ADMIN_ID } from './issue-resolution.ts';
import {
	IS_REPOSITORY_DB_MODE,
	listWorkspaceLedgerFiles,
	missionControlDataRelative,
	WORKSPACE_ROOT,
	workspaceRelative,
} from './paths.ts';
import { listPlanRecords } from './store.ts';
import { buildTodoOutputMaterializationWarnings, type RawWorkItem } from './work-board.ts';

export type AgentWorkCliFormat = 'json' | 'summary';

export type BuildAgentWorkPayloadOptions = {
	todoOutputMaterializationWarnings?: MissionTodoOutputMaterializationWarning[];
};

export type {
	MissionAgentSection,
	MissionAgentWorkPayload,
	MissionAgentWorkResponse,
} from './agent-work/contract.ts';
export { MISSION_AGENT_WORK_SCHEMA_VERSION } from './agent-work/contract.ts';

function toContractScope(scope: AgentLedgerScope): MissionAgentLedgerScope {
	return {
		id: scope.id,
		name: scope.name,
		path: scope.path,
		owner: scope.owner,
		state: scope.state,
		ledgerFiles: scope.ledgerFiles,
	};
}

function canonicalContractScope(
	scope: AgentLedgerScope,
	scopeByPath: ReadonlyMap<string, MissionAgentLedgerScope>,
): MissionAgentLedgerScope {
	return scopeByPath.get(scope.path) ?? toContractScope(scope);
}

function compareScopes(left: MissionAgentLedgerScope, right: MissionAgentLedgerScope): number {
	const stateOrder = {
		available: 0,
		missing_access: 1,
		planned_slot: 2,
		unknown: 3,
	} satisfies Record<MissionAgentLedgerScope['state'], number>;
	return stateOrder[left.state] - stateOrder[right.state] || left.path.localeCompare(right.path);
}

function buildContractScopes(scan: AgentLedgerScan): MissionAgentLedgerScope[] {
	const scopesByPath = new Map<string, AgentLedgerScope>();
	for (const scope of scan.scopes) scopesByPath.set(scope.path, scope);

	const files = [...scan.blog.files, ...scan.work.files];
	for (const file of files) {
		if (!scopesByPath.has(file.scope.path)) scopesByPath.set(file.scope.path, file.scope);
	}

	const ledgerFileCounts = new Map<string, number>();
	for (const file of files) {
		ledgerFileCounts.set(file.scope.path, (ledgerFileCounts.get(file.scope.path) ?? 0) + 1);
	}

	return [...scopesByPath.values()]
		.map((scope) =>
			toContractScope({
				...scope,
				ledgerFiles: ledgerFileCounts.get(scope.path) ?? scope.ledgerFiles,
			}),
		)
		.sort(compareScopes);
}

function toContractLink(link: AgentLedgerLink): MissionAgentLedgerLink {
	return {
		label: link.label,
		path: link.path,
		url: link.url,
	};
}

function toContractInvalidFile(file: AgentLedgerInvalidFile): MissionAgentLedgerInvalidFile {
	return {
		path: file.path,
		kind: file.kind,
		errors: [...file.errors],
	};
}

function toContractBlogFile(
	file: AgentBlogFile,
	scopeByPath: ReadonlyMap<string, MissionAgentLedgerScope>,
): MissionAgentBlogFile {
	return {
		path: file.path,
		scope: canonicalContractScope(file.scope, scopeByPath),
		entries: file.entries,
		invalidEntries: file.invalidEntries,
		errors: [...file.errors],
	};
}

function toContractBlogEntry(
	entry: AgentBlogEntry,
	scopeByPath: ReadonlyMap<string, MissionAgentLedgerScope>,
): MissionAgentBlogEntry {
	return {
		id: entry.id,
		title: entry.title,
		createdAt: entry.createdAt,
		updatedAt: entry.updatedAt,
		agent: entry.agent,
		scope: canonicalContractScope(entry.scope, scopeByPath),
		sourceTaskId: entry.sourceTaskId,
		sourceCustomId: entry.sourceCustomId,
		sourceUrl: entry.sourceUrl,
		insightType: entry.insightType,
		visibilityHint: entry.visibilityHint,
		contentPotential: entry.contentPotential,
		tags: [...entry.tags],
		summary: entry.summary,
		details: entry.details,
		links: entry.links.map(toContractLink),
		filePath: entry.filePath,
	};
}

function toContractWorkFile(
	file: AgentWorkLedgerFile,
	scopeByPath: ReadonlyMap<string, MissionAgentLedgerScope>,
): MissionAgentWorkLedgerFile {
	return {
		path: file.path,
		kind: file.kind,
		scope: canonicalContractScope(file.scope, scopeByPath),
		items: file.items,
		invalidItems: file.invalidItems,
		errors: [...file.errors],
	};
}

function toContractWorkItem(
	item: AgentWorkLedgerItem,
	scopeByPath: ReadonlyMap<string, MissionAgentLedgerScope>,
): MissionAgentWorkLedgerItem {
	return {
		id: item.id,
		kind: item.kind,
		title: item.title,
		status: item.status,
		priority: item.priority,
		severity: item.severity,
		scope: canonicalContractScope(item.scope, scopeByPath),
		tags: [...item.tags],
		summary: item.summary,
		createdAt: item.createdAt,
		updatedAt: item.updatedAt,
		completedAt: item.completedAt,
		links: item.links.map(toContractLink),
		filePath: item.filePath,
	};
}

const RESOLVED_ISSUE_STATUSES = new Set(['resolved', 'closed', 'done', 'archived']);
const INACTIVE_WORK_STATUSES = new Set(['done', 'completed', 'closed', 'resolved', 'archived']);

function itemDate(item: MissionAgentWorkLedgerItem): string {
	return item.updatedAt ?? item.completedAt ?? item.createdAt ?? '';
}

function blogEntryDate(entry: MissionAgentBlogEntry): string {
	return entry.updatedAt ?? entry.createdAt;
}

function severityRank(severity: string | null): number {
	switch (severity?.toLowerCase()) {
		case 'critical':
		case 'urgent':
		case 'high':
			return 0;
		case 'medium':
			return 1;
		case 'low':
			return 2;
		default:
			return 3;
	}
}

function priorityRank(priority: string | null): number {
	switch (priority?.toLowerCase()) {
		case 'urgent':
			return 0;
		case 'high':
			return 1;
		case 'medium':
			return 2;
		case 'low':
			return 3;
		default:
			return 4;
	}
}

function compareDecisionItems(
	left: MissionAgentWorkLedgerItem,
	right: MissionAgentWorkLedgerItem,
): number {
	return (
		severityRank(left.severity) - severityRank(right.severity) ||
		itemDate(right).localeCompare(itemDate(left)) ||
		left.filePath.localeCompare(right.filePath) ||
		left.id.localeCompare(right.id)
	);
}

function compareActiveWorkItems(
	left: MissionAgentWorkLedgerItem,
	right: MissionAgentWorkLedgerItem,
): number {
	return (
		priorityRank(left.priority) - priorityRank(right.priority) ||
		itemDate(right).localeCompare(itemDate(left)) ||
		left.filePath.localeCompare(right.filePath) ||
		left.id.localeCompare(right.id)
	);
}

function compareRecentWorkItems(
	left: MissionAgentWorkLedgerItem,
	right: MissionAgentWorkLedgerItem,
): number {
	return itemDate(right).localeCompare(itemDate(left)) || right.id.localeCompare(left.id);
}

function isOpenDecision(item: MissionAgentWorkLedgerItem): boolean {
	return item.kind === 'issue' && !RESOLVED_ISSUE_STATUSES.has(item.status.toLowerCase());
}

function isActiveWork(item: MissionAgentWorkLedgerItem): boolean {
	return item.kind === 'todo' && !INACTIVE_WORK_STATUSES.has(item.status.toLowerCase());
}

function healthLaneSummary({
	healthTone,
	invalidSignals,
	todoOutputWarnings,
}: {
	healthTone: 'ok' | 'warning';
	invalidSignals: number;
	todoOutputWarnings: number;
}): string {
	if (healthTone === 'ok') return 'Ledgery validní';
	if (invalidSignals > 0 && todoOutputWarnings > 0) return 'Zkontrolovat ledgery i todo_outputs';
	if (todoOutputWarnings > 0) return 'Zkontrolovat todo_outputs';
	return 'Zkontrolovat ledgery';
}

function buildAgentWorkCockpit({
	scopes,
	invalidFiles,
	blogEntries,
	workItems,
	workSummary,
	todoOutputWarnings,
}: {
	scopes: MissionAgentLedgerScope[];
	invalidFiles: MissionAgentLedgerInvalidFile[];
	blogEntries: MissionAgentBlogEntry[];
	workItems: MissionAgentWorkLedgerItem[];
	workSummary: AgentLedgerScan['work']['summary'];
	todoOutputWarnings: MissionTodoOutputMaterializationWarning[];
}): MissionAgentWorkCockpit {
	const decisions = workItems.filter(isOpenDecision).sort(compareDecisionItems);
	const activeWork = workItems.filter(isActiveWork).sort(compareActiveWorkItems);
	const recentDone = workItems.filter((item) => item.kind === 'done').sort(compareRecentWorkItems);
	const insights = [...blogEntries].sort(
		(left, right) =>
			blogEntryDate(right).localeCompare(blogEntryDate(left)) || left.id.localeCompare(right.id),
	);
	const highSeverity = decisions.filter((item) => severityRank(item.severity) === 0).length;
	const invalidSignals = invalidFiles.length + workSummary.invalidItems;
	const healthCount = invalidSignals + todoOutputWarnings.length;
	const healthTone = healthCount > 0 ? 'warning' : 'ok';

	return {
		lanes: [
			{
				id: 'decisions',
				label: 'Historie issues',
				count: decisions.length,
				tone: 'neutral',
				summary: 'Read-only historie; aktivní issues jsou na GitHubu',
			},
			{
				id: 'active-work',
				label: 'Aktivní práce',
				count: activeWork.length,
				tone: activeWork.length > 0 ? 'warning' : 'ok',
				summary: 'Otevřené TODO',
			},
			{
				id: 'insights',
				label: 'Insights',
				count: insights.length,
				tone: insights.length > 0 ? 'neutral' : 'ok',
				summary: 'BLOG.agents.json',
			},
			{
				id: 'health',
				label: 'Health',
				count: healthCount,
				tone: healthTone,
				summary: healthLaneSummary({
					healthTone,
					invalidSignals,
					todoOutputWarnings: todoOutputWarnings.length,
				}),
			},
		],
		decisions: {
			total: decisions.length,
			highSeverity,
			items: decisions.slice(0, 24),
		},
		activeWork: {
			total: activeWork.length,
			items: activeWork.slice(0, 60),
		},
		recentDone: {
			total: recentDone.length,
			items: recentDone.slice(0, 24),
		},
		insights: {
			total: insights.length,
			items: insights.slice(0, 40),
		},
		health: {
			invalidFiles: invalidFiles.length,
			invalidItems: workSummary.invalidItems,
			todoOutputWarnings: todoOutputWarnings.length,
			missingAccessScopes: workSummary.missingAccessScopes,
			plannedScopes: workSummary.plannedScopes,
			scopes,
			invalidFileDetails: invalidFiles,
			todoOutputWarningDetails: todoOutputWarnings,
		},
	};
}

export function buildAgentWorkPayload(
	scan: AgentLedgerScan,
	options: BuildAgentWorkPayloadOptions = {},
): MissionAgentWorkPayload {
	const contractScopes = buildContractScopes(scan);
	const scopeByPath = new Map(contractScopes.map((scope) => [scope.path, scope]));
	const invalidFiles = scan.invalidFiles.map(toContractInvalidFile);
	const invalidBlogFiles = invalidFiles.filter((file) => file.kind === 'blog');
	const invalidWorkFiles = invalidFiles.filter((file) => file.kind !== 'blog');
	const blogEntries = scan.blog.entries.map((entry) => toContractBlogEntry(entry, scopeByPath));
	const workItems = scan.work.items.map((item) => toContractWorkItem(item, scopeByPath));
	const todoOutputWarnings = options.todoOutputMaterializationWarnings ?? [];
	const rootName = path.basename(scan.workspaceRoot);
	const cockpit = buildAgentWorkCockpit({
		scopes: contractScopes,
		invalidFiles,
		blogEntries,
		workItems,
		workSummary: scan.work.summary,
		todoOutputWarnings,
	});
	return {
		schemaVersion: MISSION_AGENT_WORK_SCHEMA_VERSION,
		ledgerSchemaVersion: scan.schemaVersion,
		workspace: {
			rootName,
			rootPath: scan.workspaceRoot,
		},
		workspaceAdmin: WORKSPACE_ADMIN_ID,
		scannedAt: scan.scannedAt,
		overview: {
			owner: 'mission-control',
			sections: [...MISSION_AGENT_SECTIONS],
			counts: {
				blogEntries: scan.blog.summary.entries,
				todo: scan.work.summary.todo,
				issues: scan.work.summary.issues,
				done: scan.work.summary.done,
				invalidFiles: invalidFiles.length,
				todoOutputWarnings: todoOutputWarnings.length,
			},
		},
		cockpit,
		scopes: contractScopes,
		invalidFiles,
		blog: {
			ledgerSchemaVersion: scan.blog.schemaVersion,
			summary: { ...scan.blog.summary },
			files: scan.blog.files.map((file) => toContractBlogFile(file, scopeByPath)),
			entries: blogEntries,
			invalidFiles: invalidBlogFiles,
		},
		workLedger: {
			ledgerSchemaVersion: scan.schemaVersion,
			summary: { ...scan.work.summary, todoOutputWarnings: todoOutputWarnings.length },
			files: scan.work.files.map((file) => toContractWorkFile(file, scopeByPath)),
			items: workItems,
			invalidFiles: invalidWorkFiles,
			todoOutputMaterializationWarnings: todoOutputWarnings,
		},
	};
}

export function buildAgentWorkResponse(
	scan: AgentLedgerScan,
	options: BuildAgentWorkPayloadOptions = {},
): MissionAgentWorkResponse {
	return { agentWork: buildAgentWorkPayload(scan, options) };
}

function todoOutputWarningItems(scan: AgentLedgerScan): Array<Pick<RawWorkItem, 'id' | 'kind'>> {
	return scan.work.items.map((item) => ({ id: item.id, kind: item.kind }));
}

async function currentTodoOutputMaterializationWarnings(
	scan: AgentLedgerScan,
	ledgerFiles: readonly string[] = [],
): Promise<MissionTodoOutputMaterializationWarning[]> {
	const records = await listPlanRecords();
	const scannedLedgerPaths = [
		...new Set([
			...scan.work.files.map((file) => file.path),
			...ledgerFiles.map(workspaceRelative),
			...ledgerFiles.map(missionControlDataRelative),
		]),
	];
	return buildTodoOutputMaterializationWarnings({
		records,
		items: todoOutputWarningItems(scan),
		scannedLedgerPaths,
	});
}

export async function buildCurrentAgentWorkPayload(): Promise<MissionAgentWorkPayload> {
	const ledgerFiles = await listWorkspaceLedgerFiles();
	const scan = scanAgentLedgers(WORKSPACE_ROOT, {
		workLedgerFiles: ledgerFiles,
		rootWorkLedgerFiles: IS_REPOSITORY_DB_MODE ? ledgerFiles : [],
	});
	return buildAgentWorkPayload(scan, {
		todoOutputMaterializationWarnings: await currentTodoOutputMaterializationWarnings(
			scan,
			ledgerFiles,
		),
	});
}

export async function buildCurrentAgentWorkResponse(): Promise<MissionAgentWorkResponse> {
	return { agentWork: await buildCurrentAgentWorkPayload() };
}

export function formatAgentWorkCliOutput(
	response: MissionAgentWorkResponse,
	format: AgentWorkCliFormat = 'json',
): string {
	if (format === 'json') {
		return `${JSON.stringify(response, null, 2)}\n`;
	}

	const { agentWork } = response;
	const lines = [
		`Mission Control agent work (${agentWork.workspace.rootName})`,
		`Scanned: ${agentWork.scannedAt}`,
		`TODO: ${agentWork.overview.counts.todo}`,
		`ISSUES: ${agentWork.overview.counts.issues}`,
		`DONE: ${agentWork.overview.counts.done}`,
		`BLOG entries: ${agentWork.overview.counts.blogEntries}`,
		`Invalid files: ${agentWork.overview.counts.invalidFiles}`,
		`todo_outputs warnings: ${agentWork.overview.counts.todoOutputWarnings}`,
		`Missing-access scopes: ${agentWork.workLedger.summary.missingAccessScopes}`,
		`Planned scopes: ${agentWork.workLedger.summary.plannedScopes}`,
	];
	return `${lines.join('\n')}\n`;
}

export function parseAgentWorkCliFormat(args: string[]): AgentWorkCliFormat {
	if (args.includes('--summary')) return 'summary';
	const inlineFormat = args.find((arg) => arg.startsWith('--format='));
	const formatFlagIndex = args.indexOf('--format');
	const requested =
		inlineFormat?.slice('--format='.length) ??
		(formatFlagIndex === -1 ? 'json' : args[formatFlagIndex + 1]);
	if (requested === 'json' || requested === 'summary') return requested;
	throw new Error(`Unsupported agent-work format: ${requested ?? '<missing>'}`);
}
