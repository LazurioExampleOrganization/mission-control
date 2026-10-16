import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
	configuredLedgerRelativePath,
	readIssueRecordsFromFile,
	readWorkLedgerItemsFromFiles,
} from '../src/roadmaps.ts';

const fixtureRoots: string[] = [];

function fixtureFile(name: string, value: unknown): string {
	const root = mkdtempSync(path.join(tmpdir(), 'mission-control-roadmap-ledger-'));
	fixtureRoots.push(root);
	const file = path.join(root, name);
	writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
	return file;
}

afterEach(() => {
	for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('Roadmap canonical ledgers', () => {
	test('keeps exact mode-specific fallback paths when config omits optional ledger keys', () => {
		expect(configuredLedgerRelativePath({}, 'todo_tasks_path', false)).toBe('TODO.tasks.json');
		expect(configuredLedgerRelativePath({}, 'issues_open_path', false)).toBe('ISSUES.open.json');
		expect(configuredLedgerRelativePath({}, 'done_tasks_path', true)).toBe(
			'data/mission-control/DONE.tasks.json',
		);
		expect(configuredLedgerRelativePath({}, 'issues_resolved_path', true)).toBe(
			'data/mission-control/ISSUES.resolved.json',
		);
		expect(
			configuredLedgerRelativePath(
				{ todo_tasks_path: 'custom/TODO.json' },
				'todo_tasks_path',
				true,
			),
		).toBe('custom/TODO.json');
	});

	test('reads canonical array-form TODO and DONE ledgers', () => {
		const todo = fixtureFile('TODO.tasks.json', [
			{ id: 'task-2026-08-09-001', title: 'Canonical TODO', status: 'open', dev_code: 'DEV-0001' },
		]);
		const done = fixtureFile('DONE.tasks.json', [
			{ id: 'task-2026-08-09-002', title: 'Canonical DONE', status: 'done', dev_code: 'DEV-0001' },
		]);

		const result = readWorkLedgerItemsFromFiles(
			[
				{ path: todo, kind: 'todo', required: true },
				{ path: done, kind: 'done', required: true },
			],
			path.dirname(todo),
		);

		expect(result.ledgerReadErrors).toEqual([]);
		expect(result.items.map(({ id, kind }) => ({ id, kind }))).toEqual([
			{ id: 'task-2026-08-09-001', kind: 'todo' },
			{ id: 'task-2026-08-09-002', kind: 'done' },
		]);
	});

	test('uses the configured ledger kind and ignores only missing files', () => {
		const todo = fixtureFile('custom-open.json', [
			{ id: 'task-open', title: 'Open task', status: 'open' },
		]);
		const done = fixtureFile('custom-closed.json', [
			{ id: 'task-done', title: 'Done task', status: 'done' },
		]);
		const missing = path.join(path.dirname(todo), 'missing.json');
		const requiredMissing = path.join(path.dirname(todo), 'required-missing.json');
		const malformed = path.join(path.dirname(todo), 'malformed.json');
		writeFileSync(malformed, '{\n');

		const result = readWorkLedgerItemsFromFiles(
			[
				{ path: todo, kind: 'todo', required: true },
				{ path: done, kind: 'done', required: true },
				{ path: missing, kind: 'done', required: false },
				{ path: requiredMissing, kind: 'done', required: true },
				{ path: malformed, kind: 'done', required: true },
			],
			path.dirname(todo),
		);

		expect(result.ledgerReadErrors).toEqual([
			expect.objectContaining({ ledger_path: 'required-missing.json' }),
			expect.objectContaining({ ledger_path: 'malformed.json' }),
		]);
		expect(result.items.map(({ id, kind }) => ({ id, kind }))).toEqual([
			{ id: 'task-open', kind: 'todo' },
			{ id: 'task-done', kind: 'done' },
		]);
	});

	test('reads canonical array-form issue ledgers with source provenance', () => {
		const file = fixtureFile('ISSUES.resolved.json', [
			{
				id: 'issue-2026-08-09-001',
				title: 'Resolved issue',
				status: 'resolved',
				resolution: { decision: 'Keep the canonical data path.' },
			},
		]);

		expect(readIssueRecordsFromFile(file, 'resolved_issue', path.dirname(file))).toEqual([
			expect.objectContaining({
				id: 'issue-2026-08-09-001',
				file: 'ISSUES.resolved.json',
				issue_source: 'resolved_issue',
			}),
		]);
	});
});
