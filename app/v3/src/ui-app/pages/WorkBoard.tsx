import type { PlanRecord } from '../../model.ts';
import type { WorkBoardResponse } from '../api.ts';
import { SummaryStat } from '../components/SummaryStat.tsx';
import { openPullRequestsForPlans, type PlanPullRequest } from '../plan-prs.ts';

export function WorkBoardPage({
	board,
	plans,
	error,
}: {
	board: WorkBoardResponse['board'] | null;
	plans: PlanRecord[];
	error?: string | null;
}) {
	if (!board) {
		return (
			<div className={`panel${error ? ' error-text' : ''}`}>
				{error ? `Work board není dostupný: ${error}` : 'Work board není dostupný.'}
			</div>
		);
	}
	const coverage = board.planning_coverage;
	const openPullRequests = openPullRequestsForPlans(plans);
	return (
		<div className='panel'>
			{error ? (
				<p className='panel error-text'>Poslední refresh Work boardu selhal: {error}</p>
			) : null}
			<h2>Work board · TODO/DONE/ISSUES coverage</h2>
			<p className='muted' style={{ marginBottom: 12 }}>
				Plány a navázané ledger položky podle <code>planning.plan_id</code> a <code>dev_code</code>.
			</p>
			<div className='summary-grid'>
				<SummaryStat label='TODO s plánem' value={coverage.todo_with_plan} tone='ok' />
				<SummaryStat
					label='TODO bez plánu'
					value={coverage.todo_without_plan}
					tone={coverage.todo_without_plan > 0 ? 'warning' : undefined}
				/>
				<SummaryStat
					label='Rozbité plán vazby'
					value={coverage.broken_plan_links.length}
					tone={coverage.broken_plan_links.length > 0 ? 'error' : undefined}
				/>
				<SummaryStat label='Plánů' value={plans.length} />
				<SummaryStat
					label='Otevřená PR'
					value={openPullRequests.length}
					tone={openPullRequests.length > 0 ? 'warning' : 'ok'}
				/>
			</div>
			<OpenPullRequestsPanel pullRequests={openPullRequests} />
			{coverage.broken_plan_links.length === 0 ? (
				<p className='muted' style={{ marginTop: 16 }}>
					MC planning vazby v načtených ledgerech jsou konzistentní.
				</p>
			) : (
				<div className='panel-section'>
					<h3>Rozbité vazby</h3>
					<ul>
						{coverage.broken_plan_links.slice(0, 12).map((item) => (
							<li key={`${item.id}-${item.ledger_path}`}>
								<code>{item.id}</code> · {item.ledger_path}{' '}
								<span className='priority-badge'>{item.planning_status}</span>{' '}
								<span className='muted'>
									{(item.planning_errors ?? []).map((error) => error.message).join(' ')}
								</span>
							</li>
						))}
					</ul>
				</div>
			)}
		</div>
	);
}

function OpenPullRequestsPanel({ pullRequests }: { pullRequests: PlanPullRequest[] }) {
	return (
		<section className='panel-section decision-panel pr-panel'>
			<div className='decision-panel-header'>
				<div>
					<h3>Otevřené PR navázané na plány</h3>
					<p>
						Lehký review surface z <code>github.prs</code> v Mission Control plánech. Detaily a
						aktuální diskuze zůstávají na GitHubu přes URL.
					</p>
				</div>
				<strong className='decision-count'>{pullRequests.length}</strong>
			</div>
			{pullRequests.length === 0 ? (
				<p className='muted'>Žádné otevřené PR není zapsané v plánech.</p>
			) : (
				<div className='decision-list'>
					{pullRequests.map((pr) => (
						<article key={`${pr.devCode}:${pr.url}`} className='decision-card'>
							<div>
								<strong>
									<span className='plan-card-code'>{pr.devCode}</span> · {pr.title}
								</strong>
								{pr.note ? <p>{pr.note}</p> : <p className='muted'>Bez poznámky v plánu.</p>}
								<div className='decision-meta'>
									<span className='priority-badge'>{pr.status}</span>
								</div>
							</div>
							<div className='row-actions'>
								<a href={pr.url} target='_blank' rel='noreferrer'>
									{pr.url}
								</a>
							</div>
						</article>
					))}
				</div>
			)}
		</section>
	);
}
