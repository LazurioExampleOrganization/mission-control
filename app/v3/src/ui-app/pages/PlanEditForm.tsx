import { useEffect, useState } from 'react';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { MissionControlPlan, PlanPriority, PlanStatus } from '../../model.ts';
import { api } from '../api.ts';

type Props = {
	devCode: string;
	yaml: string;
	onSaved: (yaml: string) => void;
	onCancel: () => void;
};

const PLAN_STATUSES: PlanStatus[] = [
	'shaping',
	'ready',
	'in_progress',
	'review',
	'blocked',
	'done',
	'archived',
];

const PLAN_PRIORITIES: PlanPriority[] = ['urgent', 'high', 'medium', 'low'];

export function PlanEditForm({ devCode, yaml, onSaved, onCancel }: Props) {
	const [plan, setPlan] = useState<MissionControlPlan | null>(null);
	const [parseError, setParseError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [result, setResult] = useState<string | null>(null);
	const [resultIsError, setResultIsError] = useState(false);

	useEffect(() => {
		try {
			const parsed = parseYaml(yaml) as MissionControlPlan;
			setPlan(parsed);
			setParseError(null);
		} catch (err) {
			setParseError(err instanceof Error ? err.message : String(err));
		}
	}, [yaml]);

	if (parseError) {
		return (
			<div className='panel-section'>
				<p className='error-text'>Nepovedlo se rozparsovat YAML: {parseError}</p>
				<button type='button' className='button' onClick={onCancel}>
					Zpět
				</button>
			</div>
		);
	}
	if (!plan) {
		return <div className='panel-section'>Připravuji editor…</div>;
	}

	const updatePlan = (next: MissionControlPlan) => setPlan({ ...next });
	const setText = (key: keyof MissionControlPlan, value: string) =>
		updatePlan({ ...plan, [key]: value });
	const setList = (key: 'acceptance_criteria' | 'validation', value: string) =>
		updatePlan({
			...plan,
			[key]: value
				.split('\n')
				.map((line) => line.trim())
				.filter(Boolean),
		});
	const setScope = (which: 'in' | 'out', value: string) =>
		updatePlan({
			...plan,
			scope: {
				...plan.scope,
				[which]: value
					.split('\n')
					.map((line) => line.trim())
					.filter(Boolean),
			},
		});

	async function handleSave() {
		if (!plan) return;
		setSaving(true);
		setResult('Ukládám…');
		setResultIsError(false);
		try {
			const today = new Date().toISOString().slice(0, 10);
			const nextYaml = stringifyYaml({ ...plan, updated_at: today });
			const res = await api.savePlanYaml(devCode, nextYaml);
			setResult(JSON.stringify(res.validation, null, 2));
			setResultIsError(false);
			onSaved(nextYaml);
		} catch (err) {
			setResult(err instanceof Error ? err.message : String(err));
			setResultIsError(true);
		} finally {
			setSaving(false);
		}
	}

	return (
		<div className='panel-section'>
			<div className='panel-header'>
				<div>
					<h2>Editor sekcí · {plan.dev_code}</h2>
					<p className='muted'>
						Formulářová editace klíčových sekcí. Ukládá přes stejný `validate.ts` + `store.ts` gate
						jako raw YAML editor; `updated_at` se přepíše na dnešní datum.
					</p>
				</div>
				<div className='page-toolbar'>
					<button type='button' className='button' onClick={onCancel}>
						Zpět na náhled
					</button>
					<button type='button' className='button primary' onClick={handleSave} disabled={saving}>
						Uložit změny
					</button>
				</div>
			</div>

			<div className='form-grid'>
				<div className='field full'>
					<label>Název plánu</label>
					<input value={plan.title} onChange={(e) => setText('title', e.target.value)} />
				</div>
				<div className='field'>
					<label>Status</label>
					<select
						value={plan.status}
						onChange={(e) => setText('status', e.target.value as PlanStatus)}
					>
						{PLAN_STATUSES.map((option) => (
							<option key={option} value={option}>
								{option}
							</option>
						))}
					</select>
				</div>
				<div className='field'>
					<label>Priorita</label>
					<select
						value={plan.priority}
						onChange={(e) => setText('priority', e.target.value as PlanPriority)}
					>
						{PLAN_PRIORITIES.map((option) => (
							<option key={option} value={option}>
								{option}
							</option>
						))}
					</select>
				</div>
				<div className='field'>
					<label>Priority rank</label>
					<input
						type='number'
						min={1}
						value={plan.priority_rank}
						onChange={(e) =>
							updatePlan({ ...plan, priority_rank: Math.max(1, Number(e.target.value) || 1) })
						}
					/>
				</div>
				<div className='field'>
					<label>Owner</label>
					<input value={plan.owner} onChange={(e) => setText('owner', e.target.value)} />
				</div>
				<div className='field full'>
					<label>Kontext</label>
					<textarea
						value={plan.context}
						onChange={(e) => setText('context', e.target.value)}
						style={{ minHeight: 120 }}
					/>
				</div>
				<div className='field full'>
					<label>Aktuální problém</label>
					<textarea
						value={plan.current_problem}
						onChange={(e) => setText('current_problem', e.target.value)}
						style={{ minHeight: 120 }}
					/>
				</div>
				<div className='field full'>
					<label>Cílový stav</label>
					<textarea
						value={plan.target_state}
						onChange={(e) => setText('target_state', e.target.value)}
						style={{ minHeight: 120 }}
					/>
				</div>
				<div className='field'>
					<label>Scope – uvnitř (jeden řádek = jedna položka)</label>
					<textarea
						value={plan.scope.in.join('\n')}
						onChange={(e) => setScope('in', e.target.value)}
						style={{ minHeight: 140 }}
					/>
				</div>
				<div className='field'>
					<label>Scope – mimo (jeden řádek = jedna položka)</label>
					<textarea
						value={plan.scope.out.join('\n')}
						onChange={(e) => setScope('out', e.target.value)}
						style={{ minHeight: 140 }}
					/>
				</div>
				<div className='field full'>
					<label>Acceptance criteria (jeden řádek = jedna položka)</label>
					<textarea
						value={plan.acceptance_criteria.join('\n')}
						onChange={(e) => setList('acceptance_criteria', e.target.value)}
						style={{ minHeight: 140 }}
					/>
				</div>
				<div className='field full'>
					<label>Validation (jeden řádek = jedna položka)</label>
					<textarea
						value={plan.validation.join('\n')}
						onChange={(e) => setList('validation', e.target.value)}
						style={{ minHeight: 140 }}
					/>
				</div>
			</div>

			{result !== null && (
				<pre className={`api-output${resultIsError ? ' error' : ''}`}>{result}</pre>
			)}
		</div>
	);
}
