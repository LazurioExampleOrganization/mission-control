# Mission Control v3 Operating Manual

> **Current default:** GitHub repository grants are the only access authority.
> Every trusted Builder may publish a validated Mission Control data commit to
> `v3`; the app creates one single-parent commit and one normal fast-forward
> push, without a provider audit, approval-role ACL or shadow changeset.
> Historical audit files remain read-only and do not define an active workflow.
> The same workflow applies on every GitHub plan. A small trusted team may use
> `trusted-process` enforcement; Organization Admin must switch to
> `provider-enforced` private-branch rules before the write circle is no longer
> personally stewardable or broad write is granted to an external identity or
> automation. Missing technical enforcement never relaxes Builder discipline.

Mission Control v3 is the planning cockpit for a Lazurio Organization. It is the place where human operators and AI colleagues see the current roadmap, executable plans, source-of-truth ledgers, open blockers, evidence, and release gates for a Workspace.

This manual is written for external agents and client technical teams who need to operate, administer, audit, or extend Mission Control without knowing the history of the Lazurio maintainers or the original implementation chat.

## 1. What Mission Control v3 is

Mission Control v3 is not a generic ticket tracker and not a chat transcript archive. It is a typed, repository-backed operating surface for a digital office:

- **Roadmaps** describe long-running outcomes and completion gates.
- **Plans** describe concrete implementation or stewardship slices, usually identified by a `DEV-XXXX` or Organization-specific code.
- **Task ledgers** (`TODO.tasks.json`, `DONE.tasks.json`) materialize executable work and completion evidence.
- **GitHub Issues** in the exact owning repository capture active technical blockers and questions. Legacy issue ledgers remain read-only history.
- **Evidence references** connect a done state to source-controlled docs, reports, validations, pull requests, commits, or external approvals.
- **Repository-db** separates Organization-owned business/planning data from reusable app/code.

The goal is to make a Workspace understandable and operable by people and agents who were not present when the work was discussed.

## 2. Product ideology

Mission Control follows these principles:

1. **Workspace truth must be inspectable.** Important state lives in Markdown/YAML/JSON files in Git, not only in chat, local memory, or an SaaS database.
2. **Planning is executable.** A roadmap without plan refs, task refs, issue refs, or evidence cannot be treated as operational truth.
3. **Agents need source-of-truth surfaces.** External agents should be able to read the repo and know what to do next, what not to touch, and what evidence is required.
4. **App/code and Organization data are different lifecycles.** Reusable Mission Control app code lives in this template; each Organization owns its concrete plans, roadmaps, ledgers, reports, approvals, and data history.
5. **Compatibility is explicit.** During GEN2 → GEN3 migrations, legacy YAML/root ledgers may remain readable, but write-path or sole-source cutover must be an explicit gated decision.
6. **Confirmation is domain-aware.** Domain data publishes explicitly confirm an exact validated draft revision; code changes still use normal PR review.
7. **No hidden hero dependency.** A mature Workspace must be operable by a client, their internal AI colleagues, or Lazurio support without relying on one founder's memory.

## 3. Lazurio delivery model

Lazurio provides Workspaces as client-owned digital offices. A client Organization receives:

- a source-controlled Workspace repository;
- reusable applications such as Launchpad, Mission Control, Knowledgebase, Pricebook, Deals, or other v3 modules;
- Organization-owned data repositories for modules that need audit-grade data lifecycles;
- Doctor/Launchpad surfaces for local operation and health checks;
- agent-facing docs and contracts so AI colleagues can operate safely inside the client's context.

Mission Control v3 is the planning/control cockpit inside that system. It lets a client Organization understand what is active, what is blocked, what has been proven, and what must not be changed without approval.

For client delivery, this template is intentionally permissively licensed. Clients may modify and extend their copy for commercial use, while the Lazurio maintainers keep maintaining the public upstream (`Lazurio/mission-control`) and reusable patterns.

## 4. Repository architecture

### 4.1 Template app/code repository

This repository owns reusable Mission Control app/code and generic contracts:

- adapters (`src/mission-control-data-adapter.mjs`);
- repository-db publish flow (`src/mission-control-publish-flow.mjs`);
- schemas (`schemas/`);
- generic Organization data scaffold (`templates/organization-data/`);
- docs and operating contracts (`docs/`);
- validators and tests (`scripts/`, `src/*.test.mjs`).

It must **not** contain real Organization plans, client ledgers, customer secrets, OAuth state, local runtime caches, or concrete company business data.

### 4.2 Organization app/code instance

