# Contributing to Mission Control

Mission Control is the reusable app code of Lazurio Organizations, published as the public upstream `Lazurio/mission-control`. Contributions must preserve forkability, client ownership, and the app-code / Organization-data boundary.

## Before changing anything

1. Read `AGENTS.md`.
2. Read `README.md`.
3. Read:
   - `docs/mission-control-v3-operating-manual.md`
   - `docs/repository-db-data-boundary.md`
   - `docs/doctor-managed-install.md`
   - `docs/roadmap-planning-model.md`
4. Decide whether your change belongs in reusable template app/code or in a concrete Organization data repo.

## What belongs here

- reusable schemas;
- validators;
- data adapters;
- publish-flow code;
- generic Doctor/Launchpad contracts;
- generic docs and module standards;
- generic organization-data scaffolds under `templates/`.

## What does not belong here

- real client or Organization roadmaps/plans;
- TODO/DONE histories from a live Workspace;
- private issue ledgers;
- secrets, tokens, OAuth sessions, SSH keys, local caches;
- Organization-specific operational transcripts;
- generated runtime artifacts.

## Validation

Run before committing:

```bash
bun install
bun run check
bun test
```

If you change schemas, adapters, publish flow, docs required by the contract, or Organization data scaffolds, add or update tests.

## Documentation expectations

Every architectural or boundary change should update the relevant doc:

- app/data split: `docs/repository-db-data-boundary.md`;
- install/mount behavior: `docs/doctor-managed-install.md`;
- Roadmap model: `docs/roadmap-planning-model.md`;
- operator/extension rationale: `docs/mission-control-v3-operating-manual.md`;
- reusable v3 module baseline: `docs/v3-module-documentation-standard.md`.

## Review expectations

Generic template changes should be reviewed as reusable product changes. Organization rollout changes must also update the Organization-local Mission Control plan or roadmap that consumes the template.

Do not merge a change that silently changes client write-path semantics, disables fallback, or weakens data publish authorization.
