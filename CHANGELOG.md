# Mission Control changelog

## 2026-05-23

- Založen lokální Mission Control skeleton.
- Přidána YAML databáze strategických plánů.
- Přidána Launchpad app `app/v1/`, která zobrazuje plány a umí založit
  nový YAML plan.
- **V1 dokončena:** plán list/detail/create/edit přes UI, JSON Schema
  validace v UI i CLI, dashboard s počty podle statusu, dry-run export do
  `TODO.tasks.json` přes `scripts/export-todo-tasks.mjs`, `--apply` režim
  pro materializaci. Plán teď drží `scope.in/out`, `risk_notes`,
  `decisions`, `outcome`, `tags`, `links`, `todo_outputs`,
  `planning_target` a `proposed_tasks`.
- Mission Control naplněn prvními reálnými strategickými plány AgentMintu:
  Agent Automation Desk paid pilot, white-label AI support discovery, AI
  visibility audit guardrailed offer, mechanism evidence system, Mission
  Control V1 implementation a Launchpad AgentMint design pass.
- Smoke test plan archivován, aby zůstal jako evidence a nepřekážel mezi
  živými prioritami.
- Export do `TODO.tasks.json` teď rezervuje task ID napříč workspace task
  ledgery, ne jen v cílovém souboru.
- Dogfood ověření: přes Mission Control API založen plán
  `Dogfood Mission Control planning loop`, přes export byly materializovány
  tři tasky do modulového `TODO.tasks.json` a do plánu se vrátily
  `todo_outputs`, rozhodnutí a friction evidence.
- **V2 Phase 1 — filesystem DB skelet.** Přidán `data/v1/` layout s 11 entitami
  inspirovanými Linearem (workspace, team, workflow, label, view,
  initiative, project, issue, triage_item, cycle, update). Každá má vlastní
  JSON Schema v `schemas/`. Seed obsahuje AgentMint workspace, team
  `team-agentmint`, `wf-default` workflow, dvě labels, tři views, V2
  initiative, V2 Phase 1 project, smoke issue, smoke triage item, aktivní
  cycle a první update. App přidal `db.ts` loader + entity API
  (`/api/entities`, `/api/entities/:type`, `/api/entities/:type/:id`,
  `/api/schemas/:type`). UI dashboard má novou sekci „Filesystem DB (V2)"
  s počty per entita a validation health. Plans/ zůstávají jako strategická
  vrstva — nepřesouvají se.
- **V2 Phase 2.1 — Linear-faithful sidebar, Inbox, My Issues, filter chips.**
  Sidebar má Linear ordering: Inbox + My Issues navrchu jako top-level,
  pak Workspace (Initiatives + Projects), Views, team sekce (Triage + Issues
  + Cycles), Plánování (Plans + Work board), Nastavení. Inbox přestal být
  alias pro triage — teď je to Linear-style activity feed: open triage
  čekající na mé rozhodnutí + open issues přiřazené mně (`CURRENT_USER =
  jannovak`) + posledních 15 updatů z `data/v1/updates/`. My Issues nová
  ruta `#/my-issues` (owner nebo assignee = current user, oddělené Open /
  Hotové). Triage má vlastní rutu `#/triage` pod týmem. Entity views
  (issues, projects, initiatives) dostaly real filter chips: Status,
  Priority, Assignee, Label se počty + multi-select + "vyčistit filtr"
  tlačítko, in-memory state per type. Inbox + My Issues otevírají
  inspector inline bez navigace. Generic `routeForType` mapping pro
  navigaci z mixed-type feed řádků.
- **V2 Phase 2 — Linear-like cockpit UI.** `ui.ts` rozdělen na orchestrator
  (43 ř.) + `ui-styles.ts` (690 ř.) + `ui-client.ts` (1282 ř.). Nová struktura:
  top bar s role lens (Admin / Správce / Power user), levý sidebar se
  sekcemi Workspace / Práce / Plánování / Saved views / Nastavení,
  centrální routed content, pravý inspector panel pro selected entitu.
  Hash-based routing: `#/inbox`, `#/issues` (list + board toggle s
  localStorage memory), `#/projects`, `#/initiatives`, `#/cycles`,
  `#/plans` (V1 modal zachován), `#/work-board`, `#/views/:id` (filtr
  + sort z YAML view definition), `#/settings/{workspace,teams,workflows,labels}`.
  Inspector je generický s entity-type-aware sekcemi (context, scope,
  acceptance criteria, decisions, proposed_tasks, relations, planning
  reference, links, validace). Plan create/edit/dry-run-export trigger
  je v inspectoru Plans sekce. Entity CRUD přes UI je dál Phase 3 — YAML
  zůstává primární editor.
