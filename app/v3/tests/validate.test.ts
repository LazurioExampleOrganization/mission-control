import { afterAll, describe, expect, test } from 'bun:test';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PLAN_CODE_RE } from '../src/paths.ts';
import { listPlanRecordsForValidation } from '../src/store.ts';
import { validatePlanRecords } from '../src/validate.ts';

const APP_ROOT = path.resolve(import.meta.dir, '..');
const REPOSITORY_ROOT = path.resolve(APP_ROOT, '..', '..');
const FIXTURE_SUITE = path.join(APP_ROOT, 'test-support', 'validate-fixture-suite.ts');
const cleanupRoots: string[] = [];

afterAll(async () => {
	for (const root of cleanupRoots.splice(0)) {
		await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
	}
});

async function isolatedValidatorFixture() {
	const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'mission-control-validator-'));
	cleanupRoots.push(temporaryRoot);
	const workspaceRoot = path.join(temporaryRoot, 'workspace');
	const missionControlRoot = path.join(workspaceRoot, 'mission-control');
	const repositoryDbRoot = path.join(missionControlRoot, 'db');

	await mkdir(repositoryDbRoot, { recursive: true });
	await cp(path.join(REPOSITORY_ROOT, 'templates', 'organization-data'), repositoryDbRoot, {
		recursive: true,
	});
	await cp(path.join(REPOSITORY_ROOT, 'schemas'), path.join(missionControlRoot, 'schemas'), {
		recursive: true,
	});
	await mkdir(path.join(workspaceRoot, 'fixture'), { recursive: true });
	await writeFile(path.join(workspaceRoot, 'fixture', 'TODO.tasks.json'), '[]\n', 'utf8');

	return { missionControlRoot, workspaceRoot };
}

describe('Mission Control v3 plan validation boundaries', () => {
	test('validates the selected consumer store without a template-specific identity', async () => {
		const { records, errors: fileErrors } = await listPlanRecordsForValidation();
		const validation = validatePlanRecords(records);

		expect(records.length).toBeGreaterThan(0);
		expect(fileErrors).toEqual([]);
		expect(validation).toEqual({ ok: true, errors: [] });
		for (const record of records) expect(record.plan.dev_code).toMatch(PLAN_CODE_RE);
	});

	test('runs generic validator assertions only against an isolated temporary repository-db', async () => {
		const fixture = await isolatedValidatorFixture();
		const child = Bun.spawn([process.execPath, 'test', FIXTURE_SUITE], {
			cwd: REPOSITORY_ROOT,
			env: {
				...process.env,
				MISSION_CONTROL_ROOT: fixture.missionControlRoot,
				MISSION_CONTROL_WORKSPACE_ROOT: fixture.workspaceRoot,
			},
			stdin: 'ignore',
			stdout: 'pipe',
			stderr: 'pipe',
			windowsHide: true,
		});
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);

		if (exitCode !== 0) {
			throw new Error(
				`Isolated validator fixture failed with exit ${exitCode}\n${stdout}\n${stderr}`,
			);
		}
		expect(exitCode).toBe(0);
	});
});
