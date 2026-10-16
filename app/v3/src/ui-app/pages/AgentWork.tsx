import { useMemo, useState } from 'react';
import type {
	MissionAgentBlogEntry,
	MissionAgentLedgerInvalidFile,
	MissionAgentWorkLaneId,
	MissionAgentWorkLedgerItem,
	MissionTodoOutputMaterializationWarning,
} from '../../agent-work/contract.ts';
import type { AgentWorkResponse, WorkBoardResponse } from '../api.ts';
import { SummaryStat } from '../components/SummaryStat.tsx';

const LANE_LABELS: Record<MissionAgentWorkLaneId, string> = {
	decisions: 'Historie issues',
	'active-work': 'Aktivní práce',
	insights: 'Insights',
	health: 'Health',
};

export function AgentWorkPage({
	agentWork,
	agentWorkError,
	agentWorkLoading,
	board,
	workBoardError,
}: {
	agentWork: AgentWorkResponse['agentWork'] | null;
	agentWorkError?: string | null;
	agentWorkLoading?: boolean;
	board: WorkBoardResponse['board'] | null;
	workBoardError?: string | null;
}) {
	const [activeLane, setActiveLane] = useState<MissionAgentWorkLaneId>('decisions');

	if (!agentWork) {
		return (
			<div className={`panel${agentWorkError ? ' error-text' : ''}`}>
				{agentWorkError
					? `Agent work není dostupný: ${agentWorkError}`
					: agentWorkLoading
						? 'Načítám Agent work…'
						: 'Agent work není dostupný.'}
			</div>
		);
	}

	const activeLaneMeta =
		agentWork.cockpit.lanes.find((lane) => lane.id === activeLane) ?? agentWork.cockpit.lanes[0];
	const coverage = board?.planning_coverage;

	return (
		<div className='agent-work-shell'>
			{agentWorkError ? (
				<p className='panel error-text'>
					Poslední refresh agentního ledgeru selhal: {agentWorkError}
				</p>
			) : null}
			{workBoardError ? (
				<p className='panel error-text'>Poslední refresh Work boardu selhal: {workBoardError}</p>
			) : null}

			<section className='panel agent-work-hero'>
				<div className='agent-work-hero-copy'>
					<h2>Agent work cockpit</h2>
					<p>
						Mission Control drží plány a práci. Aktivní problémy patří do GitHub Issues; zde zůstává
						čitelná historie.
					</p>
					<div className='agent-work-meta'>
						<span>
							Scanned <code>{agentWork.scannedAt}</code>
						</span>
						<span>
							Workspace <code>{agentWork.workspace.rootName}</code>
						</span>
					</div>
				</div>
				<div className='agent-lane-grid' role='tablist' aria-label='Agent work lanes'>
					{agentWork.cockpit.lanes.map((lane) => (
						<button
							key={lane.id}
							type='button'
							role='tab'
							aria-selected={activeLane === lane.id}
							className={`agent-lane-card ${lane.tone}${activeLane === lane.id ? ' active' : ''}`}
							onClick={() => setActiveLane(lane.id)}
						>
							<span>{lane.label}</span>
							<strong>{lane.count}</strong>
							<small>{lane.summary}</small>
						</button>
					))}
				</div>
			</section>

			<div className='agent-work-layout'>
				<section className='panel agent-work-main'>
					<div className='panel-header'>
						<div>
							<h2>{activeLaneMeta ? LANE_LABELS[activeLaneMeta.id] : 'Agent work'}</h2>
							<p className='muted'>{activeLaneMeta?.summary}</p>
						</div>
						<strong className={`lane-count ${activeLaneMeta?.tone ?? 'neutral'}`}>
							{activeLaneMeta?.count ?? 0}
						</strong>
					</div>
					{activeLane === 'decisions' ? (
						<DecisionQueue items={agentWork.cockpit.decisions.items} />
					) : null}
					{activeLane === 'active-work' ? (
						<ActiveWorkQueue
							activeItems={agentWork.cockpit.activeWork.items}
							doneItems={agentWork.cockpit.recentDone.items}
						/>
					) : null}
					{activeLane === 'insights' ? (
						<InsightsQueue entries={agentWork.cockpit.insights.items} />
					) : null}
					{activeLane === 'health' ? (
						<HealthQueue
							invalidFiles={agentWork.cockpit.health.invalidFileDetails}
							todoOutputWarnings={agentWork.cockpit.health.todoOutputWarningDetails}
						/>
					) : null}
				</section>

				<aside className='panel agent-work-aside'>
					<h2>Coverage</h2>
					<div className='summary-grid compact'>
						<SummaryStat label='TODO s plánem' value={coverage?.todo_with_plan ?? '–'} tone='ok' />
						<SummaryStat
							label='TODO bez plánu'
							value={coverage?.todo_without_plan ?? '–'}
							tone={coverage && coverage.todo_without_plan > 0 ? 'warning' : undefined}
						/>
						<SummaryStat
							label='Rozbité vazby'
							value={coverage?.broken_plan_links.length ?? '–'}
							tone={coverage && coverage.broken_plan_links.length > 0 ? 'error' : undefined}
						/>
						<SummaryStat
							label='Ledger chyby'
							value={agentWork.cockpit.health.invalidFiles}
							tone={agentWork.cockpit.health.invalidFiles > 0 ? 'warning' : 'ok'}
						/>
						<SummaryStat
							label='todo_outputs'
							value={agentWork.cockpit.health.todoOutputWarnings}
							tone={agentWork.cockpit.health.todoOutputWarnings > 0 ? 'warning' : 'ok'}
						/>
					</div>

					<div className='panel-section'>
						<h3>Scope stav</h3>
						<div className='scope-state-list'>
							<ScopeState label='available' count={scopeStateCount(agentWork, 'available')} />
							<ScopeState
								label='missing_access'
								count={agentWork.cockpit.health.missingAccessScopes}
							/>
							<ScopeState label='planned_slot' count={agentWork.cockpit.health.plannedScopes} />
						</div>
					</div>

					<div className='panel-section'>
						<h3>Contract</h3>
						<div className='contract-stack'>
							<code>{agentWork.schemaVersion}</code>
							<code>{agentWork.ledgerSchemaVersion}</code>
						</div>
					</div>
				</aside>
			</div>
		</div>
	);
}

