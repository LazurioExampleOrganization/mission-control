# Mission Control

Lazurio Mission Control v3: plans, tasks and roadmaps of a Lazurio
Organization, over a `repository-db` data repository.

> **Language:** the user interface is currently Czech only. An English UI,
> with the locale chosen by each Organization's Mission Control data config,
> is tracked in this repository's issues.

This repository is the public **upstream code boundary** for Mission Control. It must stay free of concrete company roadmap data, secrets, OAuth sessions, and personal runtime state. Each Organization keeps its own Mission Control data — roadmaps, plans, issues, TODO/DONE evidence, prefix config and local status — in an Organization-owned `mission-control-data` repository mounted through `repository-db` v3.

## Why this repo exists

Mission Control is a reusable product, not a one-off in-tree folder. Every
Organization runs the same released version of this app code; Organizations
differ only in their own data repository mounted at `db/` (plus the small,
declared instance overlay described below). This repo is the upstream for
those Organization-local Mission Control installs.

## Releases

Releases are tagged `vX.Y.Z` and published as GitHub Releases. Organization
forks integrate an exact release tag through a reviewed merge pull request (see
"Downstream synchronization" below); they never track an unreleased `main`
silently.

## Upstream and Organization fork workflow

`Lazurio/mission-control` is the source of truth for
reusable Mission Control app code, schemas, validators, tests and operating
documentation. Organization forks are deployable instances, not independent
upstreams.

### Change routing

1. Reusable behavior is changed upstream first.
2. A generic issue discovered in an Organization fork is reproduced on a
   branch based on the latest `Lazurio/mission-control` `main` and submitted as an
   upstream pull request.
3. Organization-specific roadmap data, owners, prefixes and runtime state stay
   in the Organization-owned `mission-control-data` repository. App-code fork
   synchronization must never carry this data upstream or between
   Organizations.
4. An app-code fork should carry only its declared instance overlay:
   Organization identity, package/app identifiers, port allocation and other
   explicitly allowlisted configuration.
5. An emergency downstream shared-code hotfix must link to an upstream pull
   request, declare an owner and expiry, and disappear after the upstream fix
   is integrated.

The v3 UI keeps its editable visual instance overlay in exactly two files:

- `app/v3/src/instance/brand.ts` mirrors the declared
  `companyascode.mission_control.organization.display_name` (the template uses
  the visibly generic `Organization` label);
- `app/v3/src/instance/theme.css` imports the reusable Lazurio theme and may
  additionally import `lazurio-grid.css`. Omitting that second import is the
  supported no-grid/no-gradient variant.

Reusable tokens and component styling stay under `app/v3/src/design-system/`;
do not put Organization names or rollout policy there.

### Downstream synchronization

Upstream changes flow into each Organization through a reviewed merge pull
request. Create the synchronization branch from the current downstream
`main`, fetch the exact reviewed upstream commit and merge that commit without
rewriting either history.

The final downstream integration commit must:

- keep the previous downstream `main` as its first parent;
- retain the pinned upstream commit in non-first-parent ancestry;
- resolve conflicts in app code and the declared overlay only, never by
  copying Organization data into the app-code fork;
- pass `bun run check`, `bun run test`, `bun run build` and validation against
  the Organization's real data mount;
- become the new fork-local application evidence anchor.

Do not use rebase, squash merge or force-push for upstream synchronization.
Once authenticated application evidence exists, recorded downstream app
commits must remain on the first-parent history of the deployed downstream
`HEAD`.

Synchronization is directional, not reciprocal: shared changes move to the
template through an upstream pull request and return to Organization forks
through a pinned downstream merge pull request. A downstream synchronization
commit is never merged back upstream, and no automation mirrors `main` in both
directions.

### Version and drift evidence

Each Organization fork should record the exact upstream repository and commit
it has integrated, together with its declared overlay manifest. Fork CI should:

- verify that the recorded upstream commit remains an ancestor of downstream
  `HEAD`;
- reject shared-code drift outside the declared overlay unless it references a
  temporary upstream pull request and expiry;
- report newer upstream commits without merging them automatically;
- run template checks, Organization data validation and the app build before a
  synchronization pull request can merge.

The exact marker, overlay manifest and CI automation are part of the fork
contract; they do not change the separate ownership or publication flow of an
Organization's `mission-control-data` repository.

## Boundaries

