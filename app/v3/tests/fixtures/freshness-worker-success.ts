import { getMissionControlFreshness } from '../../../../src/mission-control-pull.mjs';
import type {
	FreshnessWorkerRequest,
	FreshnessWorkerResponse,
} from '../../src/repository-freshness-service.ts';

declare const self: Worker;

self.onmessage = (event: MessageEvent<FreshnessWorkerRequest>) => {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2_000);
	const local = getMissionControlFreshness({
		repositoryDbRoot: event.data.repositoryDbRoot,
		fetch: false,
	});
	self.postMessage({
		ok: true,
		result: {
			...local,
			fetch: {
				ok: true,
				branch: local.status.expectedBranch,
				verifiedHead: local.status.remoteHead,
				timedOut: false,
				reason: null,
				error: null,
			},
			staleFreshness: false,
			pullSafe:
				local.behindRemote && !local.diverged && local.status.clean && local.localDraftCount === 0,
			pullBlockedReason: local.behindRemote ? null : 'up_to_date',
		},
	} satisfies FreshnessWorkerResponse);
};
