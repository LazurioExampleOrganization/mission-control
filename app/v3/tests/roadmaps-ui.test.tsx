import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RoadmapsResponse } from '../src/ui-app/api.ts';
import { optionalDraftList, RoadmapsPage } from '../src/ui-app/pages/Roadmaps.tsx';

const roadmapFixture: RoadmapsResponse['roadmaps'][number] = {
	relativePath: 'roadmaps/2026/RM-0002-mission-control-v3.yaml',
	workspacePath: 'mission-control/roadmaps/2026/RM-0002-mission-control-v3.yaml',
	validation: { ok: true, failures: [] },
	next_step: {
		id: 'step-004',
		title: 'Postavit read-only Roadmaps UI v Mission Control cockpitu',
		status: 'ready',
		plan_refs: ['ACME-0010', 'ACME-0022'],
		todo_refs: [],
		issue_refs: [],
		evidence_refs: [],
		acceptance_criteria: ['Sidebar Mission Controlu má položku Roadmaps.'],
	},
	issue_blockers: [],
	step_issue_blockers: [],
	resolution_evidence: [],
	work_summary: {
		blocking_open_todo_count: 1,
		non_blocking_open_todo_count: 0,
		done_count: 2,
		linked_items: [
			{
				id: 'task-2026-06-25-003',
				kind: 'todo',
				title: 'Dotáhnout RM-0002 Mission Control v3 do finále',
				status: 'in_progress',
				dev_code: 'ACME-0027',
				ledger_path: 'TODO.tasks.json',
				blocks_release: true,
			},
			{
				id: 'task-2026-06-25-001',
				kind: 'done',
				title: 'Dokončit Roadmap Step draft loop',
				status: 'done',
				dev_code: 'ACME-0025',
				ledger_path: 'DONE.tasks.json',
				blocks_release: false,
			},
		],
		missing_todo_refs: [],
		ledger_read_errors: [],
	},
	runtime_lane: {
		source: 'worktree',
		path: '.worktrees/ACME-0027-rm0002-final',
		branch: 'codex/ACME-0027-rm0002-final',
		head: '166edb909dd0',
		dirty: true,
		prs: [
			{
				plan_ref: 'ACME-0026',
				url: 'https://github.com/ExampleOrganization/mission-control/pull/55',
				status: 'merged',
			},
		],
	},
	agent_lane: {
		owner: 'template-steward',
		reviewers: ['example-reviewer'],
		execution_agents: ['template-steward'],
		escalation_policy:
			'reviewer reviews Organization/ACME PRs; Workspace Admin only for human decisions.',
		status: 'pass',
		source: 'roadmap',
		warnings: [],
	},
	release_gate: {
		status: 'blocked',
		open_step_count: 1,
		done_step_count: 6,
		blockers: ['1 executable Roadmap Step ještě není done.'],
		checks: [
			{ id: 'validation', label: 'Mission Control validace', status: 'pass', detail: 'OK' },
			{ id: 'roadmap-steps', label: 'Kroky roadmapy', status: 'blocker', detail: 'step-007 ready' },
			{ id: 'linked-work', label: 'Uzavření TODO/DONE', status: 'pass', detail: 'linked' },
			{
				id: 'ledger-read',
				label: 'Čtení TODO/DONE ledgerů',
				status: 'pass',
				detail: 'Všechny TODO/DONE ledgery přečteny.',
			},
			{ id: 'pr-evidence', label: 'PR evidence', status: 'blocker', detail: 'Chybí: ACME-0027' },
			{ id: 'runtime-lane', label: 'Runtime vrstva', status: 'warning', detail: 'worktree dirty' },
			{
				id: 'agent-lane',
				label: 'Vrstva AI kolegů',
				status: 'pass',
				detail: 'Vlastník template-steward; revieweři example-reviewer; exekuce template-steward.',
			},
		],
		next_action: 'Dokončit step-007.',
	},
	blockers: [],
	actions: ['Dry-run nic nezapsal do workspace.'],
	roadmap: {
		schema_version: 'companiesascode.mission_control.roadmap.v1',
		id: 'mcroadmap-rm-0002',
		roadmap_code: 'RM-0002',
		title: 'Mission Control v3',
		status: 'in_progress',
		owner: 'template-steward',
		priority: 'urgent',
		created_at: '2026-06-21',
		updated_at: '2026-06-21',
		source_plan: 'ACME-0022',
		summary: 'Roadmaps UI fixture.',
		priorities: [
			{
				id: 'priority-002',
				title: 'Roadmapy jako first-class produktový objekt',
				rank: 2,
				rationale: 'UI má zobrazit roadmapy.',
			},
		],
		steps: [
			{
				id: 'step-004',
				title: 'Postavit read-only Roadmaps UI v Mission Control cockpitu',
				status: 'ready',
				executable: true,
				priority_refs: ['priority-002'],
				plan_refs: ['ACME-0010', 'ACME-0022'],
				todo_refs: ['task-2026-06-21-001'],
				issue_refs: ['issue-2026-06-21-001'],
				evidence_refs: [
					{
						label: 'Roadmap loop runtime',
						kind: 'validation',
						path: 'scripts/mission-control-lib.mjs',
					},
				],
				acceptance_criteria: [
					'Step karty ukazují plan_refs, todo_refs, issue_refs, evidence_refs a acceptance criteria.',
				],
			},
		],
	},
};

