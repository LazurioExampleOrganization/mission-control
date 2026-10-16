# Mission Control docs

This directory is the source-of-truth documentation layer for reusable Mission Control v3 app/code, repository-db data boundaries, Doctor install semantics, and external-agent operation.

## Start here

1. [`mission-control-v3-operating-manual.md`](mission-control-v3-operating-manual.md) — full operator/administrator/extension manual for Mission Control v3.
2. [`mission-control-v3-rollout-manual.md`](mission-control-v3-rollout-manual.md) — step-by-step rollout for a new Organization: install → mount db → native Git readiness → daily draft/publish/pull flow → troubleshooting.
3. [`repository-db-data-boundary.md`](repository-db-data-boundary.md) — why Organization data lives outside reusable app/code and how the repository-db boundary works.
4. [`doctor-managed-install.md`](doctor-managed-install.md) — how Doctor should install, verify, and refuse unsafe silent cutovers.
5. [`roadmap-planning-model.md`](roadmap-planning-model.md) — reusable Roadmap / Roadmap Priority / Roadmap Step model.
6. [`v3-module-documentation-standard.md`](v3-module-documentation-standard.md) — documentation baseline expected for every reusable GEN3 v3 module.

## Documentation boundary

This repo documents reusable Mission Control behavior and template contracts. Concrete Organization data belongs in the Organization's `mission-control-data` repository or its local Workspace repo, not here.

If a doc needs a concrete Organization or client example, keep the example generic unless it is a public/product-safe pattern. Do not paste real plans, private ledgers, customer data, local host paths, secrets, or operational transcripts into template docs.
