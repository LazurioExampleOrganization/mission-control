import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { type MissionControlPlan, PLAN_SCHEMA_VERSION } from '../src/model.ts';
import { MISSION_CONTROL_DATA_ROOT, WORKSPACE_ROOT } from '../src/paths.ts';
import { assertDirectCanonicalWriteAllowed, readPlanRecord, updatePlanYaml } from '../src/store.ts';

function curatedPlan(overrides: Partial<MissionControlPlan> = {}): MissionControlPlan {
	return {
		schema_version: PLAN_SCHEMA_VERSION,
		id: 'mcplan-dev-7996',
		dev_code: 'DEV-7996',
		title: 'Curated store validation test',
		status: 'ready',
		owner: 'agent',
		priority: 'medium',
		priority_rank: 100,
		created_at: '2026-05-24',
		updated_at: '2026-05-24',
		context: 'Curated context with enough detail for a standalone plan.',
		current_problem: 'Direct store writes must not bypass plan validation gates.',
		target_state: 'Only shape-valid and quality-valid YAML can replace a stored plan.',
		scope: {
			in: ['Validate updatePlanYaml at the store boundary.'],
			out: ['Do not test unrelated HTTP update behavior here.'],
		},
		acceptance_criteria: ['Invalid YAML payloads are rejected before replacing the file.'],
		validation: ['bun test tests/store.test.ts'],
		risk_notes: [],
		assumptions: [],
		decisions: [],
		open_questions: [],
		dependencies: [],
		github: { branches: [], prs: [] },
		todo_outputs: [],
		links: [],
		...overrides,
	};
}

describe('Mission Control v2 plan store', () => {
	test('repository-db canonical paths reject direct writes', () => {
		expect(() =>
			assertDirectCanonicalWriteAllowed(
				path.join(MISSION_CONTROL_DATA_ROOT, 'data/mission-control/plans/2026/07/DEV-7996.yaml'),
			),
		).toThrow(/repository_db_direct_write_blocked.*local draft.*reviewed revision/);
	});

	test('readPlanRecord rejects non-canonical YAML plan extensions', async () => {
		const dir = mkdtempSync(path.join(WORKSPACE_ROOT, '.tmp-mc-store-'));
		try {
			for (const extension of ['.yml', '.YAML', '.YML']) {
				const filePath = path.join(dir, `DEV-7996${extension}`);
				writeFileSync(filePath, stringifyYaml(curatedPlan()));
				await expect(readPlanRecord(filePath)).rejects.toThrow(
					/canonical plan extension must be \.yaml/,
				);
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test('updatePlanYaml rejects shape-invalid YAML before replacing the file', async () => {
		const dir = mkdtempSync(path.join(WORKSPACE_ROOT, '.tmp-mc-store-'));
		try {
			const filePath = path.join(dir, 'plan.yaml');
			const original = stringifyYaml(curatedPlan());
			writeFileSync(filePath, original);

			await expect(updatePlanYaml(filePath, 'dev_code: DEV-7996\n')).rejects.toThrow(
				/Invalid plan/,
			);
			expect(readFileSync(filePath, 'utf8')).toBe(original);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test('updatePlanYaml rejects quality-invalid placeholders before replacing the file', async () => {
		const dir = mkdtempSync(path.join(WORKSPACE_ROOT, '.tmp-mc-store-'));
		try {
			const filePath = path.join(dir, 'plan.yaml');
			const original = stringifyYaml(curatedPlan());
			writeFileSync(filePath, original);

			const placeholder = stringifyYaml(
				curatedPlan({
					context: 'Doplnit kontext plánu tak, aby byl čitelný bez původního chatu.',
				}),
			);
			await expect(updatePlanYaml(filePath, placeholder)).rejects.toThrow(/failed quality gate/);
			expect(readFileSync(filePath, 'utf8')).toBe(original);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test('updatePlanYaml rejects duplicate and merge keys', async () => {
		const dir = mkdtempSync(path.join(WORKSPACE_ROOT, '.tmp-mc-store-'));
		try {
			const filePath = path.join(dir, 'plan.yaml');
			const original = stringifyYaml(curatedPlan());
			writeFileSync(filePath, original);

			await expect(
				updatePlanYaml(filePath, `${original}\ntitle: Duplicate title\n`),
			).rejects.toThrow(/keys must be unique/i);
			await expect(updatePlanYaml(filePath, `${original}\n<<: {}\n`)).rejects.toThrow(
				/Invalid plan/,
			);
			expect(readFileSync(filePath, 'utf8')).toBe(original);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
