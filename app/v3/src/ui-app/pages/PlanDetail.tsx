import { useEffect, useState } from 'react';
import type { MissionControlPlan } from '../../model.ts';
import { api } from '../api.ts';
import { LinkedWorkPanel } from './LinkedWorkPanel.tsx';
import { PlanEditForm } from './PlanEditForm.tsx';
import { LinkedProposalsPanel } from './Proposals.tsx';

type ViewMode = 'view' | 'edit';

type State =
	| { kind: 'loading' }
	| { kind: 'error'; message: string }
	| {
			kind: 'ready';
			plan: MissionControlPlan;
			relativePath: string;
			yaml: string;
			yamlDraft: string;
			saving: boolean;
			result: string | null;
			resultIsError: boolean;
			view: ViewMode;
	  };

export function PlanDetail({
	devCode,
	onBack,
	onSaved,
}: {
	devCode: string;
	onBack: () => void;
	onSaved: () => Promise<void>;
}) {
	const [state, setState] = useState<State>({ kind: 'loading' });

	useEffect(() => {
		let cancelled = false;
		setState({ kind: 'loading' });
		api
			.planDetail(devCode)
			.then((record) => {
				if (cancelled) return;
				setState({
					kind: 'ready',
					plan: record.plan,
					relativePath: record.relativePath,
					yaml: record.yaml,
					yamlDraft: record.yaml,
					saving: false,
					result: null,
					resultIsError: false,
					view: 'view',
				});
			})
			.catch((err) => {
				if (cancelled) return;
				setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
			});
		return () => {
			cancelled = true;
		};
	}, [devCode]);

	if (state.kind === 'loading') {
		return <div className='panel'>Načítám plán {devCode}…</div>;
	}
	if (state.kind === 'error') {
		return (
			<div className='panel'>
				<p className='error-text'>{state.message}</p>
				<button type='button' className='button' onClick={onBack}>
					← Zpět na seznam
				</button>
			</div>
		);
	}

	const plan = state.plan;

	async function handleSaveYaml() {
		if (state.kind !== 'ready') return;
		setState({ ...state, saving: true, result: 'Ukládám…', resultIsError: false });
		try {
			const result = await api.savePlanYaml(devCode, state.yamlDraft);
			setState({
				...state,
				saving: false,
				result: JSON.stringify(result.validation, null, 2),
				resultIsError: false,
				yaml: state.yamlDraft,
			});
			await onSaved();
		} catch (err) {
			setState({
				...state,
				saving: false,
				result: err instanceof Error ? err.message : String(err),
				resultIsError: true,
			});
		}
	}

	async function handleExport() {
		if (state.kind !== 'ready') return;
		setState({ ...state, result: 'Exportuji…', resultIsError: false });
		try {
			const result = await api.exportTodo(devCode);
			setState({ ...state, result: JSON.stringify(result, null, 2), resultIsError: false });
		} catch (err) {
			setState({
				...state,
				result: err instanceof Error ? err.message : String(err),
				resultIsError: true,
			});
		}
	}

	async function handleFormSaved(nextYaml: string) {
		if (state.kind !== 'ready') return;
		setState({ ...state, yaml: nextYaml, yamlDraft: nextYaml, view: 'view' });
		await onSaved();
	}

	if (state.view === 'edit') {
		return (
			<div className='panel'>
				<div className='panel-header'>
					<div>
						<button type='button' className='button' onClick={onBack}>
							← Zpět na seznam
						</button>
						<h2 style={{ marginTop: 12 }}>
							<span className='plan-card-code'>{plan.dev_code}</span> · {plan.title}
						</h2>
						<div className='plan-card-meta'>
							<span className={`status-badge ${plan.status}`}>{plan.status}</span>
							<span className={`priority-badge ${plan.priority}`}>{plan.priority}</span>
							<span className='plan-card-rank'>rank {plan.priority_rank}</span>
							<span>· {state.relativePath}</span>
						</div>
					</div>
				</div>
				<PlanEditForm
					devCode={devCode}
					yaml={state.yaml}
					onSaved={handleFormSaved}
					onCancel={() => setState({ ...state, view: 'view' })}
				/>
			</div>
		);
	}

	return (
		<div className='panel'>
			<div className='panel-header'>
				<div>
					<button type='button' className='button' onClick={onBack}>
						← Zpět na seznam
					</button>
					<h2 style={{ marginTop: 12 }}>
						<span className='plan-card-code'>{plan.dev_code}</span> · {plan.title}
					</h2>
					<div className='plan-card-meta'>
						<span className={`status-badge ${plan.status}`}>{plan.status}</span>
						<span className={`priority-badge ${plan.priority}`}>{plan.priority}</span>
						<span className='plan-card-rank'>rank {plan.priority_rank}</span>
						<span>· {state.relativePath}</span>
					</div>
				</div>
				<div className='page-toolbar'>
					<button
						type='button'
						className='button'
						onClick={() => setState({ ...state, view: 'edit' })}
					>
						Upravit
					</button>
					<button type='button' className='button' onClick={handleExport}>
						Dry-run TODO
					</button>
					<button
						type='button'
						className='button primary'
						onClick={handleSaveYaml}
						disabled={state.saving}
					>
						Uložit YAML
					</button>
				</div>
			</div>

			<PlanSummarySections plan={plan} />

			<LinkedProposalsPanel devCode={devCode} />

			<LinkedWorkPanel devCode={devCode} />

			<details className='panel-section'>
				<summary
					style={{
						cursor: 'pointer',
						fontSize: '0.82rem',
						textTransform: 'uppercase',
						letterSpacing: '0.08em',
						color: 'var(--cac-ink-muted)',
						fontWeight: 700,
						marginBottom: 8,
					}}
				>
					Raw YAML (fallback editor)
				</summary>
				<div className='field full'>
					<textarea
						value={state.yamlDraft}
						onChange={(e) => {
							const draft = e.target.value;
							setState((prev) =>
								prev.kind === 'ready' ? { ...prev, yamlDraft: draft, result: null } : prev,
							);
						}}
					/>
				</div>
			</details>

			{state.result !== null && (
				<pre className={`api-output${state.resultIsError ? ' error' : ''}`}>{state.result}</pre>
			)}
		</div>
	);
}

