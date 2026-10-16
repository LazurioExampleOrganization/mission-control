# Repository-db data boundary

Mission Control v3 follows the same architectural direction as repository-db-backed business apps: reusable app/code is separated from Organization-owned data.

## App/code boundary

This template repo owns reusable code and contracts:

- UI/API shell for Mission Control Roadmaps
- validators and shared schemas
- generic roadmap/plan/issue/TODO evidence loaders, starting with `src/mission-control-data-adapter.mjs`
- repository-db adapter contracts
- Doctor install and health-check conventions

It must not own real Organization roadmap state.

## Organization data boundary

Each Organization owns its Mission Control truth:

- plan prefix and canonical `organization_admin` identity in `data/mission-control/mission-control.config.json`
- `data/mission-control/roadmaps/`
- `data/mission-control/plans/`
- `data/mission-control/ISSUES.open.json` and `data/mission-control/ISSUES.resolved.json` as frozen, read-only history; active technical issues belong in the owning GitHub repository
- `data/mission-control/TODO.tasks.json` and `data/mission-control/DONE.tasks.json`
- `data/mission-control/reports/`, `data/mission-control/import-reviews/`, and generated views under `generated/`

The preferred data mount is `mission-control/db/` inside the Organization-local app checkout (for Lazurio: `organizations/<Org>_GEN3/mission-control/db/`), backed by the Organization-owned `<Org>/mission-control-data` repository on branch `v3`, and managed by repository-db rather than blind Doctor submodule/gitlink tracking. Its `repository-db.yaml` uses the upstream `repository-db.config.v1` shape (`app`, `data_repo`, `schema`, `layout`, `generated_manifest`, `validate`). Doctor may verify that the mount exists, points at the expected remote/branch, and is healthy.

## Compatibility bridge

Existing GEN2/GEN3 repos currently keep `mission-control/roadmaps` and `mission-control/plans` in-tree. The rollout may use a compatibility bridge while migrating:

1. Keep current YAML paths readable for existing validators.
2. Introduce repository-db status/publish/conflict semantics around the data checkout.
3. Move writes to the data boundary only after the Organization-local plan defines rollback and parity checks.

## Payload/envelope decision

This template's first repository-db slice uses repository-db for mount/status/publish/conflict semantics and keeps Mission Control payloads as raw compatibility files under `layout.data`. In other words, roadmap YAML, plan YAML, JSON issue ledgers, and TODO/DONE ledgers remain readable by existing Mission Control validators during rollout.

Do **not** introduce repository-db collection envelopes for Mission Control roadmaps/plans until a separate runtime adapter plan updates the app loaders, schemas, migration script, and Organization-local rollback gates.

## Runtime read adapter

The baseline runtime adapter reads raw compatibility payloads from a repository-db mount:

- `repository-db.yaml`
- `data/mission-control/mission-control.config.json`
- plan YAML under the configured `plans_dir`
- roadmap YAML under the configured `roadmaps_dir`
- `ISSUES.open.json` / `ISSUES.resolved.json` (historical read model only)
- `TODO.tasks.json` / `DONE.tasks.json`
- reports and import-review artifacts under their configured directories

When the app-root `mission-control.config.json` declares
`data_mode: repository-db`, the mount is mandatory. A missing or incomplete
`mission-control/db` fails startup with an explicit blocker; runtime must never
fall back to template or relative in-tree data in this mode. The reusable
template development config intentionally omits `data_mode`, so its bundled
generic fixture remains available without a client mount.

Ledger discovery follows the same boundary. In `repository-db` mode the runtime
reads only the four configured canonical TODO/DONE/open-issue/resolved-issue
paths under `MISSION_CONTROL_DATA_ROOT`; it does not recursively scan
`WORKSPACE_ROOT`. Frozen root mirrors therefore cannot duplicate tasks or
issues. `WORKSPACE_ROOT` remains the base for workspace-relative planning paths
and non-Mission-Control module context. Recursive workspace ledger discovery is
available only in compatibility mode.

All configured paths must stay inside the repository-db checkout. If `compatibility_bridge.legacy_write_paths_allowed` is false, the adapter refuses writes outside the repository-db mount. This protects the app-code/data-repo split while Organizations still keep legacy in-tree planning files readable during migration.

Policy-defining files are a separate control-plane boundary. After bootstrap,
`mission-control.config.json` and `repository-db.yaml` must not be ordinary
changeset operations because that would let the domain-data writer broaden its
own paths, roles or credential policy. Change them only in a dedicated
migration PR that contains no unrelated domain data, is explicitly approved by
the Organization Admin, validates both migration preconditions and the target
shape, and records a rollback. Validator, schema and reusable instruction
updates may travel in the same migration PR when they are required by that
policy transition.

