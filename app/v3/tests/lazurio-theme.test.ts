import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { missionControlBrand } from '../src/instance/brand.ts';

const APP_ROOT = path.resolve(import.meta.dir, '..');

describe('reusable Lazurio theme', () => {
	test('loads the Lazurio layers after the reusable Mission Control styles', () => {
		const main = readFileSync(path.join(APP_ROOT, 'src/ui-app/main.tsx'), 'utf8');
		const overlay = readFileSync(path.join(APP_ROOT, 'src/instance/theme.css'), 'utf8');
		const baseIndex = main.indexOf("import './index.css'");
		const overlayIndex = main.indexOf("import '../instance/theme.css'");
		const themeIndex = overlay.indexOf("@import '../design-system/lazurio-theme.css'");
		const gridIndex = overlay.indexOf("@import '../design-system/lazurio-grid.css'");

		expect(baseIndex).not.toBe(-1);
		expect(overlayIndex).not.toBe(-1);
		expect(baseIndex).toBeLessThan(overlayIndex);
		expect(themeIndex).not.toBe(-1);
		if (gridIndex !== -1) expect(themeIndex).toBeLessThan(gridIndex);
	});

	test('keeps the canonical Lazurio UI invariants in the portable snapshot', () => {
		const theme = readFileSync(
			path.join(APP_ROOT, 'src/design-system/lazurio-theme.css'),
			'utf8',
		).replaceAll('\r\n', '\n');
		const grid = readFileSync(
			path.join(APP_ROOT, 'src/design-system/lazurio-grid.css'),
			'utf8',
		).replaceAll('\r\n', '\n');

		expect(theme).toContain('--lz-blue-500: #0d12db');
		expect(theme).toContain('--lz-font-sans: "Inter Tight Variable"');
		expect(theme).toContain('background: var(--lz-gray-950)');
		expect(theme).toContain('text-transform: none');
		expect(theme).toContain('transition-duration: 0.01ms !important');
		expect(grid).toContain(
			'--_lz-grid-origin: calc(50% - min(calc(var(--lz-grid-step) * 8), 50%))',
		);
		expect(grid).toContain('linear-gradient(var(--lz-gray-50) 1px, transparent 1px)');
		expect(grid).toContain('M64 51V77M51 64H77');
		expect(grid).toContain('radial-gradient(130% 110% at 50% 0%');
		expect(theme).toContain('.sidebar-item {\n\tfont-weight: 400;');
		expect(theme).toContain(
			'.sidebar-item.active {\n\tbox-shadow: inset 3px 0 0 var(--lz-blue-500);\n\tfont-weight: 500;',
		);
		expect(theme).not.toContain('text-transform: uppercase');
	});

	test('keeps the declared identity in the explicit instance overlay', () => {
		const rootPackage = JSON.parse(
			readFileSync(path.join(APP_ROOT, '..', '..', 'package.json'), 'utf8'),
		) as {
			companyascode: { mission_control: { mode: string; organization: { display_name: string } } };
		};

		const instance = rootPackage.companyascode.mission_control;
		const expectedName =
			instance.mode === 'template' ? 'Organization' : instance.organization.display_name;
		expect(missionControlBrand.organization).toBe(expectedName);
	});
});
