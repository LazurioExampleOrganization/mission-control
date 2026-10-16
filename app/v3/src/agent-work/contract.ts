export const MISSION_AGENT_WORK_SCHEMA_VERSION = 'companiesascode.mission_control.agent_work.v1';

// CompaniesAsCode nemá Launchpad runtime; sekce vlastní jen Mission Control.
export type MissionAgentSectionId = 'agent-work';
export type MissionAgentSectionOwner = 'mission-control';
export type MissionAgentWorkLaneId = 'decisions' | 'active-work' | 'insights' | 'health';
export type MissionAgentWorkLaneTone = 'neutral' | 'ok' | 'warning' | 'error';

export type MissionAgentSection = {
	id: MissionAgentSectionId;
	label: string;
	summary: string;
	owner: MissionAgentSectionOwner;
};

export type MissionAgentLedgerScopeState =
	| 'available'
	| 'missing_access'
	| 'planned_slot'
	| 'unknown';

export type MissionAgentLedgerScope = {
	id: string;
	name: string;
	path: string;
	owner: string | null;
	state: MissionAgentLedgerScopeState;
	ledgerFiles: number;
};

export type MissionAgentLedgerLink = {
	label: string;
	path: string | null;
	url: string | null;
};

export type MissionAgentLedgerKind = 'blog' | 'todo' | 'done' | 'issues';

export type MissionAgentLedgerInvalidFile = {
	path: string;
	kind: MissionAgentLedgerKind;
	errors: string[];
};

export type MissionTodoOutputMaterializationWarning = {
	code: 'missing_todo_output' | 'unscanned_planning_target';
	severity: 'warning';
	plan_id: string;
	dev_code: string;
	plan_path: string;
	output_id: string;
	planning_target?: string;
	message: string;
};

export type MissionAgentBlogEntry = {
	id: string;
	title: string;
	createdAt: string;
	updatedAt: string | null;
	agent: string | null;
	scope: MissionAgentLedgerScope;
	sourceTaskId: string | null;
	sourceCustomId: string | null;
	sourceUrl: string | null;
	insightType: string;
	visibilityHint: string;
	contentPotential: string;
	tags: string[];
	summary: string;
	details: string | null;
	links: MissionAgentLedgerLink[];
	filePath: string;
};

export type MissionAgentBlogFile = {
	path: string;
	scope: MissionAgentLedgerScope;
	entries: number;
	invalidEntries: number;
	errors: string[];
};

export type MissionAgentWorkLedgerItemKind = 'todo' | 'done' | 'issue';

export type MissionAgentWorkLedgerItem = {
	id: string;
	kind: MissionAgentWorkLedgerItemKind;
	title: string;
	status: string;
	priority: string | null;
	severity: string | null;
	scope: MissionAgentLedgerScope;
	tags: string[];
	summary: string;
	createdAt: string | null;
	updatedAt: string | null;
	completedAt: string | null;
	links: MissionAgentLedgerLink[];
	filePath: string;
};

export type MissionAgentWorkLedgerFile = {
	path: string;
	kind: 'todo' | 'done' | 'issues';
	scope: MissionAgentLedgerScope;
	items: number;
	invalidItems: number;
	errors: string[];
};

export type MissionAgentWorkLane = {
	id: MissionAgentWorkLaneId;
	label: string;
	count: number;
	tone: MissionAgentWorkLaneTone;
	summary: string;
};

export type MissionAgentWorkCockpit = {
	lanes: MissionAgentWorkLane[];
	decisions: {
		total: number;
		highSeverity: number;
		items: MissionAgentWorkLedgerItem[];
	};
	activeWork: {
		total: number;
		items: MissionAgentWorkLedgerItem[];
	};
	recentDone: {
		total: number;
		items: MissionAgentWorkLedgerItem[];
	};
	insights: {
		total: number;
		items: MissionAgentBlogEntry[];
	};
	health: {
		invalidFiles: number;
		invalidItems: number;
		todoOutputWarnings: number;
		missingAccessScopes: number;
		plannedScopes: number;
		scopes: MissionAgentLedgerScope[];
		invalidFileDetails: MissionAgentLedgerInvalidFile[];
		todoOutputWarningDetails: MissionTodoOutputMaterializationWarning[];
	};
};

export type MissionAgentWorkPayload = {
	schemaVersion: typeof MISSION_AGENT_WORK_SCHEMA_VERSION;
	ledgerSchemaVersion: string;
	workspace: {
		rootName: string;
		rootPath: string;
	};
	workspaceAdmin: string;
	scannedAt: string;
	overview: {
		owner: 'mission-control';
		sections: MissionAgentSection[];
		counts: {
			blogEntries: number;
			todo: number;
			issues: number;
			done: number;
			invalidFiles: number;
			todoOutputWarnings: number;
		};
	};
	cockpit: MissionAgentWorkCockpit;
	scopes: MissionAgentLedgerScope[];
	invalidFiles: MissionAgentLedgerInvalidFile[];
	blog: {
		ledgerSchemaVersion: string;
		summary: {
			files: number;
			entries: number;
			invalidFiles: number;
			invalidEntries: number;
		};
		files: MissionAgentBlogFile[];
		entries: MissionAgentBlogEntry[];
		invalidFiles: MissionAgentLedgerInvalidFile[];
	};
	workLedger: {
		ledgerSchemaVersion: string;
		summary: {
			files: number;
			todo: number;
			issues: number;
			done: number;
			invalidFiles: number;
			invalidItems: number;
			todoOutputWarnings: number;
			missingAccessScopes: number;
			plannedScopes: number;
		};
		files: MissionAgentWorkLedgerFile[];
		items: MissionAgentWorkLedgerItem[];
		invalidFiles: MissionAgentLedgerInvalidFile[];
		todoOutputMaterializationWarnings: MissionTodoOutputMaterializationWarning[];
	};
};

export type MissionAgentWorkResponse = {
	agentWork: MissionAgentWorkPayload;
};

export const MISSION_AGENT_SECTIONS: MissionAgentSection[] = [
	{
		id: 'agent-work',
		label: 'Agent work',
		summary: 'Cockpit rozhodnutí, aktivní práce, recent DONE, insightů a ledger health.',
		owner: 'mission-control',
	},
];