| Layer | Lives here | Lives in each Organization |
|---|---|---|
| App/code | Mission Control data adapter, UI shell, API contracts, validators, shared schemas, docs, Doctor install contract | App-specific config overrides only when needed |
| Data | Example placeholders and repository-db templates only | `data/mission-control/roadmaps/`, `data/mission-control/plans/`, `data/mission-control/ISSUES.*.json`, `data/mission-control/TODO.tasks.json`, `data/mission-control/DONE.tasks.json`, `data/mission-control/mission-control.config.json`, evidence reports, generated views |
| Secrets | Never | Never in Git; use approved secret custody only |

## Client-ready app package template

When a new GEN3 Organization forks Mission Control, install the full app-code repo **inside the concrete Organization checkout** as `<Organization>/mission-control` — for the shared Lazurio root, `organizations/<Org>_GEN3/mission-control`. Keep `origin=<Org>/mission-control`, keep `upstream=Lazurio/mission-control`, and mount `<Org>/mission-control-data` branch `v3` at `mission-control/db`. Do not make a root-level sibling checkout such as `Lazurio/repos/<org>-mission-control` the canonical runtime path; the filesystem path must show which Organization owns the Mission Control. The historical `templates/launchpad-app/` scaffold remains only a minimal first-client compatibility wrapper; new installs should prefer the tracked `app/v3/` runtime in this repo.

The scaffold contains:

- `lazurio.module.json.template` — the module-owned single TCP lease.
- `package.json.template` — valid `lazurio.runtime.v1` inventory and Bun scripts.
- `src/server.ts.template` — lightweight Launchpad app surface over Organization-owned Mission Control ledgers/plans.
- `tsconfig.json.template` — Bun/TypeScript editor configuration.

The app exposes UI and `/api/status` on the same listener, so Launchpad can
discover and health-check it without a hidden API or Vite port.

Declare the Organization-local allocation pool in its Organization manifest,
then replace the non-live template placeholder `24901` with a free exact lease
from that pool before materializing the file. Pools are local to an
installation and need not be globally unique; no cross-user port registry
exists. The placeholder must never reach a runnable module, and Doctor rejects
it outside the concrete Organization pool.

## Target repository-db v3 shape

The intended Organization mount is:

```text
<Organization>/
  mission-control/              # forked app/code repo
    app/v3/                     # reusable Mission Control runtime
    db/                         # gitignored repository-db data checkout
      repository-db.yaml
      data/
        mission-control/
          mission-control.config.json
          roadmaps/
          plans/
          reports/
          import-reviews/
          changesets/           # optional read-only legacy history
          ISSUES.open.json
          ISSUES.resolved.json
          TODO.tasks.json
          DONE.tasks.json
      generated/
      scripts/
```

No live Organization data belongs in the app-code fork. The `db/` directory is gitignored, Doctor-managed, and backed by `<Org>/mission-control-data` branch `v3`. Do not silently move an Organization to data-repo mode without a local Mission Control plan and rollback path.

## Scripts

```bash
bun run check
bun run test
```

The App is a Lazurio Module (Lazurio Module Standard, decision 0171): Launchpad
runs its declared preparation (`app/v3` `prepare:app`, the client build) and
starts it with `app/v3` `dev` (`bun run src/server.ts`, one process, listener
only from `LAZURIO_RUNTIME_LISTENER_WEB_HOST/_PORT`). The root package is
repository tooling and has no start script; see
`docs/mission-control-v3-rollout-manual.md` for direct development.

Root scripts use `scripts/run-v3.mjs` instead of POSIX-only `export`/`cd`
chains, so the same commands work on macOS, Linux and Windows. The runner reads
the explicit `package.json → companyascode.mission_control.mode` contract:

- `template` runs `app/v3` against `templates/organization-data`;
- `organization` runs it against the app checkout and auto-discovers the
  Organization-owned `db/` mount, with the Organization parent as workspace.

`app:test` is the deliberate exception: it always uses the bundled `DEV`
fixtures so a concrete Organization prefix does not invalidate reusable app
tests. Root `bun run test` runs `bun run check` first; therefore the real
Organization mount and plans are validated before the isolated fixture suite.

When instantiating a fork, set the mode to `organization`, replace its
`organization.slug` and `organization.display_name`, rename the root package to
`<lowercase-slug>-mission-control`, and set `app/v3/package.json` to
`@<lowercase-slug>/mission-control-v3`. Set the exact Organization slug in both
`lazurio.module.json` and `lazurio.runtime.company`, set the runtime ID to
`<lowercase-slug>-mission-control-v3`, and allocate the module's single `main`
lease from the Organization-local allocation pool. Mirror the display name in
`app/v3/src/instance/brand.ts` and choose the grid/no-grid variant only through
`app/v3/src/instance/theme.css`. `bun run check` validates both the reusable
template mode and this concrete Organization mode.

