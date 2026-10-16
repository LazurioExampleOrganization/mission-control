import { getMissionControlFreshness } from '../../../../src/mission-control-pull.mjs';
import type {
	FreshnessWorkerRequest,
	FreshnessWorkerResponse,
} from '../../src/repository-freshness-service.ts';

declare const self: Worker;

self.onmessage = (event: MessageEvent<FreshnessWorkerRequest>) => {
	const local = getMissionControlFreshness({
		repositoryDbRoot: event.data.repositoryDbRoot,
		fetch: false,
	});
	self.postMessage({
		ok: true,
		result: {
			...local,
			fetch: {
				ok: false,
				branch: local.status.expectedBranch,
				verifiedHead: null,
				timedOut: false,
				reason: 'fetch_failed',
				error: 'Deterministic test-only fetch failure.',
			},
			staleFreshness: true,
			pullSafe: false,
			pullBlockedReason: 'fetch_failed',
		},
	} satisfies FreshnessWorkerResponse);
};
