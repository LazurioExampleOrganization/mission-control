import { afterAll, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
	getMissionControlWriterStatus,
	installMissionControlTestDataValidator,
} from '../../../src/mission-control-publish-flow.mjs';
import {
	installLocalSshGitTransport,
	localSshRemoteUrl,
	seedMissionControlDataFixture,
} from '../../../test-support/local-ssh-git.mjs';
import { resolveNativeGitExecutable } from '../../../test-support/native-git.mjs';
import {
	buildRepositoryRuntimeState,
	handleRepositoryChangesetCreate,
	handleRepositoryChangesetDiscard,
	handleRepositoryChangesetPublish,
	handleRepositoryFreshness,
	handleRepositoryPull,
} from '../src/repository-api.ts';

const releaseLocalSshTransport = installLocalSshGitTransport();
afterAll(releaseLocalSshTransport);
const REAL_GIT_EXECUTABLE = resolveNativeGitExecutable();
const REPOSITORY_FIXTURE_TIMEOUT = process.platform === 'win32' ? 60_000 : 15_000;

function run(command: string, args: string[], cwd: string): string {
	return execFileSync(command, args, {
		cwd,
		encoding: 'utf8',
		env: { ...process.env },
		stdio: ['ignore', 'pipe', 'pipe'],
	}).trim();
}

function git(cwd: string, args: string[]): string {
	return run(REAL_GIT_EXECUTABLE, args, cwd);
}

function writeRepositoryDbFixture(repositoryDbRoot: string, remote: string): void {
	seedMissionControlDataFixture(repositoryDbRoot, { remote });
}

