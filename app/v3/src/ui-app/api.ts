import type { MissionAgentWorkResponse } from '../agent-work/contract.ts';
import type { MissionControlPlan, PlanRecord } from '../model.ts';
import type { MissionControlRoadmap, RoadmapStep, RoadmapsApiResponse } from '../roadmap-model.ts';

export type PlanListResponse = { records: PlanRecord[] };
export type RoadmapsResponse = RoadmapsApiResponse;

export type RoadmapStepDraftResponse = {
	status: 'dry-run';
	write_applied: false;
	roadmap_code: string;
	workspacePath: string;
	step: RoadmapStep;
	yaml: string;
	diff: string;
	validation: {
		ok: boolean;
		failures: string[];
		errors: Array<{ path: string; message: string }>;
	};
};

export type RoadmapDraftResponse = {
	status: 'dry-run';
	write_applied: false;
	roadmap_code: string;
	workspacePath: string;
	path: string;
	roadmap: MissionControlRoadmap;
	yaml: string;
	validation: {
		ok: boolean;
		failures: string[];
		errors: Array<{ path: string; message: string }>;
	};
};

export type PlanDetailResponse = PlanRecord & { yaml: string };

export type WorkBoardResponse = {
	board: {
		planning_coverage: {
			todo_with_plan: number;
			todo_without_plan: number;
			dev_without_plan: Array<{ id: string; dev_code: string | null }>;
			broken_plan_links: Array<{
				id: string;
				ledger_path: string;
				dev_code: string | null;
				planning_status: string;
				planning_errors: Array<{ message: string }>;
			}>;
			ledger_read_errors: Array<{ ledger_path: string; message: string }>;
		};
	};
};

export type AgentWorkResponse = MissionAgentWorkResponse;

export type NextDevCodeResponse = {
	next_dev_code: string;
	highest_known: string | null;
	reserved_count: number;
};

export type ValidationResponse = {
	ok: boolean;
	errors?: Array<{ path: string; message: string }>;
};

export type RepositoryStatus = {
	repositoryDbRoot: string;
	expectedBranch: string;
	branchConfigured: boolean;
	controlPlaneTrusted: boolean;
	controlPlaneDriftPaths: string[];
	currentBranch: string;
	head: string;
	expectedRemoteUrl: string | null;
	remoteUrl: string | null;
	remoteUrls: string[];
	pushRemoteUrl: string | null;
	pushRemoteUrls: string[];
	localGitRoutingOverrides: string[];
	localGitFetchRoutingOverrides: string[];
	remoteConfigured: boolean;
	fetchRemoteMatches: boolean;
	remoteMatches: boolean;
	commitIdentityConfigured: boolean;
	clean: boolean;
	dirty: string[];
	ahead: number | null;
	behind: number | null;
	remoteRefExists: boolean;
	remoteHead: string | null;
};

export type RepositoryChangesetSummary = {
	id: string;
	status: string;
	summary: string;
	created_at: string | null;
	created_by: string | null;
	approved_at: string | null;
	approved_by: string | null;
	published_at: string | null;
	published_by: string | null;
	superseded_at: string | null;
	superseded_by: string | null;
	supersession_role: string | null;
	supersession_reason: string | null;
	replacement_changeset_id: string | null;
	relativePath: string;
	operations: Array<Record<string, unknown>>;
};

export type RepositoryRuntimeState = {
	status: RepositoryStatus;
	writer: {
		mode: string | null;
		writer_ready?: boolean;
		local_principal_ready: boolean;
		reason: string | null;
	};
	drafts: Array<{
		id: string;
		created_at: string;
		base_commit: string;
		summary: string;
		operations: Array<Record<string, unknown>>;
		draft_revision: string;
		invalid?: boolean;
		error?: string;
	}>;
	changesets: {
		pending: RepositoryChangesetSummary[];
		published: RepositoryChangesetSummary[];
		superseded?: RepositoryChangesetSummary[];
	};
};

export type RepositoryFreshness = {
	status: RepositoryStatus;
	fetch: {
		ok: boolean;
		branch: string | null;
		verifiedHead: string | null;
		timedOut: boolean;
		reason: string | null;
		error: string | null;
	};
	// True když fetch nedoběhl (offline/credential/timeout) — freshness je
	// spočítaná proti starému origin ref, takže "aktuální" nesmí UI brát jako
	// potvrzené.
	staleFreshness: boolean;
	behind: number;
	ahead: number;
	behindRemote: boolean;
	diverged: boolean;
	newerAvailable: boolean;
	localDraftCount: number;
	pullSafe: boolean;
	pullBlockedReason: string | null;
	checkedAt: string;
	refreshing: boolean;
	refreshState: 'idle' | 'refreshing' | 'succeeded' | 'failed';
	refreshStartedAt: string | null;
	refreshCompletedAt: string | null;
	refreshError: {
		reason: string;
		message: string;
		timedOut: boolean;
	} | null;
};

export type RepositoryPullResult = {
	pulled: boolean;
	reason: string;
	fromHead: string;
	toHead: string;
	status: RepositoryStatus;
	state: RepositoryRuntimeState;
};

export type ExportDryRunResponse = {
	dev_code: string;
	proposal: { added: unknown[]; updated: unknown[] };
};

