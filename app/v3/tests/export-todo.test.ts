import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
	appendTodoTasksToLedgerText,
	applyProposal,
	assertUnambiguousProposedTasks,
	assignTodoExportId,
	buildTodoExportProposal,
	normalizedJson,
	remapTodoTaskDependencies,
	type TodoExportTask,
} from '../src/export-todo.ts';

const exportTodoModuleUrl = pathToFileURL(
	path.resolve(import.meta.dir, '../src/export-todo.ts'),
).href;
const fixtureRoots: string[] = [];

type TodoExportProposal = Awaited<ReturnType<typeof buildTodoExportProposal>>;

function runApplyProposalProbe(
	proposal: TodoExportProposal,
	ledgers: {
		todo?: TodoExportTask[];
		done?: TodoExportTask[];
		todoAsArray?: boolean;
		doneAsArray?: boolean;
	} = {},
) {
	const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'mc-export-legacy-'));
	fixtureRoots.push(fixtureRoot);
	const workspaceRoot = path.join(fixtureRoot, 'organization');
	const missionControlRoot = path.join(workspaceRoot, 'mission-control');
	const dataRoot = path.join(workspaceRoot, 'data', 'mission-control');
	mkdirSync(missionControlRoot, { recursive: true });
	mkdirSync(path.join(dataRoot, 'plans'), { recursive: true });
	writeFileSync(
		path.join(missionControlRoot, 'mission-control.config.json'),
		`${JSON.stringify(
			{
				schema_version: 'companiesascode.mission_control.config.v1',
				plan_prefix: 'DEV',
				plans_dir: 'data/mission-control/plans',
				schema_path: 'schemas/mission-control-plan.schema.json',
				todo_tasks_path: 'data/mission-control/TODO.tasks.json',
				done_tasks_path: 'data/mission-control/DONE.tasks.json',
				issues_open_path: 'data/mission-control/ISSUES.open.json',
				issues_resolved_path: 'data/mission-control/ISSUES.resolved.json',
				organization_admin: 'organization-steward',
			},
			null,
			2,
		)}\n`,
	);
	const todoPath = path.join(dataRoot, 'TODO.tasks.json');
	writeLedger(todoPath, ledgers.todo ?? [], ledgers.todoAsArray === true);
	writeLedger(
		path.join(dataRoot, 'DONE.tasks.json'),
		ledgers.done ?? [],
		ledgers.doneAsArray === true,
	);
	for (const file of ['ISSUES.open.json', 'ISSUES.resolved.json']) {
		writeFileSync(path.join(dataRoot, file), '[]\n');
	}

	const child = Bun.spawnSync({
		cmd: [
			process.execPath,
			'--eval',
			`const { applyProposal } = await import(${JSON.stringify(exportTodoModuleUrl)}); const result = await applyProposal(JSON.parse(process.env.MISSION_CONTROL_TEST_PROPOSAL)); console.log(JSON.stringify(result));`,
		],
		env: {
			...process.env,
			MISSION_CONTROL_ROOT: missionControlRoot,
			MISSION_CONTROL_WORKSPACE_ROOT: workspaceRoot,
			MISSION_CONTROL_TEST_PROPOSAL: JSON.stringify(proposal),
		},
		stdout: 'pipe',
		stderr: 'pipe',
	});
	const stderr = new TextDecoder().decode(child.stderr);
	expect(stderr).toBe('');
	expect(child.exitCode).toBe(0);
	const persisted = JSON.parse(readFileSync(todoPath, 'utf8')) as
		| TodoExportTask[]
		| { tasks: TodoExportTask[] };
	return {
		result: JSON.parse(new TextDecoder().decode(child.stdout)),
		tasks: Array.isArray(persisted) ? persisted : persisted.tasks,
		ledgerIsArray: Array.isArray(persisted),
	};
}

