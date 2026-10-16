import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WORKSPACE_ROOT } from '../src/paths.ts';
import { buildProposalsResponse, serveProposalFile } from '../src/proposals.ts';
import { validateProposalRecords } from '../src/vendor/proposals-lib.ts';

const SLUG = 'template-mcv3-boundary';

describe('Proposals integration', () => {
	test('buildProposalsResponse returns the generic MCv3 proposal', () => {
		const response = buildProposalsResponse();
		expect(response.failures).toEqual([]);
		const seed = response.proposals.find((item) => item.folder === SLUG);
		expect(seed).toBeDefined();
		expect(seed?.proposal?.dev_code).toBe('DEV-0001');
		expect(seed?.wireframe_href).toBe(`/proposal-files/${SLUG}/index.html`);
		expect(seed?.design_notes_href).toBe(`/proposal-files/${SLUG}/NOTES.md`);
	});

	test('serveProposalFile serves wireframe with CSP header', async () => {
		const response = await serveProposalFile(`/proposal-files/${SLUG}/index.html`);
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type') ?? '').toContain('text/html');
		const csp = response.headers.get('content-security-policy') ?? '';
		expect(csp).toContain("connect-src 'none'");
		expect(csp).toContain('sandbox allow-scripts');
		expect(csp).not.toContain('allow-same-origin');
		expect(csp).not.toContain('allow-popups');
	});

	test('serveProposalFile rejects symlink escaping proposal folder', async () => {
		const externalRoot = await mkdtemp(path.join(tmpdir(), 'mc-proposal-escape-'));
		const symlinkPath = path.join(WORKSPACE_ROOT, 'mission-control', 'proposals', SLUG, 'tmp-leak');
		try {
			await writeFile(path.join(externalRoot, 'outside.txt'), 'outside proposal boundary\n');
			await symlink(externalRoot, symlinkPath, process.platform === 'win32' ? 'junction' : 'dir');
			const response = await serveProposalFile(`/proposal-files/${SLUG}/tmp-leak/outside.txt`);
			expect(response.status).toBe(403);
		} finally {
			await unlink(symlinkPath).catch(() => {});
			await rm(externalRoot, { force: true, recursive: true });
		}
	});

	test('serveProposalFile rejects unknown proposal and traversal', async () => {
		expect((await serveProposalFile('/proposal-files/unknown/index.html')).status).toBe(404);
		expect([403, 404]).toContain(
			(
				await serveProposalFile(
					`/proposal-files/${SLUG}/../../templates/organization-data/data/mission-control/plans/2026/01/DEV-0001-template-runtime.yaml`,
				)
			).status,
		);
	});

	test('proposal dev_code validation fails closed on a broken mounted repository-db config', async () => {
		const root = await mkdtemp(path.join(tmpdir(), 'mc-proposals-'));
		try {
			const mountedDbRoot = path.join(root, 'mission-control', 'db');
			await mkdir(path.join(root, 'mission-control', 'legacy', 'plans'), { recursive: true });
			await mkdir(path.join(root, 'mission-control', 'schemas'), { recursive: true });
			await mkdir(path.join(mountedDbRoot, 'data', 'mission-control'), { recursive: true });
			await mkdir(path.join(mountedDbRoot, 'schemas'), { recursive: true });
			await writeFile(
				path.join(root, 'mission-control', 'schemas', 'proposal.schema.json'),
				JSON.stringify({ properties: {}, required: [] }) + '\n',
			);
			await writeFile(
				path.join(root, 'mission-control', 'schemas', 'mission-control-plan.schema.json'),
				'{}\n',
			);
			await writeFile(
				path.join(root, 'mission-control', 'mission-control.config.json'),
				JSON.stringify({
					schema_version: 'companiesascode.mission_control.config.v1',
					plan_prefix: 'DEV',
					plans_dir: 'mission-control/legacy/plans',
					schema_path: 'mission-control/schemas/mission-control-plan.schema.json',
				}) + '\n',
			);
			await writeFile(
				path.join(mountedDbRoot, 'repository-db.yaml'),
				'schema_version: repository-db.config.v1\napp: mission-control\n',
			);
			await writeFile(
				path.join(mountedDbRoot, 'schemas', 'mission-control-plan.schema.json'),
				'{}\n',
			);
			await writeFile(
				path.join(mountedDbRoot, 'data', 'mission-control', 'mission-control.config.json'),
				JSON.stringify({
					schema_version: 'companiesascode.mission_control.config.v1',
					data_mode: 'repository-db',
					plan_prefix: '',
					plans_dir: 'data/mission-control/plans',
					schema_path: 'schemas/mission-control-plan.schema.json',
				}) + '\n',
			);

			expect(validateProposalRecords([], root)).toEqual([
				expect.stringContaining('plan_prefix musí být 2-6 velkých písmen'),
			]);
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	});
});
