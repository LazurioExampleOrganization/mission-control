# Mission Control v3 Rollout Manual

> **Current default:** trusted Builders publish through their own live GitHub
> write grant. No `provider_access_audit`, roster scope, approval-role pairing,
> actor field, shared credential or changeset audit is required. The writer
> validates the exact draft and performs one ordinary non-force fast-forward
> push to `v3`. Historical audit files remain read-only and never gate a new
> rollout.
>
> The workflow is invariant across GitHub plans. A small trusted team may begin
> in `trusted-process` mode, where the writer and Steward audit uphold the same
> no-force-push/no-delete/no-rewrite rules. Before the write circle stops being
> personally stewardable or broad write is granted to an external identity or
> automation, the Organization Admin upgrades to a plan with the required
> private-branch controls and enables `provider-enforced` mode without changing
> the Builder workflow.

This manual takes a new Organization from an empty checkout to a running Mission
Control v3 instance with the full draft/publish/pull coordination flow. It is
written so a client technical team or an AI colleague can complete the rollout
without prior context, following the steps in order.

Mission Control v3 is the **reference implementation** of the binding v3 UI
contract: every v3 application that reads and writes a repository-db data repo
must expose a global draft indicator with a **Publikovat** (Publish) action and
a safe **pull** mechanism (see the Lazurio lifecycle manual,
`manual/workspace-module-version-lifecycle.md`). This manual shows how those
surfaces behave in practice.

## 0. What you are rolling out

Two repositories work together:

- **App/code** (this template, cloned as the Organization's Mission Control
  app). Reusable, no business data.
- **Data repo** (`mission-control-data`, the Organization's own private repo).
  Holds plans, roadmaps, ledgers, reports, and the changeset audit trail. It is
  **mounted** into the app at runtime, never copied in.

The app never writes business data directly. The first-client
`local-principal-v1` pipeline is **prepare local draft → review exact revision
→ Publish changes**. No auto-publish, and no auto-pull over a dirty working
tree.

## 1. Install (app/code)

1. Clone the Organization's Mission Control app repo (created from this
   template) onto the operator machine.
2. Instantiate the explicit root `package.json` mode:

   - set `companyascode.mission_control.mode` to `organization`;
   - replace its Organization slug and display name;
   - rename the root package to `<lowercase-slug>-mission-control`;
   - set the `app/v3` package name to
     `@<lowercase-slug>/mission-control-v3`;
   - bind `lazurio.module.json.company` and `lazurio.runtime.company` to the
     exact Organization slug and the runtime ID to
     `<lowercase-slug>-mission-control-v3`;
   - allocate the module's single `main` lease from the Organization-local
     allocation pool. The runtime package references that lease and does not
     own a numeric port.

3. Install dependencies at the repo root and in `app/v3` after changing both
   package names. Bun then records the concrete Organization identities in both
   lockfiles:

   ```sh
   bun install
   bun install --cwd app/v3
   ```

4. Run the mode-aware structural checker before the data mount exists:

   ```sh
   node scripts/check-template.mjs
   ```

5. After completing the data mount and app-root config in section 2, verify the
   complete app:

   ```sh
   bun run check
   bun run test
   ```

   `check` runs the mode-aware structure check, Organization data validation,
   and typecheck. `test` runs the template unit tests plus the `app/v3` suite
   (including the concurrent-writer pull smoke). The app suite intentionally
   uses bundled `DEV` fixtures in every mode; root `test` invokes `check` first
   so this isolation can never skip validation of the real Organization mount.

## 2. Mount the data repo (repository-db)

Mission Control resolves its data root from a mounted repository-db checkout —
not from a path baked into the app. There are two supported mount shapes; the
app auto-detects which one is present (`app/v3/src/paths.ts`):

- **Standalone data repo**: the Organization's `mission-control-data` checkout
  is itself the runtime root (`repository-db.yaml` + `data/mission-control/…`
  at its top level).
- **Mounted under the app**: the data checkout lives at `<app>/db/` (this path
  is gitignored by the app so business data never lands in the app repo).

