import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PlanRecord } from '../model.ts';
import {
	type AgentWorkResponse,
	api,
	type RepositoryRuntimeState,
	type RoadmapsResponse,
	type WorkBoardResponse,
} from './api.ts';
import { DraftStatusBar } from './components/DraftStatusBar.tsx';
import { loadInitialAppData } from './initial-load.ts';
import { Layout } from './Layout.tsx';
import { type PageId, STATUS_FILTER_TO_PLAN_STATUS } from './navigation.ts';
import { AgentWorkPage } from './pages/AgentWork.tsx';
import { NewPlanPage } from './pages/NewPlan.tsx';
import { PlanDetail } from './pages/PlanDetail.tsx';
import { PlanList } from './pages/PlanList.tsx';
import { PlanningCoverage } from './pages/PlanningCoverage.tsx';
import { ProposalsPage } from './pages/Proposals.tsx';
import { RepositoryPage } from './pages/Repository.tsx';
import { RoadmapsPage } from './pages/Roadmaps.tsx';
import { ValidateAllPage } from './pages/ValidateAll.tsx';
import { WorkBoardPage } from './pages/WorkBoard.tsx';
import { openPullRequestsForPlans } from './plan-prs.ts';

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function pageTitle(page: PageId): { title: string; subtitle: string } {
	switch (page) {
		case 'roadmaps':
			return {
				title: 'Roadmaps',
				subtitle: 'RM roadmapy, priority, next runnable step a read-only detail kroků',
			};
		case 'plans-all':
			return { title: 'Roadmapa', subtitle: 'Všechny Mission Control plány podle priority' };
		case 'plans-shaping':
			return { title: 'Shaping', subtitle: 'Plány v draftu, scope se ještě doplňuje' };
		case 'plans-ready':
			return { title: 'Ready', subtitle: 'Plány připravené k implementaci' };
		case 'plans-in-progress':
			return { title: 'In progress', subtitle: 'Plány v aktivní implementaci' };
		case 'plans-review':
			return { title: 'Review', subtitle: 'Plány v PR review' };
		case 'plans-done':
			return { title: 'Done', subtitle: 'Dokončené plány s evidence v DONE.tasks.json' };
		case 'plans-archived':
			return { title: 'Archived', subtitle: 'Archivované referenční plány' };
		case 'agent-work':
			return {
				title: 'Agent work',
				subtitle: 'Rozhodnutí, aktivní práce, insighty a stav ledgerů',
			};
		case 'work-board':
			return { title: 'Work board', subtitle: 'TODO/DONE/ISSUES navázané na plány' };
		case 'planning-coverage':
			return {
				title: 'Planning coverage',
				subtitle: 'Vazby mezi workspace ledgery a Mission Control plány',
			};
		case 'proposals':
			return {
				title: 'Proposals',
				subtitle: 'Design wireframy: playground před implementací, accepted vždy s plánem',
			};
		case 'repository':
			return {
				title: 'Publish',
				subtitle: 'Repository-db status, local draft review and native Git publish flow',
			};
		case 'new-plan':
			return {
				title: 'Nový plán',
				subtitle: 'Založit nový Mission Control plan s dalším volným kódem',
			};
		case 'validate':
			return { title: 'Validovat', subtitle: 'Spustit cross-plan validaci nad všemi plány' };
	}
}

