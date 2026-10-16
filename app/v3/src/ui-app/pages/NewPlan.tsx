import { useEffect, useState } from 'react';
import { api } from '../api.ts';

type Step =
	| { kind: 'loading-next' }
	| { kind: 'draft'; nextDevCode: string; busy: boolean; error: string | null }
	| {
			kind: 'yaml-editor';
			devCode: string;
			yaml: string;
			saving: boolean;
			result: string | null;
			resultIsError: boolean;
	  };

export function NewPlanPage({ onCreated }: { onCreated: (devCode: string) => Promise<void> }) {
	const [step, setStep] = useState<Step>({ kind: 'loading-next' });
	const [title, setTitle] = useState('');
	const [priority, setPriority] = useState<'high' | 'urgent' | 'medium' | 'low'>('high');
	const [status, setStatus] = useState<'shaping' | 'ready' | 'in_progress'>('shaping');
	const [priorityRank, setPriorityRank] = useState<number>(50);
	const [todoPath, setTodoPath] = useState('TODO.tasks.json');

	useEffect(() => {
		let cancelled = false;
		api
			.nextDevCode()
			.then((res) => {
				if (cancelled) return;
				setStep({ kind: 'draft', nextDevCode: res.next_dev_code, busy: false, error: null });
			})
			.catch((err) => {
				if (cancelled) return;
				setStep({
					kind: 'draft',
					nextDevCode: '…',
					busy: false,
					error: err instanceof Error ? err.message : String(err),
				});
			});
		return () => {
			cancelled = true;
		};
	}, []);

	async function handleDryRun() {
		if (step.kind !== 'draft') return;
		setStep({ ...step, busy: true, error: null });
		try {
			const res = await api.createPlan({
				title,
				priority,
				status,
				priority_rank: priorityRank,
				todo_tasks_path: todoPath,
				scope: 'companiesascode-root',
				dry_run: true,
			});
			if (!res.yaml || !res.dev_code) {
				throw new Error('Server nevrátil YAML draft.');
			}
			setStep({
				kind: 'yaml-editor',
				devCode: res.dev_code,
				yaml: res.yaml,
				saving: false,
				result: null,
				resultIsError: false,
			});
		} catch (err) {
			setStep({ ...step, busy: false, error: err instanceof Error ? err.message : String(err) });
		}
	}

	async function handleSave() {
		if (step.kind !== 'yaml-editor') return;
		setStep({ ...step, saving: true, result: 'Ukládám…', resultIsError: false });
		try {
			const res = await api.createPlan({ yaml: step.yaml });
			setStep({
				...step,
				saving: false,
				result: JSON.stringify(res.validation, null, 2),
				resultIsError: false,
			});
			if (res.record) {
				await onCreated(res.record.plan.dev_code);
			}
		} catch (err) {
			setStep({
				...step,
				saving: false,
				result: err instanceof Error ? err.message : String(err),
				resultIsError: true,
			});
		}
	}

	if (step.kind === 'loading-next') {
		return <div className='panel'>Načítám další kód plánu…</div>;
	}

	if (step.kind === 'draft') {
		return (
			<div className='panel'>
				<div className='panel-header'>
					<div>
						<h2>Nový plán</h2>
						<p className='muted'>
							Další kód plánu: <code>{step.nextDevCode}</code>
						</p>
					</div>
					<button
						type='button'
						className='button primary'
						onClick={handleDryRun}
						disabled={step.busy || !title.trim()}
					>
						Připravit YAML
					</button>
				</div>
				<div className='form-grid'>
					<div className='field full'>
						<label>Název</label>
						<input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
					</div>
					<div className='field'>
						<label>Priorita</label>
						<select
							value={priority}
							onChange={(e) => setPriority(e.target.value as typeof priority)}
						>
							<option value='urgent'>urgent</option>
							<option value='high'>high</option>
							<option value='medium'>medium</option>
							<option value='low'>low</option>
						</select>
					</div>
					<div className='field'>
						<label>Status</label>
						<select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
							<option value='shaping'>shaping</option>
							<option value='ready'>ready</option>
							<option value='in_progress'>in_progress</option>
						</select>
					</div>
					<div className='field'>
						<label>Priority rank</label>
						<input
							type='number'
							min={1}
							value={priorityRank}
							onChange={(e) => setPriorityRank(Number(e.target.value))}
						/>
					</div>
					<div className='field'>
						<label>TODO ledger</label>
						<input value={todoPath} onChange={(e) => setTodoPath(e.target.value)} />
					</div>
				</div>
				{step.error && <p className='error-text'>{step.error}</p>}
			</div>
		);
	}

	return (
		<div className='panel'>
			<div className='panel-header'>
				<div>
					<h2>
						Nový plán <code>{step.devCode}</code>
					</h2>
					<p className='muted'>Doplň kurátorské sekce a ulož přes Persistence gate.</p>
				</div>
				<button
					type='button'
					className='button primary'
					onClick={handleSave}
					disabled={step.saving}
				>
					Uložit YAML
				</button>
			</div>
			<div className='field full'>
				<label>YAML draft</label>
				<textarea
					value={step.yaml}
					onChange={(e) => {
						const yaml = e.target.value;
						setStep((prev) => (prev.kind === 'yaml-editor' ? { ...prev, yaml } : prev));
					}}
				/>
			</div>
			{step.result !== null && (
				<pre className={`api-output${step.resultIsError ? ' error' : ''}`}>{step.result}</pre>
			)}
		</div>
	);
}
