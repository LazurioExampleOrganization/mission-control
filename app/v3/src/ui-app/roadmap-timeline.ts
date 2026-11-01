// View model sekce Hlavní roadmapa. Nic neukládá: pořadí i stav kroků
// odvozuje z toho, co roadmapa už drží (termín, pořadí kroků, status),
// a hlavní roadmapu z příznaku `main: true`.

import type { PlanRecord } from '../model.ts';
import type { RoadmapApiRecord, RoadmapStep } from '../roadmap-model.ts';
import {
	type RoadmapPeriod,
	type RoadmapTimingConfidence,
	type RoadmapTimingWindow,
	roadmapTimingWindow,
} from '../roadmap-timing.ts';

export type LeaderState = 'planned' | 'in_progress' | 'blocked' | 'done';

export const LEADER_STATES: LeaderState[] = ['planned', 'in_progress', 'blocked', 'done'];

export const LEADER_STATE_LABELS: Record<LeaderState, string> = {
	planned: 'Plánováno',
	in_progress: 'Probíhá',
	blocked: 'Blokováno',
	done: 'Hotovo',
};

// Třída `status-badge` se stejným symbolem a barvou jako ve zbytku aplikace.
export const LEADER_STATE_BADGES: Record<LeaderState, string> = {
	planned: 'shaping',
	in_progress: 'in_progress',
	blocked: 'blocked',
	done: 'done',
};

export const CONFIDENCE_LABELS: Record<RoadmapTimingConfidence, string> = {
	committed: 'Závazné',
	likely: 'Pravděpodobné',
	tentative: 'Orientační',
};

const MONTH_NAMES = [
	'leden',
	'únor',
	'březen',
	'duben',
	'květen',
	'červen',
	'červenec',
	'srpen',
	'září',
	'říjen',
	'listopad',
	'prosinec',
];

// Dnešek rozšíří osu nejvýš o rok; vzdálenější „dnes“ by osu jen natáhlo.
const MAX_TODAY_EXTENSION_MONTHS = 12;

/** Archivovaný krok na osu nepatří; neznámý status se ukáže jako plánovaný. */
export function leaderStateOf(status: unknown): LeaderState | null {
	switch (status) {
		case 'done':
			return 'done';
		case 'blocked':
			return 'blocked';
		case 'in_progress':
		case 'review':
			return 'in_progress';
		case 'archived':
			return null;
		default:
			return 'planned';
	}
}

function quarterOf(month: number): number {
	return Math.floor((month % 12) / 3) + 1;
}

function quarterLabel(month: number): string {
	return `Q${quarterOf(month)} ${Math.floor(month / 12)}`;
}

export function formatRoadmapPeriod(period: RoadmapPeriod, withYear = true): string {
	const label =
		period.kind === 'quarter'
			? `Q${quarterOf(period.startMonth)}`
			: MONTH_NAMES[period.startMonth % 12];
	return withYear ? `${label} ${period.year}` : label;
}

export function formatTimingWindow(window: RoadmapTimingWindow): string {
	const { from, to } = window;
	if (!from || (from.startMonth === to.startMonth && from.endMonth === to.endMonth)) {
		return formatRoadmapPeriod(to);
	}
	const fromLabel = formatRoadmapPeriod(from, from.year !== to.year);
	return `${fromLabel} – ${formatRoadmapPeriod(to)}`;
}

export function formatCzechDate(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(value);
	if (!match) return null;
	return `${Number(match[3])}. ${Number(match[2])}. ${match[1]}`;
}

/** Český plurál: 1 krok, 2–4 kroky, 5 kroků. */
export function pluralCs(count: number, forms: [string, string, string]): string {
	if (count === 1) return forms[0];
	if (count >= 2 && count <= 4) return forms[1];
	return forms[2];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0;
}

function isTimelineStep(value: unknown): value is RoadmapStep {
	return isRecord(value) && isNonEmptyString(value.id) && isNonEmptyString(value.title);
}

export type MainRoadmapSelection = {
	record: RoadmapApiRecord | null;
	/**
	 * `main` = právě jedna roadmapa nese `main: true`; `conflict` = nese ho víc
	 * (validace je červená, ukáže se první); `only` = jediná roadmapa bez
	 * příznaku; `fallback` = víc roadmap bez příznaku, ukáže se rozpracovaná
	 * nebo první aktivní; `none` = žádná roadmapa.
	 */
	source: 'main' | 'conflict' | 'only' | 'fallback' | 'none';
	mainCodes: string[];
};

