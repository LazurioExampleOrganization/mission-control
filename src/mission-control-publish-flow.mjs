import { spawnSync } from "node:child_process";
import { AsyncLocalStorage } from "node:async_hooks";
import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { devNull, tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";
import { assertMissionControlWriteTarget, loadMissionControlData } from "./mission-control-data-adapter.mjs";

const gitNullDevice = process.platform === "win32" ? "NUL" : devNull;

const DEFAULT_PENDING_DIR = "data/mission-control/changesets/pending";
const DEFAULT_PUBLISHED_DIR = "data/mission-control/changesets/published";
const DEFAULT_SUPERSEDED_DIR = "data/mission-control/changesets/superseded";
const DEFAULT_GIT_TIMEOUT_MS = 15000;
const gitLongPathArguments = process.platform === "win32"
  ? ["-c", "core.longpaths=true"]
  : [];
const LOCAL_PRINCIPAL_WRITER_MODE = "local-principal-v1";
const GITHUB_APP_WORKSPACE_WRITER_MODE = "github-app-workspace-v1";
const LOCAL_DRAFT_SCHEMA =
  "companiesascode.mission_control.local_draft.v1";
const PLACEHOLDER_PREFIX = "REPLACE_WITH_";
const WINDOWS_DEVICE_NAME_PATTERN = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const PRINTABLE_ASCII_PATH_PATTERN = /^[\x20-\x7e]+$/;
const APP_CODE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requireFromV3App = createRequire(
  join(APP_CODE_ROOT, "app/v3/package.json"),
);
const { parse: parseYaml } = requireFromV3App("yaml");
const PINNED_DATA_VALIDATOR_PATH = join(
  APP_CODE_ROOT,
  "templates/organization-data/scripts/validate-mission-control-data.mjs",
);
const PINNED_DATA_SCHEMA_NAMES = [
  "mission-control-plan.schema.json",
  "mission-control-roadmap.schema.json",
  "mission-control-writer-audit.schema.json",
  "mission-control-writer-provenance.schema.json",
  "mission-control-local-publish.schema.json",
];
const REPOSITORY_DB_CONTROL_PLANE_PATHS = new Set([
  "repository-db.yaml",
  "data/mission-control/mission-control.config.json",
]);
const REPOSITORY_DB_CONTROL_PLANE_CASE_KEYS = new Set(
  [...REPOSITORY_DB_CONTROL_PLANE_PATHS].map((path) =>
    path.normalize("NFC").toLowerCase(),
  ),
);
const GIT_OPERATION_MARKERS = Object.freeze([
  Object.freeze({ path: "MERGE_HEAD", operation: "merge" }),
  Object.freeze({ path: "rebase-merge", operation: "rebase" }),
  Object.freeze({ path: "rebase-apply", operation: "rebase" }),
  Object.freeze({ path: "REBASE_HEAD", operation: "rebase" }),
  Object.freeze({ path: "sequencer", operation: "sequencer" }),
  Object.freeze({ path: "CHERRY_PICK_HEAD", operation: "cherry-pick" }),
  Object.freeze({ path: "REVERT_HEAD", operation: "revert" }),
  Object.freeze({ path: "BISECT_START", operation: "bisect" }),
  Object.freeze({ path: "BISECT_LOG", operation: "bisect" }),
]);
const GIT_BEHAVIOR_CONTROL_NAMES = new Set([
  ".gitattributes",
  ".gitignore",
  ".gitmodules",
]);
let testOnlyTrustedSshExecutable = null;
let testOnlyTrustedGitExecutable = null;
let testOnlyTrustedCredentialHelperExecutable = null;
let testOnlyPinnedDataValidatorPath = null;
const repositoryWriteLockStorage = new AsyncLocalStorage();

function isIsolatedLocalMutationTestFixture(repositoryDbRoot) {
  if (testOnlyTrustedSshExecutable === null) return false;
  try {
    const remote =
      loadMissionControlData({ repositoryDbRoot }).repositoryDb.config
        ?.data_repo?.remote;
    if (typeof remote !== "string" || !remote.startsWith("ssh://")) {
      return false;
    }
    const parsed = new URL(remote);
    // ssh://fixture@localhost/C:/... carries a leading slash before the
    // Windows drive letter; strip it so resolve() keeps the drive root.
    const parsedPathname = decodeURIComponent(parsed.pathname);
    const remotePath = resolve(
      process.platform === "win32" && /^\/[A-Za-z]:\//.test(parsedPathname)
        ? parsedPathname.slice(1)
        : parsedPathname,
    );
    const temporaryRoot = resolve(tmpdir());
    return (
      parsed.protocol === "ssh:" &&
      parsed.username === "fixture" &&
      parsed.hostname === "localhost" &&
      remotePath.startsWith(`${temporaryRoot}${sep}`) &&
      remotePath.endsWith(`${sep}mission-control-data.git`)
    );
  } catch {
    return false;
  }
}

function toPosixPath(path) {
  return path.split(sep).join("/");
}

function repoRelativePath(repositoryDbRoot, absolutePath) {
  return toPosixPath(relative(repositoryDbRoot, absolutePath));
}

function sanitizeCountedGitConfig(env) {
  for (const key of Object.keys(env)) {
    const upperKey = key.toUpperCase();
    if (
      upperKey === "GIT_CONFIG_COUNT" ||
      /^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(upperKey)
    ) {
      delete env[key];
    }
  }
}

function processEnvironmentWithoutGitOverrides() {
  const env = { ...process.env };
  const fixedOverrides = new Set([
    "BUN_OPTIONS",
    "DYLD_INSERT_LIBRARIES",
    "DYLD_LIBRARY_PATH",
    "LD_PRELOAD",
    "NODE_OPTIONS",
    "NODE_PATH",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_ALLOW_PROTOCOL",
    "GIT_AUTHOR_DATE",
    "GIT_AUTHOR_EMAIL",
    "GIT_AUTHOR_NAME",
    "GIT_CEILING_DIRECTORIES",
    "GIT_COMMON_DIR",
    "GIT_COMMITTER_DATE",
    "GIT_COMMITTER_EMAIL",
    "GIT_COMMITTER_NAME",
    "GIT_DISCOVERY_ACROSS_FILESYSTEM",
    "GIT_DIR",
    "GIT_EDITOR",
    "GIT_EXEC_PATH",
    "GIT_EXTERNAL_DIFF",
    "GIT_GRAFT_FILE",
    "GIT_INDEX_FILE",
    "GIT_NAMESPACE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_PAGER",
    "GIT_PREFIX",
    "GIT_PROXY_COMMAND",
    "GIT_PROTOCOL",
    "GIT_PROTOCOL_FROM_USER",
    "GIT_QUARANTINE_PATH",
    "GIT_NO_REPLACE_OBJECTS",
    "GIT_REPLACE_REF_BASE",
    "GIT_SEQUENCE_EDITOR",
    "GIT_SHALLOW_FILE",
    "GIT_SSH",
    "GIT_SSH_COMMAND",
    "GIT_SSH_VARIANT",
    "GIT_TEMPLATE_DIR",
    "GIT_WORK_TREE",
    "GIT_ASKPASS",
    "SSH_ASKPASS",
    "SSH_ASKPASS_REQUIRE",
    "SSH_SK_PROVIDER",
  ]);
  for (const key of [
    "GPG_AGENT_INFO",
    "GNUPGHOME",
    "SSH_AGENT_PID",
    "SSH_AUTH_SOCK",
  ]) {
    fixedOverrides.add(key);
  }
  sanitizeCountedGitConfig(env);
  for (const key of Object.keys(env)) {
    const upperKey = key.toUpperCase();
    if (
      fixedOverrides.has(upperKey) ||
      upperKey === "GIT_CONFIG" ||
      upperKey === "GIT_CONFIG_PARAMETERS" ||
      upperKey.startsWith("GIT_SSL_") ||
      upperKey.startsWith("GIT_TRACE") ||
      upperKey.startsWith("GIT_CURL_") ||
      upperKey === "GIT_HTTP_PROXY_AUTHMETHOD" ||
      upperKey === "GIT_HTTP_USER_AGENT" ||
      upperKey === "HTTP_PROXY" ||
      upperKey === "HTTPS_PROXY" ||
      upperKey === "ALL_PROXY" ||
      upperKey === "NO_PROXY" ||
      upperKey === "CURL_CA_BUNDLE" ||
      upperKey === "SSL_CERT_FILE" ||
      upperKey === "SSL_CERT_DIR"
    ) {
      delete env[key];
    }
  }
  env.GIT_CONFIG_GLOBAL = gitNullDevice;
  env.GIT_CONFIG_SYSTEM = gitNullDevice;
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_NO_REPLACE_OBJECTS = "1";
  env.GIT_TERMINAL_PROMPT = "0";
  env.GIT_OPTIONAL_LOCKS = "0";
  env.GIT_PAGER = "cat";
  env.GIT_EDITOR = "true";
  env.GCM_INTERACTIVE = "never";
  return env;
}

function executableIsTrusted(
  path,
  { testFixtureName = null, allowCurrentUser = false } = {},
) {
  try {
    const resolvedPath = resolve(path);
    const realPath = realpathSync(resolvedPath);
    const info = statSync(realPath);
    if (!info.isFile()) return false;
    if (testFixtureName) {
      const expectedRoot = resolve(
        tmpdir(),
        `mission-control-test-${testFixtureName}-${process.pid}`,
      );
      const expectedRealRoot = realpathSync(expectedRoot);
      return (
        lstatSync(resolvedPath).isFile() &&
        (process.platform === "win32" || (info.mode & 0o022) === 0) &&
        dirname(realPath) === expectedRealRoot &&
        basename(realPath) === testFixtureName
      );
    }
    if (process.platform === "win32") return true;
    const currentUid = process.getuid?.();
    return (
      (info.mode & 0o022) === 0 &&
      (info.uid === 0 ||
        (allowCurrentUser &&
          Number.isInteger(currentUid) &&
          info.uid === currentUid))
    );
  } catch {
    return false;
  }
}

function trustedGitInvocation() {
  if (
    testOnlyTrustedGitExecutable &&
    executableIsTrusted(testOnlyTrustedGitExecutable, {
      testFixtureName: "git",
    })
  ) {
    return {
      command: process.execPath,
      argsPrefix: [testOnlyTrustedGitExecutable],
    };
  }
  // The current Principal owns this machine, PATH and Git installation.
  // Let the OS resolve Git exactly as an ordinary terminal invocation does;
  // repository grants on GitHub remain the only write authorization.
  return { command: "git", argsPrefix: [] };
}

function nativePrincipalEnvironment() {
  const env = { ...process.env };
  const repositoryRoutingOverrides = new Set([
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_AUTHOR_DATE",
    "GIT_AUTHOR_EMAIL",
    "GIT_AUTHOR_NAME",
    "GIT_CEILING_DIRECTORIES",
    "GIT_COMMON_DIR",
    "GIT_COMMITTER_DATE",
    "GIT_COMMITTER_EMAIL",
    "GIT_COMMITTER_NAME",
    "GIT_CONFIG",
    "GIT_CONFIG_PARAMETERS",
    "GIT_DIR",
    "GIT_EXEC_PATH",
    "GIT_GRAFT_FILE",
    "GIT_INDEX_FILE",
    "GIT_NAMESPACE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_PREFIX",
    "GIT_QUARANTINE_PATH",
    "GIT_REPLACE_REF_BASE",
    "GIT_SHALLOW_FILE",
    "GIT_SSH",
    "GIT_SSH_COMMAND",
    "GIT_SSH_VARIANT",
    "GIT_TEMPLATE_DIR",
    "GIT_WORK_TREE",
  ]);
  for (const key of Object.keys(env)) {
    const upperKey = key.toUpperCase();
    if (
      repositoryRoutingOverrides.has(upperKey) ||
      upperKey === "GIT_CONFIG_COUNT" ||
      /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(upperKey) ||
      upperKey.startsWith("LD_") ||
      upperKey.startsWith("DYLD_") ||
      [
        "BASH_ENV",
        "BASHOPTS",
        "BUN_OPTIONS",
        "CDPATH",
        "ENV",
        "KSHENV",
        "NODE_OPTIONS",
        "NODE_PATH",
        "SHELLOPTS",
      ].includes(upperKey)
    ) {
      delete env[key];
    }
  }
  env.GIT_NO_REPLACE_OBJECTS = "1";
  env.GIT_TERMINAL_PROMPT = "0";
  env.GIT_OPTIONAL_LOCKS = "0";
  env.GIT_EDITOR = "true";
  env.GIT_PAGER = "cat";
  delete env.GCM_INTERACTIVE;
  return env;
}

// Test-only dependency injection. The accepted executable must be the
// process-specific, non-symlink fixture created by test-support with no
// group/world write bit. Production callers never invoke this hook.
export function installMissionControlTestSshExecutable(executable) {
  const resolvedExecutable = resolve(executable);
  if (
    !executableIsTrusted(resolvedExecutable, { testFixtureName: "ssh" })
  ) {
    throw new Error("Mission Control test SSH executable is not trusted");
  }
  if (testOnlyTrustedSshExecutable !== null) {
    throw new Error("Mission Control test SSH executable is already installed");
  }
  testOnlyTrustedSshExecutable = resolvedExecutable;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (testOnlyTrustedSshExecutable === resolvedExecutable) {
      testOnlyTrustedSshExecutable = null;
    }
  };
}

// Equivalent narrow dependency injection for deadline/security tests. The
// fixture must be the process-specific non-symlink `git` file under the real
// platform temp directory and cannot be group/world writable.
export function installMissionControlTestGitExecutable(executable) {
  const resolvedExecutable = resolve(executable);
  if (
    !executableIsTrusted(resolvedExecutable, { testFixtureName: "git" })
  ) {
    throw new Error("Mission Control test Git executable is not trusted");
  }
  if (testOnlyTrustedGitExecutable !== null) {
    throw new Error("Mission Control test Git executable is already installed");
  }
  testOnlyTrustedGitExecutable = resolvedExecutable;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (testOnlyTrustedGitExecutable === resolvedExecutable) {
      testOnlyTrustedGitExecutable = null;
    }
  };
}

