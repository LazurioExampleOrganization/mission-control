# Mission Control

> **Fictional sample data.** Plány, ceny a nabídky v tomto repu jsou fiktivní
> ukázky referenční Organizace Lazuria. Ceny jsou zástupné hodnoty v hranatých
> závorkách (např. `[CENA PILOTU]`).

Mission Control je lokální plánovací a orchestrační centrum AgentMintu.

Jeho role je držet strategické kroky firmy, feature plány, rozhodnutí a
akceptační kritéria jako obyčejné YAML soubory ve workspace. UI je jen
pohodlný pohled, editor a dashboard nad souborovým modelem. Pravdu má YAML.

Produktově se Mission Control inspiruje core workflow Linearu: issues,
projects, initiatives, cycles, triage, labels, views a rychlý detail práce.
Technicky ale nejde o cloud issue tracker. Backend je filesystem DB v Git
workspace, aby agenti mohli nativně pracovat s YAML soubory, diffy a lokální
validací.

## Princip

- Source of truth jsou YAML soubory v `plans/`.
- Cílový core je Linear-like, ale Git-native: `issues/`, `projects/`,
  `initiatives/`, `cycles/`, `views/`, `triage/`, `labels/` a `updates/`
  jako YAML soubory.
- Validace běží podle `schemas/feature-plan.schema.json` v UI i CLI.
- Implementační kroky vznikají jako konkrétní tasky v nejbližším
  `TODO.tasks.json`, vždy s `planning` referencí zpět na YAML plán.
- Work board skenuje `TODO.tasks.json`, `DONE.tasks.json` a
  `ISSUES.open.json` napříč workspace a ukazuje planning coverage.
- Launchpad spouští lokální UI z `app/v1/`.
- Žádná externí databáze není potřeba.

## Lokální spuštění

Přes Launchpad:

1. Otevři Launchpad.
2. V aplikacích najdi `Mission Control`.
3. Klikni na `Otevřít` (poběží na `http://127.0.0.1:5693`).

Přímo:

```bash
cd mission-control/app/v1
bun install
bun run dev -- --host 127.0.0.1 --port 5693
```

Build:

```bash
cd mission-control/app/v1
bun run build
```

## Data

Strategické plány jsou v:

```text
plans/YYYY/MM/<slug>.yaml
```

ID plánu má tvar `plan-YYYY-MM-DD-NNN`. Slug, ID i cesta se generují
deterministicky v UI nebo v Mission Control planning skillu.

## Workflow

1. **Založit plán** — v Launchpadu klikni `Nový plán` a vyplň aspoň
   titulek, kontext, cíl a první acceptance criterion. Plán se uloží do
   `plans/YYYY/MM/`.
2. **Tvarovat** — `status: shaping`. Doplň `scope.in`, `scope.out`,
   rizika, planning target (scope tasku a cesta k `TODO.tasks.json`), a
   navrhované tasky v poli `proposed_tasks`.
3. **Připravit k execution** — když má plán scope, kritéria a target,
   přepni `status: ready`.
4. **Export do TODO** — v detailu plánu klikni `Dry-run export do TODO`
   nebo spusť CLI (viz níže). Dry-run nic nezapisuje; výstup je návrh
   tasků pro nejbližší `TODO.tasks.json`.
5. **Materializace** — když ti návrh sedí, spusť export s `--apply`.
   Script přidá tasky do target souboru se `source: mission-control` a
   `planning.plan_id`/`planning.path` zpět na YAML plán. Existující ID se
   nepřepíšou.
6. **Dotáhnout** — během implementace přepni `status: in_progress`. Po
   dokončení doplň `outcome` a `status: done` (nebo `archived`).

## Export do `TODO.tasks.json`