export function selectMainRoadmap(records: RoadmapApiRecord[]): MainRoadmapSelection {
	const usable = records.filter((record) => isNonEmptyString(record?.roadmap?.roadmap_code));
	const mainRecords = usable.filter((record) => record.roadmap.main === true);
	const mainCodes = mainRecords.map((record) => record.roadmap.roadmap_code);
	if (mainRecords.length === 1) return { record: mainRecords[0], source: 'main', mainCodes };
	if (mainRecords.length > 1) return { record: mainRecords[0], source: 'conflict', mainCodes };
	if (usable.length === 0) return { record: null, source: 'none', mainCodes };
	if (usable.length === 1) return { record: usable[0], source: 'only', mainCodes };
	const active = usable.filter((record) => record.roadmap.status !== 'archived');
	const candidates = active.length > 0 ? active : usable;
	return {
		record: candidates.find((record) => record.roadmap.status === 'in_progress') ?? candidates[0],
		source: 'fallback',
		mainCodes,
	};
}

export type TimelineRow = {
	step: RoadmapStep;
	/** Pořadí kroku v YAML, rozhoduje při stejném termínu. */
	index: number;
	state: LeaderState;
	window: RoadmapTimingWindow | null;
	timingLabel: string | null;
	confidence: RoadmapTimingConfidence | null;
	/** Čtvrtletí, kdy krok přijde; podle něj se seskupuje úzké zobrazení. */
	groupLabel: string | null;
	/** Poloha a šířka pruhu v procentech osy. */
	offset: number;
	span: number;
	isNext: boolean;
};

export type TimelineColumn = {
	key: string;
	quarter: string;
	/** Rok se vypisuje u prvního sloupce a u každého Q1. */
	year: number | null;
};

export type RoadmapTimeline = {
	columns: TimelineColumn[];
	todayOffset: number | null;
	scheduled: TimelineRow[];
	unscheduled: TimelineRow[];
	archivedCount: number;
	invalidTimingCount: number;
	counts: Record<LeaderState, number> & { total: number };
	next: TimelineRow | null;
	/** Čtvrtletí dneška; úzké zobrazení u něj ukáže „toto čtvrtletí“. */
	currentGroupLabel: string;
};

export function buildRoadmapTimeline(steps: unknown, today: Date = new Date()): RoadmapTimeline {
	const rows: TimelineRow[] = [];
	let archivedCount = 0;
	let invalidTimingCount = 0;
	(Array.isArray(steps) ? steps : []).forEach((step: unknown, index) => {
		if (!isTimelineStep(step)) return;
		const state = leaderStateOf(step.status);
		if (!state) {
			archivedCount += 1;
			return;
		}
		const window = roadmapTimingWindow(step.timing);
		if (step.timing !== undefined && !window) invalidTimingCount += 1;
		rows.push({
			step,
			index,
			state,
			window,
			timingLabel: window ? formatTimingWindow(window) : null,
			confidence: window?.confidence ?? null,
			groupLabel: window ? quarterLabel(window.endMonth) : null,
			offset: 0,
			span: 0,
			isNext: false,
		});
	});

	const scheduled = rows
		.filter((row) => row.window)
		.sort(
			(left, right) =>
				(left.window?.endMonth ?? 0) - (right.window?.endMonth ?? 0) ||
				(left.window?.startMonth ?? 0) - (right.window?.startMonth ?? 0) ||
				left.index - right.index,
		);
	const unscheduled = rows.filter((row) => !row.window);

	const columns: TimelineColumn[] = [];
	let todayOffset: number | null = null;
	const todayMonth = today.getFullYear() * 12 + today.getMonth();
	if (scheduled.length > 0) {
		let start = Math.min(...scheduled.map((row) => row.window?.startMonth ?? 0));
		let end = Math.max(...scheduled.map((row) => row.window?.endMonth ?? 0));
		if (
			todayMonth >= start - MAX_TODAY_EXTENSION_MONTHS &&
			todayMonth <= end + MAX_TODAY_EXTENSION_MONTHS
		) {
			start = Math.min(start, todayMonth);
			end = Math.max(end, todayMonth);
		}
		start -= start % 3;
		end += 2 - (end % 3);
		const total = end - start + 1;
		for (const row of scheduled) {
			const window = row.window as RoadmapTimingWindow;
			row.offset = ((window.startMonth - start) / total) * 100;
			row.span = ((window.endMonth - window.startMonth + 1) / total) * 100;
		}
		for (let month = start; month <= end; month += 3) {
			const quarter = quarterOf(month);
			const year = Math.floor(month / 12);
			columns.push({
				key: `${year}-Q${quarter}`,
				quarter: `Q${quarter}`,
				year: month === start || quarter === 1 ? year : null,
			});
		}
		const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
		const position = todayMonth + (today.getDate() - 1) / daysInMonth;
		if (position >= start && position < end + 1) {
			todayOffset = ((position - start) / total) * 100;
		}
	}

	const counts = { planned: 0, in_progress: 0, blocked: 0, done: 0, total: rows.length };
	for (const row of rows) counts[row.state] += 1;
	const next =
		scheduled.find((row) => row.state === 'planned') ??
		unscheduled.find((row) => row.state === 'planned') ??
		null;
	if (next) next.isNext = true;

	return {
		columns,
		todayOffset,
		scheduled,
		unscheduled,
		archivedCount,
		invalidTimingCount,
		counts,
		next,
		currentGroupLabel: quarterLabel(todayMonth),
	};
}

