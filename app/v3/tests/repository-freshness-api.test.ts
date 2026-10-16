// HTTP handler vrstva pro freshness + pull.
//
// Ověřuje, že handleRepositoryFreshness a handleRepositoryPull vrací
// správné statusy a těla: 200 pro freshness, fail-closed pull vrací 409
// s reason a stavem (ne 500).

import { afterAll, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
	installLocalSshGitTransport,
	localSshRemoteUrl,
	seedMissionControlDataFixture,
} from '../../../test-support/local-ssh-git.mjs';
import { resolveNativeGitExecutable } from '../../../test-support/native-git.mjs';
import {
	handleRepositoryFreshness,
	handleRepositoryPull,
	handleRepositoryStatus,
} from '../src/repository-api.ts';
import { RepositoryFreshnessService } from '../src/repository-freshness-service.ts';

const releaseLocalSshTransport = installLocalSshGitTransport();
afterAll(releaseLocalSshTransport);
const REAL_GIT_EXECUTABLE = resolveNativeGitExecutable();
const REPOSITORY_FIXTURE_TIMEOUT = process.platform === 'win32' ? 60_000 : 15_000;
const SUCCESS_WORKER_URL = new URL('./fixtures/freshness-worker-success.ts', import.meta.url).href;
const FAILURE_WORKER_URL = new URL('./fixtures/freshness-worker-failure.ts', import.meta.url).href;
const PRODUCTION_WORKER_URL = new URL('../src/repository-freshness-worker.ts', import.meta.url)
	.href;
const REAL_GIT_WORKER_URL = new URL('./fixtures/freshness-worker-real-git.ts', import.meta.url)
	.href;
// Simulated remote latency for the real-Git slow-remote regression. Raise it
// (e.g. MISSION_CONTROL_TEST_SLOW_REMOTE_MS=15000) to reproduce the full
// Windows freshness outage window locally.
const SLOW_REMOTE_DELAY_MS =
	Number.parseInt(process.env.MISSION_CONTROL_TEST_SLOW_REMOTE_MS ?? '', 10) || 3_000;
const HEALTH_RESPONSE_LIMIT_MS = 1_000;

function git(cwd: string, args: string[]): string {
	return execFileSync(REAL_GIT_EXECUTABLE, args, {
		cwd,
		encoding: 'utf8',
		env: { ...process.env },
		stdio: ['ignore', 'pipe', 'pipe'],
	}).trim();
}

function writeFixtureFile(root: string, relativePath: string, content: string): void {
	const path = join(root, relativePath);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content);
}

function writeRepositoryDbFixture(repositoryDbRoot: string, remote: string): void {
	seedMissionControlDataFixture(repositoryDbRoot, { remote });
}

type FixtureRemote = { remotePath: string };

