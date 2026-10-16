import { useEffect, useState } from 'react';
import type { PlanWorkSummary } from '../../work-board.ts';
import { SummaryStat } from '../components/SummaryStat.tsx';

export function LinkedWorkPanel({ devCode }: { devCode: string }) {
	const [state, setState] = useState<
		| { kind: 'loading' }
		| { kind: 'error'; message: string }
		| { kind: 'ready'; work: PlanWorkSummary }
	>({ kind: 'loading' });

	useEffect(() => {
		let cancelled = false;
		setState({ kind: 'loading' });
		fetch(`/api/plans/${encodeURIComponent(devCode)}/work`)
			.then(async (res) => {
				const data = (await res.json()) as
					| { work: PlanWorkSummary }
					| { error: string; message?: string };
				if (!res.ok) {
					throw new Error(
						'error' in data ? data.message || data.error : 'Linked work není dostupný.',
					);
				}
				if (cancelled || !('work' in data)) return;
				setState({ kind: 'ready', work: data.work });
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
		return <div className='panel-section'>Načítám linked work…</div>;
	}
	if (state.kind === 'error') {
		return (
			<div className='panel-section'>
				<p className='error-text'>{state.message}</p>
			</div>
		);
	}

	const { work } = state;
	return (
		<div className='panel-section'>
			<h3>Linked work · TODO / DONE / ISSUES</h3>
			<div className='summary-grid' style={{ marginBottom: 16 }}>
				<SummaryStat
					label='Open TODO'
					value={work.todo_open.length}
					tone={work.todo_open.length > 0 ? 'warning' : 'ok'}
				/>
				<SummaryStat label='DONE evidence' value={work.done.length} tone='ok' />
				<SummaryStat
					label='Open ISSUES'
					value={work.issues_open.length}
					tone={work.issues_open.length > 0 ? 'warning' : 'ok'}
				/>
				<SummaryStat label='Vyřešené ISSUES' value={work.issues_resolved.length} tone='ok' />
				<SummaryStat
					label='Rozbité vazby'
					value={work.broken_links.length}
					tone={work.broken_links.length > 0 ? 'error' : 'ok'}
				/>
			</div>

			{work.close_blockers.length > 0 ? (
				<div className='panel-section'>
					<h3>Close blockery</h3>
					<ul>
						{work.close_blockers.map((blocker, i) => (
							<li key={`${i}-${blocker.slice(0, 20)}`} className='error-text'>
								{blocker}
							</li>
						))}
					</ul>
				</div>
			) : (
				<p className='muted' style={{ marginBottom: 12 }}>
					Plán nemá close blockery — `plan close` projde.
				</p>
			)}

			<PlanIssueDecisionList items={work.issues_open} />
			<ItemList
				title='Vyřešené ISSUES'
				items={work.issues_resolved}
				emptyText='Žádné vyřešené ISSUES evidence.'
			/>
			<ItemList title='Open TODO' items={work.todo_open} emptyText='Žádné open TODO.' />
			<ItemList title='DONE evidence' items={work.done} emptyText='Bez DONE evidence.' />
			{work.broken_links.length > 0 && (
				<ItemList title='Rozbité planning vazby' items={work.broken_links} emptyText='' highlight />
			)}
		</div>
	);
}

function PlanIssueDecisionList({ items }: { items: PlanWorkSummary['issues_open'] }) {
	return (
		<section className={`panel-section decision-panel${items.length > 0 ? ' is-hot' : ''}`}>
			<div className='decision-panel-header'>
				<div>
					<h3>ISSUES k rozhodnutí pro tento plán</h3>
					<p>
						Tyhle položky musí rozhodnout člověk nebo se musí explicitně přenést do dalšího plánu.
						Nejsou to běžné TODO pro agenta.
					</p>
				</div>
				<strong className='decision-count'>{items.length}</strong>
			</div>
			{items.length === 0 ? (
				<p className='muted'>Žádné open ISSUES pro tento plán.</p>
			) : (
				<div className='decision-list'>
					{items.slice(0, 12).map((item) => (
						<article key={`${item.kind}-${item.id}`} className='decision-card'>
							<div>
								<strong>{item.title}</strong>
								<div className='decision-meta'>
									<code>{item.id}</code>
									<span>{item.ledger_path}</span>
									<span className='priority-badge'>{item.status}</span>
									{item.severity ? (
										<span className={`priority-badge ${item.severity}`}>
											severity {item.severity}
										</span>
									) : null}
								</div>
							</div>
						</article>
					))}
				</div>
			)}
		</section>
	);
}

function ItemList({
	title,
	items,
	emptyText,
	highlight,
}: {
	title: string;
	items: PlanWorkSummary['todo_open'];
	emptyText: string;
	highlight?: boolean;
}) {
	if (items.length === 0) {
		if (!emptyText) return null;
		return (
			<div className='panel-section'>
				<h3>{title}</h3>
				<p className='muted'>{emptyText}</p>
			</div>
		);
	}
	return (
		<div className='panel-section'>
			<h3>{title}</h3>
			<ul>
				{items.slice(0, 30).map((item) => (
					<li key={`${item.kind}-${item.id}`}>
						<code>{item.id}</code> · {item.title}{' '}
						<span className={`status-badge ${item.status}`}>{item.status}</span>
						{item.dev_code && item.dev_code !== item.plan?.dev_code && (
							<span className='priority-badge'>tag {item.dev_code}</span>
						)}{' '}
						<span className='muted'>{item.ledger_path}</span>
						{highlight && item.planning_errors && (
							<ul>
								{item.planning_errors.map((error) => (
									<li key={error.code} className='error-text'>
										{error.code}: {error.message}
									</li>
								))}
							</ul>
						)}
					</li>
				))}
			</ul>
		</div>
	);
}
