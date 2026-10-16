import { describe, expect, test } from 'bun:test';
import type { WorkBoardResponse } from '../src/ui-app/api.ts';
import { loadInitialAppData } from '../src/ui-app/initial-load.ts';

const boardFixture: WorkBoardResponse['board'] = {
	planning_coverage: {
		todo_with_plan: 1,
		todo_without_plan: 0,
		dev_without_plan: [],
		broken_plan_links: [],
		ledger_read_errors: [],
	},
};

describe('Mission Control initial app load', () => {
	test('keeps core app data available when Roadmaps fetch fails', async () => {
		const data = await loadInitialAppData({
			listPlans: async () => ({ records: [] }),
			workBoard: async () => ({ board: boardFixture }),
			roadmaps: async () => {
				throw new Error('roadmaps unavailable');
			},
		});

		expect(data.plans).toEqual([]);
		expect(data.board).toBe(boardFixture);
		expect(data.roadmaps).toBeNull();
		expect(data.roadmapsError).toBe('roadmaps unavailable');
	});
});
