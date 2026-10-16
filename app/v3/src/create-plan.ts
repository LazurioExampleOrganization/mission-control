import { nextDevCode } from './dev-code.ts';
import {
	DEFAULT_PLAN_OWNER,
	defaultPriorityRank,
	type MissionControlPlan,
	PLAN_PRIORITIES,
	PLAN_SCHEMA_VERSION,
	PLAN_STATUSES,
	type PlanPriority,
	type PlanStatus,
} from './model.ts';
import { PLAN_CODE_PLACEHOLDER, planIdFromCode, workspaceRelative } from './paths.ts';
import { getPlanByIdOrDevCode, planFilePathForDevCode } from './store.ts';
import { validatePlanShape } from './validate.ts';

function argValue(name: string): string | undefined {
	const index = process.argv.indexOf(name);
	return index === -1 ? undefined : process.argv[index + 1];
}

function today(): string {
	return new Date().toISOString().slice(0, 10);
}

function parseStatus(value: string | undefined): PlanStatus {
	if (!value) return 'shaping';
	if ((PLAN_STATUSES as readonly string[]).includes(value)) return value as PlanStatus;
	throw new Error(`Invalid --status ${value}`);
}

function parsePriority(value: string | undefined): PlanPriority {
	if (!value) return 'medium';
	if ((PLAN_PRIORITIES as readonly string[]).includes(value)) {
		return value as PlanPriority;
	}
	throw new Error(`Invalid --priority ${value}`);
}

function parsePriorityRank(value: string | undefined, priority: PlanPriority): number {
	if (value) {
		const parsed = Number(value);
		if (Number.isInteger(parsed) && parsed > 0) return parsed;
		throw new Error(`Invalid --priority-rank ${value}`);
	}
	return defaultPriorityRank(priority);
}

export async function buildNewPlanDraft(args: {
	title: string;
	devCode?: string;
	owner?: string;
	status?: PlanStatus;
	priority?: PlanPriority;
	priorityRank?: number;
	todoTasksPath?: string;
	scope?: string;
}): Promise<{ plan: MissionControlPlan; path: string }> {
	const devCode = args.devCode ?? (await nextDevCode()).next_dev_code;
	if (await getPlanByIdOrDevCode(devCode)) {
		throw new Error(`Plan already exists for ${devCode}`);
	}
	const date = today();
	const id = planIdFromCode(devCode);
	const priority = args.priority ?? 'medium';
	const plan: MissionControlPlan = {
		schema_version: PLAN_SCHEMA_VERSION,
		id,
		dev_code: devCode,
		title: args.title,
		status: args.status ?? 'shaping',
		owner: args.owner ?? DEFAULT_PLAN_OWNER,
		priority,
		priority_rank: args.priorityRank ?? parsePriorityRank(undefined, priority),
		created_at: date,
		updated_at: date,
		context: 'Doplnit pro koho změna vzniká a proč; plán musí být čitelný bez původního chatu.',
		current_problem: 'Doplnit aktuální problém a proč se práce řeší teď.',
		target_state:
			'Doplnit chtěné schopnosti, milníky a pevné hranice výsledku. Detaily provedení nechat otevřené.',
		scope: {
			in: ['Doplnit nezbytné výsledky a hranice, které implementace musí zachovat.'],
			out: ['Doplnit co lze ořezat nebo odložit a kde má implementátor volnost.'],
		},
		acceptance_criteria: ['Doplnit scénáře skutečného consumera včetně důležitých selhání.'],
		validation: [
			'Před implementací ověřit kontrakt chování v owning code repu; uvést testy a důkazy nebo zdůvodněnou výjimku.',
		],
		risk_notes: [],
		assumptions: [],
		decisions: [],
		open_questions: [],
		dependencies: [],
		github: { branches: [], prs: [] },
		todo_outputs: [],
		links: [],
	};
	if (args.todoTasksPath) {
		plan.planning_target = {
			scope: args.scope ?? 'companiesascode-root',
			todo_tasks_path: args.todoTasksPath,
		};
		plan.proposed_tasks = [];
	}

	const validation = validatePlanShape(plan);
	if (!validation.ok) {
		throw new Error(
			`Draft plan is invalid: ${validation.errors.map((error) => `${error.path}: ${error.message}`).join(', ')}`,
		);
	}

	return {
		plan,
		path: planFilePathForDevCode(devCode, args.title),
	};
}

if (import.meta.main) {
	const title = argValue('--title');
	if (!title) {
		console.error(
			`Usage: bun run create-plan -- --title "Plan title" [--priority high] [--priority-rank 10] [--status shaping] [--dev-code ${PLAN_CODE_PLACEHOLDER}] [--todo TODO.tasks.json]`,
		);
		process.exit(1);
	}
	if (process.argv.includes('--apply')) {
		console.error(
			'create-plan --apply is intentionally unsupported: generated drafts contain curation placeholders. Run without --apply, fill the YAML in the UI/editor, then save the curated plan.',
		);
		process.exit(1);
	}
	const priority = parsePriority(argValue('--priority'));
	const draft = await buildNewPlanDraft({
		title,
		devCode: argValue('--dev-code')?.toUpperCase(),
		owner: argValue('--owner'),
		status: parseStatus(argValue('--status')),
		priority,
		priorityRank: parsePriorityRank(argValue('--priority-rank'), priority),
		todoTasksPath: argValue('--todo'),
		scope: argValue('--scope'),
	});
	console.log(
		JSON.stringify(
			{
				status: 'dry-run',
				dev_code: draft.plan.dev_code,
				plan_path: workspaceRelative(draft.path),
				plan: draft.plan,
			},
			null,
			2,
		),
	);
}
