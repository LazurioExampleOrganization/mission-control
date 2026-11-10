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

### Evidence and links

- A roadmap step's local evidence (`evidence_refs[].path`) is a portable path
  relative to the data repository: `/` between parts, printable ASCII, no
  `.` or `..` part, no absolute path, nothing Windows refuses. The same rule
  holds for the `path` of a plan's or roadmap's `links`.
- The evidence names a file the data repository publishes: it exists with
  exactly that name (letter case counts, as on the Linux runner of a pull
  request), it is a regular file reached only through real directories, it
  does not lie in `.git/`, `.repository-db/` or `generated/`, and Git's
  ignore rules do not leave it out of a commit (`evidence_ignored`). Those
  rules are the `.gitignore` of the root and of every directory on the
  evidence's path and the checkout's `.git/info/exclude` (in a linked
  worktree, the one of its common Git directory). They are matched by
  `app/v3/src/domain/gitignore.ts`, which was written for Mission Control
  from Git's documented behaviour (`gitignore(5)`) and checked against Git
  as a black box; it holds no code from Git. Negation, precedence,
  anchoring, directory-only rules, `**`, brackets (reversed ranges included)
  and the rule that no file is re-included below an excluded directory
  behave as in Git, and where the documentation is silent, Git's observed
  answers decide (the module's comments name them).
  `tests/gitignore.test.ts` is the evidence: every answer it expects comes
  from Git while it runs (`git ls-files --others --exclude-standard`), on
  fixed rules, rule files read line by line, every set against every byte,
  and generated rule files and trees, on Linux and Windows in CI and over
  thousands of generated cases locally (`MC_IGNORE_ROUNDS=<n>`). A rule file
  that is a symbolic link or cannot be read is an issue, never a pass.
- The check decides twice and refuses when either says no: as `git add --all`
  does in this checkout (every rule file on the path, `.git/info/exclude`
  included), and as the check itself will on the checkout of the published
  commit. There only the rule files that commit carries count: a nested
  `.gitignore` that the rules leave out, so that `git add --all` does not
  publish it, cannot let evidence in (the issue names it). The root
  `.gitignore` always counts, and `.git/info/exclude` only here; neither can
  make the published checkout stricter than this one. So evidence that passes
  here is in the published commit and passes there too, which the generated
  trees of the test check by publishing and cloning each one.
- Mission Control 3.x asked for a Git-tracked or staged file instead.
  repository-db validates a publish before it stages the draft with `git add
  --all`, so evidence added in the same draft is neither, and in a pull
  request's checkout every file present is tracked anyway. What does not
  reach a commit is what the ignore rules leave out, so the check reads them
  from the checkout and asks nothing of Git: the App, the validator before a
  publish and CI give one answer. `git check-ignore` is not used: it would
  answer only the first of the two questions (it reads an unpublished nested
  rule file like any other), it needs a Git repository (the seeds and
  `bun run validate -- --data` read plain directories), and the App does not
  run Git on its data checkout. Two consequences: a file or a nested rule file
  once force-added despite a rule counts as left out (re-include it with a
  `!` rule instead), and names are matched case-sensitively, as Git does on
  Linux, where Lazurio Environments and CI publish and check. A machine-wide exclude file
  (`core.excludesFile`) belongs to one person's computer, not to the data
  repository, and is not read.
- Keep new evidence outside `data/mission-control/` (for example in
  `evidence/`): every file there beside the records is the frozen history.
- No URL in a record carries a credential (`app/v3/src/domain/credentials.ts`):
  no user info, no parameter named like a credential (`token`,
  `access_token`, `api_key`, `password`, `secret`, `sig`…), no value shaped
  like a known secret (GitHub, OpenAI and Slack tokens, AWS and Google keys,
  JWTs, private keys, `Bearer …`), also percent-encoded or inside a URL nested
  in a parameter. This holds for evidence URLs, `links`, a plan's pull
  requests and its legacy sources. The rules are those of the 3.x validator.

### The frozen 3.x history

Older data repositories hold the history of Mission Control 3.x beside the
records: `TODO.tasks.json`, `DONE.tasks.json`, `ISSUES.*.json`,
`changesets/`, `import-reviews/` and `reports/`. Mission Control 4.x neither
reads nor writes it. Plan fields that point to it (`todo_outputs`,
`planning_target`, step `todo_refs` and `issue_refs`) are kept and shown,
not resolved.

The history stays exactly as the 3.x validator last accepted it.
`data/mission-control/history.lock.json` names every file of the history with
the SHA-256 digest of its content (line endings read as LF, so a Windows
checkout does not count as a change), and the data check refuses:

- a changed file (`history_changed`), a missing one (`history_removed`);
- any file under `data/mission-control/` that is neither a record, the
  settings, the lock, nor in the lock (`history_added`): nothing new enters
  the history, and nothing else is kept beside the records;
- a symbolic link in the history, and a lock that names a record or is not
  valid (`history_lock_invalid`).

A data repository without a lock has an empty frozen history: the empty start
of `templates/data-repo/` needs none. The lock is written by
`bun scripts/validate.ts --freeze-history` in the data repository, never by
hand (its shape is `schemas/history.schema.json`). A freeze is deliberate: it
prints what it adds, changes or removes, and the change of the lock is
reviewed in its pull request. A freeze refuses to write a lock while any file
or directory of the history, or the previous lock, cannot be read, so a lock
never leaves out what it could not see.

Freezing the bytes instead of re-checking the shape of every ledger and
changeset keeps what the 3.x validator verified (their schemas, the writer
audit and provenance of published changesets) without carrying its 6000
lines into 4.x: a history that cannot change needs no second check of its
shape.

### One check everywhere

`app/v3/src/data/files.ts` reads the data of a data repository and checks
it: the settings, every plan and roadmap against its Zod schema (with the
refinements a JSON Schema cannot express, such as "a done roadmap step names
its evidence", "an executable step names a plan, task or issue", portable
paths and URLs without credentials), the rules across records, the evidence
files and the frozen history, with the engine's YAML parser. The same code
runs in four places:

| Where | How |
| --- | --- |
| the App's data check (Draft & Publish page) | through the storage port, over `db/` |
| `bun run validate` in `app/v3` | over `db/`, or `-- --data <dir>` over any directory laid out like a data repository |
| the data repository's validator, before every publish | `bun scripts/validate.ts`, run by repository-db |
| the data repository's required CI check `validate` | the same command on every pull request |

So a data pull request passes exactly when the App accepts it, and a record
the App would skip cannot be merged. Every issue has a stable `code` and an
English `message`; the App words the code in the page's language. The App
also refuses to save a roadmap whose evidence names no published file.

Reading never leaves the checkout: a symbolic link in any component of a path
(the `data` directory, a record directory, a record, the settings, evidence,
the history, the lock, the check bundle) is refused as an issue and nothing
behind it is read. A file or directory that cannot be read or listed (no
read right, an I/O error) is an issue too (`read_failed`), never a silent
skip: a check that passes has read everything it covers.

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
  for editors and tools in other languages: the plan, the roadmap, the
  settings and the history lock. They describe the shape of one file; the
  refinements, the rules across records, the evidence and the history checks
  live only in the bundle;
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
   scripts/validate.ts]`, `.github/workflows/validate.yml`, `.gitattributes`)
   with the frozen history. Freeze it in that pull request from the history
   as the 3.x validator last accepted it: first check that the branch did not
   change it (`git diff --exit-code origin/v3 -- data/mission-control
   ':!data/mission-control/plans' ':!data/mission-control/roadmaps'` prints
   nothing), then run `bun scripts/validate.ts --freeze-history`, commit
   `data/mission-control/history.lock.json` and run `bun scripts/validate.ts`.
2. An Owner changes the Module's required check from `bun run test
   (ubuntu-latest)` to `bun run check (ubuntu-latest)` in the Organization's
   ruleset (the Windows job is path-filtered and cannot be required), and
   makes `validate`, the job of the new workflow, the required check of the
   data repository's `v3` in place of the 3.x one.
3. Merge the data pull request and the Module pull request right after each
   other, then restart the Module (`lazurio module start`) and publish one
   small change to prove the path.

Pending changesets of the 3.x publish flow are published or dropped before
the window: 4.x does not read them, and once the history is frozen they stay
as they are.
