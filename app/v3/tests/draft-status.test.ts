// Odvození globálního draft indikátoru — čistá logika, bez sítě.

import { describe, expect, test } from 'bun:test';
import type { RepositoryFreshness, RepositoryRuntimeState } from '../src/ui-app/api.ts';
import { deriveDraftIndicator } from '../src/ui-app/draft-status.ts';

function baseStatus(
	overrides: Partial<RepositoryRuntimeState['status']> = {},
): RepositoryRuntimeState['status'] {
	return {
		repositoryDbRoot: '/data',
		expectedBranch: 'v3',
		branchConfigured: true,
		controlPlaneTrusted: true,
		controlPlaneDriftPaths: [],
		currentBranch: 'v3',
		head: 'abc123',
		expectedRemoteUrl: 'git@example:org/data.git',
		remoteUrl: 'git@example:org/data.git',
		remoteUrls: ['git@example:org/data.git'],
		pushRemoteUrl: 'git@example:org/data.git',
		pushRemoteUrls: ['git@example:org/data.git'],
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
		...overrides,
	};
}

function state(
	overrides: Partial<RepositoryRuntimeState['status']> = {},
	drafts: RepositoryRuntimeState['drafts'] = [],
): RepositoryRuntimeState {
	return {
		status: baseStatus(overrides),
		writer: {
			mode: 'local-principal-v1',
			local_principal_ready: true,
			reason: null,
		},
		drafts,
		changesets: { pending: [], published: [] },
	};
}

const localDraft: RepositoryRuntimeState['drafts'][number] = {
	id: 'draft-1',
	created_at: '2026-07-23T09:00:00.000Z',
	base_commit: 'a'.repeat(40),
	summary: 'x',
	operations: [],
	draft_revision: 'b'.repeat(64),
};

