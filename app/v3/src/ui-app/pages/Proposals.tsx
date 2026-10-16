import { useEffect, useMemo, useState } from 'react';
import type { PlanRecord } from '../../model.ts';
import { api, type ProposalsResponse } from '../api.ts';

// Mapování proposal lifecycle na existující barvy status badge plánů.
const STATUS_BADGE: Record<string, string> = {
	draft: 'shaping',
	discussion: 'review',
	accepted: 'ready',
	implemented: 'done',
	rejected: 'blocked',
	archived: 'archived',
};

type LoadState =
	| { kind: 'loading' }
	| { kind: 'error'; message: string }
	| { kind: 'ready'; data: ProposalsResponse };

function useProposals(): LoadState {
	const [state, setState] = useState<LoadState>({ kind: 'loading' });
	useEffect(() => {
		let cancelled = false;
		api
			.proposals()
			.then((data) => {
				if (!cancelled) setState({ kind: 'ready', data });
			})
			.catch((error) => {
				if (!cancelled) {
					setState({
						kind: 'error',
						message: error instanceof Error ? error.message : String(error),
					});
				}
			});
		return () => {
			cancelled = true;
		};
	}, []);
	return state;
}

export function ProposalsPage({
	plans,
	onOpenPlan,
}: {
	plans: PlanRecord[];
	onOpenPlan: (devCode: string) => void;
}) {
	const state = useProposals();
	const planByDevCode = useMemo(
		() => new Map(plans.map((record) => [record.plan.dev_code, record.plan])),
		[plans],
	);

	if (state.kind === 'loading') return <div className='panel'>Načítám proposaly…</div>;
	if (state.kind === 'error') return <div className='panel error-text'>{state.message}</div>;

	const { proposals, failures } = state.data;
	return (
		<div className='proposals-page'>
			{failures.length > 0 && (
				<div className='panel error-text'>
					<strong>Validace proposalů selhala:</strong>
					<ul>
						{failures.map((failure) => (
							<li key={failure}>{failure}</li>
						))}
					</ul>
				</div>
			)}
			{proposals.length === 0 && (
				<div className='panel'>
					Zatím žádné proposaly. Kontrakt drží mission-control/proposals/README.md, postup skill
					proposal-authoring.
				</div>
			)}
			<div className='plan-grid'>
				{proposals.map((item) => {
					if (!item.proposal) {
						return (
							<div key={item.folder} className='plan-card'>
								<div className='plan-card-row'>
									<span className='plan-card-title'>{item.folder}</span>
								</div>
								<div className='plan-card-meta error-text'>
									{item.parse_error ?? 'nevalidní proposal'}
								</div>
							</div>
						);
					}
					const proposal = item.proposal;
					const plan = proposal.dev_code ? planByDevCode.get(proposal.dev_code) : undefined;
					return (
						<div key={proposal.id} className='plan-card'>
							<div className='plan-card-row'>
								<span className='plan-card-code'>{proposal.id}</span>
								<span className='plan-card-title'>{proposal.title}</span>
							</div>
							<p style={{ margin: '6px 0' }}>{proposal.summary}</p>
							<div className='plan-card-meta'>
								<span className={`status-badge ${STATUS_BADGE[proposal.status] ?? 'shaping'}`}>
									{proposal.status}
								</span>
								<span>owner {proposal.owner}</span>
								<span>·</span>
								<span>updated {proposal.updated_at}</span>
							</div>
							<div className='plan-card-meta'>
								{item.wireframe_href && (
									<a href={item.wireframe_href} target='_blank' rel='noreferrer'>
										Otevřít wireframe
									</a>
								)}
								{item.design_notes_href && (
									<a href={item.design_notes_href} target='_blank' rel='noreferrer'>
										Poznámky
									</a>
								)}
								{proposal.dev_code && (
									<button
										type='button'
										className='button'
										onClick={() => onOpenPlan(proposal.dev_code as string)}
									>
										Plán {proposal.dev_code}
										{plan ? ` · ${plan.title}` : ''}
									</button>
								)}
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}

export function LinkedProposalsPanel({ devCode }: { devCode: string }) {
	const state = useProposals();
	if (state.kind !== 'ready') return null;
	const linked = state.data.proposals.filter(
		(item) => item.proposal && item.proposal.dev_code === devCode,
	);
	if (linked.length === 0) return null;
	return (
		<div className='panel-section'>
			<h3>Design proposaly</h3>
			<ul>
				{linked.map((item) => {
					const proposal = item.proposal;
					if (!proposal) return null;
					return (
						<li key={proposal.id}>
							<span className={`status-badge ${STATUS_BADGE[proposal.status] ?? 'shaping'}`}>
								{proposal.status}
							</span>{' '}
							{proposal.title}{' '}
							{item.wireframe_href && (
								<a href={item.wireframe_href} target='_blank' rel='noreferrer'>
									wireframe
								</a>
							)}
						</li>
					);
				})}
			</ul>
		</div>
	);
}
