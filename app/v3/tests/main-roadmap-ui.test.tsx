import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PlanRecord } from '../src/model.ts';
import type { RoadmapApiRecord } from '../src/roadmap-model.ts';
import { MainRoadmapPage } from '../src/ui-app/pages/MainRoadmap.tsx';

const TODAY = new Date(2026, 9, 31);

function record(
	code: string,
	roadmap: Partial<RoadmapApiRecord['roadmap']>,
	validation = { ok: true, failures: [] as string[] },
): RoadmapApiRecord {
	return {
		relativePath: `roadmaps/2026/${code}-example.yaml`,
		workspacePath: `data/mission-control/roadmaps/2026/${code}-example.yaml`,
		validation,
		next_step: null,
		roadmap: {
			schema_version: 'companiesascode.mission_control.roadmap.v1',
			id: `mcroadmap-${code.toLowerCase()}`,
			roadmap_code: code,
			title: `Example roadmap ${code}`,
			status: 'in_progress',
			owner: 'template-steward',
			priority: 'high',
			created_at: '2026-01-01',
			updated_at: '2026-10-01',
			source_plan: 'DEV-0001',
			summary: 'Generic product launch roadmap.',
			priorities: [{ id: 'priority-001', title: 'Launch', rank: 1, rationale: 'Generic.' }],
			steps: [],
			...roadmap,
		},
	} as unknown as RoadmapApiRecord;
}

const launchRoadmap = record('RM-0002', {
	main: true,
	title: 'Example product launch',
	links: [{ label: 'Launch brief', url: 'https://example.invalid/launch-brief' }],
	steps: [
		{
			id: 'step-001',
			title: 'Pilot for the first team',
			status: 'done',
			executable: true,
			timing: { from: '2026-07', to: '2026-Q3', confidence: 'committed' },
			priority_refs: ['priority-001'],
			plan_refs: ['DEV-0001'],
			evidence_refs: [{ label: 'Pilot report', kind: 'report', path: 'README.md' }],
			acceptance_criteria: ['The first team works in the product every day.'],
		},
		{
			id: 'step-002',
			title: 'Public launch',
			status: 'ready',
			executable: false,
			timing: { to: '2027-Q1', confidence: 'likely' },
			priority_refs: ['priority-001'],
			acceptance_criteria: [],
		},
		{
			id: 'step-003',
			title: 'Payments and invoicing',
			status: 'in_progress',
			executable: true,
			timing: { from: '2026-10', to: '2026-12' },
			priority_refs: ['priority-001'],
			plan_refs: ['DEV-0002'],
			acceptance_criteria: [],
		},
		{
			id: 'step-004',
			title: 'Accounting integration',
			status: 'blocked',
			executable: false,
			timing: { from: '2026-11', to: '2027-02', confidence: 'tentative' },
			priority_refs: ['priority-001'],
			issue_refs: ['issue-2026-01-01-001'],
			acceptance_criteria: [],
		},
		{
			id: 'step-005',
			title: 'Mobile app',
			status: 'shaping',
			executable: false,
			priority_refs: ['priority-001'],
			acceptance_criteria: [],
		},
		{
			id: 'step-006',
			title: 'Dropped experiment',
			status: 'archived',
			executable: false,
			timing: { to: '2026-Q4' },
			priority_refs: ['priority-001'],
			acceptance_criteria: [],
		},
	],
});

const plans = [
	{
		plan: {
			dev_code: 'DEV-0001',
			title: 'Template runtime',
			status: 'done',
			github: {
				prs: [{ url: 'https://github.com/ExampleOrganization/product/pull/42', status: 'merged' }],
			},
		},
	},
	{
		plan: {
			dev_code: 'DEV-0002',
			title: 'Close blocker',
			status: 'in_progress',
			links: [
				{ label: 'Billing issue', url: 'https://github.com/ExampleOrganization/product/issues/7' },
			],
		},
	},
] as unknown as PlanRecord[];

function render(roadmaps: RoadmapApiRecord[], options: { error?: string | null } = {}) {
	return renderToStaticMarkup(
		<MainRoadmapPage
			response={{ roadmaps, validation: { ok: true, failures: [] } }}
			plans={plans}
			error={options.error ?? null}
			onOpenPlan={() => {}}
			onOpenRoadmaps={() => {}}
			today={TODAY}
		/>,
	);
}