function PlanSummarySections({ plan }: { plan: MissionControlPlan }) {
	return (
		<>
			<Section title='Kontext'>
				<p>{plan.context}</p>
			</Section>
			<Section title='Aktuální problém'>
				<p>{plan.current_problem}</p>
			</Section>
			<Section title='Cílový stav'>
				<p>{plan.target_state}</p>
			</Section>
			<Section title='Scope – uvnitř'>
				<ul>
					{plan.scope.in.map((item) => (
						<li key={item}>{item}</li>
					))}
				</ul>
			</Section>
			<Section title='Scope – mimo'>
				<ul>
					{plan.scope.out.map((item) => (
						<li key={item}>{item}</li>
					))}
				</ul>
			</Section>
			<Section title='Acceptance criteria'>
				<ul>
					{plan.acceptance_criteria.map((item) => (
						<li key={item}>{item}</li>
					))}
				</ul>
			</Section>
			<Section title='Validation'>
				<ul>
					{plan.validation.map((item) => (
						<li key={item}>
							<code>{item}</code>
						</li>
					))}
				</ul>
			</Section>
			{plan.risk_notes && plan.risk_notes.length > 0 && (
				<Section title='Risk notes'>
					<ul>
						{plan.risk_notes.map((item) => (
							<li key={item}>{item}</li>
						))}
					</ul>
				</Section>
			)}
			{plan.decisions && plan.decisions.length > 0 && (
				<Section title='Decisions'>
					<ul>
						{plan.decisions.map((decision) => (
							<li key={`${decision.date}-${decision.decision}`}>
								<strong>{decision.date}</strong> – {decision.decision}
								{decision.rationale && (
									<>
										{' '}
										<span className='muted'>({decision.rationale})</span>
									</>
								)}
							</li>
						))}
					</ul>
				</Section>
			)}
			{plan.open_questions && plan.open_questions.length > 0 && (
				<Section title='Open questions'>
					<ul>
						{plan.open_questions.map((item) => (
							<li key={item}>{item}</li>
						))}
					</ul>
				</Section>
			)}
			{plan.github && (plan.github.branches?.length || plan.github.prs?.length) && (
				<Section title='GitHub'>
					<ul>
						{plan.github.branches?.map((branch) => (
							<li key={branch}>
								<code>{branch}</code>
							</li>
						))}
						{plan.github.prs?.map((pr) => (
							<li key={pr.url}>
								<a href={pr.url} target='_blank' rel='noreferrer'>
									{pr.url}
								</a>
								{pr.status && (
									<>
										{' '}
										· <span className='muted'>{pr.status}</span>
									</>
								)}
							</li>
						)) || null}
					</ul>
				</Section>
			)}
		</>
	);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<div className='panel-section'>
			<h3>{title}</h3>
			{children}
		</div>
	);
}
