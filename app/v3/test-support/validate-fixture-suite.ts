// This file is intentionally outside Bun's default test discovery. The
// consumer smoke launches it in a fresh process with explicit temporary
// Mission Control roots, so its generic DEV fixture can never bind to live
// Organization data through the module cache or ambient process state.
import { describe, expect, test } from 'bun:test';
import type { PlanRecord } from '../src/model.ts';
import { MISSION_CONTROL_DATA_ROOT, PLAN_CODE_RE, WORKSPACE_ROOT } from '../src/paths.ts';
import { listPlanRecords, listPlanRecordsForValidation } from '../src/store.ts';
import {
	allowsMissingDeclaredPlanningTarget,
	planQualityErrors,
	validatePlanRecords,
	validatePlanShape,
	validatePlanUpdate,
} from '../src/validate.ts';

async function validateAllPlans() {
	const { records, errors: fileErrors } = await listPlanRecordsForValidation();
	const validation = validatePlanRecords(records);
	return {
		ok: fileErrors.length === 0 && validation.ok,
		errors: [...fileErrors, ...validation.errors],
	};
}

describe('Mission Control v3 plan validation', () => {
	test('validates generic DEV template plans', async () => {
		const result = await validateAllPlans();
		expect(result).toEqual({ ok: true, errors: [] });
		const devCodes = (await listPlanRecords()).map((record) => record.plan.dev_code).sort();
		expect(devCodes).toContain('DEV-0001');
		expect(new Set(devCodes).size).toBe(devCodes.length);
		for (const code of devCodes) expect(code).toMatch(PLAN_CODE_RE);
	});

	test('accepts an AVT Organization prefix while keeping config and id cross-checks', async () => {
		const record = (await listPlanRecords()).find((item) => item.plan.dev_code === 'DEV-0001');
		if (!record) throw new Error('Missing DEV-0001 fixture');
		const avtPlan = {
			...structuredClone(record.plan),
			id: 'mcplan-avt-0001',
			dev_code: 'AVT-0001',
		};
		expect(validatePlanShape(avtPlan, { planPrefix: 'AVT' })).toEqual({
			ok: true,
			errors: [],
		});

		const mismatchedId = validatePlanShape(
			{ ...avtPlan, id: 'mcplan-avt-0002' },
			{ planPrefix: 'AVT' },
		);
		expect(mismatchedId.ok).toBe(false);
		expect(
			mismatchedId.errors.some(
				(error) => error.path === 'id' && error.message.includes('odpovídat dev_code'),
			),
		).toBe(true);

		const wrongConfigPrefix = validatePlanShape(avtPlan, { planPrefix: 'ACME' });
		expect(wrongConfigPrefix.ok).toBe(false);
		expect(
			wrongConfigPrefix.errors.some(
				(error) => error.path === 'dev_code' && error.message.includes('ACME-XXXX'),
			),
		).toBe(true);
	});

	test('enforces the JSON schema surface', async () => {
		const record = (await listPlanRecords()).find((item) => item.plan.dev_code === 'DEV-0001');
		if (!record) throw new Error('Missing DEV-0001 fixture');
		const base = structuredClone(record.plan);
		const cases = [
			{ plan: { ...base, unexpected: true }, path: 'unexpected' },
			{ plan: { ...base, legacy_sources: 'raw-person-data' }, path: 'legacy_sources' },
			{
				plan: { ...base, proposed_tasks: [{ title: 'Missing summary' }] },
				path: 'proposed_tasks.0.summary',
			},
			{ plan: { ...base, github: { prs: [{}] } }, path: 'github.prs.0.url' },
			{
				plan: { ...base, planning_target: { scope: 'done', todo_tasks_path: 'DONE.tasks.json' } },
				path: 'planning_target.todo_tasks_path',
			},
			{
				plan: {
					...base,
					planning_target: { scope: 'escape', todo_tasks_path: '../TODO.tasks.json' },
				},
				path: 'planning_target.todo_tasks_path',
			},
		];
		for (const item of cases) {
			const result = validatePlanShape(item.plan);
			expect(result.ok).toBe(false);
			expect(result.errors.some((error) => error.path === item.path)).toBe(true);
		}
	});

	test('accepts the strict incident addendum and rejects unknown incident fields', async () => {
		const record = (await listPlanRecords()).find((item) => item.plan.dev_code === 'DEV-0001');
		if (!record) throw new Error('Missing DEV-0001 fixture');
		const incidentAddendum = {
			reported_at: '2026-07-29T08:47:00+02:00',
			reporter: 'organization-user',
			authorization: 'The Organization owner authorized a bounded recovery.',
			observed_state: 'The hosted writer stopped before creating a commit.',
		};

		expect(
			validatePlanShape({
				...record.plan,
				incident_addendum: incidentAddendum,
			}),
		).toEqual({ ok: true, errors: [] });

		const invalid = validatePlanShape({
			...record.plan,
			incident_addendum: {
				...incidentAddendum,
				private_runtime_path: '/private/host/path',
			},
		});
		expect(invalid.ok).toBe(false);
		expect(
			invalid.errors.some((error) => error.path === 'incident_addendum.private_runtime_path'),
		).toBe(true);
	});

	test('validates legacy ClickUp custom IDs against the configured prefix only', async () => {
		const record = (await listPlanRecords()).find((item) => item.plan.dev_code === 'DEV-0001');
		if (!record) throw new Error('Missing DEV-0001 fixture');
		const planForPrefix = (planPrefix: 'DEV' | 'ACME' | 'AVT', customId: string) => ({
			...structuredClone(record.plan),
			id: `mcplan-${planPrefix.toLowerCase()}-0001`,
			dev_code: `${planPrefix}-0001`,
			legacy_sources: {
				clickup: {
					task_id: 'generic-task-id',
					custom_id: customId,
					url: 'https://example.invalid/tasks/generic-task-id',
				},
			},
		});

		expect(
			validatePlanShape(planForPrefix('DEV', 'DEV-9876'), {
				planPrefix: 'DEV',
			}),
		).toEqual({ ok: true, errors: [] });

		for (const [planPrefix, foreignCustomId] of [
			['DEV', 'ACME-0001'],
			['ACME', 'AVT-0001'],
			['AVT', 'DEV-0001'],
		] as const) {
			const result = validatePlanShape(planForPrefix(planPrefix, foreignCustomId), { planPrefix });
			expect(result.ok).toBe(false);
			expect(
				result.errors.some(
					(error) =>
						error.path === 'legacy_sources.clickup.custom_id' &&
						error.message.includes(`${planPrefix}-XXXX`),
				),
			).toBe(true);
		}
	});

	test('rejects a non-legacy planning_target todo_tasks_path that does not exist on disk', async () => {
		const record = (await listPlanRecords()).find((item) => item.plan.dev_code === 'DEV-0001');
		if (!record) throw new Error('Missing DEV-0001 fixture');
		const result = validatePlanShape({
			...record.plan,
			planning_target: {
				scope: 'template-organization',
				todo_tasks_path: 'v3/.does-not-exist/TODO.tasks.json',
			},
		});
		expect(result.ok).toBe(false);
		expect(
			result.errors.some(
				(error) =>
					error.path === 'planning_target.todo_tasks_path' && error.message.includes('neexistuje'),
			),
		).toBe(true);
	});

	test('accepts an existing Organization-root TODO ledger outside the repository-db data checkout', async () => {
		expect(MISSION_CONTROL_DATA_ROOT).not.toBe(WORKSPACE_ROOT);
		const record = (await listPlanRecords()).find((item) => item.plan.dev_code === 'DEV-0001');
		if (!record) throw new Error('Missing DEV-0001 fixture');
		const result = validatePlanShape({
			...record.plan,
			planning_target: {
				scope: 'template-organization',
				todo_tasks_path: 'fixture/TODO.tasks.json',
			},
		});
		expect(result).toEqual({ ok: true, errors: [] });
	});

	test('tolerates missing legacy module TODO paths in the GEN3 transition boundary', async () => {
		const legacy = (await listPlanRecords()).find((item) =>
			item.plan.planning_target?.todo_tasks_path?.startsWith('modules/'),
		);
		if (!legacy) return;
		expect(validatePlanShape(legacy.plan).ok).toBe(true);
	});

	test('classifies missing planning ledgers from the exact declared Workspace slot', () => {
		const roleBasedManifest = {
			module_slots: [
				{
					path: 'productionspace/monorepo',
					default_access: 'role_based',
					git: { url: 'git@github.com:Example/monorepo.git' },
				},
			],
		};
		expect(
			allowsMissingDeclaredPlanningTarget(
				'productionspace/monorepo/TODO.tasks.json',
				roleBasedManifest,
			),
		).toBe(true);
		expect(
			allowsMissingDeclaredPlanningTarget(
				'productionspace/monorepo/nested/TODO.tasks.json',
				roleBasedManifest,
			),
		).toBe(false);
		expect(
			allowsMissingDeclaredPlanningTarget(
				'productionspace/other/TODO.tasks.json',
				roleBasedManifest,
			),
		).toBe(false);
		expect(
			allowsMissingDeclaredPlanningTarget('workspace/future/TODO.tasks.json', {
				module_slots: [{ path: 'workspace/future', status: 'planned_slot' }],
			}),
		).toBe(true);
		expect(
			allowsMissingDeclaredPlanningTarget('workspace/required/TODO.tasks.json', {
				module_slots: [
					{
						path: 'workspace/required',
						default_access: 'expected',
						git: { url: 'git@github.com:Example/required.git' },
					},
				],
			}),
		).toBe(false);
		expect(
			allowsMissingDeclaredPlanningTarget('workspace/unplanned/TODO.tasks.json', {
				module_slots: [
					{
						path: 'workspace/unplanned',
						materialization: 'unplanned',
						default_access: 'expected',
						git: { url: 'git@github.com:Example/unplanned.git' },
					},
				],
			}),
		).toBe(false);
	});

	test('rejects file placement, quality placeholders and duplicate codes', async () => {
		const records = await listPlanRecords();
		const record = records.find((item) => item.plan.dev_code === 'DEV-0001') ?? records[0];
		const renamed: PlanRecord = {
			...record,
			relativePath: 'plans/2026/06/renamed-plan.yaml',
			workspacePath: 'mission-control/plans/2026/06/renamed-plan.yaml',
		};
		expect(
			validatePlanRecords([renamed]).errors.some((error) =>
				error.message.includes(`název souboru musí začínat ${record.plan.dev_code}-`),
			),
		).toBe(true);
		const errors = planQualityErrors({
			...record.plan,
			context: 'Doplnit kontext.',
			scope: { in: ['doplnit scope pro fázi 2'], out: [...record.plan.scope.out] },
			validation: ['Doplnit validaci smoke testem'],
		});
		expect(errors.some((error) => error.path === 'context')).toBe(true);
		const duplicate: PlanRecord = {
			...records[1],
			relativePath: 'plans/duplicate.yaml',
			plan: { ...records[1].plan, id: 'mcplan-dev-9999', dev_code: record.plan.dev_code },
		};
		expect(
			validatePlanRecords([record, duplicate]).errors.some((error) =>
				error.message.includes('duplicitní dev_code'),
			),
		).toBe(true);
	});

	test('accepts portable plans/YYYY/MM placement on every native platform', async () => {
		const record = (await listPlanRecords()).find((item) => item.plan.dev_code === 'DEV-0001');
		if (!record) throw new Error('Missing DEV-0001 fixture');
		const portableName = `${record.plan.dev_code}-portable-path.yaml`;
		const portable: PlanRecord = {
			...record,
			relativePath: record.relativePath.replace(/[^/]+$/u, portableName),
			workspacePath: record.workspacePath.replace(/[^/]+$/u, portableName),
		};
		expect(validatePlanRecords([portable], { quality: false })).toEqual({ ok: true, errors: [] });
	});

	test('rejects a saved plan update that collides with another plan', async () => {
		const records = await listPlanRecords();
		const current = records.find((record) => record.plan.dev_code === 'DEV-0001') ?? records[0];
		const other = records.find((record) => record.plan.dev_code !== current.plan.dev_code);
		if (!other) throw new Error('Missing collision fixture');
		const result = validatePlanUpdate(records, current.absolutePath, {
			...current.plan,
			id: other.plan.id,
			dev_code: other.plan.dev_code,
		});
		expect(result.ok).toBe(false);
		expect(result.errors.some((error) => error.message.includes('duplicitní dev_code'))).toBe(true);
		expect(result.errors.some((error) => error.message.includes('duplicitní id'))).toBe(true);
	});
});