An Organization may have an app/code repo such as `<Org>/mission-control` derived from this template. That repo can contain Organization-specific wrapper code or configuration needed to run Mission Control in the Organization's Workspace, but it should not absorb the Organization's planning data.

A typical installation uses Doctor to mount or verify this app/code checkout. Until a migration is complete, an Organization may keep an in-tree compatibility app as readable fallback.

### 4.3 Organization data repository

Each Organization owns a data repo such as `<Org>/mission-control-data` on branch `v3`. It is mounted at `mission-control/db` inside the Organization-local Mission Control app checkout — in Lazurio, `organizations/<Org>_GEN3/mission-control/db` — and contains:

```text
repository-db.yaml
data/
  mission-control/
    mission-control.config.json
    roadmaps/
    plans/
    reports/
    import-reviews/
    changesets/
      pending/
      published/
      superseded/
    ISSUES.open.json
    ISSUES.resolved.json
    TODO.tasks.json
    DONE.tasks.json
generated/
scripts/
```

The data repo is where canonical Mission Control data can live once the Organization has passed its migration gates.

### 4.4 Compatibility bridge

During rollout, an Organization can read legacy files from the main Workspace repo while gradually introducing repository-db status and publish semantics. The bridge must always make these facts explicit:

- which files are canonical;
- which files are fallback/read-only compatibility inputs;
- whether legacy writes are allowed;
- which approval and rollback gates must pass before cutover.

## 5. Runtime architecture

Mission Control has three reusable runtime layers:

1. **Data adapter** — reads Organization-owned Mission Control data from a repository-db checkout and enforces safe paths.
2. **Publish flow** — keeps local drafts outside Git, binds approval to the
   exact `draft_revision`, publishes one validated commit under the current
   Principal's GitHub SSH identity and reconciles failures safely.
3. **UI/API shell** — presents plans, roadmaps, agent work, validation, and release gates to humans and AI colleagues.

The template currently focuses on the reusable data adapter and publish flow. Organization app repos may add or wrap a React/Vite UI, HTTP routes, CLI tools, or Launchpad integration as long as they preserve the same app/data boundary.

## 6. Data model

### Roadmaps

Roadmaps are long-lived outcome records. A roadmap must explain:

- why the outcome matters (`priorities`);
- what steps are needed (`steps`);
- which plan(s), task(s), or issue(s) make each step executable;
- what evidence closes each done step.

Roadmap files use `schemas/mission-control-roadmap.schema.json` and the conceptual model in `docs/roadmap-planning-model.md`.

### Plans

Plans are implementation or stewardship slices. A plan should hold context, target state, scope, acceptance criteria, validation commands, risk notes, decisions, dependencies, and materialized TODO outputs.

Plans are not meant to be raw chat logs. They are curated operational briefs.

### Task ledgers

Task ledgers are the execution layer:

- `TODO.tasks.json` holds open/in-progress/review/blocked work.
- `DONE.tasks.json` holds completed work with outcome and evidence.

A task should link back to the plan or roadmap that explains why it exists.

### Issue ledgers

Use GitHub Issues in the exact owning repository for active technical blockers and questions. Check duplicates and visibility before exporting any legacy record. Legacy ledgers retain their original identities and references as read-only history; historical resolved records must not be reopened. The retired resolution endpoint returns HTTP 410 and the native draft writer rejects issue-ledger writes.

### Local drafts and historical audit

An active draft lives under Git metadata and is not canonical truth. The
Repository page shows its exact paths, content, base commit and revision.
One explicit publish confirmation creates one validated single-parent commit
with only the reviewed domain-data paths and sends an ordinary non-force
fast-forward push. Git history and GitHub pusher attribution are the audit
trail; active publication creates no changeset, actor, approval or writer
receipt record.

Older files in the pending, published and superseded changeset directories
are frozen historical audit data. The active runtime lists them read-only but
never creates, approves, publishes, supersedes or authorizes through them.
The standalone validator continues to verify their existing invariants until
a separate reviewed fleet-wide data migration retires them.

## 7. Write and compatibility model

Mission Control uses a fail-closed write model because planning data can steer real organizations.

A canonical data publish must verify:

- `publish_policy.protected_paths` is present, concrete, non-empty, and limited to the Mission Control data boundary;
- the data checkout is on the expected branch (normally `v3`);
- the checkout is clean and not diverged from `origin/v3`;
- no merge, rebase, sequencer, cherry-pick, revert or bisect is in progress,
  even when porcelain is clean; the resulting commit has exactly one parent
  equal to transaction start;
- effective `origin` fetch and push URLs match `repository-db.yaml:data_repo.remote` without local routing overrides;
- validation passes;
- every operation matches `publish_policy.protected_paths`, stays inside canonical Mission Control data paths, and never enters audit directories.