## Receiving published updates

Published updates are accepted from the configured authenticated GitHub remote
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

Repository status reads frozen history as metadata without requiring today's
write-policy fields. A pre-migration client can therefore open the recovery UI;
its unsupported writer remains disabled. Status responses omit archived
operation payloads. Direct app/v3 launches derive pinned-validator workspace
context from app-owned instance metadata, matching the root runner.

The control-plane migration PR above governs publication at the source. The
receiving client verifies origin, target compatibility and runtime safety; it
does not ask every client operator to approve the already-published commit
history again. This is a deliberate trust model for the small trusted Builder
team described below, not a sandbox against a malicious Principal with direct
filesystem or Git access. Native `git pull` does not run these application
checks; after manual recovery, validate the current mounted snapshot before
claiming readiness. Do not restore an old checkout just to replay old approvals.

## Runtime write flow

The default first-client write slice is application-approved, not PR-approved
domain data, and uses `writer_mode: local-principal-v1`. A shared Hosted Team
Workspace may instead select `writer_mode: github-app-workspace-v1`; both
profiles use the exact same native Git transaction engine.

The canonical commit-and-push entry is the local writer running on the
Builder's own machine. GitHub repo grants and branch rules are the sole access
authority; Mission Control does not duplicate them in a provider audit,
roster, approval role or credential capability. Loopback HTTP carries the
exact reviewed draft intent only and is protected by an exact startup
`Host`/`Origin` allowlist (the loopback lease plus, on a hosted workspace VM,
the validated `LAZURIO_RUNTIME_LISTENER_WEB_EXTERNAL_ORIGIN`) and a
process-local session token. Git author
identity and GitHub's pusher attribution provide accountability.

1. The data repo declares concrete, non-empty `protected_paths`, the exact
   GitHub repository and branch `v3`. Historical provider-audit or approval
   metadata may remain readable but never authorizes or blocks the writer.
2. `createMissionControlLocalDraft` stores normalized operations below Git
   metadata. It does not dirty the checkout or create a commit.
3. UI presents the exact draft and `draft_revision`. Publish accepts only that
   revision and rechecks it under the repository write lock.
4. `publishMissionControlLocalDraft` requires a clean, exact, non-diverged
   checkout with a commit identity resolved through normal Git
   local/global/system precedence; applies only protected
   operations; runs the pinned credential-free validator; and creates one
   single-parent commit containing only canonical data.
5. Git requires a github.com remote. The local profile uses the Builder's own
   OS-held credential: an SSH remote uses the current Builder's normal SSH
   config/keys/agent and a credential-free HTTPS remote uses normal Git
   credential-helper precedence. The hosted profile requires a credential-free
   HTTPS remote and an external standard Git credential helper that supplies a
   fresh short-lived token scoped to the exact repository. Mission Control
   never sees an App key, persists a token or owns a Team/repository roster.
   The normal fast-forward push itself is the access check; GitHub accepts or
   rejects the actual credential, then the writer verifies exact remote HEAD.
6. A rejected push rolls back only after proving HEAD, refs, index and worktree
   still equal the writer-owned post-commit state. An ambiguous remote or local
   change is preserved for reconciliation.

### Non-blocking freshness

The loopback HTTP server never performs a network Git freshness check on its
event loop. A request receives the current local or last successful remote
snapshot immediately. The server then owns at most one request-driven Bun
Worker per canonical repository-db root; concurrent polls reuse that refresh
instead of starting parallel fetches. The Worker invokes the existing bounded
freshness engine, so URL trust, isolated fetch, inbound validation and timeout
rules remain one authority.

While a refresh runs, or after it fails, the API marks the snapshot stale and
disables pull. Failure and timeout metadata remain explicit while the last
successful remote observation stays visible. There is no background timer and
no cached result authorizes a write: an explicit pull still repeats the full
validated fetch and fast-forward gate.

### Frozen historical audit data

Older changeset, writer-audit, provenance and quarantine records remain
readable and immutable. They are not an active workflow, do not authorize new
writes and have no create, approve, publish or supersede runtime entry points.

The standalone data validator deliberately keeps the historical schemas,
lineage and immutability checks needed to reject deletion, rewriting or forged
continuation of those records. New Organizations do not create this evidence;
their canonical truth changes only through a reviewed local draft and a
successful ordinary Git publish on the Organization-owned data branch.

## Data repo branch convention

Default first convention: data branch `v3`, mirroring Deals v3. Future schema generations may use orphan major branches (`v4`, `v5`) after a migration plan and retention decision.
