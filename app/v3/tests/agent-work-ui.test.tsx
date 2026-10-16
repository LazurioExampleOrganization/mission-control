import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AgentLedgerScan } from '../src/agent-ledgers/registry.ts';
import { buildAgentWorkPayload } from '../src/agent-work.ts';
import type { PlanRecord } from '../src/model.ts';
import type { WorkBoardResponse } from '../src/ui-app/api.ts';
import { AgentWorkPage } from '../src/ui-app/pages/AgentWork.tsx';
import { WorkBoardPage } from '../src/ui-app/pages/WorkBoard.tsx';

const scope = {
	id: 'companiesascode-root',
	name: 'CompaniesAsCode root',
	path: '.',
	owner: 'workspace',
	state: 'available' as const,
	ledgerFiles: 2,
};

const scanFixture: AgentLedgerScan = {
	schemaVersion: 'companiesascode.agent_ledgers.v1',
	workspaceRoot: '/workspace/ExampleOrganization',
	scannedAt: '2026-05-28T10:00:00.000Z',
	scopes: [scope],
	invalidFiles: [],
	blog: {
		schemaVersion: 'companiesascode.agents_blog.v1',
		summary: { files: 1, entries: 1, invalidFiles: 0, invalidEntries: 0 },
		files: [],
		entries: [
			{
				id: 'blog-1',
				title: 'Mission Control needs one cockpit',
				createdAt: '2026-05-28',
				updatedAt: null,
				agent: 'example-agent',
				scope,
				sourceTaskId: null,
				sourceCustomId: 'ACME-6332',
				sourceUrl: null,
				insightType: 'implementation_note',
				visibilityHint: 'internal',
				contentPotential: 'internal',
				tags: ['mission-control'],
				summary: 'Agent work should read as one queue, not three disconnected pages.',
				details: null,
				links: [],
				filePath: 'BLOG.agents.json',
			},
		],
	},
	work: {
		summary: {
			files: 2,
			todo: 1,
			issues: 1,
			done: 1,
			invalidFiles: 0,
			invalidItems: 0,
			missingAccessScopes: 0,
			plannedScopes: 0,
		},
		files: [],
		items: [
			{
				id: 'issue-1',
				kind: 'issue',
				title: 'Rozhodnout PR visibility',
				status: 'decision_needed',
				priority: null,
				severity: 'high',
				scope,
				tags: ['mission-control'],
				summary: 'Lidi musí vidět, co potřebuje rozhodnutí.',
				createdAt: '2026-05-28',
				updatedAt: '2026-05-28',
				completedAt: null,
				links: [{ label: 'Plan', path: 'mission-control/plans/ACME-6332.yaml', url: null }],
				filePath: 'ISSUES.open.json',
			},
			{
				id: 'todo-1',
				kind: 'todo',
				title: 'Implementovat cockpit',
				status: 'open',
				priority: 'high',
				severity: null,
				scope,
				tags: ['mission-control'],
				summary: 'Agentní práce.',
				createdAt: '2026-05-28',
				updatedAt: '2026-05-28',
				completedAt: null,
				links: [],
				filePath: 'TODO.tasks.json',
			},
			{
				id: 'done-1',
				kind: 'done',
				title: 'Remove split pages',
				status: 'done',
				priority: 'high',
				severity: null,
				scope,
				tags: ['mission-control'],
				summary: 'One cockpit replaced the PLAN/TODO/BLOG wireframe.',
				createdAt: '2026-05-28',
				updatedAt: '2026-05-28',
				completedAt: '2026-05-28',
				links: [],
				filePath: 'DONE.tasks.json',
			},
		],
	},
};