export default function App() {
	const [activePage, setActivePage] = useState<PageId>('plans-all');
	const [selectedDevCode, setSelectedDevCode] = useState<string | null>(null);
	const [plans, setPlans] = useState<PlanRecord[]>([]);
	const [roadmaps, setRoadmaps] = useState<RoadmapsResponse | null>(null);
	const [repositoryState, setRepositoryState] = useState<RepositoryRuntimeState | null>(null);
	const [repositoryLoading, setRepositoryLoading] = useState(false);
	const [repositoryError, setRepositoryError] = useState<string | null>(null);
	const [board, setBoard] = useState<WorkBoardResponse['board'] | null>(null);
	const [agentWork, setAgentWork] = useState<AgentWorkResponse['agentWork'] | null>(null);
	const [agentWorkLoading, setAgentWorkLoading] = useState(false);
	const [agentWorkError, setAgentWorkError] = useState<string | null>(null);
	const [workBoardError, setWorkBoardError] = useState<string | null>(null);
	const [roadmapsError, setRoadmapsError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const loadAgentWork = useCallback(async () => {
		setAgentWorkLoading(true);
		setAgentWorkError(null);
		try {
			const agentWorkResponse = await api.agentWork();
			setAgentWork(agentWorkResponse.agentWork);
		} catch (err) {
			setAgentWork(null);
			setAgentWorkError(err instanceof Error ? err.message : String(err));
		} finally {
			setAgentWorkLoading(false);
		}
	}, []);

	const loadRepository = useCallback(async (nextState?: RepositoryRuntimeState) => {
		if (nextState) {
			setRepositoryState(nextState);
			setRepositoryError(null);
			return;
		}
		setRepositoryLoading(true);
		setRepositoryError(null);
		try {
			setRepositoryState(await api.repositoryStatus());
		} catch (err) {
			setRepositoryError(errorMessage(err));
		} finally {
			setRepositoryLoading(false);
		}
	}, []);

	const loadAll = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const initialData = await loadInitialAppData();
			setPlans(initialData.plans);
			setBoard(initialData.board);
			setRoadmaps(initialData.roadmaps);
			setRoadmapsError(initialData.roadmapsError);
			setWorkBoardError(null);
			void loadAgentWork();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}, [loadAgentWork]);

	useEffect(() => {
		loadAll();
	}, [loadAll]);

	const filteredPlans = useMemo(() => {
		if (activePage === 'plans-all') return plans;
		if (!(activePage in STATUS_FILTER_TO_PLAN_STATUS)) return plans;
		const status =
			STATUS_FILTER_TO_PLAN_STATUS[activePage as keyof typeof STATUS_FILTER_TO_PLAN_STATUS];
		return plans.filter((record) => record.plan.status === status);
	}, [plans, activePage]);

	const isPlanListPage = activePage === 'plans-all' || activePage in STATUS_FILTER_TO_PLAN_STATUS;

	function handleNavigate(page: PageId) {
		setActivePage(page);
		setSelectedDevCode(null);
		if (page === 'repository') {
			void loadRepository();
		}
	}

	function handleSelectPlan(devCode: string) {
		setSelectedDevCode(devCode);
	}

	function renderContent() {
		if (loading) return <div className='panel'>Načítám…</div>;
		if (error) return <div className='panel error-text'>{error}</div>;
		if (selectedDevCode && isPlanListPage) {
			return (
				<PlanDetail
					devCode={selectedDevCode}
					onBack={() => setSelectedDevCode(null)}
					onSaved={loadAll}
				/>
			);
		}
		if (activePage === 'roadmaps') {
			return <RoadmapsPage response={roadmaps} loading={false} error={roadmapsError} />;
		}
		if (isPlanListPage) {
			return <PlanList records={filteredPlans} onSelect={handleSelectPlan} />;
		}
		if (activePage === 'work-board') {
			return <WorkBoardPage board={board} plans={plans} error={workBoardError} />;
		}
		if (activePage === 'agent-work') {
			return (
				<AgentWorkPage
					agentWork={agentWork}
					agentWorkError={agentWorkError}
					agentWorkLoading={agentWorkLoading}
					board={board}
					workBoardError={workBoardError}
				/>
			);
		}
		if (activePage === 'planning-coverage') {
			return <PlanningCoverage board={board} />;
		}
		if (activePage === 'proposals') {
			return (
				<ProposalsPage
					plans={plans}
					onOpenPlan={(devCode) => {
						setActivePage('plans-all');
						setSelectedDevCode(devCode);
					}}
				/>
			);
		}
		if (activePage === 'repository') {
			return (
				<RepositoryPage
					state={repositoryState}
					loading={repositoryLoading}
					error={repositoryError}
					onRefresh={loadRepository}
				/>
			);
		}
		if (activePage === 'new-plan') {
			return (
				<NewPlanPage
					onCreated={async (devCode) => {
						await loadAll();
						setActivePage('plans-all');
						setSelectedDevCode(devCode);
					}}
				/>
			);
		}
		if (activePage === 'validate') {
			return <ValidateAllPage />;
		}
		return null;
	}

	const { title, subtitle } = pageTitle(activePage);

	return (
		<Layout
			activePage={activePage}
			onNavigate={handleNavigate}
			headerSlot={<DraftStatusBar onOpenRepository={() => handleNavigate('repository')} />}
		>
			<header>
				<h1 className='page-title'>{title}</h1>
				<p className='page-subtitle'>{subtitle}</p>
			</header>
			<SummaryStrip plans={plans} board={board} agentWork={agentWork} />
			{renderContent()}
		</Layout>
	);
}

function SummaryStrip({
	plans,
	board,
	agentWork,
}: {
	plans: PlanRecord[];
	board: WorkBoardResponse['board'] | null;
	agentWork: AgentWorkResponse['agentWork'] | null;
}) {
	const coverage = board?.planning_coverage;
	const openPrCount = openPullRequestsForPlans(plans).length;
	const items: Array<{ label: string; value: string | number; tone?: 'ok' | 'warning' | 'error' }> =
		[
			{ label: 'Plány', value: plans.length },
			{
				label: 'TODO s plánem',
				value: coverage?.todo_with_plan ?? '–',
				tone: coverage && coverage.todo_with_plan > 0 ? 'ok' : undefined,
			},
			{
				label: 'TODO bez plánu',
				value: coverage?.todo_without_plan ?? '–',
				tone: coverage?.todo_without_plan && coverage.todo_without_plan > 0 ? 'warning' : undefined,
			},
			{
				label: 'Rozbité vazby',
				value: coverage?.broken_plan_links.length ?? '–',
				tone: coverage && coverage.broken_plan_links.length > 0 ? 'error' : undefined,
			},
			{
				label: 'ISSUES k rozhodnutí',
				value: agentWork?.cockpit.decisions.total ?? '–',
				tone: agentWork && agentWork.cockpit.decisions.total > 0 ? 'error' : undefined,
			},
			{
				label: 'PR k review',
				value: openPrCount,
				tone: openPrCount > 0 ? 'warning' : 'ok',
			},
		];

	return (
		<div className='summary-grid'>
			{items.map((item) => (
				<div key={item.label} className={`summary-card${item.tone ? ` ${item.tone}` : ''}`}>
					<span>{item.label}</span>
					<strong>{item.value}</strong>
				</div>
			))}
		</div>
	);
}