// Equivalent narrow dependency injection for the HTTPS credential helper
// probe. While installed, helper discovery is pinned to this fixture only and
// never falls back to real local/system Git config, so tests stay hermetic.
export function installMissionControlTestCredentialHelperExecutable(
  executable,
) {
  const resolvedExecutable = resolve(executable);
  if (
    !executableIsTrusted(resolvedExecutable, {
      testFixtureName: "credential-helper",
    })
  ) {
    throw new Error(
      "Mission Control test credential helper executable is not trusted",
    );
  }
  if (testOnlyTrustedCredentialHelperExecutable !== null) {
    throw new Error(
      "Mission Control test credential helper executable is already installed",
    );
  }
  testOnlyTrustedCredentialHelperExecutable = resolvedExecutable;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (
      testOnlyTrustedCredentialHelperExecutable === resolvedExecutable
    ) {
      testOnlyTrustedCredentialHelperExecutable = null;
    }
  };
}

// Equivalent narrow dependency injection for validator mutation regression
// tests. Production always uses the validator pinned in this app-code tree.
export function installMissionControlTestDataValidator(validatorPath) {
  const resolvedValidatorPath = resolve(validatorPath);
  if (
    !executableIsTrusted(resolvedValidatorPath, {
      testFixtureName: "validator.mjs",
    })
  ) {
    throw new Error("Mission Control test data validator is not trusted");
  }
  if (testOnlyPinnedDataValidatorPath !== null) {
    throw new Error("Mission Control test data validator is already installed");
  }
  testOnlyPinnedDataValidatorPath = resolvedValidatorPath;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (testOnlyPinnedDataValidatorPath === resolvedValidatorPath) {
      testOnlyPinnedDataValidatorPath = null;
    }
  };
}

function run(
  command,
  args,
  {
    cwd,
    allowFailure = false,
    binaryStdout = false,
    timeoutMs,
    nativePrincipalProcess = false,
    testOnlySshFixtureRepositoryDbRoot = null,
    validationWorkspaceRoot,
    validationBase,
    input,
  } = {},
) {
  const commandEnvironment = nativePrincipalProcess
    ? nativePrincipalEnvironment()
    : {
        ...processEnvironmentWithoutGitOverrides(),
        ...(validationWorkspaceRoot
          ? { MISSION_CONTROL_WORKSPACE_ROOT: validationWorkspaceRoot }
          : {}),
        ...(validationBase ? { GITHUB_EVENT_BEFORE: validationBase } : {}),
      };
  if (
    nativePrincipalProcess &&
    testOnlyTrustedSshExecutable !== null &&
    testOnlySshFixtureRepositoryDbRoot &&
    isIsolatedLocalMutationTestFixture(testOnlySshFixtureRepositoryDbRoot)
  ) {
    const shellQuote = (value) =>
      `'${toPosixPath(value).replaceAll("'", "'\\''")}'`;
    commandEnvironment.GIT_SSH_COMMAND = `${shellQuote(process.execPath)} ${shellQuote(testOnlyTrustedSshExecutable)}`;
    commandEnvironment.GIT_SSH_VARIANT = "ssh";
  }
  const result = spawnSync(command, args, {
    cwd,
    env: commandEnvironment,
    encoding: binaryStdout ? null : "utf8",
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    input,
    timeout: timeoutMs,
  });
  const stdout = binaryStdout
    ? Buffer.isBuffer(result.stdout)
      ? result.stdout
      : Buffer.alloc(0)
    : (result.stdout ?? "").trim();
  const rawStderr = Buffer.isBuffer(result.stderr)
    ? result.stderr.toString("utf8")
    : result.stderr;
  const stderr = (rawStderr || result.error?.message || "").trim();
  const timedOut = result.error?.code === "ETIMEDOUT";
  if (result.error?.code === "ENOENT") {
    throw new Error(
      command === "git"
        ? "Git is not on PATH; install Git and restart Mission Control"
        : `${command} is unavailable`,
    );
  }
  if (!allowFailure && result.status !== 0) {
    const detail = redactCredentialsInText(stderr || stdout);
    throw new Error(`${command} ${args.join(" ")} failed: ${detail}`.trim());
  }
  return {
    status: result.status,
    stdout,
    stderr,
    timedOut,
  };
}

function git(repositoryDbRoot, args, options = {}) {
  const runOptions = { ...options };
  const testOnlySshFixtureRepositoryDbRoot =
    runOptions.testOnlySshFixtureRepositoryDbRoot ?? repositoryDbRoot;
  delete runOptions.testOnlySshFixtureRepositoryDbRoot;
  const httpsCredentialHelpers = Array.isArray(
    runOptions.httpsCredentialHelpers,
  )
    ? runOptions.httpsCredentialHelpers
    : [];
  delete runOptions.httpsCredentialHelpers;
  const gitInvocation = trustedGitInvocation();
  return run(
    gitInvocation.command,
    [
      ...gitInvocation.argsPrefix,
      "--no-replace-objects",
      ...gitLongPathArguments,
      "-c",
      `core.hooksPath=${gitNullDevice}`,
      "-c",
      "core.fsmonitor=false",
      "-c",
      "commit.gpgSign=false",
      ...(httpsCredentialHelpers.length > 0
        ? [
            "-c",
            "credential.helper=",
            ...httpsCredentialHelpers.flatMap((helper) => [
              "-c",
              `credential.helper=${helper}`,
            ]),
          ]
        : []),
      ...args,
    ],
    {
      cwd: repositoryDbRoot,
      nativePrincipalProcess: true,
      testOnlySshFixtureRepositoryDbRoot,
      ...runOptions,
    },
  );
}

// Jediný Git subprocess boundary sdílený publish a pull cestou. Běžné Git
// chyby vrací jako výsledek; chybějící Git z PATH je instalační chyba a vyhodí
// lidsky čitelnou výjimku. Repository-routing a command-transport environment
// overrides se nikdy nedědí a hooks jsou vždy vypnuté.
export function runMissionControlGitCommand(
  repositoryDbRoot,
  args,
  {
    timeoutMs,
    httpsCredentialHelpers,
    testOnlySshFixtureRepositoryDbRoot,
  } = {},
) {
  const result = git(repositoryDbRoot, args, {
    allowFailure: true,
    timeoutMs,
    httpsCredentialHelpers,
    testOnlySshFixtureRepositoryDbRoot,
  });
  return {
    ...result,
    stdout: redactCredentialsInText(result.stdout),
    stderr: redactCredentialsInText(result.stderr),
  };
}

function runMissionControlGitCommandBytes(
  repositoryDbRoot,
  args,
  { timeoutMs, testOnlySshFixtureRepositoryDbRoot } = {},
) {
  const result = git(repositoryDbRoot, args, {
    allowFailure: true,
    binaryStdout: true,
    timeoutMs,
    testOnlySshFixtureRepositoryDbRoot,
  });
  return {
    ...result,
    stderr: redactCredentialsInText(result.stderr),
  };
}

export function withMissionControlRepositoryWriteLock(repositoryDbRoot, action) {
  const data = loadMissionControlData({ repositoryDbRoot });
  const repositoryRoot = data.repositoryDb.root;
  const activeLocks = repositoryWriteLockStorage.getStore();
  if (activeLocks?.get(repositoryRoot)?.active === true) {
    return action();
  }
  const gitLockPath = git(data.repositoryDb.root, [
    "rev-parse",
    "--git-path",
    "mission-control-write.lock",
  ]).stdout;
  const lockPath = resolve(data.repositoryDb.root, gitLockPath);
  mkdirSync(dirname(lockPath), { recursive: true });
  let descriptor;
  let ownsLock = false;
  try {
    descriptor = openSync(lockPath, "wx");
    ownsLock = true;
    writeFileSync(
      descriptor,
      `${JSON.stringify({
        pid: process.pid,
        created_at: new Date().toISOString(),
        repository_root: data.repositoryDb.root,
      })}\n`,
    );
    closeSync(descriptor);
    descriptor = undefined;
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // The original lock acquisition/write error is more useful.
      }
    }
    if (error?.code === "EEXIST") {
      let owner = "<unreadable>";
      try {
        owner = readFileSync(lockPath, "utf8").trim() || "<empty>";
      } catch {
        // Keep the fail-closed error even when the audit payload is unreadable.
      }
      throw new Error(
        `Another Mission Control repository-db write transaction is active; lock=${lockPath}; owner=${owner}. Retry after it finishes. If the process crashed, verify the recorded PID is no longer running, then inspect the working tree, HEAD versus origin, and pending/published/superseded audit state before removing this stale lock manually.`,
      );
    }
    if (ownsLock) rmSync(lockPath, { force: true });
    throw error;
  }
  const lease = { active: true };
  const releaseLock = () => {
    lease.active = false;
    rmSync(lockPath, { force: true });
  };
  try {
    const nestedLocks = new Map(activeLocks ?? []);
    nestedLocks.set(repositoryRoot, lease);
    const result = repositoryWriteLockStorage.run(nestedLocks, action);
    if (
      result !== null &&
      (typeof result === "object" || typeof result === "function") &&
      typeof result.then === "function"
    ) {
      return Promise.resolve(result).finally(releaseLock);
    }
    releaseLock();
    return result;
  } catch (error) {
    releaseLock();
    throw error;
  }
}

