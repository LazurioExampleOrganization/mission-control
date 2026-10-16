import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Root tooling wrapper: runs app/v3 package scripts with the Organization data
// roots of this checkout's mode. It deliberately does not start the server:
// the App starts only through its own `dev` script with the Launchpad listener
// environment (Lazurio Module Standard), never through this wrapper.
const COMMANDS = new Map([
  ["build", ["run", "build"]],
  ["typecheck", ["run", "typecheck"]],
  ["check", ["run", "check"]],
  ["validate", ["run", "validate"]],
  ["validate-fixtures", ["run", "validate"]],
  ["test", ["test", "--timeout", "60000", "tests"]],
  ["export", ["run", "export"]],
  ["agent-work", ["run", "agent-work"]],
  ["next-dev-code", ["run", "next-dev-code"]],
  ["create-plan", ["run", "create-plan"]],
  ["plan", ["run", "plan"]],
]);

function missionControlMetadata(root) {
  const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  return packageJson?.companyascode?.mission_control;
}

function organizationDataRoot(missionControlRoot) {
  return existsSync(path.join(missionControlRoot, "repository-db.yaml"))
    ? missionControlRoot
    : path.join(missionControlRoot, "db");
}

function organizationDataPreflight(missionControlRoot) {
  const dataRoot = organizationDataRoot(missionControlRoot);
  const requiredFiles = [
    "repository-db.yaml",
    path.join("scripts", "validate-mission-control-data.mjs"),
  ];
  const missing = requiredFiles.filter((file) => !existsSync(path.join(dataRoot, file)));
  if (missing.length > 0) {
    throw new Error(
      `Mission Control repository-db mount chybí nebo je neúplný v ${dataRoot}; ` +
        `chybí ${missing.join(", ")}`,
    );
  }
  return dataRoot;
}

export function buildV3Invocation({
  root,
  command,
  args = [],
  env = process.env,
  platform = process.platform,
}) {
  const commandArgs = COMMANDS.get(command);
  if (!commandArgs) {
    throw new Error(
      `Unknown app/v3 command "${command}". Expected one of: ${[...COMMANDS.keys()].join(", ")}`,
    );
  }

  const metadata = missionControlMetadata(root);
  if (!metadata || !["template", "organization"].includes(metadata.mode)) {
    throw new Error(
      "package.json: companyascode.mission_control.mode must be template or organization",
    );
  }

  const nextEnv = { ...env };
  // The app suite intentionally relies on the reusable DEV fixtures. Keep it
  // deterministic in every fork; root `bun run test` runs `bun run check`
  // first, so Organization data and the real db mount are still validated.
  if (command === "test" || command === "validate-fixtures") {
    nextEnv.MISSION_CONTROL_ROOT = path.join(root, "templates", "organization-data");
    nextEnv.MISSION_CONTROL_WORKSPACE_ROOT = root;
  } else if (metadata.mode === "template") {
    nextEnv.MISSION_CONTROL_ROOT ??= path.join(root, "templates", "organization-data");
    nextEnv.MISSION_CONTROL_WORKSPACE_ROOT ??= root;
  } else {
    nextEnv.MISSION_CONTROL_ROOT ??= root;
    nextEnv.MISSION_CONTROL_WORKSPACE_ROOT ??= path.dirname(root);
  }

  const preflightInvocations = [];
  if (metadata.mode === "organization" && command === "validate") {
    preflightInvocations.push({
      executable: process.execPath,
      args: ["scripts/validate-mission-control-data.mjs"],
      cwd: organizationDataPreflight(nextEnv.MISSION_CONTROL_ROOT),
      env: nextEnv,
    });
  }

  return {
    executable: platform === "win32" ? "bun.exe" : "bun",
    args: [...commandArgs, ...args],
    cwd: path.join(root, "app", "v3"),
    env: nextEnv,
    preflightInvocations,
  };
}

async function spawnInvocation(invocation) {
  const child = spawn(invocation.executable, invocation.args, {
    cwd: invocation.cwd,
    env: invocation.env,
    stdio: "inherit",
    shell: false,
  });
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`command ${invocation.executable} ended by signal ${signal}`));
        return;
      }
      resolve(code ?? 1);
    });
  });
}

export async function runV3({
  root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  command = process.argv[2],
  args = process.argv.slice(3),
} = {}) {
  const invocation = buildV3Invocation({ root, command, args });
  for (const preflight of invocation.preflightInvocations) {
    const preflightCode = await spawnInvocation(preflight);
    if (preflightCode !== 0) return preflightCode;
  }
  return spawnInvocation(invocation);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    process.exitCode = await runV3();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
