export function clientScript(): string {
	return String.raw`
    /* ---------- State + constants ---------- */
    const state = {
      route: { view: "strategy", selectedId: null },
      roleLens: "workspace-admin",
      plans: [],
      planRecords: {},
      entities: null,
      entityCache: {},
      entityFullCache: {}, // type -> array of full records (data included)
      filters: {}, // type -> { status: Set, priority: Set, assignee: Set, label: Set }
      workBoard: null,
      bootError: null,
      inspectorTarget: null,
    };

    const PLAN_STATUSES = ["shaping", "ready", "in_progress", "blocked", "done", "archived"];
    const PLAN_TYPES = ["strategy", "feature", "experiment", "ops", "decision"];

    const STATUS_LABELS = {
      shaping: "SHAPING",
      ready: "READY",
      in_progress: "IN_PROGRESS",
      blocked: "BLOCKED",
      done: "DONE",
      archived: "ARCHIVED",
      backlog: "BACKLOG",
      todo: "TODO",
      in_review: "CODE_REVIEW",
      canceled: "CANCELED",
      completed: "DONE",
      open: "OPEN",
      active: "ACTIVE",
      paused: "PAUSED",
      planned: "PLANNED",
      review: "CODE_REVIEW",
      triaged: "TRIAGED",
      rejected: "REJECTED",
      duplicate: "DUPLICATE",
      deferred: "DEFERRED",
      started: "STARTED",
      unstarted: "UNSTARTED",
      closed: "CLOSED",
    };

    const PRIORITY_LABELS = {
      urgent: "Urgentní",
      high: "Vysoká",
      medium: "Střední",
      low: "Nízká",
      none: "Žádná",
    };

    const PLAN_TYPE_LABELS = {
      strategy: "Strategie",
      feature: "Funkce",
      experiment: "Experiment",
      ops: "Provoz",
      decision: "Rozhodnutí",
    };

    const DISPLAY_LABELS = {
      list: "Seznam",
      board: "Tabule",
      timeline: "Časová osa",
    };

    const FIELD_LABELS = {
      status: "stav",
      priority: "priorita",
      assignee: "přiřazení",
      owner: "vlastník",
      labels: "štítky",
      updated_at: "upraveno",
      created_at: "vytvořeno",
      team_id: "tým",
      initiative_id: "iniciativa",
      project_id: "projekt",
      cycle_id: "cyklus",
      target_date: "cílové datum",
    };

    const RELATION_LABELS = {
      blocks: "blokuje",
      blocked_by: "blokováno",
      duplicates: "duplikuje",
      duplicate_of: "duplicita",
      related: "souvisí",
    };

    const CATEGORY_LABELS = {
      backlog: "zásobník",
      unstarted: "nezahájeno",
      started: "zahájeno",
      completed: "dokončeno",
      canceled: "zrušeno",
    };

    const ENTITY_LABEL = {
      workspace: "Pracovní prostor",
      team: "Týmy",
      workflow: "Pracovní postupy",
      label: "Štítky",
      view: "Pohledy",
      initiative: "Iniciativy",
      project: "Projekty",
      issue: "Úkoly",
      triage_item: "Příjem",
      cycle: "Cykly",
      update: "Aktualizace",
    };

    const ENTITY_SINGULAR = {
      workspace: "Pracovní prostor",
      team: "Tým",
      workflow: "Pracovní postup",
      label: "Štítek",
      view: "Pohled",
      initiative: "Iniciativa",
      project: "Projekt",
      issue: "Úkol",
      triage_item: "Položka příjmu",
      cycle: "Cyklus",
      update: "Aktualizace",
    };

    const ROLES = [
      { id: "workspace-admin", name: "Administrátor" },
      { id: "workspace-manager", name: "Správce" },
      { id: "power-user", name: "Pokročilý uživatel" },
    ];

    const ROLE_LENS = {
      "workspace-admin": { label: "Administrátor", defaultView: "strategy", showSettings: true },
      "workspace-manager": { label: "Správce", defaultView: "strategy", showSettings: false },
      "power-user": { label: "Pokročilý uživatel", defaultView: "agent-work", showSettings: false },
    };

    // Single-user workspace. Inbox / My Issues use this identity. When auth
    // lands we'll resolve this per session.
    const CURRENT_USER = "jannovak";

    const TERMINAL_ISSUE_STATUSES = new Set(["done", "canceled", "completed", "archived"]);
    const OPEN_PLAN_STATUSES = new Set(["shaping", "ready", "in_progress", "blocked"]);
    const PROJECT_DONE_STATUSES = new Set(["completed", "canceled", "archived"]);

    const appEl = document.querySelector(".app");
    const layoutEl = document.querySelector(".layout");
    const sidebarEl = document.getElementById("sidebar");
    const contentEl = document.getElementById("content");
    const inspectorEl = document.getElementById("inspector");
    const modalRoot = document.getElementById("modal-root");
    const toastRoot = document.getElementById("toast-root");
    const roleLensEl = document.getElementById("role-lens");
    const menuButtonEl = document.getElementById("menu-button");

    /* ---------- Utilities ---------- */
    function escape(value) {
      return String(value ?? "").replace(/[&<>"]/g, (ch) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
      }[ch]));
    }

    function statusLabel(value) {
      if (!value) return "";
      return STATUS_LABELS[value] || String(value).replace(/_/g, " ");
    }

    function priorityLabel(value) {
      if (!value) return "";
      return PRIORITY_LABELS[value] || String(value).replace(/_/g, " ");
    }

    function planTypeLabel(value) {
      if (!value) return "";
      return PLAN_TYPE_LABELS[value] || String(value).replace(/_/g, " ");
    }

    function displayLabel(value) {
      if (!value) return "";
      return DISPLAY_LABELS[value] || String(value).replace(/_/g, " ");
    }

    function fieldLabel(value) {
      if (!value) return "";
      return FIELD_LABELS[value] || String(value).replace(/_/g, " ");
    }

    function valueLabel(value) {
      if (!value) return "";
      if (PRIORITY_LABELS[value]) return PRIORITY_LABELS[value];
      if (STATUS_LABELS[value]) return STATUS_LABELS[value];
      return String(value).replace(/_/g, " ");
    }

    function operatorLabel(value) {
      const labels = {
        eq: "je",
        neq: "není",
        in: "je v",
        not_in: "není v",
        contains: "obsahuje",
        starts_with: "začíná na",
        exists: "existuje",
        missing: "chybí",
      };
      return labels[value] || String(value || "").replace(/_/g, " ");
    }

    function formatFilterValue(value) {
      if (Array.isArray(value)) return value.map(valueLabel).join(", ");
      return valueLabel(value);
    }

    function formatFilters(filters) {
      const items = asArray(filters);
      if (items.length === 0) return "žádný";
      return items.map((filter) => {
        const field = fieldLabel(filter.field);
        const op = operatorLabel(filter.operator || filter.op);
        const value = (filter.operator === "missing" || filter.operator === "exists")
          ? ""
          : formatFilterValue(filter.value);
        return [field, op, value].filter(Boolean).join(" ");
      }).join("; ");
    }

    function relationLabel(value) {
      if (!value) return "";
      return RELATION_LABELS[value] || String(value).replace(/_/g, " ");
    }

    function categoryLabel(value) {
      if (!value) return "";
      return CATEGORY_LABELS[value] || String(value).replace(/_/g, " ");
    }

    function truncate(value, limit) {
      const text = String(value ?? "").trim();
      if (!text) return "";
      if (text.length <= limit) return text;
      return text.slice(0, limit - 1) + "…";
    }

    function asArray(value) {
      return Array.isArray(value) ? value : [];
    }

    function toast(message) {
      const el = document.createElement("div");
      el.className = "toast";
      el.textContent = message;
      toastRoot.appendChild(el);
      setTimeout(() => el.remove(), 2400);
    }

    async function api(method, path, body) {
      const response = await fetch(path, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await response.text();
      const data = text ? JSON.parse(text) : null;
      if (!response.ok) {
        const error = new Error(data?.error || ("HTTP " + response.status));
        error.payload = data;
        throw error;
      }
      return data;
    }

    /* ---------- Routing ---------- */
    function parseHash() {
      const hash = (window.location.hash || "").replace(/^#\/?/, "");
      if (!hash) return { view: "inbox", selectedId: null };
      const parts = hash.split("/").filter(Boolean);
      const view = parts[0] || "inbox";
      const selectedId = parts.length > 1 ? parts.slice(1).join("/") : null;
      return { view, selectedId };
    }

    function navigate(view, selectedId) {
      const hash = selectedId
        ? "#/" + view + "/" + encodeURIComponent(selectedId)
        : "#/" + view;
      if (window.location.hash !== hash) {
        window.location.hash = hash;
      } else {
        handleRoute();
      }
    }

    function handleRoute() {
      state.route = parseHash();
      render();
    }

    window.addEventListener("hashchange", handleRoute);
    menuButtonEl?.addEventListener("click", () => {
      sidebarEl.classList.toggle("is-open");
    });

    /* ---------- Data loaders ---------- */
    async function loadPlans() {
      const data = await api("GET", "/api/plans");
      state.plans = data.plans || [];
    }

    async function loadEntities() {
      const data = await api("GET", "/api/entities");
      state.entities = data || null;
    }

    async function loadWorkBoard() {
      try {
        const data = await api("GET", "/api/work-board");
        state.workBoard = data.board || null;
      } catch (error) {
        state.workBoard = { error: error.message };
      }
    }

    async function fetchEntityList(type) {
      if (state.entityCache[type]) return state.entityCache[type];
      const data = await api("GET", "/api/entities/" + encodeURIComponent(type));
      state.entityCache[type] = data;
      return data;
    }

    function invalidateEntity(type) {
      delete state.entityCache[type];
    }

    async function fetchEntityDetail(type, id) {
      const data = await api(
        "GET",
        "/api/entities/" + encodeURIComponent(type) + "/" + encodeURIComponent(id),
      );
      return data.record;
    }

    async function ensureFullRecords(type, summaries) {
      // Summary records lack data.priority / data.assignee / data.labels etc.
      // For filterable views, fetch full records once and cache.
      const cached = state.entityFullCache[type];
      const ids = summaries.map((r) => r.id);
      if (cached && cached.length === summaries.length && ids.every((id) => cached.some((c) => c.id === id))) {
        return cached;
      }
      const records = await Promise.all(
        summaries.map((s) => fetchEntityDetail(type, s.id).catch(() => null)),
      );
      const full = records.filter(Boolean);
      state.entityFullCache[type] = full;
      return full;
    }

    function getFilterState(type) {
      if (!state.filters[type]) {
        state.filters[type] = { status: new Set(), priority: new Set(), assignee: new Set(), label: new Set() };
      }
      return state.filters[type];
    }

    function clearFilterState(type) {
      state.filters[type] = { status: new Set(), priority: new Set(), assignee: new Set(), label: new Set() };
    }

    function toggleFilter(type, dimension, value) {
      const s = getFilterState(type)[dimension];
      if (!s) return;
      if (s.has(value)) s.delete(value);
      else s.add(value);
    }

    function applyEntityFilters(records, filterState) {
      return records.filter((record) => {
        const data = record.data || {};
        if (filterState.status.size > 0 && !filterState.status.has(record.status)) return false;
        if (filterState.priority.size > 0 && !filterState.priority.has(data.priority || "none")) return false;
        if (filterState.assignee.size > 0) {
          const who = data.assignee || record.owner;
          if (!filterState.assignee.has(who)) return false;
        }
        if (filterState.label.size > 0) {
          const labels = Array.isArray(data.labels) ? data.labels : [];
          if (!labels.some((l) => filterState.label.has(l))) return false;
        }
        return true;
      });
    }

    function collectFilterDimensions(records) {
      const dims = {
        status: new Map(),
        priority: new Map(),
        assignee: new Map(),
        label: new Map(),
      };
      for (const record of records) {
        const data = record.data || {};
        if (record.status) increment(dims.status, record.status);
        if (data.priority) increment(dims.priority, data.priority);
        const who = data.assignee || record.owner;
        if (who) increment(dims.assignee, who);
        const labels = Array.isArray(data.labels) ? data.labels : [];
        for (const label of labels) increment(dims.label, label);
      }
      return dims;
    }

    function increment(map, key) {
      map.set(key, (map.get(key) || 0) + 1);
    }

    function renderEntityFilters(type, fullRecords, filterState, visibleCount) {
      const dims = collectFilterDimensions(fullRecords);
      const groups = [];
      if (dims.status.size > 0) groups.push(renderChipGroup(type, "status", "Stav", dims.status, filterState.status));
      if (dims.priority.size > 0) groups.push(renderChipGroup(type, "priority", "Priorita", dims.priority, filterState.priority));
      if (dims.assignee.size > 0) groups.push(renderChipGroup(type, "assignee", "Přiřazeno", dims.assignee, filterState.assignee));
      if (dims.label.size > 0) groups.push(renderChipGroup(type, "label", "Štítek", dims.label, filterState.label));
      const totalActive = filterState.status.size + filterState.priority.size + filterState.assignee.size + filterState.label.size;
      const summary = totalActive > 0
        ? '<span class="help">Zobrazeno ' + visibleCount + ' / ' + fullRecords.length + ' · </span><button type="button" class="small ghost" data-filter-clear="' + escape(type) + '">vyčistit filtr</button>'
        : '<span class="help">' + fullRecords.length + ' záznamů</span>';
      return '<div class="view-toolbar">' + groups.join("") + summary + '</div>';
    }

    function renderChipGroup(type, dimension, label, valueCounts, activeSet) {
      const entries = Array.from(valueCounts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
      return (
        '<div class="filter-chips" data-filter-group="' + escape(dimension) + '">' +
          '<span class="help" style="margin-right: 4px">' + escape(label) + ':</span>' +
          entries.map(([value, count]) => {
            const isActive = activeSet.has(value);
            return (
              '<button type="button" class="chip' + (isActive ? ' is-active' : '') + '" data-filter-type="' + escape(type) + '" data-filter-dim="' + escape(dimension) + '" data-filter-value="' + escape(value) + '">' +
                escape(dimension === "priority" ? priorityLabel(value) : statusLabel(value)) +
                '<span class="count">' + count + '</span>' +
              '</button>'
            );
          }).join("") +
        '</div>'
      );
    }

    function attachFilterChipHandlers(type) {
      contentEl.querySelectorAll("[data-filter-type=\"" + type + "\"]").forEach((btn) => {
        btn.addEventListener("click", () => {
          toggleFilter(type, btn.dataset.filterDim, btn.dataset.filterValue);
          renderContent();
        });
      });
      contentEl.querySelector("[data-filter-clear=\"" + type + "\"]")?.addEventListener("click", () => {
        clearFilterState(type);
        renderContent();
      });
    }

    async function fetchPlanDetail(id) {
      if (state.planRecords[id]) return state.planRecords[id];
      const data = await api("GET", "/api/plans/" + encodeURIComponent(id));
      state.planRecords[id] = data.record;
      return data.record;
    }

    function entityCount(type) {
      const snap = (state.entities?.snapshots || []).find((s) => s.type === type);
      return snap ? snap.count : 0;
    }

    function entityInvalid(type) {
      const snap = (state.entities?.snapshots || []).find((s) => s.type === type);
      return snap ? snap.invalid : 0;
    }

    function isMineSummary(record) {
      return record.owner === CURRENT_USER || record.assignee === CURRENT_USER;
    }

    function isMineFull(detail) {
      const data = detail.data || {};
      return data.assignee === CURRENT_USER || detail.owner === CURRENT_USER;
    }

    function countMyIssues() {
      const cache = state.entityCache.issue;
      if (!cache || !Array.isArray(cache.records)) return 0;
      return cache.records.filter((r) => isMineSummary(r) && !TERMINAL_ISSUE_STATUSES.has(r.status || "")).length;
    }

    function countInboxBadge() {
      // Počítadlo doručených ukazuje otevřený příjem a úkoly, které patří mně.
      const triage = state.entityCache.triage_item?.records || [];
      const issues = state.entityCache.issue?.records || [];
      const triageMine = triage.filter((r) => r.status === "open" && isMineSummary(r)).length;
      const issuesMine = issues.filter((r) => isMineSummary(r) && !TERMINAL_ISSUE_STATUSES.has(r.status || "")).length;
      return triageMine + issuesMine;
    }

    function countAgentWorkItems() {
      const columns = asArray(state.workBoard?.columns);
      if (columns.length === 0) return entityCount("issue");
      return columns.reduce((total, column) => total + asArray(column.items).length, 0);
    }

    /* ---------- Render entry ---------- */
    function render() {
      if (state.bootError) {
        contentEl.innerHTML = '<div class="empty-state"><h3>Mission Control se nepodařilo načíst</h3><p>' + escape(state.bootError) + '</p></div>';
        return;
      }
      renderTopbar();
      renderSidebar();
      renderContent();
    }

    function renderTopbar() {
      roleLensEl.innerHTML = ROLES.map((role) => (
        '<button type="button" data-role="' + escape(role.id) + '" class="' + (state.roleLens === role.id ? 'is-active' : '') + '">' +
          escape(role.name) +
        '</button>'
      )).join("");
      roleLensEl.querySelectorAll("[data-role]").forEach((btn) => {
        btn.addEventListener("click", () => {
          state.roleLens = btn.dataset.role || "workspace-admin";
          const lens = ROLE_LENS[state.roleLens] || ROLE_LENS["workspace-admin"];
          if (state.route.view === "settings" && !lens.showSettings) {
            navigate(lens.defaultView);
            return;
          }
          render();
        });
      });
    }

    /* ---------- Sidebar ---------- */
    function renderSidebar() {
      const triageOpen = state.entityCache.triage_item
        ? state.entityCache.triage_item.records.filter((r) => r.status === "open").length
        : entityCount("triage_item");
      const myIssues = countMyIssues();
      const inboxBadge = countInboxBadge();
      const planOpen = state.plans.filter((p) => p.status !== "done" && p.status !== "archived").length;
      const viewRecords = state.entityCache.view?.records || [];
      const lens = ROLE_LENS[state.roleLens] || ROLE_LENS["workspace-admin"];
      const workCount = countAgentWorkItems();
      const missingPlanCount = state.workBoard?.planning_coverage?.todo_without_plan || 0;

      const sections = [
        {
          title: "Mission Control",
          items: [
            { view: "strategy", label: "Strategie", count: planOpen || null },
            { view: "projects", label: "Projekty", count: entityCount("project") || null },
            { view: "agent-work", label: "Práce pro agenty", count: workCount || null, warn: missingPlanCount > 0 },
          ],
        },
        {
          title: "Vstupy",
          items: [
            { view: "inbox", label: "Doručené", count: inboxBadge || null, warn: inboxBadge > 0 },
            { view: "triage", label: "Příjem", count: triageOpen || null, warn: triageOpen > 0 },
            { view: "my-issues", label: "Moje úkoly", count: myIssues || null },
          ],
        },
      ];

      if (lens.showSettings) {
        sections.push({
          title: "Databáze",
          items: [
            { view: "plans", label: "Všechny plány", count: state.plans.length || null },
            { view: "initiatives", label: "Iniciativy", count: entityCount("initiative") || null },
            { view: "issues", label: "Úkoly", count: entityCount("issue") || null },
            { view: "cycles", label: "Cykly", count: entityCount("cycle") || null },
            ...(viewRecords.length > 0 ? [{ view: "views", label: "Uložené pohledy", count: viewRecords.length }] : []),
            { view: "settings/workspace", label: "Pracovní prostor", count: entityCount("workspace") || null },
          ],
        });
      }

      const currentView = state.route.view + (state.route.subview ? "" : "");
      sidebarEl.innerHTML = sections.map((section) => (
        '<div class="sidebar-section">' +
          (section.title ? '<h3>' + escape(section.title) + '</h3>' : '') +
          section.items.map((item) => {
            const isActive = matchesRoute(item.view);
            const count = item.count != null
              ? '<span class="count' + (item.warn ? ' warn' : '') + '">' + escape(String(item.count)) + '</span>'
              : '';
            return '<button type="button" class="nav-item' + (isActive ? ' is-active' : '') + '" data-nav="' + escape(item.view) + '">' +
              '<span class="label">' + escape(item.label) + '</span>' +
              count +
            '</button>';
          }).join("") +
        '</div>'
      )).join("") + (
        '<div class="sidebar-footer">' +
          'Entit: <strong>' + escape(String(state.entities?.total ?? 0)) + '</strong>' +
          (state.entities?.invalid ? ' · <span style="color: var(--red)">' + escape(String(state.entities.invalid)) + ' neplatných</span>' : '') +
          '<br>Plánů: <strong>' + escape(String(state.plans.length)) + '</strong>' +
          '<br>Režim: <strong>' + escape(lens.label) + '</strong>' +
        '</div>'
      );

      sidebarEl.querySelectorAll("[data-nav]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const target = btn.dataset.nav || "inbox";
          // Drop selectedId when changing section
          sidebarEl.classList.remove("is-open");
          window.location.hash = "#/" + target;
        });
      });
    }

    function matchesRoute(navTarget) {
      const parts = navTarget.split("/");
      const head = parts[0];
      if (state.route.view !== head) return false;
      if (parts.length === 1) return !state.route.selectedId || head !== state.route.view ? state.route.view === head : true;
      // For nested like "settings/teams" or "views/<id>", check that selectedId matches the second segment
      return state.route.selectedId === parts.slice(1).join("/");
    }

    /* ---------- Content dispatcher ---------- */
    async function renderContent() {
      const view = state.route.view;
      const id = state.route.selectedId;
      // Reset inspector pane visibility; views that use it set it explicitly
      closeInspector({ silent: true });

      try {
        switch (view) {
          case "strategy":
            await renderStrategyView();
            break;
          case "inbox":
            await renderInboxView();
            break;
          case "my-issues":
            await renderMyIssuesView();
            break;
          case "triage":
            await renderTriageView();
            break;
          case "issues":
            await renderEntityView("issue", { board: true, filters: true });
            break;
          case "projects":
            await renderProjectsView();
            break;
          case "initiatives":
            await renderEntityView("initiative", { filters: true });
            break;
          case "cycles":
            await renderEntityView("cycle");
            break;
          case "plans":
            await renderPlansView();
            break;
          case "agent-work":
            await renderWorkBoardView({
              title: "Práce pro agenty",
              subtitle: "Jednoduchý přehled toho, co je připravené k provedení, co běží a co čeká na rozhodnutí.",
            });
            break;
          case "work-board":
            await renderWorkBoardView();
            break;
          case "views":
            await renderSavedView(id);
            break;
          case "settings":
            await renderSettingsView(id);
            break;
          default:
            contentEl.innerHTML = '<div class="empty-state"><h3>Stránka nenalezena</h3><p>Použij sidebar nalevo.</p></div>';
        }
      } catch (error) {
        contentEl.innerHTML = '<div class="empty-state"><h3>Načtení selhalo</h3><p>' + escape(error.message) + '</p></div>';
      }
    }

    function viewHeader(opts) {
      const title = escape(opts.title);
      const subtitle = opts.subtitleHtml
        ? '<p>' + opts.subtitleHtml + '</p>'
        : opts.subtitle
          ? '<p>' + escape(opts.subtitle) + '</p>'
          : "";
      const actions = opts.actions || "";
      return (
        '<div class="view-header">' +
          '<div><h2>' + title + '</h2>' + subtitle + '</div>' +
          '<div class="view-actions">' + actions + '</div>' +
        '</div>'
      );
    }

    function planStatusRank(plan) {
      const ranks = { blocked: 0, in_progress: 1, ready: 2, shaping: 3, done: 4, archived: 5 };
      return ranks[plan.status] ?? 9;
    }

    function projectStatusRank(project) {
      const ranks = { in_progress: 0, planned: 1, backlog: 2, paused: 3, completed: 4, canceled: 5 };
      return ranks[project.status] ?? 9;
    }

    function sortPlansForStrategy(plans) {
      return [...plans].sort((a, b) =>
        planStatusRank(a) - planStatusRank(b) ||
        (b.updated_at || "").localeCompare(a.updated_at || "") ||
        a.title.localeCompare(b.title),
      );
    }

    function sortProjectsForStrategy(projects) {
      return [...projects].sort((a, b) =>
        projectStatusRank(a) - projectStatusRank(b) ||
        (b.updated_at || "").localeCompare(a.updated_at || "") ||
        a.title.localeCompare(b.title),
      );
    }

    function openPlanRows(plans) {
      return plans.filter((plan) => OPEN_PLAN_STATUSES.has(plan.status));
    }

    async function renderStrategyView() {
      const [initiativeData, projectData, issueData] = await Promise.all([
        fetchEntityList("initiative").catch(() => ({ records: [] })),
        fetchEntityList("project").catch(() => ({ records: [] })),
        fetchEntityList("issue").catch(() => ({ records: [] })),
      ]);
      const openPlans = sortPlansForStrategy(openPlanRows(state.plans));
      const shaping = openPlans.filter((p) => p.status === "shaping").length;
      const ready = openPlans.filter((p) => p.status === "ready").length;
      const running = openPlans.filter((p) => p.status === "in_progress").length;
      const waiting = openPlans.filter((p) => p.status === "blocked").length;
      const initiatives = asArray(initiativeData.records).filter((r) => !PROJECT_DONE_STATUSES.has(r.status || ""));
      const projects = sortProjectsForStrategy(asArray(projectData.records).filter((r) => !PROJECT_DONE_STATUSES.has(r.status || "")));
      const openIssues = asArray(issueData.records).filter((r) => !TERMINAL_ISSUE_STATUSES.has(r.status || ""));

      const header = viewHeader({
        title: "Strategie",
        subtitle: "První obrazovka Mission Controlu: kontext, rozhodnutí a rozpad práce pro AgentMint.",
        actions: '<button type="button" class="primary" id="new-plan-btn">Nový plán</button>',
      });

      contentEl.innerHTML = header +
        '<div class="ledger-strip">' +
          ledgerMetric(statusLabel("shaping"), shaping, "Nápady a směry, které ještě potřebují domyslet.") +
          ledgerMetric(statusLabel("ready"), ready, "Strategické kroky připravené k rozpracování.") +
          ledgerMetric(statusLabel("in_progress"), running, "Věci, které už aktivně běží.") +
          ledgerMetric(statusLabel("blocked"), waiting, "Plány čekající na rozhodnutí, vstup nebo odblokování.") +
          ledgerMetric("ISSUES", openIssues.length, "Otevřené pracovní úkoly navázané na strategii.") +
        '</div>' +
        '<div class="strategy-grid">' +
          '<section>' +
            '<div class="group-head">Strategické plány (' + openPlans.length + ')</div>' +
            (openPlans.length > 0
              ? '<div class="entity-list">' + openPlans.map(renderPlanRow).join("") + '</div>'
              : renderEmptyState("Žádné aktivní plány", "Založ první plán a drž v něm kontext, rozhodnutí a cíle.")) +
          '</section>' +
          '<section>' +
            '<div class="group-head">Iniciativy (' + initiatives.length + ')</div>' +
            (initiatives.length > 0
              ? renderEntityRows("initiative", initiatives)
              : renderEmptyState("Žádné aktivní iniciativy", "Iniciativa vznikne ve chvíli, kdy se strategický směr začne opakovaně řídit.")) +
          '</section>' +
        '</div>' +
        '<div class="group-head">Nejbližší projekty (' + projects.length + ')</div>' +
        (projects.length > 0
          ? renderEntityRows("project", projects.slice(0, 8))
          : renderEmptyState("Žádné aktivní projekty", "Projekty mají být konkrétní deliverables v čase, ne další místo pro obecné nápady."));

      contentEl.querySelector("#new-plan-btn")?.addEventListener("click", openNewPlanModal);
      attachPlanRows("strategy");
      attachRowHandlers("initiative");
      await maybeOpenPlanInspector();
    }

    async function renderProjectsView() {
      const data = await fetchEntityList("project");
      const records = asArray(data.records);
      const active = sortProjectsForStrategy(records.filter((r) => !PROJECT_DONE_STATUSES.has(r.status || "")));
      const completed = sortProjectsForStrategy(records.filter((r) => PROJECT_DONE_STATUSES.has(r.status || "")));
      const planned = records.filter((r) => r.status === "planned").length;
      const running = records.filter((r) => r.status === "in_progress").length;
      const waiting = records.filter((r) => r.status === "paused").length;

      const header = viewHeader({
        title: "Projekty",
        subtitle: "Konkrétní deliverables v čase. Pokud něco není doručitelné, patří spíš do plánu nebo iniciativy.",
      });

      contentEl.innerHTML = header +
        '<div class="ledger-strip">' +
          ledgerMetric(statusLabel("planned"), planned, "Projekty, které mají jasný směr, ale ještě neběží.") +
          ledgerMetric(statusLabel("in_progress"), running, "Projekty, na kterých se právě pracuje.") +
          ledgerMetric(statusLabel("paused"), waiting, "Projekty čekající na rozhodnutí nebo vstup.") +
          ledgerMetric(statusLabel("done"), completed.length, "Uzavřené nebo zrušené projekty.") +
        '</div>' +
        '<div class="group-head">Aktivní projekty (' + active.length + ')</div>' +
        (active.length > 0
          ? renderEntityRows("project", active)
          : renderEmptyState("Žádné aktivní projekty", "Až bude strategický plán připravený k doručení, vznikne tady projekt.")) +
        (completed.length > 0
          ? '<div class="group-head">Uzavřeno (' + completed.length + ')</div>' + renderEntityRows("project", completed)
          : "");

      attachRowHandlers("project");
      await maybeOpenInspector("project");
    }

    /* ---------- Doručené ----------
     * Doručené je přehled toho, co vyžaduje pozornost: otevřený příjem,
     * moje otevřené úkoly a poslední aktualizace.
     */
    async function renderInboxView() {
      const [triageData, issuesData, updatesData] = await Promise.all([
        fetchEntityList("triage_item"),
        fetchEntityList("issue"),
        fetchEntityList("update").catch(() => ({ records: [] })),
      ]);

      const myTriage = (triageData.records || []).filter(
        (r) => r.status === "open" && isMineSummary(r),
      );
      const myOpenIssues = (issuesData.records || []).filter(
        (r) => isMineSummary(r) && !TERMINAL_ISSUE_STATUSES.has(r.status || ""),
      );
      const recentUpdates = (updatesData.records || []).slice(0, 15);

      const header = viewHeader({
        title: "Doručené",
        subtitle: "Co potřebuje tvou pozornost: přiřazeno = " + CURRENT_USER + " plus poslední aktualizace.",
        actions: '<span class="help">Doručené je jen ke čtení; akce se dělají v detailu nebo přímo v YAML.</span>',
      });

      const totalAttention = myTriage.length + myOpenIssues.length;

      const sections = [];
      if (myTriage.length > 0) {
        sections.push(
          '<div class="group-head">Příjem čeká na rozhodnutí (' + myTriage.length + ')</div>' +
          renderEntityRows("triage_item", myTriage),
        );
      }
      if (myOpenIssues.length > 0) {
        sections.push(
          '<div class="group-head">Otevřené úkoly přiřazené mně (' + myOpenIssues.length + ')</div>' +
          renderEntityRows("issue", myOpenIssues),
        );
      }
      if (recentUpdates.length > 0) {
        sections.push(
          '<div class="group-head">Poslední aktivita (' + recentUpdates.length + ')</div>' +
          renderUpdateFeed(recentUpdates),
        );
      }

      contentEl.innerHTML = header + (
        sections.length === 0
          ? renderEmptyState(
              "Doručené je prázdné",
              "Nemáš žádný otevřený příjem ani otevřené úkoly a v data/v1/updates/ není aktivita. Čisto.",
            )
          : sections.join("")
      );

      attachRowHandlers("issue");
      await maybeOpenInspector(detectInspectorTypeForId(state.route.selectedId));
    }

    function renderUpdateFeed(updates) {
      return (
        '<div class="entity-list">' +
        updates.map((update) => {
          const data = update;
          const meta = [];
          if (update.owner) meta.push(update.owner);
          if (update.updated_at) meta.push(update.updated_at);
          return (
            '<div class="list-row" data-entity-type="update" data-entity-id="' + escape(update.id) + '">' +
              '<div class="row-id"><code>' + escape(update.id) + '</code></div>' +
              '<div class="row-title">' +
                '<strong>' + escape(update.title || update.id) + '</strong>' +
                '<div class="row-meta">' + meta.map((p) => '<span>' + escape(p) + '</span>').join("") + '</div>' +
              '</div>' +
              '<div class="row-side">' +
                '<span class="pill pill-soft">aktualizace</span>' +
                (update.valid ? '' : '<span class="pill pill-invalid">neplatné</span>') +
              '</div>' +
            '</div>'
          );
        }).join("") +
        '</div>'
      );
    }

    function detectInspectorTypeForId(id) {
      if (!id) return null;
      if (id.startsWith("mci-")) return "issue";
      if (id.startsWith("tri-")) return "triage_item";
      if (id.startsWith("upd-")) return "update";
      if (id.startsWith("init-")) return "initiative";
      if (id.startsWith("proj-")) return "project";
      if (id.startsWith("cycle-")) return "cycle";
      if (id.startsWith("plan-")) return "plan";
      if (id.startsWith("wf-")) return "workflow";
      if (id.startsWith("team-")) return "team";
      if (id.startsWith("label-")) return "label";
      if (id.startsWith("view-")) return "view";
      return null;
    }

    /* ---------- My Issues ---------- */
    async function renderMyIssuesView() {
      const issuesData = await fetchEntityList("issue");
      const all = issuesData.records || [];
      const mine = all.filter(isMineSummary);
      const open = mine.filter((r) => !TERMINAL_ISSUE_STATUSES.has(r.status || ""));
      const done = mine.filter((r) => TERMINAL_ISSUE_STATUSES.has(r.status || ""));

      const header = viewHeader({
        title: "Moje úkoly",
        subtitle: "Úkoly, kde vlastník nebo přiřazený člověk = " + CURRENT_USER + ".",
      });

      const body = mine.length === 0
        ? renderEmptyState(
            "Žádné moje úkoly",
            "Žádný YAML v data/v1/issues/ tě neuvádí jako vlastníka ani přiřazeného řešitele.",
          )
        : (
            '<div class="group-head">Otevřené (' + open.length + ')</div>' +
            (open.length > 0 ? renderEntityRows("issue", open) : '<div class="help">Žádné otevřené.</div>') +
            (done.length > 0
              ? '<div class="group-head">Hotové (' + done.length + ')</div>' + renderEntityRows("issue", done)
              : "")
          );

      contentEl.innerHTML = header + body;
      attachRowHandlers("issue");
      await maybeOpenInspector("issue");
    }

    /* ---------- Triage (team-level intake) ---------- */
    async function renderTriageView() {
      const data = await fetchEntityList("triage_item");
      const records = data.records || [];
      const open = records.filter((r) => r.status === "open");
      const resolved = records.filter((r) => r.status !== "open");

      const header = viewHeader({
        title: "Příjem",
        subtitle: "Položky před přijetím do pracovního postupu úkolů.",
        actions: '<span class="help">Položky příjmu edituj v <code>data/v1/triage/</code>.</span>',
      });

      contentEl.innerHTML = header + (
        records.length === 0
          ? renderEmptyState(
              "Příjem je prázdný",
              "Vznikají v data/v1/triage/. Agent nebo člověk je sem odkládá před tím, než se z nich stanou úkoly.",
            )
          : (
            '<div class="group-head">Otevřené (' + open.length + ')</div>' +
            renderEntityRows("triage_item", open) +
            (resolved.length > 0
              ? '<div class="group-head">Rozhodnuto (' + resolved.length + ')</div>' + renderEntityRows("triage_item", resolved)
              : "")
          )
      );

      attachRowHandlers("triage_item");
      await maybeOpenInspector("triage_item");
    }

    /* ---------- Generic entity view ---------- */
    async function renderEntityView(type, opts) {
      const data = await fetchEntityList(type);
      const records = data.records || [];
      const mode = opts?.board && getStoredMode(type) === "board" ? "board" : "list";
      const layoutToggle = opts?.board
        ? renderLayoutToggle(type, mode)
        : "";

      const useFilters = Boolean(opts?.filters);
      let filtered = records;
      let filterChipsHtml = "";
      if (useFilters && records.length > 0) {
        const fullRecords = await ensureFullRecords(type, records);
        const filterState = getFilterState(type);
        filtered = applyEntityFilters(fullRecords, filterState);
        filterChipsHtml = renderEntityFilters(type, fullRecords, filterState, filtered.length);
      }

      const header = viewHeader({
        title: ENTITY_LABEL[type],
        subtitleHtml: escape(ENTITY_LABEL[type]) + " jsou YAML soubory v <code>" + escape("data/v1/" + data.dir + "/") + "</code>. Edituj přímo v souboru (UI editor přijde ve třetí fázi).",
        actions: layoutToggle,
      });

      let body = "";
      if (records.length === 0) {
        body = renderEmptyState("Žádné " + ENTITY_LABEL[type].toLowerCase(),
          "Založ první " + ENTITY_SINGULAR[type] + " úpravou YAML souboru v data/v1/" + data.dir + "/.");
      } else if (filtered.length === 0) {
        body = renderEmptyState("Filtr nic nevrací", "Žádný záznam neodpovídá vybraným chipům. Vyčisti filtr nahoře.");
      } else if (mode === "board" && type === "issue") {
        body = await renderIssueBoard(filtered);
      } else {
        body = renderEntityRows(type, filtered);
      }

      contentEl.innerHTML = header + filterChipsHtml + body;
      attachRowHandlers(type);
      attachFilterChipHandlers(type);
      contentEl.querySelectorAll("[data-toggle-mode]").forEach((btn) => {
        btn.addEventListener("click", () => {
          setStoredMode(type, btn.dataset.toggleMode);
          renderContent();
        });
      });
      await maybeOpenInspector(type);
    }

    function getStoredMode(type) {
      try {
        return localStorage.getItem("mc.mode." + type) || "list";
      } catch (_) { return "list"; }
    }

    function setStoredMode(type, mode) {
      try { localStorage.setItem("mc.mode." + type, mode); } catch (_) {}
    }

    function renderLayoutToggle(type, mode) {
      return (
        '<div class="toggle-group">' +
          '<button type="button" data-toggle-mode="list" class="' + (mode === "list" ? 'is-active' : '') + '">Seznam</button>' +
          '<button type="button" data-toggle-mode="board" class="' + (mode === "board" ? 'is-active' : '') + '">Tabule</button>' +
        '</div>'
      );
    }

    function renderEntityRows(type, records) {
      return (
        '<div class="entity-list">' +
        records.map((record) => renderEntityRow(type, record)).join("") +
        '</div>'
      );
    }

    function renderEntityRow(type, record) {
      const isActive = state.route.selectedId === record.id;
      const meta = [];
      if (record.owner) meta.push("👤 " + record.owner);
      if (record.assignee && record.assignee !== record.owner) meta.push("→ " + record.assignee);
      if (record.updated_at) meta.push(record.updated_at);
      const statusBadge = record.status
        ? '<span class="pill pill-status" data-status="' + escape(record.status) + '">' + escape(statusLabel(record.status)) + '</span>'
        : "";
      const invalidBadge = record.valid ? "" : '<span class="pill pill-invalid">neplatné</span>';
      return (
        '<div class="list-row' + (isActive ? ' is-active' : '') + '" data-entity-type="' + escape(type) + '" data-entity-id="' + escape(record.id) + '">' +
          '<div class="row-id"><code>' + escape(record.id) + '</code></div>' +
          '<div class="row-title">' +
            '<strong>' + escape(record.title || record.id) + '</strong>' +
            '<div class="row-meta">' + meta.map((part) => '<span>' + escape(part) + '</span>').join("") + '</div>' +
          '</div>' +
          '<div class="row-side">' +
            statusBadge +
            invalidBadge +
          '</div>' +
        '</div>'
      );
    }

    async function renderIssueBoard(records) {
      const workflowIds = Array.from(new Set(
        records.map((record) => record.workflow_id || record.data?.workflow_id).filter(Boolean),
      ));
      const workflows = await Promise.all(
        workflowIds.map((id) => fetchEntityDetail("workflow", id).catch(() => null)),
      );
      const seen = new Set();
      const workflowColumns = [];
      for (const workflow of workflows.filter(Boolean)) {
        for (const status of asArray(workflow.data?.statuses)) {
          if (!status.id || seen.has(status.id)) continue;
          seen.add(status.id);
          workflowColumns.push({ id: status.id, title: status.name || status.id });
        }
      }
      const fallbackColumns = ["backlog", "todo", "in_progress", "in_review", "blocked", "done", "canceled"].map((id) => ({
        id,
        title: statusLabel(id),
      }));
      const columnsDef = workflowColumns.length > 0 ? workflowColumns : fallbackColumns;
      const buckets = columnsDef.reduce((acc, status) => { acc[status.id] = []; return acc; }, {});
      const orphan = [];
      for (const record of records) {
        if (buckets[record.status]) buckets[record.status].push(record);
        else orphan.push(record);
      }
      const columns = columnsDef.map((status) => ({ status: status.id, title: status.title, items: buckets[status.id] }));
      if (orphan.length > 0) columns.push({ status: "other", title: "Ostatní", items: orphan });

      return (
        '<div class="board">' +
        columns.map((col) => (
          '<div class="board-column">' +
            '<div class="board-column-head">' +
              '<h4>' + escape(col.title || statusLabel(col.status)) + '</h4>' +
              '<span class="count">' + col.items.length + '</span>' +
            '</div>' +
            col.items.map((record) => renderBoardCard("issue", record)).join("") +
          '</div>'
        )).join("") +
        '</div>'
      );
    }

    function renderGroupedBoard(type, groups) {
      const columns = asArray(groups).filter((group) => asArray(group.records).length > 0);
      if (columns.length === 0) return renderEmptyState("Žádné výsledky", "Pohled teď nevrací žádné záznamy.");
      return (
        '<div class="board">' +
        columns.map((group) => {
          const records = asArray(group.records);
          const title = group.title || group.key || "Bez hodnoty";
          return (
            '<div class="board-column">' +
              '<div class="board-column-head">' +
                '<h4>' + escape(valueLabel(title)) + '</h4>' +
                '<span class="count">' + records.length + '</span>' +
              '</div>' +
              records.map((record) => renderBoardCard(type, record)).join("") +
            '</div>'
          );
        }).join("") +
        '</div>'
      );
    }

    function renderBoardCard(type, record) {
      const isActive = state.route.selectedId === record.id;
      return (
        '<div class="board-card' + (isActive ? ' is-active' : '') + '" data-entity-type="' + escape(type) + '" data-entity-id="' + escape(record.id) + '">' +
          '<div class="row-id">' + escape(record.id) + '</div>' +
          '<h5>' + escape(record.title || record.id) + '</h5>' +
          '<div class="row-meta">' +
            (record.owner ? '<span>' + escape(record.owner) + '</span>' : "") +
            (record.assignee && record.assignee !== record.owner ? '<span>' + escape(record.assignee) + '</span>' : "") +
            (record.updated_at ? '<span>' + escape(record.updated_at) + '</span>' : "") +
          '</div>' +
        '</div>'
      );
    }

    function renderEmptyState(title, body) {
      return '<div class="empty-state"><h3>' + escape(title) + '</h3><p>' + escape(body) + '</p></div>';
    }

    const ROUTE_FOR_TYPE = {
      issue: "issues",
      project: "projects",
      initiative: "initiatives",
      cycle: "cycles",
      triage_item: "triage",
      update: "inbox",
      view: "views",
      team: "settings/teams",
      workflow: "settings/workflows",
      label: "settings/labels",
      workspace: "settings/workspace",
    };

    function routeForType(type) {
      return ROUTE_FOR_TYPE[type] || "issues";
    }

    function attachRowHandlers(defaultType) {
      contentEl.querySelectorAll("[data-entity-id]").forEach((row) => {
        row.addEventListener("click", () => {
          const id = row.dataset.entityId;
          const t = row.dataset.entityType || defaultType;
          // In feed-style views (e.g. Inbox) we don't want to jump the user
          // to a different section just because they opened an update for
          // preview. Keep the current route and open the inspector inline.
          if (state.route.view === "inbox" || state.route.view === "my-issues") {
            state.route.selectedId = id;
            openEntityInspector(t, id, { inline: true });
            return;
          }
          navigate(routeForType(t), id);
        });
      });
    }

    /* ---------- Plans view (preserved from V1) ---------- */
    async function renderPlansView() {
      const header = viewHeader({
        title: "Plány",
        subtitle: "Strategická vrstva pro tvarování práce. Z plánu vznikají iniciativy, projekty a TODO úkoly.",
        actions: '<button type="button" class="primary" id="new-plan-btn">Nový plán</button>',
      });
      const filterChips = renderPlanStatusChips();
      const filtered = state.plans;

      contentEl.innerHTML = header +
        '<div class="view-toolbar">' + filterChips + '</div>' +
        (filtered.length === 0
          ? renderEmptyState("Žádné plány", "Vznikají v plans/YYYY/MM/. Začni novým plánem nahoře vpravo.")
          : '<div class="entity-list">' + filtered.map(renderPlanRow).join("") + '</div>');

      contentEl.querySelector("#new-plan-btn")?.addEventListener("click", openNewPlanModal);
      attachPlanRows("plans");

      await maybeOpenPlanInspector();
    }

    function attachPlanRows(routeName) {
      contentEl.querySelectorAll("[data-plan-id]").forEach((row) => {
        row.addEventListener("click", () => navigate(routeName, row.dataset.planId));
      });
    }

    function renderPlanRow(plan) {
      const isActive = state.route.selectedId === plan.id;
      const statusBadge = '<span class="pill pill-status" data-status="' + escape(plan.status) + '">' + escape(statusLabel(plan.status)) + '</span>';
      const typeBadge = '<span class="pill pill-type">' + escape(planTypeLabel(plan.type)) + '</span>';
      const invalidBadge = plan.valid ? "" : '<span class="pill pill-invalid">neplatné</span>';
      const meta = [plan.owner, plan.updated_at, plan.relativePath].filter(Boolean);
      return (
        '<div class="list-row' + (isActive ? ' is-active' : '') + '" data-plan-id="' + escape(plan.id) + '">' +
          '<div class="row-id"><code>' + escape(plan.id) + '</code></div>' +
          '<div class="row-title">' +
            '<strong>' + escape(plan.title) + '</strong>' +
            '<div class="row-meta">' + meta.map((part) => '<span>' + escape(part) + '</span>').join(" · ") + '</div>' +
          '</div>' +
          '<div class="row-side">' + typeBadge + statusBadge + invalidBadge + '</div>' +
        '</div>'
      );
    }

    function renderPlanStatusChips() {
      const counts = PLAN_STATUSES.reduce((acc, status) => {
        acc[status] = state.plans.filter((p) => p.status === status).length;
        return acc;
      }, {});
      return '<div class="filter-chips">' +
          '<span class="chip is-active">vše<span class="count">' + state.plans.length + '</span></span>' +
        PLAN_STATUSES.map((status) => (
          '<span class="chip"><span>' + escape(statusLabel(status)) + '</span><span class="count">' + (counts[status] || 0) + '</span></span>'
        )).join("") +
        '</div>';
    }

    /* ---------- Work board view ---------- */
    async function renderWorkBoardView(opts) {
      if (!state.workBoard) await loadWorkBoard();
      const board = state.workBoard;
      const header = viewHeader({
        title: opts?.title || "Pracovní tabule",
        subtitle: opts?.subtitle || "Přehled pracovních ledgerů napříč pracovním prostorem.",
      });
      if (!board || board.error) {
        contentEl.innerHTML = header + '<div class="empty-state"><p>' + escape(board?.error || "Pracovní tabule není k dispozici.") + '</p></div>';
        return;
      }
      const coverage = board.planning_coverage || {};
      const ledgers = asArray(board.ledgers);
      const todoLedgers = ledgers.filter((l) => l.kind === "todo");
      const doneLedgers = ledgers.filter((l) => l.kind === "done");
      const issueLedgers = ledgers.filter((l) => l.kind === "issues");
      const columns = asArray(board.columns);

      contentEl.innerHTML = header + '<div class="work-board">' +
        '<div class="ledger-strip">' +
          ledgerMetric(statusLabel("todo"), coverage.todo_total || 0, todoLedgers.map((l) => l.path).join(", ") || "Žádný TODO ledger") +
          ledgerMetric("S plánem", coverage.todo_with_plan || 0, "Vazba na plán v Mission Controlu") +
          ledgerMetric("Bez plánu", coverage.todo_without_plan || 0, (coverage.missing_plan_task_ids || []).join(", ") || "OK") +
          ledgerMetric(statusLabel("done"), sumLedgerItems(doneLedgers), doneLedgers.map((l) => l.path).join(", ") || "Žádný DONE ledger") +
          ledgerMetric("ISSUES", sumLedgerItems(issueLedgers), issueLedgers.map((l) => l.path).join(", ") || "Žádný ISSUES ledger") +
        '</div>' +
        '<div class="kanban">' + columns.map(renderWorkColumn).join("") + '</div>' +
      '</div>';

      contentEl.querySelectorAll("[data-work-plan-id]").forEach((btn) => {
        btn.addEventListener("click", (event) => {
          event.stopPropagation();
          navigate("plans", btn.dataset.workPlanId);
        });
      });
    }

    function ledgerMetric(label, value, hint) {
      return '<div class="ledger-metric"><strong>' + escape(value) + '</strong><span title="' + escape(hint) + '">' + escape(label) + '</span></div>';
    }

    function sumLedgerItems(ledgers) {
      return ledgers.reduce((total, ledger) => total + (Number(ledger.item_count) || 0), 0);
    }

    function renderWorkColumn(column) {
      const items = asArray(column.items);
      return (
        '<section class="kanban-column">' +
          '<div class="column-head"><h3>' + escape(column.title) + '</h3><span class="column-count">' + items.length + '</span></div>' +
          '<div class="work-cards">' + (items.length > 0
            ? items.map(renderWorkItem).join("")
            : '<div class="help">Prázdné.</div>') + '</div>' +
        '</section>'
      );
    }

    function renderWorkItem(item) {
      const missingPlan = item.kind === "todo" && !item.has_plan;
      const plan = item.planning || {};
      const badge = item.priority || item.severity || item.status || item.kind;
      return (
        '<article class="work-card' + (missingPlan ? ' missing-plan' : '') + '">' +
          '<div class="signal-row">' +
            '<span class="pill pill-priority" data-priority="' + escape(badge) + '">' + escape(valueLabel(badge)) + '</span>' +
            '<code>' + escape(item.id) + '</code>' +
          '</div>' +
          '<h4>' + escape(item.title) + '</h4>' +
          (item.summary ? '<p class="help">' + escape(truncate(item.summary, 150)) + '</p>' : "") +
          '<div class="signal-row">' +
            (item.assignee ? '<span class="signal">' + escape(item.assignee) + '</span>' : "") +
            (item.scope_id ? '<span class="signal">' + escape(item.scope_id) + '</span>' : "") +
            (item.updated_at ? '<span class="signal">' + escape(item.updated_at) + '</span>' : "") +
            (missingPlan ? '<span class="signal warn">bez plánu</span>' : "") +
          '</div>' +
          '<code>' + escape(item.ledger_path) + '</code>' +
          (plan.plan_id
            ? '<button type="button" class="small" data-work-plan-id="' + escape(plan.plan_id) + '">Otevřít ' + escape(plan.plan_id) + '</button>'
            : "") +
        '</article>'
      );
    }

    /* ---------- Saved view ---------- */
    async function renderSavedView(viewId) {
      if (!viewId) {
        const data = await fetchEntityList("view");
        const records = data.records || [];
        const header = viewHeader({
          title: "Uložené pohledy",
          subtitle: "Uložené filtry nad kolekcemi entit.",
        });
        contentEl.innerHTML = header + (records.length === 0
          ? renderEmptyState("Žádné pohledy", "Vznikají v data/v1/views/. Editor přijde ve třetí fázi.")
          : renderEntityRows("view", records));
        attachRowHandlers("view");
        return;
      }

      try {
        const data = await api("GET", "/api/views/" + encodeURIComponent(viewId) + "/results");
        const result = data.result || {};
        const view = result.view || {};
        const entityType = result.entity_type || view.data?.entity_type;
        const records = result.records || [];
        const groups = result.groups || [];
        const display = result.display || "list";
        const filterSummary = formatFilters(result.filters || []);
        const header = viewHeader({
          title: view.title,
          subtitle: (view.data?.description || "Uložený filtr nad " + ENTITY_LABEL[entityType] + "."),
          actions: '<span class="help">' +
            escape(displayLabel(display)) +
            (result.group_by ? " · skupina: " + escape(fieldLabel(result.group_by)) : "") +
            ' · filtr: ' + escape(filterSummary) +
          '</span>',
        });
        let body = "";
        if (records.length === 0) {
          body = renderEmptyState("Žádné výsledky", "Pohled " + viewId + " teď nevrací žádné záznamy.");
        } else if (display === "board") {
          body = renderGroupedBoard(entityType, groups);
        } else {
          body = renderEntityRows(entityType, records);
        }
        contentEl.innerHTML = header + body;
        attachRowHandlers(entityType);
      } catch (error) {
        contentEl.innerHTML = viewHeader({ title: "Pohled nenalezen" }) + '<div class="empty-state"><p>' + escape(error.message) + '</p></div>';
      }
    }

    /* ---------- Settings ---------- */
    async function renderSettingsView(section) {
      const sections = ["workspace", "teams", "workflows", "labels"];
      const target = sections.includes(section) ? section : "workspace";
      const typeMap = { workspace: "workspace", teams: "team", workflows: "workflow", labels: "label" };
      const type = typeMap[target];
      const data = await fetchEntityList(type);
      const records = data.records || [];
      const header = viewHeader({
        title: "Nastavení · " + ENTITY_LABEL[type],
        subtitleHtml: "Entity typu " + escape(ENTITY_SINGULAR[type].toLowerCase()) + " v <code>" + escape("data/v1/" + data.dir + (data.singleton ? "" : "/")) + "</code>.",
      });
      contentEl.innerHTML = header + (records.length === 0
        ? renderEmptyState("Žádné " + ENTITY_LABEL[type].toLowerCase(), "Edituj YAML soubory přímo.")
        : (
          '<div class="settings-grid">' +
            records.map((record) => (
              '<button type="button" class="settings-card" data-entity-type="' + escape(type) + '" data-entity-id="' + escape(record.id) + '">' +
                '<h3>' + escape(record.title || record.id) + '</h3>' +
                (record.status ? '<span class="pill pill-status" data-status="' + escape(record.status) + '">' + escape(statusLabel(record.status)) + '</span>' : '') +
                '<code>' + escape(record.relativePath) + '</code>' +
                (record.owner ? '<div class="help">vlastník: ' + escape(record.owner) + '</div>' : '') +
              '</button>'
            )).join("") +
          '</div>'
        ));
      contentEl.querySelectorAll(".settings-card[data-entity-id]").forEach((card) => {
        card.addEventListener("click", () => {
          openEntityInspector(card.dataset.entityType, card.dataset.entityId, { inline: true });
        });
      });
    }

    /* ---------- Inspector ---------- */
    function showInspector(html) {
      inspectorEl.innerHTML = html;
      inspectorEl.classList.remove("hidden");
      layoutEl.classList.add("with-inspector");
      inspectorEl.querySelector(".close")?.addEventListener("click", () => {
        const target = state.inspectorTarget;
        if (target?.inline) {
          state.route.selectedId = null;
          closeInspector();
          return;
        }
        const currentHash = window.location.hash || "";
        const encodedId = state.route.selectedId ? encodeURIComponent(state.route.selectedId) : "";
        if (encodedId && currentHash.includes(encodedId)) {
          window.location.hash = "#/" + state.route.view;
          return;
        }
        closeInspector();
      });
    }

    function closeInspector(opts) {
      inspectorEl.innerHTML = "";
      inspectorEl.classList.add("hidden");
      layoutEl.classList.remove("with-inspector");
      if (!opts?.preserveTarget) state.inspectorTarget = null;
    }

    async function maybeOpenInspector(type) {
      const id = state.route.selectedId;
      if (!id) return;
      await openEntityInspector(type, id, { inline: false });
    }

    async function maybeOpenPlanInspector() {
      const id = state.route.selectedId;
      if (!id) return;
      try {
        const record = await fetchPlanDetail(id);
        showInspector(renderPlanInspector(record));
        attachPlanInspectorHandlers(record);
      } catch (error) {
        showInspector('<div class="inspector-head"><h2>Plán nenalezen</h2><button type="button" class="close">×</button></div><p class="help">' + escape(error.message) + '</p>');
      }
    }

    async function openEntityInspector(type, id, opts) {
      state.inspectorTarget = { type, id, inline: Boolean(opts?.inline) };
      showInspector('<div class="loading">Načítám…</div>');
      try {
        const record = await fetchEntityDetail(type, id);
        showInspector(renderEntityInspector(type, record));
      } catch (error) {
        showInspector('<div class="inspector-head"><h2>Detail selhal</h2><button type="button" class="close">×</button></div><p class="help">' + escape(error.message) + '</p>');
      }
    }

    function renderEntityInspector(type, record) {
      const data = record.data || {};
      const head = (
        '<div class="inspector-head">' +
          '<div>' +
            '<div class="row-id"><code>' + escape(record.id) + '</code></div>' +
            '<h2>' + escape(record.title || record.id) + '</h2>' +
          '</div>' +
          '<button type="button" class="close" aria-label="Zavřít">×</button>' +
        '</div>'
      );
      const pills = (
        '<div class="pill-row">' +
          '<span class="pill pill-type">' + escape(ENTITY_SINGULAR[type] || type) + '</span>' +
          (record.status ? '<span class="pill pill-status" data-status="' + escape(record.status) + '">' + escape(statusLabel(record.status)) + '</span>' : '') +
          (record.validation && !record.validation.ok ? '<span class="pill pill-invalid">neplatné</span>' : '') +
        '</div>'
      );
      const meta = (
        '<dl class="meta-grid">' +
          (record.owner ? '<dt>Vlastník</dt><dd>' + escape(record.owner) + '</dd>' : "") +
          (data.team_id ? '<dt>Tým</dt><dd><code>' + escape(data.team_id) + '</code></dd>' : "") +
          (data.workflow_id ? '<dt>Postup</dt><dd><code>' + escape(data.workflow_id) + '</code></dd>' : "") +
          (data.priority ? '<dt>Priorita</dt><dd><span class="pill pill-priority" data-priority="' + escape(data.priority) + '">' + escape(priorityLabel(data.priority)) + '</span></dd>' : "") +
          (data.assignee ? '<dt>Přiřazeno</dt><dd>' + escape(data.assignee) + '</dd>' : "") +
          (data.project_id ? '<dt>Projekt</dt><dd><code>' + escape(data.project_id) + '</code></dd>' : "") +
          (data.initiative_id ? '<dt>Iniciativa</dt><dd><code>' + escape(data.initiative_id) + '</code></dd>' : "") +
          (data.cycle_id ? '<dt>Cyklus</dt><dd><code>' + escape(data.cycle_id) + '</code></dd>' : "") +
          (data.starts_at ? '<dt>Začátek</dt><dd>' + escape(data.starts_at) + '</dd>' : "") +
          (data.ends_at ? '<dt>Konec</dt><dd>' + escape(data.ends_at) + '</dd>' : "") +
          (data.target_date ? '<dt>Cíl</dt><dd>' + escape(data.target_date) + '</dd>' : "") +
          (record.created_at ? '<dt>Vytvořeno</dt><dd>' + escape(record.created_at) + '</dd>' : "") +
          (record.updated_at ? '<dt>Upraveno</dt><dd>' + escape(record.updated_at) + '</dd>' : "") +
          '<dt>Soubor</dt><dd><code>' + escape(record.relativePath) + '</code></dd>' +
        '</dl>'
      );

      const sections = [];
      if (data.summary) sections.push('<h4>Shrnutí</h4><div class="context">' + escape(data.summary) + '</div>');
      if (data.description) sections.push('<h4>Popis</h4><div class="description">' + escape(data.description) + '</div>');
      if (data.context) sections.push('<h4>Kontext</h4><div class="context">' + escape(data.context) + '</div>');
      if (Array.isArray(data.goals) && data.goals.length > 0) {
        sections.push('<h4>Cíle</h4><ul>' + data.goals.map((g) => '<li>' + escape(g) + '</li>').join("") + '</ul>');
      }
      if (data.scope && (data.scope.in || data.scope.out)) {
        sections.push(renderScopeBlock(data.scope));
      }
      if (Array.isArray(data.acceptance_criteria) && data.acceptance_criteria.length > 0) {
        sections.push('<h4>Akceptační kritéria</h4><ul>' + data.acceptance_criteria.map((c) => '<li>' + escape(c) + '</li>').join("") + '</ul>');
      }
      if (Array.isArray(data.labels) && data.labels.length > 0) {
        sections.push('<h4>Štítky</h4><div class="tag-row">' + data.labels.map((l) => '<span class="tag">' + escape(l) + '</span>').join("") + '</div>');
      }
      if (Array.isArray(data.tags) && data.tags.length > 0) {
        sections.push('<h4>Tagy</h4><div class="tag-row">' + data.tags.map((t) => '<span class="tag">' + escape(t) + '</span>').join("") + '</div>');
      }
      if (Array.isArray(data.relations) && data.relations.length > 0) {
        sections.push('<h4>Vazby</h4><ul>' + data.relations.map((r) => (
          '<li><span class="pill pill-soft">' + escape(relationLabel(r.type)) + '</span> <code>' + escape(r.target_id) + '</code></li>'
        )).join("") + '</ul>');
      }
      if (Array.isArray(data.members) && data.members.length > 0) {
        sections.push('<h4>Členové</h4><div class="tag-row">' + data.members.map((m) => '<span class="tag">' + escape(m) + '</span>').join("") + '</div>');
      }
      if (Array.isArray(data.projects) && data.projects.length > 0) {
        sections.push('<h4>Projekty</h4><ul>' + data.projects.map((p) => '<li><code>' + escape(p) + '</code></li>').join("") + '</ul>');
      }
      if (Array.isArray(data.issues) && data.issues.length > 0) {
        sections.push('<h4>Úkoly</h4><ul>' + data.issues.map((i) => '<li><code>' + escape(i) + '</code></li>').join("") + '</ul>');
      }
      if (Array.isArray(data.statuses) && data.statuses.length > 0) {
        sections.push('<h4>Stavy</h4><ul>' + data.statuses.map((s) => (
          '<li><code>' + escape(s.id) + '</code> · ' + escape(s.name) + ' <span class="pill pill-soft">' + escape(categoryLabel(s.category)) + '</span></li>'
        )).join("") + '</ul>');
      }
      if (data.entity_type && data.filters) {
        sections.push('<h4>Cíl pohledu</h4><div class="help">' + escape(ENTITY_SINGULAR[data.entity_type] || data.entity_type) + ' · ' + (asArray(data.filters).length) + ' filtrů · zobrazení: ' + escape(displayLabel(data.display || "list")) + '</div>');
      }
      if (data.message) {
        sections.push('<h4>Zpráva</h4><div class="description">' + escape(data.message) + '</div>');
      }
      if (data.planning) {
        sections.push('<h4>Vazba na plánování</h4><dl class="meta-grid">' +
          (data.planning.plan_id ? '<dt>ID plánu</dt><dd><code>' + escape(data.planning.plan_id) + '</code></dd>' : '') +
          (data.planning.path ? '<dt>Cesta</dt><dd><code>' + escape(data.planning.path) + '</code></dd>' : '') +
          (data.planning.source ? '<dt>Zdroj</dt><dd>' + escape(data.planning.source) + '</dd>' : '') +
        '</dl>');
      }
      if (data.planning_source && (data.planning_source.plan_id || data.planning_source.path)) {
        sections.push('<h4>Zdroj plánování</h4><dl class="meta-grid">' +
          (data.planning_source.plan_id ? '<dt>ID plánu</dt><dd><code>' + escape(data.planning_source.plan_id) + '</code></dd>' : '') +
          (data.planning_source.path ? '<dt>Cesta</dt><dd><code>' + escape(data.planning_source.path) + '</code></dd>' : '') +
        '</dl>');
      }
      if (Array.isArray(data.links) && data.links.length > 0) {
        sections.push('<h4>Odkazy</h4><ul class="links-list">' + data.links.map(renderLink).join("") + '</ul>');
      }
      sections.push(renderValidationBlock(record.validation));

      return head + pills + meta + sections.join("");
    }

    function renderScopeBlock(scope) {
      const inItems = asArray(scope.in);
      const outItems = asArray(scope.out);
      return (
        '<h4>Rozsah</h4>' +
        '<div class="scope-grid">' +
          '<div><h6>Uvnitř</h6>' + (inItems.length > 0
            ? '<ul>' + inItems.map((i) => '<li>' + escape(i) + '</li>').join("") + '</ul>'
            : '<p class="help">—</p>') + '</div>' +
          '<div><h6>Mimo</h6>' + (outItems.length > 0
            ? '<ul>' + outItems.map((i) => '<li>' + escape(i) + '</li>').join("") + '</ul>'
            : '<p class="help">—</p>') + '</div>' +
        '</div>'
      );
    }

    function renderPlanInspector(record) {
      const plan = record.plan;
      const head = (
        '<div class="inspector-head">' +
          '<div>' +
            '<div class="row-id"><code>' + escape(plan.id) + '</code></div>' +
            '<h2>' + escape(plan.title) + '</h2>' +
          '</div>' +
          '<button type="button" class="close" aria-label="Zavřít">×</button>' +
        '</div>'
      );
      const pills = (
        '<div class="pill-row">' +
          '<span class="pill pill-type">' + escape(planTypeLabel(plan.type)) + '</span>' +
          '<span class="pill pill-status" data-status="' + escape(plan.status) + '">' + escape(statusLabel(plan.status)) + '</span>' +
          (record.validation && !record.validation.ok ? '<span class="pill pill-invalid">neplatné</span>' : '') +
        '</div>'
      );
      const meta = (
        '<dl class="meta-grid">' +
          '<dt>Vlastník</dt><dd>' + escape(plan.owner) + '</dd>' +
          '<dt>Vytvořeno</dt><dd>' + escape(plan.created_at) + '</dd>' +
          '<dt>Upraveno</dt><dd>' + escape(plan.updated_at) + '</dd>' +
          '<dt>Soubor</dt><dd><code>' + escape(record.relativePath) + '</code></dd>' +
          (plan.planning_target ? '<dt>Cíl</dt><dd><code>' + escape(plan.planning_target.scope) + '</code>' +
            (plan.planning_target.todo_tasks_path ? '<br><code>' + escape(plan.planning_target.todo_tasks_path) + '</code>' : '') + '</dd>' : '') +
        '</dl>'
      );
      const sections = [];
      if (plan.context) sections.push('<h4>Kontext</h4><div class="context">' + escape(plan.context) + '</div>');
      if (Array.isArray(plan.goals) && plan.goals.length > 0) {
        sections.push('<h4>Cíle</h4><ul>' + plan.goals.map((g) => '<li>' + escape(g) + '</li>').join("") + '</ul>');
      }
      if (plan.scope && (plan.scope.in || plan.scope.out)) sections.push(renderScopeBlock(plan.scope));
      if (Array.isArray(plan.acceptance_criteria) && plan.acceptance_criteria.length > 0) {
        sections.push('<h4>Akceptační kritéria</h4><ul>' + plan.acceptance_criteria.map((c) => '<li>' + escape(c) + '</li>').join("") + '</ul>');
      }
      if (Array.isArray(plan.risk_notes) && plan.risk_notes.length > 0) {
        sections.push('<h4>Rizika</h4><ul>' + plan.risk_notes.map((r) => '<li>' + escape(r) + '</li>').join("") + '</ul>');
      }
      if (Array.isArray(plan.decisions) && plan.decisions.length > 0) {
        sections.push('<h4>Rozhodnutí</h4><div class="detail-list">' + plan.decisions.map((d) => (
          '<div class="detail-item"><strong>' + escape(d.date) + '</strong> ' + escape(d.decision) +
          (d.rationale ? '<div class="help">' + escape(d.rationale) + '</div>' : '') + '</div>'
        )).join("") + '</div>');
      }
      if (Array.isArray(plan.proposed_tasks) && plan.proposed_tasks.length > 0) {
        sections.push('<h4>Navrhované TODO úkoly</h4><div class="detail-list">' + plan.proposed_tasks.map((t) => (
          '<div class="detail-item"><strong>' + escape(t.title) + '</strong>' +
          (t.priority ? ' <span class="pill pill-priority" data-priority="' + escape(t.priority) + '">' + escape(priorityLabel(t.priority)) + '</span>' : '') +
          '<div>' + escape(t.summary) + '</div></div>'
        )).join("") + '</div>');
      }
      if (Array.isArray(plan.tags) && plan.tags.length > 0) {
        sections.push('<h4>Tagy</h4><div class="tag-row">' + plan.tags.map((t) => '<span class="tag">' + escape(t) + '</span>').join("") + '</div>');
      }
      if (Array.isArray(plan.todo_outputs) && plan.todo_outputs.length > 0) {
        sections.push('<h4>Výstupy TODO</h4><ul>' + plan.todo_outputs.map((id) => '<li><code>' + escape(id) + '</code></li>').join("") + '</ul>');
      }
      if (Array.isArray(plan.links) && plan.links.length > 0) {
        sections.push('<h4>Odkazy</h4><ul class="links-list">' + plan.links.map(renderLink).join("") + '</ul>');
      }
      if (plan.outcome) sections.push('<h4>Výsledek</h4><div class="context">' + escape(plan.outcome) + '</div>');
      sections.push(renderValidationBlock(record.validation));

      const actions = (
        '<div class="actions">' +
          '<button type="button" class="primary" data-plan-edit="' + escape(plan.id) + '">Upravit</button>' +
          '<button type="button" data-plan-export="' + escape(plan.id) + '">Zkušební export</button>' +
        '</div>'
      );

      return head + pills + meta + sections.join("") + actions;
    }

    function attachPlanInspectorHandlers(record) {
      inspectorEl.querySelector("[data-plan-edit]")?.addEventListener("click", () => openEditModal(record));
      inspectorEl.querySelector("[data-plan-export]")?.addEventListener("click", () => runExport(record));
    }

    function renderLink(link) {
      const text = link.path ? '<code>' + escape(link.path) + '</code>' : escape(link.url || "");
      return '<li><strong>' + escape(link.label) + ':</strong> ' + (link.url
        ? '<a href="' + escape(link.url) + '" target="_blank" rel="noopener">' + text + '</a>'
        : text) + '</li>';
    }

    function renderValidationBlock(validation) {
      if (!validation) return "";
      if (validation.ok) {
        return '<div class="validation ok"><h5>Validace OK</h5></div>';
      }
      return (
        '<div class="validation"><h5>Validace</h5><ul>' +
          asArray(validation.errors).map((err) => (
            '<li><code>' + escape(err.path) + '</code> — ' + escape(err.message) + '</li>'
          )).join("") +
        '</ul></div>'
      );
    }

    /* ---------- Plan modal (preserved from V1) ---------- */
    function closeModal() {
      modalRoot.replaceChildren();
    }

    function openModal(node) {
      const backdrop = document.createElement("div");
      backdrop.className = "modal-backdrop";
      backdrop.addEventListener("click", (event) => {
        if (event.target === backdrop) closeModal();
      });
      const modal = document.createElement("div");
      modal.className = "modal";
      modal.appendChild(node);
      backdrop.appendChild(modal);
      modalRoot.replaceChildren(backdrop);
    }

    function buildPlanForm(prefill) {
      const data = prefill || {};
      const wrap = document.createElement("div");
      wrap.innerHTML = (
        '<h2>' + (data.id ? 'Upravit plán' : 'Nový plán') + '</h2>' +
        '<form id="plan-form">' +
          '<div class="row">' +
            '<label>Název<input name="title" required value="' + escape(data.title || "") + '" /></label>' +
            '<label>Typ<select name="type">' + PLAN_TYPES.map((t) => (
              '<option value="' + t + '"' + (data.type === t ? ' selected' : '') + '>' + planTypeLabel(t) + '</option>'
            )).join("") + '</select></label>' +
            '<label>Stav<select name="status">' + PLAN_STATUSES.map((s) => (
              '<option value="' + s + '"' + (data.status === s ? ' selected' : '') + '>' + statusLabel(s) + '</option>'
            )).join("") + '</select></label>' +
            '<label>Vlastník<input name="owner" value="' + escape(data.owner || "jannovak") + '" /></label>' +
          '</div>' +
          '<label>Kontext<textarea name="context" rows="4">' + escape(data.context || "") + '</textarea></label>' +
          '<label>Cíle (každý na nový řádek)<textarea name="goals" rows="3">' + escape((data.goals || []).join("\n")) + '</textarea></label>' +
          '<div class="row">' +
            '<label>Rozsah uvnitř<textarea name="scope_in" rows="3">' + escape((data.scope?.in || []).join("\n")) + '</textarea></label>' +
            '<label>Rozsah mimo<textarea name="scope_out" rows="3">' + escape((data.scope?.out || []).join("\n")) + '</textarea></label>' +
          '</div>' +
          '<label>Akceptační kritéria (jedno na řádek)<textarea name="acceptance_criteria" rows="4">' + escape((data.acceptance_criteria || []).join("\n")) + '</textarea></label>' +
          '<label>Rizika (jedno na řádek)<textarea name="risk_notes" rows="3">' + escape((data.risk_notes || []).join("\n")) + '</textarea></label>' +
          '<label>Tagy (jeden na řádek)<textarea name="tags" rows="2">' + escape((data.tags || []).join("\n")) + '</textarea></label>' +
          '<label>Odkazy (název | cesta nebo název | url=...)<textarea name="links" rows="3">' + escape((data.links || []).map(formatLinkLine).join("\n")) + '</textarea></label>' +
          '<div class="row">' +
            '<label>Cílový rozsah plánování<input name="planning_scope" value="' + escape(data.planning_target?.scope || "") + '" placeholder="např. agentmint-mission-control" /></label>' +
            '<label>Cesta k cílovému TODO<input name="planning_path" value="' + escape(data.planning_target?.todo_tasks_path || "") + '" placeholder="např. mission-control/TODO.tasks.json" /></label>' +
          '</div>' +
          '<label>Navrhované TODO úkoly (titulek | shrnutí)<textarea name="proposed_tasks" rows="3">' + escape((data.proposed_tasks || []).map(formatProposedTask).join("\n")) + '</textarea></label>' +
          (data.id ? '<label>Výstupy TODO (jeden na řádek)<textarea name="todo_outputs" rows="2">' + escape((data.todo_outputs || []).join("\n")) + '</textarea></label>' : '') +
          (data.id ? '<label>Výsledek<textarea name="outcome" rows="3">' + escape(data.outcome || "") + '</textarea></label>' : '') +
          '<div class="modal-actions">' +
            '<button type="button" class="ghost" id="cancel-form">Zrušit</button>' +
            '<button type="submit" class="primary">' + (data.id ? 'Uložit změny' : 'Založit plán') + '</button>' +
          '</div>' +
          '<div id="form-feedback"></div>' +
        '</form>'
      );
      return wrap;
    }

    function formatLinkLine(link) {
      if (!link) return "";
      if (link.url) return link.label + " | url=" + link.url;
      return link.label + " | " + (link.path || "");
    }

    function formatProposedTask(task) {
      if (!task) return "";
      return (task.title || "") + " | " + (task.summary || "");
    }

    function parseLines(value) {
      return String(value || "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    }

    function parseLinkLines(value) {
      return parseLines(value).map((line) => {
        const sep = line.indexOf("|");
        if (sep < 0) return null;
        const label = line.slice(0, sep).trim();
        const rest = line.slice(sep + 1).trim();
        if (!label || !rest) return null;
        if (rest.startsWith("url=")) return { label, url: rest.slice(4).trim() };
        return { label, path: rest };
      }).filter(Boolean);
    }

    function parseProposedTasks(value) {
      return parseLines(value).map((line) => {
        const sep = line.indexOf("|");
        if (sep < 0) return { title: line, summary: line };
        const title = line.slice(0, sep).trim();
        const summary = line.slice(sep + 1).trim();
        return title && summary ? { title, summary } : null;
      }).filter(Boolean);
    }

    function collectFormPayload(form) {
      const data = new FormData(form);
      const payload = {
        title: data.get("title"),
        type: data.get("type"),
        status: data.get("status"),
        owner: data.get("owner"),
        context: data.get("context"),
        goals: parseLines(data.get("goals")),
        scope: {
          in: parseLines(data.get("scope_in")),
          out: parseLines(data.get("scope_out")),
        },
        acceptance_criteria: parseLines(data.get("acceptance_criteria")),
        risk_notes: parseLines(data.get("risk_notes")),
        tags: parseLines(data.get("tags")),
        links: parseLinkLines(data.get("links")),
        proposed_tasks: parseProposedTasks(data.get("proposed_tasks")),
      };
      const scopeTarget = (data.get("planning_scope") || "").toString().trim();
      const pathTarget = (data.get("planning_path") || "").toString().trim();
      if (scopeTarget) {
        payload.planning_target = { scope: scopeTarget };
        if (pathTarget) payload.planning_target.todo_tasks_path = pathTarget;
      }
      const todoOutputs = data.get("todo_outputs");
      if (todoOutputs !== null) payload.todo_outputs = parseLines(todoOutputs);
      const outcome = data.get("outcome");
      if (outcome !== null) payload.outcome = String(outcome);
      return payload;
    }

    function showFormFeedback(form, error) {
      const feedback = form.querySelector("#form-feedback");
      const payload = error.payload || {};
      const errors = Array.isArray(payload.errors) ? payload.errors : null;
      if (errors && errors.length > 0) {
        feedback.innerHTML = '<div class="validation"><h5>Plán neprošel validací</h5><ul>' +
          errors.map((err) => '<li><code>' + escape(err.path) + '</code> — ' + escape(err.message) + '</li>').join("") +
          '</ul></div>';
        return;
      }
      feedback.innerHTML = '<div class="validation"><h5>Chyba</h5>' + escape(error.message || "Neznámá chyba") + '</div>';
    }

    function openNewPlanModal() {
      const node = buildPlanForm(null);
      openModal(node);
      const form = node.querySelector("#plan-form");
      node.querySelector("#cancel-form").addEventListener("click", closeModal);
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const payload = collectFormPayload(form);
        try {
          const result = await api("POST", "/api/plans", payload);
          delete state.planRecords[result.record.plan.id];
          await loadPlans();
          toast("Plán založen");
          closeModal();
          navigate("plans", result.record.plan.id);
        } catch (error) {
          showFormFeedback(form, error);
        }
      });
    }

    function openEditModal(record) {
      const node = buildPlanForm(record.plan);
      openModal(node);
      const form = node.querySelector("#plan-form");
      node.querySelector("#cancel-form").addEventListener("click", closeModal);
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const payload = collectFormPayload(form);
        try {
          const result = await api("PUT", "/api/plans/" + encodeURIComponent(record.plan.id), payload);
          state.planRecords[record.plan.id] = result.record;
          await loadPlans();
          toast("Plán uložen");
          closeModal();
          navigate("plans", record.plan.id);
        } catch (error) {
          showFormFeedback(form, error);
        }
      });
    }

    async function runExport(record) {
      const node = document.createElement("div");
      node.innerHTML = '<h2>Zkušební export do TODO.tasks.json</h2>' +
        '<p class="help">Plán: <code>' + escape(record.relativePath) + '</code></p>' +
        '<div id="export-status" class="loading">Spouštím export…</div>';
      openModal(node);
      try {
        const result = await api("POST", "/api/plans/" + encodeURIComponent(record.plan.id) + "/export");
        node.querySelector("#export-status").outerHTML = (
          (result.target ? '<p class="help">Cílový rozsah: <code>' + escape(result.target.scope) + '</code>' +
            (result.target.todo_tasks_path ? ' → <code>' + escape(result.target.todo_tasks_path) + '</code>' : '') + '</p>' : '') +
          (result.warnings && result.warnings.length > 0
            ? '<div class="validation"><h5>Varování</h5><ul>' + result.warnings.map((w) => '<li>' + escape(w) + '</li>').join("") + '</ul></div>'
            : '') +
          '<h4>Návrh úkolů (' + (result.proposed_tasks?.length || 0) + ')</h4>' +
          '<pre class="export-output">' + escape(JSON.stringify(result.proposed_tasks || [], null, 2)) + '</pre>' +
          '<div class="modal-actions"><button type="button" class="primary" id="close-export">Zavřít</button></div>'
        );
        node.querySelector("#close-export").addEventListener("click", closeModal);
      } catch (error) {
        node.querySelector("#export-status").outerHTML = '<div class="validation"><h5>Export selhal</h5>' + escape(error.message) +
          '<div class="modal-actions"><button type="button" class="primary" id="close-export">Zavřít</button></div></div>';
        node.querySelector("#close-export").addEventListener("click", closeModal);
      }
    }

    /* ---------- Boot ---------- */
    async function boot() {
      try {
        await Promise.all([
          loadPlans(),
          loadEntities(),
          loadWorkBoard(),
          fetchEntityList("view").catch(() => null),
          fetchEntityList("team").catch(() => null),
          fetchEntityList("issue").catch(() => null),
          fetchEntityList("triage_item").catch(() => null),
        ]);
        if (!window.location.hash) {
          window.location.hash = "#/strategy";
        }
        handleRoute();
      } catch (error) {
        state.bootError = error.message || "Neznámá chyba";
        render();
      }
    }

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeModal();
    });

    boot();
  `;
}
