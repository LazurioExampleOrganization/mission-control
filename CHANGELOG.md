# Changelog

## Unreleased

## 4.1.0 — proposed, not released

Mission Control speaks Czech and English and says what it is for, and the
data repository now enforces exactly what the App enforces. This release
carries the fixes from the first adoption of 4.0.0 into an Organization; an
Organization still on 3.x takes 4.1.0 directly.

### For people

- **What Mission Control is for**, at the top of the overview, in an empty
  Organization and a busy one alike: plans with a goal and acceptance
  criteria, roadmaps over time, who works on what, and Draft & Publish. An
  empty Organization is told how to start (its first plan here or from an
  agent in Chat).
- **Czech and English.** Every screen, message and data issue in both
  languages, one language per screen; dates and periods in the page's
  language (`6. 11. 2026`, `6 Nov 2026`). Czech is the default.
- **Who works on what**: a plan's proposed tasks show their assignee, and a
  roadmap shows the agents doing its work, its reviewers and its escalation.
- **The plan editor keeps what you type**: a space at the end of a list item
  and a new line for the next item are no longer removed while typing; the
  text becomes items when the plan is saved.
- **The draft review names only real changes**: a field whose value did not
  change is no longer listed because the engine wrote its keys in another
  order on the first edit of an older record (#18). Changed lists read
  "1 položka", "3 položky", "5 položek".

### For Organizations and agents

- **The language** comes from Lazurio: the `locale` of the shell document
  `/.lazurio/shell.json` on the App's origin, else the language the server
  was started with (`bun run dev:demo -- --locale en`), else Czech. Lazurio
  does not yet relay that document on a Module's origin
  ([LazurioPlatform#909](https://github.com/Lazurio/LazurioPlatform/issues/909)),
  so a hosted Module shows Czech until it does; the App's server answers 404
  for `/.lazurio/*` so the client never waits for its own page. Texts live in
  `app/v3/src/i18n/messages.ts`; API refusals and data issues carry stable
  codes (`RuleIssue.code`, `params`) with English messages for agents.
- **Draft & Publish card** in both languages: Mission Control renders
  repository-db's `deriveDraftPanel` itself, so the engine still decides the
  state, the actions and what can be returned; its Czech equals the shared
  card's (`tests/draft-card.test.ts`). `GET /api/draft?locale=cs|en` words the
  changed records. The shared card returns once repository-db speaks English
  ([repository-db#40](https://github.com/Lazurio/repository-db/issues/40)).
- **One check of the data everywhere** (`app/v3/src/data/files.ts`): the
  App's data check, `bun run validate` and the data repository's validator
  run the same Zod schemas with their refinements, the same rules across
  records and the same YAML parser. The data repository gets it as a
  generated, dependency-free bundle,
  `templates/data-repo/scripts/mission-control-check.js`, which
  `bun run schema:export` builds and `bun run check` keeps current. A done
  roadmap step without evidence, an executable step without a plan, task or
  issue, or a step naming an unknown plan no longer passes a data pull
  request that the App then refuses or skips.
- **No symbolic links**: the check refuses a link in any component of a path
  (the data directories, a record, the settings, the bundle) and reads
  nothing behind it.
- **`bun run validate -- --data <dir>`** checks any directory laid out like a
  data repository, such as a worktree of a data pull request, without the
  data checkout's branch check (#17).
- **Example data in both languages**: `templates/sample-data/cs/` and
  `templates/sample-data/en/`, the same records with assignees and a roadmap
  lane; `dev:demo` serves one by `--locale`. Marketplace screenshots per
  language in `docs/screenshots/cs/` and `docs/screenshots/en/`.
- **Adoption**: the tag check compares the peeled commit
  (`git ls-remote … "refs/tags/<tag>^{}"`); the data pull request is checked
  with the data repository's own validator (#17); the sample start takes the
  person's language.

### Adopting 4.1.0

- **From 4.0.0**: merge the tag ([`docs/extending.md`](docs/extending.md)).
  The data repository takes the new `scripts/validate.ts`,
  `scripts/mission-control-check.js`, `.gitattributes` and `README.md` and
  `AGENTS.md` of `templates/data-repo/` in a pull request merged right before
  the Module's. Records do not change. `templates/sample-data/data/` moved to
  `templates/sample-data/en/data/`.
- **From 3.x**: one short, coordinated window, described in
  [`docs/data.md`](docs/data.md) ("A data repository of Mission Control
  3.x"): the data repository's new control plane (validator and check
  bundle, schemas, `repository-db.yaml`, workflow), the renamed required
  check of the Module (`bun run test (ubuntu-latest)` → `bun run check
  (ubuntu-latest)`) and the data repository's required check `validate` in
  the Organization's ruleset, and the Module's merge, right after each other.
  The 3.x validator cannot stay: 4.x publishes through repository-db, which
  runs it, and it needs packages a data checkout does not have (#16).

## 4.0.0 — 2026-11-03

Mission Control becomes the first template of the Lazurio Marketplace: the
App is rebuilt on the stack profile `app-data@2026.11` and on the
repository-db engine, and the repository carries what an Organization needs to
adopt it. The release is a draft until it is tagged on the publisher's
instruction.

### For people

- Overview with plans by state, the main roadmap, its next steps and the
  plans under way; roadmaps with priorities and steps grouped by period; plans
  with every section, the roadmaps they are on, an edit form and a form for a
  new plan with the next code of the Organization's prefix.
- Draft & Publish is the shared card of repository-db: the changed records in
  business language (changed fields named in Czech), publish all, return one
  record or all, finish a send, take colleagues' work. A data check lists any
  record that breaks a schema or a rule.

### For Organizations and agents

- **Data through the engine.** The App reads and writes its data only through
  `@lazurio/repository-db` v3.2.6 (sync host, `writeRecordDraft` with base
  revisions, review adapter). The own Git pull and publish flow
  (`src/mission-control-pull.mjs`, `src/mission-control-publish-flow.mjs`,
  local changesets, writer audit) is removed, and with it the `.mjs` sources
  outside `app/` that broke MS-08 and MS-09.
- **A storage port.** `app/v3/src/data/store.ts` is the only way the server
  reaches data; `tests/store-contract.ts` is its shared test suite, passed by
  the repository-db store and a memory store, and later by a Dolt store (v4).
- **Zod is the only definition of the data.** Plan, roadmap and settings
  schemas live in `app/v3/src/domain/`; the hand-written types and the
  hand-written JSON Schemas are gone. The JSON Schemas of the data repository
  are generated (`bun run schema:export`) and checked for staleness.
- **Existing data repositories are read unchanged**: the same layout under
  `data/mission-control/` and the same record versions (`plan.v2`,
  `roadmap.v1`). Task ledgers, issue ledgers and changesets are no longer read.
- **Data repository template** (`templates/data-repo/`) with a
  dependency-free validator (`bun scripts/validate.ts`) over the generated
  schemas, and fictional example records (`templates/sample-data/`).
- **One gate:** `bun run check` runs the type check, Biome, the schema
  staleness check, the seed validation and the tests; CI runs it with
  `bun run build`.
- **Stack:** Bun 1.4.4, TypeScript 7.0.2, Vite 8.3.5, React 19.3.1,
  Biome 2.6.4 (spaces, width 100, reformatted once), Zod 4.6.7,
  `@lazurio/module-kit` v0.2.0; every version exact. `ajv` and `yaml` are no
  longer dependencies of the App.
- **Module Standard:** one App package (`app/v3`), no package at the Module
  root; `dev` and `start` run one Bun server (a development run bundles the
  client itself, a production run serves `LAZURIO_RUNTIME_BUILD_OUTPUT` or
  `dist/`); health is `/healthz`; the preparation installs nothing and builds
  nothing; writes are accepted only as JSON from the App's own origin.
- `bun run dev:demo` serves the fictional example records from memory.
- Documents: `docs/adoption.md`, `docs/extending.md`, `docs/data.md`, and
  Marketplace screenshots in `docs/screenshots/`.
- **License:** still MIT; the copyright holder in `LICENSE` is now "Lazurio
  contributors" (formerly "MissionControlTemplate contributors").
- **Source:** the repository moved from `Lazurio/mission-control` to
  `LazurioTemplates/mission-control`, the publisher of the Lazurio Marketplace
  templates. GitHub redirects the old path for Git and the web, and the tags
  v3.0.0 to v3.1.0 and their Releases moved with it; a 3.x fork should still
  point its `upstream` remote to the new path.

### Removed

Agent work, proposals, the work board and planning coverage pages, TODO
export, plan code reservations, issue resolution, the Doctor-managed install
contract, the root `package.json`, `templates/organization-data/` and
`templates/launchpad-app/`. They depended on the removed publish flow or on
task ledgers outside the record model; each can return as a feature of the
storage port.

### Adopting 4.0.0 from 3.x

*Corrected in 4.1.0:* replacing the data repository's validator is not
optional and cannot follow later. 4.0.0 publishes through repository-db,
which runs the 3.x validator and is refused, and the App's required CI check
was renamed. Take 4.1.0 instead, in the coordinated window of
[`docs/data.md`](docs/data.md) ("A data repository of Mission Control 3.x").

An Organization that runs a 3.x fork takes 4.0.0 by merging its tag
([`docs/extending.md`](docs/extending.md)). Its data repository needs no
migration of its records. Pending local changesets of the old publish flow
must be published or dropped before the merge: 4.0.0 does not read them.

Before the merge, check that every Environment of the Organization runs a
LazurioPlatform release that knows `start_script` and `build_output` (v0.1.11
or newer): an older release refuses the unknown keys and does not start the
App. The Organization's identity (`lazurio.module.json`, the `lazurio.runtime`
ids, `app/v3/config/data-repository.json`, `app/v3/src/instance/`, its
`AGENTS.md` section) stays its own while the rest takes the template's side.
After the merge, `app/v3` is the only App package; the root `package.json`,
`bun.lock`, `config/`, `schemas/`, `src/`, `scripts/`, `test-support/` and
`mission-control/` of 3.x are gone.

## 3.1.0 — 2026-11-01

Main roadmap and approximate step timing, plus cheaper continuous
integration. The roadmap schema changes, so an Organization adopts this
release in one short window for its app and its data repository (see
"Adopting 3.1.0" below).

### Main roadmap and approximate step timing

- A Roadmap Step may carry an optional `timing`: `to` (and optionally `from`)
  as a calendar month `YYYY-MM` or a quarter `YYYY-Qn`, plus an optional
  `confidence` of `committed`, `likely` or `tentative`. `from` must neither
  start nor end after `to`.
- A roadmap may set `main: true`. At most one roadmap in an Organization data
  repository carries it, and an archived roadmap cannot.
- Both fields are optional, so existing roadmaps keep validating. The app
  validator, the pinned data validator, the roadmap and step drafts and the
  roadmap schema enforce the same rules.
- New first sidebar entry **Hlavní roadmapa**: the main roadmap as a quarter
  timeline with step states, the next planned step and click-through to the
  plans, their pull requests and issues. On a phone it is a list by landing
  quarter with the current quarter marked. Without `main: true` the page
  shows the only roadmap, otherwise the one in progress or the first active
  one, and says that no main roadmap is designated.
- Order comes from the timing and the step order in the file; there is no
  second ordering store.
- The dry-run roadmap execution report without a roadmap code starts from the
  main roadmap.
- Creating a step draft no longer writes empty ref arrays that the schema
  rejects.
- The step draft on the Roadmaps page edits the selected step. It loads that
  step's own `plan_refs` and timing, and an update sends them only when they
  changed. Before, it always sent the next step's `plan_refs`, so changing only
  another step's timing silently replaced that step's plan references. The
  stand-in values for plan and priority refs are gone; a new step defaults to
  the roadmap's first priority. Emptying a prefilled `plan_refs` or timing
  removes it: the draft API now accepts `null` for reference lists, as it
  already did for timing, and still rejects an empty list. The form never edits
  a step of another roadmap: the edited step is derived from the selected
  roadmap, and one function builds the whole request.
- The plan list page is titled **Plány** instead of **Roadmapa**, so only one
  page is called a roadmap.
- The template guard (`scripts/check-template.mjs`) checks the shape of the
  step timing and the main roadmap marker, keeps both optional, and requires
  the Organization data copy of the roadmap schema to stay identical to the
  app/code schema.
- `docs/roadmap-planning-model.md` explains the timing, the main roadmap, the
  leader timeline and adoption; the operating manual mentions both fields.

### Continuous integration

- `checks.yml` runs the full test for every pull request and push to `main`
  on Linux only.
- The new `windows-portability.yml` runs the same steps on Windows only for
  pull requests that change the App, code, the toolchain or a workflow, and on
  demand; never on the push to `main` after a merge. Organization forks are
  usually private, and Windows minutes count twice against the GitHub free
  tier there.

### Adopting 3.1.0

An updated app accepts an inbound data update only when the data
repository's schema copies are identical to its own, so the new roadmap schema
moves the app and the data together:

1. Integrate the release tag into the Organization's `mission-control` fork
   through the usual reviewed merge pull request.
2. Prepare one data pull request on `v3` of `<Org>/mission-control-data` that
   copies `templates/organization-data/schemas/mission-control-roadmap.schema.json`
   to `schemas/` and
   `templates/organization-data/scripts/validate-mission-control-data.mjs`
   to `scripts/`. It may also mark the main roadmap with `main: true` and add
   `timing` to the steps leaders should see.
3. Update every app client of the Organization (each checkout of its Mission
   Control that people or its automated Environments run) and publish the data
   pull request in one announced, short window. Until both sides match, an
   updated client refuses inbound data on the old schema, and a client still
   on 3.0.x cannot import data on the new one.

Until the data copies are updated, `timing` and `main` are rejected as unknown
fields; roadmaps without them keep validating and the timeline lists their
steps as unscheduled.

## 3.0.0 — 2026-10-16

First public release as `Lazurio/mission-control`, published with fresh Git
history from the audited tree of the private MissionControlTemplate. App
behaviour is unchanged from the entries below.

- Public upstream identity: docs and the install contract name
  `upstream=Lazurio/mission-control`; Organization forks integrate release tags.
- The built-in no-live-data guard lists fictional canary identities instead of
  real Organization and people names.
- Test fixtures and examples use fictional plan codes and repositories.
- The frozen historical writer design (`docs/history/`) is not part of the
  public tree.
- The user interface is Czech only for now; the English UI is tracked as an
  issue.

## Before the public release (MissionControlTemplate)

Entries below are carried over from the private template's changelog (partly
in Czech).

### Unreleased at the time of the public release

- Lazurio Module Standard (decision 0171): App `app/v3` startuje jedním
  procesem `bun run src/server.ts`; build klienta je deklarovaná příprava
  (`lazurio.preparation`: `prepare:app`, `check:prepared`), kterou spouští
  Launchpad před startem. Host a port čte server jen z
  `LAZURIO_RUNTIME_LISTENER_WEB_HOST/_PORT` přes `@lazurio/module-kit` a lease
  soubor už nečte. Každá chyba startové konfigurace (chybějící listener,
  ne-loopback host, neplatný hosted origin) končí kódem 2; SIGTERM končí
  kódem 0. Launchpad spouští jen `lazurio.runtime.dev_script` = `dev`, jeden
  proces serveru (bez `preview_script`; aliasy `start`/`preview` i root start
  skripty jsou pryč); `check:prepared` je read-only kontrola
  `dist/index.html`. `scripts/check-template.mjs` ověřuje, co se skutečně
  spouští: `dev_script`, přesný `dev`, deklarovanou přípravu a readiness
  check, který spustí v jednorázové kopii (bez buildu musí selhat, s buildem
  projít, nic nezapsat a doběhnout do 15 s). Další package skripty jsou
  pohodlí pro vývojáře, které Launchpad nikdy nespouští; detekce aliasů se
  nedá udělat úplná a není bezpečnostní hranicí, proto ji guard nedělá.
  Vendored knihovny App jsou TypeScript strict, `bun run check` = typecheck +
  Biome a `bun test` v `app/v3` běží vždy nad šablonovými fixtures. Chování
  aplikace (routy, data, UI) se nemění.
- Hosted workspace VM (decision 0146): loopback HTTP server nově přijímá
  `LAZURIO_RUNTIME_LISTENER_WEB_EXTERNAL_ORIGIN` od Launchpadu a přidá přesný
  veřejný `https://mission-control.<vm>.<organization>.lazurio.io` origin do
  pevného `Host`/`Origin` allowlistu, takže požadavky přes gateway už nekončí
  `forbidden_host`. Bind zůstává loopback-only, session/CSRF guardy se nemění,
  bez proměnné je chování shodné s lokálním profilem a neplatná hodnota
  (ne-`https`, cesta, credentials, ne-DNS hostname) zastaví start serveru.
- Aktualizace již publikovaných dat ověřují cílový stav připnutým validátorem
  bez opakovaného schvalování historických commitů. Zachovávají ověření
  zdroje, kompatibility schémat, neměnnosti auditní historie a ochranu
  lokálních změn. Stavové API zvládá starší konfiguraci a přenáší jen přehled
  historie; přímé spuštění aplikace má stejný validační kontext jako root runner.

- Aktivní Mission Control zápis má jediný standardní tok: lokální reviewovaný
  draft → pinned validace → jeden single-parent commit → běžný non-force
  fast-forward push pod GitHub identitou Principála. Legacy capability writer,
  jeho CLI/runtime, approve/supersede HTTP větve a UI fallback byly odstraněny.
  Existující changeset/writer-audit/provenance data zůstávají pouze jako
  neměnná historie ověřovaná standalone validátorem; nové publikace je
  nevytvářejí ani nemění.
- Výchozí `local-principal-v1` používá stejný nativní Git setup jako
  Principálův terminál: `git` z `PATH`, běžnou local/global/system commit
  identitu, SSH config/agent a Git credential helpery. GitHub repository
  grants zůstávají jedinou access autoritou; Mission Control dál čistí
  zděděné Git transakční prostředí, blokuje checkout-local repository routing,
  vypíná checkout hooks a odmítá nedůvěryhodný remote/branch, divergenci,
  force push a nevalidovaná data.
  Stejný PATH resolver nyní používá standalone validátor i vendored app
  knihovna, takže Scoop/Nix/asdf/Linuxbrew a per-user instalace neselhávají jen
  kvůli vlastnímu allowlistu executable cest.
- Plánové schéma a všechny app/data validační cesty nyní shodně přijímají
  striktní `incident_addendum`, vážou legacy ClickUp `custom_id` na
  Organization `plan_prefix` a považují pouze lowercase `.yaml` za kanonickou
  příponu plánu; roadmapy dál podporují také lowercase `.yml`. README současně
  popisuje upstream-first změny a merge-only synchronizaci Organization forků
  bez obousměrného automatického zrcadlení nebo přenosu jejich dat.
- Standalone data validator intentionally retains strict read and immutability
  checks for already committed changeset, writer-audit, provenance and
  quarantine records. These records are frozen history, not an active writer
  lifecycle, and the runtime exposes no path that creates or advances them.

### 2026-07-19

- Samostatný validátor dat Organizace nyní vynucuje úplnou policy omezeného
  writera a váže operace aktivních changesetů na
  `publish_policy.protected_paths`.
- Template i runtime validace odmítá duplicitní, placeholderové a ne-ASCII
  identifikátory writerů; strojový identifikátor používá pouze lowercase
  ASCII písmena, číslice, tečku, podtržítko a spojovník.
- Supersession failuje zavřeně, dokud připojený data control plane explicitně
  nedeklaruje terminální auditní adresář. Rollout manuály popisují samostatnou
  Admin-approved migraci, její pořadí i rollback.
- TODO export zachovává a při přeražení ID přemapuje vazby `blocked_by`,
  ponechává externí závislosti beze změny a nedovolí dvěma úlohám v jednom
  exportu sdílet stejné výsledné ID.
- Sjednocena bezpečnostní Git subprocess hranice publish a pull cesty.
- Freshness a fast-forward pull nyní před fetch ověřují deklarovaný
  repository-db remote, odmítají lokální routing/command override a ignorují
  zděděné Git repository/URL/transport proměnné.
- Git se spouští pouze přes trusted absolutní systémovou binárku, ne z
  zděděného `PATH`. SSH transport obdobně používá pinned OpenSSH bez
  uživatelského `~/.ssh/config`, proxy/local-command funkcí a se striktním
  known-hosts ověřením; cestu ke known-hosts odvozuje z nativních údajů účtu,
  ne ze zděděného `HOME`.
- Git subprocessy zahazují zděděné TLS, proxy a trace proměnné, takže okolní
  proces nemůže vypnout ověření certifikátu, přesměrovat fetch ani vynést
  diagnostiku do zvoleného souboru. Názvy proměnných se porovnávají bez ohledu
  na velikost písmen, aby ochranu nešlo obejít na Windows.
- Push-only `remote.origin.pushurl` zůstává pro pull povolený, aby dočasný
  `/dev/null` write guard neblokoval read-only synchronizaci.
- Branch se validuje úplnými Git pravidly s rezervovaným `HEAD`; fetch a
  následný bundle create/import sdílejí jeden timeout deadline.
- Selhání fetch bez cacheované remote ref se přizná jako `fetch_failed`, ne
  jako neexistující remote větev.
- Inbound pull povolí bez dalšího důkazu jen běžná doménová data pod
  `data/mission-control/**`; policy-bearing
  `data/mission-control/mission-control.config.json` i ostatní
  code/control-plane cesty vyžadují pinned commit+tree+path approval
  v app-code repu.
- Selhání requested fetch vždy blokuje nabídku pullu, i když starý tracking
  ref už ukazuje novější commit.
- Cached tracking ref už není trust anchor: inbound diff vychází z merge-base
  s lokálním HEAD, pull vždy provede izolovaný fetch a mergeuje přesný ověřený
  commit. Status-only `fetch:false` nemůže autorizovat merge.
- Kontrola čistoty control-plane porovnává HEAD a index přesně, ale pracovní
  kopii bezpečně toleruje s CRLF konci řádků bez spuštění checkout filtrů.
- Kontrola zahrnuje i přesný `100644` mode v HEAD a indexu, takže staged
  executable-bit změna control-plane zablokuje síť ještě před fetch.
- Nested Git behavior soubory (`.gitignore`, `.gitattributes`, `.gitmodules`)
  jsou inbound control-plane a ignorované untracked soubory pod
  `data/mission-control/` se počítají jako dirty draft, takže je pull nepřepíše.
- Fetch odmítá case-colliding cesty a case alias
  `mission-control.config.json` ještě před importem objektů; kolize kontroluje
  i v každém adresářovém segmentu a raw Git cesty dekóduje jako striktní UTF-8.
- Remote a branch jsou před sítí ukotvené v čistém HEAD/index control-plane;
  lokální současná změna configu a `origin` proto nemůže odvést credential na
  jiný server.
- Fetched tree odmítá symlinky, gitlinky, neportabilní cesty a executable
  doménová data a každý snapshot s reálnou inbound změnou před tracking-ref
  update projde pinned validátorem v izolovaném checkoutu. Equal/behind ref ani
  empty commit nenesou nové bajty; lokální mutace se dál validují před
  commit/push.
- Publish spouští pouze pinned app-code data validator bez Git credential
  metadata, SSH agent socketu a zděděných Node code-injection voleb; validator
  bere runtime závislosti z nezávisle instalovaného `app/v3`, nikdy executable
  validator z data checkoutu.

### 2026-06-26

- Added the first reusable Mission Control data adapter baseline for repository-db-mounted `mission-control-data` checkouts.
- Covered plan, roadmap, issue, TODO/DONE, report, and import-review reads with tests.
- Added a fail-closed guard for legacy Mission Control write targets when the compatibility bridge forbids legacy writes.
- Extended template validation so the runtime adapter and its tests remain part of the template contract.

### 2026-06-23

- Aligned the Organization data scaffold with the upstream `repository-db.config.v1` contract and `data/` / `generated/` / `scripts/` layout.
- Added guarded Roadmap Priority / Roadmap Step planning model docs and template validation so repository-db roadmaps cannot drift away from the bundled roadmap schema.
- Created initial MissionControlTemplate skeleton for the cross-Organization Mission Control Roadmaps rollout.
- Added repository-db data-boundary and Doctor-managed install docs.
- Bundled initial Mission Control plan and roadmap schemas copied from CompaniesAsCode as the starting contract.
