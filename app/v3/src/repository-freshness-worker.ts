import { getMissionControlFreshness } from '../../../src/mission-control-pull.mjs';
import type {
	FreshnessWorkerRequest,
	FreshnessWorkerResponse,
} from './repository-freshness-service.ts';

declare const self: Worker;

function workerError(error: unknown): FreshnessWorkerResponse {
	return {
		ok: false,
		error: {
			reason: 'refresh_worker_failed',
			message: error instanceof Error ? error.message : String(error),
			timedOut: false,
		},
	};
}

self.onmessage = (event: MessageEvent<FreshnessWorkerRequest>) => {
	try {
		const request = event.data;
		if (
			!request ||
			typeof request.repositoryDbRoot !== 'string' ||
			!Number.isInteger(request.timeoutMs) ||
			request.timeoutMs <= 0
		) {
			self.postMessage(workerError(new Error('Invalid repository freshness worker request.')));
			return;
		}
		self.postMessage({
			ok: true,
			result: getMissionControlFreshness({
				repositoryDbRoot: request.repositoryDbRoot,
				fetch: true,
				timeoutMs: request.timeoutMs,
			}),
		} satisfies FreshnessWorkerResponse);
	} catch (error) {
		self.postMessage(workerError(error));
	}
};
