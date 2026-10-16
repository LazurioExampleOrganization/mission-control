import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FreshnessResult } from '../../../src/mission-control-pull.mjs';
import { getMissionControlFreshness } from '../../../src/mission-control-pull.mjs';

const DEFAULT_FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_WORKER_TIMEOUT_MS = 20_000;

export type RepositoryRefreshState = 'idle' | 'refreshing' | 'succeeded' | 'failed';

export type RepositoryFreshnessSnapshot = FreshnessResult & {
	refreshing: boolean;
	refreshState: RepositoryRefreshState;
	refreshStartedAt: string | null;
	refreshCompletedAt: string | null;
	refreshError: {
		reason: string;
		message: string;
		timedOut: boolean;
	} | null;
};

export type FreshnessWorkerRequest = {
	repositoryDbRoot: string;
	timeoutMs: number;
};

export type FreshnessWorkerResponse =
	| { ok: true; result: FreshnessResult }
	| { ok: false; error: { reason: string; message: string; timedOut: boolean } };

type RefreshFailure = {
	reason: string;
	message: string;
	timedOut: boolean;
};

type CompletedRefresh = {
	startedAt: string;
	completedAt: string;
	result: FreshnessResult | null;
	error: RefreshFailure | null;
};

type ActiveRefresh = {
	startedAt: string;
	worker: Worker;
	settled: Promise<void>;
};

type FreshnessEntry = {
	active: ActiveRefresh | null;
	latest: CompletedRefresh | null;
	lastSuccessful: FreshnessResult | null;
};

export type RepositoryFreshnessServiceOptions = {
	workerUrl?: string;
	workerTimeoutMs?: number;
	fetchTimeoutMs?: number;
	workerFactory?: (url: string) => Worker;
	now?: () => Date;
};