In a normal Organization install, Launchpad prepares and starts the App as a
Lazurio Module (Lazurio Module Standard, decision 0171). Preparation is
declared in `app/v3/package.json → lazurio.preparation`: `prepare:app` builds
the client once (`dist/`), `check:prepared` is the read-only readiness check
(`src/prepared.ts`: self-contained, exits non-zero while `dist/index.html` is
missing). `scripts/check-template.mjs` runs it in a disposable copy and
requires exactly that behaviour, no writes and a prompt exit.
Start is `app/v3` `dev` = `bun run src/server.ts`: one Bun process that serves
the built client and `/api/*` on the `web` listener. Launchpad runs only
`lazurio.runtime.dev_script` (`dev`, no `preview_script`); other package
scripts such as `dev:client` are developer conveniences it never runs.
Launchpad injects
`LAZURIO_RUNTIME_LISTENER_WEB_HOST` and `LAZURIO_RUNTIME_LISTENER_WEB_PORT`
from the exact `main` lease; the server reads them through
`@lazurio/module-kit`; every start configuration error (missing listener,
non-loopback host, invalid hosted origin) exits 2. It never reads the
lease file, `PORT` or another fallback. The server
accepts requests only from a fixed startup `Host`/`Origin` allowlist derived
from that loopback listener. On a hosted workspace VM (decision 0146) the app is
served at `https://mission-control.<vm>.<organization>.lazurio.io/` behind a
gateway that forwards the original `Host`; there Launchpad additionally injects
`LAZURIO_RUNTIME_LISTENER_WEB_EXTERNAL_ORIGIN` with exactly that absolute
`https` origin (no path, no trailing slash) and the server adds its host and
origin to the same allowlist. The bind stays loopback-only. The variable is
absent (or empty) in the local profile; an invalid value (non-`https`, path,
credentials, uppercase or non-DNS hostname) stops the server at startup instead
of widening the allowlist. SIGTERM stops the server and exits 0.

Start the App through Lazurio (`lazurio module start <Org>/mission-control`).
For direct development, prepare once and start the App package with the
listener of the module lease; in an Organization checkout the data root
defaults to the app repo with its mounted `db/`:

```sh
cd app/v3
bun run prepare:app
LAZURIO_RUNTIME_LISTENER_WEB_HOST=127.0.0.1 \
LAZURIO_RUNTIME_LISTENER_WEB_PORT=<lease port> \
bun run dev
```

`bun run dev:client` (second terminal) rebuilds the client on change; reload
the page to see it. For the template checkout or another explicit topology,
also set both data roots in the operator environment, for example
`MISSION_CONTROL_ROOT=<template>/templates/organization-data` and
`MISSION_CONTROL_WORKSPACE_ROOT=<template>`. If the lease is occupied, inspect
the owning process and the local runtime. Do not scan for another free port,
add an ambient `PORT` fallback, or kill an unrelated listener. Launchpad may
replace the same module's managed main/worktree process automatically. A
different Organization requires confirmation of the exact peer shown by
Launchpad before its valid static lease can authorize takeover.

The data repo must satisfy the repository-db contract:

- `repository-db.yaml` with `data_repo.remote` set to the Organization's
  `mission-control-data` git remote and `data_repo.branch` (default `v3`).
- `package.json` declares the `ajv` and `yaml` dependencies used by the complete
  plan validator. A mounted checkout normally resolves them from the installed
  parent app. For a standalone data checkout, run
  `npm install --ignore-scripts --no-package-lock`; `node_modules/` is ignored.
- `data/mission-control/mission-control.config.json` with
  `data_mode: repository-db` and the real `organization_admin` identity.
- The app-root `mission-control.config.json` also declares
  `data_mode: repository-db` after client cutover. If `mission-control/db` is
  then missing or incomplete, startup fails with a mount blocker instead of
  silently reading template or in-tree data.
- Keep `MISSION_CONTROL_WORKSPACE_ROOT` at the Organization root so planning
  paths remain Organization-relative. In repository-db mode, ledger discovery
  still reads only the four canonical configured paths from the data mount and
  ignores frozen root mirrors.
- `organization_admin` is canonical for new data repos. The runtime accepts
  legacy `workspace_admin` only as a backward-compatible fallback.
- Před initial commitem validuj prázdný seed přes exact validátor z připnutého
  app-code SHA s `--pinned-app-code --allow-unborn-bootstrap`. Tento
  jednorázový režim přijme jen nikdy necommitnutý repozitář bez changeset
  audit recordů. Po prvním commitu už nepoužívej bootstrap flag
  `--allow-unborn-bootstrap` a nepřidávej jej do `repository-db.yaml`, CI ani
  běžného validačního příkazu; instancovaný
  repozitář bez zdravého `HEAD` pak musí failovat zavřeně.