async function withRepositoryDbFixture<T>(
	fn: (repositoryDbRoot: string) => T | Promise<T>,
): Promise<T> {
	const tempRoot = join(
		tmpdir(),
		`mct-repository-api-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
	);
	const remotePath = join(tempRoot, 'mission-control-data.git');
	const remote = localSshRemoteUrl(remotePath);
	const repositoryDbRoot = join(tempRoot, 'mission-control-data');
	mkdirSync(tempRoot, { recursive: true });
	try {
		git(tempRoot, ['init', '--bare', remotePath]);
		git(tempRoot, ['init', '--initial-branch=v3', repositoryDbRoot]);
		git(repositoryDbRoot, ['config', 'user.email', 'template@example.invalid']);
		git(repositoryDbRoot, ['config', 'user.name', 'Mission Control Template Test']);
		writeRepositoryDbFixture(repositoryDbRoot, remote);
		git(repositoryDbRoot, ['add', '.']);
		git(repositoryDbRoot, ['commit', '-m', 'seed mission-control data']);
		git(repositoryDbRoot, ['remote', 'add', 'origin', remote]);
		git(repositoryDbRoot, ['push', '-u', 'origin', 'v3']);
		return await fn(repositoryDbRoot);
	} finally {
		rmSync(tempRoot, { recursive: true, force: true });
	}
}

function jsonRequest(path: string, body: unknown): Request {
	return new Request(`http://127.0.0.1${path}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	});
}

describe('repository-db runtime API handlers', () => {
	test('reports repository status and changeset queues', async () => {
		await withRepositoryDbFixture(async (repositoryDbRoot) => {
			const state = buildRepositoryRuntimeState(repositoryDbRoot);
			expect(state.status.clean).toBe(true);
			expect(state.status.expectedBranch).toBe('v3');
			expect(state.writer).toMatchObject({
				mode: 'local-principal-v1',
				local_principal_ready: true,
			});
			expect(state.drafts).toEqual([]);
			expect(state.changesets.pending).toEqual([]);
			expect(state.changesets.published).toEqual([]);
			expect(state.changesets.superseded).toEqual([]);
		});
	});

	test('legacy writer policy cannot break status or serialize historical payloads', async () => {
		await withRepositoryDbFixture(async (repositoryDbRoot) => {
			const configPath = join(repositoryDbRoot, 'data/mission-control/mission-control.config.json');
			const config = JSON.parse(readFileSync(configPath, 'utf8'));
			delete config.publish_policy.protected_paths;
			delete config.publish_policy.writer_mode;
			writeFileSync(configPath, JSON.stringify(config));
			const historyPath = join(
				repositoryDbRoot,
				'data/mission-control/changesets/published/old.json',
			);
			writeFileSync(
				historyPath,
				JSON.stringify({
					id: 'old',
					status: 'published',
					operations: [{ content: 'large historical payload' }],
				}),
			);
			git(repositoryDbRoot, ['add', '.']);
			git(repositoryDbRoot, ['commit', '-m', 'legacy installation']);
			const state = buildRepositoryRuntimeState(repositoryDbRoot);
			expect(state.status.clean).toBe(true);
			expect(state.writer.writer_ready).toBe(false);
			expect(state.changesets.published[0].id).toBe('old');
			expect(JSON.stringify(state)).not.toContain('large historical payload');
			expect(state.changesets.published[0]).not.toHaveProperty('operations');
			expect(state.changesets.published[0]).not.toHaveProperty('changeset');
		});
	}, 30_000);

	test(
		'creates an uncommitted local draft and publishes it as one validated commit',
		async () => {
			await withRepositoryDbFixture(async (repositoryDbRoot) => {
				const beforeHead = git(repositoryDbRoot, ['rev-parse', 'HEAD']);
				const createResponse = await handleRepositoryChangesetCreate(
					jsonRequest('/api/repository/changesets', {
						changeset: {
							id: 'local-principal-publish',
							summary: 'Local Principal API publish',
							operations: [
								{
									action: 'write_file',
									path: 'data/mission-control/reports/weekly report #1 %.txt',
									content: 'published through current Principal SSH identity\n',
								},
							],
						},
					}),
					repositoryDbRoot,
				);
				expect(createResponse.status).toBe(201);
				const created = (await createResponse.json()) as {
					draft: { id: string; draft_revision: string };
					state: ReturnType<typeof buildRepositoryRuntimeState>;
				};
				expect(created.draft.id).toBe('local-principal-publish');
				expect(created.draft.draft_revision).toMatch(/^[0-9a-f]{64}$/);
				expect(created.state.drafts).toHaveLength(1);
				expect(git(repositoryDbRoot, ['rev-parse', 'HEAD'])).toBe(beforeHead);
				expect(git(repositoryDbRoot, ['status', '--porcelain'])).toBe('');
				const freshnessResponse = await handleRepositoryFreshness(repositoryDbRoot, false);
				const freshness = (await freshnessResponse.json()) as {
					localDraftCount: number;
					pullSafe: boolean;
					pullBlockedReason: string;
				};
				expect(freshness.localDraftCount).toBe(1);
				expect(freshness.pullSafe).toBe(false);
				expect(freshness.pullBlockedReason).toBe('local_draft_present');
				const pullResponse = await handleRepositoryPull(repositoryDbRoot);
				expect(pullResponse.status).toBe(409);
				expect(await pullResponse.json()).toMatchObject({
					error: 'local_draft_present',
				});

				const publishResponse = await handleRepositoryChangesetPublish(
					created.draft.id,
					jsonRequest(`/api/repository/changesets/${created.draft.id}/publish`, {
						draft_revision: created.draft.draft_revision,
					}),
					repositoryDbRoot,
				);
				expect(publishResponse.status).toBe(200);
				const published = (await publishResponse.json()) as {
					publication: { id: string; summary: string; changed_paths: string[] };
					commit: { head: string; pushed: boolean };
					state: ReturnType<typeof buildRepositoryRuntimeState>;
				};
				expect(published.commit.pushed).toBe(true);
				expect(git(repositoryDbRoot, ['rev-parse', 'HEAD'])).toBe(published.commit.head);
				expect(git(repositoryDbRoot, ['rev-parse', 'origin/v3'])).toBe(published.commit.head);
				expect(published.state.drafts).toEqual([]);
				expect(published.state.changesets.published).toHaveLength(0);
				expect(published.publication).toEqual({
					id: 'local-principal-publish',
					summary: 'Local Principal API publish',
					changed_paths: ['data/mission-control/reports/weekly report #1 %.txt'],
				});
				expect(
					readFileSync(
						join(repositoryDbRoot, 'data/mission-control/reports/weekly report #1 %.txt'),
						'utf8',
					),
				).toContain('current Principal SSH identity');
				expect(
					existsSync(
						join(
							repositoryDbRoot,
							'data/mission-control/changesets/published/local-principal-publish.json',
						),
					),
				).toBe(false);
			});
		},
		REPOSITORY_FIXTURE_TIMEOUT,
	);

	test(
		'rejects local draft IDs already present in any canonical audit state',
		async () => {
			await withRepositoryDbFixture(async (repositoryDbRoot) => {
				for (const state of ['pending', 'published', 'superseded']) {
					const id = `reserved-${state}`;
					const auditPath = join(
						repositoryDbRoot,
						`data/mission-control/changesets/${state}/${id}.json`,
					);
					writeFileSync(auditPath, `${JSON.stringify({ id, status: state }, null, 2)}\n`);
				}
				git(repositoryDbRoot, ['add', 'data/mission-control/changesets']);
				git(repositoryDbRoot, ['commit', '-m', 'seed reserved audit ids']);
				git(repositoryDbRoot, ['push', 'origin', 'v3']);

				for (const state of ['pending', 'published', 'superseded']) {
					const id = `reserved-${state}`;
					const response = await handleRepositoryChangesetCreate(
						jsonRequest('/api/repository/changesets', {
							changeset: {
								id,
								summary: 'Must not reuse canonical audit id',
								operations: [
									{
										action: 'write_file',
										path: `data/mission-control/reports/${id}.txt`,
										content: 'must not become a draft\n',
									},
								],
							},
						}),
						repositoryDbRoot,
					);
					expect(response.status).toBe(422);
					expect(await response.json()).toMatchObject({
						error: 'repository_db_operation_failed',
						message: `Changeset already exists: ${id}`,
					});
				}
				expect(buildRepositoryRuntimeState(repositoryDbRoot).drafts).toEqual([]);
			});
		},
		REPOSITORY_FIXTURE_TIMEOUT,
	);

	test(
		'discards a local draft without changing Git history',
		async () => {
			await withRepositoryDbFixture(async (repositoryDbRoot) => {
				const createResponse = await handleRepositoryChangesetCreate(
					jsonRequest('/api/repository/changesets', {
						changeset: {
							id: 'discard-without-git-write',
							summary: 'Discard local draft',
							operations: [
								{
									action: 'write_file',
									path: 'data/mission-control/reports/discarded.txt',
									content: 'never published\n',
								},
							],
						},
					}),
					repositoryDbRoot,
				);
				expect(createResponse.status).toBe(201);
				git(repositoryDbRoot, ['config', 'user.name', '']);
				git(repositoryDbRoot, ['config', 'user.email', '']);
				git(repositoryDbRoot, ['config', 'user.useConfigOnly', 'true']);
				const beforeDiscardHead = git(repositoryDbRoot, ['rev-parse', 'HEAD']);
				expect(buildRepositoryRuntimeState(repositoryDbRoot)).toMatchObject({
					writer: { local_principal_ready: false },
					drafts: [{ id: 'discard-without-git-write' }],
				});
				const discardResponse = await handleRepositoryChangesetDiscard(
					'discard-without-git-write',
					repositoryDbRoot,
				);
				expect(discardResponse.status).toBe(200);
				const discarded = (await discardResponse.json()) as {
					discarded: boolean;
					state: ReturnType<typeof buildRepositoryRuntimeState>;
				};
				expect(discarded.discarded).toBe(true);
				expect(discarded.state.drafts).toEqual([]);
				expect(git(repositoryDbRoot, ['rev-parse', 'HEAD'])).toBe(beforeDiscardHead);
				expect(git(repositoryDbRoot, ['status', '--porcelain'])).toBe('');
				const pullResponse = await handleRepositoryPull(repositoryDbRoot);
				expect(pullResponse.status).toBe(200);
			});
		},
		REPOSITORY_FIXTURE_TIMEOUT,
	);

	test(
		'rejects Git-control and case-colliding local draft paths before publish',
		async () => {
			await withRepositoryDbFixture(async (repositoryDbRoot) => {
				const controlPathResponse = await handleRepositoryChangesetCreate(
					jsonRequest('/api/repository/changesets', {
						changeset: {
							id: 'git-control-path',
							summary: 'Must not change Git behavior',
							operations: [
								{
									action: 'write_file',
									path: 'data/mission-control/reports/.gitignore',
									content: '*\n',
								},
							],
						},
					}),
					repositoryDbRoot,
				);
				expect(controlPathResponse.status).toBe(409);
				expect(await controlPathResponse.json()).toMatchObject({
					error: 'validation_failed',
				});

				const canonicalPath = join(repositoryDbRoot, 'data/mission-control/reports/CaseAlias.txt');
				writeFileSync(canonicalPath, 'canonical case\n');
				git(repositoryDbRoot, ['add', 'data/mission-control/reports/CaseAlias.txt']);
				git(repositoryDbRoot, ['commit', '-m', 'seed canonical case']);
				git(repositoryDbRoot, ['push', 'origin', 'v3']);
				const collisionResponse = await handleRepositoryChangesetCreate(
					jsonRequest('/api/repository/changesets', {
						changeset: {
							id: 'case-collision',
							summary: 'Must not collide by case',
							operations: [
								{
									action: 'write_file',
									path: 'data/mission-control/reports/casealias.txt',
									content: 'unsafe alias\n',
								},
							],
						},
					}),
					repositoryDbRoot,
				);
				expect(collisionResponse.status).toBe(409);
				expect(await collisionResponse.json()).toMatchObject({
					error: 'validation_failed',
				});
				expect(buildRepositoryRuntimeState(repositoryDbRoot).drafts).toEqual([]);
			});
		},
		REPOSITORY_FIXTURE_TIMEOUT,
	);

	test(
		'rejects a draft changed after the displayed revision without a commit',
		async () => {
			await withRepositoryDbFixture(async (repositoryDbRoot) => {
				const response = await handleRepositoryChangesetCreate(
					jsonRequest('/api/repository/changesets', {
						changeset: {
							id: 'changed-after-review',
							summary: 'Changed after review',
							operations: [
								{
									action: 'write_file',
									path: 'data/mission-control/reports/changed.txt',
									content: 'reviewed\n',
								},
							],
						},
					}),
					repositoryDbRoot,
				);
				const created = (await response.json()) as {
					draft: { draft_revision: string };
				};
				const gitDir = git(repositoryDbRoot, ['rev-parse', '--git-dir']);
				const draftPath = join(
					repositoryDbRoot,
					gitDir,
					'mission-control-drafts/changed-after-review.json',
				);
				const tampered = JSON.parse(readFileSync(draftPath, 'utf8'));
				tampered.operations[0].content = 'tampered\n';
				writeFileSync(draftPath, `${JSON.stringify(tampered, null, 2)}\n`);
				expect(buildRepositoryRuntimeState(repositoryDbRoot).drafts).toEqual([
					expect.objectContaining({
						id: 'changed-after-review',
						invalid: true,
					}),
				]);
				const beforeHead = git(repositoryDbRoot, ['rev-parse', 'HEAD']);
				const publishResponse = await handleRepositoryChangesetPublish(
					'changed-after-review',
					jsonRequest('/api/repository/changesets/changed-after-review/publish', {
						draft_revision: created.draft.draft_revision,
					}),
					repositoryDbRoot,
				);
				expect(publishResponse.status).toBe(409);
				expect(await publishResponse.json()).toMatchObject({
					error: 'draft_changed',
				});
				expect(git(repositoryDbRoot, ['rev-parse', 'HEAD'])).toBe(beforeHead);
				expect(git(repositoryDbRoot, ['status', '--porcelain'])).toBe('');
				const discardResponse = await handleRepositoryChangesetDiscard(
					'changed-after-review',
					repositoryDbRoot,
				);
				expect(discardResponse.status).toBe(200);
			});
		},
		REPOSITORY_FIXTURE_TIMEOUT,
	);

	test(
		'keeps a stale no-op draft readable after another draft publishes',
		async () => {
			await withRepositoryDbFixture(async (repositoryDbRoot) => {
				const operation = {
					action: 'write_file',
					path: 'data/mission-control/reports/shared-target.txt',
					content: 'same final content\n',
				};
				const firstResponse = await handleRepositoryChangesetCreate(
					jsonRequest('/api/repository/changesets', {
						changeset: {
							id: 'first-shared-target',
							summary: 'First shared target',
							operations: [operation],
						},
					}),
					repositoryDbRoot,
				);
				const secondResponse = await handleRepositoryChangesetCreate(
					jsonRequest('/api/repository/changesets', {
						changeset: {
							id: 'second-shared-target',
							summary: 'Second shared target',
							operations: [operation],
						},
					}),
					repositoryDbRoot,
				);
				const first = (await firstResponse.json()) as {
					draft: { draft_revision: string };
				};
				expect(secondResponse.status).toBe(201);
				const publishResponse = await handleRepositoryChangesetPublish(
					'first-shared-target',
					jsonRequest('/api/repository/changesets/first-shared-target/publish', {
						draft_revision: first.draft.draft_revision,
					}),
					repositoryDbRoot,
				);
				expect(publishResponse.status).toBe(200);
				const remainingDrafts = buildRepositoryRuntimeState(repositoryDbRoot).drafts;
				expect(remainingDrafts).toHaveLength(1);
				expect(remainingDrafts[0]).toMatchObject({
					id: 'second-shared-target',
				});
				expect(remainingDrafts[0]?.invalid).not.toBe(true);
			});
		},
		REPOSITORY_FIXTURE_TIMEOUT,
	);

	test(
		'rejects an invalid later destination before applying an earlier operation',
		async () => {
			await withRepositoryDbFixture(async (repositoryDbRoot) => {
				const directoryTarget = join(
					repositoryDbRoot,
					'data/mission-control/reports/existing-directory',
				);
				mkdirSync(directoryTarget, { recursive: true });
				writeFileSync(join(directoryTarget, '.gitkeep'), '');
				git(repositoryDbRoot, ['add', '.']);
				git(repositoryDbRoot, ['commit', '-m', 'seed directory target']);
				git(repositoryDbRoot, ['push', 'origin', 'v3']);
				const createResponse = await handleRepositoryChangesetCreate(
					jsonRequest('/api/repository/changesets', {
						changeset: {
							id: 'preflight-all-destinations',
							summary: 'Preflight every destination',
							operations: [
								{
									action: 'write_file',
									path: 'data/mission-control/reports/must-not-exist.txt',
									content: 'must be rolled back\n',
								},
								{
									action: 'write_file',
									path: 'data/mission-control/reports/existing-directory',
									content: 'invalid target\n',
								},
							],
						},
					}),
					repositoryDbRoot,
				);
				expect(createResponse.status).toBe(201);
				const created = (await createResponse.json()) as {
					draft: { draft_revision: string };
				};
				const publishResponse = await handleRepositoryChangesetPublish(
					'preflight-all-destinations',
					jsonRequest('/api/repository/changesets/preflight-all-destinations/publish', {
						draft_revision: created.draft.draft_revision,
					}),
					repositoryDbRoot,
				);
				expect(publishResponse.status).toBe(409);
				expect(await publishResponse.json()).toMatchObject({
					error: 'validation_failed',
				});
				expect(readFileSync(join(directoryTarget, '.gitkeep'), 'utf8')).toBe('');
				expect(() =>
					readFileSync(
						join(repositoryDbRoot, 'data/mission-control/reports/must-not-exist.txt'),
						'utf8',
					),
				).toThrow();
			});
		},
		REPOSITORY_FIXTURE_TIMEOUT,
	);

	test(
		'preserves a concurrent staged index change instead of rolling it back',
		async () => {
			await withRepositoryDbFixture(async (repositoryDbRoot) => {
				const validatorRoot = join(tmpdir(), `mission-control-test-validator.mjs-${process.pid}`);
				rmSync(validatorRoot, { recursive: true, force: true });
				mkdirSync(validatorRoot, { recursive: true });
				const validatorPath = join(validatorRoot, 'validator.mjs');
				writeFileSync(
					validatorPath,
					[
						"import { spawnSync } from 'node:child_process';",
						"const result = spawnSync('git', ['update-index', '--chmod=+x', '--', 'data/mission-control/reports/index-race.txt'], { cwd: process.cwd(), encoding: 'utf8' });",
						"if (result.status !== 0) process.stderr.write(result.stderr || 'index mutation failed');",
						'process.exit(1);',
						'',
					].join('\n'),
				);
				chmodSync(validatorPath, 0o700);
				const releaseValidator = installMissionControlTestDataValidator(validatorPath);
				try {
					const createResponse = await handleRepositoryChangesetCreate(
						jsonRequest('/api/repository/changesets', {
							changeset: {
								id: 'concurrent-index-change',
								summary: 'Preserve concurrent index state',
								operations: [
									{
										action: 'write_file',
										path: 'data/mission-control/reports/index-race.txt',
										content: 'writer worktree content\n',
									},
								],
							},
						}),
						repositoryDbRoot,
					);
					const created = (await createResponse.json()) as {
						draft: { draft_revision: string };
					};
					const publishResponse = await handleRepositoryChangesetPublish(
						'concurrent-index-change',
						jsonRequest('/api/repository/changesets/concurrent-index-change/publish', {
							draft_revision: created.draft.draft_revision,
						}),
						repositoryDbRoot,
					);
					expect(publishResponse.status).toBe(409);
					expect(await publishResponse.json()).toMatchObject({
						error: 'publish_outcome_unknown',
					});
					expect(
						git(repositoryDbRoot, [
							'ls-files',
							'--stage',
							'data/mission-control/reports/index-race.txt',
						]),
					).toMatch(/^100755 /);
					expect(
						readFileSync(
							join(repositoryDbRoot, 'data/mission-control/reports/index-race.txt'),
							'utf8',
						),
					).toBe('writer worktree content\n');
				} finally {
					releaseValidator();
					rmSync(validatorRoot, { recursive: true, force: true });
				}
			});
		},
		REPOSITORY_FIXTURE_TIMEOUT,
	);

	test('accepts a credential-free GitHub HTTPS remote at the config gate', async () => {
		await withRepositoryDbFixture(async (repositoryDbRoot) => {
			const repositoryDbPath = join(repositoryDbRoot, 'repository-db.yaml');
			const currentRemote = localSshRemoteUrl(
				join(dirname(repositoryDbRoot), 'mission-control-data.git'),
			);
			const httpsRemote = 'https://github.com/ExampleOrganization/mission-control-data.git';
			writeFileSync(
				repositoryDbPath,
				readFileSync(repositoryDbPath, 'utf8').replace(currentRemote, httpsRemote),
			);
			expect(getMissionControlWriterStatus({ repositoryDbRoot })).toMatchObject({
				local_principal_ready: true,
				reason: null,
			});
		});
	});

	test('keeps local writer read-only when the remote is not GitHub', async () => {
		for (const invalidRemote of [
			// SSH remote that is not the canonical git@ GitHub account.
			'alice@github.com:ExampleOrganization/mission-control-data.git',
			// HTTPS remote outside github.com.
			'https://gitlab.com/ExampleOrganization/mission-control-data.git',
			// HTTPS remote carrying a username; identity must come from the helper.
			'https://alice@github.com/ExampleOrganization/mission-control-data.git',
		]) {
			await withRepositoryDbFixture(async (repositoryDbRoot) => {
				const repositoryDbPath = join(repositoryDbRoot, 'repository-db.yaml');
				const currentRemote = localSshRemoteUrl(
					join(dirname(repositoryDbRoot), 'mission-control-data.git'),
				);
				writeFileSync(
					repositoryDbPath,
					readFileSync(repositoryDbPath, 'utf8').replace(currentRemote, invalidRemote),
				);
				expect(getMissionControlWriterStatus({ repositoryDbRoot })).toMatchObject({
					local_principal_ready: false,
					reason: 'github_remote_required',
				});
			});
		}
	});

	test('obsolete roster metadata is not an access authority', async () => {
		await withRepositoryDbFixture(async (repositoryDbRoot) => {
			const configPath = join(repositoryDbRoot, 'data/mission-control/mission-control.config.json');
			const config = JSON.parse(readFileSync(configPath, 'utf8'));
			config.publish_policy.approval_roles = ['nobody'];
			config.publish_policy.local_principal = {
				provider_access_audit: { status: 'pending', roster_scope: 'nobody' },
			};
			writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
			expect(getMissionControlWriterStatus({ repositoryDbRoot })).toMatchObject({
				local_principal_ready: true,
				reason: null,
			});
		});
	});

	test('rejects dirty writer control-plane before probing an SSH identity', async () => {
		await withRepositoryDbFixture(async (repositoryDbRoot) => {
			const createResponse = await handleRepositoryChangesetCreate(
				jsonRequest('/api/repository/changesets', {
					changeset: {
						id: 'dirty-control-plane',
						summary: 'Reject unreviewed SSH target',
						operations: [
							{
								action: 'write_file',
								path: 'data/mission-control/reports/dirty-control-plane.txt',
								content: 'must not publish\n',
							},
						],
					},
				}),
				repositoryDbRoot,
			);
			const created = (await createResponse.json()) as {
				draft: { id: string; draft_revision: string };
			};
			const repositoryDbPath = join(repositoryDbRoot, 'repository-db.yaml');
			const currentRemote = localSshRemoteUrl(
				join(dirname(repositoryDbRoot), 'mission-control-data.git'),
			);
			const unreviewedRemote = localSshRemoteUrl(
				join(dirname(repositoryDbRoot), 'unreviewed', 'mission-control-data.git'),
			);
			writeFileSync(
				repositoryDbPath,
				readFileSync(repositoryDbPath, 'utf8').replace(currentRemote, unreviewedRemote),
			);
			const capturePath = join(dirname(repositoryDbRoot), 'ssh-probe-args.txt');
			const originalCapturePath = process.env.MISSION_CONTROL_TEST_SSH_CAPTURE_ARGS;
			process.env.MISSION_CONTROL_TEST_SSH_CAPTURE_ARGS = capturePath;
			try {
				const publishResponse = await handleRepositoryChangesetPublish(
					created.draft.id,
					jsonRequest(`/api/repository/changesets/${created.draft.id}/publish`, {
						draft_revision: created.draft.draft_revision,
					}),
					repositoryDbRoot,
				);
				expect(publishResponse.status).not.toBe(200);
				expect(existsSync(capturePath)).toBe(false);
			} finally {
				if (originalCapturePath === undefined) {
					delete process.env.MISSION_CONTROL_TEST_SSH_CAPTURE_ARGS;
				} else {
					process.env.MISSION_CONTROL_TEST_SSH_CAPTURE_ARGS = originalCapturePath;
				}
			}
		});
	});

	test('writer readiness depends only on the GitHub remote, local identity and absence of a parallel credential authority', async () => {
		await withRepositoryDbFixture(async (repositoryDbRoot) => {
			const configPath = join(repositoryDbRoot, 'data/mission-control/mission-control.config.json');
			const config = JSON.parse(readFileSync(configPath, 'utf8'));
			config.publish_policy.credential_authority = { required: true };
			writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
			expect(getMissionControlWriterStatus({ repositoryDbRoot })).toMatchObject({
				local_principal_ready: false,
				reason: 'local_writer_config_invalid',
			});

			delete config.publish_policy.credential_authority;
			writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
			expect(getMissionControlWriterStatus({ repositoryDbRoot })).toMatchObject({
				local_principal_ready: true,
				reason: null,
			});

			git(repositoryDbRoot, ['config', 'user.name', '']);
			git(repositoryDbRoot, ['config', 'user.email', '']);
			git(repositoryDbRoot, ['config', 'user.useConfigOnly', 'true']);
			expect(getMissionControlWriterStatus({ repositoryDbRoot })).toMatchObject({
				local_principal_ready: false,
				reason: 'commit_identity_required',
			});
		});
	});

	test('foreign writer modes have no fallback', async () => {
		await withRepositoryDbFixture(async (repositoryDbRoot) => {
			const before = git(repositoryDbRoot, ['rev-parse', 'HEAD']);
			const configPath = join(repositoryDbRoot, 'data/mission-control/mission-control.config.json');
			const config = JSON.parse(readFileSync(configPath, 'utf8'));
			config.publish_policy.writer_mode = 'retired-writer-mode';
			writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
			expect(getMissionControlWriterStatus({ repositoryDbRoot })).toMatchObject({
				mode: 'retired-writer-mode',
				writer_ready: false,
				local_principal_ready: false,
				reason: 'writer_mode_unsupported',
			});
			const response = await handleRepositoryChangesetCreate(
				jsonRequest('/api/repository/changesets', {
					changeset: {
						id: 'foreign-mode-no-fallback',
						operations: [
							{
								action: 'write_file',
								path: 'data/mission-control/reports/foreign-mode.txt',
								content: 'blocked\n',
							},
						],
					},
				}),
				repositoryDbRoot,
			);
			expect(response.status).toBe(409);
			expect(await response.json()).toMatchObject({
				error: 'writer_mode_unsupported',
				message:
					'Mission Control requires a supported native Git writer_mode; no fallback writer exists',
			});
			expect(git(repositoryDbRoot, ['rev-parse', 'HEAD'])).toBe(before);
			expect(
				existsSync(join(repositoryDbRoot, 'data/mission-control/reports/foreign-mode.txt')),
			).toBe(false);
		});
	});
});
