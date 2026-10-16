import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { detectSymlinkSupport } from '../../../test-support/symlink-support.mjs';

const symlinkTest = detectSymlinkSupport() ? test : test.skip;

const templateRoot = path.resolve(import.meta.dir, '../../..');
const templateDataRoot = path.join(templateRoot, 'templates/organization-data');
const pinnedValidatorRelativePath =
	'templates/organization-data/scripts/validate-mission-control-data.mjs';
const pinnedValidatorPath = path.join(templateRoot, pinnedValidatorRelativePath);
const roadmapsModuleUrl = pathToFileURL(path.resolve(import.meta.dir, '../src/roadmaps.ts')).href;
const missionControlLibraryUrl = pathToFileURL(
	path.resolve(import.meta.dir, '../src/vendor/mission-control-lib.ts'),
).href;

function git(dataRoot: string, ...args: string[]): void {
	const result = spawnSync('git', args, {
		cwd: dataRoot,
		encoding: 'utf8',
	});
	if (result.status !== 0) {
		throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
	}
}

function commitFixture(dataRoot: string, message: string): void {
	git(
		dataRoot,
		'-c',
		'user.name=Mission Control Roadmap Parity',
		'-c',
		'user.email=roadmap-parity@example.invalid',
		'commit',
		'-q',
		'-m',
		message,
	);
}

function useLegacyCapabilityWriter(config: Record<string, any>): void {
	config.publish_policy.writer_mode = 'authenticated-capability-v1';
	delete config.publish_policy.local_principal;
	config.publish_policy.credential_authority = {
		required: true,
		allowed_writer_ids: ['template-data-writer'],
		custody: 'admin-or-steward',
		path_allowlist: ['data/mission-control/**'],
		branch: 'v3',
	};
}

function templateGitOutput(...args: string[]): string {
	const result = spawnSync('git', args, {
		cwd: templateRoot,
		encoding: 'utf8',
	});
	if (result.status !== 0) {
		throw new Error(`template git ${args.join(' ')} failed: ${result.stderr}`);
	}
	return result.stdout.trim();
}

function currentPinnedApplicationEvidence() {
	return {
		repository: 'ExampleOrganization/mission-control',
		commit: templateGitOutput('rev-parse', 'HEAD'),
		validator_path: pinnedValidatorRelativePath,
		validator_digest_sha256: createHash('sha256')
			.update(readFileSync(pinnedValidatorPath))
			.digest('hex'),
		control_plane_tree_sha: templateGitOutput('rev-parse', 'HEAD^{tree}'),
	};
}

function pinnedValidatorEnvironment(): NodeJS.ProcessEnv {
	const environment = { ...process.env };
	for (const key of Object.keys(environment)) {
		const upperKey = key.toUpperCase();
		if (
			[
				'SSH_AUTH_SOCK',
				'SSH_AGENT_PID',
				'GPG_AGENT_INFO',
				'GNUPGHOME',
				'NODE_OPTIONS',
				'NODE_PATH',
				'BUN_OPTIONS',
				'LD_PRELOAD',
				'DYLD_INSERT_LIBRARIES',
				'DYLD_LIBRARY_PATH',
				'GIT_ASKPASS',
				'SSH_ASKPASS',
			].includes(upperKey) ||
			upperKey === 'GIT_CONFIG_COUNT' ||
			/^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(upperKey)
		) {
			delete environment[key];
		}
	}
	return environment;
}

function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
	}
	if (value && typeof value === 'object') {
		const record = value as Record<string, unknown>;
		return `{${Object.keys(record)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
			.join(',')}}`;
	}
	return JSON.stringify(value);
}