- After the initial seed, treat `mission-control.config.json` and
  `repository-db.yaml` as control-plane policy. Migrate them in a dedicated PR
  with explicit Organization Admin approval, old/new validation, no unrelated
  domain data and a rollback. Never widen the ordinary changeset writer so it
  can edit its own policy.
- The data checkout is a real git clone whose effective `origin` fetch and push
  URLs both match `data_repo.remote` without local routing overrides, on the
  configured branch.
- Before every writer activation, verify that no merge, rebase, sequencer,
  cherry-pick, revert or bisect is in progress. Writer readiness checks this
  independently of porcelain and accepts only a new commit with one parent
  equal to the transaction start.
- Ensure native Git resolves the current Principal's ordinary commit identity.
  Local, global and system Git configuration follow standard precedence:

  ```sh
  git -C /path/to/mission-control-data var GIT_AUTHOR_IDENT
  ```

  The publish process ignores executable hooks in the checkout's default
  `.git/hooks/` directory and rejects local command/routing overrides.

Confirm the mount is healthy by opening the **Publish** page in the UI, or by
calling the status endpoint:

```sh
curl -s http://127.0.0.1:5293/api/repository/status | jq '.status | {clean, currentBranch, remoteMatches, commitIdentityConfigured}'
```

`remoteMatches: true`, `commitIdentityConfigured: true` and `clean: true` mean
the mount is ready. Status and error diagnostics redact credentials embedded in
HTTPS remote URLs.

## 3. GitHub identita a repository grants

Publishing uses a supported native Git writer profile. **No private key,
token, writer ID, role claim or copied roster belongs in app config, HTTP
payload or the data repo.** Native Git `user.name` and `user.email` provide
commit presentation metadata; GitHub authenticates the actual pusher and
accepts or rejects the update from live repository grants.

`local-principal-v1` supports two GitHub transports (decision 0102): an SSH
`git@github.com` remote using the current Principal's standard SSH
config/keys/agent, or a credential-free
`https://github.com` remote authenticated by the Principal's Git credential
helper from the OS credential store — on Windows typically Git Credential
Manager with OAuth sign-in. A plaintext credential in the remote URL remains
forbidden.

1. In GitHub, inspect the exact private `mission-control-data` repository and
   grant write access to every trusted Builder who may contribute. GitHub
   membership, Teams, repository grants and pusher attribution are the only
   access roster and audit; do not copy them into Mission Control.
2. Keep `publish_policy.writer_mode: local-principal-v1`, the exact
   credential-free GitHub remote and branch `v3`. Do not configure
   `provider_access_audit`, `approval_roles` or `credential_authority`.
3. Ensure `git -c user.useConfigOnly=true var GIT_AUTHOR_IDENT` resolves the
   current Principal's explicitly configured identity from normal
   local/global/system Git config. Verify the provider login under
   that same OS account:
   `ssh -T git@github.com` for the SSH transport, or a signed-in Git
   Credential Manager (`git credential fill` returns the Principal's own
   GitHub username) for HTTPS.
4. Restart Mission Control. `/api/repository/status` must report
   `writer.local_principal_ready: true`; a rejected GitHub push is the truthful
   evidence that the current identity lacks live write access.
5. Record the current enforcement mode. On a small GitHub Free team use
   `trusted-process`: absence of a provider rule is a known governance risk,
   never permission to force-push, delete or rewrite `v3`. Organization Admin
   owns the upgrade. Before the write circle expands beyond personal Steward
   oversight or broad write reaches an external identity/automation, move to a
   plan that supports the required private-branch rules and enable
   `provider-enforced`: block force push, branch deletion and uncontrolled
   bypass while keeping validated ordinary fast-forward publication working.

The process-local HTTP token only prevents blind calls from another website;
it is not organizational identity. GitHub accepts or rejects the push under
the SSH credential actually loaded in the Principal's agent.

### Hosted Team Workspace: `github-app-workspace-v1`

Use this profile only in a shared Hosted Team Workspace that already supplies
the reviewed Lazurio for GitHub credential helper:

