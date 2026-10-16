import { describe, expect, test } from 'bun:test';
import type { MissionControlPlan, PlanRecord } from '../src/model.ts';
import {
	attachPlanningState,
	buildPlanningCoverage,
	buildTodoOutputMaterializationWarnings,
	type RawWorkItem,
} from '../src/work-board.ts';

function planRecord(devCode: 'ACME-7001' | 'ACME-7002'): PlanRecord {
	const number = devCode.slice('ACME-'.length).toLowerCase();
	const plan: MissionControlPlan = {
		schema_version: 'companiesascode.mission_control.plan.v2',
		id: `mcplan-acme-${number}`,
		dev_code: devCode,
		title: `Plan ${devCode}`,
		status: 'ready',
		owner: 'workspace-admin',
		priority: 'high',
		priority_rank: 10,
		created_at: '2026-05-24',
		updated_at: '2026-05-24',
		context: 'Test context',
		current_problem: 'Test problem',
		target_state: 'Test target',
		scope: { in: ['Test scope'], out: ['Out of scope'] },
		acceptance_criteria: ['Done'],
		validation: ['bun test'],
	};
	return {
		plan,
		absolutePath: `/workspace/mission-control/plans/2026/05/${devCode}.yaml`,
		relativePath: `plans/2026/05/${devCode}.yaml`,
		workspacePath: `mission-control/plans/2026/05/${devCode}.yaml`,
	};
}

function item(input: Partial<RawWorkItem> & Pick<RawWorkItem, 'id'>): RawWorkItem {
	return {
		kind: 'todo',
		title: 'Task',
		status: 'open',
		ledger_path: 'TODO.tasks.json',
		...input,
	};
}

describe('Mission Control work-board planning coverage', () => {
	test('verifies task planning links against real plans', () => {
		const records = [planRecord('ACME-7001'), planRecord('ACME-7002')];
		const items = attachPlanningState(
			[
				item({
					id: 'linked',
					dev_code: 'ACME-7001',
					planning: {
						source: 'mission-control',
						plan_id: 'mcplan-acme-7001',
						path: 'mission-control/plans/2026/05/ACME-7001.yaml',
					},
				}),
				item({
					id: 'missing',
					dev_code: 'ACME-7999',
					planning: {
						source: 'mission-control',
						plan_id: 'mcplan-acme-7999',
					},
				}),
				item({
					id: 'mismatch',
					dev_code: 'ACME-7002',
					planning: {
						source: 'mission-control',
						plan_id: 'mcplan-acme-7001',
					},
				}),
				item({
					id: 'missing-dev-code',
					planning: {
						source: 'mission-control',
						plan_id: 'mcplan-acme-7001',
					},
				}),
				item({
					id: 'issue-without-dev-code',
					kind: 'issue',
					planning: {
						source: 'mission-control',
						plan_id: 'mcplan-acme-7001',
					},
				}),
				item({ id: 'unplanned' }),
			],
			records,
		);

		expect(items.find((row) => row.id === 'linked')?.has_plan).toBe(true);
		expect(items.find((row) => row.id === 'linked')?.plan?.dev_code).toBe('ACME-7001');
		expect(items.find((row) => row.id === 'missing')?.planning_status).toBe('missing_plan');
		expect(items.find((row) => row.id === 'mismatch')?.planning_status).toBe('dev_code_mismatch');
		expect(
			items.find((row) => row.id === 'mismatch')?.planning_errors?.map((error) => error.code),
		).toContain('planning_references_disagree');
		expect(items.find((row) => row.id === 'missing-dev-code')?.planning_status).toBe(
			'missing_dev_code',
		);
		expect(items.find((row) => row.id === 'issue-without-dev-code')?.has_plan).toBe(true);
		expect(items.find((row) => row.id === 'unplanned')?.planning_status).toBe('none');
	});

	test('summarizes broken links and ledger read errors', () => {
		const records = [planRecord('ACME-7001')];
		const items = attachPlanningState(
			[
				item({
					id: 'linked',
					dev_code: 'ACME-7001',
					planning: { source: 'mission-control', plan_id: 'mcplan-acme-7001' },
				}),
				item({
					id: 'missing',
					dev_code: 'ACME-7999',
					planning: { source: 'mission-control', plan_id: 'mcplan-acme-7999' },
				}),
				item({ id: 'legacy-dev-gap', dev_code: 'ACME-7998' }),
				item({ id: 'unplanned' }),
			],
			records,
		);

		const coverage = buildPlanningCoverage(items, [
			{ ledger_path: 'broken/TODO.tasks.json', message: 'Unexpected token' },
		]);

		expect(coverage.todo_total).toBe(4);
		expect(coverage.todo_with_plan).toBe(1);
		expect(coverage.todo_without_plan).toBe(3);
		expect(coverage.dev_without_plan).toHaveLength(2);
		expect(coverage.broken_plan_links).toHaveLength(1);
		expect(coverage.ledger_read_errors).toHaveLength(1);
	});

	test('warns when plan todo_outputs point at missing materialized TODO/DONE rows', () => {
		const [record] = [planRecord('ACME-7001')];
		record.plan.todo_outputs = ['materialized-todo', 'materialized-done', 'phantom-task'];
		record.plan.planning_target = {
			scope: 'companiesascode-root',
			todo_tasks_path: 'TODO.tasks.json',
		};

		const warnings = buildTodoOutputMaterializationWarnings({
			records: [record],
			items: [
				item({ id: 'materialized-todo', kind: 'todo', ledger_path: 'TODO.tasks.json' }),
				item({ id: 'materialized-done', kind: 'done', ledger_path: 'DONE.tasks.json' }),
				item({ id: 'issue-is-not-task-output', kind: 'issue', ledger_path: 'ISSUES.open.json' }),
			],
			scannedLedgerPaths: ['TODO.tasks.json', 'DONE.tasks.json', 'ISSUES.open.json'],
		});

		expect(warnings).toEqual([
			{
				code: 'missing_todo_output',
				severity: 'warning',
				plan_id: 'mcplan-acme-7001',
				dev_code: 'ACME-7001',
				plan_path: 'mission-control/plans/2026/05/ACME-7001.yaml',
				output_id: 'phantom-task',
				message:
					'ACME-7001 todo_outputs references phantom-task, but no TODO/DONE ledger row with that id was scanned.',
			},
		]);
	});

	test('classifies missing todo_outputs as unscanned when the planning target ledger is unavailable', () => {
		const [record] = [planRecord('ACME-7001')];
		record.plan.todo_outputs = ['module-task'];
		record.plan.planning_target = {
			scope: 'warehouse',
			todo_tasks_path: 'modules/warehouse/TODO.tasks.json',
		};

		const warnings = buildTodoOutputMaterializationWarnings({
			records: [record],
			items: [item({ id: 'root-task', kind: 'todo', ledger_path: 'TODO.tasks.json' })],
			scannedLedgerPaths: ['TODO.tasks.json', 'DONE.tasks.json'],
		});

		expect(warnings).toEqual([
			{
				code: 'unscanned_planning_target',
				severity: 'warning',
				plan_id: 'mcplan-acme-7001',
				dev_code: 'ACME-7001',
				plan_path: 'mission-control/plans/2026/05/ACME-7001.yaml',
				output_id: 'module-task',
				planning_target: 'modules/warehouse/TODO.tasks.json',
				message:
					'ACME-7001 todo_outputs references module-task, but planning target modules/warehouse/TODO.tasks.json was not scanned; materialization cannot be verified.',
			},
		]);
	});
});
