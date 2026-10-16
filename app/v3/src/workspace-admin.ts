// Browser-safe modul: žádné node importy, soubor smí importovat i UI.
// Efektivní hodnotu drží mission-control.config.json (organization_admin,
// s kompatibilním fallbackem workspace_admin);
// server ji skládá v issue-resolution.ts a UI ji dostává v agent-work
// payloadu. Tohle je jen fallback pro configy bez pole.
export const DEFAULT_ORGANIZATION_ADMIN_ID = 'workspace-admin';
export const DEFAULT_WORKSPACE_ADMIN_ID = DEFAULT_ORGANIZATION_ADMIN_ID;
