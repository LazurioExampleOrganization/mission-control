// Pull / freshness koordinace pro Mission Control v3 data repo.
//
// Dva a více AI Kolegů může editovat stejné data repo přes vlastní běžící
// instance. Tenhle modul dává instanci bezpečný způsob, jak zjistit, že
// remote (origin/<branch>) dostal nový commit, a bezpečně ho stáhnout —
// aniž by kdy přepsal lokální rozpracovaný draft.
//
// Zásadní pravidla (decision 0035 + writer contract):
//   - žádný auto-pull: pull spouští jen explicitní akce,
//   - fail-closed na dirty working tree nebo divergenci: pull odmítne
//     a vysvětlí proč, nikdy netichý `reset --hard`,
//   - pull je jen fast-forward: pokud lokální HEAD není předkem
//     origin/<branch>, jde o konflikt a pull odmítne,
//   - fetch/pull běží bounded: timeout + neinteraktivní git prostředí
//     (žádný credential prompt, který by request zablokoval).

import {
  fetchMissionControlRepositoryRemote,
  getMissionControlRepositoryStatus,
  listMissionControlLocalDrafts,
  runMissionControlGitCommand,
  withMissionControlRepositoryWriteLock,
} from "./mission-control-publish-flow.mjs";

// Bounded: žádná git operace nesmí viset déle než tenhle limit. Chrání
// server thread proti zaseknutému network fetch nebo credential promptu.
const DEFAULT_GIT_TIMEOUT_MS = 15000;

function repositoryFetchBoundary(status) {
  if (!status.controlPlaneTrusted) {
    return {
      ok: false,
      reason: "fetch_control_plane_untrusted",
      message:
        "Lokální repository-db control-plane neodpovídá důvěryhodnému HEAD/indexu. Před fetch/pull obnovte repository-db.yaml a mission-control.config.json.",
    };
  }
  if (!status.branchConfigured) {
    return {
      ok: false,
      reason: "branch_invalid",
      message: `repository-db.yaml data_repo.branch není bezpečný Git branch: ${status.expectedBranch}. Pull odmítnut.`,
    };
  }
  if (!status.remoteConfigured) {
    return {
      ok: false,
      reason: "remote_not_configured",
      message:
        "repository-db.yaml data_repo.remote musí být před kontrolou čerstvosti a pull konkrétně nastavený.",
    };
  }
  if (!status.fetchRemoteMatches) {
    return {
      ok: false,
      reason: "fetch_remote_mismatch",
      message:
        `Fetch remote data repozitáře neodpovídá repository-db.yaml bez lokálních routing/command override: ` +
        `expected=${status.expectedRemoteUrl}, fetch=${status.remoteUrls.join(",") || "<missing>"}, ` +
        `overrides=${status.localGitFetchRoutingOverrides.join(",") || "<none>"}. Pull odmítnut.`,
    };
  }
  return { ok: true, reason: null, message: null };
}

// Bounded fetch: stáhne jen očekávanou branch z origin. Vrací, jestli
// fetch prošel; při chybě (offline, chybí credential, timeout) se pull
// nesmí pokusit o nic destruktivního — jen ohlásí, že čerstvost neznáme.
export function fetchMissionControlRemote({ repositoryDbRoot, timeoutMs = DEFAULT_GIT_TIMEOUT_MS } = {}) {
  const fetched = fetchMissionControlRepositoryRemote({
    repositoryDbRoot,
    timeoutMs,
  });
  const publicReason =
    typeof fetched.reason === "string" &&
    (fetched.reason.startsWith("fetch_inbound_") ||
      fetched.reason === "fetch_control_plane_untrusted")
      ? fetched.reason
      : fetched.status === 0
        ? null
        : "fetch_failed";
  return {
    ok: fetched.status === 0,
    branch: fetched.branch,
    verifiedHead: fetched.status === 0 ? fetched.stdout : null,
    timedOut: fetched.timedOut === true,
    reason: publicReason,
    error: fetched.status === 0 ? null : fetched.stderr || fetched.stdout || "git fetch failed",
  };
}

function relationToVerifiedHead(repositoryDbRoot, verifiedHead, timeoutMs) {
  if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(verifiedHead ?? "")) {
    return null;
  }
  const relation = runMissionControlGitCommand(
    repositoryDbRoot,
    ["rev-list", "--left-right", "--count", `HEAD...${verifiedHead}`],
    { timeoutMs },
  );
  if (relation.status !== 0) return null;
  const [ahead, behind] = relation.stdout
    .split(/\s+/)
    .map((value) => Number.parseInt(value, 10));
  return Number.isInteger(ahead) && Number.isInteger(behind)
    ? { ahead, behind }
    : null;
}