function scopeStateCount(
	agentWork: AgentWorkResponse['agentWork'],
	state: 'available' | 'missing_access' | 'planned_slot' | 'unknown',
): number {
	return agentWork.scopes.filter((scope) => scope.state === state).length;
}

function ScopeState({ label, count }: { label: string; count: number }) {
	return (
		<div className='scope-state-row'>
			<span>{label}</span>
			<strong>{count}</strong>
		</div>
	);
}

function DecisionQueue({ items }: { items: MissionAgentWorkLedgerItem[] }) {
	if (items.length === 0) {
		return <p className='muted'>Žádné historické issues k zobrazení.</p>;
	}
	return (
		<div className='work-item-list'>
			{items.map((item) => (
				<DecisionItemCard key={`${item.filePath}:${item.id}`} item={item} />
			))}
		</div>
	);
}

function DecisionItemCard({ item }: { item: MissionAgentWorkLedgerItem }) {
	const links = useItemLinks(item);

	return (
		<article className='work-item-card decision resolvable'>
			<div className='work-item-body'>
				<div className='work-item-title-row'>
					<strong>{item.title}</strong>
					<span className='priority-badge'>
						{item.severity ? `severity ${item.severity}` : 'decision'}
					</span>
				</div>
				{item.summary ? <p>{item.summary}</p> : null}
				<div className='work-item-meta'>
					<code>{item.id}</code>
					<code>{item.filePath}</code>
					<span className='priority-badge'>{item.status}</span>
					<span className='priority-badge admin'>Workspace Admin</span>
				</div>
				{links.length > 0 ? (
					<div className='work-item-links inline'>
						{links.map((link) =>
							link.url ? (
								<a
									key={`${item.id}:${link.label}:${link.url}`}
									href={link.url}
									target='_blank'
									rel='noreferrer'
								>
									{link.label}
								</a>
							) : link.path ? (
								<code key={`${item.id}:${link.label}:${link.path}`}>{link.path}</code>
							) : null,
						)}
					</div>
				) : null}
			</div>
			<p className='muted'>
				Historický záznam. Aktivní problém a rozhodnutí řeš v GitHub Issues owning repozitáře.
			</p>
		</article>
	);
}