1. Configure `publish_policy.writer_mode: github-app-workspace-v1` and an exact
   credential-free `https://github.com/<owner>/<repo>.git` data remote. SSH,
   embedded credentials and non-GitHub hosts fail closed.
2. Keep the broker, App private key, installation ID, Team membership and repo
   allowlist outside Mission Control. The external helper must mint a fresh,
   short-lived token for this exact repository and return it only through the
   standard Git credential protocol.
3. Configure the Team Workspace's explicit Git commit name and email. Commit
   presentation metadata does not authorize a push; GitHub records the actual
   pusher as the App installation identity.
4. Restart Mission Control. `/api/repository/status` must report
   `writer.writer_ready: true`. A broker refusal, expired or revoked repo grant,
   malformed helper response or rejected push is the truthful access result.
5. Prove immediate revocation by removing the disposable repository grant and
   observing the next freshness or publish operation fail without a process
   restart; then restore only the reviewed grant. Do not infer that a running
   Agent job stopped.

This is not a second writer engine or a Mission Control IAM. It is the same
native Git transaction with a different standard credential source.

### Frozen historical audit data

Existing changeset, writer-audit and provenance files remain read-only. The
active runtime does not create or transition them, and there is no historical
compatibility writer or fallback to configure. Keep the directories empty for
a new Organization; retire old fleet data only through a separate reviewed
migration.

## 4. Daily flow: draft → Publikovat → pull

The global draft indicator sits in the top-right corner on **every** page. It is
silent when there is nothing to do (no unpublished draft, no newer data).

### See your draft

When a local draft exists or the data working tree is dirty, the indicator
lights up:

- **Draft** — the data working tree has unpublished changes.
- **Ke schválení** (Pending) — a local draft is waiting for review/publish.
- **Novější data** (Newer data) — a colleague published; newer data is
  available to pull.
- **Konflikt** (Conflict) — the repo is on the wrong branch or local and remote
  have diverged; publish and pull are blocked until you resolve it by hand.

### Publish (Publikovat)

V obou nativních writer profilech **Připravit draft** uloží operace jen pod Git
metadata. UI ukáže přesné cesty, obsah a `draft_revision`. **Publikovat**
vyžádá potvrzení této konkrétní revize, znovu ověří čistý checkout, exact
remote HEAD a připnutý validátor, potom vytvoří jeden commit a provede běžný
non-force push pod GitHub identitou odpovídající zvolenému profilu.

Tlačítko **Zahodit draft** odstraní pouze lokální draft; Git historii ani
kanonická data nemění. Raw dirty working tree není draft tohoto writeru
a publikaci blokuje.

### Pull (stáhnout novější data)

Freshness may show **Novější data**. In either native writer profile, the
session-protected pull route may perform an explicit fast-forward pull through
the configured native Git credential path. Its data-integrity contract is
**fail-closed**:

- It only fast-forwards. If your local branch has moved too (divergence), pull
  refuses and asks for a manual merge.
- It refuses on a dirty working tree and separately while any local writer
  draft exists, so it can **never overwrite or silently invalidate a draft**.
  Publish or discard your draft first.
- Before any fetch it reads remote and branch from committed HEAD
  `repository-db.yaml`, requires both control-plane files to match HEAD/index,
  verifies that the effective `origin` fetch URL equals that trusted remote
  and checks that checkout-local Git config cannot redirect the repository,
  worktree, hooks, filters or command transport. The validated URL is stored
  in a mode-restricted config in an
  isolated temporary bare repo, fetched by remote name and imported without
  re-reading checkout transport config or exposing the URL in argv.
  Control-plane blobs and `100644` modes must match HEAD/index exactly. The
  default local lane uses the Principal's normal Git from `PATH`, SSH
  config/agent and credential helpers; repository-local routing or command
  overrides remain blocked. Git's complete branch-name
  rules apply (`HEAD` is reserved), and fetch, inbound diff gate and bundle
  creation/import share one bounded deadline.
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

- The local HEAD, not a mutable pre-existing tracking ref, anchors the inbound
  diff. Pull always performs the isolated fetch boundary and merges its exact
  verified commit id; status-only `fetch:false` cannot authorize a merge.
- A requested fetch failure blocks pull even if an older cached tracking ref
  already advertises a newer commit.
- A deliberate `remote.origin.pushurl=/dev/null` guard does not block pull;
  publish remains blocked until its stricter fetch-and-push boundary is ready.