After changing the root and `app/v3` package names, run `bun install` at the
repository root and `bun install --cwd app/v3` before the first check. This
regenerates both lockfile workspace identities for the concrete Organization;
the checker rejects template or foreign package names left in either lockfile.

`check` validates the mode-specific identity contract, bundled schema JSON,
repository-db wiring, tracked `app/v3` runtime, runtime adapter presence,
no-live-data guard, protected-path policy, fork-sync install docs, and the
Roadmap Priority / Roadmap Step planning model. `bun run test` exercises both
the reusable Mission Control data adapter and the direct local publish flow,
including validation, fast-forward concurrency and rollback boundaries.

## Runtime adapter and publish flow

`src/mission-control-data-adapter.mjs` is the reusable app-code read/write-boundary guard. It loads Organization-owned Mission Control data from a repository-db checkout mounted at `mission-control/db/` and treats paths in `data/mission-control/mission-control.config.json` as the canonical read model.

> **Default mode:** every trusted Builder whom GitHub allows to write to the
> Organization-owned `mission-control-data` repository can publish. Mission
> Control keeps no second roster and no approval or capability ACL.

`src/mission-control-publish-flow.mjs` implements the first reusable
repository-db write flow. `app/v3` exposes status, freshness, local drafts and
explicit publish over loopback HTTP/UI.

1. A supported native Git writer profile, a github.com data remote and a
   normal Git commit identity enable the UI. The default
   `local-principal-v1` profile uses the Builder's SSH agent or
   credential-free HTTPS helper. The hosted `github-app-workspace-v1` profile
   requires credential-free HTTPS and receives a fresh repo-scoped
   installation token from the standard external Git credential helper.
   Plaintext credentials in remote URLs are rejected.
2. A draft is stored under `.git/mission-control-drafts/`, never committed as
   canonical Organization data. Its `draft_revision` binds normalized
   operations, summary and base HEAD.
3. UI shows the exact paths/content and asks for explicit confirmation of that
   revision. It does not ask for an actor, role, approver or writer ID.
4. The server accepts writes only from a fixed startup `Host`/`Origin`
   allowlist with a random process-local session token. The allowlist holds
   the loopback lease origin and, on a hosted workspace VM, the exact public
   `https` origin Launchpad injects as
   `LAZURIO_RUNTIME_LISTENER_WEB_EXTERNAL_ORIGIN`; an invalid value fails
   startup instead of widening the allowlist.
5. Publish rechecks exact repo, `v3` branch, remote, clean state, base HEAD,
   protected paths and the draft revision under one local write lock.
6. The pinned app-owned validator runs without Git credentials. The writer
   invokes `git` from the current Principal's normal `PATH` and honors their
   standard Git/SSH/credential-helper configuration on macOS, Linux and
   Windows.
7. One publish creates one single-parent commit containing only the canonical
   data change, performs a normal non-force fast-forward push and verifies the
   exact remote HEAD. Git history and GitHub's pusher attribution are the
   audit trail; no shadow changeset record is created.
8. A proven rejected push rolls back only an unchanged writer-owned local
   commit. Any ambiguous remote or changed local state is preserved for manual
   reconciliation without automatic retry.

### Writer profiles

- **Default: `local-principal-v1`** — one Builder machine, one live GitHub
  identity and its standard SSH or HTTPS credential flow.
- **Hosted profile: `github-app-workspace-v1`** — one shared Team Workspace,
  one credential-free HTTPS checkout and one external, repo-scoped GitHub App
  credential helper. Mission Control keeps no App private key, token, roster
  or parallel authorization state. The native draft, validator, commit,
  fast-forward push, rollback and frozen-history rules are identical in both
  profiles.

GitHub repository grants are the only access authority. In the hosted
profile, GitHub's pusher attribution truthfully identifies the Team Workspace
App identity; the commit author remains ordinary Git presentation metadata.

### Frozen historical audit data

Existing files under the changeset audit directories remain readable and
validated as immutable history. The active runtime does not create, approve,
publish, supersede or authorize through them, and no second writer runtime is
shipped. New publishes rely on the ordinary Git commit and GitHub pusher
attribution.

Do not edit or delete historical audit files to unblock current work. Their
standalone validator and schemas remain until a separate reviewed fleet-wide
data migration proves they can be retired safely.

