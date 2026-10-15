# Mission Control Architecture

Mission Control je file-system-first plánovací a orchestrační repo v rootu
workspace.

## Invarianty

- YAML soubory jsou autoritativní databáze.
- App v `app/v1/` je lokální editor a dashboard nad YAML soubory.
- Runtime nesmí vyžadovat externí službu ani serverovou databázi.
- Výstup do implementace je `TODO.tasks.json`, ne interní skrytý task store.
- Work board čte existující `TODO.tasks.json`, `DONE.tasks.json` a
  `ISSUES.open.json`; nevytváří druhou databázi práce.
- Mission Control se inspiruje core modelem Linearu, ale nekopíruje Linear
  produkt, brand, UI texty ani cloud backend. Cíl je stejné operační jádro
  přepsané do Git-native filesystem DB.

## Cílové vrstvy

```text
plans/       feature a strategické plány
decisions/   rozhodnutí napojená na plány
schemas/     JSON schemas pro validaci YAML tvaru
app/v1/      lokální Launchpad UI
scripts/     validace a exporty do TODO.tasks.json
```

## Linear-like core model

Linear core stojí na několika stabilních pojmech: workspace, týmy, issues,
workflow/statusy, triage, projects, initiatives, cycles, labels, views,
relations a updates. Mission Control používá stejný mentální model, ale data
drží jako YAML soubory v Git workspace.

AgentMint překlad:

| Linear pojem | Mission Control pojem | Filesystem DB |
|---|---|---|
| Workspace | AgentMint workspace | root repo + `mission-control/` |
| Team | Workstream / agentní role | `teams/<team-id>.yaml` |
| Issue | Vykonatelná jednotka práce | `issues/YYYY/MM/<id>.yaml` |
| Workflow status | Stav issue v týmu | `workflows/<workflow-id>.yaml` |
| Triage | Intake před přijetím do workflow | `triage/YYYY/MM/<id>.yaml` |
| Project | Časově ohraničený deliverable | `projects/YYYY/<slug>.yaml` |
| Initiative | Firemní cíl přes více projektů | `initiatives/YYYY/<slug>.yaml` |
| Cycle | Opakovaný execution interval | `cycles/<team>/<yyyy>-W<ww>.yaml` |
| Label | Kategorizace a view filtr | `labels/<label-id>.yaml` |
| View | Uložený filtr, ne kopie dat | `views/<view-id>.yaml` |
| Relation | Vazba mezi issues/projects | pole `relations` v YAML entitách |
| Update/activity | Stavový update a audit trail | `updates/YYYY/MM/<id>.yaml` |

`plans/` zůstává vstupní strategická vrstva pro feature/experiment plány.
Jakmile se plán materializuje, vznikají z něj `projects/` a `issues/`.
Dokud není issue model hotový, export do `TODO.tasks.json` je kompatibilní
bridge pro současný Workspace GEN2 task ledger.

## Filesystem DB kontrakt

Cílová struktura:

```text
mission-control/
├── data/v1/
│   ├── workspace.yaml
│   ├── teams/
│   ├── workflows/
│   ├── labels/
│   ├── views/
│   ├── initiatives/
│   │   └── YYYY/
│   ├── projects/
│   │   └── YYYY/
│   ├── issues/
│   │   └── YYYY/MM/
│   ├── triage/
│   │   └── YYYY/MM/
│   ├── cycles/
│   └── updates/
├── plans/
├── schemas/
└── app/v1/
```

Pravidla:

- Každá entita má stabilní `id`, `schema_version`, `title`, `status`,
  `owner`, `created_at`, `updated_at` a `links`.
- Souborová cesta je indexovatelná, ale pravda je `id` uvnitř YAML.
- Views jsou uložené filtry nad entitami, nikdy duplikovaná data.
- Derived indexy a cache se smějí regenerovat; nesmějí být source of truth.
- Historie vzniká přes Git diff a volitelné `updates/` soubory pro
  lidsky čitelné stavové zprávy.
- Agenti smí upravovat YAML přímo, pokud zachovají schema a idempotentní
  validaci.

## V1/V2 hranice

V1 Mission Control:

