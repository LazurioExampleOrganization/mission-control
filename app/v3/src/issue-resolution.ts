import { ORGANIZATION_ADMIN_FROM_CONFIG } from './paths.ts';
import { DEFAULT_ORGANIZATION_ADMIN_ID } from './workspace-admin.ts';

export const ORGANIZATION_ADMIN_ID =
	ORGANIZATION_ADMIN_FROM_CONFIG ?? DEFAULT_ORGANIZATION_ADMIN_ID;
export const WORKSPACE_ADMIN_ID = ORGANIZATION_ADMIN_ID;

export type IssueResolutionInput = {
	ledgerPath: string;
	issueId: string;
	resolvedBy: string;
	decision: string;
	rationale?: string | null;
	selectedOption?: string | null;
	followUp?: string | null;
};

export type IssueResolutionResult = {
	issue: Record<string, unknown>;
	sourceLedgerPath: string;
	resolvedLedgerPath: string;
	openIssueCount: number;
	resolvedIssueCount: number;
};

export class IssueResolutionError extends Error {
	readonly code = 'legacy_issues_read_only';
	readonly status = 410;
	constructor() {
		super(
			'Legacy issues jsou pouze historie. Aktivní issue řeš v GitHub Issues owning repozitáře.',
		);
		this.name = 'IssueResolutionError';
	}
}

// Retained for old callers: never touch the source ledger or create a fallback writer.
export async function resolveIssue(
	_input: IssueResolutionInput,
	_options: { workspaceRoot?: string; now?: Date } = {},
): Promise<IssueResolutionResult> {
	throw new IssueResolutionError();
}
