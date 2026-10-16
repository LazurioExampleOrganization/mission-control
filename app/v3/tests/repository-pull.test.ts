// Pull / freshness engine + concurrent-writer smoke.
//
// Ověřuje koordinaci dvou AI Kolegů (writer A a writer B) nad jedním data
// repem přes společný remote: draft → publish → pull, plus konflikt scénář,
// kde pull musí zůstat fail-closed a nikdy nepřepsat lokální draft.

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import {
	getMissionControlRepositoryStatus,
	installMissionControlTestDataValidator,
	installMissionControlTestGitExecutable,
	runMissionControlGitCommand,
} from '../../../src/mission-control-publish-flow.mjs';
import {
	getMissionControlFreshness,
	MissionControlPullError,
	pullMissionControlRepository,
} from '../../../src/mission-control-pull.mjs';
import {
	installLocalSshGitTransport,
	localSshRemoteUrl,
	seedMissionControlDataFixture,
} from '../../../test-support/local-ssh-git.mjs';
import { resolveNativeGitExecutable } from '../../../test-support/native-git.mjs';
import { detectSymlinkSupport } from '../../../test-support/symlink-support.mjs';

const symlinkTest = detectSymlinkSupport() ? test : test.skip;

// Test fixtures create Git repositories with the host's default line-ending
// policy. Force LF so Windows hosts with core.autocrlf=true cannot turn
// fixture worktrees into CRLF copies that no longer match their LF blobs.
process.env.GIT_CONFIG_PARAMETERS = [
	process.env.GIT_CONFIG_PARAMETERS,
	"'core.autocrlf=false' 'core.eol=lf'",
]
	.filter(Boolean)
	.join(' ');

// These Git integration tests can run two bounded 15-second operations.
setDefaultTimeout(30_000);

const releaseLocalSshTransport = installLocalSshGitTransport();
const REAL_GIT_EXECUTABLE = resolveNativeGitExecutable();

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

function writeFixtureFile(root: string, relativePath: string, content: string): void {
	const path = join(root, relativePath);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content);
}

function writeRepositoryDbFixture(repositoryDbRoot: string, remote: string): void {
	seedMissionControlDataFixture(repositoryDbRoot, { remote });
}

function initWriterCheckout(root: string, remote: string): void {
	git(dirname(root), ['clone', '--branch', 'v3', remote, root]);
	git(root, ['config', 'user.email', 'writer@example.invalid']);
	git(root, ['config', 'user.name', 'Mission Control Writer']);
}

type Fixture = {
	tempRoot: string;
	remote: string;
	remotePath: string;
	writerA: string;
	writerB: string;
};

