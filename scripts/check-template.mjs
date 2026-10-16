// MissionControlTemplate guard (`bun run check`, also used standalone during
// Organization rollout).
//
// Start contract (Lazurio Module Standard, decision 0171): the Launchpad runs
// only `lazurio.runtime.dev_script`. The guard therefore checks what is
// actually started and what actually gates readiness, behaviourally where
// possible: dev_script is `dev`, `dev` is exactly the single-process server
// start, no preview_script, the client build is the declared preparation and
// the declared readiness check is executed in a disposable copy (it must fail
// without dist/index.html, pass with it, write nothing and finish promptly).
//
// It deliberately does not try to prove that no other package.json script can
// start the server. Extra scripts are developer conveniences the Launchpad
// never runs; detecting aliases means parsing shell syntax and every package
// manager's options, which cannot be made complete and is not a security
// boundary (anyone who can edit package.json can edit `dev` itself). An
// earlier alias/script-graph guard was removed for that reason.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { parse as parseYaml } from "yaml";

const requiredFiles = [
  "package.json",
  "bun.lock",
  "README.md",
  "AGENTS.md",
  "LICENSE",
  "NOTICE.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "config/trusted-pinned-validator-paths.json",
  "docs/README.md",
  "docs/mission-control-v3-operating-manual.md",
  "docs/mission-control-v3-rollout-manual.md",
  "docs/repository-db-data-boundary.md",
  "docs/doctor-managed-install.md",
  "docs/roadmap-planning-model.md",
  "docs/v3-module-documentation-standard.md",
  "schemas/mission-control-plan.schema.json",
  "schemas/mission-control-roadmap.schema.json",
  "lazurio.module.json",
  "templates/launchpad-app/lazurio.module.json.template",
  "templates/launchpad-app/package.json.template",
  "templates/launchpad-app/src/server.ts.template",
  "templates/launchpad-app/tsconfig.json.template",
  "app/v3/package.json",
  "app/v3/bun.lock",
  "app/v3/src/server.ts",
  "app/v3/src/repository-api.ts",
  "app/v3/src/ui-app/pages/Repository.tsx",
  "app/v3/tests/repository-api.test.ts",
  "app/v3/tests/repository-ui.test.tsx",
  "app/v3/tsconfig.json",
  "app/v3/tsconfig.app.json",
  "app/v3/tsconfig.node.json",
  "app/v3/vite.config.ts",
  "templates/organization-data/.gitignore",
  "templates/organization-data/.github/workflows/checks.yml",
  "templates/organization-data/AGENTS.md",
  "templates/organization-data/package.json",
  "templates/organization-data/README.md",
  "templates/organization-data/repository-db.yaml",
  "templates/organization-data/data/mission-control/mission-control.config.json",
  "templates/organization-data/data/mission-control/ISSUES.open.json",
  "templates/organization-data/data/mission-control/ISSUES.resolved.json",
  "templates/organization-data/data/mission-control/TODO.tasks.json",
  "templates/organization-data/data/mission-control/DONE.tasks.json",
  "templates/organization-data/schemas/mission-control-plan.schema.json",
  "templates/organization-data/schemas/mission-control-roadmap.schema.json",
  "templates/organization-data/schemas/mission-control-local-publish.schema.json",
  "templates/organization-data/schemas/mission-control-writer-audit.schema.json",
  "templates/organization-data/schemas/mission-control-writer-provenance.schema.json",
  "templates/organization-data/data/mission-control/roadmaps/README.md",
  "templates/organization-data/data/mission-control/plans/.gitkeep",
  "templates/organization-data/data/mission-control/reports/.gitkeep",
  "templates/organization-data/data/mission-control/import-reviews/.gitkeep",
  "templates/organization-data/data/mission-control/changesets/pending/.gitkeep",
  "templates/organization-data/data/mission-control/changesets/published/.gitkeep",
  "templates/organization-data/data/mission-control/changesets/superseded/.gitkeep",
  "templates/organization-data/generated/.gitkeep",
  "templates/organization-data/scripts/validate-mission-control-data.mjs",
  "scripts/run-v3.mjs",
  "scripts/run-v3.test.mjs",
  "src/mission-control-data-adapter.mjs",
  "src/mission-control-data-adapter.test.mjs",
  "src/mission-control-publish-flow.mjs",
  "src/mission-control-publish-flow.test.mjs",
  "test-support/local-ssh-transport.mjs",
  "test-support/local-ssh-git.test.mjs",
  "test-support/native-git.mjs",
  "test-support/native-git.test.mjs",
  "test-support/symlink-support.mjs",
];

const templateOnlyRequiredFiles = new Set([
  "LICENSE",
  "NOTICE.md",
  "CONTRIBUTING.md",
  "docs/v3-module-documentation-standard.md",
  "templates/launchpad-app/lazurio.module.json.template",
  "templates/launchpad-app/package.json.template",
  "templates/launchpad-app/src/server.ts.template",
  "templates/launchpad-app/tsconfig.json.template",
]);

const requiredDirectories = [
  "templates/organization-data/.github/workflows",
  "templates/organization-data/data",
  "templates/organization-data/data/mission-control",
  "templates/organization-data/data/mission-control/plans",
  "templates/organization-data/data/mission-control/roadmaps",
  "templates/organization-data/data/mission-control/reports",
  "templates/organization-data/data/mission-control/import-reviews",
  "templates/organization-data/data/mission-control/changesets/pending",
  "templates/organization-data/data/mission-control/changesets/published",
  "templates/organization-data/data/mission-control/changesets/superseded",
  "templates/organization-data/generated",
  "templates/organization-data/scripts",
  "app/v3/src",
  "app/v3/src/ui-app",
  "app/v3/tests",
];

const jsonFiles = [
  "package.json",
  "config/trusted-pinned-validator-paths.json",
  "lazurio.module.json",
  "app/v3/package.json",
  "app/v3/tsconfig.json",
  "app/v3/tsconfig.app.json",
  "app/v3/tsconfig.node.json",
  "templates/launchpad-app/package.json.template",
  "templates/launchpad-app/lazurio.module.json.template",
  "templates/organization-data/package.json",
  "schemas/mission-control-plan.schema.json",
  "schemas/mission-control-roadmap.schema.json",
  "templates/organization-data/schemas/mission-control-plan.schema.json",
  "templates/organization-data/schemas/mission-control-roadmap.schema.json",
  "templates/organization-data/schemas/mission-control-local-publish.schema.json",
  "templates/organization-data/schemas/mission-control-writer-audit.schema.json",
  "templates/organization-data/schemas/mission-control-writer-provenance.schema.json",
  "templates/organization-data/data/mission-control/mission-control.config.json",
  "templates/organization-data/data/mission-control/ISSUES.open.json",
  "templates/organization-data/data/mission-control/ISSUES.resolved.json",
  "templates/organization-data/data/mission-control/TODO.tasks.json",
  "templates/organization-data/data/mission-control/DONE.tasks.json",
];

const forbidden = ["TODO_REAL_COMPANY", "sk_live_", "ghp_", "BEGIN PRIVATE KEY"];
// Fictional canary identities. The public upstream must never name real
// Organizations or people, so this list only proves that the no-live-data
// guard works; reviewers remain the real gate against imported client data.
const forbiddenLiveDataMarkers = [
  "Northwind",
  "jane-roe",
  "Renée Roe",
];
const textFileExtensions = new Set([".css", ".html", ".json", ".md", ".mjs", ".mts", ".template", ".ts", ".tsx", ".yaml", ".yml"]);
const scanIgnoredDirs = new Set([
  ".cache",
  ".git",
  ".worktrees",
  "dist",
  "node_modules",
]);
const repositoryDbLegacyKeys = new Set([
  "app_id",
  "app_label",
  "data_version",
  "default_branch",
  "expected_mount",
  "remote_repo",
  "remote_branch",
  "collections",
  "generated_policy",
  "publish_policy",
  "secrets_policy",
]);
const repositoryDbAllowedKeys = new Set([
  "schema_version",
  "app",
  "data_repo",
  "schema",
  "layout",
  "generated_manifest",
  "validate",
]);
const requiredLedgerArrays = [
  "templates/organization-data/data/mission-control/ISSUES.open.json",
  "templates/organization-data/data/mission-control/ISSUES.resolved.json",
  "templates/organization-data/data/mission-control/TODO.tasks.json",
  "templates/organization-data/data/mission-control/DONE.tasks.json",
];

function readText(root, file) {
  return readFileSync(join(root, file), "utf8");
}

function parseJsonFile(root, file, failures) {
  try {
    return JSON.parse(readText(root, file));
  } catch (error) {
    failures.push(`${file}: invalid JSON: ${error.message}`);
    return null;
  }
}