export type StepLinks = {
	plans: Array<{ code: string; title: string | null; status: string | null }>;
	pullRequests: Array<{ url: string; label: string; status: string | null }>;
	issues: Array<{ url: string | null; label: string }>;
	evidence: Array<{ label: string; url: string | null; path: string | null }>;
};

const GITHUB_ITEM_RE =
	/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/(pull|issues)\/(\d+)\/?(?:[?#].*)?$/i;

/** Odkaz se vykreslí jen pro http(s) URL; jiné schéma zůstane textem. */
export function safeExternalUrl(value: unknown): string | null {
	if (!isNonEmptyString(value)) return null;
	try {
		const url = new URL(value);
		return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
	} catch {
		return null;
	}
}

function githubItem(url: string): { kind: 'pull' | 'issues'; label: string } | null {
	const match = GITHUB_ITEM_RE.exec(url);
	if (!match) return null;
	return {
		kind: match[3].toLowerCase() === 'pull' ? 'pull' : 'issues',
		label: `${match[2]}#${match[4]}`,
	};
}

/**
 * Proklik z kroku: plány z `plan_refs`, jejich pull requesty a GitHub issues
 * (plán drží aktivní issues jako `links`), historické `issue_refs` a evidence.
 */
export function stepLinks(step: RoadmapStep, plans: PlanRecord[]): StepLinks {
	const plansByCode = new Map(plans.map((record) => [record.plan.dev_code, record.plan]));
	const links: StepLinks = { plans: [], pullRequests: [], issues: [], evidence: [] };
	const seenUrls = new Set<string>();
	const addUrl = (rawUrl: unknown, fallbackLabel: string, status: string | null): boolean => {
		const url = safeExternalUrl(rawUrl);
		if (!url) return false;
		const item = githubItem(url);
		if (!item) return false;
		if (seenUrls.has(url)) return true;
		seenUrls.add(url);
		if (item.kind === 'pull') links.pullRequests.push({ url, label: item.label, status });
		else
			links.issues.push({
				url,
				label: fallbackLabel ? `${item.label} · ${fallbackLabel}` : item.label,
			});
		return true;
	};

	for (const code of Array.isArray(step.plan_refs) ? step.plan_refs.filter(isNonEmptyString) : []) {
		const plan = plansByCode.get(code);
		links.plans.push({ code, title: plan?.title ?? null, status: plan?.status ?? null });
		for (const pr of plan?.github?.prs ?? []) {
			addUrl(pr?.url, '', isNonEmptyString(pr?.status) ? pr.status : null);
		}
		for (const link of plan?.links ?? []) {
			const url = safeExternalUrl(link?.url);
			if (url && githubItem(url)?.kind === 'issues') addUrl(url, link.label ?? '', null);
		}
	}
	for (const issueId of Array.isArray(step.issue_refs)
		? step.issue_refs.filter(isNonEmptyString)
		: []) {
		links.issues.push({ url: null, label: issueId });
	}
	for (const evidence of Array.isArray(step.evidence_refs) ? step.evidence_refs : []) {
		if (!isRecord(evidence) || !isNonEmptyString(evidence.label)) continue;
		if (addUrl(evidence.url, evidence.label, null)) continue;
		links.evidence.push({
			label: evidence.label,
			url: safeExternalUrl(evidence.url),
			path: isNonEmptyString(evidence.path) ? evidence.path : null,
		});
	}
	return links;
}
