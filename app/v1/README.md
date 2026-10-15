# Mission Control app v1

Lokální Launchpad UI nad YAML plány v `mission-control/plans/`.

```bash
bun install
bun run dev -- --host 127.0.0.1 --port 5693
bun run build
```

Server nemá externí databázi. Čte a zapisuje YAML soubory v Mission Control
repu a skenuje task ledgery ve workspace.
Pravdu má YAML — UI je editor a dashboard.

## Struktura

```text
src/
├── server.ts    Bun HTTP server + API routy
├── plans.ts     I/O nad plans/ (YAML parse/stringify, schema validace)
├── validate.ts  Minimální JSON Schema validátor
├── export.ts    Sestavení návrhu tasků pro TODO.tasks.json
├── work-board.ts Scan TODO/DONE/ISSUES ledgerů pro kanban pohled
└── ui.ts        Single-page HTML/CSS/JS pro dashboard a editor
```

## API

| Metoda | Endpoint                        | Účel                                              |
| ------ | ------------------------------- | ------------------------------------------------- |
| GET    | `/`                             | SPA s dashboardem a editorem                      |
| GET    | `/api/plans`                    | Souhrn všech plánů                                |
| GET    | `/api/plans/:id`                | Detail plánu + validace                           |
| POST   | `/api/plans`                    | Vytvoření plánu                                   |
| PUT    | `/api/plans/:id`                | Update plánu                                      |
| POST   | `/api/plans/validate`           | Validace bez uložení                              |
| POST   | `/api/plans/:id/export`         | Dry-run návrhu tasků pro `TODO.tasks.json`        |
| GET    | `/api/work-board`               | Kanban data z `TODO`, `DONE` a `ISSUES` ledgerů   |
| GET    | `/api/schema`                   | feature-plan JSON Schema                          |
| GET    | `/health`                       | Health check (počty plánů, kolik je invalid)      |
