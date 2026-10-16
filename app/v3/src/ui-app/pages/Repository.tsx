import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import {
	type RepositoryRuntimeState as ApiRepositoryRuntimeState,
	api,
	type RepositoryFreshness,
} from '../api.ts';
import { SummaryStat } from '../components/SummaryStat.tsx';
import { pullReasonLabel } from '../draft-status.ts';

export type RepositoryRuntimeState = ApiRepositoryRuntimeState;

const REFRESH_STATUS_POLL_MS = 1000;
const REFRESH_STATUS_TIMEOUT_MS = 25_000;

function delay(ms: number): Promise<void> {
	return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function shortSha(value: string): string {
	return value.length > 12 ? value.slice(0, 12) : value;
}

function statusTone(state: RepositoryRuntimeState | null): 'ok' | 'warning' | 'error' | undefined {
	if (!state) return undefined;
	if (
		!state.status.clean ||
		!state.status.remoteMatches ||
		!state.status.commitIdentityConfigured ||
		state.status.currentBranch !== state.status.expectedBranch
	)
		return 'error';
	if ((state.status.ahead ?? 0) > 0 || (state.status.behind ?? 0) > 0) return 'warning';
	return 'ok';
}

export function RepositoryPage({
	state,
	loading,
	error,
	onRefresh,
}: {
	state: RepositoryRuntimeState | null;
	loading: boolean;
	error: string | null;
	onRefresh: (next?: RepositoryRuntimeState) => Promise<void> | void;
}) {
	const summaryId = useId();
	const pathId = useId();
	const contentId = useId();
	const [summary, setSummary] = useState('Mission Control data update');
	const [path, setPath] = useState('data/mission-control/reports/ui-update.md');
	const [content, setContent] = useState('');
	const [busy, setBusy] = useState<string | null>(null);
	const [result, setResult] = useState<string | null>(null);
	const [isError, setIsError] = useState(false);
	const [freshness, setFreshness] = useState<RepositoryFreshness | null>(null);
	const mounted = useRef(true);

	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	const writerAvailable =
		state?.writer.writer_ready ?? state?.writer.local_principal_ready ?? false;
	const writerMessage =
		state?.writer.reason === 'github_remote_required'
			? 'Lokální writer potřebuje github.com remote datového repozitáře: buď SSH (git@github.com, přihlášení přes SSH agenta), nebo HTTPS (https://github.com, přihlášení přes Git Credential Manager). PAT v URL ani sdílený credential nejsou identita Principála.'
			: state?.writer.reason === 'local_writer_config_invalid'
				? 'Konfigurace lokálního writeru nesmí vytvářet paralelní credential_authority. O přístupu rozhodují pouze živá GitHub práva k datovému repozitáři.'
				: state?.writer.reason === 'github_app_https_remote_required'
					? 'Writer Team Workspace potřebuje credential-free HTTPS remote na github.com a předem nakonfigurovaný externí Git credential helper pro krátkodobé repo-scoped GitHub App tokeny.'
					: state?.writer.reason === 'github_app_writer_config_invalid'
						? 'Writer Team Workspace nesmí držet vlastní authority, role ani lokální roster. Přístup určuje GitHub a externí repo-scoped GitHub App helper.'
						: state?.writer.reason === 'commit_identity_required'
							? 'Mission Control writer potřebuje pravdivou Git identitu pro commity. Nastavte user.name a user.email pro aktivní writer profil.'
							: 'Tato Organizace ještě nepoužívá podporovaný nativní Git writer profil.';

	async function handleCheckFreshness() {
		setBusy('Zkontrolovat čerstvost');
		setResult(null);
		setIsError(false);
		try {
			let next = await api.repositoryFreshness(true);
			if (!mounted.current) return;
			setFreshness(next);
			const deadline = Date.now() + REFRESH_STATUS_TIMEOUT_MS;
			while (mounted.current && next.refreshing && Date.now() < deadline) {
				await delay(REFRESH_STATUS_POLL_MS);
				if (!mounted.current) return;
				next = await api.repositoryFreshness(false);
				if (!mounted.current) return;
				setFreshness(next);
			}
			if (!mounted.current) return;
			setIsError(next.staleFreshness);
			setResult(
				next.refreshing
					? 'Kontrola GitHubu pokračuje na pozadí. Poslední známý stav zůstává zobrazený.'
					: next.newerAvailable
						? `Novější data k dispozici: ${next.behind} commitů napřed. ${next.pullSafe ? 'Pull je bezpečný.' : pullReasonLabel(next.pullBlockedReason)}`
						: next.staleFreshness
							? pullReasonLabel(next.pullBlockedReason ?? 'fetch_failed')
							: 'Data jsou aktuální.',
			);
		} catch (err) {
			if (!mounted.current) return;
			setIsError(true);
			setResult(err instanceof Error ? err.message : String(err));
		} finally {
			if (mounted.current) setBusy(null);
		}
	}

	async function handlePull() {
		setBusy('Stáhnout novější data');
		setResult(null);
		setIsError(false);
		try {
			const pulled = await api.repositoryPull();
			await onRefresh(pulled.state);
			const next = await api.repositoryFreshness(false);
			setFreshness(next);
			setResult(
				pulled.pulled
					? `Staženo: ${shortSha(pulled.fromHead)} → ${shortSha(pulled.toHead)}`
					: 'Data jsou aktuální, nebylo co stahovat.',
			);
		} catch (err) {
			// Fail-closed pull (dirty/divergence) vrací 409 s vysvětlením.
			setIsError(true);
			setResult(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(null);
		}
	}

	async function runAction(label: string, action: () => Promise<RepositoryRuntimeState | null>) {
		setBusy(label);
		setResult(null);
		setIsError(false);
		try {
			const next = await action();
			if (next) await onRefresh(next);
			else await onRefresh();
			setResult(`${label}: OK`);
			return true;
		} catch (err) {
			setIsError(true);
			setResult(err instanceof Error ? err.message : String(err));
			return false;
		} finally {
			setBusy(null);
		}
	}

	async function handleCreate(event: FormEvent) {
		event.preventDefault();
		await runAction('Připravit draft', async () => {
			const response = await api.createRepositoryChangeset({
				changeset: {
					summary,
					operations: [{ action: 'write_file', path, content }],
				},
			});
			return response.state;
		});
	}

	async function handlePublish(id: string, draftRevision: string) {
		if (
			!window.confirm(
				`Publikovat přesně zobrazený draft ${id}?\n\nRevize: ${draftRevision}\n\nVznikne jeden validovaný commit a běžný fast-forward push na v3. GitHub jej přijme nebo odmítne podle aktuálních práv přihlášeného Buildera.`,
			)
		)
			return;
		await runAction('Publikovat změny', async () => {
			const response = await api.publishRepositoryChangeset(id, {
				draft_revision: draftRevision,
			});
			return response.state;
		});
	}

	async function handleDiscard(id: string) {
		if (
			!window.confirm(
				`Zahodit lokální draft ${id}?\n\nGit historie ani data repozitáře se nezmění.`,
			)
		)
			return;
		await runAction('Zahodit draft', async () => {
			const response = await api.discardRepositoryChangeset(id);
			return response.state;
		});
	}

	const pending = state?.changesets.pending ?? [];
	const drafts = state?.drafts ?? [];
	const published = state?.changesets.published ?? [];
	const superseded = state?.changesets.superseded ?? [];

	return (
		<div className='repository-publish'>
			<section className='panel'>
				<div className='panel-header'>
					<div>
						<h2>Repository publish</h2>
						<p className='muted'>
							Lokální draft zůstává mimo Git. Publikace vytvoří jeden validovaný commit a push pod
							GitHub identitou právě přihlášeného Principála (SSH agent, nebo Git Credential Manager
							u HTTPS).
						</p>
					</div>
					<button
						type='button'
						className='button'
						onClick={() => onRefresh()}
						disabled={loading || busy !== null}
					>
						{loading ? 'Načítám…' : 'Refresh status'}
					</button>
				</div>
				{error ? <p className='error-text'>Repository status není dostupný: {error}</p> : null}
				{!writerAvailable ? <p className='error-text'>{writerMessage}</p> : null}
				<div className='summary-grid'>
					<SummaryStat
						label='Data repo'
						value={state?.status.clean ? 'clean' : 'dirty'}
						tone={statusTone(state)}
					/>
					<SummaryStat
						label='Branch'
						value={state ? `${state.status.currentBranch} / ${state.status.expectedBranch}` : '–'}
						tone={state?.status.currentBranch === state?.status.expectedBranch ? 'ok' : 'error'}
					/>
					<SummaryStat
						label='Remote'
						value={state?.status.remoteMatches ? 'matches' : 'mismatch'}
						tone={state?.status.remoteMatches ? 'ok' : 'error'}
					/>
					<SummaryStat
						label='Commit identity'
						value={state?.status.commitIdentityConfigured ? 'configured' : 'missing'}
						tone={state?.status.commitIdentityConfigured ? 'ok' : 'error'}
					/>
					<SummaryStat
						label='Lokální drafty'
						value={drafts.length}
						tone={drafts.length > 0 ? 'warning' : 'ok'}
					/>
				</div>
				{state ? (
					<div className='panel-section'>
						<h3>Current head</h3>
						<p>
							<code>{shortSha(state.status.head)}</code> · ahead={state.status.ahead ?? 'n/a'}{' '}
							behind={state.status.behind ?? 'n/a'}
						</p>
						<p>
							<code>{state.status.repositoryDbRoot}</code>
						</p>
						{state.status.dirty.length > 0 ? (
							<pre className='api-output error'>{state.status.dirty.join('\n')}</pre>
						) : null}
					</div>
				) : null}
			</section>

			<section className='panel'>
				<div className='panel-header'>
					<div>
						<h2>Aktualizace dat</h2>
						<p className='muted'>
							Novější změny se před stažením ověří automaticky. Pokud máte rozpracované změny nebo
							konflikt, nejdřív je vyřešte; aktualizace je nepřepíše.
						</p>
					</div>
					<div className='work-item-actions'>
						<button
							type='button'
							className='button'
							onClick={handleCheckFreshness}
							disabled={busy !== null}
						>
							Zkontrolovat čerstvost
						</button>
						<button
							type='button'
							className='button primary'
							onClick={handlePull}
							disabled={
								busy !== null ||
								!(freshness?.newerAvailable ?? false) ||
								!(freshness?.pullSafe ?? false)
							}
							title={
								freshness && !freshness.pullSafe
									? pullReasonLabel(freshness.pullBlockedReason)
									: 'Bezpečně stáhnout (fast-forward)'
							}
						>
							Stáhnout novější data
						</button>
					</div>
				</div>
				{freshness ? (
					<div className='summary-grid'>
						<SummaryStat
							label='Novější data'
							value={freshness.newerAvailable ? `ano (${freshness.behind})` : 'ne'}
							tone={freshness.newerAvailable ? 'warning' : 'ok'}
						/>
						<SummaryStat
							label='Pull bezpečný'
							value={freshness.pullSafe ? 'ano' : 'ne'}
							tone={freshness.pullSafe ? 'ok' : freshness.newerAvailable ? 'error' : undefined}
						/>
						<SummaryStat
							label='Behind / ahead'
							value={`${freshness.behind} / ${freshness.ahead}`}
							tone={freshness.diverged ? 'error' : undefined}
						/>
						<SummaryStat
							label='Fetch'
							value={
								freshness.refreshing
									? 'probíhá'
									: freshness.refreshState === 'idle'
										? 'čeká'
										: freshness.fetch.ok
											? 'ok'
											: freshness.fetch.timedOut || freshness.refreshError?.timedOut
												? 'timeout'
												: 'chyba'
							}
							tone={
								freshness.refreshing || freshness.refreshState === 'idle'
									? undefined
									: freshness.fetch.ok
										? 'ok'
										: 'warning'
							}
						/>
					</div>
				) : (
					<p className='muted'>Klikni na „Zkontrolovat čerstvost" pro poslední stav remote dat.</p>
				)}
				{freshness && !freshness.pullSafe && freshness.newerAvailable ? (
					<p className='error-text'>{pullReasonLabel(freshness.pullBlockedReason)}</p>
				) : null}
			</section>

			<section className='panel'>
				<div className='panel-header'>
					<div>
						<h2>Připravit lokální draft</h2>
						<p className='muted'>
							Draft se uloží pod Git metadata. Před publikací uvidíte přesné cesty, obsah a revizi,
							kterou potvrzujete.
						</p>
					</div>
				</div>
				<form className='form-grid' onSubmit={handleCreate}>
					<div className='field'>
						<label htmlFor={summaryId}>Summary</label>
						<input
							id={summaryId}
							value={summary}
							onChange={(event) => setSummary(event.currentTarget.value)}
							disabled={!writerAvailable}
						/>
					</div>
					<div className='field full'>
						<label htmlFor={pathId}>Repository-db path</label>
						<input
							id={pathId}
							value={path}
							onChange={(event) => setPath(event.currentTarget.value)}
							disabled={!writerAvailable}
						/>
					</div>
					<div className='field full'>
						<label htmlFor={contentId}>Content</label>
						<textarea
							id={contentId}
							value={content}
							onChange={(event) => setContent(event.currentTarget.value)}
							disabled={!writerAvailable}
						/>
					</div>
					<button
						type='submit'
						className='button primary'
						disabled={!writerAvailable || busy !== null}
						title={!writerAvailable ? writerMessage : undefined}
					>
						Připravit draft
					</button>
				</form>
			</section>

			<section className='panel'>
				<h2>Lokální drafty k publikaci</h2>
				{drafts.length === 0 ? <p className='muted'>Žádné lokální drafty.</p> : null}
				<div className='work-item-list'>
					{drafts.map((draft) => (
						<article className='work-item-card' key={draft.id}>
							<div className='work-item-body'>
								<div className='work-item-title-row'>
									<strong>{draft.summary}</strong>
									<span className='priority-badge'>draft</span>
								</div>
								<p className='muted'>
									Base <code>{shortSha(draft.base_commit)}</code> · revize{' '}
									<code>{draft.draft_revision}</code>
								</p>
								{draft.invalid ? (
									<p className='error-text'>
										Draft nelze bezpečně načíst: {draft.error ?? 'neplatný lokální formát'}. Lze jej
										pouze zahodit a připravit znovu.
									</p>
								) : null}
								<pre className='api-output'>
									{draft.operations
										.map(
											(operation) =>
												`${String(operation.path ?? '')}\n${String(operation.content ?? '')}`,
										)
										.join('\n---\n')}
								</pre>
								<div className='work-item-actions'>
									<button
										type='button'
										className='button'
										onClick={() => handleDiscard(draft.id)}
										disabled={busy !== null}
									>
										Zahodit draft
									</button>
									<button
										type='button'
										className='button primary'
										onClick={() => handlePublish(draft.id, draft.draft_revision)}
										disabled={!writerAvailable || busy !== null || draft.invalid === true}
										title={!writerAvailable ? writerMessage : undefined}
									>
										Publikovat změny
									</button>
								</div>
							</div>
						</article>
					))}
				</div>
			</section>

			{pending.length > 0 ? (
				<section className='panel'>
					<h2>Historické changesety</h2>
					<p className='muted'>
						Starší pending auditní záznamy zůstávají čitelné, ale aktivní Git workflow je nemění.
					</p>
					<div className='contract-stack'>
						{pending.map((entry) => (
							<code key={entry.id}>{entry.id}</code>
						))}
					</div>
				</section>
			) : null}

			<section className='panel'>
				<h2>Published changesets</h2>
				{published.length === 0 ? <p className='muted'>Zatím žádné published changesety.</p> : null}
				<div className='contract-stack'>
					{published.slice(-10).map((entry) => (
						<code key={entry.id}>{entry.id}</code>
					))}
				</div>
			</section>

			<section className='panel'>
				<h2>Nahrazené changesety</h2>
				{superseded.length === 0 ? (
					<p className='muted'>Zatím žádné nahrazené changesety.</p>
				) : null}
				<div className='contract-stack'>
					{superseded.slice(-10).map((entry) => (
						<article className='work-item-card' key={entry.id}>
							<div className='work-item-body'>
								<div className='work-item-title-row'>
									<code>{entry.id}</code>
									<span className='priority-badge'>superseded</span>
								</div>
								<p>{entry.supersession_reason ?? 'Důvod nebyl zaznamenán.'}</p>
								<p className='muted'>
									{entry.superseded_by ?? 'unknown'} · {entry.supersession_role ?? 'unknown'} ·{' '}
									{entry.superseded_at ?? 'unknown time'}
								</p>
								<p className='muted'>
									Náhrada: <code>{entry.replacement_changeset_id ?? 'bez náhrady'}</code>
								</p>
							</div>
						</article>
					))}
				</div>
			</section>

			{result !== null ? (
				<pre className={`api-output${isError ? ' error' : ''}`}>{result}</pre>
			) : null}
		</div>
	);
}
