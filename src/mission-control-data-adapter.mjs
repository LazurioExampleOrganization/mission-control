import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

// Launchpad cold-installs the independently runnable app/v3 package. Anchor
// runtime dependency resolution there so the adapter does not require a
// second node_modules installation at the app-code repository root.
const requireFromV3App = createRequire(new URL("../app/v3/package.json", import.meta.url));
const YAML = requireFromV3App("yaml");

function readText(path) {
  return readFileSync(path, "utf8");
}

function parseJsonFile(path) {
  return JSON.parse(readText(path));
}

function parseYamlFile(path) {
  return YAML.parse(readText(path));
}

function toPosixPath(path) {
  return path.split(sep).join("/");
}

function repoRelativePath(repositoryDbRoot, absolutePath) {
  return toPosixPath(relative(repositoryDbRoot, absolutePath));
}

function pathsReferToSameProtectedFile(repositoryDbRoot, leftPath, rightPath) {
  const left = resolve(leftPath);
  const right = resolve(rightPath);
  const leftRelative = repoRelativePath(repositoryDbRoot, left).toLowerCase();
  const rightRelative = repoRelativePath(repositoryDbRoot, right).toLowerCase();
  if (leftRelative === rightRelative) return true;
  if (!existsSync(left) || !existsSync(right)) return false;
  try {
    if (realpathSync(left) === realpathSync(right)) return true;
    const leftStat = statSync(left);
    const rightStat = statSync(right);
    return leftStat.dev === rightStat.dev && leftStat.ino === rightStat.ino;
  } catch {
    return false;
  }
}

function isPathLexicallyInsideRoot(root, target) {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(target);
  const rel = relative(resolvedRoot, resolvedTarget);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function assertInsideRoot(root, target, label) {
  if (isPathLexicallyInsideRoot(root, target)) return resolve(target);
  throw new Error(`${label} must stay inside repository-db root: ${target}`);
}

function assertPathInsideRootSafe(root, target, label) {
  const resolvedRoot = resolve(root);
  const resolvedTarget = assertInsideRoot(resolvedRoot, target, label);
  const rel = relative(resolvedRoot, resolvedTarget);
  const segments = rel === "" ? [] : rel.split(sep).filter(Boolean);
  let cursor = resolvedRoot;
  for (const segment of segments) {
    cursor = join(cursor, segment);
    if (!existsSync(cursor)) break;
    if (lstatSync(cursor).isSymbolicLink()) {
      throw new Error(`${label} must not traverse symlinked path components`);
    }
  }
  const rootReal = realpathSync(resolvedRoot);
  const nearest = nearestExistingPath(resolvedTarget) ?? resolvedRoot;
  const nearestReal = realpathSync(nearest);
  const realRel = relative(rootReal, nearestReal);
  if (realRel.startsWith("..") || isAbsolute(realRel)) {
    throw new Error(`${label} must stay inside repository-db root after resolving symlinks`);
  }
  return resolvedTarget;
}

function resolveConfiguredPath(repositoryDbRoot, configuredPath, label) {
  if (typeof configuredPath !== "string" || configuredPath.trim() === "") {
    throw new Error(`${label} must be a non-empty relative path`);
  }
  if (isAbsolute(configuredPath)) {
    throw new Error(`${label} must stay inside repository-db root: ${configuredPath}`);
  }
  return assertPathInsideRootSafe(repositoryDbRoot, join(repositoryDbRoot, configuredPath), label);
}

function requireExistingFile(path, label) {
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error(`${label} missing: ${path}`);
  }
  return path;
}