// Freshness snapshot: bounded fetch + čerstvý status. UI z něj čte, jestli
// jsou k dispozici novější data (behind > 0) a jestli je pull bezpečný.
export function getMissionControlFreshness({ repositoryDbRoot, fetch = true, timeoutMs = DEFAULT_GIT_TIMEOUT_MS } = {}) {
  const localDrafts = listMissionControlLocalDrafts({ repositoryDbRoot });
  let fetchResult = {
    ok: false,
    branch: null,
    verifiedHead: null,
    timedOut: false,
    reason: null,
    error: null,
  };
  if (fetch) {
    fetchResult = fetchMissionControlRemote({ repositoryDbRoot, timeoutMs });
  }
  // status s fetch:false — čerstvý fetch jsme (případně) udělali sami výše,
  // ať ho neděláme dvakrát a ať divergenci počítáme proti tomu, co víme.
  const status = getMissionControlRepositoryStatus({ repositoryDbRoot, fetch: false });
  const repositoryBoundary = repositoryFetchBoundary(status);
  const verifiedRelation =
    fetchResult.ok && fetchResult.verifiedHead
      ? relationToVerifiedHead(
          status.repositoryDbRoot,
          fetchResult.verifiedHead,
          timeoutMs,
        )
      : null;
  if (fetchResult.ok && verifiedRelation === null) {
    fetchResult = {
      ...fetchResult,
      ok: false,
      reason: "fetch_verification_failed",
      error:
        "Ověřený fetched commit nelze bezpečně porovnat s lokálním HEAD.",
    };
  }
  const behind = verifiedRelation?.behind ?? status.behind ?? 0;
  const ahead = verifiedRelation?.ahead ?? status.ahead ?? 0;
  const behindRemote =
    verifiedRelation !== null
      ? behind > 0
      : status.remoteRefExists && behind > 0;
  // Diverged = máme lokální commity, které remote nemá, a zároveň remote
  // má commity, které nemáme → fast-forward pull nejde, je to konflikt.
  const diverged = status.remoteRefExists && behind > 0 && ahead > 0;
  // Stale freshness = chtěli jsme fetch, ale nedoběhl (offline, chybí
  // credential, timeout nebo inbound trust gate). ahead/behind se pak počítá
  // proti STARÉMU origin/<branch> refu. Takový snapshot nikdy nesmí nabízet
  // pull jako bezpečný, ani když cache ukazuje novější commit.
  const staleFreshness = fetch === true && fetchResult.ok !== true;
  const pullSafe =
    repositoryBoundary.ok &&
    fetch === true &&
    verifiedRelation !== null &&
    !staleFreshness &&
    status.currentBranch === status.expectedBranch &&
    status.clean &&
    localDrafts.length === 0 &&
    behindRemote &&
    !diverged;
  let pullBlockedReason = null;
  if (!repositoryBoundary.ok) {
    pullBlockedReason = repositoryBoundary.reason;
  } else if (fetch !== true) {
    pullBlockedReason = "fetch_required";
  } else if (staleFreshness) {
    pullBlockedReason = fetchResult.reason ?? "fetch_failed";
  } else if (status.currentBranch !== status.expectedBranch) {
    pullBlockedReason = "wrong_branch";
  } else if (localDrafts.length > 0) {
    pullBlockedReason = "local_draft_present";
  } else if (!behindRemote) {
    pullBlockedReason = status.remoteRefExists ? "up_to_date" : "no_remote_ref";
  } else if (!status.clean) {
    pullBlockedReason = "dirty_working_tree";
  } else if (diverged) {
    pullBlockedReason = "diverged";
  }
  return {
    status,
    fetch: fetchResult,
    staleFreshness,
    behind,
    ahead,
    behindRemote,
    diverged,
    newerAvailable: behindRemote,
    localDraftCount: localDrafts.length,
    pullSafe,
    pullBlockedReason,
    checkedAt: new Date().toISOString(),
  };
}

export class MissionControlPullError extends Error {
  constructor(reason, message, { status = null } = {}) {
    super(message);
    this.name = "MissionControlPullError";
    this.reason = reason;
    this.status = status;
  }
}