afterEach(() => {
	for (const root of fixtureRoots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

describe('Mission Control v3 TODO export', () => {
	test('exports DEV-0001 TODO proposal with dev_code and planning reference', async () => {
		const proposal = await buildTodoExportProposal('DEV-0001');
		expect(proposal.dev_code).toBe('DEV-0001');
		expect(proposal.plan_id).toBe('mcplan-dev-0001');
		expect(proposal.plan_path).toBe(
			'data/mission-control/plans/2026/01/DEV-0001-template-runtime.yaml',
		);
		expect(proposal.proposed_tasks.length).toBeGreaterThan(0);
		for (const task of proposal.proposed_tasks) {
			expect(task.dev_code).toBe('DEV-0001');
			expect(task.source).toBe('mission-control');
			expect(task.planning.source).toBe('mission-control');
			expect(task.planning.plan_id).toBe('mcplan-dev-0001');
			expect(task.planning.path).toBe(proposal.plan_path);
			expect(task.tags).toContain('DEV-0001');
		}
	});

	test('preserves an explicit proposed-task priority reason', async () => {
		const proposal = await buildTodoExportProposal('DEV-0002');
		expect(proposal.proposed_tasks[0]?.priority_reason).toBe(
			'Keep the generic close-gate fixture active.',
		);
	});

	test('append apply preserves existing ledger formatting', () => {
		const raw = `{
  "schema_version": "companiesascode.todo_tasks.v1",
  "scope": {"id": "demo"},
  "tasks": [
    {
      "id": "task-2026-05-01-001",
      "title": "Existing",
      "tags": ["keep", "compact"]
    }
  ]
}
`;
		const task = sampleTodoTask({ id: 'task-2026-05-24-001', title: 'New task' });

		const next = appendTodoTasksToLedgerText(raw, [task], 1);
		expect(next).toContain('"tags": ["keep", "compact"]');
		expect(next).toContain('"id": "task-2026-05-24-001"');
		expect(JSON.parse(next).tasks).toHaveLength(2);
	});

	test('normalizedJson is stable across key order', () => {
		const a = {
			id: 'task-1',
			title: 'Sample',
			planning: { plan_id: 'mcplan-dev-4301', source: 'mission-control' },
		};
		const b = {
			planning: { source: 'mission-control', plan_id: 'mcplan-dev-4301' },
			title: 'Sample',
			id: 'task-1',
		};
		expect(normalizedJson(a)).toBe(normalizedJson(b));
	});

	test('remaps internal blocked_by ids and preserves external dependencies', () => {
		const tasks = [
			sampleTodoTask({
				id: 'task-2026-05-24-031',
				title: 'Dependent task',
				blocked_by: ['task-2026-05-24-030', 'task-2026-06-09-002'],
			}),
		];

		const remapped = remapTodoTaskDependencies(tasks, [
			{ from: 'task-2026-05-24-030', to: 'task-2026-05-24-099' },
		]);

		expect(remapped[0].blocked_by).toEqual(['task-2026-05-24-099', 'task-2026-06-09-002']);
	});

	test('assigns unique ids when multiple proposed tasks share a reservation', () => {
		const reservedId = 'task-2026-05-24-030';
		const takenIds = new Set([reservedId]);
		const assignedIds = new Set<string>();

		const firstId = assignTodoExportId(reservedId, undefined, '2026-05-24', takenIds, assignedIds);
		const secondId = assignTodoExportId(reservedId, undefined, '2026-05-24', takenIds, assignedIds);

		expect(firstId).toBe(reservedId);
		expect(secondId).toBe('task-2026-05-24-001');
		expect(assignedIds).toEqual(new Set([firstId, secondId]));
	});

	test('rejects duplicate proposed task identities before reservation lookup', () => {
		expect(() =>
			assertUnambiguousProposedTasks(
				[
					{ id: 'task-2026-05-24-030', title: 'Same task' },
					{ id: 'task-2026-05-24-031', title: ' same TASK ' },
				],
				'DEV-4997',
			),
		).not.toThrow();
		expect(() =>
			assertUnambiguousProposedTasks(
				[
					{ id: 'task-2026-05-24-030', title: 'Same task' },
					{ id: undefined, title: ' same TASK ' },
				],
				'DEV-4997',
			),
		).toThrow('ambiguous duplicate proposed task title');
		expect(() =>
			assertUnambiguousProposedTasks(
				[
					{ id: 'task-2026-05-24-030', title: 'First' },
					{ id: 'task-2026-05-24-030', title: 'Second' },
				],
				'DEV-4997',
			),
		).toThrow('duplicate proposed task id');
	});

	test('append apply keeps replacement tokens literal', () => {
		const raw = `{
  "schema_version": "companiesascode.todo_tasks.v1",
  "tasks": []
}
`;
		const task = sampleTodoTask({
			id: 'task-2026-05-24-002',
			title: 'Fix $& replacement token',
		});
		const next = appendTodoTasksToLedgerText(raw, [task], 0);
		const parsed = JSON.parse(next);
		expect(parsed.tasks[0].title).toBe('Fix $& replacement token');
	});

	test('repository-db apply rejects direct canonical TODO writes', async () => {
		await expect(
			applyProposal({
				plan_id: 'mcplan-dev-4997',
				dev_code: 'DEV-4997',
				plan_path: 'data/mission-control/plans/test.yaml',
				target: {
					scope: 'mission-control-test',
					todo_tasks_path: 'data/mission-control/TODO.tasks.json',
				},
				proposed_tasks: [
					sampleTodoTask({
						id: 'task-2026-07-18-999',
						title: 'Must use a changeset',
						dev_code: 'DEV-4997',
					}),
				],
			}),
		).rejects.toThrow(/repository_db_direct_write_blocked.*local draft.*reviewed revision/);
	});

	test('apply remints id held by a foreign task in another ledger', async () => {
		const foreign = sampleTodoTask({
			id: 'task-2026-05-24-020',
			title: 'Unrelated task from another plan',
			dev_code: 'DEV-4350',
			tags: ['DEV-4350', 'mission-control'],
			planning: {
				plan_id: 'mcplan-dev-4350',
				path: 'mission-control/plans/2026/06/DEV-4350.yaml',
				source: 'mission-control',
				role: 'planning_source',
			},
		});
		const { result, tasks } = runApplyProposalProbe(
			{
				plan_id: 'mcplan-dev-4997',
				dev_code: 'DEV-4997',
				plan_path: 'mission-control/plans/test.yaml',
				target: {
					scope: 'mission-control-test',
					todo_tasks_path: 'data/mission-control/TODO.tasks.json',
				},
				proposed_tasks: [
					sampleTodoTask({
						id: 'task-2026-05-24-020',
						title: 'Colliding plan task',
						dev_code: 'DEV-4997',
						planning: {
							plan_id: 'mcplan-dev-4997',
							path: 'mission-control/plans/test.yaml',
							source: 'mission-control',
							role: 'planning_source',
						},
					}),
					sampleTodoTask({
						id: 'task-2026-05-24-022',
						title: 'Dependent plan task',
						dev_code: 'DEV-4997',
						blocked_by: ['task-2026-05-24-020', 'task-2026-06-09-002'],
						planning: {
							plan_id: 'mcplan-dev-4997',
							path: 'mission-control/plans/test.yaml',
							source: 'mission-control',
							role: 'planning_source',
						},
					}),
				],
			},
			{ done: [foreign] },
		);

		expect(result.added).toBe(2);
		expect(tasks).toHaveLength(2);
		const colliding = tasks.find((task) => task.title === 'Colliding plan task');
		const dependent = tasks.find((task) => task.title === 'Dependent plan task');
		expect(colliding?.id).not.toBe('task-2026-05-24-020');
		expect(dependent?.blocked_by).toEqual([colliding?.id, 'task-2026-06-09-002']);
		// The old -> new mapping is surfaced to the caller.
		expect(result.reminted).toEqual([{ from: 'task-2026-05-24-020', to: colliding?.id }]);
	});

	test('apply reserves ids from canonical array-form ledgers', () => {
		const foreign = sampleTodoTask({
			id: 'task-2026-05-24-020',
			title: 'Canonical array task',
			dev_code: 'DEV-4350',
			planning: {
				plan_id: 'mcplan-dev-4350',
				path: 'mission-control/plans/2026/05/DEV-4350.yaml',
				source: 'mission-control',
				role: 'planning_source',
			},
		});
		const { result } = runApplyProposalProbe(
			{
				plan_id: 'mcplan-dev-4997',
				dev_code: 'DEV-4997',
				plan_path: 'mission-control/plans/test.yaml',
				target: {
					scope: 'mission-control-test',
					todo_tasks_path: 'data/mission-control/TODO.tasks.json',
				},
				proposed_tasks: [
					sampleTodoTask({
						id: foreign.id,
						title: 'Replacement task',
						dev_code: 'DEV-4997',
						planning: {
							plan_id: 'mcplan-dev-4997',
							path: 'mission-control/plans/test.yaml',
							source: 'mission-control',
							role: 'planning_source',
						},
					}),
				],
			},
			{ done: [foreign], doneAsArray: true },
		);

		expect(result.reminted).toHaveLength(1);
		expect(result.reminted[0]?.from).toBe(foreign.id);
	});

	test('apply reserves each reminted id before the next foreign collision', async () => {
		const foreignA = sampleTodoTask({
			id: 'task-2026-05-24-020',
			title: 'Foreign task A',
			dev_code: 'DEV-4350',
			planning: {
				plan_id: 'mcplan-dev-4350',
				path: 'mission-control/plans/2026/06/DEV-4350.yaml',
				source: 'mission-control',
				role: 'planning_source',
			},
		});
		const foreignB = sampleTodoTask({
			id: 'task-2026-05-24-021',
			title: 'Foreign task B',
			dev_code: 'DEV-4351',
			planning: {
				plan_id: 'mcplan-dev-4351',
				path: 'mission-control/plans/2026/06/DEV-4351.yaml',
				source: 'mission-control',
				role: 'planning_source',
			},
		});
		const { result, tasks } = runApplyProposalProbe(
			{
				plan_id: 'mcplan-dev-4997',
				dev_code: 'DEV-4997',
				plan_path: 'mission-control/plans/test.yaml',
				target: {
					scope: 'mission-control-test',
					todo_tasks_path: 'data/mission-control/TODO.tasks.json',
				},
				proposed_tasks: [
					sampleTodoTask({
						id: foreignA.id,
						title: 'Replacement task A',
						dev_code: 'DEV-4997',
						planning: {
							plan_id: 'mcplan-dev-4997',
							path: 'mission-control/plans/test.yaml',
							source: 'mission-control',
							role: 'planning_source',
						},
					}),
					sampleTodoTask({
						id: foreignB.id,
						title: 'Replacement task B',
						dev_code: 'DEV-4997',
						planning: {
							plan_id: 'mcplan-dev-4997',
							path: 'mission-control/plans/test.yaml',
							source: 'mission-control',
							role: 'planning_source',
						},
					}),
				],
			},
			{ done: [foreignA, foreignB] },
		);

		expect(result.reminted).toHaveLength(2);
		expect(new Set(result.reminted.map(({ to }: { to: string }) => to)).size).toBe(2);
		expect(new Set(tasks.map((task: TodoExportTask) => task.id)).size).toBe(2);
		expect(tasks.map((task: TodoExportTask) => task.id).sort()).toEqual(
			result.reminted.map(({ to }: { to: string }) => to).sort(),
		);
	});

	test('apply remaps blocked_by on a touched existing task', () => {
		const foreign = sampleTodoTask({
			id: 'task-2026-05-24-020',
			title: 'Foreign blocker',
			dev_code: 'DEV-4350',
			planning: {
				plan_id: 'mcplan-dev-4350',
				path: 'mission-control/plans/2026/06/DEV-4350.yaml',
				source: 'mission-control',
				role: 'planning_source',
			},
		});
		const dependent = sampleTodoTask({
			id: 'task-2026-05-24-022',
			title: 'Existing dependent task',
			dev_code: 'DEV-4997',
			blocked_by: ['task-2026-05-24-020'],
			planning: {
				plan_id: 'mcplan-dev-4997',
				path: 'mission-control/plans/test.yaml',
				source: 'mission-control',
				role: 'planning_source',
			},
		});
		const { result, tasks } = runApplyProposalProbe(
			{
				plan_id: 'mcplan-dev-4997',
				dev_code: 'DEV-4997',
				plan_path: 'mission-control/plans/test.yaml',
				target: {
					scope: 'mission-control-test',
					todo_tasks_path: 'data/mission-control/TODO.tasks.json',
				},
				proposed_tasks: [
					sampleTodoTask({
						id: 'task-2026-05-24-020',
						title: 'Replacement blocker',
						dev_code: 'DEV-4997',
						planning: {
							plan_id: 'mcplan-dev-4997',
							path: 'mission-control/plans/test.yaml',
							source: 'mission-control',
							role: 'planning_source',
						},
					}),
					dependent,
				],
			},
			{ todo: [dependent], done: [foreign] },
		);

		const replacementId = result.reminted[0]?.to;
		expect(result).toMatchObject({ added: 1, updated: 1 });
		expect(tasks.find((task) => task.id === dependent.id)?.blocked_by).toEqual([replacementId]);
	});

	test('apply keeps a same-plan task that already lives in another ledger', async () => {
		const alreadyExported = sampleTodoTask({
			id: 'task-2026-05-24-021',
			title: 'Task exported before retarget',
			dev_code: 'DEV-4997',
			planning: {
				plan_id: 'mcplan-dev-4997',
				path: 'mission-control/plans/test.yaml',
				source: 'mission-control',
				role: 'planning_source',
			},
		});
		const { result, tasks } = runApplyProposalProbe(
			{
				plan_id: 'mcplan-dev-4997',
				dev_code: 'DEV-4997',
				plan_path: 'mission-control/plans/test.yaml',
				target: {
					scope: 'mission-control-test',
					todo_tasks_path: 'data/mission-control/TODO.tasks.json',
				},
				proposed_tasks: [alreadyExported],
			},
			{ done: [alreadyExported] },
		);

		expect(result).toEqual({
			target_path: 'data/mission-control/TODO.tasks.json',
			added: 0,
			updated: 0,
			reminted: [],
		});
		expect(tasks).toHaveLength(0);
	});

	test('apply writes additions even when another task is updated', async () => {
		const existing = sampleTodoTask({
			id: 'task-2026-05-24-010',
			title: 'Existing',
			summary: 'Old summary',
			dev_code: 'DEV-4997',
			planning: {
				plan_id: 'mcplan-dev-4997',
				path: 'mission-control/plans/test.yaml',
				source: 'mission-control',
				role: 'planning_source',
			},
		});
		const { result, tasks } = runApplyProposalProbe(
			{
				plan_id: 'mcplan-dev-4997',
				dev_code: 'DEV-4997',
				plan_path: 'mission-control/plans/test.yaml',
				target: {
					scope: 'mission-control-test',
					todo_tasks_path: 'data/mission-control/TODO.tasks.json',
				},
				proposed_tasks: [
					sampleTodoTask({
						id: 'task-2026-05-24-010',
						title: 'Existing',
						summary: 'Updated summary',
						dev_code: 'DEV-4997',
						planning: existing.planning,
					}),
					sampleTodoTask({
						id: 'task-2026-05-24-011',
						title: 'New',
						summary: 'New summary',
						dev_code: 'DEV-4997',
						planning: existing.planning,
					}),
				],
			},
			{ todo: [existing] },
		);

		expect(result).toEqual({
			target_path: 'data/mission-control/TODO.tasks.json',
			added: 1,
			updated: 1,
			reminted: [],
		});
		expect(tasks).toHaveLength(2);
		expect(tasks.map((task: TodoExportTask) => task.id)).toContain('task-2026-05-24-011');
	});

	test('apply preserves a foreign target task and remints the proposal', () => {
		const foreign = sampleTodoTask({
			id: 'task-2026-05-24-010',
			title: 'Foreign target task',
			dev_code: 'DEV-4350',
			planning: {
				plan_id: 'mcplan-dev-4350',
				path: 'mission-control/plans/2026/06/DEV-4350.yaml',
				source: 'mission-control',
				role: 'planning_source',
			},
		});
		const proposalTask = sampleTodoTask({
			id: foreign.id,
			title: 'Proposal task',
			dev_code: 'DEV-4997',
			planning: {
				plan_id: 'mcplan-dev-4997',
				path: 'mission-control/plans/test.yaml',
				source: 'mission-control',
				role: 'planning_source',
			},
		});

		const { result, tasks } = runApplyProposalProbe(
			{
				plan_id: 'mcplan-dev-4997',
				dev_code: 'DEV-4997',
				plan_path: 'mission-control/plans/test.yaml',
				target: {
					scope: 'mission-control-test',
					todo_tasks_path: 'data/mission-control/TODO.tasks.json',
				},
				proposed_tasks: [proposalTask],
			},
			{ todo: [foreign] },
		);

		expect(result).toMatchObject({ added: 1, updated: 0 });
		expect(result.reminted).toHaveLength(1);
		expect(tasks).toHaveLength(2);
		expect(tasks.find((task) => task.id === foreign.id)?.title).toBe('Foreign target task');
		expect(tasks.find((task) => task.id === result.reminted[0].to)?.title).toBe('Proposal task');
	});

	test('apply preserves an array-root TODO ledger', () => {
		const proposalTask = sampleTodoTask({
			id: 'task-2026-05-24-011',
			title: 'Array proposal task',
		});
		const { result, tasks, ledgerIsArray } = runApplyProposalProbe(
			{
				plan_id: 'mcplan-dev-4327',
				dev_code: 'DEV-4327',
				plan_path: 'mission-control/plans/test.yaml',
				target: {
					scope: 'mission-control-test',
					todo_tasks_path: 'data/mission-control/TODO.tasks.json',
				},
				proposed_tasks: [proposalTask],
			},
			{ todoAsArray: true },
		);

		expect(result).toMatchObject({ added: 1, updated: 0 });
		expect(ledgerIsArray).toBe(true);
		expect(tasks).toEqual([proposalTask]);
	});
});

function writeLedger(ledgerPath: string, tasks: TodoExportTask[], arrayRoot = false): void {
	mkdirSync(path.dirname(ledgerPath), { recursive: true });
	writeFileSync(
		ledgerPath,
		`${JSON.stringify(
			arrayRoot
				? tasks
				: {
						schema_version: 'companiesascode.todo_tasks.v1',
						scope: { id: 'mission-control-test' },
						tasks,
					},
			null,
			2,
		)}\n`,
	);
}

function sampleTodoTask(overrides: Partial<TodoExportTask> = {}): TodoExportTask {
	return {
		id: 'task-2026-05-24-001',
		title: 'New task',
		status: 'open',
		priority: 'high',
		priority_rank: 50,
		assignee: 'agent',
		priority_decider: 'workspace-admin',
		priority_reason: 'Reason',
		created_at: '2026-05-24',
		updated_at: '2026-05-24',
		tags: ['DEV-4327', 'mission-control'],
		dev_code: 'DEV-4327',
		summary: 'Summary',
		risk_notes: [],
		acceptance_criteria: ['Done'],
		links: [],
		planning: {
			plan_id: 'mcplan-dev-4327',
			path: 'mission-control/plans/2026/05/DEV-4327.yaml',
			source: 'mission-control',
			role: 'planning_source',
		},
		source: 'mission-control',
		...overrides,
	};
}