async function withTwoWriters<T>(
	fn: (writerA: string, writerB: string, remote: FixtureRemote) => T | Promise<T>,
): Promise<T> {
	const tempRoot = join(
		tmpdir(),
		`mct-freshness-api-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
	);
	const remotePath = join(tempRoot, 'mission-control-data.git');
	const remote = localSshRemoteUrl(remotePath);
	const seed = join(tempRoot, 'seed');
	const writerA = join(tempRoot, 'writer-a');
	const writerB = join(tempRoot, 'writer-b');
	mkdirSync(tempRoot, { recursive: true });
	try {
		git(tempRoot, ['init', '--bare', remotePath]);
		git(tempRoot, ['init', '--initial-branch=v3', seed]);
		git(seed, ['config', 'user.email', 'seed@example.invalid']);
		git(seed, ['config', 'user.name', 'Seed']);
		writeRepositoryDbFixture(seed, remote);
		git(seed, ['add', '.']);
		git(seed, ['commit', '-m', 'seed']);
		git(seed, ['remote', 'add', 'origin', remote]);
		git(seed, ['push', '-u', 'origin', 'v3']);
		for (const writer of [writerA, writerB]) {
			git(tempRoot, ['clone', '--branch', 'v3', remote, writer]);
			git(writer, ['config', 'user.email', 'writer@example.invalid']);
			git(writer, ['config', 'user.name', 'Writer']);
		}
		return await fn(writerA, writerB, { remotePath });
	} finally {
		rmSync(tempRoot, { recursive: true, force: true });
	}
}

// Real production Worker: the fixture only re-installs the process-scoped test
// SSH trust inside the Worker. Bun Workers snapshot the environment at process
// start, so the loopback transport variables set by test-support must be
// passed explicitly; `overrides` lets a test swap the transport Git binary.
function realGitWorkerFactory(
	counter: { created: number },
	overrides: Record<string, string> = {},
): (url: string) => Worker {
	return (url) => {
		counter.created += 1;
		return new Worker(url, { env: { ...(process.env as Record<string, string>), ...overrides } });
	};
}

function serveFreshness(repositoryDbRoot: string, service: RepositoryFreshnessService) {
	return Bun.serve({
		port: 0,
		fetch(request) {
			const url = new URL(request.url);
			if (url.pathname === '/health') return new Response('ok');
			return handleRepositoryFreshness(
				repositoryDbRoot,
				url.searchParams.get('fetch') !== '0',
				service,
			);
		},
	});
}

async function expectHealthy(baseUrl: URL): Promise<number> {
	const startedAt = performance.now();
	const health = await fetch(`${baseUrl}health`);
	expect(await health.text()).toBe('ok');
	const elapsed = performance.now() - startedAt;
	expect(elapsed).toBeLessThan(HEALTH_RESPONSE_LIMIT_MS);
	return elapsed;
}

function delay(ms: number): Promise<void> {
	return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function publishFromWriter(writer: string, id: string, path: string): void {
	writeFixtureFile(writer, path, `${id}\n`);
	git(writer, ['add', path]);
	git(writer, ['commit', '-m', `publish ${id}`]);
	git(writer, ['push', 'origin', 'v3']);
}

describe('repository freshness + pull HTTP handlers', () => {
	test(
		'freshness handler returns 200 with newer-data snapshot',
		async () => {
			await withTwoWriters(async (writerA, writerB) => {
				publishFromWriter(writerA, 'api-change-1', 'data/mission-control/reports/api-1.md');
				git(writerB, ['fetch', 'origin', 'v3']);
				const service = new RepositoryFreshnessService({ workerUrl: SUCCESS_WORKER_URL });
				const initialResponse = await handleRepositoryFreshness(writerB, true, service);
				expect(initialResponse.status).toBe(200);
				expect(await initialResponse.json()).toMatchObject({
					refreshing: true,
					refreshState: 'refreshing',
					fetch: { ok: false, reason: 'refresh_in_progress' },
					pullSafe: false,
				});
				await service.waitForIdle(writerB);
				const response = await handleRepositoryFreshness(writerB, false, service);
				const body = (await response.json()) as {
					newerAvailable: boolean;
					pullSafe: boolean;
					behind: number;
					refreshing: boolean;
					refreshState: string;
				};
				expect(body.newerAvailable).toBe(true);
				expect(body.pullSafe).toBe(true);
				expect(body.behind).toBeGreaterThan(0);
				expect(body.refreshing).toBe(false);
				expect(body.refreshState).toBe('succeeded');

				const localHead = git(writerB, ['rev-parse', 'HEAD']);
				const localTree = git(writerB, ['rev-parse', 'HEAD^{tree}']);
				const siblingRemoteHead = git(writerB, [
					'commit-tree',
					localTree,
					'-p',
					localHead,
					'-m',
					'same-distance remote replacement',
				]);
				git(writerB, ['update-ref', 'refs/remotes/origin/v3', siblingRemoteHead]);
				const replacedRef = await handleRepositoryFreshness(writerB, false, service);
				expect(await replacedRef.json()).toMatchObject({
					refreshState: 'succeeded',
					staleFreshness: true,
					pullSafe: false,
					pullBlockedReason: 'fetch_required',
				});
			});
		},
		REPOSITORY_FIXTURE_TIMEOUT,
	);

	test(
		'repository status is local-only and does not perform a hidden network fetch',
		async () => {
			await withTwoWriters(async (writerA, writerB) => {
				const beforeRemoteHead = git(writerB, ['rev-parse', 'refs/remotes/origin/v3']);
				publishFromWriter(writerA, 'status-local-only', 'data/mission-control/reports/status.md');
				const response = await handleRepositoryStatus(writerB);
				expect(response.status).toBe(200);
				const body = (await response.json()) as { status: { behind: number; remoteHead: string } };
				expect(body.status.behind).toBe(0);
				expect(body.status.remoteHead).toBe(beforeRemoteHead);
				expect(git(writerB, ['rev-parse', 'refs/remotes/origin/v3'])).toBe(beforeRemoteHead);
			});
		},
		REPOSITORY_FIXTURE_TIMEOUT,
	);

	test('production freshness Worker fails closed on an invalid request', async () => {
		const worker = new Worker(PRODUCTION_WORKER_URL);
		try {
			const response = await new Promise((resolve, reject) => {
				const timer = setTimeout(
					() => reject(new Error('Production freshness Worker response timed out.')),
					5_000,
				);
				worker.onmessage = (event) => {
					clearTimeout(timer);
					resolve(event.data);
				};
				worker.onerror = (event) => {
					clearTimeout(timer);
					reject(new Error(event.message));
				};
				worker.postMessage({ repositoryDbRoot: '', timeoutMs: 0 });
			});
			expect(response).toMatchObject({
				ok: false,
				error: { reason: 'refresh_worker_failed', timedOut: false },
			});
		} finally {
			await worker.terminate();
		}
	});

	test(
		'slow refresh stays off the HTTP event loop, deduplicates, and preserves the last result on failure',
		async () => {
			await withTwoWriters(async (writerA, writerB) => {
				publishFromWriter(writerA, 'api-change-worker', 'data/mission-control/reports/worker.md');
				git(writerB, ['fetch', 'origin', 'v3']);
				let workersCreated = 0;
				const service = new RepositoryFreshnessService({
					workerTimeoutMs: 5_000,
					fetchTimeoutMs: 2_000,
					workerFactory: () => {
						workersCreated += 1;
						return new Worker(workersCreated === 1 ? SUCCESS_WORKER_URL : FAILURE_WORKER_URL);
					},
				});
				const server = Bun.serve({
					port: 0,
					fetch(request) {
						const url = new URL(request.url);
						if (url.pathname === '/health') return new Response('ok');
						return handleRepositoryFreshness(
							writerB,
							url.searchParams.get('fetch') !== '0',
							service,
						);
					},
				});
				try {
					const first = await fetch(`${server.url}freshness`);
					const second = await fetch(`${server.url}freshness`);
					expect(first.status).toBe(200);
					expect(second.status).toBe(200);
					expect(await first.json()).toMatchObject({ refreshing: true, pullSafe: false });
					expect(await second.json()).toMatchObject({ refreshing: true, pullSafe: false });
					expect(workersCreated).toBe(1);
					const healthStartedAt = performance.now();
					const health = await fetch(`${server.url}health`);
					expect(await health.text()).toBe('ok');
					expect(performance.now() - healthStartedAt).toBeLessThan(1_000);
					await service.waitForIdle(writerB);
					const succeeded = await handleRepositoryFreshness(writerB, false, service);
					expect(await succeeded.json()).toMatchObject({
						refreshState: 'succeeded',
						newerAvailable: true,
						pullSafe: true,
					});

					const retry = await handleRepositoryFreshness(writerB, true, service);
					expect(await retry.json()).toMatchObject({
						refreshing: true,
						newerAvailable: true,
						fetch: { ok: false, reason: 'refresh_in_progress' },
						pullSafe: false,
					});
					await service.waitForIdle(writerB);
					const failed = await handleRepositoryFreshness(writerB, false, service);
					expect(await failed.json()).toMatchObject({
						refreshState: 'failed',
						newerAvailable: true,
						pullSafe: false,
						pullBlockedReason: 'fetch_failed',
						fetch: { ok: false, reason: 'fetch_failed' },
						refreshError: { reason: 'fetch_failed' },
					});
				} finally {
					server.stop(true);
				}
			});
		},
		REPOSITORY_FIXTURE_TIMEOUT,
	);

	test.skipIf(process.platform === 'win32')(
		'real slow Git fetch keeps health responsive, deduplicates and verifies the exact remote head',
		async () => {
			await withTwoWriters(async (writerA, writerB, { remotePath }) => {
				publishFromWriter(writerA, 'api-change-slow', 'data/mission-control/reports/slow.md');
				const publishedHead = git(writerA, ['rev-parse', 'HEAD']);
				const localHeadBefore = git(writerB, ['rev-parse', 'HEAD']);
				// POSIX-only latency shim: the loopback SSH transport spawns this
				// instead of Git, so `git fetch` really blocks inside the Worker for
				// SLOW_REMOTE_DELAY_MS before upload-pack answers.
				const transportGit = process.env.MISSION_CONTROL_TEST_TRANSPORT_GIT ?? REAL_GIT_EXECUTABLE;
				const slowGit = join(dirname(remotePath), 'slow-git');
				writeFileSync(
					slowGit,
					`#!/bin/sh\nsleep ${Math.ceil(SLOW_REMOTE_DELAY_MS / 1000)}\nexec '${transportGit}' "$@"\n`,
				);
				chmodSync(slowGit, 0o755);
				const workers = { created: 0 };
				const service = new RepositoryFreshnessService({
					workerUrl: REAL_GIT_WORKER_URL,
					fetchTimeoutMs: SLOW_REMOTE_DELAY_MS + 10_000,
					workerTimeoutMs: SLOW_REMOTE_DELAY_MS + 15_000,
					workerFactory: realGitWorkerFactory(workers, {
						MISSION_CONTROL_TEST_TRANSPORT_GIT: slowGit,
					}),
				});
				const server = serveFreshness(writerB, service);
				try {
					const startedAt = performance.now();
					const [first, second] = await Promise.all([
						fetch(`${server.url}freshness`),
						fetch(`${server.url}freshness`),
					]);
					// Both polls answer with the local snapshot long before the simulated
					// remote could have replied; Worker cold start and the local Git
					// snapshot are the only work on the request path.
					expect(performance.now() - startedAt).toBeLessThan(SLOW_REMOTE_DELAY_MS / 2);
					expect(first.status).toBe(200);
					expect(second.status).toBe(200);
					expect(await first.json()).toMatchObject({
						refreshing: true,
						refreshState: 'refreshing',
						fetch: { ok: false, reason: 'refresh_in_progress' },
						pullSafe: false,
					});
					expect(await second.json()).toMatchObject({ refreshing: true, pullSafe: false });
					expect(workers.created).toBe(1);

					const healthSamples: number[] = [];
					while (performance.now() - startedAt < SLOW_REMOTE_DELAY_MS * 0.8) {
						healthSamples.push(await expectHealthy(server.url));
						const poll = await fetch(`${server.url}freshness`);
						expect(await poll.json()).toMatchObject({ refreshing: true });
						await delay(250);
					}
					expect(healthSamples.length).toBeGreaterThan(0);
					expect(workers.created).toBe(1);

					await service.waitForIdle(writerB);
					expect(performance.now() - startedAt).toBeGreaterThanOrEqual(SLOW_REMOTE_DELAY_MS);
					const settled = await (await fetch(`${server.url}freshness?fetch=0`)).json();
					expect(settled).toMatchObject({
						refreshing: false,
						refreshState: 'succeeded',
						staleFreshness: false,
						fetch: { ok: true, verifiedHead: publishedHead, timedOut: false },
						newerAvailable: true,
						behind: 1,
						pullSafe: true,
						pullBlockedReason: null,
					});
					// Freshness only observes: HEAD and the working tree stay untouched.
					expect(git(writerB, ['rev-parse', 'HEAD'])).toBe(localHeadBefore);
					expect(git(writerB, ['status', '--porcelain'])).toBe('');
					expect(git(writerB, ['rev-parse', 'refs/remotes/origin/v3'])).toBe(publishedHead);
				} finally {
					server.stop(true);
				}
			});
		},
		SLOW_REMOTE_DELAY_MS + 30_000,
	);

	test(
		'real Git fetch against an unavailable remote fails closed without blocking the server',
		async () => {
			await withTwoWriters(async (writerA, writerB, { remotePath }) => {
				publishFromWriter(writerA, 'api-change-offline', 'data/mission-control/reports/offline.md');
				git(writerB, ['fetch', 'origin', 'v3']);
				const lastKnownRemoteHead = git(writerB, ['rev-parse', 'refs/remotes/origin/v3']);
				const localHeadBefore = git(writerB, ['rev-parse', 'HEAD']);
				// The remote disappears after the last successful observation.
				rmSync(remotePath, { recursive: true, force: true });
				const workers = { created: 0 };
				const service = new RepositoryFreshnessService({
					workerUrl: REAL_GIT_WORKER_URL,
					fetchTimeoutMs: 10_000,
					workerTimeoutMs: 15_000,
					workerFactory: realGitWorkerFactory(workers),
				});
				const server = serveFreshness(writerB, service);
				try {
					const first = await fetch(`${server.url}freshness`);
					expect(first.status).toBe(200);
					expect(await first.json()).toMatchObject({
						refreshing: true,
						newerAvailable: true,
						behind: 1,
						pullSafe: false,
						pullBlockedReason: 'refresh_in_progress',
					});
					await expectHealthy(server.url);
					await service.waitForIdle(writerB);
					expect(workers.created).toBe(1);
					const failed = await (await fetch(`${server.url}freshness?fetch=0`)).json();
					expect(failed).toMatchObject({
						refreshing: false,
						refreshState: 'failed',
						staleFreshness: true,
						fetch: { ok: false, reason: 'fetch_failed', timedOut: false },
						refreshError: { reason: 'fetch_failed', timedOut: false },
						// Last known truth stays visible, but never authorizes a pull.
						newerAvailable: true,
						behind: 1,
						pullSafe: false,
						pullBlockedReason: 'fetch_failed',
					});
					await expectHealthy(server.url);
					expect(git(writerB, ['rev-parse', 'HEAD'])).toBe(localHeadBefore);
					expect(git(writerB, ['rev-parse', 'refs/remotes/origin/v3'])).toBe(lastKnownRemoteHead);
					expect(git(writerB, ['status', '--porcelain'])).toBe('');
				} finally {
					server.stop(true);
				}
			});
		},
		REPOSITORY_FIXTURE_TIMEOUT + 15_000,
	);

	test('pull handler fast-forwards newer trusted Builder data', async () => {
		await withTwoWriters(async (writerA, writerB) => {
			publishFromWriter(writerA, 'api-change-2', 'data/mission-control/reports/api-2.md');
			const response = await handleRepositoryPull(writerB);
			expect(response.status).toBe(200);
			const body = (await response.json()) as { pulled: boolean; reason: string };
			expect(body.pulled).toBe(true);
			expect(body.reason).toBe('fast_forward');
			expect(existsSync(join(writerB, 'data/mission-control/reports/api-2.md'))).toBe(true);
		});
	});

	test(
		'pull handler preserves a dirty draft while returning the same typed 409',
		async () => {
			await withTwoWriters(async (writerA, writerB) => {
				publishFromWriter(writerA, 'api-change-3', 'data/mission-control/reports/api-3.md');
				writeFixtureFile(writerB, 'data/mission-control/reports/local-draft.md', 'local draft\n');
				const beforeHead = git(writerB, ['rev-parse', 'HEAD']);
				const beforeStatus = git(writerB, ['status', '--porcelain']);
				const response = await handleRepositoryPull(writerB);
				expect(response.status).toBe(409);
				const body = (await response.json()) as { error: string };
				expect(body.error).toBe('dirty_working_tree');
				expect(git(writerB, ['rev-parse', 'HEAD'])).toBe(beforeHead);
				expect(git(writerB, ['status', '--porcelain'])).toBe(beforeStatus);
			});
		},
		REPOSITORY_FIXTURE_TIMEOUT,
	);
});
