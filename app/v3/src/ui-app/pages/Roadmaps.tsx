import { useEffect, useMemo, useState } from 'react';
import type {
	RoadmapApiRecord,
	RoadmapEvidenceRef,
	RoadmapIssueBlocker,
	RoadmapPriority,
	RoadmapResolutionEvidence,
	RoadmapStep,
} from '../../roadmap-model.ts';
import { type RoadmapStepTiming, roadmapTimingWindow } from '../../roadmap-timing.ts';
import {
	api,
	type RoadmapDraftResponse,
	type RoadmapStepDraftResponse,
	type RoadmapsResponse,
} from '../api.ts';
import { CONFIDENCE_LABELS, formatTimingWindow } from '../roadmap-timeline.ts';

export function RoadmapsPage({
	response,
	loading,
	error,
}: {
	response: RoadmapsResponse | null;
	loading: boolean;
	error: string | null;
}) {
	if (loading) return <div className='panel'>Načítám roadmapy…</div>;
	if (error) return <div className='panel error-text'>{error}</div>;
	if (!response) return <div className='panel'>Roadmap data nejsou načtená.</div>;

	return (
		<div className='roadmaps-page'>
			<div className='panel read-only-banner'>
				<strong>Read-only + draft</strong>
				<span>
					Roadmapy se čtou z YAML; editovací loop vytváří jen návrh, diff a validaci bez zápisu.
				</span>
			</div>
			<RoadmapCreateDraftPanel response={response} />
			{response.roadmaps.length === 0 ? (
				<div className='panel'>Zatím neexistuje žádná RM roadmapa.</div>
			) : (
				<RoadmapStepDraftPanel response={response} />
			)}
			{!response.validation.ok && (
				<div className='panel error-text'>
					<strong>Roadmap validace není zelená.</strong>
					<ul>
						{response.validation.failures.map((failure) => (
							<li key={failure}>{failure}</li>
						))}
					</ul>
				</div>
			)}
			<div className='plan-grid roadmaps-grid'>
				{response.roadmaps.map((record) => (
					<RoadmapCard key={record.roadmap.id} record={record} />
				))}
			</div>
			<div className='roadmap-details-stack'>
				{response.roadmaps.map((record) => (
					<RoadmapDetail key={`${record.roadmap.id}-detail`} record={record} />
				))}
			</div>
		</div>
	);
}

function splitDraftList(value: string): string[] {
	return value
		.split(/[\n,]+/)
		.map((item) => item.trim())
		.filter(Boolean);
}

export function optionalDraftList(value: string): string[] | undefined {
	const items = splitDraftList(value);
	return items.length > 0 ? items : undefined;
}

/** Prázdná pole termín neposílají; neúplný termín odmítne až server s důvodem. */
export function optionalTimingDraft(
	from: string,
	to: string,
	confidence: string,
): Record<string, string> | undefined {
	const timing: Record<string, string> = {};
	if (from.trim()) timing.from = from.trim();
	if (to.trim()) timing.to = to.trim();
	if (confidence.trim()) timing.confidence = confidence.trim();
	return Object.keys(timing).length > 0 ? timing : undefined;
}

export type StepDraftForm = {
	planRefs: string;
	timingFrom: string;
	timingTo: string;
	timingConfidence: string;
};

/** Výchozí hodnoty formuláře pro vybraný krok: jeho vlastní plan_refs a termín, nikdy jiného kroku. */
export function stepDraftDefaults(step: RoadmapStep | undefined): StepDraftForm {
	const timing: Partial<RoadmapStepTiming> =
		step?.timing && typeof step.timing === 'object' ? step.timing : {};
	return {
		planRefs: Array.isArray(step?.plan_refs) ? step.plan_refs.join('\n') : '',
		timingFrom: typeof timing.from === 'string' ? timing.from : '',
		timingTo: typeof timing.to === 'string' ? timing.to : '',
		timingConfidence: typeof timing.confidence === 'string' ? timing.confidence : '',
	};
}

function sameList(left: string[], right: unknown): boolean {
	return (
		Array.isArray(right) &&
		left.length === right.length &&
		left.every((item, i) => item === right[i])
	);
}

function sameTiming(left: Record<string, string>, right: unknown): boolean {
	const other = right && typeof right === 'object' ? (right as Record<string, unknown>) : {};
	return ['from', 'to', 'confidence'].every((key) => left[key] === other[key]);
}