In `repository-db` mode, prepare plan and TODO edits as a local draft on the
Repository page, review the exact revision, and publish through the native Git
flow. Legacy `ISSUES.*.json` files are read-only history: neither direct API
requests nor native drafts may change them. Create and resolve active technical
issues in GitHub Issues of the owning repository.

Freshness and fast-forward pull preserve the same repository/data-integrity
boundary. Git comes from the Principal's `PATH` and uses normal SSH and
credential-helper configuration.
HTTP freshness requests never run the network Git operation on the server
event loop. The server returns the local or last successful snapshot
immediately, deduplicates one request-driven Bun Worker per canonical data-repo
root, and exposes `refreshing` plus explicit success/failure metadata while the
existing bounded freshness engine runs in that Worker. A failed refresh keeps
the last known remote state visible but disables pull until a later successful
refresh. Status requests are strictly local, and cached pull safety remains
valid only while the exact remote-tracking SHA still matches the Worker's
verified commit. This cache is observational only: explicit pull always reruns
the full fetch, inbound-validation and fast-forward safety boundary.
Before any network fetch they require the effective `origin` fetch URL to
equal the remote anchored in a clean HEAD/index `repository-db.yaml` and reject
local control-plane drift plus checkout-local URL, include, hook, filter,
worktree or command-transport routing. Control-plane blobs and their `100644`
modes must match HEAD and index exactly. The local lane does not replace the
Principal's machine-wide Git transport configuration. Repository-local
routing and command overrides remain blocked so the checkout itself cannot
silently redirect the reviewed remote.
The validated URL is stored in a
mode-restricted temporary bare-repository config and fetched by remote name,
then imported without consulting mutable checkout transport config or exposing
the URL in process arguments. Published updates are accepted from the configured authenticated GitHub remote
and branch. GitHub repository grants authorize publication; clients do not
maintain a second per-commit approval registry. Only the incoming target snapshot is checked out and validated, including a
byte-identical target with new history. Historical intermediate
states may predate the current schema and are not revalidated or executed.
The pinned validator still checks the target's frozen audit history.

Before import, target paths must be portable regular files without case
collisions, symlinks, gitlinks or executable domain data. `.gitattributes` and
`.gitmodules` at any depth are refused before checkout, so incoming bytes
cannot activate Git filters or submodules. Published `.gitignore` changes and
inert legacy lock files are allowed; ignored canonical data remains dirty and
the fast-forward merge uses `--no-overwrite-ignore` to preserve ignored local
files elsewhere. Data-provided scripts are never executed.

Target schemas must match the reviewed app's bundled schemas after CRLF normalization, and
`repository-db.yaml` must retain the configured remote and branch. A schema
upgrade requires a compatible app update; repository relocation is an explicit
installation change. Invalid target data cannot move the tracking ref or HEAD.
Equal/behind targets introduce no new history. The local
HEAD, not a mutable tracking ref, anchors the diff; pull fetches through this
boundary and merges the exact verified commit. `fetch:false` cannot authorize
a merge.

Pull deliberately does not
require the push URL to match: an Organization may keep
`remote.origin.pushurl=/dev/null` as a temporary write guard while read-only
freshness and pull continue to work.

The full operator manual lives in `docs/mission-control-v3-operating-manual.md`. Roadmap model documentation lives in `docs/roadmap-planning-model.md`, and the reusable v3 module documentation baseline lives in `docs/v3-module-documentation-standard.md`.

## Operator and extension docs

- `docs/mission-control-v3-operating-manual.md` — agent-facing architecture, ideology, operation, administration and extension manual.
- `docs/repository-db-data-boundary.md` — app-code / Organization-data boundary and runtime write model.
- `docs/doctor-managed-install.md` — Doctor/Launchpad install and mount contract.
- `docs/roadmap-planning-model.md` — Roadmap / Roadmap Priority / Roadmap Step model.
- `docs/v3-module-documentation-standard.md` — documentation baseline expected for each reusable GEN3 v3 module.

## License and client rights

Mission Control is licensed under the MIT License (see `LICENSE`). Client Organizations may use, copy, modify, merge, publish, distribute, sublicense and sell their derived copies, including for commercial use, as long as they preserve the license notice.

## Continuous integration

CI runs `bun run test:ci`: app identity/schema checks, bundled fixture validation,
typechecking and the same complete test suite as `bun run test`. It needs no
private Organization data checkout or cross-repository credential. This is not
rollout evidence: normal `bun run check` / `bun run test` still require and
validate the real Organization data mount before downstream merge.
