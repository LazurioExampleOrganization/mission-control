# Security policy

Mission Control is intended to be forked or instantiated into client-owned commercial Workspaces. Treat every template change as something that could be copied into a real Organization environment.

## Never commit

Do not commit any of the following:

- API keys, OAuth credentials, refresh tokens, passwords, SSH keys or private keys;
- local `.env` files or secret manager exports;
- customer data, private roadmap data, private issue ledgers or operational transcripts;
- local runtime caches, browser profiles, session state or logs with credentials;
- real hostnames/paths that reveal private client infrastructure unless they are already public and intentionally documented.

## Data write safety

### Default: `local-principal-v1`

The default local writer treats live GitHub repository grants as the only
access authority. After the current Principal explicitly confirms the exact
displayed draft revision, one publish may create one validated single-parent
commit and send one ordinary non-force fast-forward update to `v3` through the
Principal's SSH agent or credential-free HTTPS helper.

It must fail closed unless:

- the data repo is clean and on the expected branch;
- it is not diverged from its remote;
- the effective credential-free GitHub remote matches the committed
  `repository-db.yaml` control plane;
- `git -c user.useConfigOnly=true var GIT_AUTHOR_IDENT` resolves an explicitly
  configured identity through normal Git local/global/system precedence;
- the exact confirmed `draft_revision`, base HEAD and allowed domain-data paths
  still match under the repository write lock;
- the pinned app-owned validator passes without Git credentials;
- the resulting commit has exactly one parent equal to transaction start;
- the remote starts at the verified base and accepts the ordinary
  fast-forward push.

The default writer must not require or create `provider_access_audit`,
`approval_roles`, actor capability, `credential_authority`, a GitHub App,
deploy key, external commit receipt or shadow changeset. A local-writer failure
never falls back to a second writer.

### Hosted profile: `github-app-workspace-v1`

The hosted Team Workspace profile uses the same reviewed native Git draft,
validator, single-parent commit, non-force fast-forward push, rollback and
history-freeze engine as the default profile. Its committed remote must be a
credential-free `https://github.com` URL.

Authentication belongs to a standard external Git credential helper. The
helper may obtain a fresh, short-lived installation token scoped to the exact
Organization-owned data repository and expose it only to the Git child
process. Mission Control must not own the GitHub App private key, persist a
token, embed credentials in the remote, or add a parallel Admin/Builder
roster, `credential_authority`, `approval_roles` or `local_principal` block.
GitHub repository grants remain the sole access authority and the GitHub App
identity is the truthful pusher of a shared Team Workspace publish.

Helper refusal, token expiry or repo-grant revocation must make the next
fetch or push fail closed without a Mission Control fallback. Revocation does
not claim to terminate an already-running Agent job; it prevents the next Git
operation from obtaining valid repository access.

The write rules do not change with the GitHub subscription. In a small,
explicitly trusted Builder circle on GitHub Free, the writer constrains its own
publication to an ordinary non-force fast-forward push. GitHub Free may not
technically prevent a trusted member from rewriting a private branch through a
different client, so the remaining boundary is explicit team discipline plus
detective Steward review of Git history and actor attribution.

This is the documented `trusted-process` stage, not provider enforcement.

Before write access expands beyond a personally stewardable circle, or is
granted broadly to an external identity or automation, the Organization Admin
must upgrade to a plan that supports the required private branch rules and
enable `provider-enforced` protection. The `v3` rule must block force
pushes, deletion and uncontrolled bypass while preserving validated ordinary
fast-forward publication. Missing provider enforcement never relaxes the
workflow.

### Frozen historical audit data

Older changeset, writer-audit and provenance records are retained solely as
immutable audit history. The active runtime does not create, approve, publish,
supersede or authorize through them, and it does not ship a second writer
runtime or credential boundary.

Do not edit, delete, move or reinterpret these records to make a new publish
pass. The standalone data validator continues to verify their existing
invariants until a separate, reviewed data migration can prove that every
Organization no longer needs them. New Organizations keep the audit
directories empty, and `publish_policy.writer_mode` must be one of the two
reviewed native Git profiles: `local-principal-v1` or
`github-app-workspace-v1`.

Freshness and pull are read paths, but they still cross a repository trust
boundary. Before fetch, remote and branch are read from the committed HEAD
`repository-db.yaml`; both control-plane files must match HEAD and index, and
the effective `origin` fetch URL must match that trusted remote. Inherited
repository/URL/command transport overrides, checkout-local routing/filter
commands and hooks must not be allowed to redirect Git or run during
preflight. The local lane invokes Git from the Principal's `PATH` and uses
their normal SSH and credential-helper configuration. Repository-routing environment and
checkout-local command overrides remain rejected. HEAD and index blobs and `100644` modes
match exactly; the working-file comparison normalizes CRLF without invoking
checkout filters so a clean Windows checkout remains portable. Fetch must use the
validated literal URL outside the mutable checkout config, the configured
branch must pass Git's complete branch-name validation with `HEAD` reserved,
and the transfer plus bundle create/import path must share one bounded
deadline. A push-only URL mismatch may remain as an intentional write guard and
must not block read-only pull.

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

Publish validation always executes the pinned app-code validator, resolves its
dependencies from the independently installed `app/v3` package, and removes
Git authentication metadata, SSH/GPG agent paths and inherited Node code-load
options. Never execute code from the data checkout under writer credentials.

## Reporting issues

For template-maintainer work, report security concerns through the relevant repository owner. For a client Workspace, report through the client's agreed support/security channel.

If a secret is committed, rotate it outside Git first, then remove it from the repository history according to the owning Organization's incident process. Do not paste the secret into PR comments, chats, or issue bodies.
