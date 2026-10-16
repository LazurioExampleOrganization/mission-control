export const PLAN_SCHEMA_VERSION = 'companiesascode.mission_control.plan.v2';

export const PLAN_STATUSES = [
	'shaping',
	'ready',
	'in_progress',
	'review',
	'blocked',
	'done',
	'archived',
] as const;

export const PLAN_PRIORITIES = ['urgent', 'high', 'medium', 'low'] as const;
export const DEFAULT_PLAN_OWNER = 'workspace-admin';

export type PlanStatus = (typeof PLAN_STATUSES)[number];
export type PlanPriority = (typeof PLAN_PRIORITIES)[number];

export type PlanLink = {
	label: string;
	path?: string;
	url?: string;
};

export type PlanDecision = {
	date: string;
	decision: string;
	rationale?: string;
};

export type PlanScope = {
	in: string[];
	out: string[];
};

export type ProposedTask = {
	id?: string;
	title: string;
	summary: string;
	priority?: PlanPriority;
	priority_reason?: string;
	tags?: string[];
	acceptance_criteria?: string[];
	risk_notes?: string[];
	blocked_by?: string[];
};

export type MissionControlPlan = {
	schema_version: string;
	id: string;
	dev_code: string;
	title: string;
	status: PlanStatus;
	owner: string;
	priority: PlanPriority;
	priority_rank: number;
	created_at: string;
	updated_at: string;
	context: string;
	current_problem: string;
	target_state: string;
	scope: PlanScope;
	acceptance_criteria: string[];
	validation: string[];
	risk_notes?: string[];
	assumptions?: string[];
	decisions?: PlanDecision[];
	open_questions?: string[];
	dependencies?: string[];
	github?: {
		branches?: string[];
		prs?: Array<{ url: string; status?: string; note?: string }>;
	};
	todo_outputs?: string[];
	planning_target?: {
		scope: string;
		todo_tasks_path: string;
	};
	proposed_tasks?: ProposedTask[];
	incident_addendum?: {
		reported_at: string;
		reporter: string;
		authorization: string;
		observed_state: string;
	};
	links?: PlanLink[];
};

export type PlanRecord = {
	plan: MissionControlPlan;
	absolutePath: string;
	relativePath: string;
	workspacePath: string;
};

export type ValidationError = {
	path: string;
	message: string;
};

export type ValidationResult = {
	ok: boolean;
	errors: ValidationError[];
};

export function planSortKey(plan: MissionControlPlan): [number, string] {
	return [plan.priority_rank, plan.dev_code];
}

export function defaultPriorityRank(priority: PlanPriority): number {
	if (priority === 'urgent') return 1;
	if (priority === 'high') return 50;
	if (priority === 'medium') return 100;
	return 200;
}