- plánuje přes `plans/`
- validuje feature plan schema
- umí dry-run export do `TODO.tasks.json`
- skenuje `TODO.tasks.json`, `DONE.tasks.json` a `ISSUES.open.json` do
  read-only work boardu
- slouží jako první lokální planning cockpit

V2 Mission Control:

- přidá filesystem DB core entity (`issues`, `projects`, `initiatives`,
  `cycles`, `views`, `triage`)
- UI bude mít Linear-like list/detail/board/timeline patterny
- task ledger bridge zůstane jen compatibility/export vrstva
- agenti budou moci zakládat a přesouvat issues přímo přes YAML entity

### V2 Phase 1 (hotovo)

Phase 1 dodává filesystem DB skelet. Plans zůstávají jako strategická
vrstva (žádná migrace).

- `schemas/` má 11 nových JSON Schemas:
  - `workspace.schema.json`, `team.schema.json`, `workflow.schema.json`,
    `label.schema.json`, `view.schema.json`
  - `initiative.schema.json`, `project.schema.json`, `issue.schema.json`
  - `triage_item.schema.json`, `cycle.schema.json`, `update.schema.json`
- `data/v1/` obsahuje skutečné YAML soubory s ID konvencemi:
  - workspace = singleton `data/v1/workspace.yaml` (id slug)
  - team = `team-<slug>`
  - workflow = `wf-<slug>`
  - label = `label-<slug>`
  - view = `view-<slug>`
  - initiative = `init-YYYY-MM-DD-NNN`
  - project = `proj-YYYY-MM-DD-NNN`
  - issue = `mci-YYYY-MM-DD-NNN` (prefix `mci-` aby nekolidoval s
    workspace-level `issue-` v `ISSUES.open.json`)
  - triage_item = `tri-YYYY-MM-DD-NNN`
  - cycle = `cycle-YYYY-NN`
  - update = `upd-YYYY-MM-DD-NNN`
- `app/v1/src/db.ts` je generický loader: list + by-id per entity type,
  validace proti správnému schematu, žádná duplicitní cache.
- Server endpoints přidané vedle stávajícího plan API:
  - `GET /api/entities` — snapshot všech typů s počty a validation health
  - `GET /api/entities/:type` — seznam entit jednoho typu
  - `GET /api/entities/:type/:id` — detail jedné entity
  - `GET /api/schemas/:type` — JSON Schema pro typ
- UI má novou sekci "Filesystem DB (V2)" s počty per entita.

### V2 Phase 2 / 3 (čeká)

- Linear-like cockpit UI: sidebar (Inbox/Triage, Issues, Projects,
  Initiatives, Cycles, Views), list + board pohledy, detail panel.
- Editor entit přes UI (zatím se zakládají přímo úpravou YAML souborů).
- Role lens (Workspace Admin, Správce Workspace, Power User).
- TODO ledger bridge: progresivní redukce na execution exit lane vedle
  full Linear-like issue workflow.

## Data flow

1. Člověk nebo agent vytvoří Mission Control plan.
2. Plan drží kontext, scope, acceptance criteria a rozhodnutí.
3. Agent z planu navrhne implementační tasky.
4. Implementační tasky se uloží do `TODO.tasks.json`.
5. Work board zobrazí plánované tasky, review, done práci a otevřené issues.
6. Po dokončení se do planu doplní outcome a evidence.

V2 data flow:

1. Intake vznikne v `triage/` nebo rovnou jako `issue`.
2. Triage issue se přijme, odmítne, sloučí jako duplicate nebo odloží.
3. Přijaté issue patří jednomu týmu/workstreamu a jednomu workflow statusu.
4. Issues se sdružují do projects, projects do initiatives.
5. Cycles vybírají aktuální execution scope bez toho, aby nahrazovaly project.
6. Views dopočítávají pracovní pohledy z YAML filtrů.
7. Updates a Git historie drží důkaz, proč se stav změnil.

## Reference inspirace

- Linear Concepts: https://linear.app/docs/conceptual-model
- Linear Teams: https://linear.app/docs/teams
- Linear Triage: https://linear.app/docs/triage
- Linear Initiatives: https://linear.app/docs/initiatives
- Linear Timeline: https://linear.app/docs/timeline