describe('Main roadmap page', () => {
	test('shows the main roadmap as a quarter timeline with states, next step and click-through', () => {
		const markup = render([record('RM-0001', { status: 'ready' }), launchRoadmap]);

		expect(markup).toContain('Example product launch');
		expect(markup).toContain('Hlavní roadmapa');
		expect(markup).toContain('aktualizováno 1. 10. 2026');
		expect(markup).toContain('Launch brief');
		expect(markup).toContain('Zobrazit roadmapu');
		expect(markup).toContain('RM-0002 · Example product launch (hlavní)');
		expect(markup).toContain('<strong>Q3</strong><small>2026</small>');
		expect(markup).toContain('<strong>Q4</strong></span>');
		expect(markup).toContain('<strong>Q1</strong><small>2027</small>');
		expect(markup).toContain('Dnes');
		expect(markup).toContain('Q4 2026 · toto čtvrtletí');
		expect(markup).not.toContain('Q1 2027 · toto čtvrtletí');
		expect(markup).toContain('--timeline-columns:3');
		for (const label of ['Plánováno', 'Probíhá', 'Blokováno', 'Hotovo']) {
			expect(markup).toContain(label);
		}
		expect(markup).toContain('červenec – Q3 2026 · Závazné');
		expect(markup).toContain('listopad 2026 – únor 2027 · Orientační');
		expect(markup).toContain('Q1 2027 · Pravděpodobné');
		expect(markup).toContain('timeline-bar state-done confidence-committed');
		expect(markup).toContain('Další na řadě');
		expect(markup.match(/timeline-step state-planned is-next/g)?.length).toBe(1);
		expect(markup).toContain('Hotovo</span><strong>1 z 5</strong>');
		expect(markup).toContain('Template runtime');
		expect(markup).toContain('href="https://github.com/ExampleOrganization/product/pull/42"');
		expect(markup).toContain('href="https://github.com/ExampleOrganization/product/issues/7"');
		expect(markup).toContain('issue-2026-01-01-001');
		expect(markup).toContain('Co bude hotové');
		expect(markup).toContain('Bez termínu');
		expect(markup).toContain('Mobile app');
		expect(markup).not.toContain('Dropped experiment');
		expect(markup).toContain('1 archivovaný krok se na ose nezobrazuje.');
	});

	test('orders the timeline rows by when each step lands', () => {
		const markup = render([launchRoadmap]);
		const timeline = markup.slice(markup.indexOf('main-roadmap-timeline'));
		const order = [
			'Pilot for the first team',
			'Payments and invoicing',
			'Accounting integration',
			'Public launch',
			'Mobile app',
		];
		const positions = order.map((title) => timeline.indexOf(title));
		expect(positions.every((position) => position >= 0)).toBe(true);
		expect([...positions].sort((left, right) => left - right)).toEqual(positions);
	});

	test('still renders an older roadmap without timing or main flag', () => {
		const legacy = record('RM-0001', {
			steps: [
				{
					id: 'step-001',
					title: 'Keep generic fixture readable',
					status: 'done',
					executable: true,
					priority_refs: ['priority-001'],
					plan_refs: ['DEV-0001'],
					acceptance_criteria: ['The generic DEV-0001 plan validates.'],
				},
				{
					id: 'step-002',
					title: 'Exercise next-step and close-gate behavior',
					status: 'ready',
					executable: true,
					priority_refs: ['priority-001'],
					plan_refs: ['DEV-0002'],
					acceptance_criteria: [],
				},
			],
		});
		const markup = render([legacy]);

		expect(markup).toContain('Example roadmap RM-0001');
		expect(markup).not.toContain('main-roadmap-flag');
		// The only roadmap, unflagged, is shown but never presented as the main one.
		expect(markup).toContain(
			'Organizace zatím nemá označenou hlavní roadmapu, proto zobrazujeme RM-0001',
		);
		expect(markup).not.toContain('Zobrazit roadmapu');
		expect(markup).toContain('zatím nemají přibližný termín, proto se časová osa nezobrazuje');
		expect(markup).toContain('Keep generic fixture readable');
		expect(markup).toContain('Exercise next-step and close-gate behavior');
		expect(markup).not.toContain('timeline-track');
	});

	test('explains which roadmap is shown when none or several are flagged main', () => {
		const fallback = render([
			record('RM-0001', { status: 'ready' }),
			record('RM-0002', { status: 'in_progress' }),
		]);
		expect(fallback).toContain(
			'Organizace zatím nemá označenou hlavní roadmapu, proto zobrazujeme RM-0002',
		);

		const conflict = render([
			record(
				'RM-0001',
				{ main: true },
				{ ok: false, failures: ['RM-0002: main: true už nese RM-0001'] },
			),
			record('RM-0002', { main: true }),
		]);
		expect(conflict).toContain('Jako hlavní je označeno víc roadmap (RM-0001, RM-0002)');
		expect(conflict).toContain('Roadmapa má 1 validační chybu');
	});

	test('offers the way to the Roadmaps section when the Organization has no roadmap', () => {
		const markup = render([]);
		expect(markup).toContain('Roadmapa zatím není');
		expect(markup).toContain('Otevřít Roadmaps');
	});

	test('shows the load error instead of the timeline', () => {
		const markup = render([launchRoadmap], { error: 'Roadmapy se nepodařilo načíst.' });
		expect(markup).toContain('Roadmapy se nepodařilo načíst.');
		expect(markup).not.toContain('Example product launch');
	});
});