function parseYamlFile(root, file, failures) {
  try {
    return parseYaml(readText(root, file));
  } catch (error) {
    failures.push(`${file}: invalid YAML: ${error.message}`);
    return null;
  }
}

const organizationIdentityTextFiles = new Set(["app/v3/src/instance/brand.ts"]);

const organizationIdentityPaths = new Map([
  [
    "package.json",
    new Set([
      "name",
      "companyascode.mission_control.organization.slug",
      "companyascode.mission_control.organization.display_name",
    ]),
  ],
  [
    "app/v3/package.json",
    new Set([
      "name",
      "lazurio.runtime.id",
      "lazurio.runtime.company",
    ]),
  ],
  ["lazurio.module.json", new Set(["company"])],
]);

function jsonContainsMarkerOutsidePaths(value, marker, allowedPaths, path = []) {
  if (typeof value === "string") {
    return !allowedPaths.has(path.join(".")) && value.includes(marker);
  }
  if (Array.isArray(value)) {
    return value.some((item, index) =>
      jsonContainsMarkerOutsidePaths(item, marker, allowedPaths, [...path, String(index)]),
    );
  }
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([key, item]) =>
      key.includes(marker) ||
      jsonContainsMarkerOutsidePaths(item, marker, allowedPaths, [...path, key]),
  );
}

function containsForbiddenLiveDataMarker({
  file,
  text,
  marker,
  instance,
  packageJson,
  moduleManifest,
  appPackage,
}) {
  if (!text.includes(marker)) return false;
  const ownOrganizationMarkers = [
    instance?.organization?.slug,
    instance?.organization?.display_name,
  ]
    .filter((value) => typeof value === "string")
    .map((value) => value.toLocaleLowerCase("en-US"));
  const markerIsOrganizationIdentity =
    instance?.mode === "organization" &&
    ownOrganizationMarkers.includes(marker.toLocaleLowerCase("en-US"));
  // The explicit instance overlay is where an Organization fork declares its
  // own identity; its own name is not live data there.
  if (markerIsOrganizationIdentity && organizationIdentityTextFiles.has(file)) {
    return false;
  }
  const allowedPaths = markerIsOrganizationIdentity
    ? organizationIdentityPaths.get(file)
    : null;
  if (!allowedPaths) return true;
  const parsed = file === "package.json"
    ? packageJson
    : file === "lazurio.module.json"
      ? moduleManifest
      : appPackage;
  return jsonContainsMarkerOutsidePaths(parsed, marker, allowedPaths);
}

const windowsDeviceNamePattern = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

function isSafeRelativePath(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value ||
    value.startsWith("/") ||
    /[<>:"\\|?*\u0000-\u001f\u007f]/.test(value)
  ) {
    return false;
  }
  return value.split("/").every(
    (segment) =>
      segment.length > 0 &&
      segment !== "." &&
      segment !== ".." &&
      !segment.endsWith(".") &&
      !segment.endsWith(" ") &&
      !windowsDeviceNamePattern.test(segment),
  );
}

function isSafeMissionControlRepositoryPath(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.startsWith("/") ||
    /[\\%?#\s\u0000-\u001f\u007f]/.test(value)
  ) {
    return false;
  }
  const segments = value.split("/");
  return (
    segments.length >= 2 &&
    segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..") &&
    segments.at(-1) === "mission-control-data.git"
  );
}

function isSafeMissionControlGitRemote(value, { allowPlaceholder = false } = {}) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value ||
    value.startsWith("-") ||
    /[\s\u0000-\u001f\u007f]/.test(value) ||
    (!allowPlaceholder && value.includes("REPLACE_WITH_"))
  ) {
    return false;
  }

  if (value.startsWith("https://") || value.startsWith("ssh://")) {
    try {
      const remote = new URL(value);
      if (
        !["https:", "ssh:"].includes(remote.protocol) ||
        !remote.hostname ||
        remote.password ||
        remote.search ||
        remote.hash ||
        (remote.protocol === "https:" && remote.username) ||
        !remote.pathname.startsWith("/") ||
        remote.pathname.startsWith("//")
      ) {
        return false;
      }
      return isSafeMissionControlRepositoryPath(remote.pathname.slice(1));
    } catch {
      return false;
    }
  }

  const scpLike = /^([A-Za-z0-9._-]+)@([A-Za-z0-9.-]+):(.+)$/.exec(value);
  return Boolean(
    scpLike &&
      scpLike[2] &&
      !scpLike[2].startsWith(".") &&
      !scpLike[2].endsWith(".") &&
      isSafeMissionControlRepositoryPath(scpLike[3]),
  );
}

function sshRemoteHost(value) {
  if (typeof value !== "string") return null;
  const scpLike =
    /^[A-Za-z0-9._-]+@([A-Za-z0-9.-]+):/.exec(value);
  if (scpLike) return scpLike[1].toLowerCase();
  if (!value.startsWith("ssh://")) return null;
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function sshRemoteUser(value) {
  if (typeof value !== "string") return null;
  const scpLike =
    /^([A-Za-z0-9._-]+)@[A-Za-z0-9.-]+:/.exec(value);
  if (scpLike) return scpLike[1];
  if (!value.startsWith("ssh://")) return null;
  try {
    return decodeURIComponent(new URL(value).username);
  } catch {
    return null;
  }
}

function remoteUsesGitHubSsh(value) {
  return (
    sshRemoteUser(value) === "git" &&
    ["github.com", "ssh.github.com"].includes(sshRemoteHost(value))
  );
}

function remoteUsesGitHubHttps(value) {
  if (typeof value !== "string" || !value.startsWith("https://")) return false;
  try {
    const remote = new URL(value);
    return (
      remote.hostname.toLowerCase() === "github.com" &&
      remote.username === "" &&
      remote.password === ""
    );
  } catch {
    return false;
  }
}

function policyPatternBase(value) {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) return null;
  if (value.includes("REPLACE_WITH_")) return null;
  const base = value.endsWith("/**") ? value.slice(0, -3) : value;
  return isSafeRelativePath(base) ? base : null;
}

function isMissionControlPolicyPath(value) {
  const base = policyPatternBase(value);
  if (!base || !isSafeRelativePath(base)) return false;
  return base === "data/mission-control" || base.startsWith("data/mission-control/");
}

function policyPatternContains(container, candidate) {
  const containerBase = policyPatternBase(container);
  const candidateBase = policyPatternBase(candidate);
  if (!containerBase || !candidateBase) return false;
  if (!container.endsWith("/**")) return container === candidate;
  return candidateBase === containerBase || candidateBase.startsWith(`${containerBase}/`);
}

function validatePolicyPathList(value, label, failures) {
  if (!Array.isArray(value) || value.length === 0) {
    failures.push(`mission-control.config.json: ${label} must be a non-empty list`);
    return [];
  }
  const valid = [];
  for (const [index, pattern] of value.entries()) {
    if (!isMissionControlPolicyPath(pattern)) {
      failures.push(
        `mission-control.config.json: ${label}[${index}] must be a safe path or /** pattern inside data/mission-control`,
      );
      continue;
    }
    valid.push(pattern);
  }
  return valid;
}

function isDirectory(root, dir) {
  const path = join(root, dir);
  return existsSync(path) && statSync(path).isDirectory();
}

