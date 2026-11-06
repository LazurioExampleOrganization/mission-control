// Read-only readiness of the preparation (Module Standard, `check_script`):
// the dependencies the App runs on are installed. The client build of the
// built version is the Platform's `build_script`, never a preparation step.
import { resolve } from "node:path";

const required = ["@lazurio/repository-db", "@lazurio/module-kit", "react", "zod"];
const missing: string[] = [];
for (const name of required) {
  const manifest = resolve(import.meta.dir, "..", "node_modules", name, "package.json");
  if (!(await Bun.file(manifest).exists())) missing.push(name);
}
if (missing.length > 0) {
  console.error(
    `not prepared: ${missing.join(", ")} not installed; run \`bun install --frozen-lockfile\``,
  );
  process.exit(1);
}
