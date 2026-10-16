// Typové deklarace pro pull/freshness engine (mission-control-pull.mjs).
// Engine samotný je plain .mjs sdílený s CLI/agenty; UI a server ho volají
// odsud, aby TypeScript viděl tvary návratových hodnot.

declare module '*/mission-control-pull.mjs' {
	export type RepositoryStatusShape = {
		repositoryDbRoot: string;
		expectedBranch: string;
		branchConfigured: boolean;
		controlPlaneTrusted: boolean;
		controlPlaneDriftPaths: string[];
		currentBranch: string;
		head: string;
		expectedRemoteUrl: string | null;
		remoteUrl: string | null;
		remoteUrls: string[];
		pushRemoteUrl: string | null;
		pushRemoteUrls: string[];
		localGitRoutingOverrides: string[];
		localGitFetchRoutingOverrides: string[];
		remoteConfigured: boolean;
		fetchRemoteMatches: boolean;
		remoteMatches: boolean;
		commitIdentityConfigured: boolean;
		clean: boolean;
		dirty: string[];
		ahead: number | null;
		behind: number | null;
		remoteRefExists: boolean;
		remoteHead: string | null;
	};

	export type FetchResult = {
		ok: boolean;
		branch: string | null;
		verifiedHead: string | null;
		timedOut: boolean;
		reason: string | null;
		error: string | null;
	};

	export type FreshnessResult = {
		status: RepositoryStatusShape;
		fetch: FetchResult;
		// True když jsme chtěli fetch, ale nedoběhl (offline/credential/
		// timeout) — freshness je pak počítaná proti starému origin ref.
		staleFreshness: boolean;
		behind: number;
		ahead: number;
		behindRemote: boolean;
		diverged: boolean;
		newerAvailable: boolean;
		localDraftCount: number;
		pullSafe: boolean;
		pullBlockedReason: string | null;
		checkedAt: string;
	};

	export type PullResult = {
		pulled: boolean;
		reason: string;
		fromHead: string;
		toHead: string;
		status: RepositoryStatusShape;
	};

	export class MissionControlPullError extends Error {
		reason: string;
		status: RepositoryStatusShape | null;
	}

	export function fetchMissionControlRemote(args: {
		repositoryDbRoot: string;
		timeoutMs?: number;
	}): FetchResult;

	export function getMissionControlFreshness(args: {
		repositoryDbRoot: string;
		fetch?: boolean;
		timeoutMs?: number;
	}): FreshnessResult;

	export function pullMissionControlRepository(args: {
		repositoryDbRoot: string;
		timeoutMs?: number;
	}): PullResult;
}
