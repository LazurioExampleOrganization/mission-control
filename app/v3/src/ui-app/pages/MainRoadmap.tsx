import { type CSSProperties, useId, useState } from 'react';
import type { PlanRecord } from '../../model.ts';
import type { RoadmapApiRecord } from '../../roadmap-model.ts';
import type { RoadmapsResponse } from '../api.ts';
import {
	buildRoadmapTimeline,
	CONFIDENCE_LABELS,
	formatCzechDate,
	LEADER_STATE_BADGES,
	LEADER_STATE_LABELS,
	LEADER_STATES,
	type MainRoadmapSelection,
	pluralCs,
	type RoadmapTimeline,
	safeExternalUrl,
	selectMainRoadmap,
	stepLinks,
	type TimelineRow,
} from '../roadmap-timeline.ts';

type MainRoadmapPageProps = {
	response: RoadmapsResponse | null;
	plans: PlanRecord[];
	error: string | null;
	onOpenPlan: (devCode: string) => void;
	onOpenRoadmaps: () => void;
	/** Pro testy; v aplikaci je to dnešní datum. */
	today?: Date;
};

export function MainRoadmapPage({ response, error, ...props }: MainRoadmapPageProps) {
	if (error) return <div className='panel error-text'>{error}</div>;
	if (!response) return <div className='panel'>Data roadmapy nejsou načtená.</div>;
	return <MainRoadmapView response={response} {...props} />;
}

function percent(value: number): string {
	return `${Number(value.toFixed(3))}%`;
}

function MainRoadmapView({
	response,
	plans,
	onOpenPlan,
	onOpenRoadmaps,
	today,
}: Omit<MainRoadmapPageProps, 'error' | 'response'> & { response: RoadmapsResponse }) {
	const selection = selectMainRoadmap(response.roadmaps);
	const [selectedCode, setSelectedCode] = useState<string | null>(null);
	const pickerId = useId();
	const record =
		response.roadmaps.find((item) => item.roadmap?.roadmap_code === selectedCode) ??
		selection.record;

	if (!record) {
		return (
			<section className='panel main-roadmap-empty'>
				<h2>Roadmapa zatím není</h2>
				<p className='muted'>
					Organizace zatím nemá žádnou roadmapu. Založit ji můžete v sekci Roadmaps z existujícího
					plánu.
				</p>
				<button type='button' className='button' onClick={onOpenRoadmaps}>
					Otevřít Roadmaps
				</button>
			</section>
		);
	}

	const roadmap = record.roadmap;
	const timeline = buildRoadmapTimeline(roadmap.steps, today ?? new Date());
	const updatedAt = formatCzechDate(roadmap.updated_at);
	const roadmapLinks = (Array.isArray(roadmap.links) ? roadmap.links : []).filter(
		(link) => link && typeof link.label === 'string' && safeExternalUrl(link.url),
	);

	return (
		<div className='main-roadmap'>
			<section className='panel main-roadmap-header'>
				<div className='main-roadmap-heading'>
					<div className='main-roadmap-title'>
						<div className='plan-card-meta'>
							{roadmap.main === true ? (
								<span className='main-roadmap-flag'>Hlavní roadmapa</span>
							) : null}
							<span className='plan-card-code'>{roadmap.roadmap_code}</span>
							<span>vlastník {roadmap.owner}</span>
							{updatedAt ? <span>· aktualizováno {updatedAt}</span> : null}
						</div>
						<h2>{roadmap.title}</h2>
						<p className='muted'>{roadmap.summary}</p>
					</div>
					{response.roadmaps.length > 1 ? (
						<div className='field main-roadmap-picker'>
							<label htmlFor={pickerId}>Zobrazit roadmapu</label>
							<select
								id={pickerId}
								value={roadmap.roadmap_code}
								onChange={(event) => setSelectedCode(event.target.value)}
							>
								{response.roadmaps
									.filter((item) => item.roadmap?.roadmap_code)
									.map((item) => (
										<option key={item.roadmap.roadmap_code} value={item.roadmap.roadmap_code}>
											{item.roadmap.roadmap_code} · {item.roadmap.title}
											{item.roadmap.main === true ? ' (hlavní)' : ''}
										</option>
									))}
							</select>
						</div>
					) : null}
				</div>
				<SelectionNote selection={selection} record={record} />
				{roadmapLinks.length > 0 ? (
					<ul className='main-roadmap-links'>
						{roadmapLinks.map((link) => (
							<li key={`${link.label}-${link.url}`}>
								<a href={safeExternalUrl(link.url) ?? undefined} target='_blank' rel='noreferrer'>
									{link.label}
								</a>
							</li>
						))}
					</ul>
				) : null}
			</section>

			<TimelineSummary timeline={timeline} />

			{timeline.scheduled.length > 0 ? (
				<TimelineChart timeline={timeline} plans={plans} onOpenPlan={onOpenPlan} />
			) : (
				<section className='panel'>
					<p className='muted'>
						Kroky této roadmapy zatím nemají přibližný termín, proto se časová osa nezobrazuje.
					</p>
				</section>
			)}

			{timeline.unscheduled.length > 0 ? (
				<section className='panel main-roadmap-unscheduled'>
					<h3>Bez termínu</h3>
					<p className='muted'>
						Tyto kroky zatím nemají přibližný termín. Doplní ho vlastník roadmapy v kroku (pole{' '}
						<code>timing</code>).
					</p>
					<ol className='timeline-rows'>
						{timeline.unscheduled.map((row) => (
							<li key={row.step.id} className='timeline-item'>
								<TimelineStep row={row} plans={plans} onOpenPlan={onOpenPlan} scheduled={false} />
							</li>
						))}
					</ol>
				</section>
			) : null}

			<TimelineLegend />

			<TimelineNotes timeline={timeline} record={record} onOpenRoadmaps={onOpenRoadmaps} />
		</div>
	);
}

