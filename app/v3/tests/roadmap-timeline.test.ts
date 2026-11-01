import { describe, expect, test } from 'bun:test';
import type { PlanRecord } from '../src/model.ts';
import type { RoadmapApiRecord, RoadmapStep } from '../src/roadmap-model.ts';
import {
	parseRoadmapPeriod,
	roadmapPeriodsInOrder,
	roadmapTimingWindow,
} from '../src/roadmap-timing.ts';
import {
	buildRoadmapTimeline,
	formatCzechDate,
	formatTimingWindow,
	leaderStateOf,
	pluralCs,
	safeExternalUrl,
	selectMainRoadmap,
	stepLinks,
} from '../src/ui-app/roadmap-timeline.ts';

const TODAY = new Date(2026, 9, 31);

function step(overrides: Partial<RoadmapStep> & Pick<RoadmapStep, 'id' | 'title'>): RoadmapStep {
	return {
		status: 'ready',
		executable: false,
		priority_refs: ['priority-001'],
		acceptance_criteria: [],
		...overrides,
	};
}

const launchSteps: RoadmapStep[] = [
	step({
		id: 'step-001',
		title: 'Pilot for the first team',
		status: 'done',
		timing: { from: '2026-07', to: '2026-Q3', confidence: 'committed' },
	}),
	step({
		id: 'step-002',
		title: 'Public launch',
		timing: { to: '2027-Q1', confidence: 'likely' },
	}),
	step({
		id: 'step-003',
		title: 'Payments and invoicing',
		status: 'in_progress',
		timing: { from: '2026-10', to: '2026-12' },
	}),
	step({
		id: 'step-004',
		title: 'Accounting integration',
		status: 'blocked',
		timing: { from: '2026-11', to: '2027-02', confidence: 'tentative' },
	}),
	step({ id: 'step-005', title: 'Mobile app', status: 'shaping' }),
	step({
		id: 'step-006',
		title: 'Dropped experiment',
		status: 'archived',
		timing: { to: '2026-Q4' },
	}),
	step({
		id: 'step-007',
		title: 'Sales training',
		timing: { from: '2026-12', to: '2027-Q1' },
	}),
];

function roadmapRecord(
	code: string,
	overrides: Partial<RoadmapApiRecord['roadmap']> = {},
): RoadmapApiRecord {
	return {
		roadmap: {
			schema_version: 'companiesascode.mission_control.roadmap.v1',
			id: `mcroadmap-${code.toLowerCase()}`,
			roadmap_code: code,
			title: `Roadmap ${code}`,
			status: 'ready',
			owner: 'template-steward',
			priority: 'high',
			created_at: '2026-01-01',
			updated_at: '2026-01-01',
			source_plan: 'DEV-0001',
			summary: 'Generic roadmap fixture.',
			priorities: [],
			steps: [],
			...overrides,
		},
	} as unknown as RoadmapApiRecord;
}

describe('Roadmap Step timing periods', () => {
	test('accepts calendar months and quarters only', () => {
		expect(parseRoadmapPeriod('2026-01')).toEqual({
			kind: 'month',
			year: 2026,
			startMonth: 2026 * 12,
			endMonth: 2026 * 12,
		});
		expect(parseRoadmapPeriod('2027-Q2')).toEqual({
			kind: 'quarter',
			year: 2027,
			startMonth: 2027 * 12 + 3,
			endMonth: 2027 * 12 + 5,
		});
		for (const invalid of [
			'2026-00',
			'2026-13',
			'2026-1',
			'2026-Q0',
			'2026-Q5',
			'2026-q1',
			'26-01',
			'2026-01-01',
			' 2026-01',
			2026,
			null,
		]) {
			expect(parseRoadmapPeriod(invalid)).toBeNull();
		}
	});

	test('a window must not run backwards, also across granularities', () => {
		const period = (value: string) => {
			const parsed = parseRoadmapPeriod(value);
			if (!parsed) throw new Error(value);
			return parsed;
		};
		expect(roadmapPeriodsInOrder(period('2026-10'), period('2026-Q4'))).toBe(true);
		expect(roadmapPeriodsInOrder(period('2026-Q4'), period('2026-Q4'))).toBe(true);
		expect(roadmapPeriodsInOrder(period('2026-Q4'), period('2026-11'))).toBe(false);
		expect(roadmapPeriodsInOrder(period('2026-12'), period('2026-Q4'))).toBe(false);
		expect(roadmapPeriodsInOrder(period('2027-01'), period('2026-Q4'))).toBe(false);
	});

	test('derives a window only from valid timing', () => {
		expect(roadmapTimingWindow({ to: '2027-Q1' })).toMatchObject({
			from: null,
			startMonth: 2027 * 12,
			endMonth: 2027 * 12 + 2,
			confidence: null,
		});
		expect(
			roadmapTimingWindow({ from: '2026-11', to: '2027-Q1', confidence: 'likely' }),
		).toMatchObject({ startMonth: 2026 * 12 + 10, endMonth: 2027 * 12 + 2, confidence: 'likely' });
		expect(roadmapTimingWindow(undefined)).toBeNull();
		expect(roadmapTimingWindow({ from: '2026-11' })).toBeNull();
		expect(roadmapTimingWindow({ from: '2027-Q2', to: '2027-Q1' })).toBeNull();
		expect(roadmapTimingWindow({ from: 'soon', to: '2027-Q1' })).toBeNull();
	});
});