```bash
# Default dry-run, výstup JSON na stdout, žádný zápis
bun run scripts/export-todo-tasks.mjs --plan plan-2026-05-23-001

# Dry-run z konkrétního souboru
bun run scripts/export-todo-tasks.mjs --file mission-control/plans/2026/05/<slug>.yaml

# Apply: zápis do target TODO.tasks.json (vyžaduje explicitně --apply)
bun run scripts/export-todo-tasks.mjs --plan plan-2026-05-23-001 --apply

# Apply s vlastním targetem
bun run scripts/export-todo-tasks.mjs --plan plan-2026-05-23-001 --apply --target modules/experiments/TODO.tasks.json
```

Bez `--apply` script nikdy nezapisuje. S `--apply` přidá jen tasky s
novými ID — pokud návrh koliduje s existujícím `task-YYYY-MM-DD-NNN`, ten
task se přeskočí.

Každý vygenerovaný task obsahuje:

```json
{
  "source": "mission-control",
  "planning": {
    "plan_id": "plan-2026-05-23-001",
    "path": "mission-control/plans/2026/05/<slug>.yaml",
    "source": "mission-control",
    "role": "planning_source"
  }
}
```

## API

UI komunikuje přes:

Plans (V1, stále aktivní):

- `GET /api/plans` — souhrn všech plánů
- `GET /api/plans/:id` — detail plánu + validace
- `POST /api/plans` — nový plán
- `PUT /api/plans/:id` — uložit změny
- `POST /api/plans/validate` — validace bez uložení
- `POST /api/plans/:id/export` — dry-run export návrhu tasků
- `GET /api/schema` — feature-plan schema

Work board:

- `GET /api/work-board` — scan TODO/DONE/ISSUES ledgerů do kanban boardu

Filesystem DB (V2 Phase 1):

- `GET /api/entities` — snapshot všech entity typů (počty, validity)
- `GET /api/entities/:type` — seznam entit jednoho typu
  (`workspace`, `team`, `workflow`, `label`, `view`, `initiative`,
  `project`, `issue`, `triage_item`, `cycle`, `update`)
- `GET /api/entities/:type/:id` — detail entity + validace
- `GET /api/schemas/:type` — JSON Schema pro daný entity type

Health:

- `GET /health` — health check

Validace selže s HTTP 422 a tělem `{ errors: [{ path, message }] }`.

## V2 filesystem DB

Vedle `plans/` přibyl `data/v1/` filesystem layer postavený podle Linear core
modelu. Plans dál drží strategický kontext ("proč"), V2 entity drží
execution ("co konkrétně"):

```text
data/v1/
├── workspace.yaml       jeden AgentMint workspace
├── teams/               workstreamy (team-<slug>.yaml)
├── workflows/           workflow stavy (wf-<slug>.yaml)
├── labels/              kategorie (label-<slug>.yaml)
├── views/               uložené filtry (view-<slug>.yaml)
├── initiatives/         strategické cíle (init-YYYY-MM-DD-NNN.yaml)
├── projects/            deliverables (proj-YYYY-MM-DD-NNN.yaml)
├── issues/YYYY/MM/      jednotky práce (mci-YYYY-MM-DD-NNN.yaml)
├── triage/YYYY/MM/      intake (tri-YYYY-MM-DD-NNN.yaml)
├── cycles/              execution intervaly (cycle-YYYY-NN.yaml)
└── updates/YYYY/MM/     status updaty (upd-YYYY-MM-DD-NNN.yaml)
```

Schemas pro každý typ jsou v `schemas/<entity>.schema.json`. Validace
běží přes stejný JSON Schema validátor jako plans.

## Související soubory

- `AGENTS.md` — pravidla pro agenty pracující v Mission Control scope.
- `ARCHITECTURE.md` — invarianty a cílové vrstvy.
- `schemas/feature-plan.schema.json` — JSON Schema pro YAML plány.
- `app/v1/` — lokální Launchpad app (Bun + plain HTML).
- `scripts/export-todo-tasks.mjs` — CLI export do `TODO.tasks.json`.
- `company/agents/reference/mission-control-planning-model.md` — širší
  planning model AgentMintu (root reference).
- `.claude/skills/mission-control-planning/SKILL.md` — agent skill pro
  převod záměru na plán + tasky.
