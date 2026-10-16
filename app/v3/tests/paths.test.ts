import { afterEach, describe, expect, test } from 'bun:test';
import { realpathSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
	listWorkspaceLedgerFiles,
	MISSION_CONTROL_ROOT,
	resolveOrganizationAdmin,
	WORKSPACE_ROOT,
} from '../src/paths.ts';

const LOCAL_WORKTREE_LEDGER_DIRS = [
	'.worktrees/ACME-9999',
	'.codex-tmp/ACME-9999',
	'.pr-worktrees/ACME-9999',
	'legacy-worktrees/ACME-9999',
];

const createdRoots: string[] = [];
const pathsModuleUrl = pathToFileURL(path.resolve(import.meta.dir, '../src/paths.ts')).href;

async function createTempWorkspaceRoot(): Promise<string> {
	const tempRoot = await mkdtemp(path.join(tmpdir(), 'ledger-scan-'));
	createdRoots.push(tempRoot);
	return tempRoot;
}

async function writeLocalWorktreeLedger(workspaceRoot: string, relativeDir: string): Promise<void> {
	const dir = path.join(workspaceRoot, relativeDir);
	await mkdir(dir, { recursive: true });
	await writeFile(path.join(dir, 'TODO.tasks.json'), '{}');
}

async function removeLocalWorktreeLedgerDirs(): Promise<void> {
	for (const root of createdRoots.splice(0)) {
		await rm(root, {
			force: true,
			recursive: true,
		});
	}
}

function runPathsProbe(source: string, missionRoot: string, workspaceRoot: string) {
	return Bun.spawnSync({
		cmd: [process.execPath, '--eval', source],
		env: {
			...process.env,
			MISSION_CONTROL_ROOT: missionRoot,
			MISSION_CONTROL_WORKSPACE_ROOT: workspaceRoot,
		},
		stdout: 'pipe',
		stderr: 'pipe',
	});
}

afterEach(async () => {
	await removeLocalWorktreeLedgerDirs();
});

