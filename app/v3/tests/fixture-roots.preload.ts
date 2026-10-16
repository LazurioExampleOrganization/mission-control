// Preloaded by `bun test` (bunfig.toml). The App suite runs against the
// reusable DEV fixtures in every checkout: a template, an Organization fork
// with or without its mounted `db/`, and CI without private data. It
// deliberately overwrites inherited live Organization roots, as the root
// `app:test` wrapper does, so `bun test` in app/v3 never reads or writes a
// real Organization data checkout. Tests that need another topology spawn
// their own process with an explicit environment.
import { setDefaultTimeout } from 'bun:test';
import path from 'node:path';

const templateRoot = path.resolve(import.meta.dir, '..', '..', '..');
process.env.MISSION_CONTROL_ROOT = path.join(templateRoot, 'templates', 'organization-data');
process.env.MISSION_CONTROL_WORKSPACE_ROOT = templateRoot;

// Git fixture suites (repository pull, freshness, validator parity) run real
// Git processes; Windows CI needs more than Bun's 5 s default per test.
setDefaultTimeout(60_000);
