import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { RepositoryPage, type RepositoryRuntimeState } from '../src/ui-app/pages/Repository.tsx';

const state: RepositoryRuntimeState = {
	status: {
		repositoryDbRoot: '/workspace/mission-control/db',
		expectedBranch: 'v3',
		branchConfigured: true,
		controlPlaneTrusted: true,
		controlPlaneDriftPaths: [],
		currentBranch: 'v3',
		head: 'abc123',
		expectedRemoteUrl: 'git@github.com:ExampleOrg/mission-control-data.git',
		remoteUrl: 'git@github.com:ExampleOrg/mission-control-data.git',
		remoteUrls: ['git@github.com:ExampleOrg/mission-control-data.git'],
		pushRemoteUrl: 'git@github.com:ExampleOrg/mission-control-data.git',
		pushRemoteUrls: ['git@github.com:ExampleOrg/mission-control-data.git'],
		localGitRoutingOverrides: [],
		localGitFetchRoutingOverrides: [],
		remoteConfigured: true,
		fetchRemoteMatches: true,
		remoteMatches: true,
		commitIdentityConfigured: true,
		clean: true,
		dirty: [],
		ahead: 0,
		behind: 0,
		remoteRefExists: true,
		remoteHead: 'a'.repeat(40),
	},
	writer: {
		mode: 'local-principal-v1',
		local_principal_ready: true,
		reason: null,
	},
	drafts: [
		{
			id: 'local-draft-ready',
			created_at: '2026-07-23T09:00:00.000Z',
			base_commit: 'abc123',
			summary: 'Local draft ready',
			operations: [
				{
					action: 'write_file',
					path: 'data/mission-control/reports/local-draft.txt',
					content: 'review this exact content\n',
				},
			],
			draft_revision: 'a'.repeat(64),
		},
	],
	changesets: {
		pending: [
			{
				id: 'change-ui-ready',
				status: 'approved',
				summary: 'Approved publish fixture',
				created_at: '2026-07-01T12:00:00.000Z',
				created_by: 'template-steward',
				approved_at: '2026-07-01T12:05:00.000Z',
				approved_by: 'template-steward',
				published_at: null,
				published_by: null,
				superseded_at: null,
				superseded_by: null,
				supersession_role: null,
				supersession_reason: null,
				replacement_changeset_id: null,
				relativePath: 'data/mission-control/changesets/pending/change-ui-ready.json',
				operations: [{ action: 'write_file', path: 'data/mission-control/reports/ui-ready.txt' }],
			},
		],
		published: [],
		superseded: [
			{
				id: 'change-ui-stale',
				status: 'superseded',
				summary: 'Stale UI fixture',
				created_at: '2026-07-01T11:00:00.000Z',
				created_by: 'template-steward',
				approved_at: null,
				approved_by: null,
				published_at: null,
				published_by: null,
				superseded_at: '2026-07-01T12:10:00.000Z',
				superseded_by: 'template-steward',
				supersession_role: 'steward',
				supersession_reason: 'Replaced after correcting the source heads.',
				replacement_changeset_id: 'change-ui-ready',
				relativePath: 'data/mission-control/changesets/superseded/change-ui-stale.json',
				operations: [{ action: 'write_file', path: 'data/mission-control/reports/stale.txt' }],
			},
		],
	},
};

describe('Repository publish UI', () => {
	test('renders repository health, draft form and publish action context', () => {
		const html = renderToStaticMarkup(
			<RepositoryPage state={state} loading={false} error={null} onRefresh={() => undefined} />,
		);

		expect(html).toContain('Repository publish');
		expect(html).toContain('clean');
		expect(html).toContain('Commit identity');
		expect(html).toContain('configured');
		expect(html).toContain('change-ui-ready');
		expect(html).toContain('Připravit lokální draft');
		expect(html).toContain('Local draft ready');
		expect(html).toContain('Publikovat změny');
		expect(html).not.toContain('Jednající (audit)');
		expect(html).not.toContain('Prázdné = Principál');
		expect(html).toContain('Nahrazené changesety');
		expect(html).toContain('change-ui-stale');
		expect(html).toContain('Replaced after correcting the source heads.');
		expect(html).toContain('change-ui-ready');
		expect(html).toContain('review this exact content');
	});

	test('explains automatic update validation and preservation of local changes', () => {
		const html = renderToStaticMarkup(
			<RepositoryPage state={state} loading={false} error={null} onRefresh={() => undefined} />,
		);

		expect(html).toContain('Aktualizace dat');
		expect(html).toContain('Stáhnout novější data');
		expect(html).toContain('ověří automaticky');
		expect(html).toContain('aktualizace je nepřepíše');
	});
});