- There is no silent `reset --hard` and no auto-pull.

The server detects newer data with a bounded, non-interactive `git fetch`.
Repository-routing environment overrides and checkout hooks stay disabled,
while the local lane intentionally uses the Principal's ordinary Git/SSH
configuration. The UI
polls freshness on an interval and offers a manual refresh on the Publish page
(*Zkontrolovat čerstvost*).

## 5. Roadmap creation flow (Roadmaps → Publish)

The **Roadmaps** page can produce a valid draft YAML, but canonical truth
changes only after the current Principal explicitly confirms the exact
native repository draft and GitHub accepts its normal push.

1. Open **Roadmaps**.
2. In **Draft Roadmap from Plan**, enter an existing `source_plan` such as
   `DEV-0001` (or the Organization-local plan code). Optional fields:
   `title`, `owner`, and `summary` override the values derived from the source
   plan.
3. Click **Připravit roadmap draft**. The UI must show:
   - new roadmap code (`RM-XXXX`),
   - repository-db path (`data/mission-control/roadmaps/<year>/RM-XXXX-...yaml`),
   - generated YAML,
   - validation `OK`,
   - `write_applied=false`.
4. Use the emitted repository-db path and YAML as one local writer operation.
   Review the exact path/content and `draft_revision` on **Repository
   publish**, then click **Publikovat změny** and confirm that exact revision.
   Do not add actor, role, writer ID, provider audit or credential authority.
5. Confirm the final state:
   - **Repository publish** shows `Data repo: clean`, branch and remote match,
     and `ahead=0 behind=0`;
   - `origin/v3` contains exactly one new single-parent commit with the roadmap
     path and no shadow changeset/audit record;
   - the validator pinned at
     `<mission-control-app-code>/templates/organization-data/scripts/validate-mission-control-data.mjs`
     passes with the data repo as its working directory;
   - `GET /api/roadmaps` (or the Roadmaps page after refresh) includes the new
     roadmap with `validation.ok=true` and a traceable next step.

This flow is the required smoke for Organization cutover: do not mark roadmap
creation as complete from a hand-written YAML file or local-only commit alone.

Historical audit records shown on the Repository page are read-only. Do not
edit, delete, approve or supersede them as part of the daily flow.

## 6. Coordinating multiple AI colleagues

Several colleagues can work the same data repo through their own running
instances. The coordination contract:

- Each instance reviews an exact local draft revision and publishes it through
  one validated native Git commit and push to the shared remote.
- Other instances see the new commit within the freshness poll interval as
  **Novější data** and pull it safely (fast-forward).
- If two colleagues both have local commits, pull surfaces a **Konflikt** and
  stops — a human or a designated steward resolves the merge by hand.

This is exercised by the automated concurrent-writer smoke test
(`app/v3/tests/repository-pull.test.ts`): writer A publishes, writer B sees
newer data and fast-forward pulls; the dirty-draft and divergence cases assert
that pull stays fail-closed.

## 7. Smoke suite

Run these against the template fixtures (no real remote needed) or an
Organization instance:

```sh
# Full template + app suite incl. pull + concurrent-writer smoke:
bun run test

# App suite only, with the template data mount:
export MISSION_CONTROL_ROOT="$PWD/templates/organization-data" MISSION_CONTROL_WORKSPACE_ROOT="$PWD"
cd app/v3 && bun test tests

# Targeted coordination smoke only (from app/v3, env exported as above):
bun test tests/repository-pull.test.ts
bun test tests/repository-freshness-api.test.ts
```

On a real Organization instance, confirm the active boundary against the live
mount:

1. Open **Publish**, click *Zkontrolovat čerstvost* — expect `clean` and either
   up-to-date or a safe newer-data state.
2. Verify `writer.writer_ready: true` with the exact GitHub remote, branch and
   a configured commit identity. The compatibility field
   `writer.local_principal_ready` is true only for the local profile.
3. Prepare a small local draft. Verify the UI shows the
   exact path, content, base commit and `draft_revision`.
4. Click **Publikovat změny**, confirm the displayed revision, then verify one
   new single-parent commit and exact `origin/v3` HEAD. No pending/published
   shadow changeset, copied roster or external receipt is created.
5. From a second checkout, publish another valid change, then use the first
   instance's explicit freshness/pull action and confirm fast-forward.
