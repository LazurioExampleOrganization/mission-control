import {
	createMissionControlLocalDraft,
	discardMissionControlLocalDraft,
	getMissionControlRepositoryStatus,
	getMissionControlWriterStatus,
	listMissionControlChangesets,
	listMissionControlLocalDrafts,
	publishMissionControlLocalDraft,
} from '../../../src/mission-control-publish-flow.mjs';
import { pullMissionControlRepository } from '../../../src/mission-control-pull.mjs';
import { MISSION_CONTROL_DATA_ROOT } from './paths.ts';
import {
	type RepositoryFreshnessService,
	repositoryFreshnessService,
} from './repository-freshness-service.ts';

function errorResponse(error: unknown): Response {
	const explicitCode =
		typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
			? error.code
			: typeof error === 'object' &&
					error !== null &&
					'reason' in error &&
					typeof error.reason === 'string'
				? error.reason
				: null;
	const message = error instanceof Error ? error.message : String(error);
	const code =
		explicitCode ??
		(/permission denied|publickey|authentication failed|could not read username|terminal prompts disabled/i.test(
			message,
		)
			? 'provider_login_required'
			: /non-fast-forward|fetch first|remote contains work/i.test(message)
				? 'remote_advanced'
				: 'repository_db_operation_failed');
	return Response.json(
		{
			error: code,
			message,
		},
		{ status: code === 'repository_db_operation_failed' ? 422 : 409 },
	);
}

function redactedStatus(repositoryDbRoot: string) {
	return getMissionControlRepositoryStatus({ repositoryDbRoot, fetch: false });
}

export function buildRepositoryRuntimeState(repositoryDbRoot = MISSION_CONTROL_DATA_ROOT) {
	// Frozen history is display metadata, not an active draft or write-policy
	// precondition. Do not serialize its nested operation payloads on each poll.
	const history = listMissionControlChangesets({ repositoryDbRoot });
	const summarize = (entries: typeof history.pending) =>
		entries.map(({ operations: _operations, changeset: _changeset, ...metadata }) => metadata);
	return {
		status: redactedStatus(repositoryDbRoot),
		writer: getMissionControlWriterStatus({ repositoryDbRoot }),
		drafts: listMissionControlLocalDrafts({ repositoryDbRoot }),
		changesets: {
			pending: summarize(history.pending),
			published: summarize(history.published),
			superseded: summarize(history.superseded),
		},
	};
}

export async function handleRepositoryStatus(
	repositoryDbRoot = MISSION_CONTROL_DATA_ROOT,
): Promise<Response> {
	try {
		return Response.json(buildRepositoryRuntimeState(repositoryDbRoot));
	} catch (error) {
		return errorResponse(error);
	}
}

export async function handleRepositoryFreshness(
	repositoryDbRoot = MISSION_CONTROL_DATA_ROOT,
	fetch = true,
	service: RepositoryFreshnessService = repositoryFreshnessService,
): Promise<Response> {
	try {
		return Response.json(await service.snapshot(repositoryDbRoot, { refresh: fetch }));
	} catch (error) {
		return errorResponse(error);
	}
}

export async function handleRepositoryPull(
	repositoryDbRoot = MISSION_CONTROL_DATA_ROOT,
): Promise<Response> {
	try {
		const result = pullMissionControlRepository({ repositoryDbRoot });
		return Response.json({
			...result,
			state: buildRepositoryRuntimeState(repositoryDbRoot),
		});
	} catch (error) {
		return errorResponse(error);
	}
}

export async function handleRepositoryChangesetCreate(
	req: Request,
	repositoryDbRoot = MISSION_CONTROL_DATA_ROOT,
): Promise<Response> {
	try {
		const body = (await req.json()) as {
			changeset?: { id?: string; summary?: string; operations?: unknown[] };
		};
		if (!body || typeof body !== 'object' || !body.changeset) {
			return Response.json({ error: 'changeset_required' }, { status: 400 });
		}
		const result = createMissionControlLocalDraft({
			repositoryDbRoot,
			draft: body.changeset,
		});
		return Response.json(
			{
				draft: result.draft,
				state: buildRepositoryRuntimeState(repositoryDbRoot),
			},
			{ status: 201 },
		);
	} catch (error) {
		return errorResponse(error);
	}
}

export async function handleRepositoryChangesetDiscard(
	changesetId: string,
	repositoryDbRoot = MISSION_CONTROL_DATA_ROOT,
): Promise<Response> {
	try {
		const result = discardMissionControlLocalDraft({
			repositoryDbRoot,
			draftId: changesetId,
		});
		return Response.json({
			...result,
			state: buildRepositoryRuntimeState(repositoryDbRoot),
		});
	} catch (error) {
		return errorResponse(error);
	}
}

export async function handleRepositoryChangesetPublish(
	changesetId: string,
	req: Request,
	repositoryDbRoot = MISSION_CONTROL_DATA_ROOT,
): Promise<Response> {
	try {
		const body = (await req.json()) as { draft_revision?: unknown };
		if (!body || typeof body !== 'object' || typeof body.draft_revision !== 'string') {
			return Response.json({ error: 'draft_revision_required' }, { status: 400 });
		}
		const result = publishMissionControlLocalDraft({
			repositoryDbRoot,
			draftId: changesetId,
			draftRevision: body.draft_revision,
		});
		return Response.json({
			publication: {
				id: result.id,
				summary: result.summary,
				changed_paths: result.changedPaths,
			},
			commit: result.commit,
			state: buildRepositoryRuntimeState(repositoryDbRoot),
		});
	} catch (error) {
		return errorResponse(error);
	}
}
