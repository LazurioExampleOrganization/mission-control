// Odvození globálního draft/freshness indikátoru z repository-db stavu.
//
// Tenhle modul je čistá logika bez Reactu, aby šla přímo testovat: bere
// runtime state (status + lokální drafty) a volitelně freshness snapshot a
// vrací, co má popup ukázat. Žádná síť, žádné side-effecty.

import type { RepositoryFreshness, RepositoryRuntimeState } from './api.ts';

export type DraftIndicatorTone = 'clean' | 'draft' | 'pending' | 'newer' | 'conflict';

export type DraftIndicator = {
	// Když je false, indikátor je tichý (nic nepublikujeme, žádná novější data).
	visible: boolean;
	tone: DraftIndicatorTone;
	// Krátký titulek do badge (např. "Nepublikovaný draft").
	label: string;
	// Delší lidský popis do popupu.
	detail: string;
	// Kolik nepublikovaných změn pracovní strom drží (dirty count).
	dirtyCount: number;
	// Lokální drafty čekající na kontrolu a publikaci.
	pendingCount: number;
	// Jsou k dispozici novější remote data (behind > 0)?
	newerAvailable: boolean;
	// Je bezpečný pull dostupný právě teď?
	pullSafe: boolean;
	// Proč pull nejde (když nejde) — strojový důvod pro UI hlášku.
	pullBlockedReason: string | null;
	// Je repo v konfliktním stavu (divergence nebo špatná větev)?
	conflict: boolean;
};

const PULL_REASON_LABELS: Record<string, string> = {
	up_to_date: 'Data jsou aktuální.',
	fetch_failed:
		'Nepodařilo se ověřit remote (offline nebo chybí přístup) — čerstvost není potvrzená.',
	fetch_required:
		'Bez čerstvého izolovaného fetch nelze cached tracking ref použít jako autoritu pro pull.',
	fetch_verification_failed:
		'Fetched commit se nepodařilo svázat s ověřeným cílem pullu. Pull je zablokovaný.',
	fetch_control_plane_untrusted:
		'Lokální repository-db control-plane neodpovídá důvěryhodnému HEAD/indexu. Fetch ani pull se nespustí.',
	fetch_inbound_schema_incompatible:
		'Tato verze aplikace nerozumí novějším datům. Nejdřív aktualizujte Mission Control.',
	fetch_inbound_policy_incompatible:
		'Nová konfigurace není kompatibilní s touto aplikací. Data zůstala beze změny; předejte podrobnosti chyby autorovi aktualizace.',
	fetch_inbound_routing_changed:
		'Aktualizace mění adresu nebo větev datového repozitáře. Přesun je potřeba nastavit samostatně.',
	fetch_inbound_git_behavior_unsupported:
		'Aktualizace obsahuje nepodporované pokyny pro práci se soubory. Data zůstala beze změny; autor aktualizace musí tyto pokyny odstranit.',

	fetch_inbound_history_untrusted:
		'Remote historie nenavazuje na důvěryhodný lokální základ; je nutný ruční audit a nové ukotvení.',
	fetch_inbound_case_collision:
		'Remote obsahuje cesty, které se liší jen velikostí písmen nebo aliasují control-plane soubor. Pull je zablokovaný.',
	fetch_inbound_unsafe_tree_entry:
		'Remote obsahuje symlink, gitlink, neportabilní cestu nebo executable doménová data. Pull je zablokovaný.',
	fetch_inbound_validation_failed:
		'Nová data neprošla kontrolou. Místní data zůstala beze změny; předejte podrobnosti chyby autorovi aktualizace.',
	remote_not_configured: 'Data repo nemá v repository-db.yaml nastavený konkrétní fetch remote.',
	fetch_remote_mismatch:
		'Fetch remote nebo lokální Git routing neodpovídá repository-db.yaml. Pull je bezpečnostně zablokovaný.',
	branch_invalid: 'repository-db.yaml obsahuje neplatný nebo nebezpečný Git branch.',
	no_remote_ref: 'Vzdálená větev zatím neexistuje.',
	dirty_working_tree: 'Máte nepublikovaný draft — nejdřív Publikovat, pak stáhnout.',
	local_draft_present:
		'Máte připravený lokální draft — nejdřív jej publikujte nebo odstraňte, pak stáhněte novější data.',
	diverged: 'Lokální a vzdálené změny se rozešly, je potřeba ruční sloučení.',
	wrong_branch: 'Data repo není na očekávané větvi.',
	fast_forward_failed: 'Rychlé sloučení selhalo, working tree zůstal beze změny.',
	refresh_in_progress: 'Probíhá bezpečná kontrola novějších dat na GitHubu.',
	refresh_worker_timeout: 'Kontrola novějších dat překročila bezpečný časový limit.',
	refresh_worker_failed: 'Kontrolu novějších dat se nepodařilo dokončit.',
	refresh_worker_start_failed: 'Kontrolu novějších dat se nepodařilo spustit.',
	refresh_worker_invalid_response: 'Kontrola novějších dat vrátila neplatnou odpověď.',
	refresh_worker_invalid_result: 'Kontrola novějších dat vrátila neplatný výsledek.',
};