describe('Main roadmap timeline view model', () => {
	test('formats periods and windows the way leaders read them', () => {
		const label = (timing: RoadmapStep['timing']) => {
			const window = roadmapTimingWindow(timing);
			if (!window) throw new Error('invalid timing');
			return formatTimingWindow(window);
		};
		expect(label({ to: '2027-Q1' })).toBe('Q1 2027');
		expect(label({ to: '2026-11' })).toBe('listopad 2026');
		expect(label({ from: '2026-09', to: '2026-11' })).toBe('září – listopad 2026');
		expect(label({ from: '2027-Q1', to: '2027-Q2' })).toBe('Q1 – Q2 2027');
		expect(label({ from: '2026-11', to: '2027-Q1' })).toBe('listopad 2026 – Q1 2027');
		expect(label({ from: '2027-Q1', to: '2027-Q1' })).toBe('Q1 2027');
		expect(formatCzechDate('2026-10-01')).toBe('1. 10. 2026');
		expect(formatCzechDate('soon')).toBeNull();
		expect(pluralCs(1, ['krok', 'kroky', 'kroků'])).toBe('krok');
		expect(pluralCs(3, ['krok', 'kroky', 'kroků'])).toBe('kroky');
		expect(pluralCs(5, ['krok', 'kroky', 'kroků'])).toBe('kroků');
		expect(pluralCs(0, ['krok', 'kroky', 'kroků'])).toBe('kroků');
	});

	test('maps the seven statuses onto four leader states and hides archived steps', () => {
		expect(
			['shaping', 'ready', 'in_progress', 'review', 'blocked', 'done'].map(leaderStateOf),
		).toEqual(['planned', 'planned', 'in_progress', 'in_progress', 'blocked', 'done']);
		expect(leaderStateOf('archived')).toBeNull();
		expect(leaderStateOf('unknown-status')).toBe('planned');
	});

	test('orders steps by when they land, then start, then roadmap order', () => {
		const timeline = buildRoadmapTimeline(launchSteps, TODAY);

		expect(timeline.scheduled.map((row) => row.step.id)).toEqual([
			'step-001',
			'step-003',
			'step-004',
			'step-007',
			'step-002',
		]);
		expect(timeline.unscheduled.map((row) => row.step.id)).toEqual(['step-005']);
		expect(timeline.archivedCount).toBe(1);
		expect(timeline.counts).toEqual({
			planned: 3,
			in_progress: 1,
			blocked: 1,
			done: 1,
			total: 6,
		});
		expect(timeline.scheduled.map((row) => row.timingLabel)).toEqual([
			'červenec – Q3 2026',
			'říjen – prosinec 2026',
			'listopad 2026 – únor 2027',
			'prosinec 2026 – Q1 2027',
			'Q1 2027',
		]);
		expect(timeline.scheduled.map((row) => row.groupLabel)).toEqual([
			'Q3 2026',
			'Q4 2026',
			'Q1 2027',
			'Q1 2027',
			'Q1 2027',
		]);
	});

	test('a long step that starts early comes after a short step that lands earlier', () => {
		const timeline = buildRoadmapTimeline(
			[
				step({
					id: 'step-001',
					title: 'Long migration',
					timing: { from: '2026-07', to: '2027-Q2' },
				}),
				step({ id: 'step-002', title: 'Quick fix', timing: { to: '2026-Q4' } }),
				step({ id: 'step-003', title: 'Later start', timing: { from: '2026-12', to: '2027-Q2' } }),
				step({ id: 'step-004', title: 'Same window', timing: { from: '2026-12', to: '2027-Q2' } }),
			],
			TODAY,
		);

		expect(timeline.scheduled.map((row) => row.step.id)).toEqual([
			'step-002',
			'step-001',
			'step-003',
			'step-004',
		]);
	});

	test('marks the first planned step in time order as next', () => {
		const timeline = buildRoadmapTimeline(launchSteps, TODAY);

		expect(timeline.next?.step.id).toBe('step-007');
		expect(timeline.scheduled.filter((row) => row.isNext).map((row) => row.step.id)).toEqual([
			'step-007',
		]);
	});

	test('builds a quarter axis with positioned bars and today marker', () => {
		const timeline = buildRoadmapTimeline(launchSteps, TODAY);

		expect(timeline.columns).toEqual([
			{ key: '2026-Q3', quarter: 'Q3', year: 2026 },
			{ key: '2026-Q4', quarter: 'Q4', year: null },
			{ key: '2027-Q1', quarter: 'Q1', year: 2027 },
		]);
		const [pilot] = timeline.scheduled;
		expect(pilot.offset).toBe(0);
		expect(pilot.span).toBeCloseTo(100 / 3, 5);
		const launch = timeline.scheduled.find((row) => row.step.id === 'step-002');
		expect(launch?.offset).toBeCloseTo(200 / 3, 5);
		expect(launch?.span).toBeCloseTo(100 / 3, 5);
		expect(timeline.todayOffset).toBeCloseTo(((3 + 30 / 31) / 9) * 100, 5);
		expect(timeline.currentGroupLabel).toBe('Q4 2026');
	});

	test('extends the axis to today only when today is near the plan', () => {
		const near = buildRoadmapTimeline(
			[step({ id: 'step-001', title: 'Spring release', timing: { to: '2027-Q2' } })],
			TODAY,
		);
		expect(near.columns.map((column) => column.key)).toEqual(['2026-Q4', '2027-Q1', '2027-Q2']);
		expect(near.todayOffset).not.toBeNull();

		const far = buildRoadmapTimeline(
			[step({ id: 'step-001', title: 'Later release', timing: { to: '2029-Q2' } })],
			TODAY,
		);
		expect(far.columns.map((column) => column.key)).toEqual(['2029-Q2']);
		expect(far.todayOffset).toBeNull();
	});

	test('keeps a roadmap without any timing readable as an unscheduled list', () => {
		const legacySteps = launchSteps.map(({ timing: _timing, ...rest }) => rest);
		const timeline = buildRoadmapTimeline(legacySteps, TODAY);

		expect(timeline.scheduled).toEqual([]);
		expect(timeline.columns).toEqual([]);
		expect(timeline.todayOffset).toBeNull();
		expect(timeline.unscheduled.map((row) => row.step.id)).toEqual([
			'step-001',
			'step-002',
			'step-003',
			'step-004',
			'step-005',
			'step-007',
		]);
		expect(timeline.next?.step.id).toBe('step-002');
	});

	test('treats invalid timing as unscheduled and counts it', () => {
		const timeline = buildRoadmapTimeline(
			[
				null,
				{ id: 'step-bad' },
				step({
					id: 'step-001',
					title: 'Backwards window',
					timing: { from: '2027-Q2', to: '2027-Q1' },
				}),
				step({ id: 'step-002', title: 'Valid window', timing: { to: '2027-Q1' } }),
			],
			TODAY,
		);

		expect(timeline.scheduled.map((row) => row.step.id)).toEqual(['step-002']);
		expect(timeline.unscheduled.map((row) => row.step.id)).toEqual(['step-001']);
		expect(timeline.invalidTimingCount).toBe(1);
	});
});

