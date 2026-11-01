import { describe, expect, test } from 'bun:test';
import { parse as parseYaml } from 'yaml';
import { buildRoadmapStepDraft, RoadmapStepDraftError } from '../src/roadmap-step-draft.ts';

async function draftError(payload: Record<string, unknown>): Promise<RoadmapStepDraftError> {
	try {
		await buildRoadmapStepDraft('RM-0001', { dry_run: true, ...payload });
	} catch (error) {
		if (error instanceof RoadmapStepDraftError) return error;
		throw error;
	}
	throw new Error('draft did not fail');
}

describe('Mission Control Roadmap Step timing drafts', () => {
	test('sets approximate timing right after executable and validates the result', async () => {
		const draft = await buildRoadmapStepDraft('RM-0001', {
			dry_run: true,
			mode: 'update',
			step_id: 'step-002',
			timing: { from: '2026-04', to: '2026-Q3', confidence: 'tentative' },
		});

		expect(draft.write_applied).toBe(false);
		expect(draft.step.timing).toEqual({ from: '2026-04', to: '2026-Q3', confidence: 'tentative' });
		expect(draft.diff).toContain('+      from: 2026-04');
		expect(draft.diff).toContain('+      to: 2026-Q3');
		expect(draft.validation.ok).toBe(true);
		const step = parseYaml(draft.yaml).steps[1];
		expect(Object.keys(step).slice(0, 5)).toEqual([
			'id',
			'title',
			'status',
			'executable',
			'timing',
		]);
	});

	test('creates a new step with timing and removes timing with null', async () => {
		const created = await buildRoadmapStepDraft('RM-0001', {
			dry_run: true,
			mode: 'create',
			title: 'Announce the next release',
			priority_refs: ['priority-001'],
			executable: false,
			timing: { to: '2026-12' },
		});
		expect(created.step.id).toBe('step-003');
		expect(created.step.timing).toEqual({ to: '2026-12' });
		expect(created.validation.ok).toBe(true);

		const cleared = await buildRoadmapStepDraft('RM-0001', {
			dry_run: true,
			mode: 'update',
			step_id: 'step-001',
			timing: null,
		});
		expect(cleared.step.timing).toBeUndefined();
		expect(cleared.diff).toContain('-      to: 2026-Q1');
		expect(cleared.validation.ok).toBe(true);
	});

	test('removes a reference list with null; an empty list stays an error', async () => {
		const draft = await buildRoadmapStepDraft('RM-0001', {
			dry_run: true,
			mode: 'update',
			step_id: 'step-002',
			plan_refs: null,
		});
		expect(draft.step.plan_refs).toBeUndefined();
		expect(parseYaml(draft.yaml).steps[1].plan_refs).toBeUndefined();
		expect(
			(await draftError({ mode: 'update', step_id: 'step-002', plan_refs: [] })).message,
		).toContain('plan_refs nesmí být prázdné pole');
	});

	test('rejects malformed timing before drafting', async () => {
		for (const [timing, message] of [
			['Q1', 'timing musí být objekt'],
			[{ from: '2026-11' }, 'timing.to musí být měsíc YYYY-MM nebo čtvrtletí YYYY-Qn'],
			[{ to: '2026-13' }, 'timing.to musí být měsíc YYYY-MM nebo čtvrtletí YYYY-Qn'],
			[{ from: 'soon', to: '2026-Q4' }, 'timing.from musí být měsíc'],
			[
				{ to: '2026-Q4', confidence: 'sure' },
				'timing.confidence musí být jedna z: committed, likely, tentative',
			],
			[{ to: '2026-Q4', due: '2026-12-24' }, 'timing obsahuje neznámá pole: due'],
		] as const) {
			const error = await draftError({ mode: 'update', step_id: 'step-002', timing });
			expect(error.code).toBe('invalid_timing');
			expect(error.status).toBe(400);
			expect(error.message).toContain(message);
		}
	});

	test('reports a backwards window as a validation failure of the draft', async () => {
		const draft = await buildRoadmapStepDraft('RM-0001', {
			dry_run: true,
			mode: 'update',
			step_id: 'step-002',
			timing: { from: '2026-Q4', to: '2026-11' },
		});

		expect(draft.validation.ok).toBe(false);
		expect(draft.validation.failures).toContainEqual(
			expect.stringContaining(
				'steps[1].timing.from nesmí začínat ani končit později než steps[1].timing.to',
			),
		);
	});
});
