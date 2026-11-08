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

### One check everywhere

`app/v3/src/data/files.ts` reads the records of a data repository and checks
them: the settings, every plan and roadmap against its Zod schema (with the
refinements a JSON Schema cannot express, such as "a done roadmap step names
its evidence" and "an executable step names a plan, task or issue"), and the
rules across records, with the engine's YAML parser. The same code runs in
four places:

| Where | How |
| --- | --- |
| the App's data check (Draft & Publish page) | through the storage port, over `db/` |
| `bun run validate` in `app/v3` | over `db/`, or `-- --data <dir>` over any directory laid out like a data repository |
| the data repository's validator, before every publish | `bun scripts/validate.ts`, run by repository-db |
| the data repository's required CI check `validate` | the same command on every pull request |

So a data pull request passes exactly when the App accepts its records, and a
record the App would skip cannot be merged. Every issue has a stable `code`
and an English `message`; the App words the code in the page's language.

Reading never leaves the checkout: a symbolic link in any component of a path
(the `data` directory, a record directory, a record, the settings, the check
bundle) is refused as an issue and nothing behind it is read.

### What 4.x does not read

Older data repositories may hold `TODO.tasks.json`, `DONE.tasks.json`,
`ISSUES.*.json`, `changesets/`, `import-reviews/` and `reports/`. Mission
Control 4.x neither reads nor changes them; they stay as history. Plan fields
that point to them (`todo_outputs`, `planning_target`, step `todo_refs` and
`issue_refs`) are kept and shown, not resolved.

## The data repository

`templates/data-repo/` is the data repository an adopting Organization starts
from ([`adoption.md`](adoption.md)):

- `repository-db.yaml`: the engine's configuration, with `validate: [bun scripts/validate.ts]`;
- `scripts/validate.ts`: the validator repository-db runs before every
  publish, and `scripts/mission-control-check.js`, the App's check
  (`files.ts`) as one dependency-free bundle **generated** by
  `bun run schema:export`. `bun run check` fails when the bundle is stale, and
  the tests prove the validator reports exactly what the App reports;
- `schemas/*.schema.json`: JSON Schemas **generated** from the Zod schemas,
  for editors and tools in other languages. They describe the shape of one
  record; the refinements and the rules across records live only in the
  bundle;
- `data/mission-control/mission-control.config.json` with a placeholder
  prefix `ORG`, which the Organization replaces;
- `.github/workflows/validate.yml`, the CI job `validate` that runs the
  validator on every pull request and every push to `v3`; an Owner makes it a
  required check of `v3`;
- `.gitattributes` marking the generated files, so a review collapses them.

`templates/sample-data/cs/` and `templates/sample-data/en/` hold the same
fictional example records in Czech and in English (four plans, one main
roadmap, the same codes, states, dates and people) for the "example plans"
start and for `bun run dev:demo`.

## Data repositories of other Organizations

Adoption never copies another Organization's data repository, not even the
fictional one of an example Organization:

- a release pins code and its seeds in one commit (`templates/`), so an
  Organization gets exactly the records that release was tested with, while
  another Organization's data keeps changing on its own;
- copying a data repository would carry that Organization's history, ledgers
  and identities into another Organization.

## A data repository of Mission Control 3.x

Its records validate unchanged (`bun run validate -- --data <checkout>`), but
its control plane cannot stay as it is once the Organization takes 4.x:

- From 4.0 the App publishes through repository-db, which runs the
  repository's own `validate` command before every publish. The 3.x command,
  `node scripts/validate-mission-control-data.mjs`, imports `ajv` and `yaml`,
  which a data checkout does not have, so every publish is refused ("Data
  porušují pravidlo datového repozitáře. Nic se nepublikovalo.").
- The App's CI check was renamed from `bun run test (ubuntu-latest)` to
  `bun run check (ubuntu-latest)`. A Module ruleset that requires the old
  name blocks the update; one that requires the new name blocks every 3.x
  pull request.

So the move happens in one short, coordinated window, with nothing published
in between:

1. Prepare two pull requests and keep both green: the Module's merge of the
   release tag, and the data repository's control plane (`scripts/` with the
   check bundle, `schemas/`, `repository-db.yaml` with `validate: [bun
   scripts/validate.ts]`, `.github/workflows/validate.yml`, `.gitattributes`).
2. An Owner changes the Module's required check from `bun run test
   (ubuntu-latest)` to `bun run check (ubuntu-latest)` in the Organization's
   ruleset (the Windows job is path-filtered and cannot be required), and
   makes `validate`, the job of the new workflow, the required check of the
   data repository's `v3` in place of the 3.x one.
3. Merge the data pull request and the Module pull request right after each
   other, then restart the Module (`lazurio module start`) and publish one
   small change to prove the path.

Pending changesets of the 3.x publish flow are published or dropped before
the window: 4.x does not read them.