describe('Main roadmap selection', () => {
	test('prefers the single roadmap flagged main', () => {
		const selection = selectMainRoadmap([
			roadmapRecord('RM-0001', { status: 'in_progress' }),
			roadmapRecord('RM-0002', { main: true }),
		]);
		expect(selection.source).toBe('main');
		expect(selection.record?.roadmap.roadmap_code).toBe('RM-0002');
	});

	test('reports a conflict when several roadmaps are flagged main', () => {
		const selection = selectMainRoadmap([
			roadmapRecord('RM-0001', { main: true }),
			roadmapRecord('RM-0002', { main: true }),
		]);
		expect(selection.source).toBe('conflict');
		expect(selection.mainCodes).toEqual(['RM-0001', 'RM-0002']);
		expect(selection.record?.roadmap.roadmap_code).toBe('RM-0001');
	});

	test('falls back to the in-progress roadmap, then the first active one', () => {
		expect(selectMainRoadmap([roadmapRecord('RM-0001')]).source).toBe('only');
		const inProgress = selectMainRoadmap([
			roadmapRecord('RM-0001', { status: 'archived' }),
			roadmapRecord('RM-0002'),
			roadmapRecord('RM-0003', { status: 'in_progress' }),
		]);
		expect(inProgress.source).toBe('fallback');
		expect(inProgress.record?.roadmap.roadmap_code).toBe('RM-0003');
		const firstActive = selectMainRoadmap([
			roadmapRecord('RM-0001', { status: 'archived' }),
			roadmapRecord('RM-0002'),
		]);
		expect(firstActive.record?.roadmap.roadmap_code).toBe('RM-0002');
		expect(selectMainRoadmap([])).toEqual({ record: null, source: 'none', mainCodes: [] });
	});
});

