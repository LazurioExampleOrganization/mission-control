// Read-only readiness of the preparation (Lazurio Module Standard, `check_script`):
// the client build the server serves must exist. Exit 0 when prepared, 1 otherwise.
import { resolve } from 'node:path';

const index = resolve(import.meta.dir, '../dist/index.html');
if (!(await Bun.file(index).exists())) {
	console.error(`not prepared: ${index} is missing; run \`bun run prepare:app\``);
	process.exit(1);
}
