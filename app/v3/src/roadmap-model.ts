export type RoadmapEvidenceRef = {
	label: string;
	kind: string;
	path?: string;
	url?: string;
	verification?: string;
};

export type RoadmapAgentLaneSource = {
	reviewers?: string[];
	execution_agents?: string[];
	escalation_policy?: string;
};

export type RoadmapPriority = {
	id: string;
	title: string;
	rank: number;
	rationale: string;
};

export type RoadmapStep = {
	id: string;
	title: string;
	status: string;
	executable: boolean;
	priority_refs: string[];
	plan_refs?: string[];
	todo_refs?: string[];
	issue_refs?: string[];
	evidence_refs?: RoadmapEvidenceRef[];
	acceptance_criteria: string[];
	notes?: string;
};

export type MissionControlRoadmap = {
	schema_version: string;
	id: string;
	roadmap_code: string;
	title: string;
	status: string;
	owner: string;
	priority: string;
	created_at: string;
	updated_at: string;
	source_plan: string;
	summary: string;
	agent_lane?: RoadmapAgentLaneSource;
	priorities: RoadmapPriority[];
	steps: RoadmapStep[];
};

export type RoadmapNextStep = Pick<
	RoadmapStep,
	| 'id'
	| 'title'
	| 'status'
	| 'plan_refs'
	| 'todo_refs'
	| 'issue_refs'
	| 'evidence_refs'
	| 'acceptance_criteria'
>;

export type RoadmapIssueBlocker = {
	step_id: string;
	step_title: string;
	issue_id: string;
	title: string;
	status: string;
	severity: string;
	owner: string;
	file: string;
};

export type RoadmapResolutionEvidence = {
	step_id: string;
	step_title: string;
	issue_id: string;
	title: string;
	resolved_at: string;
	resolved_by: string;
	decision: string;
	rationale?: string;
	selected_option?: string;
	follow_up?: string;
	source_ledger_path: string;
	resolved_ledger_path: string;
};

export type RoadmapLinkedWorkItem = {
	id: string;
	kind: 'todo' | 'done';
	title: string;
	status: string;
	ledger_path: string;
	dev_code?: string;
	planning_path?: string;
	blocks_release?: boolean;
};

export type RoadmapWorkSummary = {
	blocking_open_todo_count: number;
	non_blocking_open_todo_count: number;
	done_count: number;
	linked_items: RoadmapLinkedWorkItem[];
	missing_todo_refs: string[];
	ledger_read_errors: Array<{ ledger_path: string; message: string }>;
};

export type RoadmapRuntimeLane = {
	source: 'main' | 'worktree' | 'branch' | 'detached' | 'unknown';
	path: string;
	branch: string;
	head: string;
	dirty: boolean;
	prs: Array<{ plan_ref: string; url: string; status?: string; note?: string }>;
};

export type RoadmapAgentLane = {
	owner: string;
	reviewers: string[];
	execution_agents: string[];
	escalation_policy: string;
	status: 'pass' | 'warning' | 'blocker';
	source: 'roadmap' | 'missing';
	warnings: string[];
};

export type RoadmapReleaseGateCheck = {
	id: string;
	label: string;
	status: 'pass' | 'warning' | 'blocker';
	detail: string;
};

export type RoadmapReleaseGate = {
	status: 'ready' | 'blocked' | 'done';
	open_step_count: number;
	done_step_count: number;
	blockers: string[];
	checks: RoadmapReleaseGateCheck[];
	next_action: string;
};

export type RoadmapApiRecord = {
	roadmap: MissionControlRoadmap;
	relativePath: string;
	workspacePath: string;
	validation: { ok: boolean; failures: string[] };
	next_step: RoadmapNextStep | null;
	issue_blockers: RoadmapIssueBlocker[];
	step_issue_blockers: RoadmapIssueBlocker[];
	resolution_evidence: RoadmapResolutionEvidence[];
	work_summary: RoadmapWorkSummary;
	runtime_lane: RoadmapRuntimeLane;
	agent_lane: RoadmapAgentLane;
	release_gate: RoadmapReleaseGate;
	blockers: string[];
	actions: string[];
};

export type RoadmapsApiResponse = {
	roadmaps: RoadmapApiRecord[];
	validation: { ok: boolean; failures: string[] };
};
