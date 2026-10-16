import type { PlanRecord } from '../model.ts';
import {
	api,
	type PlanListResponse,
	type RoadmapsResponse,
	type WorkBoardResponse,
} from './api.ts';

export type InitialAppFetchers = Pick<typeof api, 'listPlans' | 'workBoard' | 'roadmaps'>;

export type InitialAppData = {
	plans: PlanRecord[];
	board: WorkBoardResponse['board'];
	roadmaps: RoadmapsResponse | null;
	roadmapsError: string | null;
};

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function optionalRoadmaps(
	fetcher: () => Promise<RoadmapsResponse>,
): Promise<{ roadmaps: RoadmapsResponse | null; roadmapsError: string | null }> {
	try {
		return { roadmaps: await fetcher(), roadmapsError: null };
	} catch (error) {
		return { roadmaps: null, roadmapsError: errorMessage(error) };
	}
}

export async function loadInitialAppData(
	fetchers: InitialAppFetchers = api,
): Promise<InitialAppData> {
	const [planList, boardResponse, roadmapsResult] = await Promise.all([
		fetchers.listPlans() as Promise<PlanListResponse>,
		fetchers.workBoard(),
		optionalRoadmaps(fetchers.roadmaps),
	]);

	return {
		plans: planList.records,
		board: boardResponse.board,
		roadmaps: roadmapsResult.roadmaps,
		roadmapsError: roadmapsResult.roadmapsError,
	};
}