// Bezpečný pull: FAIL-CLOSED.
//   - dirty working tree → odmítni (nikdy nepřepiš lokální draft),
//   - divergence (ahead > 0 && behind > 0) → odmítni jako konflikt,
//   - jinak fast-forward-only merge origin/<branch>.
// Žádný `reset --hard`, žádný silent overwrite. Když se cokoli pokazí,
// working tree zůstává tak, jak byl před pullem.
export function pullMissionControlRepository({ repositoryDbRoot, timeoutMs = DEFAULT_GIT_TIMEOUT_MS } = {}) {
  return withMissionControlRepositoryWriteLock(repositoryDbRoot, () => {
    const localDrafts = listMissionControlLocalDrafts({ repositoryDbRoot });
    if (localDrafts.length > 0) {
      const status = getMissionControlRepositoryStatus({
        repositoryDbRoot,
        fetch: false,
      });
      throw new MissionControlPullError(
        "local_draft_present",
        `Mission Control má ${localDrafts.length} nepublikovaný lokální draft. Nejdřív jej publikujte nebo odstraňte; pull jej nesmí tiše zneplatnit.`,
        { status },
      );
    }
    // Pull always performs the isolated fetch+target-validation pipeline.
    // A caller-supplied `fetch:false` must never turn a mutable cached
    // remote-tracking ref into a merge authority.
    const freshness = getMissionControlFreshness({
      repositoryDbRoot,
      fetch: true,
      timeoutMs,
    });
    const status = freshness.status;
    const repositoryBoundary = repositoryFetchBoundary(status);

    if (!repositoryBoundary.ok) {
      throw new MissionControlPullError(
        repositoryBoundary.reason,
        repositoryBoundary.message,
        { status },
      );
    }
    if (freshness.fetch.ok !== true || !freshness.fetch.verifiedHead) {
      throw new MissionControlPullError(
        freshness.fetch.reason ?? "fetch_failed",
        `Fetch před pull selhal: ${freshness.fetch.error ?? "unknown git error"}. Working tree ani tracking ref se nezměnily.`,
        { status },
      );
    }
    if (status.currentBranch !== status.expectedBranch) {
      throw new MissionControlPullError(
        "wrong_branch",
        `Data repo musí být na větvi ${status.expectedBranch}; aktuální větev je ${status.currentBranch}. Pull odmítnut.`,
        { status },
      );
    }
    if (!status.clean) {
      throw new MissionControlPullError(
        "dirty_working_tree",
        `Data repo má nepublikovaný draft (${status.dirty.length} změn). Pull je fail-closed a nikdy nepřepíše lokální draft — nejdřív Publikovat nebo změny zahodit.`,
        { status },
      );
    }
    if (freshness.diverged) {
      throw new MissionControlPullError(
        "diverged",
        `Lokální a remote větev se rozešly (ahead=${status.ahead} behind=${status.behind}). Fast-forward pull nejde — je potřeba ruční sloučení.`,
        { status },
      );
    }
    if (!freshness.behindRemote) {
      // Není co stahovat — vrátíme aktuální stav bez git operace.
      return {
        pulled: false,
        reason: freshness.pullBlockedReason ?? "up_to_date",
        fromHead: status.head,
        toHead: status.head,
        status,
      };
    }

    const fromHead = status.head;
    // Fast-forward-only: pokud lokální HEAD není předkem origin/<branch>,
    // git ff-only selže a my necháme working tree beze změny.
    // Canonical data is byte-exact LF; a Windows host with core.autocrlf=true
    // must not rewrite the pulled files (the data repo cannot carry its own
    // .gitattributes because inbound validation refuses them).
    const merge = runMissionControlGitCommand(
      status.repositoryDbRoot,
      [
        "-c",
        "core.autocrlf=false",
        "-c",
        "core.eol=lf",
        "merge",
        "--ff-only",
        "--no-overwrite-ignore",
        freshness.fetch.verifiedHead,
      ],
      { timeoutMs },
    );
    if (merge.status !== 0) {
      throw new MissionControlPullError(
        "fast_forward_failed",
        `Fast-forward pull selhal: ${merge.stderr || merge.stdout || "unknown git error"}. Working tree zůstal beze změny.`,
        { status },
      );
    }
    const after = getMissionControlRepositoryStatus({ repositoryDbRoot, fetch: false });
    return {
      pulled: true,
      reason: "fast_forward",
      fromHead,
      toHead: after.head,
      status: after,
    };
  });
}