/**
 * plan_refs a termín, které draft kroku pošle. Nový krok dostane, co je vyplněné. Úprava
 * existujícího kroku pošle seznam nebo termín jen tehdy, když se liší od vybraného kroku, aby
 * změna jednoho pole nepřepsala jeho ostatní hodnoty.
 */
export function stepDraftChanges(
	mode: 'update' | 'create',
	step: RoadmapStep | undefined,
	form: StepDraftForm,
): { plan_refs?: string[] | null; timing?: Record<string, string> | null } {
	const planRefs = optionalDraftList(form.planRefs);
	const timing = optionalTimingDraft(form.timingFrom, form.timingTo, form.timingConfidence);
	if (mode === 'create') return { plan_refs: planRefs, timing };
	// A field the person emptied removes the step's own value (`null`).
	const hadRefs = Array.isArray(step?.plan_refs) && step.plan_refs.length > 0;
	const hadTiming = step?.timing !== undefined && step?.timing !== null;
	return {
		plan_refs: planRefs
			? sameList(planRefs, step?.plan_refs)
				? undefined
				: planRefs
			: hadRefs
				? null
				: undefined,
		timing: timing
			? sameTiming(timing, step?.timing)
				? undefined
				: timing
			: hadTiming
				? null
				: undefined,
	};
}

/** The step the form edits: the chosen one while it is in the selected roadmap, else the roadmap's default. */
export function selectedStepId(steps: RoadmapStep[], chosen: string, fallback: string): string {
	return steps.some((step) => step.id === chosen) ? chosen : fallback;
}

export type StepDraftInput = {
	mode: 'update' | 'create';
	steps: RoadmapStep[];
	stepId: string;
	defaultStepId: string;
	title: string;
	priorityRefs: string;
	acceptanceCriteria: string;
	form: StepDraftForm;
};

/** The dry-run request for the step draft API, built from the form as it is now. */
export function stepDraftPayload(input: StepDraftInput): Record<string, unknown> {
	const stepId = selectedStepId(input.steps, input.stepId, input.defaultStepId);
	const step = input.steps.find((item) => item.id === stepId);
	return {
		dry_run: true,
		mode: input.mode,
		step_id: input.mode === 'update' ? stepId : undefined,
		title: input.title.trim() || undefined,
		priority_refs: input.mode === 'create' ? optionalDraftList(input.priorityRefs) : undefined,
		...stepDraftChanges(input.mode, step, input.form),
		acceptance_criteria: optionalDraftList(input.acceptanceCriteria),
	};
}

