export function stylesheet(): string {
	return `
    :root {
      color-scheme: light;
      --bg: #f7f8fb;
      --panel: #ffffff;
      --panel-soft: #f8fafc;
      --ink: #172033;
      --ink-soft: #334155;
      --muted: #667085;
      --line: #e2e8f0;
      --line-strong: #cbd5e1;
      --blue: #2563eb;
      --blue-soft: #eff6ff;
      --green: #0f9f6e;
      --green-soft: #ecfdf3;
      --amber: #b7791f;
      --amber-soft: #fff7ed;
      --red: #dc2626;
      --red-soft: #fef2f2;
      --slate: #475569;
      --shadow-sm: 0 1px 2px rgba(15, 23, 42, 0.06);
      --shadow-lg: 0 20px 60px rgba(15, 23, 42, 0.2);
      --sidebar-w: 244px;
      --inspector-w: 380px;
      --topbar-h: 56px;
    }
    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body {
      margin: 0;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--ink);
      background: var(--bg);
      font-size: 14px;
    }
    .app {
      display: grid;
      grid-template-rows: var(--topbar-h) 1fr;
      height: 100vh;
      overflow: hidden;
    }
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 18px;
      background: #ffffff;
      border-bottom: 1px solid var(--line);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .mark {
      display: grid;
      place-items: center;
      width: 34px;
      height: 34px;
      border-radius: 8px;
      background: var(--blue-soft);
      color: var(--blue);
      font-weight: 800;
      font-size: 13px;
      letter-spacing: 0.04em;
    }
    .brand h1 { margin: 0; font-size: 15px; }
    .subtitle { margin: 1px 0 0; color: var(--muted); font-size: 12px; }
    .topbar-actions { display: flex; align-items: center; gap: 8px; }
    .menu-button {
      display: none;
      width: 34px;
      height: 34px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      color: var(--ink);
      font: inherit;
      font-size: 18px;
      line-height: 1;
      cursor: pointer;
    }
    .role-lens {
      display: inline-flex;
      gap: 4px;
      padding: 3px;
      background: var(--bg);
      border: 1px solid var(--line);
      border-radius: 8px;
    }
    .role-lens button {
      border: 0;
      background: transparent;
      padding: 5px 10px;
      font: inherit;
      font-size: 12px;
      font-weight: 600;
      color: var(--muted);
      border-radius: 6px;
      cursor: pointer;
    }
    .role-lens button.is-active {
      background: var(--panel);
      color: var(--ink);
      box-shadow: var(--shadow-sm);
    }
    .layout {
      display: grid;
      grid-template-columns: var(--sidebar-w) 1fr;
      height: calc(100vh - var(--topbar-h));
      overflow: hidden;
    }
    .layout.with-inspector {
      grid-template-columns: var(--sidebar-w) 1fr var(--inspector-w);
    }
    .sidebar {
      border-right: 1px solid var(--line);
      background: #ffffff;
      padding: 14px 10px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .sidebar-loading { color: var(--muted); padding: 8px; }
    .sidebar-section {
      display: flex;
      flex-direction: column;
      gap: 2px;
      margin-bottom: 6px;
    }
    .sidebar-section h3 {
      margin: 8px 6px 4px;
      font-size: 10px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--muted);
      font-weight: 700;
    }
    .nav-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 6px 8px;
      border-radius: 6px;
      color: var(--ink-soft);
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      border: 1px solid transparent;
      background: transparent;
      text-align: left;
      width: 100%;
    }
    .nav-item:hover {
      background: var(--bg);
    }
    .nav-item.is-active {
      background: var(--blue-soft);
      color: var(--blue);
      border-color: rgba(37, 99, 235, 0.18);
      font-weight: 600;
    }
    .nav-item .label { flex: 1; min-width: 0; }
    .nav-item .count {
      font-size: 11px;
      color: var(--muted);
      background: var(--bg);
      padding: 1px 7px;
      border-radius: 999px;
      font-variant-numeric: tabular-nums;
    }
    .nav-item.is-active .count { color: var(--blue); background: rgba(37, 99, 235, 0.12); }
    .nav-item .count.warn { color: var(--red); background: var(--red-soft); }
    .sidebar-footer {
      margin-top: auto;
      padding: 10px 8px;
      color: var(--muted);
      font-size: 11px;
      border-top: 1px solid var(--line);
    }
    .sidebar-footer code { font-size: 11px; }
    .content {
      overflow-y: auto;
      padding: 18px 22px 60px;
    }
    .view-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 18px;
      flex-wrap: wrap;
      padding-bottom: 14px;
      border-bottom: 1px solid var(--line);
      margin-bottom: 16px;
    }
    .view-header h2 { margin: 0; font-size: 18px; }
    .view-header p { margin: 4px 0 0; color: var(--muted); font-size: 13px; }
    .view-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .view-toolbar {
      display: flex;
      gap: 8px;
      align-items: center;
      margin-bottom: 12px;
      flex-wrap: wrap;
    }
    .filter-chips { display: inline-flex; gap: 6px; flex-wrap: wrap; }
    .chip {
      border: 1px solid var(--line);
      background: var(--panel);
      border-radius: 999px;
      padding: 3px 11px;
      font-size: 12px;
      font-weight: 500;
      color: var(--ink-soft);
      cursor: pointer;
    }
    .chip:hover { border-color: var(--line-strong); }
    .chip.is-active {
      background: var(--ink);
      color: #fff;
      border-color: var(--ink);
    }
    .chip .count { font-size: 11px; opacity: 0.7; margin-left: 4px; font-variant-numeric: tabular-nums; }
    .toggle-group {
      display: inline-flex;
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow: hidden;
    }
    .toggle-group button {
      border: 0;
      background: var(--panel);
      padding: 5px 12px;
      font: inherit;
      font-size: 12px;
      font-weight: 600;
      color: var(--muted);
      cursor: pointer;
    }
    .toggle-group button.is-active { background: var(--ink); color: #fff; }
    .entity-list {
      display: grid;
      gap: 0;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: var(--panel);
      overflow: hidden;
    }
    .list-row {
      display: grid;
      grid-template-columns: minmax(110px, auto) minmax(0, 1fr) auto;
      align-items: center;
      gap: 14px;
      padding: 10px 14px;
      border-bottom: 1px solid var(--line);
      cursor: pointer;
      transition: background 80ms ease;
    }
    .list-row:last-child { border-bottom: 0; }
    .list-row:hover { background: var(--panel-soft); }
    .list-row.is-active { background: var(--blue-soft); }
    .list-row .row-id { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: var(--muted); }
    .list-row .row-title { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .list-row .row-title strong { font-size: 14px; font-weight: 600; }
    .list-row .row-title .row-meta { display: flex; gap: 8px; flex-wrap: wrap; color: var(--muted); font-size: 12px; }
    .list-row .row-side { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .row-side .row-date { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
    .pill {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      padding: 2px 9px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .pill-type { background: var(--blue-soft); color: var(--blue); }
    .pill-priority {
      background: var(--bg);
      color: var(--ink-soft);
    }
    .pill-priority[data-priority="urgent"], .pill-priority[data-priority="high"] {
      background: var(--red-soft);
      color: var(--red);
    }
    .pill-priority[data-priority="medium"] { background: var(--amber-soft); color: var(--amber); }
    .pill-priority[data-priority="low"], .pill-priority[data-priority="none"] {
      background: var(--bg); color: var(--muted);
    }
    .pill-status[data-status="backlog"] { background: #f1f5f9; color: var(--slate); }
    .pill-status[data-status="todo"] { background: #f1f5f9; color: var(--slate); }
    .pill-status[data-status="unstarted"] { background: #f1f5f9; color: var(--slate); }
    .pill-status[data-status="started"] { background: var(--blue-soft); color: var(--blue); }
    .pill-status[data-status="in_progress"] { background: var(--blue-soft); color: var(--blue); }
    .pill-status[data-status="in_review"] { background: var(--amber-soft); color: var(--amber); }
    .pill-status[data-status="active"] { background: var(--blue-soft); color: var(--blue); }
    .pill-status[data-status="shaping"] { background: var(--amber-soft); color: var(--amber); }
    .pill-status[data-status="ready"] { background: var(--blue-soft); color: var(--blue); }
    .pill-status[data-status="blocked"] { background: var(--red-soft); color: var(--red); }
    .pill-status[data-status="paused"] { background: var(--amber-soft); color: var(--amber); }
    .pill-status[data-status="done"], .pill-status[data-status="completed"] { background: var(--green-soft); color: var(--green); }
    .pill-status[data-status="canceled"], .pill-status[data-status="archived"] { background: var(--bg); color: var(--muted); }
    .pill-status[data-status="open"] { background: var(--amber-soft); color: var(--amber); }
    .pill-status[data-status="triaged"] { background: var(--blue-soft); color: var(--blue); }
    .pill-status[data-status="rejected"], .pill-status[data-status="duplicate"], .pill-status[data-status="deferred"] {
      background: var(--bg); color: var(--muted);
    }
    .pill-invalid { background: var(--red-soft); color: var(--red); }
    .pill-soft { background: var(--bg); color: var(--ink-soft); }
    .empty-state {
      padding: 50px 24px;
      text-align: center;
      color: var(--muted);
      background: var(--panel);
      border: 1px dashed var(--line);
      border-radius: 10px;
    }
    .empty-state h3 { margin: 0 0 6px; color: var(--ink-soft); font-size: 15px; }
    .empty-state p { margin: 0 auto; max-width: 460px; }
    .loading { padding: 40px; text-align: center; color: var(--muted); }
    .board {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 12px;
    }
    .board-column {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 10px;
      min-height: 80px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .board-column-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0 2px 6px;
      border-bottom: 1px solid var(--line);
    }
    .board-column-head h4 { margin: 0; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
    .board-column-head .count { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
    .board-card {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 9px 10px;
      background: var(--panel-soft);
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .board-card:hover { border-color: var(--line-strong); }
    .board-card.is-active { border-color: var(--blue); box-shadow: 0 0 0 2px var(--blue-soft); }
    .board-card .row-id { font-size: 11px; color: var(--muted); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .board-card h5 { margin: 0; font-size: 13px; }
    .board-card .row-meta { display: flex; gap: 6px; flex-wrap: wrap; font-size: 11px; color: var(--muted); }
    .inspector {
      border-left: 1px solid var(--line);
      background: var(--panel);
      overflow-y: auto;
      padding: 18px 20px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .inspector.hidden { display: none; }
    .inspector-head {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 10px;
    }
    .inspector-head .row-id { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: var(--muted); }
    .inspector-head h2 { margin: 4px 0 0; font-size: 16px; line-height: 1.3; }
    .inspector-head .close {
      border: 1px solid var(--line);
      background: var(--panel);
      width: 28px;
      height: 28px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
      color: var(--muted);
      display: grid;
      place-items: center;
    }
    .inspector-head .close:hover { color: var(--ink); }
    .inspector .pill-row { display: flex; gap: 6px; flex-wrap: wrap; }
    .inspector .meta-grid {
      display: grid;
      grid-template-columns: 100px minmax(0, 1fr);
      gap: 6px 12px;
      font-size: 13px;
    }
    .inspector .meta-grid dt { color: var(--muted); }
    .inspector .meta-grid dd { margin: 0; word-break: break-word; }
    .inspector .meta-grid code { font-size: 11px; }
    .inspector h4 {
      margin: 6px 0 4px;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--muted);
    }
    .inspector .context, .inspector .description {
      background: var(--panel-soft);
      border-left: 3px solid var(--blue);
      padding: 10px 12px;
      border-radius: 0 8px 8px 0;
      color: var(--ink-soft);
      line-height: 1.55;
      white-space: pre-wrap;
      font-size: 13px;
    }
    .inspector ul {
      padding-left: 16px;
      margin: 0;
      font-size: 13px;
      line-height: 1.55;
      color: var(--ink-soft);
    }
    .inspector .links-list {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 13px;
    }
    .inspector .links-list a { color: var(--blue); text-decoration: none; }
    .inspector .links-list a:hover { text-decoration: underline; }
    .inspector .links-list code { background: var(--bg); padding: 1px 5px; border-radius: 4px; font-size: 11px; }
    .inspector .actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .inspector .actions button { font-size: 12px; }
    .inspector .tag-row, .tag-row {
      display: flex; flex-wrap: wrap; gap: 4px;
    }
    .tag {
      background: var(--bg);
      color: var(--ink-soft);
      padding: 2px 8px;
      font-size: 11px;
      border-radius: 999px;
    }
    .scope-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .scope-grid h6 { margin: 0 0 4px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
    .detail-list {
      display: flex; flex-direction: column; gap: 8px;
    }
    .detail-item {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 8px 10px;
      font-size: 13px;
      background: var(--panel-soft);
    }
    .validation {
      margin-top: 6px;
      padding: 10px 12px;
      border-radius: 8px;
      border: 1px solid var(--red);
      background: var(--red-soft);
      font-size: 12px;
    }
    .validation h5 { margin: 0 0 4px; font-size: 11px; text-transform: uppercase; color: var(--red); }
    .validation ul { padding-left: 16px; color: var(--ink); margin: 0; }
    .validation code { font-size: 11px; }
    .validation.ok { border-color: var(--green); background: var(--green-soft); }
    .validation.ok h5 { color: var(--green); }
    button {
      font: inherit;
      cursor: pointer;
      border: 1px solid var(--line);
      background: var(--panel);
      color: var(--ink);
      border-radius: 8px;
      padding: 7px 12px;
      font-weight: 600;
      font-size: 13px;
    }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    button:hover:not(:disabled) { border-color: var(--line-strong); }
    button.primary { background: var(--blue); color: #fff; border-color: var(--blue); }
    button.primary:hover:not(:disabled) { background: #1d4ed8; border-color: #1d4ed8; }
    button.ghost { background: transparent; }
    button.danger { background: var(--red); color: #fff; border-color: var(--red); }
    button.small { padding: 4px 9px; font-size: 12px; }
    .modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.4);
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding: 40px 16px;
      z-index: 20;
      overflow-y: auto;
    }
    .modal {
      background: #fff;
      border-radius: 12px;
      width: min(720px, 100%);
      box-shadow: var(--shadow-lg);
      padding: 22px 24px 26px;
    }
    .modal h2 { margin: 0 0 14px; font-size: 17px; }
    .modal-actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
      margin-top: 16px;
      flex-wrap: wrap;
    }
    form { display: grid; gap: 12px; }
    label {
      display: grid;
      gap: 5px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--muted);
    }
    input, textarea, select {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 9px 11px;
      font: inherit;
      color: var(--ink);
      background: var(--panel);
      font-weight: 500;
      text-transform: none;
      letter-spacing: 0;
      font-size: 13px;
    }
    textarea { min-height: 90px; resize: vertical; font-family: inherit; }
    .row { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
    .help {
      font-size: 11px;
      color: var(--muted);
      font-weight: 400;
      text-transform: none;
      letter-spacing: 0;
    }
    .export-output {
      margin-top: 10px;
      background: #0f172a;
      color: #f1f5f9;
      border-radius: 8px;
      padding: 12px 14px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      max-height: 280px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .toast {
      position: fixed;
      bottom: 22px;
      right: 22px;
      background: var(--ink);
      color: #fff;
      padding: 10px 16px;
      border-radius: 8px;
      box-shadow: var(--shadow-lg);
      font-size: 13px;
      z-index: 30;
    }
    .strategy-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.4fr) minmax(280px, 0.8fr);
      gap: 18px;
      align-items: start;
    }
    /* Work board */
    .work-board { display: flex; flex-direction: column; gap: 12px; }
    .ledger-strip {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 10px;
    }
    .ledger-metric {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 10px 12px;
    }
    .ledger-metric strong { display: block; font-size: 20px; line-height: 1.1; }
    .ledger-metric span {
      color: var(--muted);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .kanban {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 10px;
    }
    .kanban-column {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .column-head {
      display: flex;
      justify-content: space-between;
      padding-bottom: 6px;
      border-bottom: 1px solid var(--line);
    }
    .column-head h3 { margin: 0; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
    .column-count { font-size: 12px; color: var(--muted); }
    .work-cards { display: flex; flex-direction: column; gap: 8px; }
    .work-card {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 9px 10px;
      background: var(--panel-soft);
      display: flex;
      flex-direction: column;
      gap: 5px;
      font-size: 12px;
    }
    .work-card.missing-plan { border-color: var(--red); background: var(--red-soft); }
    .work-card h4 { margin: 2px 0 0; font-size: 13px; }
    .work-card code { font-size: 10px; color: var(--muted); background: transparent; padding: 0; }
    .signal-row { display: flex; flex-wrap: wrap; gap: 6px; font-size: 11px; color: var(--muted); }
    .signal { background: var(--bg); padding: 1px 6px; border-radius: 999px; }
    .signal.warn { background: var(--red-soft); color: var(--red); }
    .settings-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 14px;
    }
    .settings-card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 14px 16px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .settings-card h3 { margin: 0; font-size: 14px; }
    .settings-card code { font-size: 11px; color: var(--muted); background: transparent; padding: 0; }
    .group-head {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 18px 0 8px;
      color: var(--muted);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .group-head:first-child { margin-top: 0; }
    .group-head::after {
      content: "";
      flex: 1;
      height: 1px;
      background: var(--line);
    }
    @media (max-width: 1080px) {
      .layout.with-inspector { grid-template-columns: var(--sidebar-w) 1fr; }
      .inspector {
        position: fixed;
        top: var(--topbar-h);
        right: 0;
        width: min(420px, 100vw);
        height: calc(100vh - var(--topbar-h));
        z-index: 8;
        box-shadow: -8px 0 28px rgba(15, 23, 42, 0.12);
      }
    }
    @media (max-width: 760px) {
      .brand .subtitle { display: none; }
      .menu-button { display: inline-grid; place-items: center; }
      .role-lens button { padding: 5px 7px; }
      .strategy-grid { grid-template-columns: 1fr; }
      .layout, .layout.with-inspector { grid-template-columns: 1fr; }
      .sidebar {
        position: fixed;
        top: var(--topbar-h);
        left: 0;
        width: 260px;
        height: calc(100vh - var(--topbar-h));
        z-index: 7;
        box-shadow: 8px 0 28px rgba(15, 23, 42, 0.12);
        transform: translateX(-100%);
        transition: transform 160ms ease;
      }
      .sidebar.is-open { transform: translateX(0); }
    }
  `;
}
