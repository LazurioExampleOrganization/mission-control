# Mission Control: rules for agents

This repository is Mission Control, the public upstream
`LazurioTemplates/mission-control` (formerly `Lazurio/mission-control`) and a
template of the Lazurio Marketplace (MIT, fictional data only). Read
[`README.md`](README.md) first. Everything written here is English, every
change is a worktree, a branch and a pull request, and merging is a
Publication on the instruction of a maintainer with live GitHub rights on this
repository.

An Organization that adopted this template keeps this file and adds its own
section at the end ("This Organization's copy"): who reviews, where its data
lives, what it changed. See [`docs/adoption.md`](docs/adoption.md). In that
copy, review and merge follow the Organization's own `AGENTS.md` and the live
rights of its people, not this repository's maintainers.

## What belongs here

- The App code, its Zod schemas, the generated JSON Schemas, the data
  repository template and the documentation.
- Fictional records only, in `templates/sample-data/cs/` and
  `templates/sample-data/en/` (the same records in both languages) and in
  tests: no real
  Organization, person, plan, credential, secret, local host path or private
  link. The Organization identity in `lazurio.module.json`,
  `app/v3/package.json`, `app/v3/config/data-repository.json` and
  `app/v3/src/instance/brand.ts` stays the visibly generic placeholders
  (`REPLACE-WITH-ORG-NAME`, `Organization`). Fictional people
  have international names without diacritics (`alexmorgan`).
- An Organization's real plans live in its own data repository
  (`<Organization>/mission-control-data`, branch `v3`, mounted as `db/`),
  never here.

## How the code is cut

- `app/v3/src/domain/` holds the Zod schemas, the only definition of the
  shape of the data, and pure logic. Types come from `z.infer`; never write a
  second TypeScript type of a record.
- `app/v3/src/data/store.ts` is the storage port. The server and the UI know
  only the port. No YAML path, file read or Git term crosses it.
- `app/v3/src/data/repository-db-store.ts` implements it with
  `@lazurio/repository-db`: reads through `host.read`, writes through
  `host.run` and `writeRecordDraft` with the base revision, files through
  `readDataFile` and `assertDataPath`. Never run Git on the data checkout,
  never keep a second write queue, poll loop or conflict state.
- `app/v3/tests/store-contract.ts` is the shared suite of the port. A change
  of the port's behaviour changes the suite, and every implementation passes it.
- `app/v3/src/data/files.ts` is the one reading and check of records from
  files. The App, `bun run validate` and the data repository's validator all
  run it; never write a second validator. After a change of a schema, a rule
  or `files.ts`, run `bun run schema:export` and commit the regenerated
  `templates/data-repo/schemas/` and
  `templates/data-repo/scripts/mission-control-check.js` in the same pull
  request; `bun run check` fails while they are stale.
- Every text a person sees is in `app/v3/src/i18n/messages.ts`, in Czech
  and in English, never inline in a component or the server. The server and
  the domain return stable codes with English messages for agents; the UI
  words the codes. One screen shows one language.

## Before a pull request

- `cd app/v3 && bun install --frozen-lockfile && bun run check && bun run build`.
- A change the person sees: check it in a browser in both languages with
  `bun run dev:demo` and `bun run dev:demo -- --locale en` (fictional data in
  memory), or `bun run dev` over a data checkout. Never publish an
  Organization's data while testing.
- Versions are exact (no `^` or `~`). A new version of a tool is a release
  of the stack profile (see [`docs/extending.md`](docs/extending.md)), not a
  drive-by change.
- Add a `CHANGELOG.md` entry under "Unreleased".

## Releases

A release is an annotated tag `v<semver>` and a GitHub Release, created only
on the user's instruction. The release version is independent of the App
generation `app/v3`. The Marketplace registry records the full commit of the
tag.
