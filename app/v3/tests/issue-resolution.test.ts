import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ORGANIZATION_ADMIN_ID, resolveIssue } from '../src/issue-resolution.ts';

describe('legacy issue history', () => {
	test('even the configured admin cannot resolve legacy records or rewrite history', async () => {
		const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'mc-legacy-issues-'));
		const open = JSON.stringify({ issues: [{ id: 'issue-1', status: 'open' }] });
		const resolved = JSON.stringify({ issues: [{ id: 'issue-0', status: 'resolved' }] });
		try {
			await writeFile(path.join(workspaceRoot, 'ISSUES.open.json'), open);
			await writeFile(path.join(workspaceRoot, 'ISSUES.resolved.json'), resolved);
			await expect(
				resolveIssue(
					{
						ledgerPath: 'ISSUES.open.json',
						issueId: 'issue-1',
						resolvedBy: ORGANIZATION_ADMIN_ID,
						decision: 'Close it',
					},
					{ workspaceRoot },
				),
			).rejects.toMatchObject({
				status: 410,
				code: 'legacy_issues_read_only',
			});
			expect(await readFile(path.join(workspaceRoot, 'ISSUES.open.json'), 'utf8')).toBe(open);
			expect(await readFile(path.join(workspaceRoot, 'ISSUES.resolved.json'), 'utf8')).toBe(
				resolved,
			);
		} finally {
			await rm(workspaceRoot, { recursive: true, force: true });
		}
	});
});
