// Přibližný termín Roadmap Stepu (`timing`). Období je kalendářní měsíc
// (`2026-11`) nebo čtvrtletí (`2027-Q1`): vedení plánuje v těchto jednotkách,
// proto roadmapa záměrně nezná termíny na den. Modul je čistý (bez node:
// importů), aby ho sdílely validátor, draft writer i UI.

export const ROADMAP_TIMING_CONFIDENCES = ['committed', 'likely', 'tentative'] as const;

export type RoadmapTimingConfidence = (typeof ROADMAP_TIMING_CONFIDENCES)[number];

export type RoadmapStepTiming = {
	from?: string;
	to: string;
	confidence?: RoadmapTimingConfidence;
};

/** Měsíce období jako absolutní index `rok * 12 + (měsíc - 1)`, `endMonth` včetně. */
export type RoadmapPeriod = {
	kind: 'month' | 'quarter';
	year: number;
	startMonth: number;
	endMonth: number;
};

export type RoadmapTimingWindow = {
	from: RoadmapPeriod | null;
	to: RoadmapPeriod;
	startMonth: number;
	endMonth: number;
	confidence: RoadmapTimingConfidence | null;
};

const ROADMAP_PERIOD_RE = /^([0-9]{4})-(?:(0[1-9]|1[0-2])|Q([1-4]))$/;

export function parseRoadmapPeriod(value: unknown): RoadmapPeriod | null {
	if (typeof value !== 'string') return null;
	const match = ROADMAP_PERIOD_RE.exec(value);
	if (!match) return null;
	const year = Number(match[1]);
	if (match[2]) {
		const month = year * 12 + Number(match[2]) - 1;
		return { kind: 'month', year, startMonth: month, endMonth: month };
	}
	const startMonth = year * 12 + (Number(match[3]) - 1) * 3;
	return { kind: 'quarter', year, startMonth, endMonth: startMonth + 2 };
}

export function isRoadmapTimingConfidence(value: unknown): value is RoadmapTimingConfidence {
	return (ROADMAP_TIMING_CONFIDENCES as readonly unknown[]).includes(value);
}

/** Okno běží dopředu: `from` nezačíná ani nekončí později než `to`. */
export function roadmapPeriodsInOrder(from: RoadmapPeriod, to: RoadmapPeriod): boolean {
	return from.startMonth <= to.startMonth && from.endMonth <= to.endMonth;
}

/** Platné okno kroku, nebo `null`, když termín chybí nebo je neplatný. */
export function roadmapTimingWindow(timing: unknown): RoadmapTimingWindow | null {
	if (!timing || typeof timing !== 'object' || Array.isArray(timing)) return null;
	const record = timing as Record<string, unknown>;
	const to = parseRoadmapPeriod(record.to);
	if (!to) return null;
	const from = record.from === undefined ? null : parseRoadmapPeriod(record.from);
	if (record.from !== undefined && (!from || !roadmapPeriodsInOrder(from, to))) return null;
	return {
		from,
		to,
		startMonth: from ? from.startMonth : to.startMonth,
		endMonth: to.endMonth,
		confidence: isRoadmapTimingConfidence(record.confidence) ? record.confidence : null,
	};
}
