import type { WorkBoardResponse } from '../api.ts';
import { SummaryStat } from '../components/SummaryStat.tsx';

export function PlanningCoverage({ board }: { board: WorkBoardResponse['board'] | null }) {
	if (!board) {
		return <div className='panel'>Planning coverage není dostupný.</div>;
	}
	const coverage = board.planning_coverage;
	return (
		<div className='panel'>
			<h2>Planning coverage</h2>
			<p className='muted' style={{ marginBottom: 12 }}>
				Které TODO mají platný MC plán a kde jsou vazby rozbité.
			</p>
			<div className='summary-grid'>
				<SummaryStat label='TODO s plánem' value={coverage.todo_with_plan} tone='ok' />
				<SummaryStat
					label='TODO bez plánu'
					value={coverage.todo_without_plan}
					tone={coverage.todo_without_plan > 0 ? 'warning' : undefined}
				/>
				<SummaryStat
					label='TODO s kódem bez plánu'
					value={coverage.dev_without_plan.length}
					tone={coverage.dev_without_plan.length > 0 ? 'warning' : undefined}
				/>
				<SummaryStat
					label='Rozbité vazby'
					value={coverage.broken_plan_links.length}
					tone={coverage.broken_plan_links.length > 0 ? 'error' : undefined}
				/>
				<SummaryStat
					label='Ledger read errors'
					value={coverage.ledger_read_errors.length}
					tone={coverage.ledger_read_errors.length > 0 ? 'error' : undefined}
				/>
			</div>

			<div className='panel-section'>
				<h3>Rozbité plán vazby</h3>
				{coverage.broken_plan_links.length === 0 ? (
					<p className='muted'>Žádné.</p>
				) : (
					<ul>
						{coverage.broken_plan_links.slice(0, 16).map((item) => (
							<li key={`${item.id}-${item.ledger_path}`}>
								<code>{item.id}</code> · {item.ledger_path}{' '}
								<span className='priority-badge'>{item.planning_status}</span>{' '}
								<span className='muted'>
									{(item.planning_errors ?? []).map((error) => error.message).join(' ')}
								</span>
							</li>
						))}
					</ul>
				)}
			</div>

			<div className='panel-section'>
				<h3>TODO s kódem bez plánu</h3>
				{coverage.dev_without_plan.length === 0 ? (
					<p className='muted'>Všechna TODO s kódem plánu mají platný plán.</p>
				) : (
					<ul>
						{coverage.dev_without_plan.slice(0, 24).map((item) => (
							<li key={item.id}>
								<code>{item.id}</code> · <strong>{item.dev_code ?? 'bez kódu'}</strong>
							</li>
						))}
					</ul>
				)}
			</div>

			<div className='panel-section'>
				<h3>Ledger read errors</h3>
				{coverage.ledger_read_errors.length === 0 ? (
					<p className='muted'>Bez chyb.</p>
				) : (
					<ul>
						{coverage.ledger_read_errors.map((error) => (
							<li key={error.ledger_path}>
								<code>{error.ledger_path}</code> ·{' '}
								<span className='error-text'>{error.message}</span>
							</li>
						))}
					</ul>
				)}
			</div>
		</div>
	);
}
