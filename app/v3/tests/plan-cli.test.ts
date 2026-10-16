import { describe, expect, test } from 'bun:test';
import { parseArgs, planSnapshot, renderStatusText, renderWorkText } from '../src/plan-cli.ts';
import { listPlanRecords } from '../src/store.ts';
import { buildPlanWork } from '../src/work-board.ts';

describe('Mission Control plan CLI', () => {
	test('parseArgs reads subcommand, dev_code, format and help', () => {
		expect(parseArgs(['bun', 'plan-cli.ts', 'status', 'DEV-0001'])).toEqual({
			subcommand: 'status',
			devCode: 'DEV-0001',
			format: 'text',
			help: false,
			rest: [],
		});
		expect(
			parseArgs(['bun', 'plan-cli.ts', 'check', 'DEV-0001', '--format', 'json']),
		).toMatchObject({ subcommand: 'check', devCode: 'DEV-0001', format: 'json' });
		expect(parseArgs(['bun', 'plan-cli.ts', 'close', 'DEV-0001', '--help'])).toMatchObject({
			subcommand: 'close',
			devCode: 'DEV-0001',
			help: true,
		});
	});

	test('planSnapshot keeps the agent-relevant fields', async () => {
		const record = (await listPlanRecords()).find((r) => r.plan.dev_code === 'DEV-0001');
		if (!record) throw new Error('DEV-0001 plan missing');
		const snapshot = planSnapshot(record.plan);
		expect(snapshot.dev_code).toBe('DEV-0001');
		expect(snapshot.id).toBe('mcplan-dev-0001');
		expect(snapshot.priority_rank).toBeGreaterThan(0);
		const text = renderStatusText(snapshot);
		expect(text).toContain('DEV-0001');
		expect(text).toContain('status:');
	});

	test('buildPlanWork blocks close when linked open TODO remain', async () => {
		const record = (await listPlanRecords()).find((r) => r.plan.dev_code === 'DEV-0002');
		if (!record) throw new Error('DEV-0002 plan missing');
		const work = await buildPlanWork(record);
		expect(work.todo_open.map((todo) => todo.id)).toContain('task-2026-01-01-001');
		expect(work.close_blockers.length).toBeGreaterThan(0);
		expect(renderWorkText(work)).toContain('Open TODO:');
	});
});