export type ProposalMetadata = {
	id: string;
	slug: string;
	title: string;
	status: string;
	owner: string;
	created_at: string;
	updated_at: string;
	summary: string;
	wireframe: string;
	dev_code?: string | null;
	design_notes?: string;
	links?: Array<{ label: string; path?: string; url?: string }>;
};

export type ProposalsResponse = {
	proposals: Array<{
		folder: string;
		path: string;
		proposal: ProposalMetadata | null;
		parse_error: string | null;
		wireframe_href: string | null;
		design_notes_href: string | null;
	}>;
	failures: string[];
};

let localSessionToken: Promise<string> | null = null;

async function sessionToken(): Promise<string> {
	if (!localSessionToken) {
		localSessionToken = fetch('/api/session')
			.then(async (response) => {
				const body = (await response.json()) as { token?: unknown; message?: unknown };
				if (!response.ok || typeof body.token !== 'string') {
					throw new Error(
						typeof body.message === 'string' ? body.message : 'Lokální session není dostupná.',
					);
				}
				return body.token;
			})
			.catch((error) => {
				localSessionToken = null;
				throw error;
			});
	}
	return localSessionToken;
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
	const method = init?.method?.toUpperCase() ?? 'GET';
	const headers = new Headers(init?.headers);
	headers.set('content-type', 'application/json');
	if (method !== 'GET' && method !== 'HEAD') {
		headers.set('x-mission-control-session', await sessionToken());
	}
	const res = await fetch(url, {
		...init,
		headers,
	});
	const data = await res.json();
	if (!res.ok) {
		const message =
			(data as { message?: string; error?: string }).message ||
			(data as { error?: string }).error ||
			JSON.stringify((data as { errors?: unknown }).errors || data);
		throw new Error(message);
	}
	return data as T;
}

export const api = {
	listPlans: () => jsonFetch<PlanListResponse>('/api/plans'),
	roadmaps: () => jsonFetch<RoadmapsResponse>('/api/roadmaps'),
	draftRoadmap: (payload: Record<string, unknown>) =>
		jsonFetch<RoadmapDraftResponse>('/api/roadmaps/draft', {
			method: 'POST',
			body: JSON.stringify(payload),
		}),
	draftRoadmapStep: (roadmapCode: string, payload: Record<string, unknown>) =>
		jsonFetch<RoadmapStepDraftResponse>(
			`/api/roadmaps/${encodeURIComponent(roadmapCode)}/steps/draft`,
			{ method: 'POST', body: JSON.stringify(payload) },
		),
	proposals: () => jsonFetch<ProposalsResponse>('/api/proposals'),
	workBoard: () => jsonFetch<WorkBoardResponse>('/api/work-board'),
	agentWork: () => jsonFetch<AgentWorkResponse>('/api/agent-work'),
	nextDevCode: () => jsonFetch<NextDevCodeResponse>('/api/next-dev-code'),
	validate: () => jsonFetch<ValidationResponse>('/api/validate'),
	repositoryStatus: () => jsonFetch<RepositoryRuntimeState>('/api/repository/status'),
	repositoryFreshness: (fetchRemote = true) =>
		jsonFetch<RepositoryFreshness>(`/api/repository/freshness${fetchRemote ? '' : '?fetch=0'}`),
	repositoryPull: () => jsonFetch<RepositoryPullResult>('/api/repository/pull', { method: 'POST' }),
	createRepositoryChangeset: (payload: Record<string, unknown>) =>
		jsonFetch<{ draft: Record<string, unknown>; state: RepositoryRuntimeState }>(
			'/api/repository/changesets',
			{ method: 'POST', body: JSON.stringify(payload) },
		),
	discardRepositoryChangeset: (changesetId: string) =>
		jsonFetch<{ id: string; discarded: true; state: RepositoryRuntimeState }>(
			`/api/repository/changesets/${encodeURIComponent(changesetId)}`,
			{ method: 'DELETE', body: '{}' },
		),
	publishRepositoryChangeset: (changesetId: string, payload: Record<string, unknown>) =>
		jsonFetch<{
			publication: { id: string; summary: string; changed_paths: string[] };
			commit: { head: string; pushed: boolean };
			state: RepositoryRuntimeState;
		}>(`/api/repository/changesets/${encodeURIComponent(changesetId)}/publish`, {
			method: 'POST',
			body: JSON.stringify(payload),
		}),
	planDetail: (idOrDevCode: string) =>
		jsonFetch<PlanDetailResponse>(`/api/plans/${encodeURIComponent(idOrDevCode)}`),
	savePlanYaml: (idOrDevCode: string, yaml: string) =>
		jsonFetch<{ record: PlanRecord; validation: ValidationResponse }>(
			`/api/plans/${encodeURIComponent(idOrDevCode)}`,
			{ method: 'PUT', body: JSON.stringify({ yaml }) },
		),
	createPlan: (payload: Record<string, unknown>) =>
		jsonFetch<{
			record?: PlanRecord;
			yaml?: string;
			validation: ValidationResponse;
			status?: string;
			dev_code?: string;
			plan?: MissionControlPlan;
		}>('/api/plans', { method: 'POST', body: JSON.stringify(payload) }),
	exportTodo: (idOrDevCode: string) =>
		jsonFetch<ExportDryRunResponse>(`/api/plans/${encodeURIComponent(idOrDevCode)}/export`),
};
