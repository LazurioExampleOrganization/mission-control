import { describe, expect, test } from 'bun:test';
import path from 'node:path';
import { portableRelativePath } from '../src/portable-path.ts';

describe('portableRelativePath', () => {
	test('serializes POSIX relative paths unchanged', () => {
		expect(
			portableRelativePath('/workspace', '/workspace/data/mission-control/plans', path.posix),
		).toBe('data/mission-control/plans');
	});

	test('serializes Windows relative paths with repository separators', () => {
		const result = portableRelativePath(
			'C:\\workspace',
			'C:\\workspace\\data\\mission-control\\plans',
			path.win32,
		);
		expect(result).toBe('data/mission-control/plans');
		expect(result).not.toContain('\\');
	});

	test("preserves traversal evidence for the caller's containment gate", () => {
		expect(portableRelativePath('C:\\workspace', 'C:\\outside', path.win32)).toBe('../outside');
	});
});