function SelectionNote({
	selection,
	record,
}: {
	selection: MainRoadmapSelection;
	record: RoadmapApiRecord;
}) {
	const shownCode = record.roadmap.roadmap_code;
	if (selection.record && selection.record.roadmap.roadmap_code !== shownCode) {
		return (
			<p className='main-roadmap-note'>
				Zobrazujete jinou roadmapu než {selection.source === 'main' ? 'hlavní' : 'výchozí'} (
				{selection.record.roadmap.roadmap_code}).
			</p>
		);
	}
	if (selection.source === 'conflict') {
		return (
			<p className='main-roadmap-note warning'>
				Jako hlavní je označeno víc roadmap ({selection.mainCodes.join(', ')}). Zobrazujeme{' '}
				{shownCode}; příznak <code>main: true</code> ponechte jen u jedné z nich.
			</p>
		);
	}
	// A single roadmap is not the main one until its owner flags it, so the page says so too.
	if (selection.source === 'fallback' || selection.source === 'only') {
		return (
			<p className='main-roadmap-note'>
				Organizace zatím nemá označenou hlavní roadmapu, proto zobrazujeme {shownCode}. Hlavní
				roadmapu označí její vlastník příznakem <code>main: true</code>.
			</p>
		);
	}
	return null;
}

function TimelineSummary({ timeline }: { timeline: RoadmapTimeline }) {
	const { counts, next } = timeline;
	return (
		<div className='summary-grid main-roadmap-summary'>
			<div className={`summary-card${counts.done > 0 ? ' ok' : ''}`}>
				<span>Hotovo</span>
				<strong>{`${counts.done} z ${counts.total}`}</strong>
			</div>
			<div className='summary-card'>
				<span>Probíhá</span>
				<strong>{counts.in_progress}</strong>
			</div>
			<div className={`summary-card${counts.blocked > 0 ? ' error' : ''}`}>
				<span>Blokováno</span>
				<strong>{counts.blocked}</strong>
			</div>
			<div className='summary-card main-roadmap-next-card'>
				<span>Další na řadě</span>
				{next ? (
					<>
						<strong>{next.step.title}</strong>
						<small>{next.timingLabel ?? 'bez termínu'}</small>
					</>
				) : (
					<strong>Nic dalšího v plánu</strong>
				)}
			</div>
		</div>
	);
}

