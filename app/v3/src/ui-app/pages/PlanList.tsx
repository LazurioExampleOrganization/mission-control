import type { PlanRecord } from '../../model.ts';

export function PlanList({
	records,
	onSelect,
}: {
	records: PlanRecord[];
	onSelect: (devCode: string) => void;
}) {
	if (records.length === 0) {
		return <div className='panel'>V této kategorii nejsou žádné plány.</div>;
	}
	const sorted = [...records].sort((a, b) => {
		if (a.plan.priority_rank !== b.plan.priority_rank) {
			return a.plan.priority_rank - b.plan.priority_rank;
		}
		return a.plan.dev_code.localeCompare(b.plan.dev_code);
	});
	return (
		<div className='plan-grid'>
			{sorted.map((record) => {
				const plan = record.plan;
				return (
					<button
						type='button'
						key={plan.id}
						className='plan-card'
						onClick={() => onSelect(plan.dev_code)}
					>
						<div className='plan-card-row'>
							<span className='plan-card-code'>{plan.dev_code}</span>
							<span className='plan-card-title'>{plan.title}</span>
						</div>
						<div className='plan-card-meta'>
							<span className={`status-badge ${plan.status}`}>{plan.status}</span>
							<span className={`priority-badge ${plan.priority}`}>{plan.priority}</span>
							<span className='plan-card-rank'>rank {plan.priority_rank}</span>
							<span>·</span>
							<span>updated {plan.updated_at}</span>
							<span>·</span>
							<span>owner {plan.owner}</span>
						</div>
					</button>
				);
			})}
		</div>
	);
}
