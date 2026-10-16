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

	test('rejects missing or unknown source plans', () => {
		expect(() => buildNewRoadmapDraft({})).toThrow(RoadmapCreateDraftError);
		expect(() => buildNewRoadmapDraft({ source_plan: 'DEV-9999' })).toThrow(
			'Source plan DEV-9999 neexistuje',
		);
	});
});
