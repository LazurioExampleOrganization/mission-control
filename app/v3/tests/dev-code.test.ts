import { describe, expect, test } from 'bun:test';
import { buildNewPlanDraft } from '../src/create-plan.ts';
import { nextDevCode, nextDevCodeFromCodes } from '../src/dev-code.ts';
import { APP_ROOT, planCodeNumber } from '../src/paths.ts';

describe('Mission Control v3 plan code authoring', () => {
	test('generates the next DEV plan code from reserved codes', () => {
		expect(nextDevCodeFromCodes(['DEV-4294', 'DEV-4305', 'DEV-4406'])).toBe('DEV-4407');
	});

	test('ignores values that are not plan codes when reserving the next code', () => {
		expect(nextDevCodeFromCodes(['docs', 'DEV-0007', 'DEV-0010', 'DEV-XYZ'])).toBe('DEV-0011');
	});

	test('reserves textual DEV code mentions in generic template plans and ledgers', async () => {
		const result = await nextDevCode();
		expect(result.reserved_codes).toContain('DEV-0001');
		expect(planCodeNumber(result.next_dev_code)).toBeGreaterThan(planCodeNumber('DEV-0001'));
	});

	test('CLI next-dev-code matches the library reservation semantics', async () => {
		const spawned = Bun.spawnSync({
			cmd: ['bun', 'run', 'src/dev-code.ts'],
			cwd: APP_ROOT,
			// The fixture data roots come from the test preload; pass them on.
			env: process.env,
			stdout: 'pipe',
			stderr: 'pipe',
		});
		expect(spawned.exitCode).toBe(0);
		const payload = JSON.parse(new TextDecoder().decode(spawned.stdout).trim());
		expect(payload.next_dev_code).toBe((await nextDevCode()).next_dev_code);
	});

	test('builds a valid dry-run plan draft without writing files', async () => {
		const draft = await buildNewPlanDraft({
			title: 'Example Mission Control plan',
			devCode: 'DEV-0999',
			priority: 'high',
			priorityRank: 9,
			status: 'shaping',
			todoTasksPath: 'data/mission-control/TODO.tasks.json',
		});
		expect(draft.plan.id).toBe('mcplan-dev-0999');
		expect(draft.plan.dev_code).toBe('DEV-0999');
		expect(draft.plan.planning_target?.todo_tasks_path).toBe(
			'data/mission-control/TODO.tasks.json',
		);
		expect(draft.path).toContain('DEV-0999-example-mission-control-plan.yaml');
	});

	test('create-plan --apply is an explicit unsupported placeholder-draft path', () => {
		const result = Bun.spawnSync({
			cmd: [
				'bun',
				'run',
				'src/create-plan.ts',
				'--title',
				'Example Mission Control plan',
				'--dev-code',
				'DEV-0997',
				'--apply',
			],
			cwd: APP_ROOT,
			// The fixture data roots come from the test preload; pass them on.
			env: process.env,
			stdout: 'pipe',
			stderr: 'pipe',
		});
		expect(result.exitCode).toBe(1);
		expect(new TextDecoder().decode(result.stderr)).toContain(
			'create-plan --apply is intentionally unsupported',
		);
	});
});