describe('Mission Control Roadmaps UI', () => {
	test('does not send optional list fields when the textarea is blank', () => {
		expect(optionalDraftList('')).toBeUndefined();
		expect(optionalDraftList('   \n  ,  ')).toBeUndefined();
		expect(optionalDraftList('ACME-0022\nACME-0025')).toEqual(['ACME-0022', 'ACME-0025']);
	});

	test('keeps the first roadmap draft action available in an empty repository', () => {
		const markup = renderToStaticMarkup(
			<RoadmapsPage
				response={{ roadmaps: [], validation: { ok: true, failures: [] } }}
				loading={false}
				error={null}
			/>,
		);

		expect(markup).toContain('Draft Roadmap from Plan');
		expect(markup).toContain('Zatím neexistuje žádná RM roadmapa.');
		expect(markup).not.toContain('Draft Roadmap Step');
	});

	test('renders roadmap list, next runnable step, draft controls and read-only step references', () => {
		const markup = renderToStaticMarkup(
			<RoadmapsPage
				response={{ roadmaps: [roadmapFixture], validation: { ok: true, failures: [] } }}
				loading={false}
				error={null}
			/>,
		);

		expect(markup).toContain('RM-0002');
		expect(markup).toContain('Mission Control v3');
		expect(markup).toContain('Next runnable step');
		expect(markup).toContain('step-004');
		expect(markup).toContain('priority-002');
		expect(markup).toContain('ACME-0010');
		expect(markup).toContain('task-2026-06-21-001');
		expect(markup).toContain('issue-2026-06-21-001');
		expect(markup).toContain('Roadmap loop runtime');
		expect(markup).toContain('Draft Roadmap from Plan');
		expect(markup).toContain('source_plan');
		expect(markup).toContain('Připravit roadmap draft');
		expect(markup).toContain('Draft Roadmap Step');
		expect(markup).toContain('Návrh bez zápisu');
		expect(markup).toContain('Diff preview');
		expect(markup).toContain('Read-only');
		expect(markup).toContain('Uzavření TODO/DONE');
		expect(markup).toContain('task-2026-06-25-003');
		expect(markup).toContain('blokuje release');
		expect(markup).toContain('navázaná evidence');
		expect(markup).toContain('Runtime vrstva');
		expect(markup).toContain('WORKTREE');
		expect(markup).toContain('codex/ACME-0027-rm0002-final');
		expect(markup).toContain('Vrstva AI kolegů');
		expect(markup).toContain('example-reviewer');
		expect(markup).toContain('zdroj roadmap');
		expect(markup).toContain('Release/readiness brána');
		expect(markup).toContain('Mission Control validace');
		expect(markup).toContain('Dokončit step-007.');
	});

	test('renders issue blockers, resolution evidence and notification semantics per roadmap step', () => {
		const issueContractRoadmap = {
			...roadmapFixture,
			next_step: null,
			issue_blockers: [
				{
					step_id: 'step-006',
					step_title: 'Napojit issues resolution UI a notifikace na roadmapy',
					issue_id: 'issue-2026-06-21-777',
					title: 'Rozhodnout notifikační kanál',
					status: 'decision_needed',
					severity: 'high',
					owner: 'founder',
					file: 'ISSUES.open.json',
				},
			],
			step_issue_blockers: [
				{
					step_id: 'step-006',
					step_title: 'Napojit issues resolution UI a notifikace na roadmapy',
					issue_id: 'issue-2026-06-21-777',
					title: 'Rozhodnout notifikační kanál',
					status: 'decision_needed',
					severity: 'high',
					owner: 'founder',
					file: 'ISSUES.open.json',
				},
			],
			resolution_evidence: [
				{
					step_id: 'step-007',
					step_title: 'Napojit TODO/DONE/evidence closeout na roadmapové kroky',
					issue_id: 'issue-2026-06-21-778',
					title: 'Mission Control lifecycle owner',
					resolved_at: '2026-06-21T12:00:00.000Z',
					resolved_by: 'workspace-admin',
					decision: 'Mission Control owns the lifecycle.',
					rationale: 'Roadmap steps already hold planning and closeout evidence.',
					source_ledger_path: 'ISSUES.open.json',
					resolved_ledger_path: 'ISSUES.resolved.json',
				},
			],
			roadmap: {
				...roadmapFixture.roadmap,
				steps: [
					{
						id: 'step-006',
						title: 'Napojit issues resolution UI a notifikace na roadmapy',
						status: 'ready',
						executable: true,
						priority_refs: ['priority-002'],
						plan_refs: ['ACME-0022'],
						issue_refs: ['issue-2026-06-21-777'],
						acceptance_criteria: ['Roadmap detail ukáže, které kroky jsou issue blokované a proč.'],
					},
					{
						id: 'step-007',
						title: 'Napojit TODO/DONE/evidence closeout na roadmapové kroky',
						status: 'ready',
						executable: true,
						priority_refs: ['priority-002'],
						plan_refs: ['ACME-0022'],
						issue_refs: ['issue-2026-06-21-778'],
						acceptance_criteria: ['Resolution evidence ukáže, co bylo rozhodnuto.'],
					},
					{
						id: 'step-008',
						title: 'Přidat worktree runtime a agent/PR lanes do Mission Controlu',
						status: 'blocked',
						executable: true,
						priority_refs: ['priority-002'],
						plan_refs: ['ACME-0022'],
						acceptance_criteria: ['Technický blocker není lidská notification.'],
					},
				],
			},
		} as unknown as RoadmapsResponse['roadmaps'][number];

		const markup = renderToStaticMarkup(
			<RoadmapsPage
				response={{ roadmaps: [issueContractRoadmap], validation: { ok: true, failures: [] } }}
				loading={false}
				error={null}
			/>,
		);

		expect(markup).toContain('Lidský blocker');
		expect(markup).toContain('issue-2026-06-21-777');
		expect(markup).toContain('Rozhodnout notifikační kanál');
		expect(markup).toContain('Notifikace Workspace Adminovi');
		expect(markup).toContain('jen pro lidské rozhodnutí nebo approval');
		expect(markup).toContain('Evidence rozhodnutí');
		expect(markup).toContain('Mission Control owns the lifecycle.');
		expect(markup).toContain('Odblokovaný krok');
		expect(markup).toContain('step-007');
		expect(markup).toContain('Technický/agentní blocker');
		expect(markup).toContain('Bez notifikace Workspace Adminovi');
	});

	test('renders validation failures instead of crashing on incomplete roadmap rows', () => {
		const incompleteRoadmap = {
			...roadmapFixture,
			validation: {
				ok: false,
				failures: ['mission-control/roadmaps/2026/RM-BROKEN.yaml: priorities must be an array'],
			},
			roadmap: {
				...roadmapFixture.roadmap,
				roadmap_code: 'RM-BROKEN',
				title: 'Broken roadmap fixture',
				priorities: undefined,
				steps: undefined,
			},
		} as unknown as RoadmapsResponse['roadmaps'][number];

		const markup = renderToStaticMarkup(
			<RoadmapsPage
				response={{
					roadmaps: [incompleteRoadmap],
					validation: {
						ok: false,
						failures: ['mission-control/roadmaps/2026/RM-BROKEN.yaml: priorities must be an array'],
					},
				}}
				loading={false}
				error={null}
			/>,
		);

		expect(markup).toContain('Roadmap validace není zelená.');
		expect(markup).toContain('RM-BROKEN');
		expect(markup).toContain('Broken roadmap fixture');
		expect(markup).toContain('Roadmap data nejsou kompletní');
	});

	test('skips malformed priority and step entries without crashing rendering', () => {
		const malformedRoadmap = {
			...roadmapFixture,
			validation: {
				ok: false,
				failures: ['mission-control/roadmaps/2026/RM-BROKEN.yaml: step row 0 must be an object'],
			},
			roadmap: {
				...roadmapFixture.roadmap,
				roadmap_code: 'RM-BROKEN',
				title: 'Broken nested roadmap fixture',
				priorities: [
					null,
					{ id: 'priority-bad' },
					{
						id: 'priority-002',
						title: 'Roadmapy jako first-class produktový objekt',
						rank: 2,
						rationale: 'UI má zobrazit roadmapy.',
					},
				],
				steps: [
					null,
					{ id: 'step-bad' },
					{
						id: 'step-004',
						title: 'Postavit read-only Roadmaps UI v Mission Control cockpitu',
						status: 'ready',
						executable: true,
						priority_refs: [null, 'priority-002'],
						plan_refs: ['ACME-0010', null],
						todo_refs: ['task-2026-06-21-001'],
						issue_refs: ['issue-2026-06-21-001'],
						evidence_refs: [
							null,
							{
								label: 'Roadmap loop runtime',
								kind: 'validation',
								path: 'scripts/mission-control-lib.mjs',
							},
						],
						acceptance_criteria: [null, 'Step karty ukazují validní reference.'],
					},
				],
			},
		} as unknown as RoadmapsResponse['roadmaps'][number];

		const markup = renderToStaticMarkup(
			<RoadmapsPage
				response={{
					roadmaps: [malformedRoadmap],
					validation: {
						ok: false,
						failures: [
							'mission-control/roadmaps/2026/RM-BROKEN.yaml: step row 0 must be an object',
						],
					},
				}}
				loading={false}
				error={null}
			/>,
		);

		expect(markup).toContain('Roadmap validace není zelená.');
		expect(markup).toContain('Roadmap data nejsou kompletní');
		expect(markup).toContain('priority-002');
		expect(markup).toContain('step-004');
		expect(markup).toContain('Roadmap loop runtime');
		expect(markup).not.toContain('>priority-bad</strong>');
		expect(markup).not.toContain('>step-bad</span>');
	});
});