function jsonDigest(value: unknown): string {
	return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function writerAuditEvidence(
	principalId: string,
	principalRole: 'user' | 'steward',
	pathAllowlist: string[],
) {
	return {
		schema_version: 'companiesascode.mission_control.writer_audit.v1',
		authorization_id: 'roadmap-parity-writer',
		authorization_source: {
			repository: 'ExampleOrganization/infra',
			commit: 'a'.repeat(40),
			path: 'access/mission-control-runtime-authorization.json',
			blob: 'b'.repeat(40),
			approved_by: 'organization-steward',
			authorization_not_before: '2026-07-19T09:00:00.000Z',
			expires_at: '2026-07-19T11:00:00.000Z',
			approved_at: '2026-07-19T08:30:00.000Z',
			approval_reference: 'infra-pr-roadmap-parity',
			issue_id: 'issue-provider-protection',
			issue_digest_sha256: '1'.repeat(64),
			authorized_data_base_commit: '2'.repeat(40),
			roster: ['organization-admin', 'organization-steward', 'organization-user'],
		},
		transaction: {
			id: 'roadmap-parity-transaction',
			starting_data_commit: '3'.repeat(40),
			starting_data_tree: '4'.repeat(40),
			captured_at: '2026-07-19T09:59:00.000Z',
			capture_evidence_digest_sha256: '5'.repeat(64),
			request_digest_sha256: '6'.repeat(64),
		},
		principal: {
			id: principalId,
			role: principalRole,
		},
		scope: {
			data_repository: 'ExampleOrganization/mission-control-data',
			data_branch: 'v3',
			path_allowlist: pathAllowlist,
			writer_id: 'template-data-writer',
		},
		credential: {
			provider: 'github',
			provider_object_id: 12345,
			provider_title: 'template-data-writer-12345',
			public_fingerprint_sha256: `SHA256:${'A'.repeat(43)}`,
			custody_role: 'steward',
			custodian: 'organization-steward',
			staged_at: '2026-07-19T08:00:00.000Z',
			staging_deadline: '2026-07-19T12:00:00.000Z',
		},
		application: {
			...currentPinnedApplicationEvidence(),
		},
		runtime: {
			os_identity: 'mission-control-runtime',
			os_identity_evidence: 'dedicated-os-account',
			git_config_allowlist_version: 'mission-control-runtime-git-config.v1',
			git_local_config_digest_sha256: 'f'.repeat(64),
			activation_receipt_digest_sha256: '0'.repeat(64),
		},
	};
}

function authenticatedPublishedEvidenceChangeset(operation: {
	action: 'write_file';
	path: string;
	content: string;
}) {
	const creationAuthorization = writerAuditEvidence('organization-user', 'user', [
		'data/mission-control/reports/**',
	]);
	const stewardAuthorization = writerAuditEvidence('organization-steward', 'steward', [
		'data/mission-control/reports/**',
	]);
	const changeset = {
		schema_version: 'companiesascode.mission_control.changeset.v1',
		id: 'atomic-roadmap-evidence',
		status: 'published',
		summary: 'Atomic roadmap evidence',
		created_at: '2026-07-19T10:00:00.000Z',
		created_by: 'organization-user',
		creation_authorization: creationAuthorization,
		operations: [operation],
		approval: {
			approved_at: '2026-07-19T10:01:00.000Z',
			approved_by: 'organization-steward',
			role: 'steward',
			runtime_authorization: stewardAuthorization,
		},
		published_at: '2026-07-19T10:02:00.000Z',
		published_by: 'organization-steward',
		credential_authority: {
			writer_id: 'template-data-writer',
			custody_role: 'steward',
			branch: 'v3',
			path_allowlist: ['data/mission-control/reports/**'],
		},
		runtime_authorization: stewardAuthorization,
	};
	return {
		...changeset,
		writer_audit_provenance: {
			schema_version: 'companiesascode.mission_control.writer_provenance.v1',
			mode: 'authenticated',
			changeset_id: changeset.id,
			first_authenticated_phase: 'creation',
			authorization_id: creationAuthorization.authorization_id,
			authorization_source_commit: creationAuthorization.authorization_source.commit,
			authorization_source_blob: creationAuthorization.authorization_source.blob,
			first_authorization_digest_sha256: jsonDigest(creationAuthorization),
			changeset_payload_digest_sha256: jsonDigest({
				schema_version: changeset.schema_version,
				id: changeset.id,
				summary: changeset.summary,
				created_at: changeset.created_at,
				created_by: changeset.created_by,
				operations: changeset.operations,
			}),
			recorded_at: changeset.created_at,
		},
	};
}

describe('Mission Control roadmap validator parity', () => {
	test('API and standalone validator both reject untracked evidence and credential-bearing links', () => {
		const tempRoot = mkdtempSync(path.join(tmpdir(), 'mission-control-roadmap-parity-'));
		const dataRoot = path.join(tempRoot, 'mission-control-data');
		try {
			cpSync(templateDataRoot, dataRoot, { recursive: true });
			const configPath = path.join(dataRoot, 'data/mission-control/mission-control.config.json');
			const config = JSON.parse(readFileSync(configPath, 'utf8'));
			config.organization_admin = 'organization-steward';
			useLegacyCapabilityWriter(config);
			writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
			const repositoryDbPath = path.join(dataRoot, 'repository-db.yaml');
			writeFileSync(
				repositoryDbPath,
				readFileSync(repositoryDbPath, 'utf8').replace(
					'git@github.com:REPLACE_WITH_ORG/mission-control-data.git',
					'git@github.com:ExampleOrganization/mission-control-data.git',
				),
			);
			git(dataRoot, 'init', '-q');
			git(dataRoot, 'add', '.');

			const roadmapPath = path.join(
				dataRoot,
				'data/mission-control/roadmaps/2026/RM-0001-template-runtime.yaml',
			);
			const roadmap = parseYaml(readFileSync(roadmapPath, 'utf8'));
			roadmap.summary = '   ';
			roadmap.steps[0].evidence_refs[0].path = 'untracked-evidence.md';
			roadmap.links = [
				{
					label: 'Credential hidden in a nested relative target',
					url: 'https://example.invalid/proof?next=%2Fcallback%3Faccess_token%3Dsecret',
				},
				{
					label: 'Credential hidden in hostname',
					url: 'https://ghp_abcdef.example.invalid/proof',
				},
				{
					label: 'Credential hidden behind repeated encoding',
					url: 'https://example.invalid/proof?next=%2525252Fcallback%2525253Faccess_token%2525253Dsecret',
				},
				{
					label: 'Credential hidden in an encoded parameter name',
					url: 'https://example.invalid/proof?access_%2574oken=secret',
				},
				{
					label: 'Credential parameter hidden in path',
					url: 'https://example.invalid/proof/access_token=secret',
				},
				{
					label: 'Case-sensitive credential hidden in hostname',
					url: 'https://AKIAABCDEFGHIJKLMNOP.example.invalid/proof', // gitleaks:allow (synthetic fixture)
				},
				{
					label: 'Credential-bearing nested URL hidden in fragment',
					url: 'https://example.invalid/#https://user:secret@inner.invalid/',
				},
				{
					label: 'Credential-bearing nested URL hidden in path',
					url: 'https://example.invalid/proof/https%3A%2F%2Fuser%3Asecret%40inner.invalid%2F',
				},
				{
					label: 'Serialized authorization header hidden in query',
					url: 'https://example.invalid/?header=Authorization%3A%20Bearer%20opaque-secret-value',
				},
				{
					label: 'Credential key hidden in a serialized JSON query value',
					url: 'https://example.invalid/callback?state=%7B%22access_token%22%3A%22secret-value%22%7D',
				},
				{
					label: 'Credential prefix hidden before malformed percent encoding',
					url: 'https://example.invalid/%67hp_abcdef%ZZ',
				},
				{
					label: 'Case-insensitive Git metadata path',
					path: '.GIT/config',
				},
			];
			writeFileSync(roadmapPath, stringifyYaml(roadmap));
			writeFileSync(path.join(dataRoot, 'untracked-evidence.md'), '# Local-only evidence\n');

			const standalone = spawnSync(
				process.execPath,
				['scripts/validate-mission-control-data.mjs'],
				{ cwd: dataRoot, encoding: 'utf8' },
			);
			expect(standalone.status).not.toBe(0);
			const standaloneOutput = `${standalone.stdout}\n${standalone.stderr}`;
			expect(standaloneOutput).toContain('credential-free external http(s) URL');
			expect(standaloneOutput).toContain('Git-tracked or staged file');
			expect(standaloneOutput).toContain('summary must contain a non-whitespace character');

			const apiProbe = Bun.spawnSync({
				cmd: [
					process.execPath,
					'--eval',
					`const { buildRoadmapsResponse } = await import(${JSON.stringify(roadmapsModuleUrl)}); console.log(JSON.stringify(buildRoadmapsResponse()));`,
				],
				env: {
					...process.env,
					MISSION_CONTROL_ROOT: dataRoot,
					MISSION_CONTROL_WORKSPACE_ROOT: tempRoot,
				},
				stdout: 'pipe',
				stderr: 'pipe',
			});
			expect(new TextDecoder().decode(apiProbe.stderr)).toBe('');
			expect(apiProbe.exitCode).toBe(0);
			const payload = JSON.parse(new TextDecoder().decode(apiProbe.stdout)) as {
				validation: { ok: boolean; failures: string[] };
			};
			expect(payload.validation.ok).toBe(false);
			expect(payload.validation.failures.some((failure) => failure.includes('chybí summary'))).toBe(
				true,
			);
			expect(
				payload.validation.failures.some((failure) => failure.includes('credential-free')),
			).toBe(true);
			expect(
				payload.validation.failures.some(
					(failure) => failure.includes('links[2].url') && failure.includes('credential-free'),
				),
			).toBe(true);
			expect(
				payload.validation.failures.some(
					(failure) => failure.includes('links[3].url') && failure.includes('credential-free'),
				),
			).toBe(true);
			expect(
				payload.validation.failures.some(
					(failure) => failure.includes('links[4].url') && failure.includes('credential-free'),
				),
			).toBe(true);
			expect(
				payload.validation.failures.some(
					(failure) => failure.includes('links[5].url') && failure.includes('credential-free'),
				),
			).toBe(true);
			expect(
				payload.validation.failures.some(
					(failure) => failure.includes('links[6].url') && failure.includes('credential-free'),
				),
			).toBe(true);
			expect(
				payload.validation.failures.some(
					(failure) => failure.includes('links[7].url') && failure.includes('credential-free'),
				),
			).toBe(true);
			expect(
				payload.validation.failures.some(
					(failure) => failure.includes('links[8].url') && failure.includes('credential-free'),
				),
			).toBe(true);
			expect(
				payload.validation.failures.some(
					(failure) => failure.includes('links[9].url') && failure.includes('credential-free'),
				),
			).toBe(true);
			expect(
				payload.validation.failures.some(
					(failure) => failure.includes('links[10].url') && failure.includes('credential-free'),
				),
			).toBe(true);
			expect(
				payload.validation.failures.some(
					(failure) =>
						failure.includes('links[11].path') && failure.includes('portable repo-relative'),
				),
			).toBe(true);
			expect(
				payload.validation.failures.some((failure) => failure.includes('git-tracked repo soubor')),
			).toBe(true);
		} finally {
			rmSync(tempRoot, { recursive: true, force: true });
		}
	});

	test('API and standalone validator accept hash characters inside YAML block scalars', () => {
		const tempRoot = mkdtempSync(path.join(tmpdir(), 'mission-control-roadmap-block-scalar-'));
		const dataRoot = path.join(tempRoot, 'mission-control-data');
		try {
			cpSync(templateDataRoot, dataRoot, { recursive: true });
			const configPath = path.join(dataRoot, 'data/mission-control/mission-control.config.json');
			const config = JSON.parse(readFileSync(configPath, 'utf8'));
			config.organization_admin = 'organization-steward';
			useLegacyCapabilityWriter(config);
			writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
			const repositoryDbPath = path.join(dataRoot, 'repository-db.yaml');
			writeFileSync(
				repositoryDbPath,
				readFileSync(repositoryDbPath, 'utf8').replace(
					'git@github.com:REPLACE_WITH_ORG/mission-control-data.git',
					'git@github.com:ExampleOrganization/mission-control-data.git',
				),
			);
			const roadmapPath = path.join(
				dataRoot,
				'data/mission-control/roadmaps/2026/RM-0001-template-runtime.yaml',
			);
			writeFileSync(
				roadmapPath,
				readFileSync(roadmapPath, 'utf8').replace(
					/^summary:.*(?:\n {2}.*)+/m,
					'summary: |\n  Release notes remain Markdown.\n  label: release #1',
				),
			);
			git(dataRoot, 'init', '-q');
			git(dataRoot, 'add', '.');
			commitFixture(dataRoot, 'initialize hash-scalar data fixture');
			const untrustedGitMetadata = path.join(tempRoot, 'untrusted-git-metadata');
			const poisonedEnvironment = {
				...process.env,
				Git_Dir: untrustedGitMetadata,
				git_index_file: path.join(untrustedGitMetadata, 'forged-index'),
			};

			const standalone = spawnSync(
				process.execPath,
				['scripts/validate-mission-control-data.mjs'],
				{
					cwd: dataRoot,
					encoding: 'utf8',
					env: poisonedEnvironment,
				},
			);
			expect(standalone.stderr).toBe('');
			expect(standalone.stdout).toContain('Mission Control data validation OK');
			expect(standalone.status).toBe(0);

			const apiProbe = Bun.spawnSync({
				cmd: [
					process.execPath,
					'--eval',
					`const { buildRoadmapsResponse } = await import(${JSON.stringify(roadmapsModuleUrl)}); console.log(JSON.stringify(buildRoadmapsResponse()));`,
				],
				env: {
					...poisonedEnvironment,
					MISSION_CONTROL_ROOT: dataRoot,
					MISSION_CONTROL_WORKSPACE_ROOT: tempRoot,
				},
				stdout: 'pipe',
				stderr: 'pipe',
			});
			expect(new TextDecoder().decode(apiProbe.stderr)).toBe('');
			expect(apiProbe.exitCode).toBe(0);
			const payload = JSON.parse(new TextDecoder().decode(apiProbe.stdout)) as {
				roadmaps: unknown[];
				validation: { ok: boolean; failures: string[] };
			};
			expect(payload.roadmaps).toHaveLength(1);
			expect(payload.validation).toEqual({ ok: true, failures: [] });
		} finally {
			rmSync(tempRoot, { recursive: true, force: true });
		}
	});

	test('API and standalone validator reject forged published evidence and accept the staged atomic publish', () => {
		const tempRoot = mkdtempSync(path.join(tmpdir(), 'mission-control-roadmap-staging-'));
		const dataRoot = path.join(tempRoot, 'mission-control-data');
		try {
			cpSync(templateDataRoot, dataRoot, { recursive: true });
			const configPath = path.join(dataRoot, 'data/mission-control/mission-control.config.json');
			const config = JSON.parse(readFileSync(configPath, 'utf8'));
			config.organization_admin = 'organization-steward';
			useLegacyCapabilityWriter(config);
			writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
			const repositoryDbPath = path.join(dataRoot, 'repository-db.yaml');
			writeFileSync(
				repositoryDbPath,
				readFileSync(repositoryDbPath, 'utf8').replace(
					'git@github.com:REPLACE_WITH_ORG/mission-control-data.git',
					'git@github.com:ExampleOrganization/mission-control-data.git',
				),
			);
			git(dataRoot, 'init', '-q');
			git(dataRoot, 'add', '.');
			commitFixture(dataRoot, 'initialize staged-publish data fixture');

			const evidencePath = 'data/mission-control/reports/atomic-evidence.md';
			const evidenceContent = '# Atomic evidence\n';
			const roadmapRelativePath =
				'data/mission-control/roadmaps/2026/RM-0001-template-runtime.yaml';
			const publishedRelativePath =
				'data/mission-control/changesets/published/atomic-roadmap-evidence.json';
			const roadmapPath = path.join(dataRoot, roadmapRelativePath);
			const roadmap = parseYaml(readFileSync(roadmapPath, 'utf8'));
			roadmap.steps[0].evidence_refs[0].path = evidencePath;
			writeFileSync(roadmapPath, stringifyYaml(roadmap));
			writeFileSync(path.join(dataRoot, evidencePath), evidenceContent);
			const publishedChangeset = authenticatedPublishedEvidenceChangeset({
				action: 'write_file',
				path: evidencePath,
				content: evidenceContent,
			});
			writeFileSync(
				path.join(dataRoot, publishedRelativePath),
				`${JSON.stringify(publishedChangeset, null, 2)}\n`,
			);

			const forgedStandalone = spawnSync(
				process.execPath,
				[pinnedValidatorPath, '--pinned-app-code'],
				{
					cwd: dataRoot,
					encoding: 'utf8',
					env: pinnedValidatorEnvironment(),
				},
			);
			expect(forgedStandalone.status).not.toBe(0);
			expect(`${forgedStandalone.stdout}\n${forgedStandalone.stderr}`).toContain(
				'Git-tracked or staged file',
			);

			const forgedApiProbe = Bun.spawnSync({
				cmd: [
					process.execPath,
					'--eval',
					`const { buildRoadmapsResponse } = await import(${JSON.stringify(roadmapsModuleUrl)}); console.log(JSON.stringify(buildRoadmapsResponse()));`,
				],
				env: {
					...process.env,
					MISSION_CONTROL_ROOT: dataRoot,
					MISSION_CONTROL_WORKSPACE_ROOT: tempRoot,
				},
				stdout: 'pipe',
				stderr: 'pipe',
			});
			expect(new TextDecoder().decode(forgedApiProbe.stderr)).toBe('');
			expect(forgedApiProbe.exitCode).toBe(0);
			const forgedPayload = JSON.parse(new TextDecoder().decode(forgedApiProbe.stdout)) as {
				validation: { ok: boolean; failures: string[] };
			};
			expect(forgedPayload.validation.ok).toBe(false);
			expect(
				forgedPayload.validation.failures.some((failure) =>
					failure.includes('git-tracked repo soubor'),
				),
			).toBe(true);

			git(dataRoot, 'add', '--', roadmapRelativePath, evidencePath, publishedRelativePath);

			const standalone = spawnSync(process.execPath, [pinnedValidatorPath, '--pinned-app-code'], {
				cwd: dataRoot,
				encoding: 'utf8',
				env: pinnedValidatorEnvironment(),
			});
			expect(standalone.status).toBe(0);

			const apiProbe = Bun.spawnSync({
				cmd: [
					process.execPath,
					'--eval',
					`const { buildRoadmapsResponse } = await import(${JSON.stringify(roadmapsModuleUrl)}); console.log(JSON.stringify(buildRoadmapsResponse()));`,
				],
				env: {
					...process.env,
					MISSION_CONTROL_ROOT: dataRoot,
					MISSION_CONTROL_WORKSPACE_ROOT: tempRoot,
				},
				stdout: 'pipe',
				stderr: 'pipe',
			});
			expect(new TextDecoder().decode(apiProbe.stderr)).toBe('');
			expect(apiProbe.exitCode).toBe(0);
			const payload = JSON.parse(new TextDecoder().decode(apiProbe.stdout)) as {
				roadmaps: unknown[];
				validation: { ok: boolean; failures: string[] };
			};
			expect(payload.roadmaps).toHaveLength(1);
			expect(payload.validation).toEqual({ ok: true, failures: [] });
		} finally {
			rmSync(tempRoot, { recursive: true, force: true });
		}
	});

	symlinkTest('API and standalone validator both reject a symlinked roadmap root', () => {
		const tempRoot = mkdtempSync(path.join(tmpdir(), 'mission-control-roadmap-symlink-'));
		const dataRoot = path.join(tempRoot, 'mission-control-data');
		try {
			cpSync(templateDataRoot, dataRoot, { recursive: true });
			const roadmapsRoot = path.join(dataRoot, 'data/mission-control/roadmaps');
			const externalRoadmapsRoot = path.join(tempRoot, 'external-roadmaps');
			renameSync(roadmapsRoot, externalRoadmapsRoot);
			symlinkSync(
				externalRoadmapsRoot,
				roadmapsRoot,
				process.platform === 'win32' ? 'junction' : 'dir',
			);

			const standalone = spawnSync(
				process.execPath,
				['scripts/validate-mission-control-data.mjs'],
				{ cwd: dataRoot, encoding: 'utf8' },
			);
			expect(standalone.status).not.toBe(0);
			expect(`${standalone.stdout}\n${standalone.stderr}`).toContain(
				'roadmaps_dir must be a real directory inside the data repository',
			);

			const apiProbe = Bun.spawnSync({
				cmd: [
					process.execPath,
					'--eval',
					`const { buildRoadmapsResponse } = await import(${JSON.stringify(roadmapsModuleUrl)}); console.log(JSON.stringify(buildRoadmapsResponse()));`,
				],
				env: {
					...process.env,
					MISSION_CONTROL_ROOT: dataRoot,
					MISSION_CONTROL_WORKSPACE_ROOT: tempRoot,
				},
				stdout: 'pipe',
				stderr: 'pipe',
			});
			expect(new TextDecoder().decode(apiProbe.stderr)).toBe('');
			expect(apiProbe.exitCode).toBe(0);
			const payload = JSON.parse(new TextDecoder().decode(apiProbe.stdout)) as {
				roadmaps: unknown[];
				validation: { ok: boolean; failures: string[] };
			};
			expect(payload.roadmaps).toHaveLength(0);
			expect(payload.validation.ok).toBe(false);
			expect(
				payload.validation.failures.some((failure) =>
					failure.includes('roadmaps_dir musí být skutečný adresář bez symlinků'),
				),
			).toBe(true);
		} finally {
			rmSync(tempRoot, { recursive: true, force: true });
		}
	});

	symlinkTest(
		'API and standalone validator reject a symlinked plan root without traversing it',
		() => {
			const tempRoot = mkdtempSync(path.join(tmpdir(), 'mission-control-plan-symlink-'));
			const dataRoot = path.join(tempRoot, 'mission-control-data');
			try {
				cpSync(templateDataRoot, dataRoot, { recursive: true });
				const plansRoot = path.join(dataRoot, 'data/mission-control/plans');
				const externalPlansRoot = path.join(tempRoot, 'external-plans');
				renameSync(plansRoot, externalPlansRoot);
				writeFileSync(path.join(externalPlansRoot, 'must-not-be-read.yaml'), 'invalid: [\n');
				symlinkSync(
					externalPlansRoot,
					plansRoot,
					process.platform === 'win32' ? 'junction' : 'dir',
				);

				const standalone = spawnSync(
					process.execPath,
					['scripts/validate-mission-control-data.mjs'],
					{ cwd: dataRoot, encoding: 'utf8' },
				);
				expect(standalone.status).not.toBe(0);
				const standaloneOutput = `${standalone.stdout}\n${standalone.stderr}`;
				expect(standaloneOutput).toContain(
					'directory data/mission-control/plans must be a real directory inside the data repository',
				);
				expect(standaloneOutput).not.toContain('must-not-be-read.yaml');

				const apiProbe = Bun.spawnSync({
					cmd: [
						process.execPath,
						'--eval',
						`const { buildRoadmapsResponse } = await import(${JSON.stringify(roadmapsModuleUrl)}); console.log(JSON.stringify(buildRoadmapsResponse()));`,
					],
					env: {
						...process.env,
						MISSION_CONTROL_ROOT: dataRoot,
						MISSION_CONTROL_WORKSPACE_ROOT: tempRoot,
					},
					stdout: 'pipe',
					stderr: 'pipe',
				});
				expect(new TextDecoder().decode(apiProbe.stderr)).toBe('');
				expect(apiProbe.exitCode).toBe(0);
				const payload = JSON.parse(new TextDecoder().decode(apiProbe.stdout)) as {
					validation: { ok: boolean; failures: string[] };
				};
				expect(payload.validation.ok).toBe(false);
				expect(
					payload.validation.failures.some((failure) =>
						failure.includes('plans_dir musí být skutečný adresář bez symlinků'),
					),
				).toBe(true);
				expect(
					payload.validation.failures.some((failure) => failure.includes('must-not-be-read.yaml')),
				).toBe(false);
			} finally {
				rmSync(tempRoot, { recursive: true, force: true });
			}
		},
	);

	test('legacy plan-only workspaces keep an absent roadmap directory as an empty collection', () => {
		const tempRoot = mkdtempSync(path.join(tmpdir(), 'mission-control-roadmap-legacy-'));
		try {
			const probe = Bun.spawnSync({
				cmd: [
					process.execPath,
					'--eval',
					`const { loadRoadmaps } = await import(${JSON.stringify(missionControlLibraryUrl)}); console.log(JSON.stringify(loadRoadmaps(${JSON.stringify(tempRoot)}, {})));`,
				],
				stdout: 'pipe',
				stderr: 'pipe',
			});
			expect(new TextDecoder().decode(probe.stderr)).toBe('');
			expect(probe.exitCode).toBe(0);
			expect(JSON.parse(new TextDecoder().decode(probe.stdout))).toEqual([]);
		} finally {
			rmSync(tempRoot, { recursive: true, force: true });
		}
	});

	test('API and standalone validator share manifest-aware missing planning targets', () => {
		const tempRoot = mkdtempSync(path.join(tmpdir(), 'mission-control-planning-target-'));
		const dataRoot = path.join(tempRoot, 'mission-control-data');
		try {
			cpSync(templateDataRoot, dataRoot, { recursive: true });
			const configPath = path.join(dataRoot, 'data/mission-control/mission-control.config.json');
			const config = JSON.parse(readFileSync(configPath, 'utf8'));
			config.organization_admin = 'organization-steward';
			useLegacyCapabilityWriter(config);
			writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
			const repositoryDbPath = path.join(dataRoot, 'repository-db.yaml');
			writeFileSync(
				repositoryDbPath,
				readFileSync(repositoryDbPath, 'utf8').replace(
					'git@github.com:REPLACE_WITH_ORG/mission-control-data.git',
					'git@github.com:ExampleOrganization/mission-control-data.git',
				),
			);
			const planPath = path.join(
				dataRoot,
				'data/mission-control/plans/2026/01/DEV-0001-template-runtime.yaml',
			);
			writeFileSync(
				planPath,
				readFileSync(planPath, 'utf8').replace(
					'todo_tasks_path: data/mission-control/TODO.tasks.json',
					'todo_tasks_path: productionspace/monorepo/TODO.tasks.json',
				),
			);
			git(dataRoot, 'init', '-q');
			git(dataRoot, 'add', '.');
			commitFixture(dataRoot, 'initialize planning-target parity fixture');

			const validate = (withWorkspaceRoot = true) => {
				const environment = {
					...pinnedValidatorEnvironment(),
					MISSION_CONTROL_ROOT: dataRoot,
				};
				delete environment.MISSION_CONTROL_WORKSPACE_ROOT;
				if (withWorkspaceRoot) environment.MISSION_CONTROL_WORKSPACE_ROOT = tempRoot;
				const standalone = spawnSync(
					process.execPath,
					['scripts/validate-mission-control-data.mjs'],
					{ cwd: dataRoot, encoding: 'utf8', env: environment },
				);
				const apiProbe = Bun.spawnSync({
					cmd: [
						process.execPath,
						'--eval',
						`const { buildRoadmapsResponse } = await import(${JSON.stringify(roadmapsModuleUrl)}); console.log(JSON.stringify(buildRoadmapsResponse()));`,
					],
					env: environment,
					stdout: 'pipe',
					stderr: 'pipe',
				});
				const payload = JSON.parse(new TextDecoder().decode(apiProbe.stdout)) as {
					validation: { ok: boolean; failures: string[] };
				};
				return { standalone, apiProbe, payload };
			};

			writeFileSync(
				path.join(tempRoot, 'modules.manifest.json'),
				`${JSON.stringify(
					{
						module_slots: [
							{
								path: 'productionspace/monorepo',
								default_access: 'role_based',
								git: { url: 'git@github.com:ExampleOrganization/monorepo.git' },
							},
						],
					},
					null,
					2,
				)}\n`,
			);
			const allowed = validate();
			expect(allowed.standalone.status).toBe(0);
			expect(allowed.apiProbe.exitCode).toBe(0);
			expect(allowed.payload.validation).toEqual({ ok: true, failures: [] });
			const implicitAppRoot = validate(false);
			expect(implicitAppRoot.standalone.status).not.toBe(0);
			expect(
				`${implicitAppRoot.standalone.stdout}\n${implicitAppRoot.standalone.stderr}`,
			).toContain('requires MISSION_CONTROL_WORKSPACE_ROOT');
			expect(implicitAppRoot.apiProbe.exitCode).toBe(0);
			expect(implicitAppRoot.payload.validation).toEqual({ ok: true, failures: [] });

			writeFileSync(
				path.join(tempRoot, 'modules.manifest.json'),
				`${JSON.stringify(
					{
						module_slots: [
							{
								path: 'productionspace/monorepo',
								default_access: 'expected',
								git: { url: 'git@github.com:ExampleOrganization/monorepo.git' },
							},
						],
					},
					null,
					2,
				)}\n`,
			);
			const required = validate();
			expect(required.standalone.status).not.toBe(0);
			expect(`${required.standalone.stdout}\n${required.standalone.stderr}`).toContain(
				'planning_target.todo_tasks_path does not exist',
			);
			expect(required.apiProbe.exitCode).toBe(0);
			expect(required.payload.validation.ok).toBe(false);
			expect(
				required.payload.validation.failures.some((failure) =>
					failure.includes('planning_target.todo_tasks_path neexistuje'),
				),
			).toBe(true);

			writeFileSync(
				planPath,
				readFileSync(planPath, 'utf8').replace(
					'todo_tasks_path: productionspace/monorepo/TODO.tasks.json',
					'todo_tasks_path: modules/legacy/TODO.tasks.json',
				),
			);
			git(dataRoot, 'add', '.');
			commitFixture(dataRoot, 'exercise legacy module planning-target parity');
			const legacyModule = validate();
			expect(legacyModule.standalone.status).toBe(0);
			expect(legacyModule.apiProbe.exitCode).toBe(0);
			expect(legacyModule.payload.validation).toEqual({ ok: true, failures: [] });
		} finally {
			rmSync(tempRoot, { recursive: true, force: true });
		}
	});

	test('API and standalone validator both reject a missing roadmap root', () => {
		const tempRoot = mkdtempSync(path.join(tmpdir(), 'mission-control-roadmap-missing-'));
		const dataRoot = path.join(tempRoot, 'mission-control-data');
		try {
			cpSync(templateDataRoot, dataRoot, { recursive: true });
			rmSync(path.join(dataRoot, 'data/mission-control/roadmaps'), {
				recursive: true,
				force: true,
			});

			const standalone = spawnSync(
				process.execPath,
				['scripts/validate-mission-control-data.mjs'],
				{ cwd: dataRoot, encoding: 'utf8' },
			);
			expect(standalone.status).not.toBe(0);
			expect(`${standalone.stdout}\n${standalone.stderr}`).toContain(
				'missing directory data/mission-control/roadmaps',
			);

			const apiProbe = Bun.spawnSync({
				cmd: [
					process.execPath,
					'--eval',
					`const { buildRoadmapsResponse } = await import(${JSON.stringify(roadmapsModuleUrl)}); console.log(JSON.stringify(buildRoadmapsResponse()));`,
				],
				env: {
					...process.env,
					MISSION_CONTROL_ROOT: dataRoot,
					MISSION_CONTROL_WORKSPACE_ROOT: tempRoot,
				},
				stdout: 'pipe',
				stderr: 'pipe',
			});
			expect(new TextDecoder().decode(apiProbe.stderr)).toBe('');
			expect(apiProbe.exitCode).toBe(0);
			const payload = JSON.parse(new TextDecoder().decode(apiProbe.stdout)) as {
				roadmaps: unknown[];
				validation: { ok: boolean; failures: string[] };
			};
			expect(payload.roadmaps).toHaveLength(0);
			expect(payload.validation.ok).toBe(false);
			expect(
				payload.validation.failures.some((failure) => failure.includes('roadmaps_dir neexistuje')),
			).toBe(true);
		} finally {
			rmSync(tempRoot, { recursive: true, force: true });
		}
	});

	symlinkTest('API and standalone validator both reject nested roadmap symlinks', () => {
		const tempRoot = mkdtempSync(path.join(tmpdir(), 'mission-control-roadmap-nested-symlink-'));
		const dataRoot = path.join(tempRoot, 'mission-control-data');
		try {
			cpSync(templateDataRoot, dataRoot, { recursive: true });
			const roadmapYearRoot = path.join(dataRoot, 'data/mission-control/roadmaps/2026');
			const externalRoadmapYearRoot = path.join(tempRoot, 'external-roadmap-year');
			renameSync(roadmapYearRoot, externalRoadmapYearRoot);
			symlinkSync(
				externalRoadmapYearRoot,
				roadmapYearRoot,
				process.platform === 'win32' ? 'junction' : 'dir',
			);

			const standalone = spawnSync(
				process.execPath,
				['scripts/validate-mission-control-data.mjs'],
				{ cwd: dataRoot, encoding: 'utf8' },
			);
			expect(standalone.status).not.toBe(0);
			expect(`${standalone.stdout}\n${standalone.stderr}`).toContain(
				'roadmaps/2026: YAML source tree must not contain symlinks',
			);

			const apiProbe = Bun.spawnSync({
				cmd: [
					process.execPath,
					'--eval',
					`const { buildRoadmapsResponse } = await import(${JSON.stringify(roadmapsModuleUrl)}); console.log(JSON.stringify(buildRoadmapsResponse()));`,
				],
				env: {
					...process.env,
					MISSION_CONTROL_ROOT: dataRoot,
					MISSION_CONTROL_WORKSPACE_ROOT: tempRoot,
				},
				stdout: 'pipe',
				stderr: 'pipe',
			});
			expect(new TextDecoder().decode(apiProbe.stderr)).toBe('');
			expect(apiProbe.exitCode).toBe(0);
			const payload = JSON.parse(new TextDecoder().decode(apiProbe.stdout)) as {
				roadmaps: unknown[];
				validation: { ok: boolean; failures: string[] };
			};
			expect(payload.roadmaps).toHaveLength(0);
			expect(payload.validation.ok).toBe(false);
			expect(
				payload.validation.failures.some(
					(failure) =>
						failure.includes('roadmaps/2026') &&
						failure.includes('YAML source tree nesmí obsahovat symlinky'),
				),
			).toBe(true);
		} finally {
			rmSync(tempRoot, { recursive: true, force: true });
		}
	});

	test('API and standalone validator both enforce the strict incident addendum', () => {
		const tempRoot = mkdtempSync(path.join(tmpdir(), 'mission-control-incident-addendum-'));
		const dataRoot = path.join(tempRoot, 'mission-control-data');
		try {
			cpSync(templateDataRoot, dataRoot, { recursive: true });
			const planPath = path.join(
				dataRoot,
				'data/mission-control/plans/2026/01/DEV-0001-template-runtime.yaml',
			);
			const plan = parseYaml(readFileSync(planPath, 'utf8'));
			plan.incident_addendum = {
				reported_at: '2026-07-29T08:47:00+02:00',
				reporter: 'organization-user',
				authorization: 'The Organization owner authorized a bounded recovery.',
				observed_state: 'The hosted writer stopped before creating a commit.',
				private_runtime_path: '/private/host/path',
			};
			writeFileSync(planPath, stringifyYaml(plan));

			const standalone = spawnSync(
				process.execPath,
				['scripts/validate-mission-control-data.mjs'],
				{ cwd: dataRoot, encoding: 'utf8' },
			);
			expect(standalone.status).not.toBe(0);
			expect(`${standalone.stdout}\n${standalone.stderr}`).toContain(
				'must NOT have additional properties',
			);

			const apiProbe = Bun.spawnSync({
				cmd: [
					process.execPath,
					'--eval',
					`const { buildRoadmapsResponse } = await import(${JSON.stringify(roadmapsModuleUrl)}); console.log(JSON.stringify(buildRoadmapsResponse()));`,
				],
				env: {
					...process.env,
					MISSION_CONTROL_ROOT: dataRoot,
					MISSION_CONTROL_WORKSPACE_ROOT: tempRoot,
				},
				stdout: 'pipe',
				stderr: 'pipe',
			});
			expect(new TextDecoder().decode(apiProbe.stderr)).toBe('');
			expect(apiProbe.exitCode).toBe(0);
			const payload = JSON.parse(new TextDecoder().decode(apiProbe.stdout)) as {
				validation: { ok: boolean; failures: string[] };
			};
			expect(payload.validation.ok).toBe(false);
			expect(
				payload.validation.failures.some((failure) => failure.includes('incident_addendum')),
			).toBe(true);
		} finally {
			rmSync(tempRoot, { recursive: true, force: true });
		}
	});

	test('API and standalone validator share schema scalar semantics', () => {
		const cases: Array<{
			label: string;
			mutate: (plan: Record<string, any>) => void;
			valid: boolean;
		}> = [
			{
				label: 'whitespace legacy custom id',
				mutate: (plan) => {
					plan.legacy_sources = {
						clickup: {
							task_id: 'generic-task-id',
							custom_id: ' ',
							url: 'https://example.invalid/tasks/generic-task-id',
						},
					};
				},
				valid: false,
			},
			{
				label: 'non-string legacy custom id',
				mutate: (plan) => {
					plan.legacy_sources = {
						clickup: {
							task_id: 'generic-task-id',
							custom_id: 56,
							url: 'https://example.invalid/tasks/generic-task-id',
						},
					};
				},
				valid: false,
			},
			{
				label: 'whitespace incident fields',
				mutate: (plan) => {
					plan.incident_addendum = {
						reported_at: ' ',
						reporter: ' ',
						authorization: ' ',
						observed_state: ' ',
					};
				},
				valid: true,
			},
			{
				label: 'non-string incident field',
				mutate: (plan) => {
					plan.incident_addendum = {
						reported_at: 56,
						reporter: 'organization-user',
						authorization: 'The Organization owner authorized a bounded recovery.',
						observed_state: 'The hosted writer stopped before creating a commit.',
					};
				},
				valid: false,
			},
		];

		for (const testCase of cases) {
			const tempRoot = mkdtempSync(path.join(tmpdir(), 'mission-control-schema-scalars-'));
			const dataRoot = path.join(tempRoot, 'mission-control-data');
			try {
				cpSync(templateDataRoot, dataRoot, { recursive: true });
				const configPath = path.join(dataRoot, 'data/mission-control/mission-control.config.json');
				const config = JSON.parse(readFileSync(configPath, 'utf8'));
				config.organization_admin = 'organization-steward';
				useLegacyCapabilityWriter(config);
				writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
				const repositoryDbPath = path.join(dataRoot, 'repository-db.yaml');
				writeFileSync(
					repositoryDbPath,
					readFileSync(repositoryDbPath, 'utf8').replace(
						'git@github.com:REPLACE_WITH_ORG/mission-control-data.git',
						'git@github.com:ExampleOrganization/mission-control-data.git',
					),
				);
				git(dataRoot, 'init', '-q');
				git(dataRoot, 'add', '.');
				commitFixture(dataRoot, 'Initialize scalar parity fixture');
				const planPath = path.join(
					dataRoot,
					'data/mission-control/plans/2026/01/DEV-0001-template-runtime.yaml',
				);
				const plan = parseYaml(readFileSync(planPath, 'utf8'));
				testCase.mutate(plan);
				writeFileSync(planPath, stringifyYaml(plan));

				const standalone = spawnSync(
					process.execPath,
					['scripts/validate-mission-control-data.mjs'],
					{ cwd: dataRoot, encoding: 'utf8' },
				);
				expect(
					standalone.status === 0,
					`${testCase.label}\n${standalone.stdout}\n${standalone.stderr}`,
				).toBe(testCase.valid);

				const apiProbe = Bun.spawnSync({
					cmd: [
						process.execPath,
						'--eval',
						`const { buildRoadmapsResponse } = await import(${JSON.stringify(roadmapsModuleUrl)}); console.log(JSON.stringify(buildRoadmapsResponse()));`,
					],
					env: {
						...process.env,
						MISSION_CONTROL_ROOT: dataRoot,
						MISSION_CONTROL_WORKSPACE_ROOT: tempRoot,
					},
					stdout: 'pipe',
					stderr: 'pipe',
				});
				expect(new TextDecoder().decode(apiProbe.stderr), testCase.label).toBe('');
				expect(apiProbe.exitCode, testCase.label).toBe(0);
				const payload = JSON.parse(new TextDecoder().decode(apiProbe.stdout)) as {
					validation: { ok: boolean };
				};
				expect(payload.validation.ok, testCase.label).toBe(testCase.valid);
			} finally {
				rmSync(tempRoot, { recursive: true, force: true });
			}
		}
	});

	test('API and standalone validator report an uncompileable plan schema', () => {
		const tempRoot = mkdtempSync(path.join(tmpdir(), 'mission-control-plan-schema-'));
		const dataRoot = path.join(tempRoot, 'mission-control-data');
		try {
			cpSync(templateDataRoot, dataRoot, { recursive: true });
			const schemaPath = path.join(dataRoot, 'schemas/mission-control-plan.schema.json');
			const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
			schema.properties.dev_code.pattern = '[';
			writeFileSync(schemaPath, `${JSON.stringify(schema, null, 2)}\n`);

			const standalone = spawnSync(
				process.execPath,
				['scripts/validate-mission-control-data.mjs'],
				{ cwd: dataRoot, encoding: 'utf8' },
			);
			expect(standalone.status).not.toBe(0);
			expect(`${standalone.stdout}\n${standalone.stderr}`).toContain('cannot compile JSON schema');

			const apiProbe = Bun.spawnSync({
				cmd: [
					process.execPath,
					'--eval',
					`const { buildRoadmapsResponse } = await import(${JSON.stringify(roadmapsModuleUrl)}); console.log(JSON.stringify(buildRoadmapsResponse()));`,
				],
				env: {
					...process.env,
					MISSION_CONTROL_ROOT: dataRoot,
					MISSION_CONTROL_WORKSPACE_ROOT: tempRoot,
				},
				stdout: 'pipe',
				stderr: 'pipe',
			});
			expect(new TextDecoder().decode(apiProbe.stderr)).toBe('');
			expect(apiProbe.exitCode).toBe(0);
			const payload = JSON.parse(new TextDecoder().decode(apiProbe.stdout)) as {
				validation: { ok: boolean; failures: string[] };
			};
			expect(payload.validation.ok).toBe(false);
			expect(
				payload.validation.failures.some((failure) =>
					failure.includes('schéma plánu nelze zkompilovat'),
				),
			).toBe(true);
		} finally {
			rmSync(tempRoot, { recursive: true, force: true });
		}
	});

	test('API and standalone validator fail closed for false and invalid scalar plan schemas', () => {
		const cases: Array<{
			label: string;
			schema: unknown;
			expectedStandaloneFailure: string;
			expectedApiFailure: string;
		}> = [
			{
				label: 'false schema',
				schema: false,
				expectedStandaloneFailure: 'boolean schema is false',
				expectedApiFailure: 'boolean schema is false',
			},
			{
				label: 'null schema',
				schema: null,
				expectedStandaloneFailure: 'cannot compile JSON schema',
				expectedApiFailure: 'schéma plánu nelze zkompilovat',
			},
			{
				label: 'numeric schema',
				schema: 0,
				expectedStandaloneFailure: 'cannot compile JSON schema',
				expectedApiFailure: 'schéma plánu nelze zkompilovat',
			},
			{
				label: 'empty string schema',
				schema: '',
				expectedStandaloneFailure: 'cannot compile JSON schema',
				expectedApiFailure: 'schéma plánu nelze zkompilovat',
			},
		];

		for (const testCase of cases) {
			const tempRoot = mkdtempSync(path.join(tmpdir(), 'mission-control-plan-schema-value-'));
			const dataRoot = path.join(tempRoot, 'mission-control-data');
			try {
				cpSync(templateDataRoot, dataRoot, { recursive: true });
				const schemaPath = path.join(dataRoot, 'schemas/mission-control-plan.schema.json');
				writeFileSync(schemaPath, `${JSON.stringify(testCase.schema, null, 2)}\n`);

				const standalone = spawnSync(
					process.execPath,
					['scripts/validate-mission-control-data.mjs'],
					{ cwd: dataRoot, encoding: 'utf8' },
				);
				expect(standalone.status, testCase.label).not.toBe(0);
				expect(`${standalone.stdout}\n${standalone.stderr}`, testCase.label).toContain(
					testCase.expectedStandaloneFailure,
				);

				const apiProbe = Bun.spawnSync({
					cmd: [
						process.execPath,
						'--eval',
						`const { buildRoadmapsResponse } = await import(${JSON.stringify(roadmapsModuleUrl)}); console.log(JSON.stringify(buildRoadmapsResponse()));`,
					],
					env: {
						...process.env,
						MISSION_CONTROL_ROOT: dataRoot,
						MISSION_CONTROL_WORKSPACE_ROOT: tempRoot,
					},
					stdout: 'pipe',
					stderr: 'pipe',
				});
				expect(new TextDecoder().decode(apiProbe.stderr), testCase.label).toBe('');
				expect(apiProbe.exitCode, testCase.label).toBe(0);
				const payload = JSON.parse(new TextDecoder().decode(apiProbe.stdout)) as {
					validation: { ok: boolean; failures: string[] };
				};
				expect(payload.validation.ok, testCase.label).toBe(false);
				expect(
					payload.validation.failures.some((failure) =>
						failure.includes(testCase.expectedApiFailure),
					),
					testCase.label,
				).toBe(true);
			} finally {
				rmSync(tempRoot, { recursive: true, force: true });
			}
		}
	});

	test('API and standalone validator do not fail open for false or null roadmap schemas', () => {
		for (const testCase of [
			{
				label: 'false roadmap schema',
				schema: false,
				expectedFailure: 'boolean schema is false',
				expectedApiFailure: 'boolean schema is false',
			},
			{
				label: 'null roadmap schema',
				schema: null,
				expectedFailure: 'cannot compile JSON schema',
				expectedApiFailure: 'schéma roadmapy nelze zkompilovat',
			},
		]) {
			const tempRoot = mkdtempSync(path.join(tmpdir(), 'mission-control-roadmap-schema-value-'));
			const dataRoot = path.join(tempRoot, 'mission-control-data');
			try {
				cpSync(templateDataRoot, dataRoot, { recursive: true });
				writeFileSync(
					path.join(dataRoot, 'schemas/mission-control-roadmap.schema.json'),
					`${JSON.stringify(testCase.schema, null, 2)}\n`,
				);

				const standalone = spawnSync(
					process.execPath,
					['scripts/validate-mission-control-data.mjs'],
					{ cwd: dataRoot, encoding: 'utf8' },
				);
				expect(standalone.status, testCase.label).not.toBe(0);
				expect(`${standalone.stdout}\n${standalone.stderr}`, testCase.label).toContain(
					testCase.expectedFailure,
				);

				const apiProbe = Bun.spawnSync({
					cmd: [
						process.execPath,
						'--eval',
						`const { buildRoadmapsResponse } = await import(${JSON.stringify(roadmapsModuleUrl)}); console.log(JSON.stringify(buildRoadmapsResponse()));`,
					],
					env: {
						...process.env,
						MISSION_CONTROL_ROOT: dataRoot,
						MISSION_CONTROL_WORKSPACE_ROOT: tempRoot,
					},
					stdout: 'pipe',
					stderr: 'pipe',
				});
				expect(new TextDecoder().decode(apiProbe.stderr), testCase.label).toBe('');
				expect(apiProbe.exitCode, testCase.label).toBe(0);
				const payload = JSON.parse(new TextDecoder().decode(apiProbe.stdout)) as {
					validation: { ok: boolean; failures: string[] };
				};
				expect(payload.validation.ok, testCase.label).toBe(false);
				expect(
					payload.validation.failures.some((failure) =>
						failure.includes(testCase.expectedApiFailure),
					),
					testCase.label,
				).toBe(true);
			} finally {
				rmSync(tempRoot, { recursive: true, force: true });
			}
		}
	});

	symlinkTest(
		'API and standalone validator both reject non-portable entries in the plan tree',
		() => {
			const tempRoot = mkdtempSync(path.join(tmpdir(), 'mission-control-plan-tree-'));
			const dataRoot = path.join(tempRoot, 'mission-control-data');
			try {
				cpSync(templateDataRoot, dataRoot, { recursive: true });
				git(dataRoot, 'init', '-q');
				git(dataRoot, 'add', '.');

				const planDirectory = path.join(dataRoot, 'data/mission-control/plans/2026/01');
				renameSync(
					path.join(planDirectory, 'DEV-0002-template-close-blocker.yaml'),
					path.join(planDirectory, 'DEV-0002-template-close-blocker.YAML'),
				);
				renameSync(
					path.join(planDirectory, 'DEV-0001-template-runtime.yaml'),
					path.join(planDirectory, 'DEV-0001-template-runtime.yml'),
				);
				symlinkSync(
					path.join(planDirectory, 'DEV-0001-template-runtime.yml'),
					path.join(planDirectory, 'linked-plan.yaml'),
					'file',
				);

				const standalone = spawnSync(
					process.execPath,
					['scripts/validate-mission-control-data.mjs'],
					{ cwd: dataRoot, encoding: 'utf8' },
				);
				expect(standalone.status).not.toBe(0);
				const standaloneOutput = `${standalone.stdout}\n${standalone.stderr}`;
				expect(standaloneOutput).toContain('YAML extension must be lowercase .yaml or .yml');
				expect(standaloneOutput).toContain('canonical plan extension must be .yaml');
				expect(standaloneOutput).toContain('YAML source tree must not contain symlinks');

				const apiProbe = Bun.spawnSync({
					cmd: [
						process.execPath,
						'--eval',
						`const { buildRoadmapsResponse } = await import(${JSON.stringify(roadmapsModuleUrl)}); console.log(JSON.stringify(buildRoadmapsResponse()));`,
					],
					env: {
						...process.env,
						MISSION_CONTROL_ROOT: dataRoot,
						MISSION_CONTROL_WORKSPACE_ROOT: tempRoot,
					},
					stdout: 'pipe',
					stderr: 'pipe',
				});
				expect(new TextDecoder().decode(apiProbe.stderr)).toBe('');
				expect(apiProbe.exitCode).toBe(0);
				const payload = JSON.parse(new TextDecoder().decode(apiProbe.stdout)) as {
					validation: { ok: boolean; failures: string[] };
				};
				expect(payload.validation.ok).toBe(false);
				expect(
					payload.validation.failures.some((failure) =>
						failure.includes('YAML přípona musí být lowercase .yaml nebo .yml'),
					),
				).toBe(true);
				expect(
					payload.validation.failures.some((failure) =>
						failure.includes('kanonický plán musí používat příponu .yaml'),
					),
				).toBe(true);
				expect(
					payload.validation.failures.some((failure) =>
						failure.includes('YAML source tree nesmí obsahovat symlinky'),
					),
				).toBe(true);
			} finally {
				rmSync(tempRoot, { recursive: true, force: true });
			}
		},
	);
});