function listTemplateTextFiles(
  root,
  dir = ".",
  { ignoreOrganizationDataMount = false } = {},
) {
  const absoluteDir = join(root, dir);
  if (!existsSync(absoluteDir)) return [];
  const files = [];
  for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
    if (scanIgnoredDirs.has(entry.name)) continue;
    if (ignoreOrganizationDataMount && dir === "." && entry.name === "db") continue;
    const relative = dir === "." ? entry.name : `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(
        ...listTemplateTextFiles(root, relative, {
          ignoreOrganizationDataMount,
        }),
      );
      continue;
    }
    if (!entry.isFile()) continue;
    if (relative === "scripts/check-template.mjs" || relative === "scripts/check-template.test.mjs") continue;
    if (entry.name === "bun.lock" || entry.name.endsWith(".tsbuildinfo")) continue;
    const extension = entry.name.includes(".") ? entry.name.slice(entry.name.lastIndexOf(".")) : "";
    if (textFileExtensions.has(extension) || entry.name === "LICENSE") files.push(relative);
  }
  return files;
}

function validateRepositoryDbConfig(root, config, missionControlConfig, failures) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    failures.push("templates/organization-data/repository-db.yaml: must parse to an object");
    return;
  }

  for (const key of Object.keys(config)) {
    if (repositoryDbLegacyKeys.has(key)) {
      failures.push(`repository-db.yaml: legacy key ${key} is not part of repository-db.config.v1`);
    } else if (!repositoryDbAllowedKeys.has(key)) {
      failures.push(`repository-db.yaml: unexpected top-level key ${key}`);
    }
  }

  if (config.schema_version !== "repository-db.config.v1") {
    failures.push("repository-db.yaml: schema_version must be repository-db.config.v1");
  }
  if (config.app !== "mission-control") failures.push("repository-db.yaml: app must be mission-control");

  const dataRepo = config.data_repo;
  if (!dataRepo || typeof dataRepo !== "object" || Array.isArray(dataRepo)) {
    failures.push("repository-db.yaml: data_repo must be a mapping");
  } else {
    if (!isSafeMissionControlGitRemote(dataRepo.remote, { allowPlaceholder: true })) {
      failures.push(
        "repository-db.yaml: data_repo.remote must be a credential-free Organization-owned HTTPS or SSH mission-control-data Git remote",
      );
    }
    if (dataRepo.branch !== "v3") failures.push("repository-db.yaml: data_repo.branch must be v3");
  }

  const schema = config.schema;
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    failures.push("repository-db.yaml: schema must be a mapping");
  } else {
    if (schema.name !== "mission-control-data") failures.push("repository-db.yaml: schema.name must be mission-control-data");
    if (schema.version !== "3.0.0-alpha.0") failures.push("repository-db.yaml: schema.version must be 3.0.0-alpha.0");
  }

  const layout = config.layout;
  if (!layout || typeof layout !== "object" || Array.isArray(layout)) {
    failures.push("repository-db.yaml: layout must be a mapping");
  } else {
    const expectedLayout = { data: "data", generated: "generated", scripts: "scripts" };
    for (const [key, expected] of Object.entries(expectedLayout)) {
      if (layout[key] !== expected) failures.push(`repository-db.yaml: layout.${key} must be ${expected}`);
      if (!isSafeRelativePath(layout[key])) failures.push(`repository-db.yaml: unsafe layout.${key}: ${layout[key]}`);
      if (typeof layout[key] === "string" && isSafeRelativePath(layout[key]) && !isDirectory(root, `templates/organization-data/${layout[key]}`)) {
        failures.push(`repository-db.yaml: layout.${key} directory is missing: ${layout[key]}`);
      }
    }
  }

  if (!Array.isArray(config.generated_manifest)) {
    failures.push("repository-db.yaml: generated_manifest must be a list");
  } else {
    for (const [index, entry] of config.generated_manifest.entries()) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        failures.push(`repository-db.yaml: generated_manifest[${index}] must be a mapping`);
        continue;
      }
      if (!isSafeRelativePath(entry.path)) failures.push(`repository-db.yaml: generated_manifest[${index}].path must be repo-relative`);
    }
  }

  if (!Array.isArray(config.validate) || config.validate.some((entry) => typeof entry !== "string" || !entry.trim())) {
    failures.push("repository-db.yaml: validate must be a list of commands");
  } else if (!config.validate.includes("node scripts/validate-mission-control-data.mjs")) {
    failures.push("repository-db.yaml: validate must include node scripts/validate-mission-control-data.mjs");
  }

  if (missionControlConfig) {
    validateMissionControlConfig(
      missionControlConfig,
      failures,
      dataRepo?.remote,
    );
  }
}

function validateMissionControlConfig(config, failures, dataRepoRemote) {
  if (config.schema_version !== "companiesascode.mission_control.config.v1") {
    failures.push("mission-control.config.json: schema_version must be companiesascode.mission_control.config.v1");
  }
  if (config.data_mode !== "repository-db") failures.push("mission-control.config.json: data_mode must be repository-db");
  if (typeof config.organization_admin !== "string" || !config.organization_admin.trim()) {
    failures.push("mission-control.config.json: organization_admin must be a non-empty string");
  }
  if (Object.hasOwn(config, "workspace_admin")) {
    failures.push("mission-control.config.json: reusable scaffold must use organization_admin, not legacy workspace_admin");
  }
  if (config.repository_db_config_path !== "repository-db.yaml") {
    failures.push("mission-control.config.json: repository_db_config_path must be repository-db.yaml");
  }
  const expectedPaths = {
    plans_dir: "data/mission-control/plans",
    roadmaps_dir: "data/mission-control/roadmaps",
    reports_dir: "data/mission-control/reports",
    import_reviews_dir: "data/mission-control/import-reviews",
    issues_open_path: "data/mission-control/ISSUES.open.json",
    issues_resolved_path: "data/mission-control/ISSUES.resolved.json",
    todo_tasks_path: "data/mission-control/TODO.tasks.json",
    done_tasks_path: "data/mission-control/DONE.tasks.json",
    schema_path: "schemas/mission-control-plan.schema.json",
    roadmap_schema_path: "schemas/mission-control-roadmap.schema.json",
  };
  for (const [key, expected] of Object.entries(expectedPaths)) {
    if (config[key] !== expected) failures.push(`mission-control.config.json: ${key} must be ${expected}`);
    if (typeof config[key] === "string" && !isSafeRelativePath(config[key])) {
      failures.push(`mission-control.config.json: unsafe ${key}: ${config[key]}`);
    }
  }
  if (config.compatibility_bridge?.legacy_write_paths_allowed !== false) {
    failures.push("mission-control.config.json: compatibility_bridge.legacy_write_paths_allowed must be false");
  }
  validatePublishPolicy(config.publish_policy, failures, dataRepoRemote);
}

function validatePublishPolicy(policy, failures, dataRepoRemote) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    failures.push("mission-control.config.json: publish_policy must be a mapping");
    return;
  }
  const expectedPaths = {
    pending_changesets_dir: "data/mission-control/changesets/pending",
    published_changesets_dir: "data/mission-control/changesets/published",
    superseded_changesets_dir: "data/mission-control/changesets/superseded",
  };
  for (const [key, expected] of Object.entries(expectedPaths)) {
    if (policy[key] !== expected) failures.push(`mission-control.config.json: publish_policy.${key} must be ${expected}`);
    if (typeof policy[key] === "string" && !isSafeRelativePath(policy[key])) {
      failures.push(`mission-control.config.json: unsafe publish_policy.${key}: ${policy[key]}`);
    }
  }
  if (
    !Array.isArray(policy.legacy_changeset_quarantine) ||
    policy.legacy_changeset_quarantine.length !== 0
  ) {
    failures.push(
      "mission-control.config.json: reusable publish_policy.legacy_changeset_quarantine must be an empty list",
    );
  }
  if (policy.approval_roles !== undefined) {
    failures.push(
      "mission-control.config.json: reusable native Git writer must not define approval_roles; GitHub repository grants are the only access authority",
    );
  }
  const protectedPaths = validatePolicyPathList(
    policy.protected_paths,
    "publish_policy.protected_paths",
    failures,
  );
  for (const [key, directory] of Object.entries(expectedPaths)) {
    const representativeAuditPath = `${directory}/__policy-check__.json`;
    if (
      !protectedPaths.some((protectedPath) =>
        policyPatternContains(protectedPath, representativeAuditPath),
      )
    ) {
      failures.push(
        `mission-control.config.json: publish_policy.protected_paths must cover audit files under publish_policy.${key} (${directory})`,
      );
    }
  }
  const writerMode = policy.writer_mode ?? null;
  if (
    !["local-principal-v1", "github-app-workspace-v1"].includes(writerMode)
  ) {
    failures.push(
      "mission-control.config.json: publish_policy.writer_mode must be local-principal-v1 or github-app-workspace-v1",
    );
    return;
  }
  if (
    writerMode === "local-principal-v1" &&
    !remoteUsesGitHubSsh(dataRepoRemote) &&
    !remoteUsesGitHubHttps(dataRepoRemote)
  ) {
    failures.push(
      "mission-control.config.json: reusable local-principal-v1 template requires a credential-free github.com SSH or HTTPS data_repo.remote",
    );
  }
  if (
    writerMode === "github-app-workspace-v1" &&
    !remoteUsesGitHubHttps(dataRepoRemote)
  ) {
    failures.push(
      "mission-control.config.json: reusable github-app-workspace-v1 template requires a credential-free https://github.com data_repo.remote",
    );
  }
  if (policy.local_principal !== undefined) {
    failures.push(
      `mission-control.config.json: reusable ${writerMode} template must not carry a second local_principal roster or provider access audit`,
    );
  }
  if (policy.credential_authority !== undefined) {
    failures.push(
      `mission-control.config.json: ${writerMode} template must not carry parallel credential_authority`,
    );
  }
}

function validateRoadmapPlanningModel(root, roadmapSchema, failures) {
  if (!roadmapSchema || typeof roadmapSchema !== "object") {
    failures.push("schemas/mission-control-roadmap.schema.json: must parse to an object");
    return;
  }

  const required = new Set(Array.isArray(roadmapSchema.required) ? roadmapSchema.required : []);
  for (const field of ["source_plan", "priorities", "steps"]) {
    if (!required.has(field)) failures.push(`roadmap schema must require ${field}`);
  }

  const priorities = roadmapSchema.properties?.priorities?.items;
  const priorityRequired = new Set(Array.isArray(priorities?.required) ? priorities.required : []);
  for (const field of ["id", "title", "rank"]) {
    if (!priorityRequired.has(field)) failures.push(`roadmap schema Roadmap Priority must require ${field}`);
  }
  if (priorities?.properties?.id?.pattern !== "^priority-[0-9]{3}$") {
    failures.push("roadmap schema Roadmap Priority id must use priority-### pattern");
  }

  const step = roadmapSchema.properties?.steps?.items;
  const stepRequired = new Set(Array.isArray(step?.required) ? step.required : []);
  for (const field of ["id", "title", "status", "executable"]) {
    if (!stepRequired.has(field)) failures.push(`roadmap schema Roadmap Step must require ${field}`);
  }

  const stepAllOf = Array.isArray(step?.allOf) ? step.allOf : [];
  const executableGate = stepAllOf.find((rule) => rule?.if?.properties?.executable?.const === true);
  const executableRefs = new Set(
    (Array.isArray(executableGate?.then?.anyOf) ? executableGate.then.anyOf : [])
      .flatMap((option) => (Array.isArray(option?.required) ? option.required : [])),
  );
  let executableRefsNonEmpty = true;
  for (const ref of ["plan_refs", "todo_refs", "issue_refs"]) {
    if (!executableRefs.has(ref)) {
      failures.push("roadmap schema executable Roadmap Steps must require plan_refs, todo_refs, or issue_refs");
      executableRefsNonEmpty = false;
      break;
    }
    const baseRef = step?.properties?.[ref];
    const gatedRef = (Array.isArray(executableGate?.then?.anyOf) ? executableGate.then.anyOf : [])
      .find((option) => Array.isArray(option?.required) && option.required.includes(ref))
      ?.properties?.[ref];
    if (baseRef?.minItems !== 1 || gatedRef?.minItems !== 1) {
      executableRefsNonEmpty = false;
    }
  }
  if (!executableRefsNonEmpty) {
    failures.push("roadmap schema executable refs must have minItems 1");
  }

  const doneGate = stepAllOf.find((rule) => rule?.if?.properties?.status?.const === "done");
  const doneRequired = new Set(Array.isArray(doneGate?.then?.required) ? doneGate.then.required : []);
  if (!doneRequired.has("evidence_refs")) {
    failures.push("roadmap schema done Roadmap Steps must require evidence_refs");
  }
  if (step?.properties?.evidence_refs?.minItems !== 1) {
    failures.push("roadmap schema evidence_refs must have minItems 1");
  }

  const evidenceKinds = new Set(step?.properties?.evidence_refs?.items?.properties?.kind?.enum ?? []);
  for (const kind of ["decision", "doc", "plan", "pull_request", "commit", "report", "validation", "external"]) {
    if (!evidenceKinds.has(kind)) failures.push(`roadmap schema evidence_refs must allow ${kind}`);
  }

  const docs = existsSync(join(root, "docs/roadmap-planning-model.md"))
    ? readText(root, "docs/roadmap-planning-model.md")
    : "";
  if (!docs.includes("Roadmap Priority")) failures.push("roadmap planning docs must explain Roadmap Priority");
  if (!docs.includes("Roadmap Step")) failures.push("roadmap planning docs must explain Roadmap Step");
}

function validatePlanPrefixSchema(schema, label, failures) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    failures.push(`${label}: must parse to an object`);
    return;
  }
  if (schema.properties?.dev_code?.pattern !== "^[A-Z]{2,6}-[0-9]{4}$") {
    failures.push(`${label}: dev_code must support the configured 2-6 letter Organization prefix`);
  }
  if (schema.properties?.id?.pattern !== "^mcplan-[a-z]{2,6}-[0-9]{4}$") {
    failures.push(`${label}: id must support the lowercase configured Organization prefix`);
  }
}

function validateRuntimeContract(packageJson, failures) {
  const testScript = packageJson?.scripts?.test;
  if (typeof testScript !== "string" || !testScript.includes("src/mission-control-data-adapter.test.mjs")) {
    failures.push("package.json: test script must include src/mission-control-data-adapter.test.mjs");
  }
  if (typeof testScript !== "string" || !testScript.includes("scripts/run-v3.test.mjs")) {
    failures.push("package.json: test script must include scripts/run-v3.test.mjs");
  }
  if (typeof testScript !== "string" || !testScript.startsWith("bun run check &&")) {
    failures.push(
      "package.json: test script must run bun run check before isolated app fixtures",
    );
  }
  for (const script of ["app:validate", "app:typecheck", "app:test", "app:build"]) {
    if (typeof packageJson?.scripts?.[script] !== "string" || !packageJson.scripts[script].trim()) {
      failures.push(`package.json: scripts must include ${script}`);
    }
  }
  // Lazurio Module Standard (decision 0171): the App starts only through
  // app/v3 `dev` with the Launchpad listener environment. The retired root
  // wrapper scripts (they read the lease file and started a second process)
  // must not come back with a fork sync; this is a fixed-name check of the
  // former wrapper, not alias detection (see the header).
  for (const script of ["dev", "dev:server", "dev:client", "start", "preview"]) {
    if (Object.hasOwn(packageJson?.scripts ?? {}, script)) {
      failures.push(
        `package.json: ${script} must not be declared; the App starts only through app/v3 dev`,
      );
    }
  }
  if (!/^bun@\d+\.\d+\.\d+$/.test(packageJson?.packageManager ?? "")) {
    failures.push("package.json: packageManager must pin an exact bun@<version>");
  }
  const wrapperScripts = {
    export: "export",
    "agent-work": "agent-work",
    "next-dev-code": "next-dev-code",
    "create-plan": "create-plan",
    plan: "plan",
    "app:build": "build",
    "app:typecheck": "typecheck",
    "app:check": "check",
    "app:validate": "validate",
    "app:test": "test",
  };
  for (const [script, command] of Object.entries(wrapperScripts)) {
    if (packageJson?.scripts?.[script] !== `node scripts/run-v3.mjs ${command}`) {
      failures.push(
        `package.json: ${script} must use the cross-platform scripts/run-v3.mjs ${command} wrapper`,
      );
    }
  }
  if (packageJson?.license !== "MIT") {
    failures.push("package.json: license must be MIT for client-commercial reuse");
  }
}

function validateBunLockIdentity({
  lock,
  lockPath,
  packageJson,
  packagePath,
  failures,
}) {
  const lockName = lock?.workspaces?.[""]?.name;
  const packageName = packageJson?.name;
  if (typeof lockName !== "string" || !lockName.trim()) {
    failures.push(`${lockPath}: workspaces[""].name must be a non-empty string`);
    return;
  }
  if (typeof packageName !== "string" || lockName !== packageName) {
    failures.push(
      `${lockPath}: workspaces[""].name must match ${packagePath} name (${packageName ?? "<missing>"})`,
    );
  }
}

function validateOrganizationDataPackage(packageJson, failures) {
  if (packageJson?.type !== "module" || packageJson?.private !== true) {
    failures.push("templates/organization-data/package.json: must be a private ESM package");
  }
  if (packageJson?.scripts?.validate !== "node scripts/validate-mission-control-data.mjs") {
    failures.push("templates/organization-data/package.json: scripts.validate must run the bundled data validator");
  }
  for (const dependency of ["ajv", "yaml"]) {
    if (typeof packageJson?.dependencies?.[dependency] !== "string") {
      failures.push(`templates/organization-data/package.json: dependencies must include ${dependency}`);
    }
  }
}

function validateOrganizationDataAgentContract(root, failures) {
  const file = "templates/organization-data/AGENTS.md";
  if (!existsSync(join(root, file))) return;
  const instructions = readText(root, file);
  for (const phrase of [
    "GitHub je jediná autorita přístupu",
    "non-force fast-forward",
    "trusted-process",
    "provider-enforced",
    "Organization Admin",
    "Jednorázový bootstrap",
    "Primary checkout",
    "worktree",
    "control-plane migration PR",
    "Žádné secrets",
    "npm run validate",
  ]) {
    if (!instructions.includes(phrase)) {
      failures.push(`${file}: must preserve agent guardrail ${phrase}`);
    }
  }
}

function validatePinnedValidatorPaths(document, failures) {
  const file = "config/trusted-pinned-validator-paths.json";
  const expectedKeys = ["schema_version", "trusted_validator_paths"];
  const actualKeys =
    document && typeof document === "object" && !Array.isArray(document)
      ? Object.keys(document).sort()
      : [];
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index]) ||
    document?.schema_version !==
      "companiesascode.mission_control.pinned_validator_paths.v1"
  ) {
    failures.push(`${file}: invalid exact manifest contract`);
    return;
  }
  const paths = document.trusted_validator_paths;
  const prefix = "templates/organization-data/scripts/";
  if (
    !Array.isArray(paths) ||
    paths.length === 0 ||
    paths.length > 16 ||
    new Set(paths).size !== paths.length ||
    paths.some((path) => {
      if (
        typeof path !== "string" ||
        path.length > 240 ||
        !path.startsWith(prefix) ||
        !path.endsWith(".mjs")
      ) {
        return true;
      }
      const relativePath = path.slice(prefix.length);
      return (
        relativePath.length <= ".mjs".length ||
        relativePath
          .split("/")
          .some((segment) => !/^[a-z0-9][a-z0-9._-]*$/.test(segment))
      );
    })
  ) {
    failures.push(`${file}: trusted_validator_paths must be unique canonical validator paths`);
    return;
  }
  const currentValidatorPath =
    "templates/organization-data/scripts/validate-mission-control-data.mjs";
  if (!paths.includes(currentValidatorPath)) {
    failures.push(`${file}: must trust the current pinned validator path`);
  }
}

function validateReusableAppPackage(rootPackage, moduleManifest, appPackage, failures) {
  const instance = rootPackage?.companyascode?.mission_control;
  if (!instance || typeof instance !== "object" || Array.isArray(instance)) {
    failures.push("package.json: companyascode.mission_control must declare the explicit instance mode");
    return;
  }
  if (instance.schema_version !== "companiesascode.mission_control.instance.v1") {
    failures.push(
      "package.json: companyascode.mission_control.schema_version must be companiesascode.mission_control.instance.v1",
    );
  }
  if (!["template", "organization"].includes(instance.mode)) {
    failures.push(
      "package.json: companyascode.mission_control.mode must be template or organization",
    );
  }
  const organization = instance.organization;
  if (!organization || typeof organization !== "object" || Array.isArray(organization)) {
    failures.push("package.json: companyascode.mission_control.organization must be a mapping");
    return;
  }

  if (Object.hasOwn(appPackage ?? {}, "companyascode")) {
    failures.push(
      "app/v3/package.json: companyascode is legacy-only and must not be authored",
    );
  }
  const app = appPackage?.lazurio?.runtime;
  if (!app || typeof app !== "object" || Array.isArray(app)) {
    failures.push("app/v3/package.json: must contain lazurio.runtime");
    return;
  }
  if (app.schema_version !== "lazurio.runtime.v1") {
    failures.push("app/v3/package.json: lazurio.runtime.schema_version must be lazurio.runtime.v1");
  }
  if (app.module !== "mission-control" || app.surface !== "internal") {
    failures.push("app/v3/package.json: lazurio.runtime must be the internal mission-control module");
  }
  if (
    !Array.isArray(app.required_module_slots) ||
    app.required_module_slots.length !== 1 ||
    app.required_module_slots[0] !== "mission-control/db"
  ) {
    failures.push(
      "app/v3/package.json: lazurio.runtime.required_module_slots must be exactly [mission-control/db]",
    );
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(app.id ?? "")) {
    failures.push("app/v3/package.json: lazurio.runtime.id must be lowercase kebab-case");
  }
  for (const scriptKey of [app.dev_script, app.build_script]) {
    if (
      typeof scriptKey !== "string" ||
      typeof appPackage?.scripts?.[scriptKey] !== "string" ||
      !appPackage.scripts[scriptKey].trim()
    ) {
      failures.push(
        `app/v3/package.json: lazurio.runtime script ${String(scriptKey)} must exist`,
      );
    }
  }
  for (const tag of ["mission-control", "gen3", "repository-db"]) {
    if (!Array.isArray(app.tags) || !app.tags.includes(tag)) {
      failures.push(`app/v3/package.json: tags must include ${tag}`);
    }
  }
  if (
    !Array.isArray(app.listeners) ||
    app.listeners.length !== 1 ||
    app.listeners[0]?.id !== "web" ||
    app.listeners[0]?.role !== "entrypoint" ||
    app.listeners[0]?.lease !== "main" ||
    app.listeners[0]?.protocol !== "http" ||
    app.listeners[0]?.health?.kind !== "http" ||
    app.listeners[0]?.health?.path !== "/" ||
    Object.hasOwn(app.listeners[0], "port") ||
    Object.hasOwn(app.listeners[0], "host") ||
    Object.hasOwn(app.listeners[0], "allocation") ||
    Object.hasOwn(app.listeners[0], "claim")
  ) {
    failures.push(
      "app/v3/package.json: lazurio.runtime must expose exactly one web entrypoint on lease main without duplicating lease authority",
    );
  }

  if (
    moduleManifest?.schema_version !== "lazurio.module.v1" ||
    moduleManifest?.id !== "mission-control" ||
    moduleManifest?.company !== app.company ||
    moduleManifest?.tcp_port_policy?.mode !== "single" ||
    !Array.isArray(moduleManifest?.port_leases) ||
    moduleManifest.port_leases.length !== 1 ||
    moduleManifest.port_leases[0]?.id !== "main" ||
    !["127.0.0.1", "localhost", "::1"].includes(moduleManifest.port_leases[0]?.host) ||
    !Number.isInteger(moduleManifest.port_leases[0]?.port) ||
    moduleManifest.port_leases[0].port < 1024 ||
    moduleManifest.port_leases[0].port > 65535 ||
    JSON.stringify(moduleManifest?.apps) !== JSON.stringify(["app/v3/package.json"]) ||
    moduleManifest?.default_app !== "app/v3/package.json"
  ) {
    failures.push("lazurio.module.json: must own one main lease and the app/v3 runtime inventory");
  }

  if (instance.mode === "template") {
    if (
      organization.slug !== "REPLACE_WITH_ORG_SLUG" ||
      organization.display_name !== "REPLACE_WITH_ORG_NAME"
    ) {
      failures.push("template mode: package.json Organization identity must keep both placeholders");
    }
    if (rootPackage?.name !== "mission-control-template") {
      failures.push("template mode: root package name must be mission-control-template");
    }
    if (appPackage?.name !== "mission-control-v3-app") {
      failures.push("template mode: app/v3 package name must be mission-control-v3-app");
    }
    if (
      moduleManifest?.company !== "REPLACE-WITH-ORG-NAME" ||
      app.id !== "replace-with-org-slug-mission-control-v3" ||
      app.company !== "REPLACE-WITH-ORG-NAME"
    ) {
      failures.push("template mode: Module and runtime identities must keep schema-valid placeholders");
    }
  }

  if (instance.mode === "organization") {
    const slug = organization.slug;
    const displayName = organization.display_name;
    if (typeof slug !== "string" || !/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(slug)) {
      failures.push(
        "organization mode: slug must be the concrete ASCII kebab-case company.slug identity",
      );
      return;
    }
    if (
      typeof displayName !== "string" ||
      !displayName.trim() ||
      displayName.includes("REPLACE_WITH_")
    ) {
      failures.push("organization mode: display_name must be concrete and non-empty");
    }
    const packageSlug = slug.toLowerCase();
    if (rootPackage?.name !== `${packageSlug}-mission-control`) {
      failures.push(
        `organization mode: root package name must be ${packageSlug}-mission-control`,
      );
    }
    if (appPackage?.name !== `@${packageSlug}/mission-control-v3`) {
      failures.push(
        `organization mode: app/v3 package name must be @${packageSlug}/mission-control-v3`,
      );
    }
    if (
      moduleManifest?.company !== slug ||
      app.company !== slug ||
      app.id !== `${packageSlug}-mission-control-v3`
    ) {
      failures.push(
        "organization mode: Module and app runtime company/id must match the exact company.slug identity",
      );
    }
    for (const [label, value] of [
      ["root package name", rootPackage?.name],
      ["app package name", appPackage?.name],
      ["lazurio.runtime.id", app.id],
      ["lazurio.runtime.company", app.company],
      ["lazurio.module.company", moduleManifest?.company],
      ["Organization slug", slug],
      ["Organization display_name", displayName],
    ]) {
      if (typeof value !== "string" || !value.trim() || value.includes("REPLACE_WITH_")) {
        failures.push(`organization mode: ${label} must not contain a placeholder`);
      }
    }
  }
}

function validateLaunchpadAppPackageTemplate(templateModule, templatePackage, failures) {
  if (!templateModule && !templatePackage) return;
  if (Object.hasOwn(templatePackage ?? {}, "companyascode")) {
    failures.push(
      "templates/launchpad-app/package.json.template: companyascode is legacy-only",
    );
  }
  const app = templatePackage?.lazurio?.runtime;
  if (!app || typeof app !== "object" || Array.isArray(app)) {
    failures.push("templates/launchpad-app/package.json.template: must contain lazurio.runtime");
    return;
  }
  const required = ["schema_version", "id", "title", "company", "module", "surface", "dev_script", "tags", "listeners"];
  for (const field of required) {
    if (app[field] === undefined) failures.push(`templates/launchpad-app/package.json.template: missing lazurio.runtime.${field}`);
  }
  if (app.schema_version !== "lazurio.runtime.v1") {
    failures.push("templates/launchpad-app/package.json.template: schema_version must be lazurio.runtime.v1");
  }
  if (app.module !== "mission-control") failures.push("templates/launchpad-app/package.json.template: module must be mission-control");
  if (app.surface !== "internal") failures.push("templates/launchpad-app/package.json.template: surface must be internal");
  if (!Array.isArray(app.tags) || !app.tags.includes("mission-control") || !app.tags.includes("first-client")) {
    failures.push("templates/launchpad-app/package.json.template: tags must include mission-control and first-client");
  }
  if (
    !Array.isArray(app.listeners) ||
    app.listeners.length !== 1 ||
    app.listeners[0]?.id !== "web" ||
    app.listeners[0]?.role !== "entrypoint" ||
    app.listeners[0]?.lease !== "main" ||
    app.listeners[0]?.protocol !== "http" ||
    app.listeners[0]?.health?.kind !== "http" ||
    app.listeners[0]?.health?.path !== "/" ||
    Object.hasOwn(app.listeners[0], "port") ||
    Object.hasOwn(app.listeners[0], "host") ||
    Object.hasOwn(app.listeners[0], "allocation") ||
    Object.hasOwn(app.listeners[0], "claim")
  ) {
    failures.push(
      "templates/launchpad-app/package.json.template: must reference one valid main entrypoint lease without duplicating lease authority",
    );
  }
  if (
    templateModule?.schema_version !== "lazurio.module.v1" ||
    templateModule?.id !== "mission-control" ||
    templateModule?.company !== "replace-with-client-slug" ||
    templateModule?.tcp_port_policy?.mode !== "single" ||
    !Array.isArray(templateModule?.port_leases) ||
    templateModule.port_leases.length !== 1 ||
    templateModule.port_leases[0]?.id !== "main" ||
    templateModule.port_leases[0]?.host !== "127.0.0.1" ||
    !Number.isInteger(templateModule.port_leases[0]?.port) ||
    templateModule.port_leases[0].port < 1024 ||
    templateModule.port_leases[0].port > 65535 ||
    JSON.stringify(templateModule?.apps) !== JSON.stringify(["package.json"]) ||
    templateModule?.default_app !== "package.json"
  ) {
    failures.push(
      "templates/launchpad-app/lazurio.module.json.template: must own one static main lease",
    );
  }
}

function validateSingleListenerSource(root, failures) {
  const optionalText = (file) => existsSync(join(root, file)) ? readText(root, file) : "";
  const appPackage = optionalText("app/v3/package.json");
  const server = optionalText("app/v3/src/server.ts");
  const vite = optionalText("app/v3/vite.config.ts");
  const scaffoldServer = optionalText("templates/launchpad-app/src/server.ts.template");
  const moduleManifest = optionalText("lazurio.module.json");

  // The hosted profile (decision 0146) hands the loopback listener its public
  // origin; only the app server owns a Host/Origin security context, so only
  // it must read the variable.
  // The app server reads host, port and hosted origin of its `web` listener
  // through @lazurio/module-kit (LAZURIO_RUNTIME_LISTENER_WEB_*), never from
  // the lease file.
  for (const [file, text, requiredRuntimeSources] of [
    [
      "app/v3/src/server.ts",
      server,
      [
        "@lazurio/module-kit",
        "listener('web')",
        "LAZURIO_RUNTIME_LISTENER_WEB_EXTERNAL_ORIGIN",
      ],
    ],
    [
      "templates/launchpad-app/src/server.ts.template",
      scaffoldServer,
      ["LAZURIO_RUNTIME_LISTENER_WEB_HOST", "LAZURIO_RUNTIME_LISTENER_WEB_PORT"],
    ],
  ]) {
    if (!text) continue;
    for (const name of requiredRuntimeSources) {
      if (!text.includes(name)) failures.push(`${file}: must read ${name}`);
    }
    for (const forbiddenRuntimeSource of [
      "process.env.PORT",
      "MISSION_CONTROL_WEB_PORT",
      "MISSION_CONTROL_WEB_ORIGIN",
      "MISSION_CONTROL_API_TARGET",
      "MISSION_CONTROL_API_PORT",
      "LAZURIO_RUNTIME_LISTENER_API_HOST",
      "LAZURIO_RUNTIME_LISTENER_API_PORT",
    ]) {
      if (text.includes(forbiddenRuntimeSource)) {
        failures.push(`${file}: must not use ${forbiddenRuntimeSource}`);
      }
    }
  }

  if (server.includes("lazurio.module.json")) {
    failures.push("app/v3/src/server.ts: must not read the lazurio.module.json lease file");
  }
  validateAppStartContract(root, appPackage, optionalText("app/v3/src/prepared.ts"), failures);
  if (/\bserver\s*:|\bpreview\s*:|\bproxy\s*:/.test(vite)) {
    failures.push("app/v3/vite.config.ts: Vite must not own a server, preview port, or proxy");
  }
  try {
    const leasePort = JSON.parse(moduleManifest)?.port_leases?.[0]?.port;
    if (
      Number.isInteger(leasePort) &&
      [appPackage, server, vite].some((text) => text.includes(String(leasePort)))
    ) {
      failures.push(
        "app/v3 runtime source must not duplicate lazurio.module.json lease ports",
      );
    }
  } catch {
    // The manifest parser reports invalid JSON separately.
  }
}

const APP_PREPARE_SCRIPT = "bun ./node_modules/vite/bin/vite.js build";
const APP_CHECK_PREPARED_SCRIPT = "bun run src/prepared.ts";
const READINESS_TIMEOUT_MS = 15_000;

function directoryFingerprint(directory) {
  const entries = [];
  const walk = (current) => {
    for (const name of readdirSync(current).sort()) {
      const path = join(current, name);
      const rel = relative(directory, path).split("\\").join("/");
      if (statSync(path).isDirectory()) {
        entries.push(`${rel}/`);
        walk(path);
      } else {
        entries.push(`${rel} ${createHash("sha256").update(readFileSync(path)).digest("hex")}`);
      }
    }
  };
  walk(directory);
  return entries.join("\n");
}

function defaultBunExecutable() {
  return process.platform === "win32" ? "bun.exe" : "bun";
}

/**
 * Runs the declared readiness check (`bun run src/prepared.ts`) for real, but
 * never inside the checkout: app/v3/src/prepared.ts is copied into a
 * disposable <tmp>/app/v3/src/ and executed with cwd <tmp>/app/v3, a minimal
 * environment without listener variables and a timeout. Contract:
 * prepared.ts is self-contained (Node/Bun built-ins only) and tests the
 * dist/index.html next to src/, the client build the server serves. It must
 * exit non-zero while dist/index.html is absent, exit 0 once it exists, write
 * nothing (the sandbox tree is compared before and after each run) and finish
 * promptly, so it can neither build nor start or wait for a server.
 */
function validatePreparedCheckBehavior(root, failures, { executable = defaultBunExecutable() } = {}) {
  const file = "app/v3/src/prepared.ts";
  const sandbox = mkdtempSync(join(tmpdir(), "mission-control-readiness-"));
  try {
    const appRoot = join(sandbox, "app", "v3");
    mkdirSync(join(appRoot, "src"), { recursive: true });
    copyFileSync(join(root, file), join(appRoot, "src", "prepared.ts"));
    const env = { PATH: process.env.PATH ?? "" };
    for (const key of ["SystemRoot", "SYSTEMROOT", "HOME", "USERPROFILE", "TEMP", "TMP", "TMPDIR"]) {
      if (process.env[key] !== undefined) env[key] = process.env[key];
    }
    const run = (label) => {
      const before = directoryFingerprint(sandbox);
      const result = spawnSync(executable, ["run", "src/prepared.ts"], {
        cwd: appRoot,
        env,
        encoding: "utf8",
        timeout: READINESS_TIMEOUT_MS,
        windowsHide: true,
      });
      if (result.error?.code === "ENOENT") {
        failures.push(`${file}: bun is required to run the readiness check (${executable} not found)`);
        return null;
      }
      if (result.error || result.signal) {
        failures.push(
          `${file}: readiness check ${label} did not finish within ${READINESS_TIMEOUT_MS / 1000} s; it must not start or wait for a server`,
        );
        return null;
      }
      if (directoryFingerprint(sandbox) !== before) {
        failures.push(`${file}: readiness check ${label} wrote files; it must be read-only`);
      }
      return result.status;
    };
    const missing = run("without dist/index.html");
    if (missing === null) return;
    if (missing === 0) {
      failures.push(
        `${file}: readiness check exits 0 without dist/index.html; it must fail while the client build is missing`,
      );
    }
    mkdirSync(join(appRoot, "dist"), { recursive: true });
    writeFileSync(join(appRoot, "dist", "index.html"), "<!doctype html>\n");
    const present = run("with dist/index.html");
    if (present !== null && present !== 0) {
      failures.push(
        `${file}: readiness check exits ${present} although dist/index.html exists; it must pass once the client is built`,
      );
    }
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

// Defense in depth next to the behavioural run: the readiness check source
// must not even mention build, write or child-process APIs.
function validatePreparedCheckSource(source, failures) {
  const file = "app/v3/src/prepared.ts";
  const mutation =
    /\b(?:writeFile|writeFileSync|appendFile|mkdir|mkdirSync|rmSync|unlink|unlinkSync|rename|copyFile|spawn|spawnSync|execSync|execFile)\b|Bun\.(?:write|spawn|spawnSync|\$)|from ['"](?:vite|node:child_process)['"]/;
  if (mutation.test(source)) {
    failures.push(`${file}: readiness check must be read-only (no build, write or child process)`);
  }
}

// Lazurio Module Standard start contract of app/v3: one Bun server process,
// the client build as declared preparation, no supervisor dependency.
function validateAppStartContract(root, appPackageText, preparedSource, failures) {
  let appPackage;
  try {
    appPackage = JSON.parse(appPackageText);
  } catch {
    return; // The JSON parser reports invalid or missing package.json separately.
  }
  const scripts = appPackage?.scripts ?? {};
  if (scripts.dev !== "bun run src/server.ts") {
    failures.push("app/v3/package.json: dev must start exactly one Bun server process (bun run src/server.ts)");
  }
  if (scripts["prepare:app"] !== APP_PREPARE_SCRIPT) {
    failures.push(`app/v3/package.json: prepare:app must build the client once (${APP_PREPARE_SCRIPT})`);
  }
  // The declared readiness check must be the App's own read-only check of the
  // client build the server serves; any other command (for example one that
  // always exits 0) would report an unprepared checkout as ready.
  if (scripts["check:prepared"] !== APP_CHECK_PREPARED_SCRIPT) {
    failures.push(
      `app/v3/package.json: check:prepared must run the App's own readiness check (${APP_CHECK_PREPARED_SCRIPT})`,
    );
  }
  if (!preparedSource) {
    failures.push("app/v3/src/prepared.ts: missing; check:prepared must test the client build");
  } else {
    validatePreparedCheckSource(preparedSource, failures);
    if (scripts["check:prepared"] === APP_CHECK_PREPARED_SCRIPT) {
      validatePreparedCheckBehavior(root, failures);
    }
  }
  // What the Launchpad starts: only lazurio.runtime.dev_script. It must be
  // `dev` (checked above to be exactly the single-process server start) and no
  // preview_script may offer the Launchpad a second entry.
  const runtime = appPackage?.lazurio?.runtime;
  if (runtime?.dev_script !== "dev" || Object.hasOwn(runtime ?? {}, "preview_script")) {
    failures.push("app/v3/package.json: lazurio.runtime must start only dev_script dev and declare no preview_script");
  }
  const preparation = appPackage?.lazurio?.preparation;
  if (
    preparation?.schema_version !== "lazurio.preparation.v1" ||
    preparation?.owner_package !== "app/v3/package.json" ||
    preparation?.prepare_script !== "prepare:app" ||
    preparation?.check_script !== "check:prepared"
  ) {
    failures.push("app/v3/package.json: lazurio.preparation must declare prepare:app and check:prepared");
  }
  for (const lifecycle of ["prepare", "preinstall", "install", "postinstall", "prepack"]) {
    if (Object.hasOwn(scripts, lifecycle)) {
      failures.push(`app/v3/package.json: ${lifecycle} is an npm lifecycle script; preparation must not run inside bun install`);
    }
  }
  if (
    Object.hasOwn(appPackage?.dependencies ?? {}, "concurrently") ||
    Object.hasOwn(appPackage?.devDependencies ?? {}, "concurrently")
  ) {
    failures.push("app/v3/package.json: concurrently is not allowed; dev is one process");
  }
  for (const script of ["check", "test"]) {
    if (typeof scripts[script] !== "string" || !scripts[script].trim()) {
      failures.push(`app/v3/package.json: ${script} script must exist`);
    }
  }
  if (!/^bun@\d+\.\d+\.\d+$/.test(appPackage?.packageManager ?? "")) {
    failures.push("app/v3/package.json: packageManager must pin an exact bun@<version>");
  }
}

