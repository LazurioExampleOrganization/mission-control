# Organization Mission Control data template

This directory is copied into an Organization-owned `mission-control-data` repository and mounted at:

```text
<Lazurio root>/organizations/<Organization>_GEN3/mission-control/db/
```

The checkout must be nested under the Organization-local `mission-control/` app repo so ownership is visible from the filesystem path. Do not use a root-level sibling checkout such as `Lazurio/repos/<org>-mission-control-data` as the canonical runtime mount.

The app/code lives in the Doctor-managed Mission Control app-code checkout (upstream `Lazurio/mission-control`). The data repo owns the Organization truth:

- `repository-db.yaml` — upstream repository-db `repository-db.config.v1` app/data boundary
- `AGENTS.md` — portable write, bootstrap, review and validation guardrails for standalone clones
- `.github/workflows/checks.yml` — self-contained validation on the data repository's own `v3` branch; no cross-repository credential
- `package.json` — dependency contract for complete YAML + JSON Schema validation
- `data/mission-control/mission-control.config.json` — plan prefix, schema references and canonical `organization_admin` identity
- `schemas/` — prefix-agnostic plan/roadmap schemas plus strict, secret-free
  local publish evidence and legacy authenticated writer/provenance schemas; the runtime
  binds plan identity to the concrete `plan_prefix`
- `data/mission-control/roadmaps/` — Organization roadmaps
- `data/mission-control/plans/` — Organization plans
- `data/mission-control/reports/` and `data/mission-control/import-reviews/` — evidence and import review artifacts
- `data/mission-control/ISSUES.open.json`, `data/mission-control/ISSUES.resolved.json`, `data/mission-control/TODO.tasks.json`, `data/mission-control/DONE.tasks.json` — execution ledgers
- `generated/` — deterministic generated views only
- `scripts/validate-mission-control-data.mjs` — repository-db validate hook for the empty data scaffold

## Instantiation rules

1. Create the private Organization repository as `<Org>/mission-control-data`.
2. Use branch `v3` as the default data branch for this generation.
3. Replace placeholders in `repository-db.yaml` and `data/mission-control/mission-control.config.json` before running the Organization data validator; an unreplaced admin identity fails closed.
   Před úplně prvním commitem smí provisioning jednorázově spustit přesnou
   kopii validátoru z připnutého app-code SHA s argumenty
   `--pinned-app-code --allow-unborn-bootstrap`. Výjimka přijme jen
   prokazatelně nikdy necommitnutý instancovaný repozitář bez jediného
   changeset audit recordu. Po initial commitu odeber bootstrap flag
   `--allow-unborn-bootstrap`; běžný validate/CI jej nikdy nepoužívá a
   chybějící `HEAD` nebo historie pak vždy blokují.
4. Set `organization_admin` to the real Organization Admin identity. New data repos must not use the legacy `workspace_admin` key; the app reads it only as a compatibility fallback for older repositories.
5. Set `plan_prefix` to 2–6 uppercase letters. The generic schema accepts that range, while runtime validation requires both `dev_code` and `id` to use the configured prefix and correspond to each other.
6. Keep `publish_policy.protected_paths` concrete and non-empty. The scaffold protects `data/mission-control/**`; removing or emptying the list blocks canonical writes and pending/published/superseded audit writes.
7. Keep `ajv` and `yaml` resolvable for `node scripts/validate-mission-control-data.mjs`. A normal mounted install resolves them from the parent Mission Control app. For a standalone data-repo checkout, run `npm install --ignore-scripts --no-package-lock`; `node_modules/` is ignored so validation does not dirty the data repo.
8. Keep the default `writer_mode: local-principal-v1` with a github.com remote:
   either `git@github.com` through the Builder's SSH agent or credential-free
   `https://github.com` through an OS credential helper. For a shared Hosted
   Team Workspace, use `writer_mode: github-app-workspace-v1` with only an
   exact credential-free `https://github.com` remote. The external reviewed
   Lazurio for GitHub helper supplies fresh short-lived exact-repository tokens
   through the standard Git credential protocol. Plaintext PATs are never a
   fallback.
9. Configure the explicit Git `user.name` and `user.email` appropriate to the
   profile. The local profile uses the current Builder's normal Git config and
   credential path. The hosted profile uses the Team Workspace commit identity
   and external repo-scoped helper; it does not store an App private key, token,
   installation metadata, Team roster or allowlist in Mission Control. GitHub
   live grants accept or reject every ordinary push.
10. Never store OAuth/session files, credentials, tokens, host-specific caches or personal runtime state.
11. During compatibility rollout, existing in-tree Mission Control YAML may
    remain readable, but all new writes go directly to this data repo. Root
    mirrors and cross-repository parity jobs are not an authorization or
    synchronization lane.
12. After bootstrap, changes to `mission-control.config.json` or `repository-db.yaml` use a dedicated control-plane migration PR with explicit Organization Admin approval, old/new validation and rollback evidence. Do not allow the ordinary changeset writer to modify its own policy.
13. Direct local publish creates no parallel changeset audit record. The
    single-parent Git commit, native Git author identity and GitHub pusher
    attribution are the active audit trail. Older changeset, writer-audit,
    provenance and quarantine records remain immutable historical data; the
    standalone validator keeps their strict schema and lineage checks, while
    the active runtime never creates or advances them.