function listFilesRecursive(root) {
  if (!existsSync(root)) return [];
  const stat = statSync(root);
  if (!stat.isDirectory()) throw new Error(`Expected directory: ${root}`);
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const absolute = join(root, entry.name);
    if (entry.isDirectory()) files.push(...listFilesRecursive(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files.sort();
}

function parseMaybeStructuredFile(path) {
  const extension = extname(path).toLowerCase();
  const content = readText(path);
  if (extension === ".json") return { content, parsed: JSON.parse(content) };
  if (extension === ".yaml" || extension === ".yml") return { content, parsed: YAML.parse(content) };
  return { content, parsed: null };
}

function loadYamlRecordsFromDirectory(repositoryDbRoot, directory, kind) {
  return listFilesRecursive(directory)
    .filter((path) => [".yaml", ".yml"].includes(extname(path).toLowerCase()))
    .map((path) => ({
      ...parseYamlFile(path),
      kind,
      relativePath: repoRelativePath(repositoryDbRoot, path),
    }));
}

function loadArtifactsFromDirectory(repositoryDbRoot, directory) {
  return listFilesRecursive(directory)
    .filter((path) => !basename(path).startsWith("."))
    .filter((path) => new Set([".json", ".yaml", ".yml", ".md", ".markdown", ".txt"]).has(extname(path).toLowerCase()))
    .map((path) => ({
      relativePath: repoRelativePath(repositoryDbRoot, path),
      ...parseMaybeStructuredFile(path),
    }));
}

function loadRepositoryDbConfig(repositoryDbRoot) {
  const configPath = assertPathInsideRootSafe(repositoryDbRoot, join(repositoryDbRoot, "repository-db.yaml"), "repository-db.yaml");
  requireExistingFile(configPath, "repository-db.yaml");
  const config = parseYamlFile(configPath);
  if (config?.schema_version !== "repository-db.config.v1") {
    throw new Error("repository-db.yaml schema_version must be repository-db.config.v1");
  }
  if (config?.app !== "mission-control") {
    throw new Error("repository-db.yaml app must be mission-control");
  }
  return config;
}

function loadMissionControlConfig(repositoryDbRoot, repositoryDbConfig) {
  const dataLayout = repositoryDbConfig?.layout?.data ?? "data";
  const dataRoot = resolveConfiguredPath(repositoryDbRoot, dataLayout, "layout.data");
  const configPath = assertPathInsideRootSafe(
    repositoryDbRoot,
    join(dataRoot, "mission-control/mission-control.config.json"),
    "mission-control.config.json",
  );
  requireExistingFile(configPath, "mission-control.config.json");
  const config = parseJsonFile(configPath);
  if (config?.data_mode !== "repository-db") {
    throw new Error("mission-control.config.json data_mode must be repository-db");
  }
  return config;
}

function readJsonArray(path, label) {
  const value = parseJsonFile(requireExistingFile(path, label));
  if (!Array.isArray(value)) throw new Error(`${label} must be a JSON array`);
  return value;
}

function isSamePathOrInside(parent, target) {
  const resolvedParent = resolve(parent);
  const resolvedTarget = resolve(target);
  const rel = relative(resolvedParent, resolvedTarget);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function assertRepositoryDbMissionControlWritePath(config, repositoryDbRoot, targetPath) {
  const target = resolve(targetPath);
  const repositoryDbConfig = loadRepositoryDbConfig(repositoryDbRoot);
  const dataRoot = resolveConfiguredPath(
    repositoryDbRoot,
    repositoryDbConfig?.layout?.data ?? "data",
    "layout.data",
  );
  const missionControlRoot = assertPathInsideRootSafe(
    repositoryDbRoot,
    join(dataRoot, "mission-control"),
    "Mission Control data root",
  );
  const controlPlaneFiles = [
    assertPathInsideRootSafe(
      repositoryDbRoot,
      join(repositoryDbRoot, "repository-db.yaml"),
      "repository-db.yaml",
    ),
    assertPathInsideRootSafe(
      repositoryDbRoot,
      join(missionControlRoot, "mission-control.config.json"),
      "mission-control.config.json",
    ),
  ];
  if (
    controlPlaneFiles.some((path) =>
      pathsReferToSameProtectedFile(repositoryDbRoot, path, target),
    )
  ) {
    throw new Error("Repository-db write target is a protected Mission Control control-plane file");
  }

  const allowedDirectories = [
    [config.plans_dir, "plans_dir"],
    [config.roadmaps_dir, "roadmaps_dir"],
    [config.reports_dir ?? "data/mission-control/reports", "reports_dir"],
    [config.import_reviews_dir ?? "data/mission-control/import-reviews", "import_reviews_dir"],
    [config.publish_policy?.pending_changesets_dir ?? "data/mission-control/changesets/pending", "publish_policy.pending_changesets_dir"],
    [config.publish_policy?.published_changesets_dir ?? "data/mission-control/changesets/published", "publish_policy.published_changesets_dir"],
    [config.publish_policy?.superseded_changesets_dir ?? "data/mission-control/changesets/superseded", "publish_policy.superseded_changesets_dir"],
  ];
  for (const [configuredPath, label] of allowedDirectories) {
    const directory = resolveConfiguredPath(repositoryDbRoot, configuredPath, label);
    if (!isSamePathOrInside(missionControlRoot, directory)) {
      throw new Error(`${label} must stay inside the Mission Control data root`);
    }
    if (isSamePathOrInside(directory, target)) return;
  }

  const allowedFiles = [
    [config.issues_open_path, "issues_open_path"],
    [config.issues_resolved_path, "issues_resolved_path"],
    [config.todo_tasks_path, "todo_tasks_path"],
    [config.done_tasks_path, "done_tasks_path"],
  ];
  for (const [configuredPath, label] of allowedFiles) {
    const file = resolveConfiguredPath(repositoryDbRoot, configuredPath, label);
    if (!isSamePathOrInside(missionControlRoot, file)) {
      throw new Error(`${label} must stay inside the Mission Control data root`);
    }
    if (resolve(file) === target) return;
  }

  throw new Error("Repository-db write target is not an allowed Mission Control data path");
}

export function loadMissionControlData({ repositoryDbRoot }) {
  if (!repositoryDbRoot) throw new Error("repositoryDbRoot is required");
  const root = assertInsideRoot(dirname(resolve(repositoryDbRoot)), resolve(repositoryDbRoot), "repositoryDbRoot");
  const repositoryDbConfig = loadRepositoryDbConfig(root);
  const config = loadMissionControlConfig(root, repositoryDbConfig);

  const plansDir = resolveConfiguredPath(root, config.plans_dir, "plans_dir");
  const roadmapsDir = resolveConfiguredPath(root, config.roadmaps_dir, "roadmaps_dir");
  const reportsDir = resolveConfiguredPath(root, config.reports_dir ?? "data/mission-control/reports", "reports_dir");
  const importReviewsDir = resolveConfiguredPath(
    root,
    config.import_reviews_dir ?? "data/mission-control/import-reviews",
    "import_reviews_dir",
  );
  const issuesOpenPath = resolveConfiguredPath(root, config.issues_open_path, "issues_open_path");
  const issuesResolvedPath = resolveConfiguredPath(root, config.issues_resolved_path, "issues_resolved_path");
  const todoTasksPath = resolveConfiguredPath(root, config.todo_tasks_path, "todo_tasks_path");
  const doneTasksPath = resolveConfiguredPath(root, config.done_tasks_path, "done_tasks_path");

  return {
    repositoryDb: {
      root,
      config: repositoryDbConfig,
    },
    config,
    paths: {
      plansDir,
      roadmapsDir,
      reportsDir,
      importReviewsDir,
      issuesOpenPath,
      issuesResolvedPath,
      todoTasksPath,
      doneTasksPath,
    },
    plans: loadYamlRecordsFromDirectory(root, plansDir, "plan"),
    roadmaps: loadYamlRecordsFromDirectory(root, roadmapsDir, "roadmap"),
    issues: {
      open: readJsonArray(issuesOpenPath, "ISSUES.open.json"),
      resolved: readJsonArray(issuesResolvedPath, "ISSUES.resolved.json"),
    },
    tasks: {
      todo: readJsonArray(todoTasksPath, "TODO.tasks.json"),
      done: readJsonArray(doneTasksPath, "DONE.tasks.json"),
    },
    reports: loadArtifactsFromDirectory(root, reportsDir),
    importReviews: loadArtifactsFromDirectory(root, importReviewsDir),
  };
}

function nearestExistingPath(path) {
  let current = resolve(path);
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return current;
}

function assertWritePathInsideRootSafe(root, targetPath, label) {
  if (!isPathLexicallyInsideRoot(root, targetPath)) return false;
  assertPathInsideRootSafe(root, targetPath, label);
  return true;
}

export function assertMissionControlWriteTarget({ config, repositoryDbRoot, targetPath, legacyRoots = [] }) {
  if (!config) throw new Error("config is required");
  if (!repositoryDbRoot) throw new Error("repositoryDbRoot is required");
  if (!targetPath) throw new Error("targetPath is required");

  const target = resolve(targetPath);
  if (assertWritePathInsideRootSafe(repositoryDbRoot, target, "Repository-db write target")) {
    assertRepositoryDbMissionControlWritePath(config, repositoryDbRoot, target);
    return { allowed: true, mode: "repository-db", target };
  }

  if (config.compatibility_bridge?.legacy_write_paths_allowed === true) {
    if (!Array.isArray(legacyRoots) || legacyRoots.length === 0) {
      throw new Error("Legacy Mission Control writes require explicit legacyRoots");
    }
    for (const legacyRoot of legacyRoots) {
      if (assertWritePathInsideRootSafe(legacyRoot, target, "Legacy Mission Control write target")) {
        return { allowed: true, mode: "legacy-compatibility", target, legacyRoot: resolve(legacyRoot) };
      }
    }
    throw new Error("Legacy Mission Control writes require target inside explicit legacyRoots");
  }
  throw new Error("Legacy Mission Control writes are disabled by compatibility_bridge.legacy_write_paths_allowed=false");
}
