export type MissionControlRepositoryStatus = {
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
};

export function runMissionControlGitCommand(
	repositoryDbRoot: string,
	args: string[],
	options?: { timeoutMs?: number },
): {
	status: number | null;
	stdout: string;
	stderr: string;
	timedOut: boolean;
};
export function installMissionControlTestDataValidator(
	validatorPath: string,
): () => void;
export function getMissionControlRepositoryFetchBoundaryStatus(options?: {
	repositoryDbRoot?: string;
}): {
	repositoryDbRoot: string;
	expectedBranch: string;
	branchConfigured: boolean;
	controlPlaneTrusted: boolean;
	controlPlaneDriftPaths: string[];
	expectedRemoteUrl: string | null;
	remoteUrl: string | null;
	remoteUrls: string[];
	localGitRoutingOverrides: string[];
	localGitFetchRoutingOverrides: string[];
	remoteConfigured: boolean;
	fetchRemoteMatches: boolean;
	validatedFetchUrl: string | null;
};
export function fetchMissionControlRepositoryRemote(options?: {
	repositoryDbRoot?: string;
	timeoutMs?: number;
}): {
	status: number | null;
	stdout: string;
	stderr: string;
	timedOut: boolean;
	reason: string | null;
	branch: string;
};
export type MissionControlChangesetSummary = {
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
	operations: unknown[];
	changeset: Record<string, unknown>;
};

export function withMissionControlRepositoryWriteLock<T>(
	repositoryDbRoot: string,
	action: () => PromiseLike<T>,
): Promise<Awaited<T>>;
export function withMissionControlRepositoryWriteLock<T>(
	repositoryDbRoot: string,
	action: () => T,
): T extends PromiseLike<unknown> ? Promise<Awaited<T>> : T;
export function getMissionControlRepositoryStatus(options?: {
	repositoryDbRoot?: string;
	fetch?: boolean;
}): MissionControlRepositoryStatus;
export function assertRepositoryReadyForLocalMutation(options?: {
	repositoryDbRoot?: string;
}): MissionControlRepositoryStatus;
export function listMissionControlChangesets(options?: { repositoryDbRoot?: string }): {
	pending: MissionControlChangesetSummary[];
	published: MissionControlChangesetSummary[];
	superseded: MissionControlChangesetSummary[];
};
export type MissionControlLocalDraft = {
	schema_version: 'companiesascode.mission_control.local_draft.v1';
	id: string;
	created_at: string;
	base_commit: string;
	summary: string;
	operations: Array<Record<string, unknown>>;
	draft_revision: string;
	invalid?: boolean;
	error?: string;
};
export function getMissionControlWriterStatus(options?: {
	repositoryDbRoot?: string;
}): {
	mode: string | null;
	writer_ready: boolean;
	local_principal_ready: boolean;
	reason: string | null;
};
export function listMissionControlLocalDrafts(options?: {
	repositoryDbRoot?: string;
}): MissionControlLocalDraft[];
export function createMissionControlLocalDraft(options: {
	repositoryDbRoot?: string;
	draft: Record<string, unknown>;
	now?: Date | string;
}): {
	id: string;
	path: string;
	draft: MissionControlLocalDraft;
};
export function discardMissionControlLocalDraft(options: {
	repositoryDbRoot?: string;
	draftId: string;
}): {
	id: string;
	discarded: true;
};
export function publishMissionControlLocalDraft(options: {
	repositoryDbRoot?: string;
	draftId: string;
	draftRevision: string;
}): {
	id: string;
	summary: string;
	changedPaths: string[];
	commit: { committed: boolean; head: string; pushed: boolean };
};
