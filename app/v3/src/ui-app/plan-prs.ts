import type { PlanRecord } from '../model.ts';

export type PlanPullRequest = {
	devCode: string;
	title: string;
	url: string;
	status: string;
	note?: string;
};

const CLOSED_PR_STATUSES = new Set(['closed', 'merged', 'done', 'reference', 'archived']);

export function openPullRequestsForPlans(plans: PlanRecord[]): PlanPullRequest[] {
	return plans.flatMap((record) =>
		(record.plan.github?.prs ?? [])
			.map(
				(pr): PlanPullRequest => ({
					devCode: record.plan.dev_code,
					title: record.plan.title,
					url: pr.url,
					status: pr.status ?? 'status nezapsán',
					note: pr.note,
				}),
			)
			.filter((pr) => !CLOSED_PR_STATUSES.has(pr.status.toLowerCase())),
	);
}