export function pullReasonLabel(reason: string | null): string {
	if (!reason) return '';
	return PULL_REASON_LABELS[reason] ?? reason;
}

function isConflict(
	status: RepositoryRuntimeState['status'],
	freshness: RepositoryFreshness | null,
): boolean {
	if (status.currentBranch !== status.expectedBranch) return true;
	if (freshness?.diverged) return true;
	// Bez freshness snapshotu odvodíme divergenci ze status ahead/behind.
	const ahead = status.ahead ?? 0;
	const behind = status.behind ?? 0;
	return status.remoteRefExists && ahead > 0 && behind > 0;
}

export function deriveDraftIndicator(
	state: RepositoryRuntimeState | null,
	freshness: RepositoryFreshness | null,
): DraftIndicator {
	const empty: DraftIndicator = {
		visible: false,
		tone: 'clean',
		label: 'Data jsou publikovaná',
		detail: 'Žádný nepublikovaný draft, žádné novější změny ke stažení.',
		dirtyCount: 0,
		pendingCount: 0,
		newerAvailable: false,
		pullSafe: false,
		pullBlockedReason: null,
		conflict: false,
	};
	if (!state) return empty;

	const status = state.status;
	const dirtyCount = status.dirty.length;
	const pendingCount = state.drafts.length;
	const newerAvailable =
		freshness?.newerAvailable ?? ((status.remoteRefExists && (status.behind ?? 0) > 0) || false);
	const pullSafe = freshness?.pullSafe ?? false;
	const pullBlockedReason = freshness?.pullBlockedReason ?? null;
	const conflict = isConflict(status, freshness);
	const refreshing = freshness?.refreshing ?? false;

	if (conflict) {
		const detail =
			status.currentBranch !== status.expectedBranch
				? `Data repo je na větvi ${status.currentBranch}, očekává se ${status.expectedBranch}. Vyřešte ručně, než budete publikovat nebo stahovat.`
				: `Lokální a vzdálené změny se rozešly (napřed=${status.ahead ?? '?'} pozadu=${status.behind ?? '?'}). Je potřeba ruční sloučení.`;
		return {
			...empty,
			visible: true,
			tone: 'conflict',
			label: 'Konflikt dat',
			detail,
			dirtyCount,
			pendingCount,
			newerAvailable,
			pullSafe,
			pullBlockedReason,
			conflict: true,
		};
	}

	if (dirtyCount > 0) {
		return {
			...empty,
			visible: true,
			tone: 'draft',
			label: 'Nepublikovaný draft',
			detail: `Pracovní kopie dat má ${dirtyCount} ${dirtyCount === 1 ? 'změnu' : 'změn'}, které ještě nejsou publikované. Publikujte je, aby je viděli ostatní kolegové.`,
			dirtyCount,
			pendingCount,
			newerAvailable,
			pullSafe: false,
			pullBlockedReason,
		};
	}

	if (pendingCount > 0) {
		return {
			...empty,
			visible: true,
			tone: 'pending',
			label: 'Změny čekají na publikaci',
			detail: `${pendingCount} ${pendingCount === 1 ? 'lokální draft čeká' : 'lokální drafty čekají'} na kontrolu a publikaci.`,
			dirtyCount,
			pendingCount,
			newerAvailable,
			pullSafe: false,
			pullBlockedReason,
		};
	}

	if (newerAvailable) {
		const detail = refreshing
			? `Poslední známý stav ukazuje novější data (${status.behind ?? '?'} ${(status.behind ?? 0) === 1 ? 'commit' : 'commitů'} napřed). Právě probíhá nové ověření na GitHubu.`
			: pullSafe
				? `Kolega publikoval novější verzi dat (${status.behind ?? '?'} ${(status.behind ?? 0) === 1 ? 'commit' : 'commitů'} napřed). Můžete je bezpečně stáhnout.`
				: `Cache ukazuje novější verzi dat (${status.behind ?? '?'} ${(status.behind ?? 0) === 1 ? 'commit' : 'commitů'} napřed), ale pull teď není bezpečný. ${pullReasonLabel(pullBlockedReason)}`;
		return {
			...empty,
			visible: true,
			tone: 'newer',
			label: 'Novější data k dispozici',
			detail,
			dirtyCount,
			pendingCount,
			newerAvailable: true,
			pullSafe,
			pullBlockedReason,
		};
	}

	if (refreshing) {
		return {
			...empty,
			visible: true,
			label: 'Kontroluji novější data',
			detail: 'Poslední známý stav zůstává dostupný. Bezpečná kontrola GitHubu běží na pozadí.',
			dirtyCount,
			pendingCount,
			newerAvailable: false,
			pullSafe: false,
			pullBlockedReason,
		};
	}

	return empty;
}
