export type SummaryStatTone = 'ok' | 'warning' | 'error';

export function SummaryStat({
	label,
	value,
	tone,
}: {
	label: string;
	value: number | string;
	tone?: SummaryStatTone;
}) {
	return (
		<div className={`summary-card${tone ? ` ${tone}` : ''}`}>
			<span>{label}</span>
			<strong>{value}</strong>
		</div>
	);
}
