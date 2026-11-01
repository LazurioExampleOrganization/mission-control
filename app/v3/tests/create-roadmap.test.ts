import { describe, expect, test } from 'bun:test';
import { buildNewRoadmapDraft, RoadmapCreateDraftError } from '../src/create-roadmap.ts';

describe('Mission Control roadmap creation draft', () => {
	test('builds a valid new roadmap YAML from an existing source plan', () => {
		const draft = buildNewRoadmapDraft({
			source_plan: 'DEV-0001',
			title: 'Template roadmap creation smoke',
			owner: 'template-steward',
			summary: 'Roadmap creation smoke should be publishable through repository changesets.',
		});

		expect(draft.status).toBe('dry-run');
		expect(draft.write_applied).toBe(false);
		expect(draft.roadmap_code).toBe('RM-0002');
		expect(draft.path).toBe(
			'data/mission-control/roadmaps/2026/RM-0002-template-roadmap-creation-smoke.yaml',
		);
		expect(draft.workspacePath).toContain('RM-0002-template-roadmap-creation-smoke.yaml');
		expect(draft.roadmap.source_plan).toBe('DEV-0001');
		expect(draft.roadmap.steps[0].plan_refs).toEqual(['DEV-0001']);
		expect(draft.yaml).toContain('roadmap_code: RM-0002');
		expect(draft.yaml).toContain('source_plan: DEV-0001');
		expect(draft.validation.ok).toBe(true);
	});

	test('marks a new roadmap as main and lets validation guard the single main roadmap', () => {
		const draft = buildNewRoadmapDraft({
			source_plan: 'DEV-0002',
			title: 'Template main roadmap handover',
			main: true,
		});

		expect(draft.roadmap.main).toBe(true);
		expect(draft.yaml).toContain('main: true');
		expect(draft.yaml.indexOf('main: true')).toBeLessThan(draft.yaml.indexOf('status:'));
		// The fixture RM-0001 is already the main roadmap; the draft says so instead of guessing.
		expect(draft.validation.ok).toBe(false);
		expect(draft.validation.failures).toContainEqual(
			expect.stringContaining('main: true už nese data/mission-control/roadmaps/2026/RM-0001'),
		);

		const regular = buildNewRoadmapDraft({ source_plan: 'DEV-0002', main: false });
		expect(regular.roadmap.main).toBeUndefined();
		expect(regular.yaml).not.toContain('main:');
		expect(regular.validation.ok).toBe(true);

		expect(() => buildNewRoadmapDraft({ source_plan: 'DEV-0002', main: 'yes' })).toThrow(
			'main musí být boolean.',
		);
	});

	test('rejects missing or unknown source plans', () => {
		expect(() => buildNewRoadmapDraft({})).toThrow(RoadmapCreateDraftError);
		expect(() => buildNewRoadmapDraft({ source_plan: 'DEV-9999' })).toThrow(
			'Source plan DEV-9999 neexistuje',
		);
	});
});
