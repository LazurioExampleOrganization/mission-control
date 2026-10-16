# Mission Control — rules for agents

## Checkout: public upstream or Organization fork

- **Upstream:** `origin` is `Lazurio/mission-control` (public). Preserve
  forkability and privacy: no real Organization data, no private Organization
  or people names, no private repository links, no secrets.
- **Organization fork:** rewrite this file's identity for the Mission Control
  app of that Organization. Concrete plans stay in `mission-control/db` on
  `v3`. Review and merge belong to an authorized person of that Organization
  according to its `AGENTS.md`, not to the upstream maintainers. Procedure:
  Lazurio root `manual/first-client-organization-rollout.md` (Instance
  AGENTS.md).

Publication (merging app code) ends with the question:

> Shall I publish these changes on your behalf? Or shall I ask another
> Colleague to review and publish them?

This repo is a reusable template/upstream. Preserve forkability and privacy.

## Source-of-truth rules

- Reusable Mission Control app/code, schemas, validators, docs, and Doctor install contract belong here.
- Concrete Organization data does **not** belong here: no real roadmap plans, no real issue ledgers, no TODO/DONE histories, no company business data, no personal overlays.
- Use placeholders only in `templates/`; placeholders must be visibly generic.
- Secrets, tokens, OAuth sessions, passwords, webhook secrets, SSH keys and local host paths are forbidden.

## Implementation discipline

1. Before changing schema or runtime, read `README.md`, `docs/repository-db-data-boundary.md`, and `docs/doctor-managed-install.md`.
2. Keep app/code and Organization data separated. If a change needs real Organization data, make that change in the Organization repo instead.
3. Validate with `bun run check` before committing.
4. Changes intended for a concrete Organization rollout must also update the relevant Organization-local Mission Control plan.
5. Record technical blockers in GitHub Issues of the exact owning repository after duplicate and privacy checks. Legacy `ISSUES.*.json` ledgers are read-only history; never create new active records there.
6. Runtime validation executes the pinned app-code validator without Git
   credentials, agent sockets or inherited runtime code-load options;
   environment-key filtering is case-insensitive for Windows portability.
   Never execute code from a mounted data checkout under writer authority.
7. Inbound updates use GitHub repository grants as publication authority.
   Do not reapprove published historical commits in an app-code allowlist.
   Validate the actual target snapshot with the pinned app-code validator and
   exact bundled schemas before importing it; do not apply current schemas
   retrospectively to intermediate history. Never execute data-repo scripts.
   Keep the configured remote/branch anchored in clean HEAD/index control-plane
   blobs with `100644` modes; reject checkout-local routing/command overrides
   and target repository relocation. Reject invalid UTF-8/non-portable or
   case-colliding paths, symlinks, gitlinks, executable domain data and target
   `.gitattributes`/`.gitmodules` before checkout. Ignore rules and inert legacy
   lock files may update, but ignored canonical drafts remain dirty and pull
   must preserve other ignored files with `--no-overwrite-ignore`.
   Use normal Principal Git/SSH credentials only for transport; pinned validation
   remains credential-free. Diff against the merge-base with local HEAD, never
   a mutable cached tracking ref, and merge only the exact verified target.
   Equal/behind targets introduce no new history; local publishes
   still validate before commit/push. Frozen audit history checks remain active.
8. The default `local-principal-v1` writer treats the live GitHub repository
   grants of the current Principal as the only access authority. After the
   exact revision is explicitly confirmed, it creates one validated
   single-parent commit and performs an ordinary non-force fast-forward push to
   `v3` through the Principal's SSH agent or credential-free HTTPS helper. It
   must not require or create a second roster, `provider_access_audit`,
   `approval_roles`, actor capability, `credential_authority`, a GitHub App or
   deploy key, an external receipt or a shadow changeset. A local writer
   failure never switches to another writer mode automatically.
   Commit identity follows native Git precedence (`git var GIT_AUTHOR_IDENT`),
   so an existing local, global or system `user.name`/`user.email` works.
   The write rules are the same regardless of the GitHub plan. A small,
   knowingly trusted Builder team may start in `trusted-process` mode: the
   writer, working discipline and Steward audit hold the ban on force push,
   delete and history rewrite even where the provider does not yet enforce
   it. Before the write circle grows beyond a personally stewardable team, or a
   broad-write external identity or automation is added, the
   Organization Admin moves the Organization to a plan that supports the
   required private branch rules and activates `provider-enforced` mode. That mode technically
   forbids force push, delete and uncontrolled bypass on `v3` while keeping
   ordinary validated fast-forward publication. A missing branch rule in
   `trusted-process` is not permission to break the rule.
   A Hosted Team Workspace may instead explicitly choose
   `github-app-workspace-v1`. It uses the same native Git draft, validation,
   single-parent commit and non-force fast-forward push, but requires a
   credential-free `https://github.com` remote. A standard external Git
   credential helper hands it a fresh short-lived repo-scoped installation
   token for the exact Organization-owned data repository. Mission Control
   does not own, store or embed the helper's GitHub App private key or token,
   and keeps no Admin/Builder roster of its own. GitHub repository grants stay
   the only access authority, and GitHub truthfully attributes the publish to
   the shared Team Workspace App identity as pusher.
9. **Frozen historical audit data:** existing changeset, writer-audit and
   provenance records are immutable history only. The active runtime never
   creates, approves, publishes or changes them, and no historical
   compatibility writer or fallback exists. The standalone validator still
   checks their historical invariants; any removal belongs to a separate,
   reviewed data migration across all Organizations, never to an ordinary
   publish.

## Review routing

- Generic template/app-code changes: keep them forkable; do not copy a
  concrete Organization's business data into this repo. Reviewer is the
  Steward or Admin with live GitHub rights on this template repository.
- Concrete Organization rollout, merge and other Publication follow that
  Organization's `AGENTS.md` and live GitHub rights of the current Principal.