function RoadmapCreateDraftPanel({ response }: { response: RoadmapsResponse }) {
	const defaultSourcePlan = response.roadmaps[0]?.roadmap.source_plan ?? '';
	const [sourcePlan, setSourcePlan] = useState(defaultSourcePlan);
	const [title, setTitle] = useState('');
	const [owner, setOwner] = useState('');
	const [summary, setSummary] = useState('');
	const [main, setMain] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [draft, setDraft] = useState<RoadmapDraftResponse | null>(null);

	useEffect(() => {
		setSourcePlan(defaultSourcePlan);
		setDraft(null);
		setError(null);
	}, [defaultSourcePlan]);

	async function handleDraft() {
		setBusy(true);
		setError(null);
		setDraft(null);
		try {
			const result = await api.draftRoadmap({
				source_plan: sourcePlan.trim(),
				title: title.trim() || undefined,
				owner: owner.trim() || undefined,
				summary: summary.trim() || undefined,
				main: main || undefined,
			});
			setDraft(result);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	}

	return (
		<section className='panel roadmap-draft-panel'>
			<div className='panel-header'>
				<div>
					<span className='section-kicker'>Návrh bez zápisu</span>
					<h2>Draft Roadmap from Plan</h2>
					<p className='muted'>
						Připraví novou RM roadmapu z existujícího plánu jako reviewovaný lokální draft;
						source-of-truth se změní až po potvrzení přes nativní Git publish.
					</p>
				</div>
				<button
					type='button'
					className='button primary'
					onClick={handleDraft}
					disabled={busy || !sourcePlan.trim()}
				>
					Připravit roadmap draft
				</button>
			</div>
			<div className='form-grid'>
				<div className='field'>
					<label htmlFor='roadmap-create-source-plan'>source_plan</label>
					<input
						id='roadmap-create-source-plan'
						value={sourcePlan}
						onChange={(event) => setSourcePlan(event.target.value)}
						placeholder='DEV-0001'
					/>
				</div>
				<div className='field'>
					<label htmlFor='roadmap-create-owner'>owner override</label>
					<input
						id='roadmap-create-owner'
						value={owner}
						onChange={(event) => setOwner(event.target.value)}
						placeholder='Nech prázdné = owner ze source plánu'
					/>
				</div>
				<div className='field full'>
					<label htmlFor='roadmap-create-title'>title override</label>
					<input
						id='roadmap-create-title'
						value={title}
						onChange={(event) => setTitle(event.target.value)}
						placeholder='Nech prázdné = Roadmap: <název plánu>'
					/>
				</div>
				<div className='field full'>
					<label htmlFor='roadmap-create-summary'>summary override</label>
					<textarea
						id='roadmap-create-summary'
						value={summary}
						onChange={(event) => setSummary(event.target.value)}
						placeholder='Nech prázdné = target_state/source plan context'
					/>
				</div>
				<label className='field full roadmap-main-toggle' htmlFor='roadmap-create-main'>
					<span>
						<input
							id='roadmap-create-main'
							type='checkbox'
							checked={main}
							onChange={(event) => setMain(event.target.checked)}
						/>{' '}
						Hlavní roadmapa Organizace (<code>main: true</code>)
					</span>
					<small className='muted'>
						Hlavní může být jen jedna; u dosavadní hlavní roadmapy příznak odeberte.
					</small>
				</label>
			</div>
			{error && <p className='error-text'>{error}</p>}
			{draft && (
				<div className='roadmap-draft-result'>
					<p className='muted'>
						Draft roadmapy <code>{draft.roadmap_code}</code> do repository path{' '}
						<code>{draft.path}</code>
						{'; '}workspacePath=<code>{draft.workspacePath}</code>
						{'; '}write_applied=<code>{String(draft.write_applied)}</code>
						{'; '}validace=<code>{draft.validation.ok ? 'OK' : 'FAIL'}</code>.
					</p>
					<h3>YAML draft</h3>
					<pre className='api-output'>{draft.yaml}</pre>
				</div>
			)}
		</section>
	);
}

function RoadmapStepDraftPanel({ response }: { response: RoadmapsResponse }) {
	const selectableRoadmaps = useMemo(
		() => response.roadmaps.filter((record) => record.roadmap?.roadmap_code),
		[response.roadmaps],
	);
	const [roadmapCode, setRoadmapCode] = useState(selectableRoadmaps[0]?.roadmap.roadmap_code ?? '');
	const selectedRecord = useMemo(
		() =>
			selectableRoadmaps.find((record) => record.roadmap.roadmap_code === roadmapCode) ??
			selectableRoadmaps[0],
		[roadmapCode, selectableRoadmaps],
	);
	const steps = Array.isArray(selectedRecord?.roadmap.steps)
		? selectedRecord.roadmap.steps.filter(isRoadmapStep)
		: [];
	const defaultStepId = selectedRecord?.next_step?.id ?? steps[0]?.id ?? '';
	const defaultPriorityRefs = selectedRecord?.roadmap.priorities?.[0]?.id ?? '';
	const [stepId, setStepId] = useState(defaultStepId);
	const [mode, setMode] = useState<'update' | 'create'>('update');
	// Derived on every render, so a step id chosen on another roadmap is never shown or sent.
	const effectiveStepId = selectedStepId(steps, stepId, defaultStepId);
	const selectedStep = steps.find((step) => step.id === effectiveStepId);
	const initial = stepDraftDefaults(selectedStep);
	const [title, setTitle] = useState('');
	const [priorityRefs, setPriorityRefs] = useState(defaultPriorityRefs);
	const [planRefs, setPlanRefs] = useState(initial.planRefs);
	const [acceptanceCriteria, setAcceptanceCriteria] = useState('');
	const [timingFrom, setTimingFrom] = useState(initial.timingFrom);
	const [timingTo, setTimingTo] = useState(initial.timingTo);
	const [timingConfidence, setTimingConfidence] = useState(initial.timingConfidence);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [draft, setDraft] = useState<RoadmapStepDraftResponse | null>(null);

	const selectedRoadmapCode = selectedRecord?.roadmap.roadmap_code ?? '';
	// biome-ignore lint/correctness/useExhaustiveDependencies: a change of roadmap resets the choice
	useEffect(() => {
		setStepId(defaultStepId);
		setPriorityRefs(defaultPriorityRefs);
	}, [selectedRoadmapCode, defaultStepId, defaultPriorityRefs]);

	// The form edits the selected step: switching roadmap, step or mode reloads its own values.
	const selectedStepKey = `${selectedRecord?.roadmap.roadmap_code ?? ''}/${mode}/${selectedStep?.id ?? ''}`;
	// biome-ignore lint/correctness/useExhaustiveDependencies: keyed by the selected step, which the key names
	useEffect(() => {
		const values = stepDraftDefaults(mode === 'update' ? selectedStep : undefined);
		setPlanRefs(values.planRefs);
		setTimingFrom(values.timingFrom);
		setTimingTo(values.timingTo);
		setTimingConfidence(values.timingConfidence);
		setDraft(null);
		setError(null);
	}, [selectedStepKey]);

	async function handleDraft() {
		const targetRoadmapCode = selectedRecord?.roadmap.roadmap_code;
		if (!targetRoadmapCode) return;
		setBusy(true);
		setError(null);
		setDraft(null);
		try {
			const result = await api.draftRoadmapStep(
				targetRoadmapCode,
				stepDraftPayload({
					mode,
					steps,
					stepId,
					defaultStepId,
					title,
					priorityRefs,
					acceptanceCriteria,
					form: { planRefs, timingFrom, timingTo, timingConfidence },
				}),
			);
			setDraft(result);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	}

	return (
		<section className='panel roadmap-draft-panel'>
			<div className='panel-header'>
				<div>
					<span className='section-kicker'>Návrh bez zápisu</span>
					<h2>Draft Roadmap Step</h2>
					<p className='muted'>
						Připraví YAML změnu, validační report a Diff preview. Source-of-truth se nezmění, dokud
						změnu někdo explicitně nepřenese do PR/commitu.
					</p>
				</div>
				<button
					type='button'
					className='button primary'
					onClick={handleDraft}
					disabled={busy || !selectedRecord}
				>
					Připravit draft
				</button>
			</div>
			<div className='form-grid'>
				<div className='field'>
					<label htmlFor='roadmap-draft-roadmap'>Roadmapa</label>
					<select
						id='roadmap-draft-roadmap'
						value={selectedRecord?.roadmap.roadmap_code ?? ''}
						onChange={(event) => setRoadmapCode(event.target.value)}
					>
						{selectableRoadmaps.map((record) => (
							<option key={record.roadmap.roadmap_code} value={record.roadmap.roadmap_code}>
								{record.roadmap.roadmap_code} · {record.roadmap.title}
							</option>
						))}
					</select>
				</div>
				<div className='field'>
					<label htmlFor='roadmap-draft-mode'>Režim</label>
					<select
						id='roadmap-draft-mode'
						value={mode}
						onChange={(event) => setMode(event.target.value as 'update' | 'create')}
					>
						<option value='update'>upravit existující step</option>
						<option value='create'>navrhnout nový step</option>
					</select>
				</div>
				{mode === 'update' ? (
					<div className='field'>
						<label htmlFor='roadmap-draft-step'>Roadmap Step</label>
						<select
							id='roadmap-draft-step'
							value={effectiveStepId}
							onChange={(event) => setStepId(event.target.value)}
						>
							{steps.map((step) => (
								<option key={step.id} value={step.id}>
									{step.id} · {step.title}
								</option>
							))}
						</select>
					</div>
				) : (
					<div className='field'>
						<label htmlFor='roadmap-draft-priority-refs'>priority_refs</label>
						<textarea
							id='roadmap-draft-priority-refs'
							value={priorityRefs}
							onChange={(event) => setPriorityRefs(event.target.value)}
						/>
					</div>
				)}
				<div className='field full'>
					<label htmlFor='roadmap-draft-title'>Název / title override</label>
					<input
						id='roadmap-draft-title'
						value={title}
						onChange={(event) => setTitle(event.target.value)}
						placeholder='Nech prázdné, pokud se title nemění'
					/>
				</div>
				<div className='field'>
					<label htmlFor='roadmap-draft-plan-refs'>plan_refs</label>
					<textarea
						id='roadmap-draft-plan-refs'
						value={planRefs}
						onChange={(event) => setPlanRefs(event.target.value)}
						placeholder='Kód plánu, jeden na řádek'
					/>
				</div>
				<div className='field'>
					<label htmlFor='roadmap-draft-acceptance'>akceptační kritéria</label>
					<textarea
						id='roadmap-draft-acceptance'
						value={acceptanceCriteria}
						onChange={(event) => setAcceptanceCriteria(event.target.value)}
						placeholder='Jeden řádek = jedno kritérium'
					/>
				</div>
				<div className='field'>
					<label htmlFor='roadmap-draft-timing-from'>Termín od (nepovinné)</label>
					<input
						id='roadmap-draft-timing-from'
						value={timingFrom}
						onChange={(event) => setTimingFrom(event.target.value)}
						placeholder='2026-11 nebo 2026-Q4'
					/>
				</div>
				<div className='field'>
					<label htmlFor='roadmap-draft-timing-to'>Termín do</label>
					<input
						id='roadmap-draft-timing-to'
						value={timingTo}
						onChange={(event) => setTimingTo(event.target.value)}
						placeholder='2027-Q1 nebo 2027-02'
					/>
				</div>
				<div className='field'>
					<label htmlFor='roadmap-draft-timing-confidence'>Jistota termínu</label>
					<select
						id='roadmap-draft-timing-confidence'
						value={timingConfidence}
						onChange={(event) => setTimingConfidence(event.target.value)}
					>
						<option value=''>neuvedeno</option>
						<option value='committed'>závazné (committed)</option>
						<option value='likely'>pravděpodobné (likely)</option>
						<option value='tentative'>orientační (tentative)</option>
					</select>
				</div>
			</div>
			{error && <p className='error-text'>{error}</p>}
			{draft && (
				<div className='roadmap-draft-result'>
					<p className='muted'>
						Draft pro <code>{draft.step.id}</code>
						{'; '}write_applied=<code>{String(draft.write_applied)}</code>
						{'; '}validace=<code>{draft.validation.ok ? 'OK' : 'FAIL'}</code>.
					</p>
					<h3>Diff preview</h3>
					<pre className='api-output'>{draft.diff}</pre>
					<h3>YAML draft</h3>
					<pre className='api-output'>{draft.yaml}</pre>
				</div>
			)}
		</section>
	);
}

function RoadmapCard({ record }: { record: RoadmapApiRecord }) {
	const roadmap = record.roadmap;
	return (
		<article className='plan-card roadmap-card'>
			<div className='plan-card-row'>
				<span className='plan-card-code'>{roadmap.roadmap_code}</span>
				<span className='plan-card-title'>{roadmap.title}</span>
			</div>
			<div className='plan-card-meta'>
				{roadmap.main === true ? <span className='main-roadmap-flag'>Hlavní roadmapa</span> : null}
				<span className={`status-badge ${roadmap.status}`}>{roadmap.status}</span>
				<span className={`priority-badge ${roadmap.priority}`}>{roadmap.priority}</span>
				<span>vlastník {roadmap.owner}</span>
				<span>· source_plan {roadmap.source_plan}</span>
			</div>
			<p className='muted'>{roadmap.summary}</p>
			{record.next_step ? (
				<div className='roadmap-next-step'>
					<span className='section-kicker'>Next runnable step</span>
					<strong>{record.next_step.id}</strong> · {record.next_step.title}
					<ReferenceRow label='plan_refs' values={record.next_step.plan_refs} />
				</div>
			) : (
				<p className='muted'>Next runnable step není dostupný.</p>
			)}
		</article>
	);
}

function RoadmapDetail({ record }: { record: RoadmapApiRecord }) {
	const roadmap = record.roadmap;
	const rawPriorities = Array.isArray(roadmap.priorities) ? roadmap.priorities : [];
	const rawSteps = Array.isArray(roadmap.steps) ? roadmap.steps : [];
	const priorities = rawPriorities
		.filter(isRoadmapPriority)
		.sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
	const steps = rawSteps.filter(isRoadmapStep).sort((a, b) => a.id.localeCompare(b.id));
	const incompleteData =
		!Array.isArray(roadmap.priorities) ||
		!Array.isArray(roadmap.steps) ||
		priorities.length !== rawPriorities.length ||
		steps.length !== rawSteps.length;
	return (
		<section className='panel roadmap-detail'>
			<div className='panel-header'>
				<div>
					<span className='section-kicker'>Detail roadmapy</span>
					<h2>
						<span className='plan-card-code'>{roadmap.roadmap_code}</span> · {roadmap.title}
					</h2>
					<div className='plan-card-meta'>
						<span>{record.workspacePath}</span>
						<span>· source_plan {roadmap.source_plan}</span>
					</div>
				</div>
			</div>
			<div className='panel-section'>
				<RoadmapControlSurface record={record} />
			</div>
			<div className='panel-section'>
				{incompleteData && (
					<p className='error-text'>
						Roadmap data nejsou kompletní; zkontroluj validační výpis nad seznamem.
					</p>
				)}
				<h3>Priority</h3>
				<div className='roadmap-priority-list'>
					{priorities.map((priority) => (
						<article key={priority.id} className='roadmap-priority-card'>
							<strong>{priority.id}</strong>
							<span>pořadí {priority.rank}</span>
							<h4>{priority.title}</h4>
							<p>{priority.rationale}</p>
						</article>
					))}
				</div>
			</div>
			<div className='panel-section'>
				<h3>Kroky roadmapy</h3>
				<div className='roadmap-step-list'>
					{steps.map((step) => {
						const issueBlockers = record.step_issue_blockers.filter(
							(blocker) => blocker.step_id === step.id,
						);
						const resolutionEvidence = record.resolution_evidence.filter(
							(evidence) => evidence.step_id === step.id,
						);
						return (
							<RoadmapStepCard
								key={step.id}
								step={step}
								issueBlockers={issueBlockers}
								resolutionEvidence={resolutionEvidence}
							/>
						);
					})}
				</div>
			</div>
		</section>
	);
}

function RoadmapControlSurface({ record }: { record: RoadmapApiRecord }) {
	const workItems = record.work_summary?.linked_items ?? [];
	const runtime = record.runtime_lane;
	const agentLane = record.agent_lane;
	const releaseGate = record.release_gate;
	return (
		<div className='roadmap-control-surface'>
			<article className='roadmap-control-card'>
				<h3>Uzavření TODO/DONE</h3>
				<p className='muted'>
					Otevřené TODO blokátory{' '}
					<strong>{record.work_summary?.blocking_open_todo_count ?? 0}</strong> · navázaná otevřená
					evidence <strong>{record.work_summary?.non_blocking_open_todo_count ?? 0}</strong> · DONE{' '}
					<strong>{record.work_summary?.done_count ?? 0}</strong>
				</p>
				{workItems.length > 0 ? (
					<ul>
						{workItems.map((item) => (
							<li key={`${item.kind}-${item.id}`}>
								<code>{item.id}</code>{' '}
								<span className={`status-badge ${item.status}`}>{item.status}</span>{' '}
								<span>{item.title}</span> <span className='muted'>({item.ledger_path})</span>
								{item.dev_code ? <code className='reference-pill'>{item.dev_code}</code> : null}
								<span className={`status-badge ${item.blocks_release ? 'blocker' : 'info'}`}>
									{item.blocks_release ? 'blokuje release' : 'navázaná evidence'}
								</span>
							</li>
						))}
					</ul>
				) : (
					<p className='muted'>Žádné navázané TODO/DONE položky.</p>
				)}
				{(record.work_summary?.missing_todo_refs ?? []).length > 0 && (
					<p className='error-text'>
						Chybějící refs: {record.work_summary.missing_todo_refs.join(', ')}
					</p>
				)}
				{(record.work_summary?.ledger_read_errors ?? []).length > 0 && (
					<ul className='error-list'>
						{record.work_summary.ledger_read_errors.map((error) => (
							<li key={error.ledger_path}>
								{error.ledger_path}: {error.message}
							</li>
						))}
					</ul>
				)}
			</article>

			<article className='roadmap-control-card'>
				<h3>Runtime vrstva</h3>
				{runtime ? (
					<>
						<div className='plan-card-meta'>
							<strong>{runtime.source.toUpperCase()}</strong>
							<code>{runtime.branch}</code>
							<code>{runtime.head}</code>
							<span>{runtime.dirty ? 'dirty' : 'clean'}</span>
						</div>
						<p className='muted'>{runtime.path}</p>
						{runtime.prs.length > 0 && (
							<ul>
								{runtime.prs.map((pr) => (
									<li key={`${pr.plan_ref}-${pr.url}`}>
										<code>{pr.plan_ref}</code>{' '}
										<a href={pr.url} target='_blank' rel='noreferrer'>
											{pr.url}
										</a>{' '}
										{pr.status ? (
											<span className={`status-badge ${pr.status}`}>{pr.status}</span>
										) : null}
									</li>
								))}
							</ul>
						)}
					</>
				) : (
					<p className='muted'>Runtime metadata nejsou dostupná.</p>
				)}
			</article>

			<article className='roadmap-control-card'>
				<h3>Vrstva AI kolegů</h3>
				{agentLane ? (
					<>
						<p>
							Vlastník <code>{agentLane.owner}</code>{' '}
							<span className={`status-badge ${agentLane.status}`}>{agentLane.status}</span>{' '}
							<span className='muted'>zdroj {agentLane.source}</span>
						</p>
						<ReferenceRow label='reviewers' values={agentLane.reviewers} />
						<ReferenceRow label='execution_agents' values={agentLane.execution_agents} />
						{agentLane.warnings.length > 0 && (
							<ul className='error-list'>
								{agentLane.warnings.map((warning) => (
									<li key={warning}>{warning}</li>
								))}
							</ul>
						)}
						<p className='muted'>{agentLane.escalation_policy}</p>
					</>
				) : (
					<p className='muted'>Agent lane není dostupná.</p>
				)}
			</article>

			<article className='roadmap-control-card'>
				<h3>Release/readiness brána</h3>
				{releaseGate ? (
					<>
						<div className='plan-card-meta'>
							<span className={`status-badge ${releaseGate.status}`}>{releaseGate.status}</span>
							<span>otevřené kroky {releaseGate.open_step_count}</span>
							<span>dokončené kroky {releaseGate.done_step_count}</span>
						</div>
						<p>{releaseGate.next_action}</p>
						{releaseGate.blockers.length > 0 && (
							<ul>
								{releaseGate.blockers.map((blocker) => (
									<li key={blocker} className='error-text'>
										{blocker}
									</li>
								))}
							</ul>
						)}
						<ul>
							{releaseGate.checks.map((check) => (
								<li key={check.id}>
									<strong>{check.label}</strong>{' '}
									<span className={`status-badge ${check.status}`}>{check.status}</span>{' '}
									<span className='muted'>{check.detail}</span>
								</li>
							))}
						</ul>
					</>
				) : (
					<p className='muted'>Release brána není dostupná.</p>
				)}
			</article>
		</div>
	);
}

function RoadmapStepCard({
	step,
	issueBlockers,
	resolutionEvidence,
}: {
	step: RoadmapStep;
	issueBlockers: RoadmapIssueBlocker[];
	resolutionEvidence: RoadmapResolutionEvidence[];
}) {
	const acceptanceCriteria = Array.isArray(step.acceptance_criteria)
		? step.acceptance_criteria.filter(isNonEmptyString)
		: [];
	const hasHumanBlocker = issueBlockers.length > 0;
	const hasTechnicalBlocker = step.status === 'blocked' && !hasHumanBlocker;
	const timing = roadmapTimingWindow(step.timing);
	const confidence = timing?.confidence ? CONFIDENCE_LABELS[timing.confidence].toLowerCase() : null;
	return (
		<article className='roadmap-step-card'>
			<div className='plan-card-row'>
				<span className='plan-card-code'>{step.id}</span>
				<span className='plan-card-title'>{step.title}</span>
			</div>
			<div className='plan-card-meta'>
				<span className={`status-badge ${step.status}`}>{step.status}</span>
				<span>{step.executable ? 'spustitelný' : 'nespustitelný'}</span>
				{timing ? (
					<span>
						· termín {formatTimingWindow(timing)}
						{confidence ? ` (${confidence})` : ''}
					</span>
				) : step.timing !== undefined ? (
					<span className='error-text'>· neplatný termín</span>
				) : null}
			</div>
			<ReferenceRow label='priority_refs' values={step.priority_refs} />
			<ReferenceRow label='plan_refs' values={step.plan_refs} />
			<ReferenceRow label='todo_refs' values={step.todo_refs} />
			<ReferenceRow label='issue_refs' values={step.issue_refs} />
			<EvidenceList evidence={step.evidence_refs} />
			<IssueBlockerList blockers={issueBlockers} />
			<ResolutionEvidenceList evidence={resolutionEvidence} />
			{hasTechnicalBlocker && <TechnicalBlockerNotice />}
			<div className='roadmap-reference-row'>
				<strong>akceptační kritéria</strong>
				<ul>
					{acceptanceCriteria.map((item) => (
						<li key={item}>{item}</li>
					))}
				</ul>
			</div>
		</article>
	);
}

function IssueBlockerList({ blockers }: { blockers: RoadmapIssueBlocker[] }) {
	if (blockers.length === 0) return null;
	return (
		<div className='roadmap-issue-blocker-list'>
			{blockers.map((blocker) => (
				<article
					key={`${blocker.step_id}-${blocker.issue_id}`}
					className='roadmap-issue-blocker human'
				>
					<div className='plan-card-row'>
						<strong>Lidský blocker</strong>
						<code>{blocker.issue_id}</code>
						<span className={`priority-badge ${blocker.severity}`}>
							závažnost {blocker.severity}
						</span>
					</div>
					<h4>{blocker.title}</h4>
					<p>
						Čeká na člověka: vlastník <code>{blocker.owner}</code>, status{' '}
						<code>{blocker.status}</code>, zdroj <code>{blocker.file}</code>.
					</p>
					<p className='roadmap-notification-rule'>
						<strong>Notifikace Workspace Adminovi</strong>: ano — jen pro lidské rozhodnutí nebo
						approval.
					</p>
				</article>
			))}
		</div>
	);
}

function ResolutionEvidenceList({ evidence }: { evidence: RoadmapResolutionEvidence[] }) {
	if (evidence.length === 0) return null;
	return (
		<div className='roadmap-resolution-list'>
			{evidence.map((item) => (
				<article key={`${item.step_id}-${item.issue_id}`} className='roadmap-resolution-card'>
					<div className='plan-card-row'>
						<strong>Evidence rozhodnutí</strong>
						<code>{item.issue_id}</code>
						<span>Odblokovaný krok</span>
						<code>{item.step_id}</code>
					</div>
					<h4>{item.title}</h4>
					<p>
						Rozhodnuto: <strong>{item.decision}</strong>
					</p>
					{item.rationale ? <p className='muted'>Zdůvodnění: {item.rationale}</p> : null}
					<div className='plan-card-meta'>
						<span>vyřešil {item.resolved_by}</span>
						<span>· vyřešeno {item.resolved_at}</span>
						<span>
							· {item.source_ledger_path} → {item.resolved_ledger_path}
						</span>
					</div>
				</article>
			))}
		</div>
	);
}

function TechnicalBlockerNotice() {
	return (
		<div className='roadmap-technical-blocker'>
			<strong>Technický/agentní blocker</strong>
			<p>Bez notifikace Workspace Adminovi — nejde o lidské rozhodnutí nebo approval.</p>
		</div>
	);
}

function ReferenceRow({ label, values }: { label: string; values?: string[] }) {
	const safeValues = Array.isArray(values) ? values.filter(isNonEmptyString) : [];
	if (safeValues.length === 0) return null;
	return (
		<div className='roadmap-reference-row'>
			<strong>{label}</strong>
			<div className='reference-pill-row'>
				{safeValues.map((value) => (
					<code key={`${label}-${value}`} className='reference-pill'>
						{value}
					</code>
				))}
			</div>
		</div>
	);
}

function EvidenceList({ evidence }: { evidence?: RoadmapEvidenceRef[] }) {
	const safeEvidence = Array.isArray(evidence) ? evidence.filter(isRoadmapEvidenceRef) : [];
	if (safeEvidence.length === 0) return null;
	return (
		<div className='roadmap-reference-row'>
			<strong>evidence_refs</strong>
			<ul>
				{safeEvidence.map((item) => (
					<li key={`${item.label}-${item.path ?? item.url ?? item.kind}`}>
						{item.label} <span className='muted'>({item.kind})</span>
						{item.path && (
							<>
								{' '}
								<code>{item.path}</code>
							</>
						)}
						{item.url && (
							<>
								{' '}
								<a href={item.url} target='_blank' rel='noreferrer'>
									{item.url}
								</a>
							</>
						)}
					</li>
				))}
			</ul>
		</div>
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0;
}

function isRoadmapPriority(value: unknown): value is RoadmapPriority {
	return (
		isRecord(value) &&
		isNonEmptyString(value.id) &&
		isNonEmptyString(value.title) &&
		typeof value.rank === 'number' &&
		Number.isFinite(value.rank) &&
		isNonEmptyString(value.rationale)
	);
}

function isRoadmapStep(value: unknown): value is RoadmapStep {
	return (
		isRecord(value) &&
		isNonEmptyString(value.id) &&
		isNonEmptyString(value.title) &&
		isNonEmptyString(value.status) &&
		typeof value.executable === 'boolean'
	);
}

function isRoadmapEvidenceRef(value: unknown): value is RoadmapEvidenceRef {
	return isRecord(value) && isNonEmptyString(value.label) && isNonEmptyString(value.kind);
}
