# Extending Mission Control

An Organization that adopted Mission Control owns its copy and changes it
freely. Two things keep the copy healthy: changes within the App generation
stay behind the storage port, and the code moves only along the planned
steps below. Lazurio Marketplace templates allow exactly two kinds of
change to their stack: a **generation move** (the data layer changes) and a
**stack profile release** (tool versions change). Anything else is a patch
release with a security fix.

## Changes within generation v3

- **A new field or record rule.** Change the Zod schema in
  `app/v3/src/domain/`; the TypeScript type follows by itself. Add a new field
  as optional so existing records stay valid, or ship a migration of the data
  in the same release. Run `bun run schema:export` and copy the regenerated
  `templates/data-repo/schemas/` into the Organization's data repository in a
  pull request of its own.
- **A rule across records** belongs to `app/v3/src/domain/rules.ts`, with a
  test in `tests/domain.test.ts`.
- **A new operation on the data** is a method of the storage port
  (`app/v3/src/data/store.ts`) named by the domain (`archivePlan`, not
  `moveFile`), implemented in every store and covered by
  `tests/store-contract.ts`. The server and the UI call only the port.
- **A new page** is a React component in `app/v3/src/ui/pages/` and a route in
  `routes.ts`; it calls only the HTTP API (`app/v3/src/ui/api.ts`).
- **Look and feel.** `app/v3/src/instance/` is the Organization's overlay:
  `brand.ts` and `theme.css` (which may omit the grid layer). Keep shared
  styling in `src/ui/styles.css` and `src/design-system/`.

Run `bun run check` and `bun run build` in `app/v3` before every pull request.

## Taking a template release

Later releases of the template arrive as merges, never as copies, rebases or
squashes. The release that was adopted is an ancestor of the Organization's
`main` (see [`adoption.md`](adoption.md)), so Git knows what the Organization
changed and what the template changed.

```bash
git fetch https://github.com/LazurioTemplates/mission-control.git "refs/tags/<tag>"
test "$(git rev-parse 'FETCH_HEAD^{commit}')" = "<commit from the release notes or registry>"
git switch -c take-<tag> origin/main
git merge --no-ff <commit>
```

- Resolve conflicts hunk by hunk. The Organization's identity
  (`lazurio.module.json`, `lazurio.runtime` ids, `config/data-repository.json`,
  `src/instance/`, its `AGENTS.md` section) stays the Organization's; the rest
  usually takes the template's side.
- Read the release's `CHANGELOG.md` section: when the schemas changed, the data
  repository gets the regenerated `schemas/` (and any migration) in a pull
  request of its own, merged together with the Module's.
- `bun install --frozen-lockfile && bun run check && bun run build`, then a
  pull request. Merging it is the person's Publication.

## Stack profile releases

The template follows the stack profile [`app-data`](https://github.com/Lazurio/LazurioPlatform/blob/main/docs/stack-profiles.md#app-data)
(release 2026.11): exact versions of
Bun, TypeScript, Vite, React, Biome, Zod, repository-db and module-kit
(see `app/v3/package.json`). A **stack profile release** moves those versions
together, for example `app-data@2026.11` to `app-data@2027.05`: one template release that
updates `packageManager`, the exact versions, `bun.lock`, the CI's Bun and, if
the formatter changed, reformats once. Organizations take it by merging its
tag like any other release. Between profile releases only patch versions with
a security fix change.

Planned profile releases already known: Vite+ is reconsidered when it
supports Bun as a runtime and its formatter reaches 1.0; Biome's YAML and
Markdown formatting stays off until a profile release turns it on.

## The move to generation v4 (Dolt)

Generation v4 keeps the data in a Dolt database in the Organization's services
Environment instead of a Git data repository. The move is planned, reviewed
and reversible:

1. **A new App beside the old one.** Create `app/v4/` from `app/v3/`:
   `src/domain/`, `src/server/`, `src/ui/` and `tests/store-contract.ts` are
   copied unchanged. Add `src/data/dolt-store.ts`, the storage port over Dolt
   (Kysely 0.29.8 and mysql2 3.24.6 per the profile `app-database`), and SQL migrations
   derived from the Zod schemas (`migrations/0001_init.sql`, …). Plans and
   roadmaps are flat records with a stable code, so they map to rows; nested
   lists become their own tables.
2. **Draft & Publish stays the same for people.** A draft is the person's
   working set or branch, publishing is `DOLT_COMMIT` with the author and
   a summary, the review comes from Dolt's diff tables, and the card is the
   same `DraftPublishPanel` fed with the same view model. This mapping is to
   be proven on a prototype before the first v4 release.
3. **The same tests.** `tests/store-contract.ts` runs against Dolt in CI, with
   a pinned `dolt sql-server`. A store that passes the suite replaces the v3
   store without a change to the server or the UI.
4. **Moving the data.** `bun run migrate:v3-to-v4` reads every record through
   the v3 store, validates it with the same Zod schemas, writes it to Dolt and
   makes one `DOLT_COMMIT` naming the source commit of the v3 data. It proves
   the counts and a round trip of every record.
5. **Switching.** `lazurio.module.json` lists both Apps; `default_app` moves
   to `app/v4/package.json` only on the decision of the Organization's Steward
   or the person. `app/v3` stays as the way back until that decision is
   final; a Module keeps at most two generations.

Open before the first v4 template: how Lazurio passes the Dolt address and
credentials to the App without an `.env` file (a Platform question).

Do not confuse the two meanings of "v4": the App generation `app/v4` (Dolt)
and a repository-db data branch named `v4`. Write "App generation" and "data
branch".

### Generation v5 is a setting, not a generation

An Organization with several servers keeps Dolt hosted outside one server.
That is the same `app/v4` code, schemas and migrations with different
connection settings (host, TLS, credentials, database and branch names). There
is no `app/v5`.