describe('deriveDraftIndicator', () => {
	test('clean, up-to-date repo produces a silent indicator', () => {
		const indicator = deriveDraftIndicator(state(), null);
		expect(indicator.visible).toBe(false);
		expect(indicator.tone).toBe('clean');
	});

	test('null state is silent', () => {
		expect(deriveDraftIndicator(null, null).visible).toBe(false);
	});

	test('dirty working tree surfaces unpublished local work', () => {
		const indicator = deriveDraftIndicator(
			state({ clean: false, dirty: [' M a.yaml', ' M b.yaml'] }),
			null,
		);
		expect(indicator.visible).toBe(true);
		expect(indicator.tone).toBe('draft');
		expect(indicator.dirtyCount).toBe(2);
	});

	test('dirty working tree keeps its local draft count visible', () => {
		const indicator = deriveDraftIndicator(
			state({ clean: false, dirty: [' M a.yaml'] }, [localDraft]),
			null,
		);
		expect(indicator.tone).toBe('draft');
		expect(indicator.pendingCount).toBe(1);
	});

	test('local draft surfaces even when working tree is clean', () => {
		const indicator = deriveDraftIndicator(state({}, [localDraft]), null);
		expect(indicator.visible).toBe(true);
		expect(indicator.tone).toBe('pending');
		expect(indicator.pendingCount).toBe(1);
	});

	test('a background refresh keeps the last known clean state visible', () => {
		const freshness: RepositoryFreshness = {
			status: baseStatus(),
			fetch: {
				ok: false,
				branch: null,
				verifiedHead: null,
				timedOut: false,
				reason: null,
				error: null,
			},
			staleFreshness: true,
			behind: 0,
			ahead: 0,
			behindRemote: false,
			diverged: false,
			newerAvailable: false,
			localDraftCount: 0,
			pullSafe: false,
			pullBlockedReason: 'refresh_in_progress',
			checkedAt: 'now',
			refreshing: true,
			refreshState: 'refreshing',
			refreshStartedAt: 'now',
			refreshCompletedAt: null,
			refreshError: null,
		};
		const indicator = deriveDraftIndicator(state(), freshness);
		expect(indicator.visible).toBe(true);
		expect(indicator.label).toBe('Kontroluji novější data');
		expect(indicator.detail).toContain('na pozadí');
	});

	test('newer remote data (behind > 0) surfaces a pullable state', () => {
		const freshness: RepositoryFreshness = {
			status: baseStatus({ behind: 3 }),
			fetch: {
				ok: true,
				branch: 'v3',
				verifiedHead: 'a'.repeat(40),
				timedOut: false,
				reason: null,
				error: null,
			},
			staleFreshness: false,
			behind: 3,
			ahead: 0,
			behindRemote: true,
			diverged: false,
			newerAvailable: true,
			pullSafe: true,
			pullBlockedReason: null,
			checkedAt: 'now',
			refreshing: false,
			refreshState: 'succeeded',
			refreshStartedAt: 'before',
			refreshCompletedAt: 'now',
			refreshError: null,
		};
		const indicator = deriveDraftIndicator(state({ behind: 3 }), freshness);
		expect(indicator.visible).toBe(true);
		expect(indicator.tone).toBe('newer');
		expect(indicator.newerAvailable).toBe(true);
		expect(indicator.pullSafe).toBe(true);
	});

	test('stale cached newer data never claims that pull is safe', () => {
		const freshness: RepositoryFreshness = {
			status: baseStatus({ behind: 1 }),
			fetch: {
				ok: false,
				branch: 'v3',
				verifiedHead: null,
				timedOut: false,
				reason: 'fetch_failed',
				error: 'offline',
			},
			staleFreshness: true,
			behind: 1,
			ahead: 0,
			behindRemote: true,
			diverged: false,
			newerAvailable: true,
			pullSafe: false,
			pullBlockedReason: 'fetch_failed',
			checkedAt: 'now',
			refreshing: false,
			refreshState: 'failed',
			refreshStartedAt: 'before',
			refreshCompletedAt: 'now',
			refreshError: { reason: 'fetch_failed', message: 'offline', timedOut: false },
		};
		const indicator = deriveDraftIndicator(state({ behind: 1 }), freshness);
		expect(indicator.visible).toBe(true);
		expect(indicator.tone).toBe('newer');
		expect(indicator.pullSafe).toBe(false);
		expect(indicator.detail).toContain('pull teď není bezpečný');
		expect(indicator.detail).toContain('Nepodařilo se ověřit remote');
		expect(indicator.detail).not.toContain('Můžete je bezpečně stáhnout');
	});

	test('divergence is a conflict that blocks both publish and pull', () => {
		const indicator = deriveDraftIndicator(state({ ahead: 2, behind: 1 }), null);
		expect(indicator.tone).toBe('conflict');
		expect(indicator.conflict).toBe(true);
	});

	test('wrong branch is a conflict', () => {
		const indicator = deriveDraftIndicator(state({ currentBranch: 'main' }), null);
		expect(indicator.tone).toBe('conflict');
		expect(indicator.conflict).toBe(true);
	});

	test('dirty draft takes priority over newer remote data (pull must not be offered as safe)', () => {
		const freshness: RepositoryFreshness = {
			status: baseStatus({ clean: false, dirty: [' M a'], behind: 2 }),
			fetch: {
				ok: true,
				branch: 'v3',
				verifiedHead: 'a'.repeat(40),
				timedOut: false,
				reason: null,
				error: null,
			},
			staleFreshness: false,
			behind: 2,
			ahead: 0,
			behindRemote: true,
			diverged: false,
			newerAvailable: true,
			pullSafe: false,
			pullBlockedReason: 'dirty_working_tree',
			checkedAt: 'now',
			refreshing: false,
			refreshState: 'succeeded',
			refreshStartedAt: 'before',
			refreshCompletedAt: 'now',
			refreshError: null,
		};
		const indicator = deriveDraftIndicator(
			state({ clean: false, dirty: [' M a'], behind: 2 }),
			freshness,
		);
		expect(indicator.tone).toBe('draft');
		expect(indicator.pullSafe).toBe(false);
	});
});