### Default: `local-principal-v1`

Publish additionally requires an unchanged reviewed `draft_revision` and
native Git commit identity. GitHub accepts or rejects the actual
Principal's SSH or credential-helper identity from live repository grants; no
parallel roster, provider audit, approval-role ACL, writer ID or credential
authority is configured. A successful publish creates no shadow changeset.

### Hosted Team Workspace: `github-app-workspace-v1`

Hosted Team Workspaces use the same native draft, validation, single-parent
commit, non-force fast-forward push and rollback engine. The data remote must
be an exact credential-free `https://github.com/...` URL. Standard Git obtains
a fresh, short-lived, repository-scoped installation token from the external
Lazurio for GitHub credential helper for each network operation; Mission
Control never receives the App private key, persists a token, keeps a Team or
Admin roster, or implements a broker. GitHub repository installation grants
remain the only access authority and the GitHub pusher is truthfully the Team
Workspace App identity.

Revoking the repository installation grant makes the next freshness, pull or
publish operation fail closed without restarting Mission Control. A running
Agent job is not implicitly terminated by that Git access revocation.

### Frozen historical audit data

Historical changeset, writer-audit and provenance records are read-only.
They do not authorize active writes and there is no compatibility writer
fallback. New Organizations keep these directories empty.

Publish, discard and fast-forward pull share one repository-local lock under
`.git/mission-control-write.lock`, so concurrent requests cannot race. After
a crash, verify the recorded PID is inactive and reconcile the working tree,
local HEAD and remote HEAD before removing a stale lock.

Native-writer Git subprocesses ignore inherited repository-routing and
author/committer environment overrides. The local profile uses the current
Principal's normal `PATH`, local/global/system Git identity, SSH config/agent
and credential helpers. The hosted profile uses its configured Team Workspace
commit identity plus the external repository-scoped Git credential helper.
Hooks remain disabled and commands run without a shell.

Freshness and fast-forward pull apply the same data-integrity checks. Remote and branch
come from committed HEAD `repository-db.yaml`; both control-plane files must
match HEAD and index, and the effective `origin` fetch URL must match that
trusted remote before network access. Checkout-local URL rewrites, includes,
hooks, filters, alternate worktrees and command transports block pull before
worktree inspection. HEAD/index blobs and `100644` modes match exactly while
the safe working-file comparison tolerates CRLF without executing checkout
filters. The local lane launches Git from the Principal's `PATH` and uses
their normal SSH and credential-helper configuration; repository-local
routing and command overrides stay blocked. Network transfer
uses the validated literal URL in a temporary bare-repository config and
fetches it by remote name, then imports the bundle
and atomically updates the tracking ref without re-reading mutable checkout
transport config or exposing the URL in process arguments. The configured
branch must pass Git's complete branch-name validation (`HEAD` is reserved),
and network transfer plus inbound diff gate and bundle creation/import share
one deadline.

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

Target schemas must match the reviewed app's bundled schemas after CRLF
normalization, and
`repository-db.yaml` must retain the configured remote and branch. A schema
upgrade requires a compatible app update; repository relocation is an explicit
installation change. Invalid target data cannot move the tracking ref or HEAD.
Equal/behind targets introduce no new history. The local
HEAD, not a mutable tracking ref, anchors the diff; pull fetches through this
boundary and merges the exact verified commit. `fetch:false` cannot authorize
a merge.

A requested fetch
that fails always blocks the pull action, even when a stale tracking ref already
points ahead. Publish validation
executes only the pinned validator from app code, resolves `ajv` and `yaml`
through the independently installed `app/v3` package, and removes Git
authentication metadata, agent sockets and inherited Node code-load options
from that process. A push-only override such as
`remote.origin.pushurl=/dev/null` does not block read-only fetch/pull; publish
still requires its stricter fetch-and-push boundary.

When `data_mode` is `repository-db`, legacy plan creation/update, TODO apply and
issue-resolution direct writers fail closed before touching canonical data.
Represent those edits as local drafts on the Repository page and explicitly
publish the reviewed revision.
Agent Work and work-board read only the four configured canonical ledgers; root
mirrors remain migration evidence, not runtime truth.

Normal app/code changes still use PR review in the app/code repository. Domain data writes use the repository-db publish flow.

The loopback HTTP layer accepts intent only from its fixed local Host and
Origin with the process-local session token; on a hosted workspace VM the
exact public origin injected as `LAZURIO_RUNTIME_LISTENER_WEB_EXTERNAL_ORIGIN`
is the only addition to that allowlist. It never receives Git
credentials or organizational identity from the browser; GitHub authorizes
the ordinary push under the Principal's normal Git login.

