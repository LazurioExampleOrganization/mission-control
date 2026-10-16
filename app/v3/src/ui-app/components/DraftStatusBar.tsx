// Globální draft/freshness indikátor viditelný na každé stránce.
//
// Ukazuje stav draftu data repa (dirty working tree / pending changeset /
// konflikt) a čerstvost (novější data k dispozici). Bez draftu a bez
// novějších dat je tichý — nic neruší. Popup vede na přesný review draftu
// v Repository stránce a nabízí bezpečný pull (fail-closed na draftu nebo
// dirty stavu). Samotnou Publikaci nikdy nespouští bez zobrazení obsahu.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RepositoryFreshness, RepositoryRuntimeState } from '../api.ts';
import { api } from '../api.ts';
import { type DraftIndicatorTone, deriveDraftIndicator, pullReasonLabel } from '../draft-status.ts';

// Interval pollování čerstvosti remote dat. Bounded na serveru (timeout +
// neinteraktivní git env); tady jen tikáme. 45 s je kompromis mezi „hned to
// uvidím" a „nezahltím git fetch".
const FRESHNESS_POLL_MS = 45000;
const REFRESH_STATUS_POLL_MS = 1000;

const TONE_LABEL: Record<DraftIndicatorTone, string> = {
	clean: 'Publikováno',
	draft: 'Draft',
	pending: 'K publikaci',
	newer: 'Novější data',
	conflict: 'Konflikt',
};

export function DraftStatusBar({
	onOpenRepository,
	pollIntervalMs = FRESHNESS_POLL_MS,
}: {
	onOpenRepository: () => void;
	pollIntervalMs?: number;
}) {
	const [state, setState] = useState<RepositoryRuntimeState | null>(null);
	const [freshness, setFreshness] = useState<RepositoryFreshness | null>(null);
	const [open, setOpen] = useState(false);
	const [busy, setBusy] = useState<string | null>(null);
	const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
	const [available, setAvailable] = useState(true);
	const mounted = useRef(true);
	const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			if (refreshTimer.current) clearTimeout(refreshTimer.current);
		};
	}, []);

	const refresh = useCallback(async (fetchRemote: boolean) => {
		try {
			const [nextState, nextFreshness] = await Promise.all([
				api.repositoryStatus(),
				api.repositoryFreshness(fetchRemote),
			]);
			if (!mounted.current) return;
			setState(nextState);
			setFreshness(nextFreshness);
			setAvailable(true);
			if (refreshTimer.current) clearTimeout(refreshTimer.current);
			refreshTimer.current = nextFreshness.refreshing
				? setTimeout(() => void refresh(false), REFRESH_STATUS_POLL_MS)
				: null;
		} catch {
			// Repository-db nemusí být namountované (např. čistý template běh).
			// V tom případě je indikátor tiše skrytý, ne chybová hláška.
			if (!mounted.current) return;
			if (refreshTimer.current) clearTimeout(refreshTimer.current);
			refreshTimer.current = null;
			setAvailable(false);
		}
	}, []);

	useEffect(() => {
		void refresh(true);
		const timer = setInterval(() => void refresh(true), pollIntervalMs);
		return () => clearInterval(timer);
	}, [refresh, pollIntervalMs]);

	const indicator = deriveDraftIndicator(state, freshness);

	const writerConfigured =
		state?.writer.writer_ready ?? state?.writer.local_principal_ready ?? false;

	const handleOpenReview = useCallback(() => {
		setOpen(false);
		onOpenRepository();
	}, [onOpenRepository]);

	const handlePull = useCallback(async () => {
		setBusy('pull');
		setMessage(null);
		try {
			const result = await api.repositoryPull();
			if (!mounted.current) return;
			setState(result.state);
			await refresh(false);
			setMessage({
				text: result.pulled
					? `Staženo: ${result.fromHead.slice(0, 8)} → ${result.toHead.slice(0, 8)}`
					: 'Data jsou aktuální, nebylo co stahovat.',
				error: false,
			});
		} catch (error) {
			// Fail-closed pull vrací 409 s vysvětlením — ukážeme ho jako info,
			// ne jako pád. jsonFetch hází Error s message z těla.
			if (!mounted.current) return;
			setMessage({ text: error instanceof Error ? error.message : String(error), error: true });
		} finally {
			if (mounted.current) setBusy(null);
		}
	}, [refresh]);

	// Tichý stav: repo nedostupné, nebo nic k publikaci a žádná novější data.
	if (!available || !indicator.visible) return null;

	return (
		<div className={`draft-status draft-status-${indicator.tone}`}>
			<button
				type='button'
				className='draft-status-badge'
				onClick={() => setOpen((value) => !value)}
				aria-expanded={open}
				aria-haspopup='dialog'
				title={indicator.detail}
			>
				<span className='draft-status-dot' aria-hidden='true' />
				<span className='draft-status-label'>
					{freshness?.refreshing ? 'Kontroluji' : TONE_LABEL[indicator.tone]}
				</span>
				{indicator.dirtyCount > 0 ? (
					<span className='draft-status-count'>{indicator.dirtyCount}</span>
				) : null}
			</button>

			{open ? (
				<div className='draft-status-popup' role='dialog' aria-label='Stav draftu dat'>
					<div className='draft-status-popup-header'>
						<strong>{indicator.label}</strong>
						<button
							type='button'
							className='draft-status-close'
							onClick={() => setOpen(false)}
							aria-label='Zavřít'
						>
							×
						</button>
					</div>
					<p className='draft-status-detail'>{indicator.detail}</p>

					<dl className='draft-status-facts'>
						<div>
							<dt>Nepublikované změny</dt>
							<dd>{indicator.dirtyCount}</dd>
						</div>
						<div>
							<dt>Lokální drafty</dt>
							<dd>{indicator.pendingCount}</dd>
						</div>
						<div>
							<dt>Novější data</dt>
							<dd>{indicator.newerAvailable ? `ano (${state?.status.behind ?? 0})` : 'ne'}</dd>
						</div>
					</dl>

					{message ? (
						<p className={`draft-status-message${message.error ? ' error' : ''}`}>{message.text}</p>
					) : null}
					{state && !writerConfigured ? (
						<p className='draft-status-message error'>
							Publish není aktivní: {state.writer.reason ?? 'writer není připravený'}. Read-only
							pull může zůstat dostupný.
						</p>
					) : null}

					<div className='draft-status-actions'>
						<button
							type='button'
							className='button primary'
							onClick={handleOpenReview}
							disabled={busy !== null || indicator.pendingCount === 0}
							title={
								indicator.pendingCount === 0
									? 'Žádný lokální draft ke kontrole.'
									: 'Otevřít přesný obsah a revizi draftu před Publikací'
							}
						>
							Zkontrolovat draft
						</button>
						<button
							type='button'
							className='button'
							onClick={handlePull}
							disabled={busy !== null || !indicator.newerAvailable || !indicator.pullSafe}
							title={
								indicator.pullSafe
									? 'Bezpečně stáhnout novější data (fast-forward)'
									: pullReasonLabel(indicator.pullBlockedReason)
							}
						>
							{busy === 'pull' ? 'Stahuji…' : 'Stáhnout novější data'}
						</button>
					</div>

					{!indicator.pullSafe && indicator.newerAvailable ? (
						<p className='draft-status-hint'>{pullReasonLabel(indicator.pullBlockedReason)}</p>
					) : null}
					{indicator.conflict ? (
						<p className='draft-status-hint error'>
							Publikovat i stahovat je zablokované, dokud konflikt nevyřešíte ručně.
						</p>
					) : null}
				</div>
			) : null}
		</div>
	);
}