function TimelineChart({
	timeline,
	plans,
	onOpenPlan,
}: {
	timeline: RoadmapTimeline;
	plans: PlanRecord[];
	onOpenPlan: (devCode: string) => void;
}) {
	const style = {
		'--timeline-columns': String(timeline.columns.length),
		...(timeline.todayOffset !== null ? { '--timeline-today': percent(timeline.todayOffset) } : {}),
	} as CSSProperties;
	return (
		<section
			className={`panel main-roadmap-timeline${timeline.todayOffset !== null ? ' has-today' : ''}`}
			style={style}
			aria-label='Časová osa roadmapy'
		>
			<div className='timeline-head' aria-hidden='true'>
				<span className='timeline-head-label'>Krok a termín</span>
				<span className='timeline-axis'>
					{timeline.columns.map((column) => (
						<span key={column.key} className='timeline-axis-column'>
							<strong>{column.quarter}</strong>
							{column.year !== null ? <small>{column.year}</small> : null}
						</span>
					))}
					{timeline.todayOffset !== null ? (
						<span className='timeline-today-label'>Dnes</span>
					) : null}
				</span>
			</div>
			<ol className='timeline-rows'>
				{timeline.scheduled.map((row, index) => (
					<li key={row.step.id} className='timeline-item'>
						{row.groupLabel !== timeline.scheduled[index - 1]?.groupLabel ? (
							<h3 className='timeline-group-heading'>
								{row.groupLabel}
								{row.groupLabel === timeline.currentGroupLabel ? ' · toto čtvrtletí' : ''}
							</h3>
						) : null}
						<TimelineStep row={row} plans={plans} onOpenPlan={onOpenPlan} scheduled />
					</li>
				))}
			</ol>
		</section>
	);
}

function TimelineStep({
	row,
	plans,
	onOpenPlan,
	scheduled,
}: {
	row: TimelineRow;
	plans: PlanRecord[];
	onOpenPlan: (devCode: string) => void;
	scheduled: boolean;
}) {
	const when = [
		row.timingLabel ?? 'Bez termínu',
		row.confidence ? CONFIDENCE_LABELS[row.confidence] : null,
	]
		.filter(Boolean)
		.join(' · ');
	return (
		<details className={`timeline-step state-${row.state}${row.isNext ? ' is-next' : ''}`}>
			<summary>
				<span className={`timeline-step-grid${scheduled ? '' : ' is-unscheduled'}`}>
					<span className='timeline-step-label'>
						<span className='timeline-step-badges'>
							<span className={`status-badge ${LEADER_STATE_BADGES[row.state]}`}>
								{LEADER_STATE_LABELS[row.state]}
							</span>
							{row.isNext ? <span className='timeline-next-chip'>Další na řadě</span> : null}
						</span>
						<span className='timeline-step-title'>{row.step.title}</span>
						<span className='timeline-step-when'>{when}</span>
					</span>
					{scheduled ? (
						<span className='timeline-track' aria-hidden='true'>
							<span
								className={`timeline-bar state-${row.state}${row.confidence ? ` confidence-${row.confidence}` : ''}`}
								style={{ left: percent(row.offset), width: percent(row.span) }}
							/>
						</span>
					) : null}
				</span>
			</summary>
			<StepDetail row={row} plans={plans} onOpenPlan={onOpenPlan} />
		</details>
	);
}

