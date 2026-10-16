import { readFile } from 'node:fs/promises';
import {
	listWorkspaceLedgerFiles,
	PLAN_CODE_IN_TEXT_RE,
	PLAN_CODE_RE,
	planCodeFromNumber,
	planCodeNumber,
	workspaceRelative,
} from './paths.ts';
import { listPlanRecords } from './store.ts';

export type DevCodeReservationSource = 'mission-control-plan' | 'workspace-ledger' | 'text-mention';

export type DevCodeReservation = {
	dev_code: string;
	source: DevCodeReservationSource;
	path: string;
	field?: string;
};

export type NextDevCodeResult = {
	next_dev_code: string;
	highest_known: string | null;
	reserved_count: number;
	reserved_codes: string[];
	reservations: DevCodeReservation[];
};

function normalizeDevCode(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim().toUpperCase();
	return PLAN_CODE_RE.test(trimmed) ? trimmed : null;
}

export function nextDevCodeFromCodes(codes: Iterable<string>): string {
	let max = 0;
	for (const code of codes) {
		const normalized = normalizeDevCode(code);
		if (!normalized) continue;
		const value = planCodeNumber(normalized);
		if (value > max) max = value;
	}
	return planCodeFromNumber(max + 1);
}

function addReservation(
	reservations: DevCodeReservation[],
	devCode: unknown,
	source: DevCodeReservationSource,
	filePath: string,
	field?: string,
) {
	const normalized = normalizeDevCode(devCode);
	if (!normalized) return;
	reservations.push({
		dev_code: normalized,
		source,
		path: workspaceRelative(filePath),
		field,
	});
}

function collectFromValue(
	value: unknown,
	reservations: DevCodeReservation[],
	filePath: string,
	fieldPath: string,
) {
	if (!value || typeof value !== 'object') return;
	if (Array.isArray(value)) {
		value.forEach((item, index) =>
			collectFromValue(item, reservations, filePath, `${fieldPath}.${index}`),
		);
		return;
	}

	const object = value as Record<string, unknown>;
	addReservation(
		reservations,
		object.dev_code,
		'workspace-ledger',
		filePath,
		`${fieldPath}.dev_code`,
	);
	addReservation(
		reservations,
		object.custom_id,
		'workspace-ledger',
		filePath,
		`${fieldPath}.custom_id`,
	);
	if (object.planning && typeof object.planning === 'object') {
		addReservation(
			reservations,
			(object.planning as Record<string, unknown>).dev_code,
			'workspace-ledger',
			filePath,
			`${fieldPath}.planning.dev_code`,
		);
	}
	if (Array.isArray(object.tags)) {
		for (const tag of object.tags) {
			addReservation(reservations, tag, 'workspace-ledger', filePath, `${fieldPath}.tags`);
		}
	}
	if (Array.isArray(object.custom_ids)) {
		for (const customId of object.custom_ids) {
			addReservation(
				reservations,
				customId,
				'workspace-ledger',
				filePath,
				`${fieldPath}.custom_ids`,
			);
		}
	}
}

// Parita s root scripts/mission-control-lib.mjs (collectReservedNumbers):
// KAŽDÁ textová zmínka kódu rezervuje číslo, aby se kód zmiňovaný v textu
// plánu nebo ledgeru nikdy nepřidělil znovu jinému plánu.
function addTextMentions(reservations: DevCodeReservation[], raw: string, filePath: string) {
	for (const match of raw.matchAll(PLAN_CODE_IN_TEXT_RE)) {
		addReservation(reservations, match[0], 'text-mention', filePath);
	}
}

async function collectLedgerReservations(): Promise<DevCodeReservation[]> {
	const reservations: DevCodeReservation[] = [];
	for (const filePath of await listWorkspaceLedgerFiles()) {
		let raw: string;
		try {
			raw = await readFile(filePath, 'utf8');
		} catch {
			continue;
		}
		addTextMentions(reservations, raw, filePath);
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			continue;
		}
		if (!parsed || typeof parsed !== 'object') continue;
		const object = parsed as Record<string, unknown>;
		collectFromValue(object.tasks, reservations, filePath, 'tasks');
		collectFromValue(object.issues, reservations, filePath, 'issues');
		collectFromValue(object.decisions, reservations, filePath, 'decisions');
	}
	return reservations;
}

export async function collectDevCodeReservations(): Promise<DevCodeReservation[]> {
	const reservations: DevCodeReservation[] = [];
	for (const record of await listPlanRecords()) {
		addReservation(
			reservations,
			record.plan.dev_code,
			'mission-control-plan',
			record.absolutePath,
			'dev_code',
		);
		addTextMentions(reservations, await readFile(record.absolutePath, 'utf8'), record.absolutePath);
	}
	reservations.push(...(await collectLedgerReservations()));
	return reservations;
}

export async function nextDevCode(): Promise<NextDevCodeResult> {
	const reservations = await collectDevCodeReservations();
	const reservedCodes = [...new Set(reservations.map((item) => item.dev_code))].sort();
	const next = nextDevCodeFromCodes(reservedCodes);
	const highest = reservedCodes.at(-1) ?? null;
	return {
		next_dev_code: next,
		highest_known: highest,
		reserved_count: reservedCodes.length,
		reserved_codes: reservedCodes,
		reservations,
	};
}

if (import.meta.main) {
	const result = await nextDevCode();
	if (process.argv.includes('--plain')) {
		console.log(result.next_dev_code);
	} else if (process.argv.includes('--reservations')) {
		console.log(JSON.stringify(result, null, 2));
	} else {
		const matches = (JSON.stringify(result.reserved_codes).match(PLAN_CODE_IN_TEXT_RE) ?? [])
			.length;
		console.log(
			JSON.stringify(
				{
					next_dev_code: result.next_dev_code,
					highest_known: result.highest_known,
					reserved_count: result.reserved_count,
					reserved_code_mentions: matches,
				},
				null,
				2,
			),
		);
	}
}