function validateDocumentationContract(
  root,
  failures,
  { includeTemplateOnly = true } = {},
) {
  if (includeTemplateOnly) {
    const license = existsSync(join(root, "LICENSE")) ? readText(root, "LICENSE") : "";
    if (!license.includes("MIT License") || !license.includes("Permission is hereby granted")) {
      failures.push("LICENSE: must contain the MIT License grant");
    }

    const readme = existsSync(join(root, "README.md")) ? readText(root, "README.md") : "";
    if (!readme.includes("docs/mission-control-v3-operating-manual.md")) {
      failures.push("README.md: must link the Mission Control v3 operating manual");
    }
    if (!readme.includes("MIT License")) {
      failures.push("README.md: must state the MIT License client-rights model");
    }

    const moduleStandard = existsSync(join(root, "docs/v3-module-documentation-standard.md"))
      ? readText(root, "docs/v3-module-documentation-standard.md")
      : "";
    for (const phrase of ["Every reusable Lazurio GEN3", "Required files", "Client-rights policy", "Agent-facing writing style"]) {
      if (!moduleStandard.includes(phrase)) failures.push(`v3 module documentation standard must explain ${phrase}`);
    }
  }

  const manual = existsSync(join(root, "docs/mission-control-v3-operating-manual.md"))
    ? readText(root, "docs/mission-control-v3-operating-manual.md")
    : "";
  for (const phrase of [
    "Lazurio",
    "Organization-owned data",
    "repository-db",
    "Doctor",
    "Launchpad",
    "Extension guide",
    "What not to do",
  ]) {
    if (!manual.includes(phrase)) failures.push(`operating manual must explain ${phrase}`);
  }

  const installDocs = existsSync(join(root, "docs/doctor-managed-install.md"))
    ? readText(root, "docs/doctor-managed-install.md")
    : "";
  for (const phrase of [
    "origin=<Org>/mission-control",
    "upstream=Lazurio/mission-control",
    "<Org>/mission-control-data",
    "branch v3",
    "mission-control/db",
    "no-live-data",
  ]) {
    if (!installDocs.includes(phrase)) failures.push(`doctor install docs must explain ${phrase}`);
  }

  const activeWriterFiles = [
    "AGENTS.md",
    "SECURITY.md",
    "docs/README.md",
    "docs/doctor-managed-install.md",
    "docs/repository-db-data-boundary.md",
    "docs/mission-control-v3-operating-manual.md",
    "docs/mission-control-v3-rollout-manual.md",
    "templates/organization-data/README.md",
  ];
  const activeWriterText = Object.fromEntries(
    activeWriterFiles.map((file) => [
      file,
      existsSync(join(root, file)) ? readText(root, file) : "",
    ]),
  );
  for (const [file, fragment] of [
    ["SECURITY.md", "Mission Control data writes should go through repository-db changeset"],
    ["docs/mission-control-v3-operating-manual.md", "requires a confirmed exact\nprovider access audit"],
    ["docs/mission-control-v3-rollout-manual.md", "provider_access_audit_required"],
    ["docs/mission-control-v3-rollout-manual.md", "znovu ověří provider audit"],
    ["docs/mission-control-v3-rollout-manual.md", "plus the matching provider audit"],
    ["docs/mission-control-v3-rollout-manual.md", "after the provider audit"],
    ["AGENTS.md", "authenticated-capability-v1"],
    ["SECURITY.md", "authenticated-capability-v1"],
    ["docs/mission-control-v3-operating-manual.md", "authenticated-capability-v1"],
    ["docs/mission-control-v3-rollout-manual.md", "authenticated-capability-v1"],
  ]) {
    if (activeWriterText[file].includes(fragment)) {
      failures.push(`${file}: contains superseded writer gate: ${fragment}`);
    }
  }
  for (const file of activeWriterFiles) {
    for (const fragment of [
      "authenticated-capability-v1",
      "runAuthenticatedMissionControlWriterRequest",
      "createPendingChangeset",
      "approvePendingChangeset",
      "publishApprovedChangeset",
      "create → approve → publish",
    ]) {
      if (activeWriterText[file].includes(fragment)) {
        failures.push(`${file}: contains retired active-writer machinery: ${fragment}`);
      }
    }
  }
  for (const [file, phrase] of [
    ["AGENTS.md", "GitHub repository grants"],
    ["AGENTS.md", "Frozen historical audit data"],
    ["SECURITY.md", "Default: `local-principal-v1`"],
    ["SECURITY.md", "Hosted profile: `github-app-workspace-v1`"],
    ["SECURITY.md", "Frozen historical audit data"],
    ["docs/mission-control-v3-operating-manual.md", "Default: `local-principal-v1`"],
    ["docs/mission-control-v3-operating-manual.md", "Hosted Team Workspace: `github-app-workspace-v1`"],
    ["docs/mission-control-v3-operating-manual.md", "Frozen historical audit data"],
    ["docs/mission-control-v3-rollout-manual.md", "GitHub identita a repository grants"],
    ["docs/mission-control-v3-rollout-manual.md", "Hosted Team Workspace: `github-app-workspace-v1`"],
    ["docs/mission-control-v3-rollout-manual.md", "Frozen historical audit data"],
    ["docs/repository-db-data-boundary.md", "github-app-workspace-v1"],
    ["docs/repository-db-data-boundary.md", "Frozen historical audit data"],
    ["templates/organization-data/README.md", "github-app-workspace-v1"],
    ["templates/organization-data/README.md", "active runtime never creates or advances"],
  ]) {
    if (!activeWriterText[file].includes(phrase)) {
      failures.push(`${file}: must declare current writer contract phrase ${phrase}`);
    }
  }
  for (const file of [
    "AGENTS.md",
    "SECURITY.md",
    "docs/mission-control-v3-operating-manual.md",
    "docs/mission-control-v3-rollout-manual.md",
  ]) {
    for (const phrase of [
      "trusted-process",
      "provider-enforced",
      "Organization Admin",
    ]) {
      if (!activeWriterText[file].includes(phrase)) {
        failures.push(
          `${file}: must declare progressive enforcement phrase ${phrase}`,
        );
      }
    }
  }
}

