import type { PlanStatus } from '../model.ts';

export type PageId =
	| 'roadmaps'
	| 'plans-all'
	| 'plans-shaping'
	| 'plans-ready'
	| 'plans-in-progress'
	| 'plans-review'
	| 'plans-done'
	| 'plans-archived'
	| 'agent-work'
	| 'work-board'
	| 'planning-coverage'
	| 'proposals'
	| 'repository'
	| 'validate'
	| 'new-plan';

export type IconName =
	| 'roadmap'
	| 'shaping'
	| 'ready'
	| 'in-progress'
	| 'review'
	| 'done'
	| 'archived'
	| 'agent-work'
	| 'coverage'
	| 'check'
	| 'plus'
	| 'board';

export type NavItem = { id: PageId; label: string; icon: IconName };

export type NavSection = {
	label: string;
	items: NavItem[];
};

export const navSections: NavSection[] = [
	{
		label: 'Roadmapy',
		items: [{ id: 'roadmaps', label: 'Roadmaps', icon: 'roadmap' }],
	},
	{
		label: 'Plány',
		items: [
			{ id: 'plans-all', label: 'Všechny', icon: 'roadmap' },
			{ id: 'plans-shaping', label: 'Shaping', icon: 'shaping' },
			{ id: 'plans-ready', label: 'Ready', icon: 'ready' },
			{ id: 'plans-in-progress', label: 'In progress', icon: 'in-progress' },
			{ id: 'plans-review', label: 'Review', icon: 'review' },
			{ id: 'plans-done', label: 'Done', icon: 'done' },
			{ id: 'plans-archived', label: 'Archived', icon: 'archived' },
		],
	},
	{
		label: 'Design',
		items: [{ id: 'proposals', label: 'Proposals', icon: 'shaping' }],
	},
	{
		label: 'Agenti',
		items: [{ id: 'agent-work', label: 'Agent work', icon: 'agent-work' }],
	},
	{
		label: 'Linked work',
		items: [
			{ id: 'work-board', label: 'Work board', icon: 'board' },
			{ id: 'planning-coverage', label: 'Planning coverage', icon: 'coverage' },
		],
	},
	{
		label: 'Nástroje',
		items: [
			{ id: 'new-plan', label: 'Nový plán', icon: 'plus' },
			{ id: 'repository', label: 'Publish', icon: 'check' },
			{ id: 'validate', label: 'Validovat', icon: 'check' },
		],
	},
];

export const STATUS_FILTER_TO_PLAN_STATUS: Record<
	Exclude<
		PageId,
		| 'roadmaps'
		| 'plans-all'
		| 'agent-work'
		| 'work-board'
		| 'planning-coverage'
		| 'proposals'
		| 'repository'
		| 'validate'
		| 'new-plan'
	>,
	PlanStatus
> = {
	'plans-shaping': 'shaping',
	'plans-ready': 'ready',
	'plans-in-progress': 'in_progress',
	'plans-review': 'review',
	'plans-done': 'done',
	'plans-archived': 'archived',
};