## 8. Doctor and Launchpad integration

Doctor is responsible for installation and health verification. It may:

- clone or update app/code and data checkouts when the Organization has opted in;
- verify remotes, branches, cleanliness, and validation commands;
- report what Mission Control app/data surfaces are being read;
- refuse blind conversion from compatibility mode to data-repo mode.

Launchpad is the local entry point that should expose Mission Control as an app. It should show the canonical app surface without duplicating legacy variants as if they were independent products.

Doctor and Launchpad must not silently change write paths, disable fallback, or publish data.

## 9. Operating modes

Mission Control installations should declare their current mode:

| Mode | Meaning | Writes |
|---|---|---|
| `compatibility` | Legacy in-tree Mission Control data remains the active surface. | Legacy writes may exist by local policy. |
| `hybrid` | Template app/code and repository-db data mount exist; legacy YAML remains readable fallback. | Data writes should be proposed through repository-db, but cutover may not be complete. |
| `data-repo` | Repository-db data checkout is the canonical write boundary. | Canonical writes go through reviewed local drafts and native Git publish. |

A migration from one mode to another must be recorded in the Organization's Mission Control plan or roadmap, with rollback evidence.

## 10. Administration checklist

For an Organization administrator or steward:

1. Verify app/code remote and branch.
2. Verify data repo remote and branch.
3. Run the template check: `bun run check`.
4. Run tests: `bun run test`.
5. From the Organization data repo, run the validator pinned in the installed
   Mission Control app-code checkout; do not execute the data checkout's
   `scripts/` under writer credentials.
6. Confirm that any legacy fallback is read-only or retired.
7. Confirm `publish_policy.protected_paths` is concrete and non-empty.
8. Verify the exact GitHub data repo/branch grant by an ordinary non-force
   dry-run or equivalent live Git operation; do not copy access into a second
   Mission Control roster.
9. Verify the commit identity from normal Git config and the Principal's native GitHub SSH/HTTPS login.
10. Review the exact local draft revision before publishing.
11. Publish only from a clean, up-to-date data checkout.
12. After publish, reclone/smoke or otherwise prove the remote state can be read by Mission Control.

## 11. Extension guide

When extending Mission Control:

1. Decide whether the change is reusable app/code or Organization data.
2. Put reusable code, schemas, validators, generic docs, and scaffolds in this template.
3. Put concrete plans, roadmap rows, issues, task ledgers, approvals, and reports in the Organization data repo.
4. Add or update schema guards before relying on a new field.
5. Add tests for adapter, publish flow, or validator behavior.
6. Document the operating reason, not only the implementation detail.
7. Preserve compatibility bridge semantics unless the Organization has explicitly cut over.
8. Keep external agents in mind: the docs must be enough for an agent to understand where truth lives and what is forbidden.

### Adding a new v3 module

Every reusable v3 module should ship the same documentation baseline:

- `README.md` — module purpose and quickstart;
- `LICENSE` — client rights and upstream license;
- `docs/<module>-v3-operating-manual.md` — architecture, ideology, operations, administration, extension;
- `docs/doctor-managed-install.md` or equivalent install/mount contract;
- `docs/repository-db-data-boundary.md` when the module owns Organization data;
- `CONTRIBUTING.md` — how to change the template safely;
- `SECURITY.md` — what must never be committed and how to report issues;
- validator/tests that make the critical docs and boundaries part of the repo contract.

## 12. Why this architecture exists

Mission Control is designed this way because a client Workspace must remain understandable and modifiable after delivery. If code, data, approvals, chat logs, and local state are mixed together, agents cannot safely operate the system and clients cannot confidently extend it.

The app/data split gives the Lazurio maintainers and clients both freedoms:

- The Lazurio maintainers can improve the reusable product and upstream.
- Clients can adapt their local Mission Control app/code where needed.
- Clients fully own their Organization data and can develop commercially.
- Agents have a concrete source of truth to inspect before acting.

## 13. What not to do

- Do not commit real Organization data to this template.
- Do not put secrets, OAuth state, tokens, passwords, SSH keys, or local caches in Git.
- Do not publish data without reviewing the exact local draft revision and using the native Git publish flow.
- Do not claim a data-repo cutover before parity, rollback, steward approval, and post-cutover monitor evidence exist.
- Do not delete legacy fallback just because the template supports repository-db.
- Do not let a generated view become the source of truth.

## 14. Related docs

- `docs/repository-db-data-boundary.md`
- `docs/doctor-managed-install.md`
- `docs/roadmap-planning-model.md`
- `docs/v3-module-documentation-standard.md`
