// Layout headerSlot je globální: draft indikátor sedí vpravo nahoře na
// každé stránce, ne jen na Publish stránce.

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { missionControlBrand } from '../src/instance/brand.ts';
import { Layout } from '../src/ui-app/Layout.tsx';

describe('Layout headerSlot', () => {
	test('renders the header slot alongside the version badge', () => {
		const html = renderToStaticMarkup(
			<Layout
				activePage='plans-all'
				onNavigate={() => undefined}
				headerSlot={<div data-testid='draft-indicator'>DRAFT SLOT</div>}
			>
				<p>obsah stránky</p>
			</Layout>,
		);
		expect(html).toContain('top-right-slot');
		expect(html).toContain('DRAFT SLOT');
		expect(html).toContain('Lazurio v3');
		expect(html).toContain(missionControlBrand.organization);
	});

	test('stays valid without a header slot (tichý stav)', () => {
		const html = renderToStaticMarkup(
			<Layout activePage='plans-all' onNavigate={() => undefined}>
				<p>obsah</p>
			</Layout>,
		);
		expect(html).toContain('top-right-slot');
		expect(html).not.toContain('DRAFT SLOT');
	});
});