function StepDetail({
	row,
	plans,
	onOpenPlan,
}: {
	row: TimelineRow;
	plans: PlanRecord[];
	onOpenPlan: (devCode: string) => void;
}) {
	const links = stepLinks(row.step, plans);
	const criteria = Array.isArray(row.step.acceptance_criteria)
		? row.step.acceptance_criteria.filter((item) => typeof item === 'string' && item.length > 0)
		: [];
	const hasLinks =
		links.plans.length + links.pullRequests.length + links.issues.length + links.evidence.length >
		0;
	return (
		<div className='timeline-step-detail'>
			{typeof row.step.notes === 'string' && row.step.notes ? <p>{row.step.notes}</p> : null}
			{criteria.length > 0 ? (
				<div className='timeline-detail-block'>
					<h4>Co bude hotové</h4>
					<ul>
						{criteria.map((item) => (
							<li key={item}>{item}</li>
						))}
					</ul>
				</div>
			) : null}
			{links.plans.length > 0 ? (
				<div className='timeline-detail-block'>
					<h4>Plány</h4>
					<ul className='timeline-link-list'>
						{links.plans.map((plan) => (
							<li key={plan.code}>
								<button
									type='button'
									className='timeline-plan-link'
									onClick={() => onOpenPlan(plan.code)}
								>
									<code>{plan.code}</code> {plan.title ?? 'plán nenalezen'}
								</button>
								{plan.status ? (
									<span className={`status-badge ${plan.status}`}>{plan.status}</span>
								) : null}
							</li>
						))}
					</ul>
				</div>
			) : null}
			{links.pullRequests.length > 0 ? (
				<div className='timeline-detail-block'>
					<h4>Pull requesty</h4>
					<ul className='timeline-link-list'>
						{links.pullRequests.map((pr) => (
							<li key={pr.url}>
								<a href={pr.url} target='_blank' rel='noreferrer'>
									{pr.label}
								</a>
								{pr.status ? <span className='status-badge neutral'>{pr.status}</span> : null}
							</li>
						))}
					</ul>
				</div>
			) : null}
			{links.issues.length > 0 ? (
				<div className='timeline-detail-block'>
					<h4>Issues</h4>
					<ul className='timeline-link-list'>
						{links.issues.map((issue) => (
							<li key={issue.url ?? issue.label}>
								{issue.url ? (
									<a href={issue.url} target='_blank' rel='noreferrer'>
										{issue.label}
									</a>
								) : (
									<code>{issue.label}</code>
								)}
							</li>
						))}
					</ul>
				</div>
			) : null}
			{links.evidence.length > 0 ? (
				<div className='timeline-detail-block'>
					<h4>Podklady</h4>
					<ul className='timeline-link-list'>
						{links.evidence.map((item) => (
							<li key={`${item.label}-${item.url ?? item.path ?? ''}`}>
								{item.url ? (
									<a href={item.url} target='_blank' rel='noreferrer'>
										{item.label}
									</a>
								) : (
									<span>{item.label}</span>
								)}
								{item.path ? <code>{item.path}</code> : null}
							</li>
						))}
					</ul>
				</div>
			) : null}
			{hasLinks ? null : <p className='muted'>Ke kroku zatím nejsou navázané plány ani odkazy.</p>}
			<p className='muted timeline-step-id'>{row.step.id}</p>
		</div>
	);
}

function TimelineLegend() {
	return (
		<div className='main-roadmap-legend' role='note' aria-label='Legenda'>
			{LEADER_STATES.map((state) => (
				<span key={state} className={`status-badge ${LEADER_STATE_BADGES[state]}`}>
					{LEADER_STATE_LABELS[state]}
				</span>
			))}
			<span className='legend-item'>
				<span className='timeline-bar-sample confidence-committed' /> Závazné: termín můžete
				komunikovat navenek
			</span>
			<span className='legend-item'>
				<span className='timeline-bar-sample confidence-likely' /> Pravděpodobné
			</span>
			<span className='legend-item'>
				<span className='timeline-bar-sample confidence-tentative' /> Orientační: hrubý odhad
			</span>
		</div>
	);
}

function TimelineNotes({
	timeline,
	record,
	onOpenRoadmaps,
}: {
	timeline: RoadmapTimeline;
	record: RoadmapApiRecord;
	onOpenRoadmaps: () => void;
}) {
	const failures = record.validation?.failures?.length ?? 0;
	const notes: string[] = [];
	if (timeline.archivedCount > 0) {
		notes.push(
			`${timeline.archivedCount} ${pluralCs(timeline.archivedCount, ['archivovaný krok', 'archivované kroky', 'archivovaných kroků'])} se na ose nezobrazuje.`,
		);
	}
	if (timeline.invalidTimingCount > 0) {
		const count = timeline.invalidTimingCount;
		notes.push(
			`${count} ${pluralCs(count, ['krok má', 'kroky mají', 'kroků má'])} neplatný termín a ${pluralCs(count, ['je', 'jsou', 'je'])} mezi kroky bez termínu.`,
		);
	}
	if (failures === 0 && notes.length === 0) return null;
	return (
		<div className='main-roadmap-notes'>
			{notes.map((note) => (
				<p key={note} className='muted'>
					{note}
				</p>
			))}
			{failures > 0 ? (
				<p className='main-roadmap-note warning'>
					Roadmapa má {failures}{' '}
					{pluralCs(failures, ['validační chybu', 'validační chyby', 'validačních chyb'])}, údaje
					proto nemusí být úplné.{' '}
					<button type='button' className='timeline-plan-link' onClick={onOpenRoadmaps}>
						Podrobnosti najdete v sekci Roadmaps.
					</button>
				</p>
			) : null}
		</div>
	);
}