function makeFixture(): Fixture {
	const tempRoot = join(
		tmpdir(),
		`mct-pull-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
	);
	const remotePath = join(tempRoot, 'mission-control-data.git');
	const remote = localSshRemoteUrl(remotePath);
	const seed = join(tempRoot, 'seed');
	const writerA = join(tempRoot, 'writer-a');
	const writerB = join(tempRoot, 'writer-b');
	mkdirSync(tempRoot, { recursive: true });
	git(tempRoot, ['init', '--bare', remotePath]);
	git(tempRoot, ['init', '--initial-branch=v3', seed]);
	git(seed, ['config', 'user.email', 'seed@example.invalid']);
	git(seed, ['config', 'user.name', 'Mission Control Seed']);
	writeRepositoryDbFixture(seed, remote);
	git(seed, ['add', '.']);
	git(seed, ['commit', '-m', 'seed mission-control data']);
	git(seed, ['remote', 'add', 'origin', remote]);
	git(seed, ['push', '-u', 'origin', 'v3']);
	initWriterCheckout(writerA, remote);
	initWriterCheckout(writerB, remote);
	return { tempRoot, remote, remotePath, writerA, writerB };
}

function withIsolatedFixture<T>(body: (isolated: Fixture) => T): T {
	const isolated = makeFixture();
	try {
		return body(isolated);
	} finally {
		rmSync(isolated.tempRoot, { recursive: true, force: true });
	}
}

function commitAndPushReport(writer: string, filename: string, content: string): void {
	writeFixtureFile(writer, `data/mission-control/reports/${filename}`, `${content}\n`);
	git(writer, ['add', '.']);
	git(writer, ['commit', '-m', `publish ${filename}`]);
	git(writer, ['push', 'origin', 'v3']);
}

let fixture: Fixture;

beforeAll(() => {
	fixture = makeFixture();
});

afterAll(() => {
	if (fixture) rmSync(fixture.tempRoot, { recursive: true, force: true });
	releaseLocalSshTransport();
});

describe('mission-control pull / freshness coordination', () => {
	test('clean, up-to-date checkout reports no newer data and refuses pull as up_to_date', () => {
		const freshness = getMissionControlFreshness({ repositoryDbRoot: fixture.writerB });
		expect(freshness.newerAvailable).toBe(false);
		expect(freshness.pullSafe).toBe(false);
		expect(freshness.staleFreshness).toBe(false);
		const result = pullMissionControlRepository({ repositoryDbRoot: fixture.writerB });
		expect(result.pulled).toBe(false);
		expect(result.reason).toBe('up_to_date');
	});

	test('fetch:false is read-only status and never advertises cached data as pull-safe', () => {
		const freshness = getMissionControlFreshness({
			repositoryDbRoot: fixture.writerB,
			fetch: false,
		});
		expect(freshness.staleFreshness).toBe(false);
		expect(freshness.pullSafe).toBe(false);
		expect(freshness.pullBlockedReason).toBe('fetch_required');
	});

	test('failed fetch (unreachable remote) surfaces staleFreshness and a fetch_failed reason', () => {
		// Oddělený checkout s remote, který nejde stáhnout → fetch selže.
		// Freshness se musí přiznat jako neověřená a pull nenabídnout.
		const offline = join(fixture.tempRoot, 'writer-offline');
		initWriterCheckout(offline, fixture.remote);
		// Přepíšeme deklaraci i origin na stejnou neexistující cestu. Boundary
		// zůstává validní, ale samotný fetch selže rychle jako síťová chyba.
		const missingRemote = localSshRemoteUrl(
			join(fixture.tempRoot, 'does-not-exist', 'mission-control-data.git'),
		);
		const repositoryConfigPath = join(offline, 'repository-db.yaml');
		writeFileSync(
			repositoryConfigPath,
			readFileSync(repositoryConfigPath, 'utf8').replace(
				`remote: ${fixture.remote}`,
				`remote: ${missingRemote}`,
			),
		);
		git(offline, ['add', 'repository-db.yaml']);
		git(offline, ['commit', '-m', 'point fixture at unavailable remote']);
		git(offline, ['remote', 'set-url', 'origin', missingRemote]);

		const freshness = getMissionControlFreshness({ repositoryDbRoot: offline, timeoutMs: 5000 });
		expect(freshness.fetch.ok).toBe(false);
		expect(freshness.staleFreshness).toBe(true);
		expect(freshness.pullBlockedReason).toBe('fetch_failed');
		try {
			pullMissionControlRepository({
				repositoryDbRoot: offline,
				timeoutMs: 5000,
			});
			throw new Error('pull should have rejected an unverified remote');
		} catch (error) {
			expect(error).toBeInstanceOf(MissionControlPullError);
			expect((error as MissionControlPullError).reason).toBe('fetch_failed');
		}

		rmSync(offline, { recursive: true, force: true });
	});

	test('failed fetch never advertises pull as safe from an ahead cached tracking ref', () => {
		withIsolatedFixture(({ remotePath, writerA, writerB }) => {
			commitAndPushReport(writerA, 'cached-before-offline.md', 'remote change cached by writer B');
			const cached = getMissionControlFreshness({
				repositoryDbRoot: writerB,
			});
			expect(cached.fetch.ok).toBe(true);
			expect(cached.behindRemote).toBe(true);
			expect(cached.pullSafe).toBe(true);

			renameSync(remotePath, `${remotePath}.offline`);
			const stale = getMissionControlFreshness({
				repositoryDbRoot: writerB,
				timeoutMs: 5000,
			});
			expect(stale.fetch.ok).toBe(false);
			expect(stale.staleFreshness).toBe(true);
			expect(stale.behindRemote).toBe(true);
			expect(stale.newerAvailable).toBe(true);
			expect(stale.pullSafe).toBe(false);
			expect(stale.pullBlockedReason).toBe('fetch_failed');
		});
	});

	test('failed fetch without a cached tracking ref reports fetch_failed, not no_remote_ref', () => {
		const offline = join(fixture.tempRoot, 'writer-offline-without-cache');
		initWriterCheckout(offline, fixture.remote);
		const missingRemote = localSshRemoteUrl(
			join(fixture.tempRoot, 'does-not-exist-without-cache', 'mission-control-data.git'),
		);
		const repositoryConfigPath = join(offline, 'repository-db.yaml');
		writeFileSync(
			repositoryConfigPath,
			readFileSync(repositoryConfigPath, 'utf8').replace(
				`remote: ${fixture.remote}`,
				`remote: ${missingRemote}`,
			),
		);
		git(offline, ['add', 'repository-db.yaml']);
		git(offline, ['commit', '-m', 'point cacheless fixture at unavailable remote']);
		git(offline, ['remote', 'set-url', 'origin', missingRemote]);
		git(offline, ['update-ref', '-d', 'refs/remotes/origin/v3']);

		const freshness = getMissionControlFreshness({
			repositoryDbRoot: offline,
			timeoutMs: 5000,
		});
		expect(freshness.fetch.ok).toBe(false);
		expect(freshness.staleFreshness).toBe(true);
		expect(freshness.status.remoteRefExists).toBe(false);
		expect(freshness.pullBlockedReason).toBe('fetch_failed');

		rmSync(offline, { recursive: true, force: true });
	});

	test('concurrent writers: A publishes, B sees newer data and safely fast-forward pulls', () => {
		// Writer A publikuje běžný doménový commit jako jiný trusted Builder.
		commitAndPushReport(fixture.writerA, 'writer-a.md', 'Publikoval writer A');

		// Writer B (clean checkout) teď vidí novější data a bezpečně je stáhne.
		const freshness = getMissionControlFreshness({ repositoryDbRoot: fixture.writerB });
		expect(freshness.newerAvailable).toBe(true);
		expect(freshness.behind).toBeGreaterThan(0);
		expect(freshness.pullSafe).toBe(true);

		const pull = pullMissionControlRepository({ repositoryDbRoot: fixture.writerB });
		expect(pull.pulled).toBe(true);
		expect(pull.reason).toBe('fast_forward');
		expect(
			readFileSync(join(fixture.writerB, 'data/mission-control/reports/writer-a.md'), 'utf8'),
		).toContain('writer A');

		// Po pullu je B zase aktuální.
		const after = getMissionControlFreshness({ repositoryDbRoot: fixture.writerB });
		expect(after.newerAvailable).toBe(false);
	}, 30_000);

	test('pull is fail-closed on a dirty working tree and never overwrites a local draft', () => {
		// Writer A publikuje další změnu na remote.
		commitAndPushReport(fixture.writerA, 'writer-a-2.md', 'Druhá publikace');

		// Writer B má lokální nepublikovaný draft (dirty working tree).
		const localDraftPath = join(fixture.writerB, 'data/mission-control/reports/writer-b-draft.md');
		writeFileSync(localDraftPath, 'Rozpracovaný draft writera B\n');

		const freshness = getMissionControlFreshness({ repositoryDbRoot: fixture.writerB });
		expect(freshness.newerAvailable).toBe(true);
		expect(freshness.pullSafe).toBe(false);
		expect(freshness.pullBlockedReason).toBe('dirty_working_tree');

		// Pull musí odmítnout a draft zůstane nedotčený. Zachytíme jediný
		// síťový pokus, aby test na pomalejším Windows runneru neměnil stav
		// druhým fetchem ani nevyčerpal svůj vlastní timeout.
		let pullError: unknown;
		try {
			pullMissionControlRepository({ repositoryDbRoot: fixture.writerB });
		} catch (error) {
			pullError = error;
		}
		expect(pullError).toBeInstanceOf(MissionControlPullError);
		expect((pullError as MissionControlPullError).reason).toBe('dirty_working_tree');
		expect(readFileSync(localDraftPath, 'utf8')).toContain('Rozpracovaný draft writera B');

		// Úklid draftu, ať další testy nechytnou dirty stav.
		rmSync(localDraftPath, { force: true });
	}, 30_000);

	test('pull is fail-closed on divergence (local + remote both moved)', () => {
		// Remote dostane commit od A.
		commitAndPushReport(fixture.writerA, 'writer-a-3.md', 'Diverge remote');

		// Writer B commitne vlastní lokální commit, který remote nemá →
		// lokální i remote se rozešly. Working tree je čistý, ale ne ff-only.
		writeFileSync(
			join(fixture.writerB, 'data/mission-control/reports/writer-b-local.md'),
			'Lokální commit B\n',
		);
		git(fixture.writerB, ['add', '.']);
		git(fixture.writerB, ['commit', '-m', 'writer B local commit']);

		const freshness = getMissionControlFreshness({ repositoryDbRoot: fixture.writerB });
		expect(freshness.diverged).toBe(true);
		expect(freshness.pullSafe).toBe(false);
		expect(freshness.pullBlockedReason).toBe('diverged');

		try {
			pullMissionControlRepository({ repositoryDbRoot: fixture.writerB });
			throw new Error('pull should have thrown on divergence');
		} catch (error) {
			expect(error).toBeInstanceOf(MissionControlPullError);
			expect((error as MissionControlPullError).reason).toBe('diverged');
		}
	}, 30_000);
});

describe('mission-control pull repository boundary', () => {
	test('imports published data scripts as inert files and never executes them', () => {
		withIsolatedFixture(({ tempRoot, writerA, writerB }) => {
			const validatorPath = 'scripts/validate-mission-control-data.mjs';
			const marker = join(tempRoot, 'data-script-ran');
			const payload = `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, "executed");\n`;
			writeFixtureFile(writerA, validatorPath, payload);
			git(writerA, ['add', validatorPath]);
			git(writerA, ['commit', '-m', 'publish inert script update']);
			git(writerA, ['push', 'origin', 'v3']);
			const result = pullMissionControlRepository({ repositoryDbRoot: writerB });
			expect(result.pulled).toBe(true);
			expect(readFileSync(join(writerB, validatorPath), 'utf8')).toBe(payload);
			expect(existsSync(marker)).toBe(false);
		});
	});

	test('rejects a target that restores obsolete actor approval policy', () => {
		withIsolatedFixture(({ writerA, writerB }) => {
			const policyPath = 'data/mission-control/mission-control.config.json';
			const beforeTrackingRef = git(writerB, ['rev-parse', 'refs/remotes/origin/v3']);
			const beforePolicy = readFileSync(join(writerB, policyPath), 'utf8');
			const modifiedPolicy = JSON.parse(readFileSync(join(writerA, policyPath), 'utf8'));
			modifiedPolicy.publish_policy.approval_roles = ['admin'];
			writeFixtureFile(writerA, policyPath, `${JSON.stringify(modifiedPolicy, null, 2)}\n`);
			git(writerA, ['add', policyPath]);
			git(writerA, ['commit', '-m', 'untrusted remote policy change']);
			git(writerA, ['push', 'origin', 'v3']);

			const freshness = getMissionControlFreshness({
				repositoryDbRoot: writerB,
			});
			expect(freshness.fetch.ok).toBe(false);
			expect(freshness.staleFreshness).toBe(true);
			expect(freshness.pullSafe).toBe(false);
			expect(freshness.pullBlockedReason).toBe('fetch_inbound_validation_failed');
			expect(git(writerB, ['rev-parse', 'refs/remotes/origin/v3'])).toBe(beforeTrackingRef);
			expect(readFileSync(join(writerB, policyPath), 'utf8')).toBe(beforePolicy);
		});
	});

	test('updates across legacy lock churn and schema migration without reapproving history', () => {
		withIsolatedFixture(({ writerA, writerB }) => {
			const policyPath = 'data/mission-control/mission-control.config.json';
			const originalPolicy = readFileSync(join(writerA, policyPath), 'utf8');
			const oldPolicy = JSON.parse(originalPolicy);
			delete oldPolicy.publish_policy.protected_paths;
			oldPolicy.publish_policy.approval_roles = ['admin'];
			writeFixtureFile(writerA, policyPath, JSON.stringify(oldPolicy));
			writeFixtureFile(writerA, '.repository-db/publish.lock', 'legacy lock\n');
			git(writerA, ['add', '--force', '.']);
			git(writerA, ['commit', '-m', 'legacy policy and runtime lock']);
			git(writerA, ['push', 'origin', 'v3']);
			// Establish the actual pre-migration client, not just an old commit
			// somewhere in remote history. The app must recover from this HEAD.
			git(writerB, ['pull', '--ff-only', 'origin', 'v3']);
			writeFixtureFile(writerA, '.repository-db/publish.lock', 'another legacy lock\n');
			git(writerA, ['add', '.']);
			git(writerA, ['commit', '-m', 'legacy lock churn']);
			writeFixtureFile(writerA, policyPath, originalPolicy);
			git(writerA, ['rm', '.repository-db/publish.lock']);
			writeFixtureFile(writerA, '.gitignore', '.repository-db/\n');
			git(writerA, ['add', '.']);
			git(writerA, ['commit', '-m', 'published migration to native writer']);
			git(writerA, ['push', 'origin', 'v3']);
			const result = pullMissionControlRepository({ repositoryDbRoot: writerB });
			expect(result.pulled).toBe(true);
			expect(git(writerB, ['rev-parse', 'HEAD'])).toBe(git(writerA, ['rev-parse', 'HEAD']));
			expect(existsSync(join(writerB, '.repository-db/publish.lock'))).toBe(false);
			expect(readFileSync(join(writerB, policyPath), 'utf8')).toBe(originalPolicy);
		});
	});

	test('accepts published ignore rules without allowing data to change Git execution', () => {
		withIsolatedFixture(({ writerA, writerB }) => {
			const path = 'data/mission-control/reports/.gitignore';
			writeFixtureFile(writerA, path, 'local-draft.txt\n');
			git(writerA, ['add', path]);
			git(writerA, ['commit', '-m', 'published ignore rules']);
			git(writerA, ['push', 'origin', 'v3']);
			expect(pullMissionControlRepository({ repositoryDbRoot: writerB }).pulled).toBe(true);
		});
	});

	for (const path of [
		'.gitattributes',
		'data/mission-control/reports/.gitattributes',
		'.gitmodules',
	]) {
		test(`rejects executable Git behavior before materializing ${path}`, () => {
			withIsolatedFixture(({ writerA, writerB }) => {
				const before = git(writerB, ['rev-parse', 'refs/remotes/origin/v3']);
				writeFixtureFile(writerA, path, '# Git behavior\n');
				git(writerA, ['add', path]);
				git(writerA, ['commit', '-m', 'Git behavior change']);
				git(writerA, ['push', 'origin', 'v3']);
				const result = getMissionControlFreshness({ repositoryDbRoot: writerB });
				expect(result.fetch.reason).toBe('fetch_inbound_git_behavior_unsupported');
				expect(git(writerB, ['rev-parse', 'refs/remotes/origin/v3'])).toBe(before);
				expect(existsSync(join(writerB, path))).toBe(false);
			});
		});
	}

	test('accepts equivalent CRLF schema bytes without weakening schema pinning', () => {
		withIsolatedFixture(({ writerA, writerB }) => {
			const path = 'schemas/mission-control-plan.schema.json';
			git(writerA, ['config', 'core.autocrlf', 'false']);
			writeFixtureFile(
				writerA,
				path,
				readFileSync(join(writerA, path), 'utf8').replace(/\r?\n/g, '\r\n'),
			);
			git(writerA, ['add', path]);
			git(writerA, ['commit', '-m', 'preserve schema with CRLF line endings']);
			git(writerA, ['push', 'origin', 'v3']);
			expect(getMissionControlFreshness({ repositoryDbRoot: writerB }).fetch.ok).toBe(true);
		});
	});

	test('rejects a data-provided schema that weakens pinned validation', () => {
		withIsolatedFixture(({ writerA, writerB }) => {
			const before = git(writerB, ['rev-parse', 'refs/remotes/origin/v3']);
			writeFixtureFile(writerA, 'schemas/mission-control-plan.schema.json', '{}\n');
			git(writerA, ['add', '.']);
			git(writerA, ['commit', '-m', 'weaken plan schema']);
			git(writerA, ['push', 'origin', 'v3']);
			expect(getMissionControlFreshness({ repositoryDbRoot: writerB }).fetch.reason).toBe(
				'fetch_inbound_schema_incompatible',
			);
			expect(git(writerB, ['rev-parse', 'refs/remotes/origin/v3'])).toBe(before);
		});
	});

	for (const field of ['remote', 'branch']) {
		test(`rejects target repository ${field} redirection`, () => {
			withIsolatedFixture(({ writerA, writerB, remote }) => {
				const path = 'repository-db.yaml';
				const before = git(writerB, ['rev-parse', 'refs/remotes/origin/v3']);
				let config = readFileSync(join(writerA, path), 'utf8');
				config =
					field === 'remote'
						? config.replace(remote, 'git@github.com:other/mission-control-data.git')
						: config.replace('branch: v3', 'branch: v4');
				writeFixtureFile(writerA, path, config);
				git(writerA, ['add', path]);
				git(writerA, ['commit', '-m', 'redirect data repo']);
				git(writerA, ['push', 'origin', 'v3']);
				expect(getMissionControlFreshness({ repositoryDbRoot: writerB }).fetch.reason).toBe(
					'fetch_inbound_routing_changed',
				);
				expect(git(writerB, ['rev-parse', 'refs/remotes/origin/v3'])).toBe(before);
			});
		});
	}

	for (const mutate of ['legacy', 'writer']) {
		test(`rejects incompatible target policy: ${mutate}`, () => {
			withIsolatedFixture(({ writerA, writerB }) => {
				const path = 'data/mission-control/mission-control.config.json';
				const before = git(writerB, ['rev-parse', 'HEAD']);
				const config = JSON.parse(readFileSync(join(writerA, path), 'utf8'));
				if (mutate === 'legacy') config.compatibility_bridge.legacy_write_paths_allowed = true;
				else config.publish_policy.writer_mode = 'authenticated-capability-v1';
				writeFixtureFile(writerA, path, JSON.stringify(config));
				git(writerA, ['add', path]);
				git(writerA, ['commit', '-m', 'unsafe policy']);
				git(writerA, ['push', 'origin', 'v3']);
				expect(getMissionControlFreshness({ repositoryDbRoot: writerB }).fetch.reason).toBe(
					'fetch_inbound_policy_incompatible',
				);
				expect(git(writerB, ['rev-parse', 'refs/remotes/origin/v3'])).toBe(before);
			});
		}, 30_000);
	}

	test('derives validator workspace context when launched without the root wrapper', () => {
		withIsolatedFixture(({ tempRoot, writerA, writerB }) => {
			const validatorRoot = join(tmpdir(), `mission-control-test-validator.mjs-${process.pid}`);
			mkdirSync(validatorRoot, { recursive: true });
			const validator = join(validatorRoot, 'validator.mjs');
			writeFileSync(
				validator,
				`if (!process.env.MISSION_CONTROL_WORKSPACE_ROOT || process.env.MISSION_CONTROL_WORKSPACE_ROOT === process.cwd()) process.exit(1);`,
			);
			chmodSync(validator, 0o700);
			const release = installMissionControlTestDataValidator(validator);
			const before = process.env.MISSION_CONTROL_WORKSPACE_ROOT;
			delete process.env.MISSION_CONTROL_WORKSPACE_ROOT;
			try {
				commitAndPushReport(writerA, 'context.md', 'new data');
				expect(getMissionControlFreshness({ repositoryDbRoot: writerB }).fetch.ok).toBe(true);
			} finally {
				if (before === undefined) delete process.env.MISSION_CONTROL_WORKSPACE_ROOT;
				else process.env.MISSION_CONTROL_WORKSPACE_ROOT = before;
				release();
				rmSync(validatorRoot, { recursive: true, force: true });
			}
		});
	}, 30_000);

	test('preserves ignored local files outside the canonical data prefix', () => {
		withIsolatedFixture(({ writerA, writerB }) => {
			const path = '.repository-db/local-note.txt';
			const before = git(writerB, ['rev-parse', 'HEAD']);
			writeFixtureFile(writerB, path, 'local note\n');
			writeFixtureFile(writerA, path, 'incoming note\n');
			git(writerA, ['add', '--force', path]);
			git(writerA, ['commit', '-m', 'claim ignored local path']);
			git(writerA, ['push', 'origin', 'v3']);
			expect(() => pullMissionControlRepository({ repositoryDbRoot: writerB })).toThrow();
			expect(git(writerB, ['rev-parse', 'HEAD'])).toBe(before);
			expect(readFileSync(join(writerB, path), 'utf8')).toBe('local note\n');
		});
	}, 30_000);

	for (const attack of [
		'later-data',
		'net-zero',
		'policy-downgrade',
		'merged-net-zero',
		'merged-policy-downgrade',
		'old-side-policy-downgrade',
	]) {
		test(`rejects hidden frozen audit changes: ${attack}`, () => {
			withIsolatedFixture(({ writerA, writerB }) => {
				const path = 'data/mission-control/changesets/published/.gitkeep';
				const policyPath = 'data/mission-control/mission-control.config.json';
				const originalPolicy = readFileSync(join(writerA, policyPath), 'utf8');
				const original = readFileSync(join(writerA, path), 'utf8');
				let before = git(writerB, ['rev-parse', 'HEAD']);
				if (attack === 'old-side-policy-downgrade') {
					git(writerA, ['branch', 'side-audit']);
					commitAndPushReport(writerA, 'base-advanced.md', 'advance trusted base');
					git(writerB, ['pull', '--ff-only', 'origin', 'v3']);
					before = git(writerB, ['rev-parse', 'HEAD']);
					git(writerA, ['checkout', 'side-audit']);
				} else if (attack.startsWith('merged-')) git(writerA, ['checkout', '-b', 'side-audit']);
				if (attack.includes('policy-downgrade')) {
					const policy = JSON.parse(originalPolicy);
					delete policy.publish_policy.writer_mode;
					writeFixtureFile(writerA, policyPath, JSON.stringify(policy));
					git(writerA, ['add', policyPath]);
					git(writerA, ['commit', '-m', 'temporarily disable native writer']);
				}
				writeFixtureFile(writerA, path, 'tampered history\n');
				git(writerA, ['add', path]);
				git(writerA, ['commit', '-m', 'tamper frozen audit']);
				if (attack.includes('net-zero') || attack.endsWith('policy-downgrade'))
					writeFixtureFile(writerA, path, original);
				else writeFixtureFile(writerA, 'data/mission-control/reports/new.md', 'new report\n');
				writeFixtureFile(writerA, policyPath, originalPolicy);
				git(writerA, ['add', '.']);
				git(writerA, ['commit', '-m', 'hide historical rewrite']);
				if (attack.startsWith('merged-') || attack.startsWith('old-side-')) {
					git(writerA, ['checkout', 'v3']);
					git(writerA, ['merge', '--no-ff', 'side-audit', '-m', 'merge restored audit tree']);
				}
				git(writerA, ['push', 'origin', 'v3']);
				expect(getMissionControlFreshness({ repositoryDbRoot: writerB }).fetch.reason).toBe(
					'fetch_inbound_validation_failed',
				);
				expect(git(writerB, ['rev-parse', 'refs/remotes/origin/v3'])).toBe(before);
			});
		}, 30_000);
	}

	test('preserves an unchanged HTTPS spelling with a normalized public display URL', () => {
		withIsolatedFixture(({ writerA, writerB, remote, remotePath }) => {
			const configuredUrl = 'https://GitHub.com:443/example/mission-control-data.git';
			const configPath = 'repository-db.yaml';
			writeFixtureFile(
				writerA,
				configPath,
				readFileSync(join(writerA, configPath), 'utf8').replace(remote, configuredUrl),
			);
			git(writerA, ['add', configPath]);
			git(writerA, ['commit', '-m', 'establish HTTPS fixture']);
			git(writerA, ['push', 'origin', 'v3']);
			git(writerB, ['pull', '--ff-only', 'origin', 'v3']);
			git(writerB, ['remote', 'set-url', 'origin', configuredUrl]);
			commitAndPushReport(writerA, 'https.md', 'incoming data');
			const gitRoot = join(tmpdir(), `mission-control-test-git-${process.pid}`);
			const validatorRoot = join(tmpdir(), `mission-control-test-validator.mjs-${process.pid}`);
			mkdirSync(gitRoot, { recursive: true });
			mkdirSync(validatorRoot, { recursive: true });
			const gitPath = join(gitRoot, 'git');
			const validatorPath = join(validatorRoot, 'validator.mjs');
			// Only test transport is mapped locally; the app still sees and checks
			// the exact configured HTTPS spelling throughout the real fetch path.
			writeFileSync(
				gitPath,
				`#!/usr/bin/env node\nconst {spawnSync}=require('node:child_process');const args=process.argv.slice(2);if(args.includes('fetch') && args.includes('validated-origin'))args[args.indexOf('validated-origin')]=${JSON.stringify(remotePath)};const r=spawnSync('git',args,{stdio:'inherit'});process.exit(r.status??1);\n`,
			);
			writeFileSync(validatorPath, 'process.exit(0);\n');
			chmodSync(gitPath, 0o700);
			chmodSync(validatorPath, 0o700);
			const releaseGit = installMissionControlTestGitExecutable(gitPath);
			const releaseValidator = installMissionControlTestDataValidator(validatorPath);
			try {
				const result = getMissionControlFreshness({ repositoryDbRoot: writerB });
				expect(result.status.expectedRemoteUrl).not.toBe(configuredUrl);
				expect(result.fetch).toMatchObject({ ok: true });
			} finally {
				releaseValidator();
				releaseGit();
				rmSync(gitRoot, { recursive: true, force: true });
				rmSync(validatorRoot, { recursive: true, force: true });
			}
		});
	}, 30_000);

	test('ignored untracked domain data remains a dirty draft that pull cannot overwrite', () => {
		withIsolatedFixture(({ writerA, writerB }) => {
			const reportsRoot = 'data/mission-control/reports';
			const gitignorePath = `${reportsRoot}/.gitignore`;
			const draftPath = `${reportsRoot}/local-draft.txt`;
			writeFixtureFile(writerA, gitignorePath, 'local-draft.txt\n');
			git(writerA, ['add', gitignorePath]);
			git(writerA, ['commit', '-m', 'establish reviewed ignore fixture']);
			git(writerA, ['push', 'origin', 'v3']);
			git(writerB, ['pull', '--ff-only', 'origin', 'v3']);

			writeFixtureFile(writerB, draftPath, 'private local draft\n');
			expect(git(writerB, ['status', '--porcelain'])).toBe('');

			writeFixtureFile(writerA, draftPath, 'incoming published data\n');
			git(writerA, ['add', '--force', draftPath]);
			git(writerA, ['commit', '-m', 'claim ignored report path']);
			git(writerA, ['push', 'origin', 'v3']);

			const freshness = getMissionControlFreshness({
				repositoryDbRoot: writerB,
			});
			expect(freshness.fetch.ok).toBe(true);
			expect(freshness.status.clean).toBe(false);
			expect(freshness.status.dirty.some((line) => line.includes(draftPath))).toBe(true);
			expect(freshness.pullSafe).toBe(false);
			expect(freshness.pullBlockedReason).toBe('dirty_working_tree');

			try {
				pullMissionControlRepository({ repositoryDbRoot: writerB });
				throw new Error('pull should not overwrite an ignored draft');
			} catch (error) {
				expect(error).toBeInstanceOf(MissionControlPullError);
				expect((error as MissionControlPullError).reason).toBe('dirty_working_tree');
			}
			expect(readFileSync(join(writerB, draftPath), 'utf8')).toBe('private local draft\n');
		});
	});

	test('does not trust an externally populated tracking ref as the inbound validation baseline', () => {
		withIsolatedFixture(({ writerA, writerB }) => {
			const policyPath = 'data/mission-control/mission-control.config.json';
			const localHead = git(writerB, ['rev-parse', 'HEAD']);
			const beforePolicy = readFileSync(join(writerB, policyPath), 'utf8');
			const modifiedPolicy = JSON.parse(readFileSync(join(writerA, policyPath), 'utf8'));
			modifiedPolicy.publish_policy.approval_roles = ['admin'];
			writeFixtureFile(writerA, policyPath, `${JSON.stringify(modifiedPolicy, null, 2)}\n`);
			git(writerA, ['add', policyPath]);
			git(writerA, ['commit', '-m', 'publish unapproved policy']);
			git(writerA, ['push', 'origin', 'v3']);

			// Simulate a legacy or ordinary Git fetch that moved the mutable
			// cache before Mission Control's inbound gate ran.
			git(writerB, ['fetch', 'origin', 'v3']);
			const unauditedTrackingHead = git(writerB, ['rev-parse', 'refs/remotes/origin/v3']);

			const freshness = getMissionControlFreshness({
				repositoryDbRoot: writerB,
			});
			expect(freshness.fetch.ok).toBe(false);
			expect(freshness.pullBlockedReason).toBe('fetch_inbound_validation_failed');
			expect(git(writerB, ['rev-parse', 'HEAD'])).toBe(localHead);
			expect(git(writerB, ['rev-parse', 'refs/remotes/origin/v3'])).toBe(unauditedTrackingHead);
			expect(readFileSync(join(writerB, policyPath), 'utf8')).toBe(beforePolicy);
		});
	});

	test('pull ignores fetch:false and refuses an unaudited cached tracking ref while offline', () => {
		withIsolatedFixture(({ remotePath, writerA, writerB }) => {
			const localHead = git(writerB, ['rev-parse', 'HEAD']);
			commitAndPushReport(
				writerA,
				'cached-without-attestation.md',
				'must not merge without a fresh verified fetch',
			);
			git(writerB, ['fetch', 'origin', 'v3']);
			renameSync(remotePath, `${remotePath}.offline`);

			const callerOptions = {
				repositoryDbRoot: writerB,
				fetch: false,
				timeoutMs: 5000,
			};
			try {
				pullMissionControlRepository(callerOptions);
				throw new Error('pull should require a fresh verified fetch');
			} catch (error) {
				expect(error).toBeInstanceOf(MissionControlPullError);
				expect((error as MissionControlPullError).reason).toBe('fetch_failed');
			}
			expect(git(writerB, ['rev-parse', 'HEAD'])).toBe(localHead);
			expect(
				existsSync(join(writerB, 'data/mission-control/reports/cached-without-attestation.md')),
			).toBe(false);
		});
	});

	test('anchors fetch remote and branch in clean HEAD/index control-plane', () => {
		withIsolatedFixture(({ tempRoot, remote, writerB }) => {
			const maliciousRemote = localSshRemoteUrl(
				join(tempRoot, 'attacker', 'mission-control-data.git'),
			);
			const repositoryConfigPath = join(writerB, 'repository-db.yaml');
			const beforeTrackingRef = git(writerB, ['rev-parse', 'refs/remotes/origin/v3']);
			writeFileSync(
				repositoryConfigPath,
				readFileSync(repositoryConfigPath, 'utf8')
					.replace(`remote: ${remote}`, `remote: ${maliciousRemote}`)
					.replace('branch: v3', 'branch: attacker'),
			);
			git(writerB, ['remote', 'set-url', 'origin', maliciousRemote]);

			const freshness = getMissionControlFreshness({
				repositoryDbRoot: writerB,
			});
			expect(freshness.fetch.ok).toBe(false);
			expect(freshness.fetch.reason).toBe('fetch_control_plane_untrusted');
			expect(freshness.status.controlPlaneTrusted).toBe(false);
			expect(freshness.status.controlPlaneDriftPaths).toContain('repository-db.yaml');
			expect(freshness.pullSafe).toBe(false);
			expect(freshness.pullBlockedReason).toBe('fetch_control_plane_untrusted');
			expect(git(writerB, ['rev-parse', 'refs/remotes/origin/v3'])).toBe(beforeTrackingRef);
		});
	});

	test('rejects staged mode-only control-plane drift before network access', () => {
		withIsolatedFixture(({ writerB }) => {
			const beforeTrackingRef = git(writerB, ['rev-parse', 'refs/remotes/origin/v3']);
			git(writerB, ['update-index', '--chmod=+x', 'repository-db.yaml']);

			const freshness = getMissionControlFreshness({
				repositoryDbRoot: writerB,
			});
			expect(freshness.fetch.ok).toBe(false);
			expect(freshness.fetch.reason).toBe('fetch_control_plane_untrusted');
			expect(freshness.status.controlPlaneTrusted).toBe(false);
			expect(freshness.status.controlPlaneDriftPaths).toContain('repository-db.yaml');
			expect(git(writerB, ['rev-parse', 'refs/remotes/origin/v3'])).toBe(beforeTrackingRef);
		});
	});

	test('accepts clean CRLF control-plane worktree files on Windows-style checkouts', () => {
		withIsolatedFixture(({ tempRoot, remote }) => {
			const writerB = join(tempRoot, 'writer-crlf');
			git(tempRoot, ['-c', 'core.autocrlf=true', 'clone', '--branch', 'v3', remote, writerB]);
			git(writerB, ['config', 'core.autocrlf', 'true']);
			git(writerB, ['config', 'user.email', 'writer@example.invalid']);
			git(writerB, ['config', 'user.name', 'Mission Control Writer']);
			for (const path of [
				'repository-db.yaml',
				'data/mission-control/mission-control.config.json',
			]) {
				const content = readFileSync(join(writerB, path), 'utf8');
				expect(content).toContain('\r\n');
			}

			const freshness = getMissionControlFreshness({
				repositoryDbRoot: writerB,
				fetch: false,
			});
			expect(freshness.status.controlPlaneTrusted).toBe(true);
			expect(freshness.status.controlPlaneDriftPaths).toEqual([]);
			expect(freshness.status.dirty).toEqual([]);
			expect(freshness.pullSafe).toBe(false);
			expect(freshness.pullBlockedReason).toBe('fetch_required');
		});
	});

	test('rejects case-colliding control-plane paths before object import', () => {
		withIsolatedFixture(({ writerA, writerB }) => {
			const canonicalPath = 'data/mission-control/mission-control.config.json';
			const aliasPath = 'data/mission-control/MISSION-CONTROL.CONFIG.JSON';
			const canonicalBlob = git(writerA, ['rev-parse', `HEAD:${canonicalPath}`]);
			const beforeTrackingRef = git(writerB, ['rev-parse', 'refs/remotes/origin/v3']);
			git(writerA, [
				'update-index',
				'--add',
				'--cacheinfo',
				`100644,${canonicalBlob},${aliasPath}`,
			]);
			git(writerA, ['commit', '-m', 'add case-colliding policy alias']);
			git(writerA, ['push', 'origin', 'v3']);

			const freshness = getMissionControlFreshness({
				repositoryDbRoot: writerB,
			});
			expect(freshness.fetch.ok).toBe(false);
			expect(freshness.staleFreshness).toBe(true);
			expect(freshness.pullSafe).toBe(false);
			expect(freshness.pullBlockedReason).toBe('fetch_inbound_case_collision');
			expect(git(writerB, ['rev-parse', 'refs/remotes/origin/v3'])).toBe(beforeTrackingRef);
		});
	});

	test('rejects case-colliding directory components before object import', () => {
		withIsolatedFixture(({ writerA, writerB }) => {
			const canonicalPath = 'data/mission-control/plans/.gitkeep';
			const aliasPath = 'data/mission-control/PLANS/component-collision.json';
			const canonicalBlob = git(writerA, ['rev-parse', `HEAD:${canonicalPath}`]);
			const beforeTrackingRef = git(writerB, ['rev-parse', 'refs/remotes/origin/v3']);
			git(writerA, [
				'update-index',
				'--add',
				'--cacheinfo',
				`100644,${canonicalBlob},${aliasPath}`,
			]);
			git(writerA, ['commit', '-m', 'add case-colliding plans directory alias']);
			git(writerA, ['push', 'origin', 'v3']);

			const freshness = getMissionControlFreshness({
				repositoryDbRoot: writerB,
			});
			expect(freshness.fetch.ok).toBe(false);
			expect(freshness.pullBlockedReason).toBe('fetch_inbound_case_collision');
			expect(git(writerB, ['rev-parse', 'refs/remotes/origin/v3'])).toBe(beforeTrackingRef);
		});
	});

	test('rejects invalid UTF-8 path bytes before object import', () => {
		withIsolatedFixture(({ writerA, writerB }) => {
			const blob = git(writerA, ['rev-parse', 'HEAD:data/mission-control/TODO.tasks.json']);
			const invalidPath = Buffer.concat([
				Buffer.from('data/mission-control/reports/invalid-', 'utf8'),
				Buffer.from([0xff]),
				Buffer.from('.json', 'utf8'),
			]);
			const indexInfo = Buffer.concat([
				Buffer.from(`100644 blob ${blob}\t`, 'ascii'),
				invalidPath,
				Buffer.from([0x00]),
			]);
			const beforeTrackingRef = git(writerB, ['rev-parse', 'refs/remotes/origin/v3']);
			execFileSync('git', ['update-index', '-z', '--index-info'], {
				cwd: writerA,
				env: { ...process.env },
				input: indexInfo,
				stdio: ['pipe', 'pipe', 'pipe'],
			});
			git(writerA, ['commit', '-m', 'add invalid UTF-8 path']);
			git(writerA, ['push', 'origin', 'v3']);

			const freshness = getMissionControlFreshness({
				repositoryDbRoot: writerB,
			});
			expect(freshness.fetch.ok).toBe(false);
			expect(freshness.pullBlockedReason).toBe('fetch_inbound_unsafe_tree_entry');
			expect(git(writerB, ['rev-parse', 'refs/remotes/origin/v3'])).toBe(beforeTrackingRef);
		});
	});

	test('rejects non-ASCII inbound paths before object import', () => {
		withIsolatedFixture(({ writerA, writerB }) => {
			const blob = git(writerA, ['rev-parse', 'HEAD:data/mission-control/TODO.tasks.json']);
			const nonAsciiPath = 'data/mission-control/reports/σ.md';
			const beforeTrackingRef = git(writerB, ['rev-parse', 'refs/remotes/origin/v3']);
			git(writerA, ['update-index', '--add', '--cacheinfo', `100644,${blob},${nonAsciiPath}`]);
			git(writerA, ['commit', '-m', 'add non-ascii inbound path']);
			git(writerA, ['push', 'origin', 'v3']);

			const freshness = getMissionControlFreshness({
				repositoryDbRoot: writerB,
			});
			expect(freshness.fetch.ok).toBe(false);
			expect(freshness.pullBlockedReason).toBe('fetch_inbound_unsafe_tree_entry');
			expect(git(writerB, ['rev-parse', 'refs/remotes/origin/v3'])).toBe(beforeTrackingRef);
		});
	});

	test('allows printable ASCII inbound paths with spaces', () => {
		withIsolatedFixture(({ writerA, writerB }) => {
			const reportPath = 'data/mission-control/reports/QA report.md';
			const beforeTrackingRef = git(writerB, ['rev-parse', 'refs/remotes/origin/v3']);
			writeFixtureFile(writerA, reportPath, 'ASCII path is portable\n');
			git(writerA, ['add', reportPath]);
			git(writerA, ['commit', '-m', 'add ascii report path']);
			git(writerA, ['push', 'origin', 'v3']);

			const freshness = getMissionControlFreshness({
				repositoryDbRoot: writerB,
			});
			expect(freshness.fetch.ok).toBe(true);
			expect(freshness.newerAvailable).toBe(true);
			expect(freshness.pullSafe).toBe(true);
			expect(git(writerB, ['rev-parse', 'refs/remotes/origin/v3'])).not.toBe(beforeTrackingRef);
		});
	});

	symlinkTest('rejects symlink and git-special entries in inbound domain data', () => {
		withIsolatedFixture(({ tempRoot, writerA, writerB }) => {
			const ledgerPath = 'data/mission-control/TODO.tasks.json';
			const outsideSecret = join(tempRoot, 'outside-secret.json');
			const beforeTrackingRef = git(writerB, ['rev-parse', 'refs/remotes/origin/v3']);
			const beforeLedger = readFileSync(join(writerB, ledgerPath), 'utf8');
			writeFileSync(outsideSecret, '{"secret":"must-not-be-read"}\n');
			rmSync(join(writerA, ledgerPath));
			symlinkSync('../../../outside-secret.json', join(writerA, ledgerPath));
			git(writerA, ['add', ledgerPath]);
			git(writerA, ['commit', '-m', 'replace TODO ledger with symlink']);
			git(writerA, ['push', 'origin', 'v3']);

			const freshness = getMissionControlFreshness({
				repositoryDbRoot: writerB,
			});
			expect(freshness.fetch.ok).toBe(false);
			expect(freshness.staleFreshness).toBe(true);
			expect(freshness.pullSafe).toBe(false);
			expect(freshness.pullBlockedReason).toBe('fetch_inbound_unsafe_tree_entry');
			expect(git(writerB, ['rev-parse', 'refs/remotes/origin/v3'])).toBe(beforeTrackingRef);
			expect(readFileSync(join(writerB, ledgerPath), 'utf8')).toBe(beforeLedger);
		});
	});

	symlinkTest(
		'allows an unsafe remote ancestor after a local repair without treating it as inbound bytes',
		() => {
			withIsolatedFixture(({ tempRoot, writerA, writerB }) => {
				const ledgerPath = 'data/mission-control/TODO.tasks.json';
				const outsideSecret = join(tempRoot, 'outside-secret.json');
				writeFileSync(outsideSecret, '{"secret":"must-not-be-read"}\n');
				rmSync(join(writerA, ledgerPath));
				symlinkSync('../../../outside-secret.json', join(writerA, ledgerPath));
				git(writerA, ['add', ledgerPath]);
				git(writerA, ['commit', '-m', 'publish unsafe ancestor fixture']);
				git(writerA, ['push', 'origin', 'v3']);

				// Recovery is an explicit operator action: acquire the rejected
				// ancestor, replace its unsafe entry, and commit a validated repair.
				git(writerB, ['fetch', 'origin', 'v3']);
				git(writerB, ['reset', '--hard', 'origin/v3']);
				rmSync(join(writerB, ledgerPath));
				writeFixtureFile(writerB, ledgerPath, '[]\n');
				git(writerB, ['add', ledgerPath]);
				git(writerB, ['commit', '-m', 'repair unsafe remote ancestor']);

				const freshness = getMissionControlFreshness({
					repositoryDbRoot: writerB,
				});
				expect(freshness.fetch.ok).toBe(true);
				expect(freshness.ahead).toBe(1);
				expect(freshness.behind).toBe(0);
				expect(freshness.pullBlockedReason).toBe('up_to_date');
				expect(readFileSync(join(writerB, ledgerPath), 'utf8')).toBe('[]\n');
			});
		},
	);

	test('validates fetched domain data before tracking-ref update or pull', () => {
		withIsolatedFixture(({ writerA, writerB }) => {
			const ledgerPath = 'data/mission-control/TODO.tasks.json';
			const beforeTrackingRef = git(writerB, ['rev-parse', 'refs/remotes/origin/v3']);
			const beforeLedger = readFileSync(join(writerB, ledgerPath), 'utf8');
			writeFixtureFile(writerA, ledgerPath, '{"not":"an array"}\n');
			git(writerA, ['add', ledgerPath]);
			git(writerA, ['commit', '-m', 'publish invalid TODO ledger']);
			git(writerA, ['push', 'origin', 'v3']);

			const freshness = getMissionControlFreshness({
				repositoryDbRoot: writerB,
			});
			expect(freshness.fetch.ok).toBe(false);
			expect(freshness.staleFreshness).toBe(true);
			expect(freshness.pullSafe).toBe(false);
			expect(freshness.pullBlockedReason).toBe('fetch_inbound_validation_failed');
			expect(git(writerB, ['rev-parse', 'refs/remotes/origin/v3'])).toBe(beforeTrackingRef);
			expect(readFileSync(join(writerB, ledgerPath), 'utf8')).toBe(beforeLedger);
		});
	});

	test('rejects filesystem and external-helper transports before fetch', () => {
		withIsolatedFixture(({ tempRoot, remote, writerB }) => {
			const marker = join(tempRoot, 'external-helper-ran');
			const unsafeRemotes = [
				join(tempRoot, 'local', 'mission-control-data.git'),
				`file://${join(tempRoot, 'file', 'mission-control-data.git')}`,
				`ext::sh -c ': > ${marker}'/mission-control-data.git`,
			];
			for (const unsafeRemote of unsafeRemotes) {
				const repositoryConfigPath = join(writerB, 'repository-db.yaml');
				writeFileSync(
					repositoryConfigPath,
					readFileSync(repositoryConfigPath, 'utf8').replace(
						`remote: ${remote}`,
						`remote: ${JSON.stringify(unsafeRemote)}`,
					),
				);
				git(writerB, ['add', 'repository-db.yaml']);
				git(writerB, ['commit', '-m', 'configure unsafe transport fixture']);
				git(writerB, ['remote', 'set-url', 'origin', unsafeRemote]);

				const freshness = getMissionControlFreshness({
					repositoryDbRoot: writerB,
				});
				expect(freshness.fetch.ok).toBe(false);
				expect(freshness.status.remoteConfigured).toBe(false);
				expect(freshness.status.fetchRemoteMatches).toBe(false);
				expect(freshness.pullBlockedReason).toBe('remote_not_configured');
				expect(freshness.fetch.error).toContain('credential-free');
				expect(existsSync(marker)).toBe(false);

				git(writerB, ['remote', 'set-url', 'origin', remote]);
				git(writerB, ['reset', '--hard', 'HEAD^']);
			}
		});
	});

	test('rejects an origin fetch URL that does not match repository-db.yaml', () => {
		withIsolatedFixture(({ tempRoot, writerB }) => {
			const redirectedRemote = join(tempRoot, 'redirected.git');
			git(tempRoot, ['init', '--bare', redirectedRemote]);
			git(writerB, ['remote', 'set-url', 'origin', redirectedRemote]);
			const before = git(writerB, ['rev-parse', 'HEAD']);

			const freshness = getMissionControlFreshness({
				repositoryDbRoot: writerB,
			});
			expect(freshness.fetch.ok).toBe(false);
			expect(freshness.status.fetchRemoteMatches).toBe(false);
			expect(freshness.pullSafe).toBe(false);
			expect(freshness.pullBlockedReason).toBe('fetch_remote_mismatch');
			expect(freshness.fetch.error).toContain('repository-db.yaml');

			try {
				pullMissionControlRepository({ repositoryDbRoot: writerB });
				throw new Error('pull should have rejected the mismatched fetch remote');
			} catch (error) {
				expect(error).toBeInstanceOf(MissionControlPullError);
				expect((error as MissionControlPullError).reason).toBe('fetch_remote_mismatch');
			}
			expect(git(writerB, ['rev-parse', 'HEAD'])).toBe(before);
		});
	});

	test('allows a fetch and fast-forward pull when pushurl is intentionally disabled', () => {
		withIsolatedFixture(({ writerA, writerB }) => {
			git(writerB, ['config', '--add', 'remote.origin.pushurl', '/dev/null']);
			commitAndPushReport(writerA, 'push-disabled-pull.txt', 'pull remains readable');

			const status = getMissionControlRepositoryStatus({
				repositoryDbRoot: writerB,
				fetch: true,
			});
			expect(status.fetchRemoteMatches).toBe(true);
			expect(status.remoteMatches).toBe(false);
			expect(status.behind).toBe(1);

			const freshness = getMissionControlFreshness({
				repositoryDbRoot: writerB,
			});
			expect(freshness.status.fetchRemoteMatches).toBe(true);
			expect(freshness.status.remoteMatches).toBe(false);
			expect(freshness.status.localGitFetchRoutingOverrides).toEqual([]);
			expect(freshness.pullSafe).toBe(true);

			const result = pullMissionControlRepository({
				repositoryDbRoot: writerB,
			});
			expect(result.pulled).toBe(true);
			expect(
				readFileSync(join(writerB, 'data/mission-control/reports/push-disabled-pull.txt'), 'utf8'),
			).toContain('pull remains readable');
		});
	});

	test('rejects branch names that Git or the remote-tracking boundary reserves', () => {
		for (const branch of ['.hidden', 'release.lock', 'HEAD']) {
			withIsolatedFixture(({ writerB }) => {
				const repositoryConfigPath = join(writerB, 'repository-db.yaml');
				writeFileSync(
					repositoryConfigPath,
					readFileSync(repositoryConfigPath, 'utf8').replace('branch: v3', `branch: ${branch}`),
				);
				git(writerB, ['add', 'repository-db.yaml']);
				git(writerB, ['commit', '-m', `configure invalid branch ${branch}`]);

				const freshness = getMissionControlFreshness({
					repositoryDbRoot: writerB,
					fetch: false,
				});
				expect(freshness.status.branchConfigured).toBe(false);
				expect(freshness.status.fetchRemoteMatches).toBe(false);
				expect(freshness.status.remoteHead).toBeNull();
				expect(freshness.pullBlockedReason).toBe('branch_invalid');
			});
		}
	});

	test('ignores inherited GIT_DIR and GIT_WORK_TREE during freshness and pull', () => {
		withIsolatedFixture(({ tempRoot, writerA, writerB }) => {
			commitAndPushReport(writerA, 'isolated-repository-paths.txt', 'expected checkout');
			const previous = {
				GIT_DIR: process.env.GIT_DIR,
				GIT_WORK_TREE: process.env.GIT_WORK_TREE,
			};
			try {
				process.env.GIT_DIR = join(tempRoot, 'untrusted.git');
				process.env.GIT_WORK_TREE = tempRoot;
				const freshness = getMissionControlFreshness({
					repositoryDbRoot: writerB,
				});
				expect(freshness.status.fetchRemoteMatches).toBe(true);
				expect(freshness.pullSafe).toBe(true);
				const result = pullMissionControlRepository({
					repositoryDbRoot: writerB,
				});
				expect(result.pulled).toBe(true);
			} finally {
				for (const [key, value] of Object.entries(previous)) {
					if (value === undefined) delete process.env[key];
					else process.env[key] = value;
				}
			}
			expect(
				readFileSync(
					join(writerB, 'data/mission-control/reports/isolated-repository-paths.txt'),
					'utf8',
				),
			).toContain('expected checkout');
		});
	});

	test('ignores ambient URL rewrites instead of fetching a redirected repository', () => {
		withIsolatedFixture(({ tempRoot, remote, writerA, writerB }) => {
			const redirectedRemote = join(tempRoot, 'ambient-redirected.git');
			git(tempRoot, ['init', '--bare', redirectedRemote]);
			commitAndPushReport(writerA, 'ambient-url-rewrite.txt', 'expected remote');
			const previous = {
				GIT_CONFIG_COUNT: process.env.GIT_CONFIG_COUNT,
				GIT_CONFIG_KEY_0: process.env.GIT_CONFIG_KEY_0,
				GIT_CONFIG_VALUE_0: process.env.GIT_CONFIG_VALUE_0,
			};
			try {
				process.env.GIT_CONFIG_COUNT = '1';
				process.env.GIT_CONFIG_KEY_0 = `url.${redirectedRemote}.insteadOf`;
				process.env.GIT_CONFIG_VALUE_0 = remote;
				const freshness = getMissionControlFreshness({
					repositoryDbRoot: writerB,
				});
				expect(freshness.status.fetchRemoteMatches).toBe(true);
				expect(freshness.pullSafe).toBe(true);
				expect(pullMissionControlRepository({ repositoryDbRoot: writerB }).pulled).toBe(true);
			} finally {
				for (const [key, value] of Object.entries(previous)) {
					if (value === undefined) delete process.env[key];
					else process.env[key] = value;
				}
			}
			expect(
				readFileSync(join(writerB, 'data/mission-control/reports/ambient-url-rewrite.txt'), 'utf8'),
			).toContain('expected remote');
			expect(() => git(redirectedRemote, ['rev-parse', '--verify', 'refs/heads/v3'])).toThrow();
		});
	});

	test('removes inherited GIT_SSH_COMMAND at the Git subprocess boundary', () => {
		withIsolatedFixture(({ tempRoot }) => {
			const fakeBin = join(tmpdir(), `mission-control-test-git-${process.pid}`);
			const fakeGit = join(fakeBin, 'git');
			const capturedEnvironment = join(tempRoot, 'git-environment.json');
			rmSync(fakeBin, { recursive: true, force: true });
			mkdirSync(fakeBin, { recursive: true });
			writeFileSync(
				fakeGit,
				[
					'#!/usr/bin/env node',
					"const { writeFileSync } = require('node:fs');",
					`writeFileSync(${JSON.stringify(capturedEnvironment)}, JSON.stringify({ gitSshCommand: process.env.GIT_SSH_COMMAND ?? null }));`,
					'',
				].join('\n'),
			);
			chmodSync(fakeGit, 0o755);
			const releaseTrustedGit = installMissionControlTestGitExecutable(fakeGit);
			const previous = {
				GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND,
			};
			try {
				process.env.GIT_SSH_COMMAND = 'lazurio-inherited-ssh-must-not-run';
				const result = runMissionControlGitCommand(tempRoot, ['version']);
				expect(result.status).toBe(0);
				expect(JSON.parse(readFileSync(capturedEnvironment, 'utf8'))).toEqual({
					gitSshCommand: null,
				});
			} finally {
				releaseTrustedGit();
				for (const [key, value] of Object.entries(previous)) {
					if (value === undefined) delete process.env[key];
					else process.env[key] = value;
				}
				rmSync(fakeBin, { recursive: true, force: true });
			}
		});
	});

	test('leaves native SSH config and known_hosts resolution in charge', () => {
		withIsolatedFixture(({ tempRoot, writerB }) => {
			const ambientHome = join(tempRoot, 'attacker-selected-home');
			const capturedArguments = join(tempRoot, 'ssh-arguments.txt');
			mkdirSync(join(ambientHome, '.ssh'), { recursive: true });
			writeFileSync(
				join(ambientHome, '.ssh', 'known_hosts'),
				'attacker.invalid ssh-ed25519 AAAA\n',
			);
			const previous = {
				HOME: process.env.HOME,
				MISSION_CONTROL_TEST_SSH_CAPTURE_ARGS: process.env.MISSION_CONTROL_TEST_SSH_CAPTURE_ARGS,
			};
			try {
				process.env.HOME = ambientHome;
				process.env.MISSION_CONTROL_TEST_SSH_CAPTURE_ARGS = capturedArguments;
				const freshness = getMissionControlFreshness({
					repositoryDbRoot: writerB,
				});
				expect(freshness.fetch.ok).toBe(true);
			} finally {
				for (const [key, value] of Object.entries(previous)) {
					if (value === undefined) delete process.env[key];
					else process.env[key] = value;
				}
			}
			const sshArguments = readFileSync(capturedArguments, 'utf8');
			expect(sshArguments).not.toContain('UserKnownHostsFile=');
			expect(sshArguments).not.toContain('IdentityFile=none');
		});
	});

	test("preserves the Principal's ordinary Git diagnostic environment", () => {
		withIsolatedFixture(({ tempRoot, writerB }) => {
			const traceMarker = join(tempRoot, 'git-trace-leak');
			const previous = {
				GIT_TRACE: process.env.GIT_TRACE,
			};
			try {
				process.env.GIT_TRACE = traceMarker;

				const freshness = getMissionControlFreshness({
					repositoryDbRoot: writerB,
				});
				expect(freshness.fetch.ok).toBe(true);
			} finally {
				for (const [key, value] of Object.entries(previous)) {
					if (value === undefined) delete process.env[key];
					else process.env[key] = value;
				}
			}
			expect(existsSync(traceMarker)).toBe(true);
		});
	});

	test("resolves the Git executable from the Principal's PATH", () => {
		withIsolatedFixture(({ tempRoot, writerB }) => {
			const previousPath = process.env.PATH;
			if (process.platform === 'win32') {
				try {
					process.env.PATH = dirname(REAL_GIT_EXECUTABLE);
					const freshness = getMissionControlFreshness({
						repositoryDbRoot: writerB,
					});
					expect(freshness.fetch.ok).toBe(true);
				} finally {
					if (previousPath === undefined) delete process.env.PATH;
					else process.env.PATH = previousPath;
				}
				return;
			}
			const fakeBin = join(tempRoot, 'fake-git-bin');
			const fakeGit = join(fakeBin, 'git');
			const marker = join(tempRoot, 'inherited-path-git-ran');
			mkdirSync(fakeBin, { recursive: true });
			writeFileSync(fakeGit, `#!/bin/sh\n: > ${JSON.stringify(marker)}\nexit 97\n`);
			chmodSync(fakeGit, 0o755);

			try {
				process.env.PATH = `${fakeBin}${delimiter}${previousPath ?? ''}`;
				expect(() => getMissionControlFreshness({ repositoryDbRoot: writerB })).toThrow();
			} finally {
				if (previousPath === undefined) delete process.env.PATH;
				else process.env.PATH = previousPath;
			}
			expect(existsSync(marker)).toBe(true);
		});
	});

	test(
		'applies one bounded deadline to bundle creation and import',
		() => {
			for (const operation of ['create', 'unbundle']) {
				withIsolatedFixture(({ tempRoot, writerB }) => {
					const fakeBin = join(tmpdir(), `mission-control-test-git-${process.pid}`);
					const fakeGit = join(fakeBin, 'git');
					rmSync(fakeBin, { recursive: true, force: true });
					mkdirSync(fakeBin, { recursive: true });
					writeFileSync(
						fakeGit,
						[
							'#!/usr/bin/env node',
							"const { spawnSync } = require('node:child_process');",
							'const args = process.argv.slice(2);',
							`if (args.includes("bundle") && args.includes(${JSON.stringify(operation)})) {`,
							'  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);',
							'}',
							`const result = spawnSync(${JSON.stringify(REAL_GIT_EXECUTABLE)}, args, { env: process.env, stdio: "inherit" });`,
							'if (result.error) { console.error(result.error.message); process.exit(99); }',
							'process.exit(result.status ?? 98);',
							'',
						].join('\n'),
					);
					chmodSync(fakeGit, 0o755);

					const releaseTrustedGit = installMissionControlTestGitExecutable(fakeGit);
					try {
						const freshness = getMissionControlFreshness({
							repositoryDbRoot: writerB,
							timeoutMs: 1500,
						});
						expect(freshness.fetch.ok).toBe(false);
						expect(freshness.fetch.timedOut).toBe(true);
						expect(freshness.pullBlockedReason).toBe('fetch_failed');
					} finally {
						releaseTrustedGit();
						rmSync(fakeBin, { recursive: true, force: true });
					}
				});
			}
		},
		process.platform === 'win32' ? 30_000 : 10_000,
	);

	test('rejects checkout-local URL rewrites and upload-pack commands before fetch', () => {
		withIsolatedFixture(({ tempRoot, remote, writerB }) => {
			const marker = join(tempRoot, 'upload-pack-command-ran');
			const uploadPack = join(tempRoot, 'untrusted-upload-pack.sh');
			writeFileSync(uploadPack, `#!/bin/sh\n: > ${JSON.stringify(marker)}\nexit 97\n`);
			chmodSync(uploadPack, 0o755);
			git(writerB, ['config', `url.${remote}.insteadOf`, remote]);
			git(writerB, ['config', 'remote.origin.uploadpack', uploadPack]);

			const freshness = getMissionControlFreshness({
				repositoryDbRoot: writerB,
			});
			expect(freshness.fetch.ok).toBe(false);
			expect(freshness.status.localGitFetchRoutingOverrides).toContain('remote.origin.uploadpack');
			expect(freshness.status.localGitFetchRoutingOverrides).toContain(
				`url.${remote}.insteadof`.toLowerCase(),
			);
			expect(freshness.pullBlockedReason).toBe('fetch_remote_mismatch');
			expect(existsSync(marker)).toBe(false);
		});
	});

	test('rejects checkout-local clean filters before git status can execute them', () => {
		withIsolatedFixture(({ tempRoot, writerB }) => {
			const targetPath = 'data/mission-control/reports/filter-target.txt';
			writeFixtureFile(writerB, '.gitattributes', `${targetPath} filter=untrusted\n`);
			writeFixtureFile(writerB, targetPath, 'tracked\n');
			git(writerB, ['add', '.gitattributes', targetPath]);
			git(writerB, ['commit', '-m', 'add filter target fixture']);

			const marker = join(tempRoot, 'clean-filter-ran');
			const cleanFilter = join(tempRoot, 'untrusted-clean-filter.sh');
			writeFileSync(cleanFilter, `#!/bin/sh\n: > ${JSON.stringify(marker)}\ncat\n`);
			chmodSync(cleanFilter, 0o755);
			git(writerB, ['config', 'filter.untrusted.clean', cleanFilter]);
			writeFixtureFile(writerB, targetPath, 'locally modified\n');

			const freshness = getMissionControlFreshness({
				repositoryDbRoot: writerB,
				fetch: false,
			});
			expect(freshness.status.localGitFetchRoutingOverrides).toContain('filter.untrusted.clean');
			expect(freshness.status.clean).toBe(false);
			expect(freshness.pullBlockedReason).toBe('fetch_remote_mismatch');
			expect(existsSync(marker)).toBe(false);
		});
	});

	test('disables checkout hooks during fast-forward merge', () => {
		withIsolatedFixture(({ tempRoot, writerA, writerB }) => {
			const marker = join(tempRoot, 'post-merge-hook-ran');
			const hookPath = join(writerB, '.git/hooks/post-merge');
			writeFileSync(hookPath, `#!/bin/sh\n: > ${JSON.stringify(marker)}\n`);
			chmodSync(hookPath, 0o755);
			commitAndPushReport(writerA, 'hooks-disabled.txt', 'safe merge');

			const result = pullMissionControlRepository({
				repositoryDbRoot: writerB,
			});
			expect(result.pulled).toBe(true);
			expect(existsSync(marker)).toBe(false);
		});
	});
});