function canonicalRepositoryRoot(repositoryDbRoot: string): string {
	return realpathSync(resolve(repositoryDbRoot));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isFreshnessResult(value: unknown, repositoryDbRoot: string): value is FreshnessResult {
	if (!isRecord(value) || !isRecord(value.status) || !isRecord(value.fetch)) return false;
	return (
		value.status.repositoryDbRoot === repositoryDbRoot &&
		typeof value.status.head === 'string' &&
		typeof value.status.currentBranch === 'string' &&
		typeof value.status.expectedBranch === 'string' &&
		(typeof value.status.expectedRemoteUrl === 'string' ||
			value.status.expectedRemoteUrl === null) &&
		(typeof value.status.remoteUrl === 'string' || value.status.remoteUrl === null) &&
		typeof value.status.fetchRemoteMatches === 'boolean' &&
		typeof value.status.controlPlaneTrusted === 'boolean' &&
		typeof value.status.remoteRefExists === 'boolean' &&
		(typeof value.status.remoteHead === 'string' || value.status.remoteHead === null) &&
		typeof value.status.clean === 'boolean' &&
		Array.isArray(value.status.dirty) &&
		value.status.dirty.every((item) => typeof item === 'string') &&
		(typeof value.status.ahead === 'number' || value.status.ahead === null) &&
		(typeof value.status.behind === 'number' || value.status.behind === null) &&
		typeof value.fetch.ok === 'boolean' &&
		typeof value.fetch.timedOut === 'boolean' &&
		typeof value.staleFreshness === 'boolean' &&
		typeof value.behind === 'number' &&
		typeof value.ahead === 'number' &&
		typeof value.behindRemote === 'boolean' &&
		typeof value.diverged === 'boolean' &&
		typeof value.newerAvailable === 'boolean' &&
		typeof value.localDraftCount === 'number' &&
		typeof value.pullSafe === 'boolean' &&
		typeof value.checkedAt === 'string'
	);
}

function sameStringArray(left: string[], right: string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameRepositoryPosition(left: FreshnessResult, right: FreshnessResult): boolean {
	return (
		left.status.repositoryDbRoot === right.status.repositoryDbRoot &&
		left.status.head === right.status.head &&
		left.status.currentBranch === right.status.currentBranch &&
		left.status.expectedBranch === right.status.expectedBranch &&
		left.status.expectedRemoteUrl === right.status.expectedRemoteUrl &&
		left.status.remoteUrl === right.status.remoteUrl &&
		left.status.fetchRemoteMatches === right.status.fetchRemoteMatches &&
		left.status.controlPlaneTrusted === right.status.controlPlaneTrusted &&
		left.status.remoteRefExists === right.status.remoteRefExists &&
		left.status.remoteHead === right.status.remoteHead &&
		left.fetch.verifiedHead === right.status.remoteHead &&
		left.status.ahead === right.status.ahead &&
		left.status.behind === right.status.behind
	);
}

function samePullSafetyState(left: FreshnessResult, right: FreshnessResult): boolean {
	return (
		sameRepositoryPosition(left, right) &&
		left.status.clean === right.status.clean &&
		sameStringArray(left.status.dirty, right.status.dirty) &&
		left.localDraftCount === right.localDraftCount
	);
}

function workerFailure(reason: string, message: string, timedOut = false): RefreshFailure {
	return { reason, message, timedOut };
}

function failedFetch(error: RefreshFailure, branch: string | null): FreshnessResult['fetch'] {
	return {
		ok: false,
		branch,
		verifiedHead: null,
		timedOut: error.timedOut,
		reason: error.reason,
		error: error.message,
	};
}

function localPullBlocker(local: FreshnessResult): string | null {
	if (!local.status.controlPlaneTrusted || !local.status.fetchRemoteMatches) {
		return local.pullBlockedReason;
	}
	if (local.status.currentBranch !== local.status.expectedBranch) return 'wrong_branch';
	if (local.localDraftCount > 0) return 'local_draft_present';
	if (!local.status.clean) return 'dirty_working_tree';
	if (local.diverged) return 'diverged';
	return null;
}

export class RepositoryFreshnessService {
	readonly #entries = new Map<string, FreshnessEntry>();
	readonly #workerUrl: string;
	readonly #workerTimeoutMs: number;
	readonly #fetchTimeoutMs: number;
	readonly #workerFactory: (url: string) => Worker;
	readonly #now: () => Date;

	constructor(options: RepositoryFreshnessServiceOptions = {}) {
		this.#workerUrl =
			options.workerUrl ?? new URL('./repository-freshness-worker.ts', import.meta.url).href;
		this.#workerTimeoutMs = options.workerTimeoutMs ?? DEFAULT_WORKER_TIMEOUT_MS;
		this.#fetchTimeoutMs = options.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
		this.#workerFactory = options.workerFactory ?? ((url) => new Worker(url));
		this.#now = options.now ?? (() => new Date());
	}

	async snapshot(
		repositoryDbRoot: string,
		{ refresh = true }: { refresh?: boolean } = {},
	): Promise<RepositoryFreshnessSnapshot> {
		const root = canonicalRepositoryRoot(repositoryDbRoot);
		const entry = this.#entry(root);
		const local = getMissionControlFreshness({ repositoryDbRoot: root, fetch: false });
		if (refresh && !entry.active) this.#startRefresh(root, entry);
		return this.#compose(local, entry);
	}

	async waitForIdle(repositoryDbRoot: string): Promise<void> {
		const root = canonicalRepositoryRoot(repositoryDbRoot);
		await this.#entries.get(root)?.active?.settled;
	}

	#entry(root: string): FreshnessEntry {
		let entry = this.#entries.get(root);
		if (!entry) {
			entry = { active: null, latest: null, lastSuccessful: null };
			this.#entries.set(root, entry);
		}
		return entry;
	}

	#startRefresh(root: string, entry: FreshnessEntry): void {
		const startedAt = this.#now().toISOString();
		let settle!: () => void;
		const settled = new Promise<void>((resolveSettled) => {
			settle = resolveSettled;
		});
		let worker: Worker;
		try {
			worker = this.#workerFactory(this.#workerUrl);
		} catch (error) {
			entry.latest = {
				startedAt,
				completedAt: this.#now().toISOString(),
				result: null,
				error: workerFailure(
					'refresh_worker_start_failed',
					error instanceof Error ? error.message : String(error),
				),
			};
			settle();
			return;
		}

		entry.active = { startedAt, worker, settled };
		let completed = false;
		const finish = (result: FreshnessResult | null, error: RefreshFailure | null): void => {
			if (completed) return;
			completed = true;
			clearTimeout(timer);
			worker.onmessage = null;
			worker.onerror = null;
			void worker.terminate();
			entry.active = null;
			entry.latest = {
				startedAt,
				completedAt: this.#now().toISOString(),
				result,
				error,
			};
			if (result?.fetch.ok === true && result.staleFreshness === false) {
				entry.lastSuccessful = result;
			}
			settle();
		};
		const timer = setTimeout(
			() =>
				finish(
					null,
					workerFailure(
						'refresh_worker_timeout',
						`Repository freshness worker exceeded ${this.#workerTimeoutMs}ms.`,
						true,
					),
				),
			this.#workerTimeoutMs,
		);
		worker.onmessage = (event) => {
			const message: unknown = event.data;
			if (!isRecord(message) || typeof message.ok !== 'boolean') {
				finish(
					null,
					workerFailure('refresh_worker_invalid_response', 'Worker returned an invalid response.'),
				);
				return;
			}
			if (message.ok === true) {
				if (!isFreshnessResult(message.result, root)) {
					finish(
						null,
						workerFailure(
							'refresh_worker_invalid_result',
							'Worker returned an invalid freshness result.',
						),
					);
					return;
				}
				const result = message.result;
				const error =
					result.fetch.ok && result.staleFreshness === false
						? null
						: workerFailure(
								result.fetch.reason ?? 'fetch_failed',
								result.fetch.error ?? 'Repository freshness fetch failed.',
								result.fetch.timedOut,
							);
				finish(result, error);
				return;
			}
			const error = isRecord(message.error) ? message.error : null;
			finish(
				null,
				workerFailure(
					typeof error?.reason === 'string' ? error.reason : 'refresh_worker_failed',
					typeof error?.message === 'string'
						? error.message
						: 'Repository freshness worker failed.',
					error?.timedOut === true,
				),
			);
		};
		worker.onerror = (event) => {
			finish(
				null,
				workerFailure(
					'refresh_worker_failed',
					event.message || 'Repository freshness worker failed.',
				),
			);
		};
		try {
			worker.postMessage({
				repositoryDbRoot: root,
				timeoutMs: this.#fetchTimeoutMs,
			} satisfies FreshnessWorkerRequest);
		} catch (error) {
			finish(
				null,
				workerFailure(
					'refresh_worker_start_failed',
					error instanceof Error ? error.message : String(error),
				),
			);
		}
	}

	#compose(local: FreshnessResult, entry: FreshnessEntry): RepositoryFreshnessSnapshot {
		const active = entry.active;
		const latest = entry.latest;
		const successful = entry.lastSuccessful;
		const comparable = successful && sameRepositoryPosition(successful, local);
		const base = comparable
			? {
					...successful,
					status: local.status,
					localDraftCount: local.localDraftCount,
				}
			: local;
		const latestFailure = latest?.error ?? null;
		const pullSafetyCurrent = successful && samePullSafetyState(successful, local);
		const refreshState: RepositoryRefreshState = active
			? 'refreshing'
			: latestFailure
				? 'failed'
				: latest?.result
					? 'succeeded'
					: 'idle';
		const refreshError = latestFailure;
		const fetch = active
			? failedFetch(
					workerFailure(
						'refresh_in_progress',
						'Repository freshness refresh is still in progress.',
					),
					base.status.expectedBranch || null,
				)
			: latestFailure
				? (latest?.result?.fetch ?? failedFetch(latestFailure, base.status.expectedBranch || null))
				: base.fetch;
		const pullSafe = refreshState === 'succeeded' && Boolean(pullSafetyCurrent) && base.pullSafe;
		const localBlocker = localPullBlocker(local);
		const pullBlockedReason = pullSafe
			? null
			: (localBlocker ??
				(refreshState === 'refreshing'
					? 'refresh_in_progress'
					: (refreshError?.reason ??
						(refreshState === 'idle' ? 'fetch_required' : base.pullBlockedReason))));
		return {
			...base,
			fetch,
			staleFreshness: refreshState !== 'succeeded' || !comparable,
			pullSafe,
			pullBlockedReason,
			refreshing: refreshState === 'refreshing',
			refreshState,
			refreshStartedAt: active?.startedAt ?? latest?.startedAt ?? null,
			refreshCompletedAt: latest?.completedAt ?? null,
			refreshError,
		};
	}
}

export const repositoryFreshnessService = new RepositoryFreshnessService();
