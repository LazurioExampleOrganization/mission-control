import { useState } from 'react';
import { api } from '../api.ts';

export function ValidateAllPage() {
	const [busy, setBusy] = useState(false);
	const [result, setResult] = useState<string | null>(null);
	const [isError, setIsError] = useState(false);

	async function handleRun() {
		setBusy(true);
		setResult('Validuji…');
		setIsError(false);
		try {
			const res = await api.validate();
			if (res.ok) {
				setResult('Mission Control plány jsou validní.');
				setIsError(false);
			} else {
				setResult(JSON.stringify(res.errors ?? [], null, 2));
				setIsError(true);
			}
		} catch (err) {
			setResult(err instanceof Error ? err.message : String(err));
			setIsError(true);
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className='panel'>
			<div className='panel-header'>
				<div>
					<h2>Validovat plány</h2>
					<p className='muted'>
						Spustí cross-plan Ajv + duplicate invariant kontrolu ze stejného gatu jako CLI.
					</p>
				</div>
				<button type='button' className='button primary' onClick={handleRun} disabled={busy}>
					Spustit validaci
				</button>
			</div>
			{result !== null && <pre className={`api-output${isError ? ' error' : ''}`}>{result}</pre>}
		</div>
	);
}
