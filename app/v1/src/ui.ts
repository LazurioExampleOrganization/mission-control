import { stylesheet } from "./ui-styles.ts";
import { clientScript } from "./ui-client.ts";

export function renderApp(): string {
	return `<!doctype html>
<html lang="cs">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Mission Control</title>
    <style>${stylesheet()}</style>
  </head>
  <body>
    <div class="app" data-app-state="booting">
      <header class="topbar">
        <div class="brand">
          <div class="mark">MC</div>
          <div>
            <h1>Mission Control</h1>
            <p class="subtitle">Plánování a řízení práce AgentMintu</p>
          </div>
        </div>
        <div class="topbar-actions">
          <button type="button" class="menu-button" id="menu-button" aria-label="Otevřít navigaci">☰</button>
          <div class="role-lens" id="role-lens"></div>
        </div>
      </header>
      <div class="layout">
        <aside class="sidebar" id="sidebar" aria-label="Navigace">
          <div class="sidebar-loading">Načítám…</div>
        </aside>
        <main class="content" id="content">
          <div class="loading">Načítám Mission Control…</div>
        </main>
        <aside class="inspector hidden" id="inspector" aria-label="Detail">
        </aside>
      </div>
    </div>
    <div id="modal-root"></div>
    <div id="toast-root"></div>
    <script>${clientScript()}</script>
  </body>
</html>`;
}
