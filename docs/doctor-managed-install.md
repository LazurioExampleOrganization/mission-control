# Doctor-managed install contract

Mission Control should be visible to an Organization through Doctor, but Doctor must not blur app-code and data ownership.

## Target install shape

New GEN3 Organizations install Mission Control as two repositories:

```text
<Lazurio root>/
  organizations/
    <Organization>_GEN3/
      mission-control/          # gitignored nested app-code fork
        app/v3/                 # reusable runtime from this template
        db/                     # gitignored nested repository-db data checkout
          repository-db.yaml
          data/mission-control/...
```

The app-code fork is physically inside the Organization so the filesystem path itself identifies ownership. A root-level sibling checkout such as `Lazurio/repos/<org>-mission-control` may only be temporary cache/staging, never the canonical Doctor/Launchpad runtime path.

The app-code fork keeps these remotes:

- `origin=<Org>/mission-control`
- `upstream=Lazurio/mission-control` (public upstream; integrate a released `vX.Y.Z` tag)

## Windows toolchain

A Windows install needs `bun`, `node`, `gh` and `git` available in a new
terminal after setup, and `bun x --help` must prove package execution through
that exact Bun. A separate `bunx.exe` is not part of the runtime contract.
Bun's bin directory and the GitHub CLI bin directory may live in the per-user
`PATH`; Node.js LTS may also be installed per-user. Restart the terminal or
desktop agent after changing `PATH`, because an already running process keeps
its previous environment snapshot.

The data checkout is `<Org>/mission-control-data` on `branch v3`, mounted at `mission-control/db`, and validated through `repository-db.yaml` plus `data/mission-control/mission-control.config.json`.

Launchpad may cold-install dependencies only for the independently runnable
`app/v3` package. Runtime modules imported from the app-code repository root
must therefore resolve their third-party dependencies through `app/v3`; a
second root `node_modules` installation is not a Launchpad runtime
precondition. Root development and template validation commands may still
install the root package separately.

The `app/v3` `lazurio.runtime.v1` inventory declares `required_module_slots:
["mission-control/db"]`, while root `lazurio.module.json` owns its single
`main` TCP lease. Launchpad must therefore report the app as not ready
and refuse to spawn it while the Organization manifest keeps the data slot at
`planned_slot` or while an active slot is missing locally. This readiness gate
does not authorize cloning or activating the data repository.

## Responsibilities

Doctor may:

- clone or update the Mission Control app-code repo (upstream `Lazurio/mission-control`) when an Organization opts into the template
- verify expected `origin` and `upstream` remotes for the app-code fork
- verify the app branch, clean state, package scripts, `app/v3` health endpoint,
  runtime inventory, and exact module-owned listener lease
- verify that the Organization `mission-control-data` mount exists at `mission-control/db` and passes repository-db status/validate
- verify that the pinned app-code validator resolves `ajv` and `yaml` through
  the independent `app/v3` install; a standalone data-repo validator may
  instead use its data-local ignored `node_modules/`
- verify `writer_mode`, a concrete non-empty `publish_policy.protected_paths`,
  the exact GitHub data remote/branch and native Git commit identity;
  GitHub repository grants remain the only access authority
- verify that native Git resolves a concrete `user.name` and `user.email`
  through its normal local/global/system precedence; publish must fail before
  mutation when either is missing

- verify `repository-db.yaml` uses `repository-db.config.v1`, `data_repo.branch: v3`, and `layout: { data, generated, scripts }`
- report which Mission Control app-code checkout, data repository, data branch and local mount the local Launchpad is reading
- reject a hidden second listener, numeric runtime-package port, ambient `PORT`
  fallback, or Vite proxy/server port; UI and API share the module's one lease

Doctor must not:

- commit or publish Mission Control data without repository-db publish semantics
- track secrets, OAuth sessions, tokens, host-local absolute paths or runtime state
- silently convert an Organization from in-tree compatibility mode to data-repo mode
- centralize roadmap truth in the Lazurio root
- commit anything under `mission-control/db`
- rely on global Git identity, checkout hooks, or command-capable local Git
  transport overrides for repository-db publish
- vytvářet druhý roster, approval-role ACL nebo provider-audit bránu vedle
  živých GitHub repository grants
- předávat credential loopback HTTP serveru jen na základě Origin/localhost
  guardu nebo vytvářet runtime autoritu z CLI argumentů, request JSON či
  environment metadata

## no-live-data guard

Template validation must fail closed when reusable code/docs contain concrete Organization state. The upstream template may contain generic placeholders such as `<Org>`, `<Organization>`, `REPLACE_WITH_ORG_NAME`, and `REPLACE_WITH_ORG_SLUG`; it must not contain real company rollout data, named people, GitHub reviewer accounts, local home paths, OAuth material, tokens, or live Mission Control ledgers outside `templates/organization-data` placeholders.

The no-live-data guard is a template gate, not a substitute for review. Reviewers should still inspect diffs for accidental data imports, especially after copying code from an Organization fork back into the template.

## Fork-sync workflow

1. In the Organization app-code repo, keep `origin=<Org>/mission-control` and `upstream=Lazurio/mission-control`.
2. Fetch upstream before applying template updates: `git fetch upstream --tags` and pick the released tag to integrate (or `main` for an unreleased fix).
3. Merge the upstream template update into the Organization branch according
   to that Organization's PR policy. After the first authenticated lifecycle
   evidence exists, never rebase or force-rewrite app-code history: recorded
   application commits must remain ancestors of the deployed `HEAD`.
4. Resolve conflicts in app-code only. Do not resolve conflicts by copying Organization data into app-code.
5. Re-run app checks, repository-db status, and Launchpad health checks.
6. Keep `mission-control/db` untouched except for Doctor/repository-db clone or validation operations.

## First rollout modes

1. `compatibility` — existing in-tree Mission Control data, template docs and validators only.
2. `hybrid` — template app-code with repository-db data mount, legacy YAML paths still readable.
3. `data-repo` — repository-db data checkout is the write boundary; compatibility paths are generated/read-only or retired by explicit plan.

Every Organization must declare its current mode in its own Mission Control plan before changing mode.
