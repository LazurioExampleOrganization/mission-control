import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

// Guard proti regresi z FIX cockpit bundle: UI graf nesmí (tranzitivně)
// importovat serverové moduly s node: built-ins ani config loader v
// paths.ts — jinak Vite bundle spadne v prohlížeči na shimu
// ("resolve is not a function"). Type-only importy jsou v pořádku,
// verbatimModuleSyntax je při buildu vymaže.

const APP_SRC = path.resolve(import.meta.dir, '..', 'src');
const UI_ROOT = path.join(APP_SRC, 'ui-app');
const FORBIDDEN_RESOLVED = new Set([path.join(APP_SRC, 'paths.ts')]);

const IMPORT_RE = /^[\t ]*import\s+([^;]*?)from\s+["']([^"']+)["']/gm;
const SIDE_EFFECT_IMPORT_RE = /^[\t ]*import\s+["']([^"']+)["']/gm;

function listUiFiles(dir: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = path.join(dir, entry);
		if (statSync(full).isDirectory()) {
			files.push(...listUiFiles(full));
		} else if (/\.(ts|tsx)$/.test(entry)) {
			files.push(full);
		}
	}
	return files;
}

function resolveSpecifier(fromFile: string, specifier: string): string | null {
	if (!specifier.startsWith('.')) return null;
	const base = path.resolve(path.dirname(fromFile), specifier);
	for (const candidate of [base, `${base}.ts`, `${base}.tsx`]) {
		try {
			if (statSync(candidate).isFile()) return candidate;
		} catch {}
	}
	return null;
}

describe('UI bundle safety', () => {
	test('ui-app graf netahá node built-ins ani config loader', () => {
		const violations: string[] = [];
		const visited = new Set<string>();
		const queue = listUiFiles(UI_ROOT);

		while (queue.length > 0) {
			const file = queue.pop();
			if (!file || visited.has(file)) continue;
			visited.add(file);
			const source = readFileSync(file, 'utf8');
			const rel = path.relative(APP_SRC, file);

			for (const match of source.matchAll(IMPORT_RE)) {
				const clause = match[1] ?? '';
				const specifier = match[2] ?? '';
				const typeOnly = /^type\s/.test(clause.trim());
				if (specifier.startsWith('node:') && !typeOnly) {
					violations.push(`${rel}: runtime import "${specifier}"`);
					continue;
				}
				if (typeOnly) continue;
				const resolved = resolveSpecifier(file, specifier);
				if (!resolved) continue;
				if (FORBIDDEN_RESOLVED.has(resolved)) {
					violations.push(`${rel}: importuje serverový modul ${path.relative(APP_SRC, resolved)}`);
					continue;
				}
				queue.push(resolved);
			}
			for (const match of source.matchAll(SIDE_EFFECT_IMPORT_RE)) {
				const specifier = match[1] ?? '';
				if (specifier.startsWith('node:')) {
					violations.push(`${rel}: side-effect import "${specifier}"`);
				}
			}
		}

		expect(violations).toEqual([]);
	});
});
