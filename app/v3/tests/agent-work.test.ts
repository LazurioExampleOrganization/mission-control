import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type AgentLedgerScan, scanAgentLedgers } from '../src/agent-ledgers/registry.ts';
import { MISSION_AGENT_WORK_SCHEMA_VERSION } from '../src/agent-work/contract.ts';
import {
	buildAgentWorkPayload,
	buildAgentWorkResponse,
	formatAgentWorkCliOutput,
	parseAgentWorkCliFormat,
} from '../src/agent-work.ts';
import { WORKSPACE_ROOT } from '../src/paths.ts';
import { route } from '../src/server.ts';

const scanFixture: AgentLedgerScan = {
	schemaVersion: 'companiesascode.agent_ledgers.v1',
	workspaceRoot: '/tmp/companiesascode',
	scannedAt: '2026-05-27T12:00:00.000Z',
	scopes: [
		{
			id: 'companiesascode-root',
			name: 'CompaniesAsCode root',
			path: '.',
			owner: 'workspace',
			state: 'available',
			ledgerFiles: 3,
		},
	],
	invalidFiles: [{ path: 'broken/TODO.tasks.json', kind: 'todo', errors: ['bad json'] }],
	blog: {
		schemaVersion: 'companiesascode.agents_blog.v1',
		summary: { files: 1, entries: 2, invalidFiles: 0, invalidEntries: 0 },
		files: [],
		entries: [],
	},
	work: {
		summary: {
			files: 3,
			todo: 4,
			issues: 1,
			done: 2,
			invalidFiles: 1,
			invalidItems: 0,
			missingAccessScopes: 0,
			plannedScopes: 0,
		},
		files: [],
		items: [],
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

describe('Mission Control agent work payload', () => {
	test('keeps plan, todo and blog sections under one Mission Control contract', () => {
		const payload = buildAgentWorkPayload(scanFixture);

		expect(payload.overview.sections.map((section) => section.id)).toEqual(['agent-work']);
		expect(payload.overview.sections.map((section) => section.owner)).toEqual(['mission-control']);
		expect(payload.schemaVersion).toBe(MISSION_AGENT_WORK_SCHEMA_VERSION);
		expect(payload.ledgerSchemaVersion).toBe('companiesascode.agent_ledgers.v1');
		expect(payload.workspace).toEqual({
			rootName: 'companiesascode',
			rootPath: '/tmp/companiesascode',
		});
		expect(payload.scannedAt).toBe('2026-05-27T12:00:00.000Z');
		expect(payload.overview.counts).toEqual({
			blogEntries: 2,
			todo: 4,
			issues: 1,
			done: 2,
			invalidFiles: 1,
			todoOutputWarnings: 0,
		});
		expect(payload.blog.summary.entries).toBe(2);
		expect(payload.blog.ledgerSchemaVersion).toBe('companiesascode.agents_blog.v1');
		expect(payload.blog.files).toEqual([]);
		expect(payload.blog.invalidFiles).toEqual([]);
		expect(payload.scopes[0]?.owner).toBe('workspace');
		expect(payload.workLedger.summary.todo).toBe(4);
		expect(payload.workLedger.summary.todoOutputWarnings).toBe(0);
		expect(payload.workLedger.summary.missingAccessScopes).toBe(0);
		expect(payload.workLedger.ledgerSchemaVersion).toBe('companiesascode.agent_ledgers.v1');
		expect(payload.workLedger.files).toEqual([]);
		expect(payload.cockpit.lanes.map((lane) => lane.id)).toEqual([
			'decisions',
			'active-work',
			'insights',
			'health',
		]);
		expect(payload.cockpit.decisions.total).toBe(0);
		expect(payload.cockpit.insights.total).toBe(0);
		expect(payload.cockpit.health.todoOutputWarnings).toBe(0);
	});

	test('exposes one response contract for HTTP and CLI consumers', () => {
		const response = buildAgentWorkResponse(scanFixture);

		expect(response).toEqual({ agentWork: buildAgentWorkPayload(scanFixture) });
		expect(response.agentWork.overview.owner).toBe('mission-control');
	});

	test('formats a stable JSON CLI response for agents', () => {
		const response = buildAgentWorkResponse(scanFixture);
		const output = formatAgentWorkCliOutput(response, 'json');

		expect(JSON.parse(output)).toEqual(response);
		expect(output.endsWith('\n')).toBe(true);
	});

	test('formats a compact summary CLI response for humans', () => {
		const response = buildAgentWorkResponse(scanFixture);
		const output = formatAgentWorkCliOutput(response, 'summary');

		expect(output).toContain('Mission Control agent work');
		expect(output).toContain('Scanned: 2026-05-27T12:00:00.000Z');
		expect(output).toContain('TODO: 4');
		expect(output).toContain('Invalid files: 1');
		expect(output).toContain('todo_outputs warnings: 0');
	});

	test('surfaces todo_outputs materialization warnings in health and summary output', () => {
		const response = buildAgentWorkResponse(scanFixture, {
			todoOutputMaterializationWarnings: [todoOutputWarning],
		});
		const healthLane = response.agentWork.cockpit.lanes.find((lane) => lane.id === 'health');

		expect(response.agentWork.overview.counts.todoOutputWarnings).toBe(1);
		expect(response.agentWork.workLedger.summary.todoOutputWarnings).toBe(1);
		expect(response.agentWork.workLedger.todoOutputMaterializationWarnings).toEqual([
			todoOutputWarning,
		]);
		expect(response.agentWork.cockpit.health.todoOutputWarnings).toBe(1);
		expect(response.agentWork.cockpit.health.todoOutputWarningDetails).toEqual([todoOutputWarning]);
		expect(healthLane).toMatchObject({
			count: 2,
			tone: 'warning',
			summary: 'Zkontrolovat ledgery i todo_outputs',
		});
		expect(formatAgentWorkCliOutput(response, 'summary')).toContain('todo_outputs warnings: 1');
	});

	test('adapts scanner records into contract records without leaking mutable references', () => {
		const scope = scanFixture.scopes[0];
		expect(scope).toBeDefined();
		if (!scope) throw new Error('missing scope fixture');
		const canonicalScope = { ...scope, ledgerFiles: 4 };
		const staleEmbeddedScope = { ...scope, ledgerFiles: 0 };
		const richScan: AgentLedgerScan = {
			...scanFixture,
			scopes: [canonicalScope],
			invalidFiles: [{ path: 'broken/TODO.tasks.json', kind: 'todo', errors: ['bad json'] }],
			blog: {
				...scanFixture.blog,
				files: [
					{
						path: 'BLOG.agents.json',
						scope: staleEmbeddedScope,
						entries: 1,
						invalidEntries: 0,
						errors: [],
					},
				],
				entries: [
					{
						id: 'blog-1',
						title: 'Ledger insight',
						createdAt: '2026-05-27',
						updatedAt: null,
						agent: 'example-agent',
						scope: staleEmbeddedScope,
						sourceTaskId: '86c9w83k2',
						sourceCustomId: 'ACME-6332',
						sourceUrl: 'https://example.test/t/86c9w83k2',
						insightType: 'implementation_note',
						visibilityHint: 'internal',
						contentPotential: 'internal',
						tags: ['mission-control'],
						summary: 'Contract entry fixture.',
						details: null,
						links: [{ label: 'Plan', path: 'mission-control/plans/ACME-6332.yaml', url: null }],
						filePath: 'BLOG.agents.json',
					},
				],
			},
			work: {
				...scanFixture.work,
				files: [
					{
						path: 'TODO.tasks.json',
						kind: 'todo',
						scope: staleEmbeddedScope,
						items: 1,
						invalidItems: 0,
						errors: [],
					},
				],
				items: [
					{
						id: 'task-1',
						kind: 'todo',
						title: 'Implement contract',
						status: 'open',
						priority: 'high',
						severity: null,
						scope: staleEmbeddedScope,
						tags: ['ACME-6332'],
						summary: 'Representative TODO item.',
						createdAt: '2026-05-27',
						updatedAt: '2026-05-27',
						completedAt: null,
						links: [
							{
								label: 'PR',
								path: null,
								url: 'https://github.com/ExampleOrganization/mission-control/pull/125',
							},
						],
						filePath: 'TODO.tasks.json',
					},
				],
			},
		};

		const payload = buildAgentWorkPayload(richScan);
		richScan.blog.entries[0]?.tags.push('mutated');
		richScan.work.items[0]?.links.push({ label: 'mutated', path: null, url: null });
		richScan.invalidFiles[0]?.errors.push('mutated');

		expect(payload.blog.entries[0]).toMatchObject({
			id: 'blog-1',
			scope: { id: 'companiesascode-root', ledgerFiles: 2 },
			tags: ['mission-control'],
			links: [{ label: 'Plan', path: 'mission-control/plans/ACME-6332.yaml', url: null }],
		});
		expect(payload.workLedger.items[0]).toMatchObject({
			id: 'task-1',
			scope: { id: 'companiesascode-root', ledgerFiles: 2 },
			tags: ['ACME-6332'],
			links: [
				{
					label: 'PR',
					path: null,
					url: 'https://github.com/ExampleOrganization/mission-control/pull/125',
				},
			],
		});
		expect(payload.cockpit.activeWork.items[0]).toMatchObject({ id: 'task-1' });
		expect(payload.invalidFiles[0]?.errors).toEqual(['bad json']);
	});

	test('adds discovered fallback scopes to the public contract', () => {
		const scope = scanFixture.scopes[0];
		expect(scope).toBeDefined();
		if (!scope) throw new Error('missing scope fixture');
		const fallbackScope = {
			...scope,
			id: 'company',
			name: 'company',
			path: 'company',
			owner: null,
			ledgerFiles: 0,
		};
		const payload = buildAgentWorkPayload({
			...scanFixture,
			blog: {
				...scanFixture.blog,
				files: [
					{
						path: 'company/BLOG.agents.json',
						scope: fallbackScope,
						entries: 0,
						invalidEntries: 0,
						errors: [],
					},
				],
			},
		});

		expect(payload.scopes).toEqual(
			expect.arrayContaining([expect.objectContaining({ path: 'company', ledgerFiles: 1 })]),
		);
		expect(payload.blog.files[0]?.scope).toMatchObject({ path: 'company', ledgerFiles: 1 });
	});

	test('parses supported CLI output formats', () => {
		expect(parseAgentWorkCliFormat([])).toBe('json');
		expect(parseAgentWorkCliFormat(['--format', 'json'])).toBe('json');
		expect(parseAgentWorkCliFormat(['--format', 'summary'])).toBe('summary');
		expect(parseAgentWorkCliFormat(['--format=summary'])).toBe('summary');
		expect(parseAgentWorkCliFormat(['--summary'])).toBe('summary');
		expect(() => parseAgentWorkCliFormat(['--format', 'yaml'])).toThrow(
			'Unsupported agent-work format: yaml',
		);
	});

	test('scans ISSUES.resolved.json ledgers into the agent work scan', () => {
		const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'mc-agent-ledgers-'));
		try {
			const moduleDir = path.join(workspaceRoot, 'modules', 'example');
			mkdirSync(moduleDir, { recursive: true });
			writeFileSync(
				path.join(moduleDir, 'ISSUES.resolved.json'),
				`${JSON.stringify(
					{
						schema_version: 'companiesascode.issues_resolved.v1',
						scope: { id: 'example', name: 'Example', path: 'modules/example' },
						issues: [
							{
								id: 'issue-2026-06-01-001',
								title: 'Resolved decision fixture',
								status: 'resolved',
								summary: 'Issue resolved through the Mission Control resolve flow.',
								created_at: '2026-06-01',
								updated_at: '2026-06-02',
							},
						],
					},
					null,
					2,
				)}\n`,
			);

			const scan = scanAgentLedgers(workspaceRoot);

			// Resolved ledger se musí objevit ve work scanu stejně jako ve
			// work-boardu; dřív ho discovery set ignoroval.
			expect(scan.work.files).toEqual([
				expect.objectContaining({
					path: 'modules/example/ISSUES.resolved.json',
					kind: 'issues',
					items: 1,
				}),
			]);
			expect(scan.work.items).toEqual([
				expect.objectContaining({
					id: 'issue-2026-06-01-001',
					kind: 'issue',
					status: 'resolved',
					filePath: 'modules/example/ISSUES.resolved.json',
				}),
			]);
			expect(scan.work.summary.files).toBe(1);
			expect(scan.work.summary.issues).toBe(1);
			expect(scan.invalidFiles).toEqual([]);
		} finally {
			rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('explicit canonical ledger list excludes frozen workspace mirrors', () => {
		const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'mc-agent-ledgers-'));
		try {
			const canonicalPath = path.join(
				workspaceRoot,
				'mission-control/db/data/mission-control/TODO.tasks.json',
			);
			const mirrorPath = path.join(workspaceRoot, 'TODO.tasks.json');
			for (const [filePath, id] of [
				[canonicalPath, 'canonical-task'],
				[mirrorPath, 'frozen-mirror-task'],
			]) {
				mkdirSync(path.dirname(filePath), { recursive: true });
				writeFileSync(
					filePath,
					`${JSON.stringify({
						schema_version: 'companiesascode.todo_tasks.v1',
						tasks: [{ id, title: id, status: 'open' }],
					})}\n`,
				);
			}

			const scan = scanAgentLedgers(workspaceRoot, {
				ledgerFiles: [canonicalPath],
			});
			expect(scan.work.files.map((file) => file.path)).toEqual([
				'mission-control/db/data/mission-control/TODO.tasks.json',
			]);
			expect(scan.work.items.map((item) => item.id)).toEqual(['canonical-task']);
		} finally {
			rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('configured repository array ledgers keep the root Agent Work scope', () => {
		const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'mc-agent-ledgers-'));
		try {
			const canonicalPath = path.join(
				workspaceRoot,
				'mission-control/db/data/mission-control/TODO.tasks.json',
			);
			mkdirSync(path.dirname(canonicalPath), { recursive: true });
			writeFileSync(
				canonicalPath,
				`${JSON.stringify([{ id: 'canonical-task', title: 'Canonical task', status: 'open' }])}\n`,
			);

			const scan = scanAgentLedgers(workspaceRoot, {
				workLedgerFiles: [canonicalPath],
				rootWorkLedgerFiles: [canonicalPath],
			});
			expect(scan.work.files[0]?.scope).toMatchObject({
				id: 'companiesascode-root',
				path: '.',
			});
			expect(scan.work.items[0]?.scope).toMatchObject({
				id: 'companiesascode-root',
				path: '.',
			});
		} finally {
			rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('canonical work-ledger selection preserves independently discovered Agent Blog files', () => {
		const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'mc-agent-ledgers-'));
		try {
			const canonicalPath = path.join(
				workspaceRoot,
				'mission-control/db/data/mission-control/TODO.tasks.json',
			);
			const mirrorPath = path.join(workspaceRoot, 'TODO.tasks.json');
			const blogPath = path.join(workspaceRoot, 'modules/example/BLOG.agents.json');
			for (const [filePath, id] of [
				[canonicalPath, 'canonical-task'],
				[mirrorPath, 'frozen-mirror-task'],
			]) {
				mkdirSync(path.dirname(filePath), { recursive: true });
				writeFileSync(
					filePath,
					`${JSON.stringify({
						schema_version: 'companiesascode.todo_tasks.v1',
						tasks: [{ id, title: id, status: 'open' }],
					})}\n`,
				);
			}
			mkdirSync(path.dirname(blogPath), { recursive: true });
			writeFileSync(
				blogPath,
				`${JSON.stringify({
					schema_version: 'companiesascode.agents_blog.v1',
					entries: [
						{
							id: 'blog-entry-1',
							title: 'Agent Blog insight',
							created_at: '2026-07-18',
							insight_type: 'learning',
							visibility_hint: 'internal',
							content_potential: 'low',
							summary: 'Agent Blog remains independently discoverable.',
						},
					],
				})}\n`,
			);

			const scan = scanAgentLedgers(workspaceRoot, {
				workLedgerFiles: [canonicalPath],
			});
			expect(scan.work.items.map((item) => item.id)).toEqual(['canonical-task']);
			expect(scan.blog.files.map((file) => file.path)).toEqual([
				'modules/example/BLOG.agents.json',
			]);
			expect(scan.blog.entries.map((entry) => entry.id)).toEqual(['blog-entry-1']);
		} finally {
			rmSync(workspaceRoot, { recursive: true, force: true });
		}
	});

	test('serves the same response contract through HTTP', async () => {
		const response = await route(new Request('http://mission-control.test/api/agent-work'));
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.agentWork.schemaVersion).toBe(MISSION_AGENT_WORK_SCHEMA_VERSION);
		expect(body.agentWork.overview.owner).toBe('mission-control');
		expect(body.agentWork.workspace.rootName).toBe(path.basename(WORKSPACE_ROOT));
		expect(body.agentWork.workspace.rootPath).toBe(WORKSPACE_ROOT);
		expect(body.agentWork.workLedger.files.map((file: { path: string }) => file.path)).toEqual([
			'templates/organization-data/data/mission-control/DONE.tasks.json',
			'templates/organization-data/data/mission-control/ISSUES.open.json',
			'templates/organization-data/data/mission-control/ISSUES.resolved.json',
			'templates/organization-data/data/mission-control/TODO.tasks.json',
		]);
	});
});