function nowIso(now = new Date()) {
  if (now instanceof Date) return now.toISOString();
  return new Date(now).toISOString();
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function jsonDigest(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function safeIdSuffix(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function isPlaceholder(value) {
  return typeof value === "string" && value.startsWith(PLACEHOLDER_PREFIX);
}

function concreteStringList(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must contain at least one concrete value`);
  }
  const strings = value.filter((entry) => typeof entry === "string" && entry.trim() !== "");
  if (strings.length !== value.length || strings.some((entry) => isPlaceholder(entry))) {
    throw new Error(`${label} must contain concrete non-placeholder strings`);
  }
  return strings;
}

function isSamePathOrInside(parent, target) {
  const normalizedParent = parent.replace(/\/+$/, "");
  return target === normalizedParent || target.startsWith(`${normalizedParent}/`);
}

function isPortableRepoRelativePath(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value ||
    value.startsWith("/") ||
    !PRINTABLE_ASCII_PATH_PATTERN.test(value) ||
    /[<>:"\\|?*\u0000-\u001f\u007f]/.test(value)
  ) {
    return false;
  }
  return value.split("/").every(
    (segment) =>
      segment.length > 0 &&
      segment !== "." &&
      segment !== ".." &&
      segment.normalize("NFC").toLowerCase() !== ".git" &&
      !segment.endsWith(".") &&
      !segment.endsWith(" ") &&
      !WINDOWS_DEVICE_NAME_PATTERN.test(segment),
  );
}

function isGitBehaviorControlPath(path) {
  return (
    typeof path === "string" &&
    path.split("/").some((segment) =>
      GIT_BEHAVIOR_CONTROL_NAMES.has(
        segment.normalize("NFC").toLowerCase(),
      ),
    )
  );
}

function policyPatternBase(value) {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) return null;
  if (value.includes("REPLACE_WITH_")) return null;
  const base = value.endsWith("/**") ? value.slice(0, -3) : value;
  return isPortableRepoRelativePath(base) ? base : null;
}

function isPortableOperationPath(value) {
  return isPortableRepoRelativePath(value);
}

function concreteMissionControlPathPatterns(value, label) {
  const patterns = concreteStringList(value, label);
  for (const pattern of patterns) {
    const base = policyPatternBase(pattern);
    if (!base || (base !== "data/mission-control" && !base.startsWith("data/mission-control/"))) {
      throw new Error(`${label} must contain safe paths or /** patterns inside data/mission-control`);
    }
  }
  return patterns;
}

function pathMatchesAllowlist(pattern, path) {
  if (pattern.endsWith("/**")) return isSamePathOrInside(pattern.slice(0, -3), path);
  return pattern === path;
}

function assertPathsMatchAllowlist(paths, allowlist, label) {
  const patterns = concreteMissionControlPathPatterns(allowlist, label);
  for (const path of paths) {
    if (!patterns.some((pattern) => pathMatchesAllowlist(pattern, path))) {
      throw new Error(`${label} does not allow ${path}`);
    }
  }
  return patterns;
}

function assertChangesetId(id) {
  if (typeof id !== "string" || !/^[a-z0-9][a-z0-9-]{0,127}$/.test(id)) {
    throw new Error("changeset id must use lowercase letters, numbers and hyphens only");
  }
  return id;
}

function newChangesetId({ now = new Date(), summary = "mission-control-change" } = {}) {
  const date = nowIso(now).slice(0, 10);
  const suffix = safeIdSuffix(summary) || "mission-control-change";
  return `${date}-${suffix}-${randomUUID().slice(0, 8)}`;
}

function publishPolicy(config) {
  return config.publish_policy ?? {};
}

function writerMode(config) {
  return publishPolicy(config).writer_mode ?? null;
}

function nativeGitWriterMode(mode) {
  return [
    LOCAL_PRINCIPAL_WRITER_MODE,
    GITHUB_APP_WORKSPACE_WRITER_MODE,
  ].includes(mode);
}

// GitHub remote gate for the local Principal writer: either
// the git@github.com SSH remote authenticated by the Principal's SSH agent,
// or the credential-free https://github.com remote authenticated by the
// Principal's Git credential helper (Git Credential Manager on Windows).
// Localhost is accepted only under the matching test-only fixture.
function localPrincipalGithubRemoteAccepted(remote) {
  if (remoteUsesSsh(remote)) {
    const login = sshRemoteLogin(remote);
    const githubHost =
      login &&
      login.username === "git" &&
      ["github.com", "ssh.github.com"].includes(login.host);
    const trustedTestHost =
      login &&
      testOnlyTrustedSshExecutable !== null &&
      login.host === "localhost";
    return Boolean(githubHost || trustedTestHost);
  }
  const host = httpsRemoteHost(remote);
  if (host === null) return false;
  return (
    host === "github.com" ||
    (testOnlyTrustedCredentialHelperExecutable !== null &&
      host === "localhost")
  );
}

function localPrincipalConfigurationReason(data) {
  const remote = configuredRemote(data);
  if (!localPrincipalGithubRemoteAccepted(remote)) {
    return "github_remote_required";
  }
  const policy = publishPolicy(data.config);
  if (policy.credential_authority !== undefined) {
    return "local_writer_config_invalid";
  }
  return null;
}

function githubAppWorkspaceConfigurationReason(data) {
  const remote = configuredRemote(data);
  const host = httpsRemoteHost(remote);
  if (
    host !== "github.com" &&
    !(
      testOnlyTrustedCredentialHelperExecutable !== null &&
      host === "localhost"
    )
  ) {
    return "github_app_https_remote_required";
  }
  const policy = publishPolicy(data.config);
  if (
    ["credential_authority", "approval_roles", "local_principal"].some(
      (key) => Object.hasOwn(policy, key),
    )
  ) {
    return "github_app_writer_config_invalid";
  }
  return null;
}

function nativeGitWriterConfigurationReason(data) {
  const mode = writerMode(data.config);
  if (mode === LOCAL_PRINCIPAL_WRITER_MODE) {
    return localPrincipalConfigurationReason(data);
  }
  if (mode === GITHUB_APP_WORKSPACE_WRITER_MODE) {
    return githubAppWorkspaceConfigurationReason(data);
  }
  return "writer_mode_unsupported";
}

function assertNativeGitWriterConfigured(data) {
  const reason = nativeGitWriterConfigurationReason(data);
  if (reason !== null) {
    const messages = {
      github_remote_required:
        "Local Principal writer requires the reviewed github.com data remote: either the SSH remote authenticated by the Principal's SSH agent, or the credential-free HTTPS remote authenticated by the Principal's Git credential helper (Git Credential Manager)",
      local_writer_config_invalid:
        "Local Principal writer must not configure a parallel credential_authority; GitHub repository grants are the only access authority",
      github_app_https_remote_required:
        "GitHub App Workspace writer requires a credential-free https://github.com data remote authenticated by the configured external Git credential helper",
      github_app_writer_config_invalid:
        "GitHub App Workspace writer must not configure credential_authority, approval_roles or local_principal; the external repo-scoped GitHub App helper and live GitHub grants are the only access authority",
      writer_mode_unsupported:
        "Mission Control requires a supported native Git writer_mode; no fallback writer exists",
    };
    const error = new Error(messages[reason]);
    error.code = reason;
    throw error;
  }
}

function resolvedCommitIdentity(repositoryDbRoot) {
  const result = git(
    repositoryDbRoot,
    ["-c", "user.useConfigOnly=true", "var", "GIT_AUTHOR_IDENT"],
    { allowFailure: true },
  );
  const match = result.stdout.match(/^(.+) <([^<>\r\n\u0000]+)> \d+ [+-]\d{4}$/);
  if (
    result.status !== 0 ||
    !match ||
    isPlaceholder(match[1]) ||
    isPlaceholder(match[2])
  ) {
    return null;
  }
  return `${match[1]} <${match[2]}>`;
}

function nativeCommitIdentity(repositoryDbRoot) {
  const identity = resolvedCommitIdentity(repositoryDbRoot);
  if (!identity) {
    throw new Error(
      "Native Mission Control publish requires a Git commit identity; configure user.name and user.email in normal Git config",
    );
  }
  return identity;
}

function sshRemoteLogin(remote) {
  if (typeof remote !== "string") return null;
  if (remote.startsWith("ssh://")) {
    try {
      const parsed = new URL(remote);
      if (
        parsed.protocol !== "ssh:" ||
        !parsed.username ||
        !parsed.hostname
      ) {
        return null;
      }
      return {
        target: `${decodeURIComponent(parsed.username)}@${parsed.hostname}`,
        username: decodeURIComponent(parsed.username),
        host: parsed.hostname.toLowerCase(),
        port: parsed.port || null,
      };
    } catch {
      return null;
    }
  }
  const scpLike = remote.match(
    /^([A-Za-z0-9._-]+)@([A-Za-z0-9.-]+):/,
  );
  return scpLike
    ? {
        target: `${scpLike[1]}@${scpLike[2]}`,
        username: scpLike[1],
        host: scpLike[2].toLowerCase(),
        port: null,
      }
    : null;
}

// Production lets Git resolve the Principal's ordinary local/global/system
// credential helpers. Tests may inject one exact helper without consulting
// the developer machine's real credential store.
function principalCredentialHelperOverrides() {
  if (testOnlyTrustedCredentialHelperExecutable !== null) {
    if (
      !executableIsTrusted(testOnlyTrustedCredentialHelperExecutable, {
        testFixtureName: "credential-helper",
      })
    ) {
      return [];
    }
    if (process.platform === "win32") {
      const node = process.execPath.replaceAll("\\", "/").replaceAll('"', '\\"');
      const helper = testOnlyTrustedCredentialHelperExecutable
        .replaceAll("\\", "/")
        .replaceAll('"', '\\"');
      return [`!"${node}" "${helper}"`];
    }
    return [testOnlyTrustedCredentialHelperExecutable];
  }
  return [];
}

function localDraftDirectory(repositoryDbRoot) {
  const gitPath = git(repositoryDbRoot, [
    "rev-parse",
    "--git-path",
    "mission-control-drafts",
  ]).stdout;
  return isAbsolute(gitPath)
    ? resolve(gitPath)
    : resolve(repositoryDbRoot, gitPath);
}

function localDraftPath(repositoryDbRoot, id) {
  return resolve(
    localDraftDirectory(repositoryDbRoot),
    `${assertChangesetId(id)}.json`,
  );
}

function localDraftRevision(draft) {
  return jsonDigest({
    schema_version: LOCAL_DRAFT_SCHEMA,
    id: draft.id,
    base_commit: draft.base_commit,
    summary: draft.summary,
    operations: draft.operations,
  });
}

function normalizeLocalDraft(data, draft) {
  if (
    !draft ||
    draft.schema_version !== LOCAL_DRAFT_SCHEMA ||
    typeof draft.id !== "string" ||
    typeof draft.base_commit !== "string" ||
    !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(draft.base_commit) ||
    typeof draft.summary !== "string" ||
    draft.summary.trim() === ""
  ) {
    throw new Error("Local Mission Control draft is malformed");
  }
  const operations = normalizeProtectedOperations(data, draft.operations);
  const normalized = {
    schema_version: LOCAL_DRAFT_SCHEMA,
    id: assertChangesetId(draft.id),
    created_at: nowIso(draft.created_at),
    base_commit: draft.base_commit,
    summary: draft.summary.trim(),
    operations: operations.map(({ absolutePath, ...operation }) => operation),
  };
  const revision = localDraftRevision(normalized);
  if (draft.draft_revision !== revision) {
    const error = new Error(
      `Local Mission Control draft ${draft.id} changed after its revision was created`,
    );
    error.code = "draft_changed";
    throw error;
  }
  return { ...normalized, draft_revision: revision };
}

function readLocalDraft(data, id) {
  const path = localDraftPath(data.repositoryDb.root, id);
  if (!existsSync(path)) {
    const error = new Error(`Local Mission Control draft missing: ${id}`);
    error.code = "draft_missing";
    throw error;
  }
  return { path, draft: normalizeLocalDraft(data, readJsonFile(path)) };
}

export function getMissionControlWriterStatus({
  repositoryDbRoot,
} = {}) {
  const data = loadMissionControlData({ repositoryDbRoot });
  const mode = writerMode(data.config);
  const configurationReason = nativeGitWriterConfigurationReason(data);
  let commitIdentityConfigured = true;
  try {
    nativeCommitIdentity(data.repositoryDb.root);
  } catch {
    // Repository status remains readable; publish stays fail-closed.
    commitIdentityConfigured = false;
  }
  const writerReady =
    nativeGitWriterMode(mode) &&
    configurationReason === null &&
    commitIdentityConfigured;
  return {
    mode,
    writer_ready: writerReady,
    local_principal_ready:
      mode === LOCAL_PRINCIPAL_WRITER_MODE && writerReady,
    reason:
      configurationReason !== null
        ? configurationReason
        : !commitIdentityConfigured
          ? "commit_identity_required"
          : writerReady
            ? null
            : "writer_mode_unsupported",
  };
}

export function listMissionControlLocalDrafts({
  repositoryDbRoot,
} = {}) {
  const data = loadMissionControlData({ repositoryDbRoot });
  if (!nativeGitWriterMode(writerMode(data.config))) return [];
  const directory = localDraftDirectory(data.repositoryDb.root);
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => {
      const id = entry.name.replace(/\.json$/, "");
      try {
        return readLocalDraft(data, id).draft;
      } catch (error) {
        return {
          schema_version: LOCAL_DRAFT_SCHEMA,
          id,
          created_at: "",
          base_commit: "",
          summary: "Nečitelný lokální draft",
          operations: [],
          draft_revision: "",
          invalid: true,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    })
    .sort((left, right) =>
      `${left.created_at}:${left.id}`.localeCompare(
        `${right.created_at}:${right.id}`,
      ),
    );
}

export function createMissionControlLocalDraft({
  repositoryDbRoot,
  draft = {},
  now = new Date(),
} = {}) {
  return withMissionControlRepositoryWriteLock(repositoryDbRoot, () => {
    const data = loadMissionControlData({ repositoryDbRoot });
    assertNativeGitWriterConfigured(data);
    assertRepositoryReadyForLocalMutation({ repositoryDbRoot });
    const operations = normalizeProtectedOperations(data, draft.operations);
    assertLocalOperationPathsSafe(data, operations);
    assertOperationsChangeCanonicalData(operations);
    const id =
      draft.id ??
      newChangesetId({ now, summary: draft.summary });
    const safeId = assertChangesetId(id);
    for (const state of ["pending", "published", "superseded"]) {
      if (existsSync(changesetPath(data, safeId, state))) {
        throw new Error(`Changeset already exists: ${safeId}`);
      }
    }
    const document = {
      schema_version: LOCAL_DRAFT_SCHEMA,
      id: safeId,
      created_at: nowIso(now),
      base_commit: currentHead(data.repositoryDb.root),
      summary:
        typeof draft.summary === "string" && draft.summary.trim()
          ? draft.summary.trim()
          : "Mission Control data change",
      operations: operations.map(({ absolutePath, ...operation }) => operation),
    };
    document.draft_revision = localDraftRevision(document);
    const path = localDraftPath(data.repositoryDb.root, safeId);
    try {
      writeJsonFileExclusive(path, document);
    } catch (error) {
      if (error?.code === "EEXIST") {
        throw new Error(`Local Mission Control draft already exists: ${safeId}`);
      }
      rmSync(path, { force: true });
      throw error;
    }
    return { id: safeId, path, draft: document };
  });
}

export function discardMissionControlLocalDraft({
  repositoryDbRoot,
  draftId,
} = {}) {
  return withMissionControlRepositoryWriteLock(repositoryDbRoot, () => {
    const data = loadMissionControlData({ repositoryDbRoot });
    assertNativeGitWriterConfigured(data);
    const id = assertChangesetId(draftId);
    const path = localDraftPath(data.repositoryDb.root, id);
    if (!existsSync(path)) {
      const error = new Error(`Local Mission Control draft missing: ${id}`);
      error.code = "draft_missing";
      throw error;
    }
    rmSync(path);
    return { id, discarded: true };
  });
}

function assertProtectedPathsConfigured(config) {
  return concreteMissionControlPathPatterns(
    publishPolicy(config).protected_paths,
    "publish_policy.protected_paths",
  );
}

function pendingChangesetsDir(config) {
  return publishPolicy(config).pending_changesets_dir ?? DEFAULT_PENDING_DIR;
}

function publishedChangesetsDir(config) {
  return publishPolicy(config).published_changesets_dir ?? DEFAULT_PUBLISHED_DIR;
}

function supersededChangesetsDir(config) {
  return publishPolicy(config).superseded_changesets_dir ?? DEFAULT_SUPERSEDED_DIR;
}

function changesetPath(data, id, state = "pending", { readOnly = false } = {}) {
  const safeId = assertChangesetId(id);
  const dir =
    state === "published"
      ? publishedChangesetsDir(data.config)
      : state === "superseded"
        ? supersededChangesetsDir(data.config)
        : pendingChangesetsDir(data.config);
  const target = resolve(data.repositoryDb.root, dir, `${safeId}.json`);
  if (readOnly) assertConfiguredWriteTarget(data, target);
  else assertChangesetWriteTarget(data, target);
  return target;
}

function writeJsonFileExclusive(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
}

function readJsonFile(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function assertConfiguredWriteTarget(data, targetPath) {
  return assertMissionControlWriteTarget({
    config: data.config,
    repositoryDbRoot: data.repositoryDb.root,
    targetPath,
  });
}

function assertChangesetWriteTarget(data, targetPath) {
  const result = assertConfiguredWriteTarget(data, targetPath);
  if (result.mode !== "repository-db") throw new Error("Changeset writes must stay inside repository-db data checkout");
  assertPathsMatchAllowlist(
    [repoRelativePath(data.repositoryDb.root, targetPath)],
    assertProtectedPathsConfigured(data.config),
    "publish_policy.protected_paths",
  );
  return result;
}

function assertNotChangesetAuditTarget(data, absolutePath) {
  const relativePath = repoRelativePath(data.repositoryDb.root, absolutePath);
  for (const dir of [
    pendingChangesetsDir(data.config),
    publishedChangesetsDir(data.config),
    supersededChangesetsDir(data.config),
  ]) {
    const normalizedDir = toPosixPath(dir).replace(/\/+$/, "");
    if (isSamePathOrInside(normalizedDir, relativePath)) {
      throw new Error(`write_file operations cannot target changeset audit directories: ${relativePath}`);
    }
  }
}

function assertWriteOperation(data, operation) {
  if (!operation || typeof operation !== "object" || Array.isArray(operation)) {
    throw new Error("Changeset operation must be an object");
  }
  if (operation.action !== "write_file") {
    throw new Error(`Unsupported changeset operation action: ${operation.action}`);
  }
  if (!isPortableOperationPath(operation.path)) {
    throw new Error("write_file operation requires a portable repo-relative path");
  }
  if (typeof operation.content !== "string") {
    throw new Error("write_file operation requires string content");
  }
  if (/^(?:.*\/)?ISSUES\.(?:open|resolved)\.json$/i.test(operation.path)) {
    throw new Error("Legacy issue ledgers are read-only; use GitHub Issues in the owning repository");
  }
  const absolutePath = resolve(data.repositoryDb.root, operation.path);
  const result = assertConfiguredWriteTarget(data, absolutePath);
  if (result.mode !== "repository-db") throw new Error("write_file operation must target repository-db data");
  assertNotChangesetAuditTarget(data, absolutePath);
  return { ...operation, absolutePath, relativePath: repoRelativePath(data.repositoryDb.root, absolutePath) };
}

function normalizeOperations(data, operations) {
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new Error("Changeset requires at least one operation");
  }
  const normalized = operations.map((operation) =>
    assertWriteOperation(data, operation),
  );
  const paths = normalized.map((operation) => operation.relativePath);
  if (new Set(paths).size !== paths.length) {
    throw new Error("Changeset operations must target unique paths");
  }
  return normalized;
}

function normalizeProtectedOperations(data, operations) {
  const protectedPaths = assertProtectedPathsConfigured(data.config);
  const normalized = normalizeOperations(data, operations);
  assertPathsMatchAllowlist(
    normalized.map((operation) => operation.relativePath),
    protectedPaths,
    "publish_policy.protected_paths",
  );
  return normalized;
}

function assertOperationsChangeCanonicalData(operations) {
  const noOpPaths = operations
    .filter(
      (operation) =>
        existsSync(operation.absolutePath) &&
        lstatSync(operation.absolutePath).isFile() &&
        readFileSync(operation.absolutePath).equals(
          Buffer.from(operation.content, "utf8"),
        ),
    )
    .map((operation) => operation.relativePath);
  if (noOpPaths.length > 0) {
    throw new Error(
      `Changeset operations must change canonical data; no-op paths: ${noOpPaths.join(", ")}`,
    );
  }
}

function runPinnedDataValidation(
  repositoryDbRoot,
  { timeoutMs, allowUnauthenticatedLocalTest = false, validationBase } = {},
) {
  const validatorPath =
    testOnlyPinnedDataValidatorPath &&
    executableIsTrusted(testOnlyPinnedDataValidatorPath, {
      testFixtureName: "validator.mjs",
    })
      ? testOnlyPinnedDataValidatorPath
      : PINNED_DATA_VALIDATOR_PATH;
  // Launchpad can start app/v3 directly, without the root run-v3 wrapper.
  // Derive the same workspace context from app-owned instance metadata, never
  // from the temporary validation checkout or incoming repository config.
  const mode = readJsonFile(join(APP_CODE_ROOT, "package.json"))
    .companyascode?.mission_control?.mode;
  const validationWorkspaceRoot = process.env.MISSION_CONTROL_WORKSPACE_ROOT ||
    (mode === "organization" ? dirname(APP_CODE_ROOT) : APP_CODE_ROOT);
  const args = [validatorPath, "--pinned-app-code"];
  if (allowUnauthenticatedLocalTest) {
    args.push("--allow-unauthenticated-local-test");
  }
  return run(
    process.execPath,
    args,
    {
      cwd: repositoryDbRoot,
      allowFailure: true,
      validationWorkspaceRoot,
      validationBase,
      timeoutMs,
    },
  );
}

function runValidation(
  data,
  { allowUnauthenticatedLocalTest = false } = {},
) {
  const result = runPinnedDataValidation(data.repositoryDb.root, {
    allowUnauthenticatedLocalTest,
  });
  if (result.status !== 0) {
    throw new Error(
      `Mission Control data validation failed (pinned app-code validator): ${result.stderr || result.stdout}`.trim(),
    );
  }
}

function currentHead(repositoryDbRoot) {
  return git(repositoryDbRoot, ["rev-parse", "HEAD"]).stdout;
}

function nullSeparatedGitPaths(value, label) {
  const paths = [];
  let offset = 0;
  while (offset < value.length) {
    const separator = value.indexOf(0, offset);
    const end = separator < 0 ? value.length : separator;
    const bytes = value.subarray(offset, end);
    if (bytes.length > 0) {
      try {
        paths.push(FATAL_UTF8_DECODER.decode(bytes));
      } catch {
        throw new Error(`${label} contains an invalid UTF-8 path`);
      }
    }
    if (separator < 0) break;
    offset = separator + 1;
  }
  return paths;
}

function configuredBranch(data) {
  return data.repositoryDb.config?.data_repo?.branch ?? "v3";
}

function configuredRemote(data) {
  return data.repositoryDb.config?.data_repo?.remote ?? null;
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
    segments.every(
      (segment) =>
        segment.length > 0 && segment !== "." && segment !== "..",
    ) &&
    segments.at(-1) === "mission-control-data.git"
  );
}

// Keep this predicate aligned with both repository-db validators. Runtime
// freshness runs before the external validation command, so the transport
// boundary must enforce the same credential-free HTTPS/SSH contract itself.
function isSafeMissionControlGitRemote(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value ||
    value.startsWith("-") ||
    /[\s\u0000-\u001f\u007f]/.test(value) ||
    value.includes(PLACEHOLDER_PREFIX)
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

  const scpLike = /^([A-Za-z0-9._-]+)@([A-Za-z0-9.-]+):(.+)$/.exec(
    value,
  );
  return Boolean(
    scpLike &&
      scpLike[2] &&
      !scpLike[2].startsWith(".") &&
      !scpLike[2].endsWith(".") &&
      isSafeMissionControlRepositoryPath(scpLike[3]),
  );
}

function remoteUsesSsh(value) {
  return (
    typeof value === "string" &&
    (value.startsWith("ssh://") ||
      /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:/.test(value))
  );
}

function remoteUsesHttps(value) {
  return typeof value === "string" && value.startsWith("https://");
}

// Host of a credential-free HTTPS remote. A URL carrying username/password is
// rejected: the provider identity must come from the OS credential helper of
// the signed-in Principal, never from the remote URL itself.
function httpsRemoteHost(value) {
  if (!remoteUsesHttps(value)) return null;
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password
    ) {
      return null;
    }
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function quoteGitConfigValue(value) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function redactRemoteUrl(value) {
  if (typeof value !== "string" || !/^https?:\/\//i.test(value)) return value;
  try {
    const parsed = new URL(value);
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    return value.replace(/^(https?:\/\/)[^/\s@]+@/i, "$1");
  }
}

function redactCredentialsInText(value) {
  return String(value ?? "").replace(
    /\b(https?:\/\/)[^/\s@]+@/gi,
    "$1",
  );
}

function getRemoteUrls(repositoryDbRoot, { push = false } = {}) {
  const args = ["remote", "get-url"];
  if (push) args.push("--push");
  args.push("--all", "origin");
  const result = git(repositoryDbRoot, args, { allowFailure: true });
  if (result.status !== 0) return [];
  return result.stdout.split("\n").filter(Boolean);
}

function hasConcreteLocalCommitIdentity(repositoryDbRoot) {
  return resolvedCommitIdentity(repositoryDbRoot) !== null;
}

function getLocalGitRoutingOverrides(repositoryDbRoot) {
  const result = git(
    repositoryDbRoot,
    ["config", "--local", "--includes", "--name-only", "--list"],
    { allowFailure: true },
  );
  if (result.status !== 0) return [];
  return result.stdout
    .split("\n")
    .map((key) => key.trim().toLowerCase())
    .filter(
      (key) =>
        key === "core.askpass" ||
        key === "core.fsmonitor" ||
        key === "core.gitproxy" ||
        key === "core.hookspath" ||
        key === "core.sshcommand" ||
        key === "core.worktree" ||
        key === "credential.helper" ||
        (key.startsWith("credential.") && key.endsWith(".helper")) ||
        key === "extensions.worktreeconfig" ||
        key === "gpg.program" ||
        key === "gpg.ssh.program" ||
        key === "include.path" ||
        (key.startsWith("includeif.") && key.endsWith(".path")) ||
        key === "remote.origin.pushurl" ||
        /^remote\..+\.(proxy|receivepack|uploadpack)$/.test(key) ||
        /^filter\..+\.(clean|process|smudge)$/.test(key) ||
        /^url\..+\.(insteadof|pushinsteadof)$/.test(key),
    )
    .map(redactCredentialsInText);
}

function getLocalGitFetchRoutingOverrides(localGitRoutingOverrides) {
  return localGitRoutingOverrides.filter(
    (key) => key !== "remote.origin.pushurl",
  );
}

function isSafeGitBranch(value) {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length === 0 ||
    value === "HEAD" ||
    value.startsWith("-") ||
    value.includes("@{") ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return false;
  }
  const checked = runMissionControlGitCommand(tmpdir(), [
    "check-ref-format",
    "--branch",
    value,
  ]);
  return checked.status === 0 && checked.stdout === value;
}

function findUnsafeInboundCasePaths(paths) {
  const byCaseKey = new Map();
  const unsafe = new Set();
  for (const path of paths) {
    let prefix = "";
    for (const segment of path.split("/")) {
      prefix = prefix ? `${prefix}/${segment}` : segment;
      const caseKey = prefix.normalize("NFC").toLowerCase();
      const previous = byCaseKey.get(caseKey);
      if (previous && previous.prefix !== prefix) {
        unsafe.add(previous.path);
        unsafe.add(path);
      } else if (!previous) {
        byCaseKey.set(caseKey, { prefix, path });
      }
    }
    const caseKey = path.normalize("NFC").toLowerCase();
    if (
      REPOSITORY_DB_CONTROL_PLANE_CASE_KEYS.has(caseKey) &&
      !REPOSITORY_DB_CONTROL_PLANE_PATHS.has(path)
    ) {
      unsafe.add(path);
    }
  }
  return [...unsafe].sort();
}

function isOrdinaryMissionControlDataPath(path) {
  if (!isPortableRepoRelativePath(path)) return false;
  const caseKey = path.normalize("NFC").toLowerCase();
  return (
    path.startsWith("data/mission-control/") &&
    !isGitBehaviorControlPath(path) &&
    !REPOSITORY_DB_CONTROL_PLANE_CASE_KEYS.has(caseKey)
  );
}

const FATAL_UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

function parseInboundTreeEntries(output) {
  const entries = [];
  const malformed = [];
  let recordStart = 0;
  while (recordStart < output.length) {
    const recordEnd = output.indexOf(0x00, recordStart);
    if (recordEnd < 0) {
      malformed.push("unterminated ls-tree record");
      break;
    }
    const record = output.subarray(recordStart, recordEnd);
    recordStart = recordEnd + 1;
    if (record.length === 0) continue;
    const separator = record.indexOf(0x09);
    const metadata =
      separator >= 0
        ? record.subarray(0, separator).toString("ascii")
        : "";
    const rawPath =
      separator >= 0
        ? record.subarray(separator + 1)
        : Buffer.alloc(0);
    let path = "";
    try {
      path = FATAL_UTF8_DECODER.decode(rawPath);
    } catch {
      malformed.push(
        `invalid UTF-8 path bytes ${rawPath.toString("hex").slice(0, 128)}`,
      );
      continue;
    }
    const [mode, type, object] = metadata.split(/\s+/);
    if (
      !/^[0-9]{6}$/.test(mode ?? "") ||
      !type ||
      !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(object ?? "") ||
      !path
    ) {
      malformed.push(
        `malformed ls-tree record metadata=${JSON.stringify(metadata)} path=${JSON.stringify(path)}`,
      );
      continue;
    }
    entries.push({ mode, type, object, path });
  }
  return { entries, malformed };
}

function readGitBlobBytes(root, objectId) {
  const result = git(root, ["cat-file", "blob", objectId], {
    allowFailure: true,
    binaryStdout: true,
  });
  return {
    status: result.status,
    stdout: Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.alloc(0),
  };
}

function normalizeCrlfBytes(value) {
  let hasCrlf = false;
  for (let index = 0; index + 1 < value.length; index += 1) {
    if (value[index] === 0x0d && value[index + 1] === 0x0a) {
      hasCrlf = true;
      break;
    }
  }
  if (!hasCrlf) return value;
  const normalized = Buffer.allocUnsafe(value.length);
  let writeIndex = 0;
  for (let readIndex = 0; readIndex < value.length; readIndex += 1) {
    if (
      value[readIndex] === 0x0d &&
      value[readIndex + 1] === 0x0a
    ) {
      continue;
    }
    normalized[writeIndex] = value[readIndex];
    writeIndex += 1;
  }
  return normalized.subarray(0, writeIndex);
}

function repositoryControlPlaneModes(root, path) {
  const headEntry = git(root, ["ls-tree", "HEAD", "--", path], {
    allowFailure: true,
  });
  const indexEntry = git(root, ["ls-files", "--stage", "--", path], {
    allowFailure: true,
  });
  const headMatch =
    headEntry.status === 0
      ? /^([0-9]{6})\s+blob\s+[0-9a-f]{40}(?:[0-9a-f]{24})?\t/.exec(
          headEntry.stdout,
        )
      : null;
  const indexMatch =
    indexEntry.status === 0
      ? /^([0-9]{6})\s+[0-9a-f]{40}(?:[0-9a-f]{24})?\s+0\t/.exec(
          indexEntry.stdout,
        )
      : null;
  return {
    head: headMatch?.[1] ?? null,
    index: indexMatch?.[1] ?? null,
  };
}

function repositoryControlPlaneDriftPaths(root) {
  const drift = [];
  for (const path of REPOSITORY_DB_CONTROL_PLANE_PATHS) {
    const absolutePath = join(root, path);
    if (!existsSync(absolutePath) || !lstatSync(absolutePath).isFile()) {
      drift.push(path);
      continue;
    }
    const head = git(root, ["rev-parse", "--verify", `HEAD:${path}`], {
      allowFailure: true,
    });
    const index = git(root, ["rev-parse", "--verify", `:${path}`], {
      allowFailure: true,
    });
    const modes = repositoryControlPlaneModes(root, path);
    const headBlob =
      head.status === 0 && head.stdout
        ? readGitBlobBytes(root, head.stdout)
        : { status: null, stdout: Buffer.alloc(0) };
    let working = Buffer.alloc(0);
    let workingRead = true;
    try {
      working = readFileSync(absolutePath);
    } catch {
      workingRead = false;
    }
    if (
      head.status !== 0 ||
      index.status !== 0 ||
      headBlob.status !== 0 ||
      !workingRead ||
      !head.stdout ||
      head.stdout !== index.stdout ||
      modes.head !== "100644" ||
      modes.index !== modes.head ||
      !normalizeCrlfBytes(headBlob.stdout).equals(
        normalizeCrlfBytes(working),
      )
    ) {
      drift.push(path);
    }
  }
  return drift.sort();
}

function trustedRepositoryDbConfig(root) {
  const result = git(root, ["show", "HEAD:repository-db.yaml"], {
    allowFailure: true,
  });
  if (result.status !== 0 || !result.stdout) return null;
  try {
    const value = parseYaml(result.stdout);
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : null;
  } catch {
    return null;
  }
}

// Read-only preflight: only config/ref plumbing is allowed here. In
// particular, do not run `git status` before this result is evaluated because
// status can invoke checkout-local clean/process filters from .git/config.
export function getMissionControlRepositoryFetchBoundaryStatus({
  repositoryDbRoot,
} = {}) {
  if (!repositoryDbRoot) throw new Error("repositoryDbRoot is required");
  const root = resolve(repositoryDbRoot);
  const trustedConfig = trustedRepositoryDbConfig(root);
  const controlPlaneDriftPaths = repositoryControlPlaneDriftPaths(root);
  const controlPlaneTrusted =
    trustedConfig !== null && controlPlaneDriftPaths.length === 0;
  const expectedBranch =
    typeof trustedConfig?.data_repo?.branch === "string"
      ? trustedConfig.data_repo.branch
      : "";
  const rawExpectedRemoteUrl = trustedConfig?.data_repo?.remote ?? null;
  const rawRemoteUrls = getRemoteUrls(root);
  const localGitRoutingOverrides = getLocalGitRoutingOverrides(root);
  const localGitFetchRoutingOverrides =
    getLocalGitFetchRoutingOverrides(localGitRoutingOverrides);
  const rawRemoteUrl = rawRemoteUrls[0] ?? null;
  const branchConfigured = isSafeGitBranch(expectedBranch);
  const remoteConfigured = isSafeMissionControlGitRemote(
    rawExpectedRemoteUrl,
  );
  const fetchRemoteMatches =
    controlPlaneTrusted &&
    branchConfigured &&
    remoteConfigured &&
    rawRemoteUrls.length === 1 &&
    rawRemoteUrl === rawExpectedRemoteUrl &&
    localGitFetchRoutingOverrides.length === 0;
  return {
    repositoryDbRoot: root,
    expectedBranch,
    branchConfigured,
    controlPlaneTrusted,
    controlPlaneDriftPaths,
    expectedRemoteUrl: redactRemoteUrl(rawExpectedRemoteUrl),
    remoteUrl: redactRemoteUrl(rawRemoteUrl),
    remoteUrls: rawRemoteUrls.map(redactRemoteUrl),
    localGitRoutingOverrides,
    localGitFetchRoutingOverrides,
    remoteConfigured,
    fetchRemoteMatches,
    validatedFetchUrl: fetchRemoteMatches ? rawExpectedRemoteUrl : null,
  };
}

// Network fetch runs in a fresh bare repository with the validated URL held as
// a literal value. The target checkout's mutable .git/config is therefore not
// consulted by the transport. A bundle imports the verified object graph and
// update-ref atomically advances origin/<branch> without checkout filters or
// hooks.
export function fetchMissionControlRepositoryRemote({
  repositoryDbRoot,
  timeoutMs = DEFAULT_GIT_TIMEOUT_MS,
} = {}) {
  const boundary = getMissionControlRepositoryFetchBoundaryStatus({
    repositoryDbRoot,
  });
  if (!boundary.controlPlaneTrusted) {
    return {
      status: null,
      stdout: "",
      stderr:
        "repository-db fetch control-plane must match trusted HEAD and index before network access: " +
        (boundary.controlPlaneDriftPaths.join(", ") ||
          "HEAD repository-db.yaml is missing or invalid"),
      timedOut: false,
      reason: "fetch_control_plane_untrusted",
      branch: boundary.expectedBranch,
      boundary,
    };
  }
  if (!boundary.branchConfigured) {
    return {
      status: null,
      stdout: "",
      stderr: `repository-db.yaml data_repo.branch is not a safe Git branch: ${boundary.expectedBranch}`,
      timedOut: false,
      reason: "branch_invalid",
      branch: boundary.expectedBranch,
      boundary,
    };
  }
  if (!boundary.remoteConfigured) {
    return {
      status: null,
      stdout: "",
      stderr:
        "repository-db.yaml data_repo.remote must be a concrete credential-free Organization-owned HTTPS or SSH mission-control-data Git remote before fetch",
      timedOut: false,
      reason: "remote_not_configured",
      branch: boundary.expectedBranch,
      boundary,
    };
  }
  if (!boundary.fetchRemoteMatches || !boundary.validatedFetchUrl) {
    return {
      status: null,
      stdout: "",
      stderr:
        `Data repo origin fetch remote must match repository-db.yaml without local routing overrides: ` +
        `expected ${boundary.expectedRemoteUrl}, fetch=${boundary.remoteUrls.join(",") || "<missing>"}, ` +
        `overrides=${boundary.localGitFetchRoutingOverrides.join(",") || "<none>"}`,
      timedOut: false,
      reason: "fetch_remote_mismatch",
      branch: boundary.expectedBranch,
      boundary,
    };
  }

  const root = boundary.repositoryDbRoot;
  const branch = boundary.expectedBranch;
  const remoteRef = `refs/remotes/origin/${branch}`;
  const oldRemoteRef = git(root, ["rev-parse", "--verify", remoteRef], {
    allowFailure: true,
  });
  const localHead = git(root, ["rev-parse", "--verify", "HEAD"], {
    allowFailure: true,
  });
  const objectFormat = git(root, ["rev-parse", "--show-object-format"], {
    allowFailure: true,
  }).stdout;
  const isolatedRoot = mkdtempSync(
    join(tmpdir(), "mission-control-fetch-"),
  );
  const fetchedRef = `refs/heads/${branch}`;
  const localBundlePath = join(isolatedRoot, "trusted-local.bundle");
  const bundlePath = join(isolatedRoot, "remote.bundle");
  const deadline = Date.now() + timeoutMs;
  const httpsCredentialHelpers =
    remoteUsesHttps(boundary.validatedFetchUrl)
      ? principalCredentialHelperOverrides()
      : [];
  // The isolated fetch repository has no application data of its own. Keep
  // the test-only transport bound to the original repository-db whose
  // reviewed config supplied the already validated fixture remote.
  const testOnlySshFixtureRepositoryDbRoot = root;
  const runBeforeDeadline = (cwd, args, options = {}) => {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      return {
        status: null,
        stdout: "",
        stderr: `Git fetch operation timed out after ${timeoutMs}ms`,
        timedOut: true,
      };
    }
    return runMissionControlGitCommand(cwd, args, {
      timeoutMs: remainingMs,
      testOnlySshFixtureRepositoryDbRoot,
      ...options,
    });
  };
  const runBytesBeforeDeadline = (cwd, args) => {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      return {
        status: null,
        stdout: Buffer.alloc(0),
        stderr: `Git fetch operation timed out after ${timeoutMs}ms`,
        timedOut: true,
      };
    }
    return runMissionControlGitCommandBytes(cwd, args, {
      timeoutMs: remainingMs,
      testOnlySshFixtureRepositoryDbRoot,
    });
  };

  try {
    const initArgs = ["init", "--bare"];
    if (objectFormat) initArgs.push(`--object-format=${objectFormat}`);
    initArgs.push(".");
    const initialized = runBeforeDeadline(isolatedRoot, initArgs);
    if (initialized.status !== 0) {
      return {
        ...initialized,
        reason: "fetch_isolation_failed",
        branch,
        boundary,
      };
    }

    if (localHead.status !== 0 || !localHead.stdout) {
      return {
        ...localHead,
        stderr: "Local HEAD is missing and cannot anchor inbound validation",
        reason: "fetch_inbound_history_untrusted",
        branch,
        boundary,
      };
    }
    const localBundled = runBeforeDeadline(root, [
      "bundle",
      "create",
      localBundlePath,
      "HEAD",
    ]);
    if (localBundled.status !== 0) {
      return {
        ...localBundled,
        reason: "fetch_local_anchor_failed",
        branch,
        boundary,
      };
    }
    const localImported = runBeforeDeadline(isolatedRoot, [
      "bundle",
      "unbundle",
      localBundlePath,
    ]);
    if (localImported.status !== 0) {
      return {
        ...localImported,
        reason: "fetch_local_anchor_failed",
        branch,
        boundary,
      };
    }
    const localAnchor = runBeforeDeadline(isolatedRoot, [
      "cat-file",
      "-e",
      `${localHead.stdout}^{commit}`,
    ]);
    if (localAnchor.status !== 0) {
      return {
        ...localAnchor,
        stderr:
          "Local HEAD changed while the isolated inbound trust anchor was created",
        reason: "fetch_local_anchor_race",
        branch,
        boundary,
      };
    }

    const isolatedConfigPath = join(isolatedRoot, "config");
    writeFileSync(
      isolatedConfigPath,
      `\n[remote "validated-origin"]\n\turl = ${quoteGitConfigValue(boundary.validatedFetchUrl)}\n`,
      { flag: "a" },
    );
    chmodSync(isolatedConfigPath, 0o600);

    const fetched = runBeforeDeadline(
      isolatedRoot,
      [
        "-c", "fetch.fsckObjects=true",
        "fetch",
        "--no-tags",
        "--no-write-fetch-head",
        "--",
        "validated-origin",
        `+refs/heads/${branch}:${fetchedRef}`,
      ],
      { httpsCredentialHelpers },
    );
    if (fetched.status !== 0) {
      return {
        ...fetched,
        reason: "fetch_failed",
        branch,
        boundary,
      };
    }

    const fetchedHead = runBeforeDeadline(isolatedRoot, [
      "rev-parse",
      "--verify",
      fetchedRef,
    ]);
    if (fetchedHead.status !== 0 || !fetchedHead.stdout) {
      return {
        ...fetchedHead,
        reason: "fetch_ref_missing",
        branch,
        boundary,
      };
    }
    // The merge-base with checked-out local HEAD is the only durable inbound
    // diff anchor available without separate attestation metadata. A mutable
    // remote-tracking ref may have been written by legacy code or an ordinary
    // `git fetch`, so it must never narrow this gate.
    const trustedBaseResult = runBeforeDeadline(isolatedRoot, [
      "merge-base",
      localHead.stdout,
      fetchedHead.stdout,
    ]);
    const trustedBase = trustedBaseResult.stdout;
    if (trustedBaseResult.status !== 0 || !trustedBase) {
      return {
        ...trustedBaseResult,
        stderr:
          "Fetched history has no merge-base with the trusted local HEAD; manual audit and re-seeding are required before replacing repository history",
        reason: "fetch_inbound_history_untrusted",
        branch,
        boundary,
      };
    }
    // GitHub repository grants authorize publication. Validate the state we
    // will actually import, not every historical schema generation on the way.
    // A behind/equal target introduces no bytes relative to the trusted base.
    const inboundCommits = trustedBase === fetchedHead.stdout
      ? [] : [fetchedHead.stdout];
    const inboundSnapshots = [];
    for (const commit of inboundCommits) {
      const changed = runBytesBeforeDeadline(isolatedRoot, [
        "diff", "--name-only", "--no-renames", "-z", trustedBase, commit,
      ]);
      if (changed.status !== 0) {
        return {
          ...changed,
          reason: "fetch_inbound_diff_failed",
          branch,
          boundary,
        };
      }
      let changedPaths;
      try {
        changedPaths = [
          ...new Set(
            nullSeparatedGitPaths(
              changed.stdout,
              `Inbound commit ${commit} diff`,
            ),
          ),
        ].sort();
      } catch (error) {
        return {
          status: null,
          stdout: "",
          stderr: error instanceof Error ? error.message : String(error),
          timedOut: false,
          reason: "fetch_inbound_unsafe_tree_entry",
          branch,
          boundary,
        };
      }
      const tree = runBeforeDeadline(isolatedRoot, [
        "rev-parse",
        "--verify",
        `${commit}^{tree}`,
      ]);
      if (tree.status !== 0 || !tree.stdout) {
        return {
          ...tree,
          reason: "fetch_inbound_tree_missing",
          branch,
          boundary,
        };
      }
      {
        const fetchedTreeEntries = runBytesBeforeDeadline(isolatedRoot, [
          "ls-tree",
          "-r",
          "-z",
          commit,
        ]);
        if (fetchedTreeEntries.status !== 0) {
          return {
            ...fetchedTreeEntries,
            reason: "fetch_inbound_tree_paths_failed",
            branch,
            boundary,
          };
        }
        const parsedTree = parseInboundTreeEntries(fetchedTreeEntries.stdout);
        const unsafeTreeEntries = parsedTree.entries.filter(
          ({ mode, type, path }) =>
            !isPortableRepoRelativePath(path) ||
            type !== "blob" ||
            !["100644", "100755"].includes(mode) ||
            ((isOrdinaryMissionControlDataPath(path) ||
              REPOSITORY_DB_CONTROL_PLANE_CASE_KEYS.has(path.normalize("NFC").toLowerCase())) &&
              mode !== "100644"),
        );
        if (
          parsedTree.malformed.length > 0 ||
          unsafeTreeEntries.length > 0
        ) {
          return {
            status: null,
            stdout: "",
            stderr:
              `Fetched tree at inbound commit ${commit} contains non-portable, symlink, gitlink or executable domain-data entries: ` +
              [
                ...parsedTree.malformed,
                ...unsafeTreeEntries.map(
                  ({ mode, type, path }) => `${mode} ${type} ${path}`,
                ),
              ].join(", "),
            timedOut: false,
            reason: "fetch_inbound_unsafe_tree_entry",
            branch,
            boundary,
          };
        }
        // Git attributes can activate a machine-wide clean/smudge driver even
        // with checkout-local config and hooks disabled. Never materialize them
        // (or submodule instructions) in the automatic data update lane.
        const behaviorPaths = parsedTree.entries.filter(({ path }) =>
          [".gitattributes", ".gitmodules"].includes(
            basename(path).normalize("NFC").toLowerCase(),
          ),
        );
        if (behaviorPaths.length > 0) {
          return {
            status: null, stdout: "", timedOut: false,
            stderr: "Target snapshot contains unsupported Git behavior files: " +
              behaviorPaths.map(({ path }) => path).join(", "),
            reason: "fetch_inbound_git_behavior_unsupported", branch, boundary,
          };
        }
        const unsafeCasePaths = findUnsafeInboundCasePaths(
          parsedTree.entries.map(({ path }) => path),
        );
        if (unsafeCasePaths.length > 0) {
          return {
            status: null,
            stdout: "",
            stderr:
              `Fetched tree at inbound commit ${commit} contains case-colliding or non-canonical control-plane paths that are unsafe on supported filesystems: ` +
              unsafeCasePaths.join(", "),
            timedOut: false,
            reason: "fetch_inbound_case_collision",
            branch,
            boundary,
          };
        }
      }
      inboundSnapshots.push({ commit, changedPaths });
    }
    const snapshotsToValidate = inboundSnapshots;
    // Only the target tree is checked out. Historical invalid or subsequently
    // reverted states are inert Git objects; frozen audit history is still
    // checked by the pinned validator against the target's complete history.
    if (snapshotsToValidate.length > 0) {
      // The isolated checkout must reproduce the LF blobs exactly. A host
      // core.autocrlf=true (Git for Windows default) would otherwise rewrite
      // the work tree to CRLF and the pinned validator would report every
      // frozen changeset marker as locally changed.
      const configuredLineEndings = runBeforeDeadline(isolatedRoot, [
        "--git-dir=.",
        "config",
        "core.autocrlf",
        "false",
      ]);
      if (configuredLineEndings.status !== 0) {
        return {
          ...configuredLineEndings,
          reason: "fetch_inbound_validation_config_failed",
          branch,
          boundary,
        };
      }
      for (const [index, snapshot] of snapshotsToValidate.entries()) {
        const validationRoot = join(
          isolatedRoot,
          "validated-checkouts",
          String(index),
        );
        mkdirSync(validationRoot, { recursive: true });
        // `git init --bare` leaves HEAD on an unborn default branch even after
        // the exact configured branch is fetched. The standalone validator must
        // inspect the snapshot commit's complete history, not mistake that
        // dangling HEAD or the final tip for the commit being validated.
        const validationRef = "refs/heads/__mission_control_inbound_validation";
        const updatedValidationRef = runBeforeDeadline(isolatedRoot, [
          "update-ref",
          validationRef,
          snapshot.commit,
        ]);
        const selectedValidationHead =
          updatedValidationRef.status === 0
            ? runBeforeDeadline(isolatedRoot, [
                "symbolic-ref",
                "HEAD",
                validationRef,
              ])
            : updatedValidationRef;
        if (selectedValidationHead.status !== 0) {
          return {
            ...selectedValidationHead,
            reason: "fetch_inbound_validation_head_failed",
            branch,
            boundary,
          };
        }
        const checkedOut = runBeforeDeadline(isolatedRoot, [
          "-c",
          "core.autocrlf=false",
          "-c",
          "core.eol=lf",
          `--work-tree=${validationRoot}`,
          "checkout",
          "--force",
          snapshot.commit,
          "--",
          ".",
        ]);
        if (checkedOut.status !== 0) {
          return {
            ...checkedOut,
            reason: "fetch_inbound_checkout_failed",
            branch,
            boundary,
          };
        }
        // The validator checks local evidence against Git's staged index. Give
        // the isolated work tree a trusted pointer to the temporary bare repo;
        // no checkout-supplied .git metadata is accepted.
        writeFileSync(
          join(validationRoot, ".git"),
          `gitdir: ${isolatedRoot}\n`,
          { mode: 0o600 },
        );
        const configuredValidationWorkTree = runBeforeDeadline(isolatedRoot, [
          "--git-dir=.",
          "config",
          "core.worktree",
          validationRoot,
        ]);
        const configuredValidationNonBare =
          configuredValidationWorkTree.status === 0
            ? runBeforeDeadline(isolatedRoot, [
                "--git-dir=.",
                "config",
                "core.bare",
                "false",
              ])
            : configuredValidationWorkTree;
        if (configuredValidationNonBare.status !== 0) {
          return {
            ...configuredValidationNonBare,
            reason: "fetch_inbound_validation_worktree_failed",
            branch,
            boundary,
          };
        }
        // The validator currently reads JSON schemas from the data checkout.
        // Pin those inputs too: a published data commit cannot weaken its own
        // validation by replacing a schema with {}. A schema upgrade requires
        // the matching reviewed app version, never historical hash approvals.
        const incompatibleSchemas = PINNED_DATA_SCHEMA_NAMES.filter((name) => {
          const target = join(validationRoot, "schemas", name);
          return !existsSync(target) || !normalizeCrlfBytes(readFileSync(target)).equals(
            normalizeCrlfBytes(readFileSync(join(APP_CODE_ROOT, "templates/organization-data/schemas", name))),
          );
        });
        if (incompatibleSchemas.length > 0) {
          return {
            status: null, stdout: "", timedOut: false,
            stderr: "Target schemas require a matching reviewed Mission Control app version: " +
              incompatibleSchemas.join(", "),
            reason: "fetch_inbound_schema_incompatible", branch, boundary,
          };
        }
        let targetRepository;
        try {
          targetRepository = parseYaml(readFileSync(join(validationRoot, "repository-db.yaml"), "utf8"));
        } catch {
          targetRepository = null;
        }
        if (targetRepository?.data_repo?.remote !== boundary.validatedFetchUrl ||
            targetRepository?.data_repo?.branch !== branch) {
          return {
            status: null, stdout: "", timedOut: false,
            stderr: "Target repository-db routing must preserve the configured remote and branch; repository relocation needs an explicit installation change",
            reason: "fetch_inbound_routing_changed", branch, boundary,
          };
        }
        let targetPolicy;
        try {
          targetPolicy = JSON.parse(readFileSync(join(validationRoot,
            "data/mission-control/mission-control.config.json"), "utf8"));
        } catch { targetPolicy = null; }
        if (targetPolicy?.compatibility_bridge?.legacy_write_paths_allowed !== false ||
            ![LOCAL_PRINCIPAL_WRITER_MODE, GITHUB_APP_WORKSPACE_WRITER_MODE].includes(
              targetPolicy?.publish_policy?.writer_mode)) {
          return {
            status: null, stdout: "", timedOut: false,
            stderr: "Target must keep legacy writes disabled and use a supported native Git writer",
            reason: "fetch_inbound_policy_incompatible", branch, boundary,
          };
        }
        const validationRemainingMs = deadline - Date.now();
        let validated;
        if (validationRemainingMs <= 0) {
          validated = {
            status: null,
            stdout: "",
            stderr: `Git fetch operation timed out after ${timeoutMs}ms`,
            timedOut: true,
          };
        } else {
          try {
            validated = runPinnedDataValidation(validationRoot, {
              timeoutMs: validationRemainingMs,
              validationBase: trustedBase,
              // The only unauthenticated inbound fixture boundary is the
              // process-local trusted SSH executable installed explicitly
              // by tests. The validator independently requires the exact
              // ssh://fixture@localhost OS-temp remote shape.
              allowUnauthenticatedLocalTest:
                isIsolatedLocalMutationTestFixture(validationRoot),
            });
          } catch (error) {
            validated = {
              status: 1,
              stdout: "",
              stderr: redactCredentialsInText(
                error instanceof Error ? error.message : String(error),
              ),
              timedOut: false,
            };
          }
        }
        if (validated.status !== 0) {
          return {
            ...validated,
            stderr:
              `Inbound commit ${snapshot.commit} failed pinned validation: ` +
              (validated.stderr || validated.stdout || "validation failed"),
            reason: "fetch_inbound_validation_failed",
            branch,
            boundary,
          };
        }
        const restoredValidationBare = runBeforeDeadline(isolatedRoot, [
          "--git-dir=.",
          "config",
          "core.bare",
          "true",
        ]);
        const removedValidationWorkTree =
          restoredValidationBare.status === 0
            ? runBeforeDeadline(isolatedRoot, [
                "--git-dir=.",
                "config",
                "--unset",
                "core.worktree",
              ])
            : restoredValidationBare;
        if (removedValidationWorkTree.status !== 0) {
          return {
            ...removedValidationWorkTree,
            reason: "fetch_inbound_validation_worktree_restore_failed",
            branch,
            boundary,
          };
        }
      }
    }
    const bundled = runBeforeDeadline(isolatedRoot, [
      "bundle",
      "create",
      bundlePath,
      fetchedRef,
    ]);
    if (bundled.status !== 0) {
      return {
        ...bundled,
        reason: "fetch_bundle_failed",
        branch,
        boundary,
      };
    }
    const unbundled = runBeforeDeadline(root, [
      "bundle",
      "unbundle",
      bundlePath,
    ]);
    if (unbundled.status !== 0) {
      return {
        ...unbundled,
        reason: "fetch_import_failed",
        branch,
        boundary,
      };
    }

    const expectedOld =
      oldRemoteRef.status === 0 && oldRemoteRef.stdout
        ? oldRemoteRef.stdout
        : "0".repeat(fetchedHead.stdout.length);
    const updated = runBeforeDeadline(root, [
      "update-ref",
      remoteRef,
      fetchedHead.stdout,
      expectedOld,
    ]);
    if (updated.status !== 0) {
      const current = runBeforeDeadline(root, [
        "rev-parse",
        "--verify",
        remoteRef,
      ]);
      if (current.status !== 0 || current.stdout !== fetchedHead.stdout) {
        return {
          ...updated,
          stderr:
            updated.stderr ||
            "origin remote-tracking ref changed concurrently; retry freshness",
          reason: "fetch_ref_race",
          branch,
          boundary,
        };
      }
    }
    return {
      status: 0,
      stdout: fetchedHead.stdout,
      stderr: "",
      timedOut: false,
      reason: null,
      branch,
      boundary,
    };
  } finally {
    rmSync(isolatedRoot, { recursive: true, force: true });
  }
}

function getAheadBehind(repositoryDbRoot, branch) {
  const remoteRef = `origin/${branch}`;
  const verify = git(repositoryDbRoot, ["rev-parse", "--verify", remoteRef], { allowFailure: true });
  if (verify.status !== 0) {
    return { ahead: null, behind: null, remoteRefExists: false, remoteHead: null };
  }
  const result = git(repositoryDbRoot, ["rev-list", "--left-right", "--count", `HEAD...${remoteRef}`]);
  const [ahead, behind] = result.stdout.split(/\s+/).map((value) => Number.parseInt(value, 10));
  return { ahead, behind, remoteRefExists: true, remoteHead: verify.stdout };
}

function getRepositoryDirtyLines(repositoryDbRoot) {
  const ordinary = git(repositoryDbRoot, [
    "status",
    "--porcelain",
    "--untracked-files=all",
  ]).stdout
    .split("\n")
    .filter(Boolean);
  const ignoredDomainData = git(repositoryDbRoot, [
    "status",
    "--porcelain",
    "--untracked-files=all",
    "--ignored=matching",
    "--",
    "data/mission-control",
  ]).stdout
    .split("\n")
    .filter(Boolean);
  return [...new Set([...ordinary, ...ignoredDomainData])];
}

function activeGitOperations(repositoryDbRoot) {
  return [
    ...new Set(
      GIT_OPERATION_MARKERS.filter(({ path }) => {
        const markerPath = git(repositoryDbRoot, [
          "rev-parse",
          "--git-path",
          path,
        ]).stdout;
        return existsSync(
          isAbsolute(markerPath)
            ? markerPath
            : resolve(repositoryDbRoot, markerPath),
        );
      }).map(({ operation }) => operation),
    ),
  ];
}

function assertNoGitOperationInProgress(repositoryDbRoot) {
  const activeOperations = activeGitOperations(repositoryDbRoot);
  if (activeOperations.length > 0) {
    throw new Error(
      `Git operation is already in progress: ${activeOperations.join(", ")}`,
    );
  }
}

export function getMissionControlRepositoryStatus({ repositoryDbRoot, fetch = true } = {}) {
  const fetchBoundary = getMissionControlRepositoryFetchBoundaryStatus({
    repositoryDbRoot,
  });
  const root = fetchBoundary.repositoryDbRoot;
  const expectedBranch = fetchBoundary.expectedBranch;
  const currentBranch = git(root, ["rev-parse", "--abbrev-ref", "HEAD"]).stdout;
  const rawPushRemoteUrls = getRemoteUrls(root, { push: true });
  const rawPushRemoteUrl = rawPushRemoteUrls[0] ?? null;
  const remoteMatches =
    fetchBoundary.fetchRemoteMatches &&
    rawPushRemoteUrls.length === 1 &&
    rawPushRemoteUrl === fetchBoundary.validatedFetchUrl &&
    fetchBoundary.localGitRoutingOverrides.length === 0;
  if (fetch && fetchBoundary.fetchRemoteMatches) {
    fetchMissionControlRepositoryRemote({ repositoryDbRoot: root });
  }
  const worktreeInspectionBlocked =
    !fetchBoundary.controlPlaneTrusted ||
    fetchBoundary.localGitFetchRoutingOverrides.length > 0;
  const dirtyLines = worktreeInspectionBlocked
    ? [
        !fetchBoundary.controlPlaneTrusted
          ? `Repository-db control-plane drift blocks fetch and safe worktree inspection: ${fetchBoundary.controlPlaneDriftPaths.join(", ") || "invalid HEAD repository-db.yaml"}`
          : `Git routing overrides block safe worktree inspection: ${fetchBoundary.localGitFetchRoutingOverrides.join(", ")}`,
      ]
    : getRepositoryDirtyLines(root);
  const remote = fetchBoundary.branchConfigured
    ? getAheadBehind(root, expectedBranch)
    : { ahead: null, behind: null, remoteRefExists: false, remoteHead: null };
  return {
    repositoryDbRoot: root,
    expectedBranch,
    branchConfigured: fetchBoundary.branchConfigured,
    controlPlaneTrusted: fetchBoundary.controlPlaneTrusted,
    controlPlaneDriftPaths: fetchBoundary.controlPlaneDriftPaths,
    currentBranch,
    head: currentHead(root),
    expectedRemoteUrl: fetchBoundary.expectedRemoteUrl,
    remoteUrl: fetchBoundary.remoteUrl,
    remoteUrls: fetchBoundary.remoteUrls,
    pushRemoteUrl: redactRemoteUrl(rawPushRemoteUrl),
    pushRemoteUrls: rawPushRemoteUrls.map(redactRemoteUrl),
    localGitRoutingOverrides: fetchBoundary.localGitRoutingOverrides,
    localGitFetchRoutingOverrides:
      fetchBoundary.localGitFetchRoutingOverrides,
    remoteConfigured: fetchBoundary.remoteConfigured,
    fetchRemoteMatches: fetchBoundary.fetchRemoteMatches,
    remoteMatches,
    commitIdentityConfigured: hasConcreteLocalCommitIdentity(root),
    clean: dirtyLines.length === 0,
    dirty: dirtyLines,
    ahead: remote.ahead,
    behind: remote.behind,
    remoteRefExists: remote.remoteRefExists,
    remoteHead: remote.remoteHead,
  };
}

export function assertRepositoryReadyForPublish({
  repositoryDbRoot,
  fetch = true,
} = {}) {
  assertNoGitOperationInProgress(resolve(repositoryDbRoot));
  if (fetch) {
    const fetched = fetchMissionControlRepositoryRemote({
      repositoryDbRoot,
    });
    if (fetched.status !== 0) {
      throw new Error(
        `Data repo fetch verification failed (${fetched.reason ?? "fetch_failed"}): ${fetched.stderr || fetched.stdout || "unknown Git error"}`,
      );
    }
  }
  const status = getMissionControlRepositoryStatus({
    repositoryDbRoot,
    fetch: false,
  });
  if (!status.branchConfigured) {
    throw new Error(
      `repository-db.yaml data_repo.branch is not a safe Git branch: ${status.expectedBranch}`,
    );
  }
  if (status.currentBranch !== status.expectedBranch) {
    throw new Error(`Data repo must be on ${status.expectedBranch}; current branch is ${status.currentBranch}`);
  }
  if (!status.remoteConfigured) {
    throw new Error(
      "repository-db.yaml data_repo.remote must be a concrete credential-free Organization-owned HTTPS or SSH mission-control-data Git remote before publish",
    );
  }
  if (!status.remoteMatches) {
    throw new Error(
      `Data repo origin fetch/push remote must match repository-db.yaml data_repo.remote without local routing overrides: expected ${status.expectedRemoteUrl}, fetch=${status.remoteUrls.join(",") || "<missing>"}, push=${status.pushRemoteUrls.join(",") || "<missing>"}, overrides=${status.localGitRoutingOverrides.join(",") || "<none>"}`,
    );
  }
  if (!status.commitIdentityConfigured) {
    throw new Error(
      "Data repo requires a Git commit identity; configure user.name and user.email in normal Git config before publish",
    );
  }
  if (!status.clean) {
    throw new Error(`Data repo has uncommitted changes: ${status.dirty.join(", ")}`);
  }
  if (status.remoteRefExists && (status.ahead !== 0 || status.behind !== 0)) {
    throw new Error(`Data repo remote divergence blocks publish: ahead=${status.ahead} behind=${status.behind}`);
  }
  return status;
}

export function assertRepositoryReadyForLocalMutation({
  repositoryDbRoot,
} = {}) {
  assertNoGitOperationInProgress(resolve(repositoryDbRoot));
  const status = getMissionControlRepositoryStatus({
    repositoryDbRoot,
    fetch: false,
  });
  if (!status.branchConfigured) {
    throw new Error(
      `repository-db.yaml data_repo.branch is not a safe Git branch: ${status.expectedBranch}`,
    );
  }
  if (status.currentBranch !== status.expectedBranch) {
    throw new Error(
      `Data repo must be on ${status.expectedBranch}; current branch is ${status.currentBranch}`,
    );
  }
  if (!status.remoteConfigured) {
    throw new Error(
      "repository-db.yaml data_repo.remote must be a concrete credential-free Organization-owned HTTPS or SSH mission-control-data Git remote before local mutation",
    );
  }
  if (!status.remoteMatches) {
    throw new Error(
      `Data repo origin fetch/push remote must match repository-db.yaml data_repo.remote without local routing overrides: expected ${status.expectedRemoteUrl}, fetch=${status.remoteUrls.join(",") || "<missing>"}, push=${status.pushRemoteUrls.join(",") || "<missing>"}, overrides=${status.localGitRoutingOverrides.join(",") || "<none>"}`,
    );
  }
  if (!status.commitIdentityConfigured) {
    throw new Error(
      "Data repo requires a Git commit identity; configure user.name and user.email in normal Git config before local mutation",
    );
  }
  if (!status.clean) {
    throw new Error(
      `Data repo has uncommitted changes: ${status.dirty.join(", ")}`,
    );
  }
  if (status.remoteRefExists && status.behind !== 0) {
    throw new Error(
      `Data repo remote divergence blocks local mutation: ahead=${status.ahead} behind=${status.behind}`,
    );
  }
  return status;
}

function stagePaths(root, paths) {
  git(root, ["add", "--", ...paths]);
}

function localBranchRefs(root) {
  const output = git(
    root,
    ["for-each-ref", "--format=%(refname)%00%(objectname)", "refs/heads"],
  ).stdout;
  return new Map(
    output
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split("\0")),
  );
}

function captureRepositorySnapshot(root) {
  return {
    head: currentHead(root),
    branch: git(root, ["rev-parse", "--abbrev-ref", "HEAD"]).stdout,
    branches: localBranchRefs(root),
  };
}

function capturePublishIndexSnapshot(root, allowedPaths) {
  const allowedPathSet = new Set(allowedPaths);
  const stagedPaths = git(
    root,
    ["diff", "--cached", "--name-only", "--no-renames", "-z"],
  ).stdout
    .split("\0")
    .filter(Boolean);
  const unexpectedPaths = stagedPaths.filter((path) => !allowedPathSet.has(path));
  if (unexpectedPaths.length > 0) {
    throw new Error(
      `Mission Control publish staged paths outside the approved atomic set: ${unexpectedPaths.join(", ")}`,
    );
  }
  return {
    ...captureRepositorySnapshot(root),
    tree: git(root, ["write-tree"]).stdout,
  };
}

function remoteBranchHead(
  root,
  branch,
  { timeoutMs, httpsCredentialHelpers } = {},
) {
  const ref = `refs/heads/${branch}`;
  const result = git(root, [
    "ls-remote",
    "--exit-code",
    "--heads",
    "origin",
    ref,
  ], { timeoutMs, httpsCredentialHelpers });
  const lines = result.stdout.split("\n").filter(Boolean);
  const fields = lines.length === 1 ? lines[0].split(/\s+/) : [];
  if (
    fields.length !== 2 ||
    fields[1] !== ref ||
    !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(fields[0])
  ) {
    throw new Error(
      `Data repo remote branch ${ref} did not resolve to one exact Git commit`,
    );
  }
  return fields[0];
}

function remoteOutcomeUnknown(message, cause = undefined) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = "publish_outcome_unknown";
  error.preserveMissionControlRepository = true;
  return error;
}

function publishRolledBackError(message, cause = undefined) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = "publish_failed_rolled_back";
  return error;
}

function commitAndPush(data, {
  message,
  paths,
  push = true,
  validatedIndexSnapshot = null,
  changedPaths = null,
}) {
  const root = data.repositoryDb.root;
  const previousHead = validatedIndexSnapshot?.head ?? currentHead(root);
  let createdHead = null;
  const rollbackUnpublishedCommit = () => {
    if (!createdHead || currentHead(root) !== createdHead) {
      throw remoteOutcomeUnknown(
        `Local data commit cannot be rolled back because HEAD no longer equals the writer-created commit ${createdHead ?? "<missing>"}; preserve local state and reconcile manually`,
      );
    }
    const currentBranch = git(root, [
      "rev-parse",
      "--abbrev-ref",
      "HEAD",
    ]).stdout;
    const currentBranches = localBranchRefs(root);
    const expectedBranches =
      validatedIndexSnapshot?.branches ??
      new Map([[`refs/heads/${currentBranch}`, previousHead]]);
    const currentBranchRef = `refs/heads/${currentBranch}`;
    const branchRefsMatch =
      currentBranches.size === expectedBranches.size &&
      [...expectedBranches.entries()].every(([ref, objectId]) =>
        currentBranches.get(ref) ===
        (ref === currentBranchRef ? createdHead : objectId),
      );
    const status = git(root, ["status", "--porcelain"]).stdout;
    if (
      (validatedIndexSnapshot &&
        currentBranch !== validatedIndexSnapshot.branch) ||
      !branchRefsMatch ||
      status
    ) {
      throw remoteOutcomeUnknown(
        `Local data commit ${createdHead} cannot be rolled back because branch refs, index or worktree changed after commit; preserve local state and reconcile manually`,
      );
    }
    git(root, ["reset", "--hard", previousHead]);
  };
  if (validatedIndexSnapshot) {
    const currentHeadValue = currentHead(root);
    const currentBranch = git(root, ["rev-parse", "--abbrev-ref", "HEAD"]).stdout;
    const currentBranches = localBranchRefs(root);
    const currentIndexTree = git(root, ["write-tree"]).stdout;
    const branchRefsUnchanged =
      currentBranches.size === validatedIndexSnapshot.branches.size &&
      [...validatedIndexSnapshot.branches.entries()].every(
        ([ref, objectId]) => currentBranches.get(ref) === objectId,
      );
    if (
      currentHeadValue !== validatedIndexSnapshot.head ||
      currentBranch !== validatedIndexSnapshot.branch ||
      !branchRefsUnchanged ||
      currentIndexTree !== validatedIndexSnapshot.tree
    ) {
      throw new Error(
        "Mission Control data validation changed the Git branch, HEAD, or staged publish index",
      );
    }
    const unstagedTrackedPaths = git(root, ["diff", "--name-only", "-z"]).stdout
      .split("\0")
      .filter(Boolean);
    const untrackedPaths = git(
      root,
      ["ls-files", "--others", "--exclude-standard", "-z"],
    ).stdout
      .split("\0")
      .filter(Boolean);
    const ignoredDomainPaths = git(
      root,
      [
        "ls-files",
        "--others",
        "--ignored",
        "--exclude-standard",
        "-z",
        "--",
        "data/mission-control",
      ],
    ).stdout
      .split("\0")
      .filter(Boolean);
    if (
      unstagedTrackedPaths.length > 0 ||
      untrackedPaths.length > 0 ||
      ignoredDomainPaths.length > 0
    ) {
      throw new Error(
        `Mission Control data validation left unvalidated working-tree changes: ${[
          ...unstagedTrackedPaths,
          ...untrackedPaths,
          ...ignoredDomainPaths,
        ].join(", ")}`,
      );
    }
  } else {
    stagePaths(root, paths);
  }
  const status = git(root, ["status", "--porcelain"]).stdout;
  if (!status) return { committed: false, head: previousHead, pushed: false };
  assertNoGitOperationInProgress(root);
  git(root, ["commit", "-m", message]);
  const head = currentHead(root);
  createdHead = head;
  const commitLine = git(root, [
    "rev-list",
    "--parents",
    "-n",
    "1",
    head,
  ]).stdout;
  const commitFields = commitLine.split(/\s+/).filter(Boolean);
  if (
    commitFields.length !== 2 ||
    commitFields[0] !== head ||
    commitFields[1] !== previousHead
  ) {
    rollbackUnpublishedCommit();
    throw new Error(
      `Data repo writer commit must have exactly one parent equal to transaction start ${previousHead}; local commit returned to ${previousHead}`,
    );
  }
  if (push) {
    const branch = configuredBranch(data);
    const httpsCredentialHelpers =
      remoteUsesHttps(configuredRemote(data))
        ? principalCredentialHelperOverrides()
        : [];
    const networkDeadline =
      Date.now() + DEFAULT_GIT_TIMEOUT_MS;
    const remainingNetworkMs = () => {
      const remaining = networkDeadline - Date.now();
      if (remaining <= 0) {
        const error = new Error(
          "Mission Control publish network deadline expired",
        );
        error.code = "publish_network_timeout";
        throw error;
      }
      return remaining;
    };
    try {
      if (!Array.isArray(changedPaths)) {
        throw new Error(
          "Mission Control publish requires the exact validated path set",
        );
      }
      const descendant = git(
        root,
        ["merge-base", "--is-ancestor", previousHead, head],
        { allowFailure: true },
      );
      if (descendant.status !== 0) {
        throw new Error(
          `Data repo writer commit ${head} is not a fast-forward descendant of transaction start ${previousHead}`,
        );
      }
      const committedPaths = [
        ...new Set(
          nullSeparatedGitPaths(
            git(
              root,
              [
                "diff",
                "--name-only",
                "-z",
                previousHead,
                head,
              ],
              { binaryStdout: true },
            ).stdout,
            `Mission Control writer commit ${head} diff`,
          ),
        ),
      ].sort();
      const expectedPaths = [...new Set(changedPaths)].sort();
      if (
        expectedPaths.length === 0 ||
        canonicalJson(expectedPaths) !== canonicalJson(committedPaths)
      ) {
        throw new Error(
          `Local Principal commit paths differ from the validated publish set: expected=${expectedPaths.join(",")} actual=${committedPaths.join(",")}`,
        );
      }
      const remoteStart = remoteBranchHead(root, branch, {
        timeoutMs: remainingNetworkMs(),
        httpsCredentialHelpers,
      });
      if (remoteStart !== previousHead) {
        throw new Error(
          `Data repo remote changed before push: expected ${previousHead}, current ${remoteStart}`,
        );
      }
    } catch (error) {
      rollbackUnpublishedCommit();
      throw publishRolledBackError(
        `Data repo push preflight failed before any remote update; local commit returned to ${previousHead}: ${error.message}`,
        error,
      );
    }

    let pushError = null;
    try {
      git(root, [
        "push",
        "origin",
        `HEAD:refs/heads/${branch}`,
      ], { timeoutMs: remainingNetworkMs(), httpsCredentialHelpers });
    } catch (error) {
      pushError = error;
    }
    if (pushError) {
      let remoteAfterError;
      try {
        remoteAfterError = remoteBranchHead(root, branch, {
          timeoutMs: remainingNetworkMs(),
          httpsCredentialHelpers,
        });
      } catch (verificationError) {
        throw remoteOutcomeUnknown(
          `Data repo push returned an error and remote outcome cannot be verified; preserve local commit ${head} and reconcile before retrying: ${pushError.message}; verification: ${verificationError.message}`,
          pushError,
        );
      }
      if (remoteAfterError === previousHead) {
        rollbackUnpublishedCommit();
        throw publishRolledBackError(
          `Data repo push was rejected and remote remained at ${previousHead}; local unpublished commit was rolled back: ${pushError.message}`,
          pushError,
        );
      }
      if (remoteAfterError !== head) {
        throw remoteOutcomeUnknown(
          `Data repo push returned an error and remote moved to ${remoteAfterError} instead of known start ${previousHead} or local commit ${head}; preserve local state and reconcile before retrying: ${pushError.message}`,
          pushError,
        );
      }
    }
    let observedRemoteHead;
    try {
      observedRemoteHead = remoteBranchHead(root, branch, {
        timeoutMs: remainingNetworkMs(),
        httpsCredentialHelpers,
      });
    } catch (error) {
      throw remoteOutcomeUnknown(
        `Data repo push completed, but exact remote HEAD verification failed; preserve local commit ${head} and reconcile before retrying: ${error.message}`,
        error,
      );
    }
    if (observedRemoteHead !== head) {
      throw remoteOutcomeUnknown(
        `Data repo push completed, but remote HEAD changed concurrently: pushed ${head}, observed ${observedRemoteHead}; preserve local state and reconcile before retrying`,
      );
    }
  }
  return { committed: true, head, pushed: push };
}

function listChangesetsInDirectory(data, state) {
  const directory = dirname(changesetPath(data, "read-guard", state, { readOnly: true }));
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => {
      const path = resolve(directory, entry.name);
      const changeset = readJsonFile(path);
      return {
        id: changeset.id ?? entry.name.replace(/\.json$/, ""),
        status: changeset.status ?? state,
        summary: changeset.summary ?? "",
        created_at: changeset.created_at ?? null,
        created_by: changeset.created_by ?? null,
        approved_at: changeset.approval?.approved_at ?? null,
        approved_by: changeset.approval?.approved_by ?? null,
        published_at: changeset.published_at ?? null,
        published_by: changeset.published_by ?? null,
        superseded_at: changeset.supersession?.superseded_at ?? null,
        superseded_by: changeset.supersession?.superseded_by ?? null,
        supersession_role: changeset.supersession?.role ?? null,
        supersession_reason: changeset.supersession?.reason ?? null,
        replacement_changeset_id: changeset.supersession?.replacement_changeset_id ?? null,
        relativePath: repoRelativePath(data.repositoryDb.root, path),
        operations: Array.isArray(changeset.operations) ? changeset.operations : [],
        changeset,
      };
    })
    .sort((left, right) => `${left.created_at ?? ""}:${left.id}`.localeCompare(`${right.created_at ?? ""}:${right.id}`));
}

export function listMissionControlChangesets({ repositoryDbRoot } = {}) {
  const data = loadMissionControlData({ repositoryDbRoot });
  return {
    pending: listChangesetsInDirectory(data, "pending"),
    published: listChangesetsInDirectory(data, "published"),
    superseded: listChangesetsInDirectory(data, "superseded"),
  };
}

function applyOperations(
  data,
  operations,
  protectedPaths,
  { onBeforeWrite = null } = {},
) {
  const normalized = normalizeOperations(data, operations);
  assertPathsMatchAllowlist(
    normalized.map((operation) => operation.relativePath),
    protectedPaths,
    "publish policy protected paths",
  );
  for (const operation of normalized) {
    mkdirSync(dirname(operation.absolutePath), { recursive: true });
    onBeforeWrite?.(operation.relativePath);
    writeFileSync(operation.absolutePath, operation.content);
  }
  return normalized.map((operation) => operation.relativePath);
}

function assertLocalPublishDestinations(data, operations) {
  const root = resolve(data.repositoryDb.root);
  for (const target of operations.map((operation) => operation.absolutePath)) {
    if (existsSync(target) && !lstatSync(target).isFile()) {
      const error = new Error(
        `Mission Control publish target must be a regular file or absent: ${repoRelativePath(root, target)}`,
      );
      error.code = "validation_failed";
      throw error;
    }
    let parent = dirname(target);
    while (isSamePathOrInside(root, parent) && parent !== root) {
      if (existsSync(parent)) {
        if (!lstatSync(parent).isDirectory()) {
          const error = new Error(
            `Mission Control publish parent must be a directory: ${repoRelativePath(root, parent)}`,
          );
          error.code = "validation_failed";
          throw error;
        }
        break;
      }
      parent = dirname(parent);
    }
  }
}

function assertLocalOperationPathsSafe(
  data,
  operations,
  additionalPaths = [],
) {
  const root = data.repositoryDb.root;
  const operationPaths = operations.map(
    (operation) => operation.relativePath,
  );
  const candidatePaths = [...operationPaths, ...additionalPaths];
  const protectedOperationPaths = candidatePaths.filter(
    (path) => !isOrdinaryMissionControlDataPath(path),
  );
  if (protectedOperationPaths.length > 0) {
    const error = new Error(
      `Local Principal publish cannot change Git behavior or repository-db control-plane paths: ${protectedOperationPaths.join(", ")}`,
    );
    error.code = "validation_failed";
    throw error;
  }
  const trackedPaths = git(
    root,
    ["ls-files", "-z"],
  ).stdout
    .split("\0")
    .filter(Boolean);
  const unsafeCasePaths = findUnsafeInboundCasePaths([
    ...new Set([...trackedPaths, ...candidatePaths]),
  ]);
  if (unsafeCasePaths.length > 0) {
    const error = new Error(
      `Local Principal publish would create case-colliding or non-canonical paths that peers reject: ${unsafeCasePaths.join(", ")}`,
    );
    error.code = "validation_failed";
    throw error;
  }
  const indexedOperationEntries = git(
    root,
    [
      "ls-files",
      "--stage",
      "-z",
      "--",
      ...operationPaths.map((path) => `:(literal)${path}`),
    ],
  ).stdout
    .split("\0")
    .filter(Boolean);
  for (const entry of indexedOperationEntries) {
    const separator = entry.indexOf("\t");
    const metadata = separator >= 0 ? entry.slice(0, separator) : "";
    const path = separator >= 0 ? entry.slice(separator + 1) : "";
    const mode = metadata.split(/\s+/)[0] ?? "";
    if (!operationPaths.includes(path)) continue;
    if (mode !== "100644") {
      const error = new Error(
        `Local Principal publish requires ordinary 100644 data files; candidate index contains ${mode || "<invalid>"} ${path || "<invalid>"}`,
      );
      error.code = "validation_failed";
      throw error;
    }
  }
}

function assertWriterOwnedPublishState(
  data,
  snapshot,
  writerTouchedPaths,
  expectedContents,
  validatedIndexSnapshot,
) {
  const root = data.repositoryDb.root;
  if (currentHead(root) !== snapshot.head) {
    throw remoteOutcomeUnknown(
      `Mission Control publish failed after local HEAD changed from ${snapshot.head}; preserve local state and reconcile manually`,
    );
  }
  if (
    validatedIndexSnapshot &&
    git(root, ["write-tree"]).stdout !== validatedIndexSnapshot.tree
  ) {
    throw remoteOutcomeUnknown(
      "Mission Control publish failed after the staged index changed during validation; preserve local state and reconcile manually",
    );
  }
  const changedPaths = git(
    root,
    ["status", "--porcelain", "--untracked-files=all", "-z"],
    { binaryStdout: true },
  ).stdout;
  const statusEntries = Buffer.from(changedPaths)
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((entry) => entry.slice(3));
  const allowed = new Set(writerTouchedPaths);
  const unexpected = statusEntries.filter((path) => !allowed.has(path));
  if (unexpected.length > 0) {
    throw remoteOutcomeUnknown(
      `Mission Control publish failed after unrelated local paths changed: ${unexpected.join(", ")}; preserve local state and reconcile manually`,
    );
  }
  for (const path of allowed) {
    const content = expectedContents.get(path);
    const absolutePath = resolve(root, path);
    if (
      !existsSync(absolutePath) ||
      !lstatSync(absolutePath).isFile() ||
      !readFileSync(absolutePath).equals(Buffer.from(content, "utf8"))
    ) {
      throw remoteOutcomeUnknown(
        `Mission Control publish failed after writer-owned path ${path} changed externally; preserve local state and reconcile manually`,
      );
    }
  }
}

export function publishMissionControlLocalDraft({
  repositoryDbRoot,
  draftId,
  draftRevision,
} = {}) {
  if (!draftId) throw new Error("draftId is required");
  if (
    typeof draftRevision !== "string" ||
    !/^[0-9a-f]{64}$/.test(draftRevision)
  ) {
    throw new Error("draftRevision must be a lowercase SHA-256 digest");
  }
  const fetched = fetchMissionControlRepositoryRemote({
    repositoryDbRoot,
  });
  if (fetched.status !== 0) {
    throw new Error(
      `Data repo fetch verification failed (${fetched.reason ?? "fetch_failed"}): ${fetched.stderr || fetched.stdout || "unknown Git error"}`,
    );
  }
  const identityData = loadMissionControlData({ repositoryDbRoot });
  assertNativeGitWriterConfigured(identityData);
  return withMissionControlRepositoryWriteLock(repositoryDbRoot, () => {
    const preliminaryData = loadMissionControlData({ repositoryDbRoot });
    assertNativeGitWriterConfigured(preliminaryData);
    const preliminaryDraft = readLocalDraft(
      preliminaryData,
      draftId,
    ).draft;
    if (preliminaryDraft.draft_revision !== draftRevision) {
      const error = new Error(
        `Local Mission Control draft ${draftId} changed after confirmation`,
      );
      error.code = "draft_changed";
      throw error;
    }

    assertRepositoryReadyForPublish({
      repositoryDbRoot,
      fetch: false,
    });
    const data = loadMissionControlData({ repositoryDbRoot });
    assertNativeGitWriterConfigured(data);
    const { path: draftPath, draft } = readLocalDraft(data, draftId);
    if (
      draft.draft_revision !== draftRevision ||
      draft.base_commit !== currentHead(data.repositoryDb.root)
    ) {
      const error = new Error(
        `Local Mission Control draft ${draftId} no longer matches the confirmed revision or current data HEAD`,
      );
      error.code = "draft_changed";
      throw error;
    }
    const operations = normalizeProtectedOperations(
      data,
      draft.operations,
    );
    assertOperationsChangeCanonicalData(operations);
    assertLocalOperationPathsSafe(data, operations);
    assertLocalPublishDestinations(data, operations);
    nativeCommitIdentity(data.repositoryDb.root);
    const operationPaths = operations.map(
      (operation) => operation.relativePath,
    );
    const publishPaths = [...operationPaths];
    const snapshot = captureRepositorySnapshot(data.repositoryDb.root);
    const expectedContents = new Map(
      operations.map((operation) => [
        operation.relativePath,
        operation.content,
      ]),
    );
    const writerTouchedPaths = new Set();
    let validatedIndexSnapshot = null;

    try {
      applyOperations(
        data,
        draft.operations,
        assertProtectedPathsConfigured(data.config),
        {
          onBeforeWrite(path) {
            writerTouchedPaths.add(path);
          },
        },
      );
      stagePaths(data.repositoryDb.root, publishPaths);
      validatedIndexSnapshot = capturePublishIndexSnapshot(
        data.repositoryDb.root,
        publishPaths,
      );
      runValidation(data, {
        allowUnauthenticatedLocalTest:
          isIsolatedLocalMutationTestFixture(
            data.repositoryDb.root,
          ),
      });
      const commit = commitAndPush(data, {
        message: `mission-control: ${draft.summary}`,
        paths: publishPaths,
        push: true,
        validatedIndexSnapshot,
        changedPaths: publishPaths,
      });
      rmSync(draftPath, { force: true });
      return {
        id: draft.id,
        summary: draft.summary,
        changedPaths: [...operationPaths].sort(),
        commit,
      };
    } catch (error) {
      if (error?.preserveMissionControlRepository === true) {
        throw error;
      }
      const status = git(
        data.repositoryDb.root,
        ["status", "--porcelain"],
      ).stdout;
      if (
        currentHead(data.repositoryDb.root) === snapshot.head &&
        !status
      ) {
        throw error;
      }
      assertWriterOwnedPublishState(
        data,
        snapshot,
        writerTouchedPaths,
        expectedContents,
        validatedIndexSnapshot,
      );
      restoreRepositorySnapshot(
        data,
        snapshot,
        [...writerTouchedPaths],
      );
      throw error;
    }
  });
}

function preserveRollbackCommit(root, objectId) {
  const preservedRef = `refs/mission-control/rollback-preserved/${objectId}`;
  git(root, ["update-ref", preservedRef, objectId]);
  return preservedRef;
}

function isAncestorCommit(root, ancestor, descendant) {
  return git(
    root,
    ["merge-base", "--is-ancestor", ancestor, descendant],
    { allowFailure: true },
  ).status === 0;
}

function restoreCapturedBranchRefs(root, snapshot) {
  const currentBranches = localBranchRefs(root);
  const publishBranchRef = `refs/heads/${snapshot.branch}`;
  for (const [ref, capturedObjectId] of snapshot.branches.entries()) {
    const observedObjectId = currentBranches.get(ref);
    if (observedObjectId === capturedObjectId) continue;
    if (observedObjectId === undefined) {
      git(root, [
        "update-ref",
        ref,
        capturedObjectId,
        "0000000000000000000000000000000000000000",
      ]);
      continue;
    }
    if (
      ref !== publishBranchRef &&
      isAncestorCommit(root, capturedObjectId, observedObjectId)
    ) {
      continue;
    }
    preserveRollbackCommit(root, observedObjectId);
    git(root, ["update-ref", ref, capturedObjectId, observedObjectId]);
  }
}

function restorePublishPaths(root, snapshotHead, publishPaths) {
  for (const path of new Set(publishPaths)) {
    git(root, ["add", "-A", "--", path], {
      allowFailure: true,
    });
    const existsInSnapshot =
      git(root, ["cat-file", "-e", `${snapshotHead}:${path}`], {
        allowFailure: true,
      }).status === 0;
    const existsInIndex =
      git(root, ["ls-files", "--error-unmatch", "--", path], {
        allowFailure: true,
      }).status === 0;
    if (existsInSnapshot || existsInIndex) {
      git(root, [
        "restore",
        `--source=${snapshotHead}`,
        "--staged",
        "--worktree",
        "--",
        path,
      ]);
    } else {
      rmSync(resolve(root, path), { force: true, recursive: true });
    }
  }
}

function restoreRepositorySnapshot(data, snapshot, publishPaths) {
  const root = data.repositoryDb.root;
  restoreCapturedBranchRefs(root, snapshot);
  restorePublishPaths(root, snapshot.head, publishPaths);
  const currentBranch = git(
    root,
    ["rev-parse", "--abbrev-ref", "HEAD"],
  ).stdout;
  if (currentBranch !== snapshot.branch) {
    git(root, ["checkout", snapshot.branch]);
  }
}
