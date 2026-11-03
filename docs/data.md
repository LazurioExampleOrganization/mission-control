# Data

Mission Control keeps no data in this repository. Each Organization keeps its
plans and roadmaps in its own data repository, `<Organization>/mission-control-data`,
on branch `v3`, checked out as `db/` at the Module root and managed by
[repository-db](https://github.com/Lazurio/repository-db) v3.2.6.

## Records

| Record | File | Schema (Zod, `app/v3/src/domain/`) |
| --- | --- | --- |
| Settings | `data/mission-control/mission-control.config.json` | `config.ts`: `plan_prefix`, optional `organization_admin`; other keys are ignored |
| Plan | `data/mission-control/plans/<year>/<month>/<CODE>-<slug>.yaml` | `plan.ts`: `companiesascode.mission_control.plan.v2` |
| Roadmap | `data/mission-control/roadmaps/<year>/<CODE>-<slug>.yaml` | `roadmap.ts`: `companiesascode.mission_control.roadmap.v1` |

These are the layouts and record versions every v3 Mission Control data
repository already has, so the App reads existing data repositories unchanged.
A new record gets its folder from its `created_at` and its file name from its
code and title; an edited record keeps its file. The engine writes stable
YAML (sorted keys), so the first edit of an older record reorders its keys once.

### Rules across records

`app/v3/src/domain/rules.ts` checks what one record's schema cannot: unique
codes, the id that follows from a code (`EX-0007` → `mcplan-ex-0007`), the
Organization's prefix, file names, a roadmap's source plan and step
references, at most one main roadmap, no archived main roadmap, and step
timing that does not end before it starts. The App refuses a save that breaks
a rule about the saved record; `bun run validate` reports every problem of the
data checkout.

### What 4.0 does not read

Older data repositories may hold `TODO.tasks.json`, `DONE.tasks.json`,
`ISSUES.*.json`, `changesets/`, `import-reviews/` and `reports/`. Mission
Control 4.0 neither reads nor changes them; they stay as history. Plan fields
that point to them (`todo_outputs`, `planning_target`, step `todo_refs` and
`issue_refs`) are kept and shown, not resolved.

## The data repository

`templates/data-repo/` is the data repository an adopting Organization starts
from ([`adoption.md`](adoption.md)):

- `repository-db.yaml`: the engine's configuration, with `validate: [bun scripts/validate.ts]`;
- `schemas/*.schema.json`: JSON Schemas **generated** from the Zod schemas
  (`bun run schema:export`). `bun run check` fails when they are stale;
- `scripts/validate.ts`: the validator repository-db runs before every
  publish. It has no dependencies (Bun parses the YAML), reads only the
  checkout, refuses symbolic links and checks the shape of every record, unique
  codes and file names. A test proves it agrees with the Zod schemas;
- `data/mission-control/mission-control.config.json` with a placeholder
  prefix `ORG`, which the Organization replaces;
- a CI workflow that runs the validator.

`templates/sample-data/` holds fictional example records (four plans, one main
roadmap) for the "example plans" start and for `bun run dev:demo`.

## Relation to `LazurioExampleOrganization/mission-control-data`

`LazurioExampleOrganization/mission-control-data` (branch `v3`) is the data
repository of the Example Organization's own running Mission Control: its
fictional plans, task ledgers and history. It is **not** part of the template
and adoption never copies it:

- a release pins code and its seeds in one commit (`templates/`), so an
  Organization gets exactly the records that release was tested with, while
  the Example Organization's data keeps changing on its own;
- copying that repository would carry the Example Organization's history,
  ledgers and identities into another Organization.

The Example Organization's data repository validates against these schemas
unchanged (`bun run validate` over a checkout of it). Moving it to the
generated schemas and `bun scripts/validate.ts` is a separate pull request in
that repository, after this release; until then its own validator stays.
