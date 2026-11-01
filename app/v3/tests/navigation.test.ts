import { describe, expect, test } from 'bun:test';
import { navSections } from '../src/ui-app/navigation.ts';

describe('Mission Control navigation', () => {
	test('exposes the main roadmap timeline first, then Roadmaps, as a first-class sidebar section', () => {
		expect(navSections[0]?.label).toBe('Roadmapy');
		const roadmapSection = navSections.find((section) => section.label === 'Roadmapy');

		expect(roadmapSection?.items.map((item) => item.id)).toEqual(['main-roadmap', 'roadmaps']);
		expect(roadmapSection?.items.map((item) => item.label)).toEqual([
			'Hlavní roadmapa',
			'Roadmaps',
		]);
	});

	test('keeps agent work as one Mission Control cockpit', () => {
		const agentSection = navSections.find((section) => section.label === 'Agenti');

		expect(agentSection?.items.map((item) => item.id)).toEqual(['agent-work']);
		expect(agentSection?.items.map((item) => item.label)).toEqual(['Agent work']);
	});

	test('exposes repository publish as an explicit tool surface', () => {
		const toolsSection = navSections.find((section) => section.label === 'Nástroje');

		expect(toolsSection?.items.map((item) => item.id)).toContain('repository');
		expect(toolsSection?.items.find((item) => item.id === 'repository')?.label).toBe('Publish');
	});
});