export function validateTemplate(root = process.cwd()) {
  const failures = [];
  const rootPackage = existsSync(join(root, "package.json"))
    ? parseJsonFile(root, "package.json", failures)
    : null;
  const instanceMode = rootPackage?.companyascode?.mission_control?.mode;
  for (const file of requiredFiles) {
    if (instanceMode === "organization" && templateOnlyRequiredFiles.has(file)) {
      continue;
    }
    if (!existsSync(join(root, file))) failures.push(`missing required file: ${file}`);
  }
  for (const dir of requiredDirectories) {
    if (!isDirectory(root, dir)) failures.push(`missing required directory: ${dir}`);
  }

  for (const file of jsonFiles.filter((file) => existsSync(join(root, file)))) {
    parseJsonFile(root, file, failures);
  }
  for (const file of requiredLedgerArrays.filter((file) => existsSync(join(root, file)))) {
    const value = parseJsonFile(root, file, failures);
    if (value && !Array.isArray(value)) failures.push(`${file}: must be a JSON array`);
  }

  const missionControlConfig = existsSync(join(root, "templates/organization-data/data/mission-control/mission-control.config.json"))
    ? parseJsonFile(root, "templates/organization-data/data/mission-control/mission-control.config.json", failures)
    : null;
  const pinnedValidatorPaths = existsSync(
    join(root, "config/trusted-pinned-validator-paths.json"),
  )
    ? parseJsonFile(
        root,
        "config/trusted-pinned-validator-paths.json",
        failures,
      )
    : null;
  const roadmapSchema = existsSync(join(root, "schemas/mission-control-roadmap.schema.json"))
    ? parseJsonFile(root, "schemas/mission-control-roadmap.schema.json", failures)
    : null;
  const planSchema = existsSync(join(root, "schemas/mission-control-plan.schema.json"))
    ? parseJsonFile(root, "schemas/mission-control-plan.schema.json", failures)
    : null;
  const organizationPlanSchema = existsSync(join(root, "templates/organization-data/schemas/mission-control-plan.schema.json"))
    ? parseJsonFile(root, "templates/organization-data/schemas/mission-control-plan.schema.json", failures)
    : null;
  const repositoryDbConfig = existsSync(join(root, "templates/organization-data/repository-db.yaml"))
    ? parseYamlFile(root, "templates/organization-data/repository-db.yaml", failures)
    : null;
  const packageJson = rootPackage;
  const organizationDataPackage = existsSync(join(root, "templates/organization-data/package.json"))
    ? parseJsonFile(root, "templates/organization-data/package.json", failures)
    : null;
  const moduleManifest = existsSync(join(root, "lazurio.module.json"))
    ? parseJsonFile(root, "lazurio.module.json", failures)
    : null;
  const launchpadAppModuleTemplate = existsSync(join(root, "templates/launchpad-app/lazurio.module.json.template"))
    ? parseJsonFile(root, "templates/launchpad-app/lazurio.module.json.template", failures)
    : null;
  const launchpadAppPackageTemplate = existsSync(join(root, "templates/launchpad-app/package.json.template"))
    ? parseJsonFile(root, "templates/launchpad-app/package.json.template", failures)
    : null;
  const appPackage = existsSync(join(root, "app/v3/package.json"))
    ? parseJsonFile(root, "app/v3/package.json", failures)
    : null;
  const rootBunLock = existsSync(join(root, "bun.lock"))
    ? parseYamlFile(root, "bun.lock", failures)
    : null;
  const appBunLock = existsSync(join(root, "app/v3/bun.lock"))
    ? parseYamlFile(root, "app/v3/bun.lock", failures)
    : null;
  validateRepositoryDbConfig(root, repositoryDbConfig, missionControlConfig, failures);
  validatePlanPrefixSchema(planSchema, "schemas/mission-control-plan.schema.json", failures);
  validatePlanPrefixSchema(
    organizationPlanSchema,
    "templates/organization-data/schemas/mission-control-plan.schema.json",
    failures,
  );
  if (
    planSchema &&
    organizationPlanSchema &&
    JSON.stringify(planSchema) !== JSON.stringify(organizationPlanSchema)
  ) {
    failures.push("Organization data plan schema must stay identical to the app/code plan schema");
  }
  validateRoadmapPlanningModel(root, roadmapSchema, failures);
  validateRuntimeContract(packageJson, failures);
  validateBunLockIdentity({
    lock: rootBunLock,
    lockPath: "bun.lock",
    packageJson,
    packagePath: "package.json",
    failures,
  });
  validateBunLockIdentity({
    lock: appBunLock,
    lockPath: "app/v3/bun.lock",
    packageJson: appPackage,
    packagePath: "app/v3/package.json",
    failures,
  });
  validateOrganizationDataPackage(organizationDataPackage, failures);
  validateOrganizationDataAgentContract(root, failures);
  validatePinnedValidatorPaths(pinnedValidatorPaths, failures);
  validateReusableAppPackage(packageJson, moduleManifest, appPackage, failures);
  validateLaunchpadAppPackageTemplate(
    launchpadAppModuleTemplate,
    launchpadAppPackageTemplate,
    failures,
  );
  validateSingleListenerSource(root, failures);
  validateDocumentationContract(root, failures, {
    includeTemplateOnly:
      packageJson?.companyascode?.mission_control?.mode !== "organization",
  });

  for (const file of requiredFiles.filter((file) => existsSync(join(root, file)))) {
    const text = readText(root, file);
    for (const marker of forbidden) {
      if (text.includes(marker)) failures.push(`${file}: forbidden marker ${marker}`);
    }
  }
  const instance = packageJson?.companyascode?.mission_control;
  for (const file of listTemplateTextFiles(root, ".", {
    ignoreOrganizationDataMount: instance?.mode === "organization",
  })) {
    const text = readText(root, file);
    for (const marker of forbiddenLiveDataMarkers) {
      if (
        containsForbiddenLiveDataMarker({
          file,
          text,
          marker,
          instance,
          packageJson,
          moduleManifest,
          appPackage,
        })
      ) {
        failures.push(`${file}: forbidden live-data marker ${marker}`);
      }
    }
  }
  return failures;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const failures = validateTemplate(process.cwd());
  if (failures.length) {
    console.error("MissionControlTemplate check failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log("MissionControlTemplate check OK");
}