describe('Main roadmap step links', () => {
	const plans = [
		{
			plan: {
				dev_code: 'DEV-0001',
				title: 'Template runtime',
				status: 'in_progress',
				github: {
					prs: [
						{ url: 'https://github.com/ExampleOrganization/product/pull/42', status: 'open' },
						{ url: 'javascript:alert(1)', status: 'open' },
					],
				},
				links: [
					{
						label: 'Launch checklist',
						url: 'https://github.com/ExampleOrganization/product/issues/7',
					},
					{ label: 'Design brief', url: 'https://example.invalid/brief' },
				],
			},
		},
	] as unknown as PlanRecord[];

	test('resolves plans, their pull requests and GitHub issues, legacy issue ids and evidence', () => {
		const links = stepLinks(
			step({
				id: 'step-001',
				title: 'Public launch',
				plan_refs: ['DEV-0001', 'DEV-0404'],
				issue_refs: ['issue-2026-01-01-001'],
				evidence_refs: [
					{
						label: 'Release PR',
						kind: 'pull_request',
						url: 'https://github.com/ExampleOrganization/product/pull/43',
						verification: 'external',
					},
					{ label: 'Launch notes', kind: 'doc', path: 'README.md' },
					{
						label: 'Unsafe link',
						kind: 'external',
						url: 'javascript:alert(1)',
						verification: 'external',
					},
				],
			}),
			plans,
		);

		expect(links.plans).toEqual([
			{ code: 'DEV-0001', title: 'Template runtime', status: 'in_progress' },
			{ code: 'DEV-0404', title: null, status: null },
		]);
		expect(links.pullRequests).toEqual([
			{
				url: 'https://github.com/ExampleOrganization/product/pull/42',
				label: 'product#42',
				status: 'open',
			},
			{
				url: 'https://github.com/ExampleOrganization/product/pull/43',
				label: 'product#43',
				status: null,
			},
		]);
		expect(links.issues).toEqual([
			{
				url: 'https://github.com/ExampleOrganization/product/issues/7',
				label: 'product#7 · Launch checklist',
			},
			{ url: null, label: 'issue-2026-01-01-001' },
		]);
		expect(links.evidence).toEqual([
			{ label: 'Launch notes', url: null, path: 'README.md' },
			{ label: 'Unsafe link', url: null, path: null },
		]);
	});

	test('only renders http(s) URLs as links', () => {
		expect(safeExternalUrl('https://example.invalid/a')).toBe('https://example.invalid/a');
		expect(safeExternalUrl('javascript:alert(1)')).toBeNull();
		expect(safeExternalUrl('data:text/html,hi')).toBeNull();
		expect(safeExternalUrl('not a url')).toBeNull();
	});
});