function ActiveWorkQueue({
	activeItems,
	doneItems,
}: {
	activeItems: MissionAgentWorkLedgerItem[];
	doneItems: MissionAgentWorkLedgerItem[];
}) {
	return (
		<div className='queue-stack'>
			<div className='panel-section flush'>
				<h3>Otevřené TODO</h3>
				{activeItems.length === 0 ? (
					<p className='muted'>Žádné otevřené TODO k zobrazení.</p>
				) : (
					<div className='work-item-list'>
						{activeItems.map((item) => (
							<WorkItemCard key={`${item.filePath}:${item.id}`} item={item} accent='work' />
						))}
					</div>
				)}
			</div>
			<div className='panel-section'>
				<h3>Recent DONE</h3>
				{doneItems.length === 0 ? (
					<p className='muted'>Žádné DONE položky k zobrazení.</p>
				) : (
					<div className='work-item-list compact'>
						{doneItems.map((item) => (
							<WorkItemCard key={`${item.filePath}:${item.id}`} item={item} accent='done' />
						))}
					</div>
				)}
			</div>
		</div>
	);
}

function InsightsQueue({ entries }: { entries: MissionAgentBlogEntry[] }) {
	if (entries.length === 0) {
		return <p className='muted'>Žádné BLOG.agents.json entries k zobrazení.</p>;
	}
	return (
		<div className='work-item-list'>
			{entries.map((entry) => (
				<article key={`${entry.filePath}:${entry.id}`} className='work-item-card insight'>
					<div className='work-item-body'>
						<div className='work-item-title-row'>
							<strong>{entry.title}</strong>
							<span className='priority-badge'>{entry.contentPotential}</span>
						</div>
						<p>{entry.summary}</p>
						<div className='work-item-meta'>
							<code>{entry.filePath}</code>
							<span>{entry.insightType}</span>
							{entry.sourceCustomId ? <code>{entry.sourceCustomId}</code> : null}
						</div>
					</div>
				</article>
			))}
		</div>
	);
}

function HealthQueue({
	invalidFiles,
	todoOutputWarnings,
}: {
	invalidFiles: MissionAgentLedgerInvalidFile[];
	todoOutputWarnings: MissionTodoOutputMaterializationWarning[];
}) {
	if (invalidFiles.length === 0 && todoOutputWarnings.length === 0) {
		return <p className='muted'>Agent ledgery jsou validní pro aktuální scan.</p>;
	}
	return (
		<div className='work-item-list'>
			{invalidFiles.map((file) => (
				<article key={file.path} className='work-item-card health'>
					<div className='work-item-body'>
						<div className='work-item-title-row'>
							<strong>{file.path}</strong>
							<span className='priority-badge'>{file.kind}</span>
						</div>
						<ul className='error-list'>
							{file.errors.map((error) => (
								<li key={error}>{error}</li>
							))}
						</ul>
					</div>
				</article>
			))}
			{todoOutputWarnings.map((warning) => (
				<article
					key={`${warning.plan_id}:${warning.output_id}:${warning.code}`}
					className='work-item-card health'
				>
					<div className='work-item-body'>
						<div className='work-item-title-row'>
							<strong>
								{warning.dev_code} · {warning.output_id}
							</strong>
							<span className='priority-badge'>{warning.code}</span>
						</div>
						<p>{warning.message}</p>
						<div className='work-item-meta'>
							<code>{warning.plan_path}</code>
							{warning.planning_target ? <code>{warning.planning_target}</code> : null}
						</div>
					</div>
				</article>
			))}
		</div>
	);
}

function WorkItemCard({
	item,
	accent,
	eyebrow,
}: {
	item: MissionAgentWorkLedgerItem;
	accent: 'decision' | 'work' | 'done';
	eyebrow?: string;
}) {
	const links = useItemLinks(item);

	return (
		<article className={`work-item-card ${accent}`}>
			<div className='work-item-body'>
				<div className='work-item-title-row'>
					<strong>{item.title}</strong>
					{eyebrow ? <span className='priority-badge'>{eyebrow}</span> : null}
				</div>
				{item.summary ? <p>{item.summary}</p> : null}
				<div className='work-item-meta'>
					<code>{item.id}</code>
					<code>{item.filePath}</code>
					<span className='priority-badge'>{item.status}</span>
					{item.priority ? (
						<span className={`priority-badge ${item.priority}`}>{item.priority}</span>
					) : null}
				</div>
			</div>
			{links.length > 0 ? (
				<div className='work-item-links'>
					{links.map((link) =>
						link.url ? (
							<a
								key={`${item.id}:${link.label}:${link.url}`}
								href={link.url}
								target='_blank'
								rel='noreferrer'
							>
								{link.label}
							</a>
						) : link.path ? (
							<code key={`${item.id}:${link.label}:${link.path}`}>{link.path}</code>
						) : null,
					)}
				</div>
			) : null}
		</article>
	);
}

function useItemLinks(item: MissionAgentWorkLedgerItem) {
	return useMemo(() => [...item.links], [item.links]);
}