function planRecord(): PlanRecord {
	return {
		absolutePath: '/workspace/ExampleOrganization/mission-control/plans/2026/05/ACME-6332.yaml',
		relativePath: 'plans/2026/05/ACME-6332.yaml',
		workspacePath: 'mission-control/plans/2026/05/ACME-6332.yaml',
		plan: {
			schema_version: 'companiesascode.mission_control.plan.v2',
			id: 'mcplan-acme-6332',
			dev_code: 'ACME-6332',
			title: 'Mission Control agent work UI',
			status: 'review',
			owner: 'workspace-admin',
			priority: 'high',
			priority_rank: 10,
			created_at: '2026-05-28',
			updated_at: '2026-05-28',
			context: 'Test context',
			current_problem: 'Test problem',
			target_state: 'Test target',
			scope: { in: ['UI'], out: [] },
			acceptance_criteria: ['Visible PRs'],
			validation: ['bun test'],
			github: {
				prs: [
					{
						url: 'https://github.com/ExampleOrganization/mission-control/pull/125',
						status: 'open',
						note: 'Mission Control agent work contract',
					},
				],
			},
		},
	};
}

const boardFixture: WorkBoardResponse['board'] = {
	planning_coverage: {
		todo_with_plan: 1,
		todo_without_plan: 0,
		dev_without_plan: [],
		broken_plan_links: [],
		ledger_read_errors: [],
	},
};

const todoOutputWarning = {
	code: 'missing_todo_output',
	severity: 'warning',
	plan_id: 'mcplan-acme-7001',
	dev_code: 'ACME-7001',
	plan_path: 'mission-control/plans/2026/05/ACME-7001.yaml',
	output_id: 'phantom-task',
	message:
		'ACME-7001 todo_outputs references phantom-task, but no TODO/DONE ledger row with that id was scanned.',
} as const;

describe('Mission Control agent work UI', () => {
	test('renders one cockpit with decision, work, insight and health lanes', () => {
		const agentWork = buildAgentWorkPayload(scanFixture);
		const markup = renderToStaticMarkup(
			<AgentWorkPage agentWork={agentWork} board={boardFixture} />,
		);

		expect(markup).toContain('Agent work cockpit');
		expect(markup).toContain('Historie issues');
		expect(markup).toContain('Aktivní práce');
		expect(markup).toContain('Insights');
		expect(markup).toContain('Health');
		expect(markup).toContain('Rozhodnout PR visibility');
		expect(markup).toContain('severity high');
		expect(markup).toContain('Workspace Admin');
		expect(markup).not.toContain('Vyřešit');
		expect(markup).not.toContain('<form');
		expect(markup).toContain('GitHub Issues');
	});

	test('shows todo_outputs materialization warnings in health lane metadata', () => {
		const agentWork = buildAgentWorkPayload(scanFixture, {
			todoOutputMaterializationWarnings: [todoOutputWarning],
		});
		const markup = renderToStaticMarkup(
			<AgentWorkPage agentWork={agentWork} board={boardFixture} />,
		);

		expect(markup).toContain('Zkontrolovat todo_outputs');
		expect(markup).toContain('todo_outputs');
	});

	test('renders plan-linked open PR URLs as a lightweight review surface', () => {
		const markup = renderToStaticMarkup(
			<WorkBoardPage board={boardFixture} plans={[planRecord()]} />,
		);

		expect(markup).toContain('Otevřené PR navázané na plány');
		expect(markup).toContain('ACME-6332');
		expect(markup).toContain('https://github.com/ExampleOrganization/mission-control/pull/125');
		expect(markup).toContain('Mission Control agent work contract');
	});

	test('keeps work board refresh errors separate from agent work errors', () => {
		const agentWork = buildAgentWorkPayload(scanFixture);
		const agentMarkup = renderToStaticMarkup(
			<AgentWorkPage
				agentWork={agentWork}
				board={boardFixture}
				workBoardError='work board failed'
			/>,
		);
		const boardMarkup = renderToStaticMarkup(
			<WorkBoardPage board={boardFixture} plans={[planRecord()]} error='work board failed' />,
		);

		expect(agentMarkup).toContain('Poslední refresh Work boardu selhal: work board failed');
		expect(agentMarkup).not.toContain(
			'Poslední refresh agentního ledgeru selhal: work board failed',
		);
		expect(boardMarkup).toContain('Poslední refresh Work boardu selhal: work board failed');
	});
});