6. Run the **Roadmap creation flow** above for a disposable test roadmap, then
   remove/archive that test data through another explicitly confirmed publish if the
   Organization does not want to keep it.

## 8. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Draft indicator never appears | Data repo not mounted, or `MISSION_CONTROL_ROOT` not set | Mount the data repo (section 2) and set the env vars; the indicator is silent when the mount is unavailable. |
| `local_writer_config_invalid` | `local-principal-v1` carries a parallel `credential_authority`, unsupported writer metadata or an invalid GitHub remote | Remove the parallel authority/metadata and restore the reviewed credential-free GitHub remote. Do not add a local ACL. |
| `github_app_writer_config_invalid` | `github-app-workspace-v1` carries `credential_authority`, `approval_roles` or `local_principal` metadata | Remove the parallel Mission Control authority/roster. Keep GitHub installation grants and the external credential helper as the only access path. |
| `github_app_https_remote_required` | The hosted writer remote is SSH, contains credentials, targets another host or is malformed | Restore the exact credential-free `https://github.com/<owner>/<repo>.git` remote. |
| `writer_mode_unsupported` | `writer_mode` is not one of the supported native profiles | Select `local-principal-v1` or `github-app-workspace-v1`; there is no fallback writer. |
| `invalid_local_session` / `forbidden_host` / `forbidden_origin` | UI tab is stale or request did not come through the fixed local origin; on a hosted VM, `LAZURIO_RUNTIME_LISTENER_WEB_EXTERNAL_ORIGIN` is missing or does not equal the public `https://mission-control.<vm>.<organization>.lazurio.io` origin | Reload the local UI. On a hosted VM, fix the Launchpad-injected external origin and restart the app. Do not widen the allowlist from request headers and do not disable the session guard. |
| `draft_changed` | Draft content or base HEAD changed after the displayed revision | Refresh the draft, review the new exact diff/revision and confirm again. |
| `remoteMatches: false` on Publish | Effective `origin` fetch/push URL does not equal `repository-db.yaml` `data_repo.remote`, or local/global Git config rewrites or overrides repository routing | Remove the conflicting `pushurl`, `insteadOf`/`pushInsteadOf`, include, hook, worktree or transport override and make both effective URLs match the configured remote; publish is blocked until they do. |
| `commitIdentityConfigured: false` | Git cannot resolve a concrete `user.name` or `user.email` | Configure the current Principal's identity in normal Git config, typically with `git config --global user.name` and `git config --global user.email`. |
| Publish fails: uncommitted changes | Data working tree is dirty | Reconcile the edits, then prepare a clean local draft through the Repository page. |
| Publish fails: remote divergence | Local and remote both moved | Pull (fast-forward) or resolve the merge, then publish. |
| Pull refused: `fetch_control_plane_untrusted` | Local `repository-db.yaml` or `mission-control.config.json` differs from committed HEAD/index, or trusted HEAD config is invalid | Restore/commit the reviewed control-plane first. Fetch never uses a locally co-edited remote or branch. |
| `github_remote_required` | `local-principal-v1` is configured with a remote that is neither the `git@github.com` SSH remote nor a credential-free `https://github.com` remote (or the URL embeds a username/PAT) | Configure the reviewed GitHub Organization remote — SSH for the agent path, or HTTPS for the Git Credential Manager path. Never embed a PAT or service credential in the URL. |
| `ssh_identity_unresolved` | The native SSH probe did not return the GitHub account greeting for the current identity | Run `ssh -T git@github.com` as the same OS user, repair the normal SSH config/agent/known-hosts login, and retry. Do not replace the provider-bound `principal_id` with Git commit metadata. |
| `credential_helper_unavailable` | HTTPS remote is configured, but the Principal's normal Git credential flow could not provide a credential | Sign in with the Principal's own GitHub account through Git Credential Manager (Windows default) or the platform OS keychain helper, then retry the same ordinary Git flow. |
| `provider_identity_unresolved` | The credential helper probe did not return a valid GitHub username (for example it returned a token-like username such as `x-access-token`) | Re-authenticate Git Credential Manager with the Principal's own GitHub account (OAuth sign-in), not a PAT-style credential, and retry. |
| Pull refused: `fetch_remote_mismatch` | Effective `origin` fetch URL differs from `repository-db.yaml`, or checkout-local Git routing/command config could redirect it | Restore the configured fetch URL and remove local URL/include/hook/worktree/upload-pack/transport overrides. A push-only `remote.origin.pushurl=/dev/null` may remain. |
| Pull refused: `fetch_inbound_schema_incompatible` | Target schemas differ from the installed app version | Install the matching reviewed app version; do not edit schemas or manufacture historical approvals. |
| Pull refused: `fetch_inbound_routing_changed` | Target attempts to relocate the configured data repository or branch | Review the relocation as an explicit installation change. |
| Pull refused: `fetch_inbound_git_behavior_unsupported` | Target contains Git attributes or submodule instructions | Remove these from the data update through the owning repository review flow; the automatic lane does not execute Git behavior supplied by data. |
| Pull refused: `fetch_inbound_case_collision` | Remote tree contains paths differing only by case or a non-canonical case alias of a control-plane file | Rebuild/revert the remote commit with one canonical portable path. A different app version cannot make these paths portable. |
| Pull refused: `fetch_inbound_unsafe_tree_entry` | Remote tree contains a symlink, gitlink, non-portable path or executable domain-data file | Rebuild/revert the commit with regular portable non-executable data blobs. |
| Pull refused: `fetch_inbound_validation_failed` | Fetched snapshot fails the pinned Mission Control data validator | Fix/revert the invalid remote data. The local tracking ref and working tree have not moved. |
| Pull refused: `fetch_inbound_history_untrusted` | Remote history no longer contains the trusted local HEAD baseline | Stop automation, audit the force-push or replacement history and re-seed the checkout/trust anchor manually. |
| Pull refused: `fetch_required` | Volající vyžádal jen status bez čerstvého izolovaného fetch | Spusťte běžnou freshness/pull akci; cached tracking ref sám není merge autorita. |
| Pull refused: `dirty_working_tree` | You have an unpublished local draft | Publish or discard the draft; pull never overwrites local work. |
| Pull refused: `local_draft_present` | A local writer draft exists under Git metadata | Review and publish it, or explicitly use **Zahodit draft**. Pull does not silently invalidate its base revision. |
| Pull refused: `diverged` | Local commits the remote does not have | Merge by hand; fast-forward is not possible. |
| Freshness shows `fetch: chyba/timeout` | Network down, missing credential, slow remote, or inbound trust gate rejection | Fetch is bounded and non-interactive; retry only after the cause is resolved. Local/cached state remains visible, but pull is fail-closed and is never advertised as safe from stale tracking data. |
| Write or pull reports an active `mission-control-write.lock` | Another publish, discard or pull transaction is running, or its process crashed | Read the reported lock payload and path. If the recorded PID is running, wait. If it is inactive, inspect `git status`, local HEAD and `origin/v3`. Preserve and reconcile any dirty, ahead or already-published state before removing a stale lock. |
| Publish flow reports missing/empty `protected_paths` | The data repo has an incomplete or obsolete write policy | Restore a concrete Organization-approved list such as `data/mission-control/**`, validate the data repo, and review the policy before retrying. |
| Validátor odmítá historický changeset nebo nedostupnou historii | Frozen audit record nebo jeho canonical Git history byly změněny či nejsou dostupné | Záznam neupravuj. Obnov non-shallow kanonickou historii bez replacement refs/grafts a řeš případnou migraci samostatným reviewovaným fleet-wide plánem. |
| Roadmap draft path starts with the workspace path | Copy the `repository path` value, not `workspacePath` | Publish operations require paths relative to the repository-db root (`data/mission-control/...`). |
| Mission Control listener cannot bind | The declared `main` lease is occupied or the injected listener differs from it | Inspect the local lease owner. Correct the declaration, let Launchpad replace the same module's managed instance, or explicitly confirm the exact peer before a cross-Organization takeover; never scan, silently fall back, or add a second API port. |

## 9. Related contracts

- `docs/mission-control-v3-operating-manual.md` — full operator/administrator
  manual.
- `docs/repository-db-data-boundary.md` — why data lives outside app/code.
- `manual/workspace-module-version-lifecycle.md` (Lazurio root) — the
  binding v3 UI contract that this instance implements.
- Lazurio decision 0101 — local Principal writer under GitHub identity;
  decision 0035 (summarized in the Lazurio root `manual/decision-register.md`)
  remains the legacy/hosted approval model.