describe('path root detection', () => {
	test('prefers canonical organization_admin and falls back to legacy workspace_admin', () => {
		expect(
			resolveOrganizationAdmin({
				organization_admin: 'organization-steward',
				workspace_admin: 'legacy-workspace-admin',
			}),
		).toBe('organization-steward');
		expect(resolveOrganizationAdmin({ workspace_admin: 'legacy-workspace-admin' })).toBe(
			'legacy-workspace-admin',
		);
		expect(resolveOrganizationAdmin({})).toBeNull();
	});

	test('uses configured Mission Control roots or defaults standalone v3 app to the code repo root', () => {
		const codeRepoRoot = path.resolve(import.meta.dir, '..', '..', '..');
		const expectedMissionRoot = path.resolve(process.env.MISSION_CONTROL_ROOT ?? codeRepoRoot);
		const expectedWorkspaceRoot = path.resolve(
			process.env.MISSION_CONTROL_WORKSPACE_ROOT ?? codeRepoRoot,
		);

		expect(realpathSync(MISSION_CONTROL_ROOT)).toBe(realpathSync(expectedMissionRoot));
		expect(realpathSync(WORKSPACE_ROOT)).toBe(realpathSync(expectedWorkspaceRoot));
	});

	test('prefers repository-db Mission Control config when a db mount exists', async () => {
		const workspaceRoot = await createTempWorkspaceRoot();
		const missionRoot = path.join(workspaceRoot, 'mission-control');
		const repositoryDbRoot = path.join(missionRoot, 'db');
		await mkdir(path.join(repositoryDbRoot, 'data/mission-control/plans'), { recursive: true });
		await mkdir(path.join(missionRoot, 'schemas'), { recursive: true });
		await writeFile(
			path.join(repositoryDbRoot, 'repository-db.yaml'),
			'schema_version: repository-db.config.v1\napp: mission-control\n',
		);
		await writeFile(path.join(missionRoot, 'schemas/mission-control-plan.schema.json'), '{}\n');
		await writeFile(
			path.join(missionRoot, 'mission-control.config.json'),
			JSON.stringify({
				schema_version: 'companiesascode.mission_control.config.v1',
				plan_prefix: 'DEV',
				plans_dir: 'legacy/plans',
				schema_path: 'legacy/schema.json',
			}) + '\n',
		);
		await writeFile(
			path.join(repositoryDbRoot, 'data/mission-control/mission-control.config.json'),
			JSON.stringify({
				schema_version: 'companiesascode.mission_control.config.v1',
				data_mode: 'repository-db',
				plan_prefix: 'DEV',
				plans_dir: 'data/mission-control/plans',
				schema_path: 'schemas/mission-control-plan.schema.json',
				organization_admin: 'organization-steward',
				workspace_admin: 'legacy-workspace-admin',
			}) + '\n',
		);

		const result = Bun.spawnSync({
			cmd: [
				process.execPath,
				'--eval',
				`import { ORGANIZATION_ADMIN_FROM_CONFIG, PLANS_ROOT, SCHEMA_PATH } from ${JSON.stringify(pathToFileURL(path.resolve(import.meta.dir, '../src/paths.ts')).href)}; console.log(JSON.stringify({ ORGANIZATION_ADMIN_FROM_CONFIG, PLANS_ROOT, SCHEMA_PATH }));`,
			],
			env: {
				...process.env,
				MISSION_CONTROL_ROOT: missionRoot,
				MISSION_CONTROL_WORKSPACE_ROOT: workspaceRoot,
			},
			stdout: 'pipe',
			stderr: 'pipe',
		});

		expect(new TextDecoder().decode(result.stderr)).toBe('');
		expect(result.exitCode).toBe(0);
		const paths = JSON.parse(new TextDecoder().decode(result.stdout)) as {
			ORGANIZATION_ADMIN_FROM_CONFIG: string;
			PLANS_ROOT: string;
			SCHEMA_PATH: string;
		};
		expect(paths.ORGANIZATION_ADMIN_FROM_CONFIG).toBe('organization-steward');
		expect(paths.PLANS_ROOT).toBe(path.join(repositoryDbRoot, 'data/mission-control/plans'));
		expect(paths.SCHEMA_PATH).toBe(
			path.join(missionRoot, 'schemas/mission-control-plan.schema.json'),
		);
	});

	test('standalone repository-db root resolves its bundled schema locally', async () => {
		const workspaceRoot = await createTempWorkspaceRoot();
		const dataRepoRoot = path.join(workspaceRoot, 'mission-control-data');
		await mkdir(path.join(dataRepoRoot, 'data/mission-control/plans'), {
			recursive: true,
		});
		await mkdir(path.join(dataRepoRoot, 'schemas'), { recursive: true });
		await writeFile(
			path.join(dataRepoRoot, 'repository-db.yaml'),
			'schema_version: repository-db.config.v1\napp: mission-control\n',
		);
		await writeFile(path.join(dataRepoRoot, 'schemas/mission-control-plan.schema.json'), '{}\n');
		await writeFile(
			path.join(dataRepoRoot, 'data/mission-control/mission-control.config.json'),
			`${JSON.stringify({
				schema_version: 'companiesascode.mission_control.config.v1',
				data_mode: 'repository-db',
				plan_prefix: 'AVT',
				plans_dir: 'data/mission-control/plans',
				schema_path: 'schemas/mission-control-plan.schema.json',
				organization_admin: 'organization-steward',
			})}\n`,
		);

		const result = runPathsProbe(
			`const paths = await import(${JSON.stringify(pathsModuleUrl)}); console.log(JSON.stringify({ dataRoot: paths.MISSION_CONTROL_DATA_ROOT, plansRoot: paths.PLANS_ROOT, schemaPath: paths.SCHEMA_PATH }));`,
			dataRepoRoot,
			workspaceRoot,
		);
		expect(new TextDecoder().decode(result.stderr)).toBe('');
		expect(result.exitCode).toBe(0);
		const output = JSON.parse(new TextDecoder().decode(result.stdout)) as {
			dataRoot: string;
			plansRoot: string;
			schemaPath: string;
		};
		expect(output.dataRoot).toBe(dataRepoRoot);
		expect(output.plansRoot).toBe(path.join(dataRepoRoot, 'data/mission-control/plans'));
		expect(output.schemaPath).toBe(
			path.join(dataRepoRoot, 'schemas/mission-control-plan.schema.json'),
		);
	});

	test('fails closed when repository-db mode declares a missing data mount', async () => {
		const workspaceRoot = await createTempWorkspaceRoot();
		const missionRoot = path.join(workspaceRoot, 'mission-control');
		await mkdir(missionRoot, { recursive: true });
		await writeFile(
			path.join(missionRoot, 'mission-control.config.json'),
			JSON.stringify({
				schema_version: 'companiesascode.mission_control.config.v1',
				data_mode: 'repository-db',
				plan_prefix: 'AVT',
				plans_dir: 'data/mission-control/plans',
				schema_path: 'schemas/mission-control-plan.schema.json',
			}) + '\n',
		);

		const result = runPathsProbe(
			`await import(${JSON.stringify(pathsModuleUrl)});`,
			missionRoot,
			workspaceRoot,
		);
		const stderr = new TextDecoder().decode(result.stderr);
		expect(result.exitCode).not.toBe(0);
		expect(stderr).toContain('repository-db mount chybí nebo je neúplný');
		expect(stderr).toContain(path.join(missionRoot, 'db'));
	});

	test('keeps bundled fallback data available when data_mode is not declared', async () => {
		const workspaceRoot = await createTempWorkspaceRoot();
		const missionRoot = path.join(workspaceRoot, 'mission-control');
		await mkdir(missionRoot, { recursive: true });
		await writeFile(
			path.join(missionRoot, 'mission-control.config.json'),
			JSON.stringify({
				schema_version: 'companiesascode.mission_control.config.v1',
				plan_prefix: 'DEV',
				plans_dir: 'mission-control/template-data/plans',
				schema_path: 'mission-control/template-data/plan.schema.json',
			}) + '\n',
		);

		const result = runPathsProbe(
			`const paths = await import(${JSON.stringify(pathsModuleUrl)}); console.log(JSON.stringify({ dataRoot: paths.MISSION_CONTROL_DATA_ROOT, plansRoot: paths.PLANS_ROOT }));`,
			missionRoot,
			workspaceRoot,
		);
		expect(new TextDecoder().decode(result.stderr)).toBe('');
		expect(result.exitCode).toBe(0);
		const output = JSON.parse(new TextDecoder().decode(result.stdout)) as {
			dataRoot: string;
			plansRoot: string;
		};
		expect(output.dataRoot).toBe(workspaceRoot);
		expect(output.plansRoot).toBe(path.join(workspaceRoot, 'mission-control/template-data/plans'));
	});

	test('repository-db mode discovers only canonical data ledgers, not root mirrors', async () => {
		const workspaceRoot = await createTempWorkspaceRoot();
		const missionRoot = path.join(workspaceRoot, 'mission-control');
		const repositoryDbRoot = path.join(missionRoot, 'db');
		const dataRoot = path.join(repositoryDbRoot, 'data/mission-control');
		await mkdir(dataRoot, { recursive: true });
		await writeFile(
			path.join(repositoryDbRoot, 'repository-db.yaml'),
			'schema_version: repository-db.config.v1\napp: mission-control\n',
		);
		const dataConfig = {
			schema_version: 'companiesascode.mission_control.config.v1',
			data_mode: 'repository-db',
			plan_prefix: 'AVT',
			plans_dir: 'data/mission-control/plans',
			schema_path: 'schemas/mission-control-plan.schema.json',
			todo_tasks_path: 'data/mission-control/TODO.tasks.json',
			done_tasks_path: 'data/mission-control/DONE.tasks.json',
			issues_open_path: 'data/mission-control/ISSUES.open.json',
			issues_resolved_path: 'data/mission-control/ISSUES.resolved.json',
		};
		await writeFile(
			path.join(dataRoot, 'mission-control.config.json'),
			`${JSON.stringify(dataConfig, null, 2)}\n`,
		);
		await writeFile(
			path.join(missionRoot, 'mission-control.config.json'),
			`${JSON.stringify(dataConfig, null, 2)}\n`,
		);
		await writeFile(
			path.join(dataRoot, 'TODO.tasks.json'),
			`${JSON.stringify([{ id: 'task-duplicate-proof' }])}\n`,
		);
		for (const file of ['DONE.tasks.json', 'ISSUES.open.json', 'ISSUES.resolved.json']) {
			await writeFile(path.join(dataRoot, file), '[]\n');
		}
		await writeFile(
			path.join(workspaceRoot, 'TODO.tasks.json'),
			`${JSON.stringify([{ id: 'task-duplicate-proof' }, { id: 'task-root-mirror-only' }])}\n`,
		);

		const result = runPathsProbe(
			`import { readFileSync } from "node:fs"; import path from "node:path"; const paths = await import(${JSON.stringify(pathsModuleUrl)}); const files = await paths.listWorkspaceLedgerFiles(); const ids = files.flatMap((file) => { const value = JSON.parse(readFileSync(file, "utf8")); const rows = Array.isArray(value) ? value : [...(value.tasks ?? []), ...(value.issues ?? [])]; return rows.map((row) => row.id).filter(Boolean); }); console.log(JSON.stringify({ files: files.map((file) => path.relative(process.env.MISSION_CONTROL_WORKSPACE_ROOT, file).split(path.sep).join("/")), ids }));`,
			missionRoot,
			workspaceRoot,
		);
		expect(new TextDecoder().decode(result.stderr)).toBe('');
		expect(result.exitCode).toBe(0);
		const output = JSON.parse(new TextDecoder().decode(result.stdout)) as {
			files: string[];
			ids: string[];
		};
		expect(output.files).toEqual([
			'mission-control/db/data/mission-control/DONE.tasks.json',
			'mission-control/db/data/mission-control/ISSUES.open.json',
			'mission-control/db/data/mission-control/ISSUES.resolved.json',
			'mission-control/db/data/mission-control/TODO.tasks.json',
		]);
		expect(output.ids).toEqual(['task-duplicate-proof']);
	});
});

describe('listWorkspaceLedgerFiles', () => {
	test('ignores local development worktree ledger roots', async () => {
		const workspaceRoot = await createTempWorkspaceRoot();
		await Promise.all(
			LOCAL_WORKTREE_LEDGER_DIRS.map((relativeDir) =>
				writeLocalWorktreeLedger(workspaceRoot, relativeDir),
			),
		);

		const ledgers = (await listWorkspaceLedgerFiles(workspaceRoot)).map((file) =>
			path.relative(workspaceRoot, file).split(path.sep).join('/'),
		);

		for (const relativeDir of LOCAL_WORKTREE_LEDGER_DIRS) {
			expect(ledgers).not.toContain(`${relativeDir}/TODO.tasks.json`);
		}
	});
});
