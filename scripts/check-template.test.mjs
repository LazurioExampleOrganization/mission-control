import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { validateTemplate } from "./check-template.mjs";
import { detectSymlinkSupport } from "../test-support/symlink-support.mjs";

// Test fixtures create Git repositories with the host's default line-ending
// policy. Force LF so Windows hosts with core.autocrlf=true cannot turn
// fixture worktrees into CRLF copies that no longer match their LF blobs.
process.env.GIT_CONFIG_PARAMETERS = [
  process.env.GIT_CONFIG_PARAMETERS,
  "'core.autocrlf=false' 'core.eol=lf'",
].filter(Boolean).join(" ");

const root = fileURLToPath(new URL("..", import.meta.url));
const rootInstanceMode = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8"),
)?.companyascode?.mission_control?.mode;
const templateContractTest =
  rootInstanceMode === "organization" ? test.skip : test;
const fixtureCopyIgnoredSegments = new Set([".build", ".cache", "dist", "node_modules"]);
const pinnedValidatorPath =
  "templates/organization-data/scripts/validate-mission-control-data.mjs";
const pinnedValidatorPathManifest =
  "config/trusted-pinned-validator-paths.json";

const symlinkTest = detectSymlinkSupport() ? test : test.skip;

function rootGit(args) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(`Template Git fixture failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

function gitBlobDigest(repositoryRoot, reference, path) {
  const result = spawnSync("git", ["show", `${reference}:${path}`], {
    cwd: repositoryRoot,
    encoding: null,
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(
    result.status,
    0,
    Buffer.isBuffer(result.stderr)
      ? result.stderr.toString("utf8")
      : String(result.stderr ?? ""),
  );
  return createHash("sha256").update(result.stdout).digest("hex");
}

function currentPinnedApplicationEvidence() {
  const commit = rootGit(["rev-parse", "HEAD"]);
  return {
    repository: "ExampleOrganization/mission-control",
    commit,
    validator_path: pinnedValidatorPath,
    validator_digest_sha256: gitBlobDigest(
      root,
      commit,
      pinnedValidatorPath,
    ),
    control_plane_tree_sha: rootGit(["rev-parse", "HEAD^{tree}"]),
  };
}

function shouldCopyFixturePath(path) {
  return !path.split(sep).some((segment) => fixtureCopyIgnoredSegments.has(segment));
}

function withTempTemplate(mutator) {
  const tempRoot = join(tmpdir(), `mission-control-template-test-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(tempRoot, { recursive: true });
  try {
    for (const entry of [
      "README.md",
      "AGENTS.md",
      "LICENSE",
      "NOTICE.md",
      "CONTRIBUTING.md",
      "SECURITY.md",
      "config",
      "docs",
      "schemas",
      "templates",
      "package.json",
      "lazurio.module.json",
      "bun.lock",
      "scripts",
      "src",
      "test-support",
      ...(existsSync(join(root, "app")) ? ["app"] : []),
    ]) {
      cpSync(join(root, entry), join(tempRoot, entry), {
        recursive: true,
        filter: shouldCopyFixturePath,
      });
    }
    mutator?.(tempRoot);
    return validateTemplate(tempRoot);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function runOrganizationDataValidator(
  mutator,
  {
    initializeGit = true,
    initialCommit = initializeGit,
    allowUnbornBootstrap = false,
    pinnedAppCode = true,
    prepareAppCode = null,
  } = {},
) {
  const tempRoot = join(root, ".cache", `mission-control-data-test-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const dataRoot = join(tempRoot, "organization-data");
  mkdirSync(tempRoot, { recursive: true });
  try {
    let appCodeRoot = root;
    let appCodeFixture = {};
    if (prepareAppCode !== null) {
      appCodeRoot = join(tempRoot, "app-code");
      const cloneResult = spawnSync(
        "git",
        ["clone", "-q", "--no-local", root, appCodeRoot],
        { encoding: "utf8" },
      );
      if (cloneResult.status !== 0) {
        throw new Error(
          `Test app-code clone failed: ${cloneResult.stderr}`,
        );
      }
      appCodeFixture = prepareAppCode(appCodeRoot) ?? {};
    }
    cpSync(join(root, "templates/organization-data"), dataRoot, { recursive: true });
    if (initializeGit) {
      const initResult = spawnSync("git", ["init", "-q"], { cwd: dataRoot });
      if (initResult.status !== 0) throw new Error("Test fixture Git initialization failed");
      const addResult = spawnSync("git", ["add", "."], { cwd: dataRoot });
      if (addResult.status !== 0) throw new Error("Test fixture Git staging failed");
      if (initialCommit) {
        commitFixture(dataRoot, "initialize reusable data fixture");
      }
    }
    mutator?.(dataRoot, { appCodeRoot, ...appCodeFixture });
    const args = [
      pinnedAppCode
        ? join(appCodeRoot, pinnedValidatorPath)
        : "scripts/validate-mission-control-data.mjs",
    ];
    if (pinnedAppCode) args.push("--pinned-app-code");
    if (allowUnbornBootstrap) args.push("--allow-unborn-bootstrap");
    const env = { ...process.env };
    if (pinnedAppCode) {
      for (const key of Object.keys(env)) {
        if (
          [
            "SSH_AUTH_SOCK",
            "SSH_AGENT_PID",
            "GPG_AGENT_INFO",
            "GNUPGHOME",
            "NODE_OPTIONS",
            "NODE_PATH",
            "BUN_OPTIONS",
            "LD_PRELOAD",
            "DYLD_INSERT_LIBRARIES",
            "DYLD_LIBRARY_PATH",
            "GIT_ASKPASS",
            "SSH_ASKPASS",
          ].includes(key.toUpperCase()) ||
          key.toUpperCase() === "GIT_CONFIG_COUNT" ||
          /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(key.toUpperCase())
        ) {
          delete env[key];
        }
      }
    }
    return spawnSync(process.execPath, args, {
      cwd: dataRoot,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function installCurrentPinnedValidatorManifest(appCodeRoot) {
  const git = (args) => {
    const result = spawnSync("git", args, {
      cwd: appCodeRoot,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const manifestIntroductions = git([
    "log",
    "--format=%H",
    "--first-parent",
    "--diff-filter=A",
    "HEAD",
    "--",
    pinnedValidatorPathManifest,
  ])
    .split(/\r?\n/)
    .filter(Boolean);
  assert.ok(
    manifestIntroductions.length <= 1,
    "Fixture app-code history must have at most one manifest introduction",
  );
  let preManifestCommit;
  if (manifestIntroductions.length === 1) {
    const introduction = manifestIntroductions[0];
    const introductionAncestry = git([
      "rev-list",
      "--parents",
      "-n",
      "1",
      introduction,
    ]).split(/\s+/);
    const firstParent = introductionAncestry[1];
    const firstParentHasValidator =
      firstParent !== undefined &&
      spawnSync("git", ["cat-file", "-e", `${firstParent}:${pinnedValidatorPath}`], {
        cwd: appCodeRoot,
      }).status === 0;
    if (firstParentHasValidator) {
      preManifestCommit = firstParent;
    } else {
      // The manifest arrived with the whole template, not after the validator:
      // a repository created through GitHub's template mechanism starts a new
      // root history whose initial tree already contains it, and an
      // Organization fork that integrated a release with
      // --allow-unrelated-histories (decision 0174) gets it in a merge whose
      // first parent is its own older, unrelated history. Either way, build an
      // isolated pre-manifest root from the introducing tree for the
      // historical compatibility tests; never assume that the commit that
      // introduced the manifest has a parent with the validator.
      git(["checkout", "-q", "--detach", introduction]);
      git(["rm", "-q", "--", pinnedValidatorPathManifest]);
      const tree = git(["write-tree"]);
      preManifestCommit = git([
        "-c",
        "user.name=Mission Control Validator Test",
        "-c",
        "user.email=validator@example.invalid",
        "commit-tree",
        tree,
        "-m",
        "Isolated pre-manifest application root",
      ]);
    }
  } else {
    preManifestCommit = git(["rev-parse", "HEAD"]);
  }
  git(["checkout", "-q", "--detach", preManifestCommit]);
  const applicationCommit = git(["rev-parse", "HEAD"]);
  const applicationTree = git(["rev-parse", "HEAD^{tree}"]);
  const applicationValidatorDigest = gitBlobDigest(
    appCodeRoot,
    applicationCommit,
    pinnedValidatorPath,
  );
  const applicationReadmeDigest = gitBlobDigest(
    appCodeRoot,
    applicationCommit,
    "README.md",
  );
  writeFileSync(
    join(appCodeRoot, pinnedValidatorPath),
    readFileSync(join(root, pinnedValidatorPath)),
  );
  mkdirSync(dirname(join(appCodeRoot, pinnedValidatorPathManifest)), {
    recursive: true,
  });
  writeFileSync(
    join(appCodeRoot, pinnedValidatorPathManifest),
    readFileSync(join(root, pinnedValidatorPathManifest)),
  );
  const add = spawnSync(
    "git",
    ["add", pinnedValidatorPath, pinnedValidatorPathManifest],
    { cwd: appCodeRoot, encoding: "utf8" },
  );
  assert.equal(add.status, 0, add.stderr);
  const commit = spawnSync(
    "git",
    [
      "-c",
      "user.name=Mission Control Validator Test",
      "-c",
      "user.email=validator@example.invalid",
      "commit",
      "-q",
      "-m",
      "Introduce the pinned validator path manifest",
    ],
    { cwd: appCodeRoot, encoding: "utf8" },
  );
  assert.equal(commit.status, 0, commit.stderr);
  return {
    preManifestApplication: {
      repository: "ExampleOrganization/mission-control",
      commit: applicationCommit,
      validator_path: pinnedValidatorPath,
      validator_digest_sha256: applicationValidatorDigest,
      control_plane_tree_sha: applicationTree,
    },
    preManifestReadmeApplication: {
      repository: "ExampleOrganization/mission-control",
      commit: applicationCommit,
      validator_path: "README.md",
      validator_digest_sha256: applicationReadmeDigest,
      control_plane_tree_sha: applicationTree,
    },
  };
}

function repositoryDbConfigPath(tempRoot) {
  return join(tempRoot, "templates/organization-data/repository-db.yaml");
}

function missionControlConfigPath(tempRoot) {
  return join(tempRoot, "templates/organization-data/data/mission-control/mission-control.config.json");
}

function packageJsonPath(tempRoot) {
  return join(tempRoot, "package.json");
}

function configureOrganizationRuntime(tempRoot, {
  slug = "Example-Org",
  displayName = "Example Organization",
  port = 5733,
} = {}) {
  const packageSlug = slug.toLowerCase();
  const packagePath = packageJsonPath(tempRoot);
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  packageJson.name = `${packageSlug}-mission-control`;
  packageJson.companyascode.mission_control.mode = "organization";
  packageJson.companyascode.mission_control.organization = {
    slug,
    display_name: displayName,
  };
  writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  rewriteBunLockWorkspaceName(tempRoot, "bun.lock", packageJson.name);

  const modulePath = join(tempRoot, "lazurio.module.json");
  const moduleManifest = JSON.parse(readFileSync(modulePath, "utf8"));
  moduleManifest.company = slug;
  moduleManifest.port_leases[0].port = port;
  writeFileSync(modulePath, `${JSON.stringify(moduleManifest, null, 2)}\n`);

  const appPath = join(tempRoot, "app/v3/package.json");
  const appPackage = JSON.parse(readFileSync(appPath, "utf8"));
  appPackage.name = `@${packageSlug}/mission-control-v3`;
  // The instance overlay declares the identity; keep the fixture consistent
  // with the synthetic Organization so a fork's real name is never scanned
  // as foreign live data inside these fixtures.
  writeFileSync(
    join(tempRoot, "app/v3/src/instance/brand.ts"),
    `export const missionControlBrand = {\n\torganization: '${displayName.replaceAll("'", "\\'")}',\n} as const;\n`,
  );
  appPackage.lazurio.runtime.id = `${packageSlug}-mission-control-v3`;
  appPackage.lazurio.runtime.company = slug;
  writeFileSync(appPath, `${JSON.stringify(appPackage, null, 2)}\n`);
  rewriteBunLockWorkspaceName(tempRoot, "app/v3/bun.lock", appPackage.name);
}

function removeTemplateOnlyDistributionFiles(tempRoot) {
  for (const path of [
    "LICENSE",
    "NOTICE.md",
    "CONTRIBUTING.md",
    "docs/v3-module-documentation-standard.md",
    "templates/launchpad-app",
  ]) {
    rmSync(join(tempRoot, path), { recursive: true, force: true });
  }
}

function rewriteBunLockWorkspaceName(tempRoot, lockPath, name) {
  const absolutePath = join(tempRoot, lockPath);
  const text = readFileSync(absolutePath, "utf8").replace(
    /("workspaces"\s*:\s*\{\s*""\s*:\s*\{\s*"name"\s*:\s*)"[^"]+"/,
    `$1"${name}"`,
  );
  writeFileSync(absolutePath, text);
}

function useLegacyCapabilityWriter(config) {
  config.publish_policy.writer_mode = "authenticated-capability-v1";
  delete config.publish_policy.local_principal;
  // The reusable template now defaults to the member phase; legacy capability
  // fixtures keep the historical admin/steward approval lane.
  config.publish_policy.approval_roles = ["admin", "steward"];
  config.publish_policy.credential_authority = {
    required: true,
    allowed_writer_ids: ["organization-scoped-data-writer"],
    custody: "admin-or-steward",
    path_allowlist: ["data/mission-control/**"],
    branch: "v3",
  };
}

function instantiateOrganizationData(dataRoot, planPrefix) {
  const configPath = join(dataRoot, "data/mission-control/mission-control.config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.organization_admin = "organization-steward";
  config.plan_prefix = planPrefix;
  // The broad historical validator suite proves the retained capability mode.
  // The reusable template itself now defaults to local-principal-v1, so legacy
  // fixtures must opt in explicitly instead of silently depending on it.
  useLegacyCapabilityWriter(config);
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const repositoryDbPath = join(dataRoot, "repository-db.yaml");
  const repositoryDbConfig = parseYaml(readFileSync(repositoryDbPath, "utf8"));
  repositoryDbConfig.data_repo.remote =
    "git@github.com:ExampleOrganization/mission-control-data.git";
  writeFileSync(repositoryDbPath, stringifyYaml(repositoryDbConfig));
}

function instantiateNativeOrganizationData(dataRoot, planPrefix) {
  const configPath = join(dataRoot, "data/mission-control/mission-control.config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.organization_admin = "organization-steward";
  config.plan_prefix = planPrefix;
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const repositoryDbPath = join(dataRoot, "repository-db.yaml");
  const repositoryDbConfig = parseYaml(readFileSync(repositoryDbPath, "utf8"));
  repositoryDbConfig.data_repo.remote =
    "git@github.com:ExampleOrganization/mission-control-data.git";
  writeFileSync(repositoryDbPath, stringifyYaml(repositoryDbConfig));
}

const FIXTURE_GIT_IDENTITY_ARGS = [
  "-c",
  "user.name=Mission Control Validator Test",
  "-c",
  "user.email=validator@example.invalid",
];

function commitFixture(dataRoot, message) {
  const add = spawnSync("git", ["add", "."], { cwd: dataRoot });
  if (add.status !== 0) {
    throw new Error(`Test fixture Git staging failed: ${add.stderr}`);
  }
  const commit = spawnSync(
    "git",
    [...FIXTURE_GIT_IDENTITY_ARGS, "commit", "-q", "-m", message],
    { cwd: dataRoot, encoding: "utf8" },
  );
  if (commit.status !== 0) {
    throw new Error(`Test fixture Git commit failed: ${commit.stderr}`);
  }
}

function writerAuditEvidence({
  principalId,
  principalRole,
} = {}) {
  return {
    schema_version: "companiesascode.mission_control.writer_audit.v1",
    authorization_id: "admin-approved-writer",
    authorization_source: {
      repository: "ExampleOrganization/infra",
      commit: "a".repeat(40),
      path: "access/mission-control-runtime-authorization.json",
      blob: "b".repeat(40),
      approved_by: "organization-admin",
      authorization_not_before: "2026-07-19T09:00:00.000Z",
      expires_at: "2026-07-19T11:00:00.000Z",
      approved_at: "2026-07-19T08:30:00.000Z",
      approval_reference: "infra-pr-1",
      issue_id: "issue-provider-protection",
      issue_digest_sha256: "1".repeat(64),
      authorized_data_base_commit: "2".repeat(40),
      roster: [
        "organization-admin",
        "organization-steward",
        "organization-user",
      ],
    },
    transaction: {
      id: "writer-transaction-example",
      starting_data_commit: "3".repeat(40),
      starting_data_tree: "4".repeat(40),
      captured_at: "2026-07-19T09:59:00.000Z",
      capture_evidence_digest_sha256: "5".repeat(64),
      request_digest_sha256: "6".repeat(64),
    },
    principal: {
      id: principalId,
      role: principalRole,
    },
    scope: {
      data_repository: "ExampleOrganization/mission-control-data",
      data_branch: "v3",
      path_allowlist: ["data/mission-control/**"],
      writer_id: "organization-scoped-data-writer",
    },
    credential: {
      provider: "github",
      provider_object_id: 12345,
      provider_title: "organization-scoped-data-writer-12345",
      public_fingerprint_sha256: `SHA256:${"A".repeat(43)}`,
      custody_role: "steward",
      custodian: "organization-steward",
      staged_at: "2026-07-19T08:00:00.000Z",
      staging_deadline: "2026-07-19T12:00:00.000Z",
    },
    application: currentPinnedApplicationEvidence(),
    runtime: {
      os_identity: "mission-control-runtime",
      os_identity_evidence: "dedicated-os-account",
      git_config_allowlist_version: "mission-control-runtime-git-config.v1",
      git_local_config_digest_sha256: "f".repeat(64),
      activation_receipt_digest_sha256: "0".repeat(64),
    },
  };
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

function localPrincipalPublishedChangeset({
  id,
  baseCommit,
  operations,
}) {
  const requestedAt = "2026-07-23T09:00:00.000Z";
  const principal = "github:fixture-principal";
  const summary = "Local Principal validator evidence";
  const draftRevision = jsonDigest({
    schema_version:
      "companiesascode.mission_control.local_draft.v1",
    id,
    base_commit: baseCommit,
    summary,
    operations,
  });
  return {
    schema_version:
      "companiesascode.mission_control.changeset.v1",
    id,
    status: "published",
    summary,
    created_at: requestedAt,
    created_by: principal,
    operations,
    approval: {
      approved_by: principal,
      role: "provider-authorized",
      approved_at: requestedAt,
      comment: "Validated local Principal publish.",
    },
    published_at: requestedAt,
    published_by: principal,
    local_publish: {
      schema_version:
        "companiesascode.mission_control.local_publish.v1",
      writer_mode: "local-principal-v1",
      requested_at: requestedAt,
      base_commit: baseCommit,
      changed_paths: operations
        .map((operation) => operation.path)
        .sort(),
      draft_revision: draftRevision,
      validation_contract:
        "mission-control-data-validator.v1",
      principal_id: principal,
      actor_id: principal,
      provider_access_audit: {
        checked_at: requestedAt,
        checked_by: "organization-admin",
      },
    },
  };
}

function immutableChangesetPayload(changeset) {
  return {
    schema_version: changeset.schema_version,
    id: changeset.id,
    summary: changeset.summary,
    created_at: changeset.created_at,
    created_by: changeset.created_by,
    operations: changeset.operations,
  };
}

function writerAuditProvenance({
  changeset,
  phase,
  evidence,
  recordedAt,
  mode = "authenticated",
}) {
  return {
    schema_version:
      "companiesascode.mission_control.writer_provenance.v1",
    mode,
    changeset_id: changeset.id,
    first_authenticated_phase: phase,
    authorization_id: evidence.authorization_id,
    authorization_source_commit: evidence.authorization_source.commit,
    authorization_source_blob: evidence.authorization_source.blob,
    first_authorization_digest_sha256: jsonDigest(evidence),
    changeset_payload_digest_sha256: jsonDigest(
      immutableChangesetPayload(changeset),
    ),
    recorded_at: recordedAt,
  };
}

function authenticatedPublishedChangeset() {
  const creationAuthorization = writerAuditEvidence({
    principalId: "organization-user",
    principalRole: "user",
  });
  const stewardAuthorization = writerAuditEvidence({
    principalId: "organization-steward",
    principalRole: "steward",
  });
  const changeset = {
    schema_version: "companiesascode.mission_control.changeset.v1",
    id: "authenticated-publication",
    status: "published",
    summary: "Authenticated publication",
    created_at: "2026-07-19T10:00:00.000Z",
    created_by: "organization-user",
    creation_authorization: creationAuthorization,
    operations: [
      {
        action: "write_file",
        path: "data/mission-control/reports/authenticated-publication.txt",
        content: "published\n",
      },
    ],
    approval: {
      approved_by: "organization-steward",
      role: "steward",
      approved_at: "2026-07-19T10:05:00.000Z",
      comment: "",
      runtime_authorization: stewardAuthorization,
    },
    published_at: "2026-07-19T10:10:00.000Z",
    published_by: "organization-steward",
    credential_authority: {
      writer_id: "organization-scoped-data-writer",
      custody_role: "steward",
      branch: "v3",
      path_allowlist: ["data/mission-control/**"],
    },
    runtime_authorization: stewardAuthorization,
  };
  changeset.writer_audit_provenance = writerAuditProvenance({
    changeset,
    phase: "creation",
    evidence: creationAuthorization,
    recordedAt: changeset.created_at,
  });
  return changeset;
}

function attachAuthenticatedLifecycle(changeset) {
  const creationAuthorization = writerAuditEvidence({
    principalId: changeset.created_by,
    principalRole: "user",
  });
  changeset.creation_authorization = creationAuthorization;

  if (changeset.approval) {
    changeset.approval.runtime_authorization = writerAuditEvidence({
      principalId: changeset.approval.approved_by,
      principalRole: changeset.approval.role,
    });
  }
  if (changeset.status === "published") {
    const publicationAuthorization = writerAuditEvidence({
      principalId: changeset.published_by,
      principalRole: changeset.credential_authority.custody_role,
    });
    publicationAuthorization.scope.writer_id =
      changeset.credential_authority.writer_id;
    publicationAuthorization.scope.data_branch =
      changeset.credential_authority.branch;
    publicationAuthorization.scope.path_allowlist = [
      ...changeset.credential_authority.path_allowlist,
    ];
    publicationAuthorization.credential.custody_role =
      changeset.credential_authority.custody_role;
    publicationAuthorization.credential.custodian =
      changeset.published_by;
    changeset.runtime_authorization = publicationAuthorization;
  }
  if (changeset.status === "superseded") {
    changeset.supersession.runtime_authorization = writerAuditEvidence({
      principalId: changeset.supersession.superseded_by,
      principalRole: changeset.supersession.role,
    });
  }
  changeset.writer_audit_provenance = writerAuditProvenance({
    changeset,
    phase: "creation",
    evidence: creationAuthorization,
    recordedAt: changeset.created_at,
  });
  return changeset;
}

function preManifestDomainScopedSupersededChangeset(preManifestApplication) {
  const changeset = authenticatedPublishedChangeset();
  changeset.status = "superseded";
  delete changeset.published_at;
  delete changeset.published_by;
  delete changeset.credential_authority;
  delete changeset.runtime_authorization;
  changeset.creation_authorization.application = {
    ...preManifestApplication,
  };
  changeset.approval.runtime_authorization.application = {
    ...preManifestApplication,
  };
  const supersessionAuthorization = writerAuditEvidence({
    principalId: "organization-steward",
    principalRole: "steward",
  });
  supersessionAuthorization.application = { ...preManifestApplication };
  supersessionAuthorization.scope.path_allowlist = [
    changeset.operations[0].path,
  ];
  changeset.supersession = {
    superseded_at: "2026-07-19T10:10:00.000Z",
    superseded_by: "organization-steward",
    role: "steward",
    reason: "Neměnný supersession z doby před audit-path pravidlem.",
    replacement_changeset_id: null,
    runtime_authorization: supersessionAuthorization,
  };
  changeset.writer_audit_provenance.first_authorization_digest_sha256 =
    jsonDigest(changeset.creation_authorization);
  return changeset;
}

function rewritePlanPrefix(dataRoot, fromPrefix, toPrefix) {
  const plansRoot = join(dataRoot, "data/mission-control/plans");
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const sourcePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(sourcePath);
        continue;
      }
      const match = new RegExp(`^${fromPrefix}-([0-9]{4})(.*\\.ya?ml)$`, "i").exec(entry.name);
      if (!entry.isFile() || !match) continue;
      const [, number, suffix] = match;
      const targetPath = join(directory, `${toPrefix}-${number}${suffix}`);
      const text = readFileSync(sourcePath, "utf8")
        .replace(`id: mcplan-${fromPrefix.toLowerCase()}-${number}`, `id: mcplan-${toPrefix.toLowerCase()}-${number}`)
        .replaceAll(`${fromPrefix}-${number}`, `${toPrefix}-${number}`);
      writeFileSync(sourcePath, text);
      renameSync(sourcePath, targetPath);
    }
  };
  visit(plansRoot);
}

function rewriteRoadmapPlanPrefix(dataRoot, fromPrefix, toPrefix) {
  const roadmapsRoot = join(dataRoot, "data/mission-control/roadmaps");
  const replacePlanCode = (value) =>
    typeof value === "string"
      ? value.replace(new RegExp(`^${fromPrefix}-([0-9]{4})$`), `${toPrefix}-$1`)
      : value;
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const filePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(filePath);
        continue;
      }
      if (!entry.isFile() || !/\.ya?ml$/i.test(entry.name)) continue;
      const roadmap = parseYaml(readFileSync(filePath, "utf8"));
      roadmap.source_plan = replacePlanCode(roadmap.source_plan);
      if (Array.isArray(roadmap.steps)) {
        for (const step of roadmap.steps) {
          if (Array.isArray(step?.plan_refs)) {
            step.plan_refs = step.plan_refs.map(replacePlanCode);
          }
        }
      }
      writeFileSync(filePath, stringifyYaml(roadmap));
    }
  };
  visit(roadmapsRoot);
}

function mutateTemplatePlan(dataRoot, mutator) {
  const planPath = join(
    dataRoot,
    "data/mission-control/plans/2026/01/DEV-0001-template-runtime.yaml",
  );
  const plan = parseYaml(readFileSync(planPath, "utf8"));
  mutator(plan, planPath);
  writeFileSync(planPath, stringifyYaml(plan));
}

test("template repository-db config is valid for mission-control-data", () => {
  const failures = validateTemplate(root);
  assert.deepEqual(failures, []);
});

test("app and standalone data validation resolve Git from the Principal PATH", () => {
  const appLibrary = readFileSync(
    join(root, "app/v3/src/vendor/mission-control-lib.ts"),
    "utf8",
  );
  const standaloneValidator = readFileSync(
    join(root, pinnedValidatorPath),
    "utf8",
  );
  assert.match(appLibrary, /const gitExecutable = ["']git["'];/);
  assert.doesNotMatch(
    appLibrary,
    /systemGitCandidates|resolveTrustedGitExecutable/,
  );
  assert.match(
    standaloneValidator,
    /const trustedGitExecutable = "git";/,
  );
});

test("active writer docs cannot regress to the provider-audit gate", () => {
  const failures = withTempTemplate((tempRoot) => {
    const rolloutPath = join(
      tempRoot,
      "docs/mission-control-v3-rollout-manual.md",
    );
    const rollout = readFileSync(rolloutPath, "utf8").replace(
      "GitHub identita a repository grants",
      "GitHub identita a repository grants\n\nprovider_access_audit_required",
    );
    writeFileSync(rolloutPath, rollout);
  });
  assert.ok(
    failures.some((failure) =>
      failure.includes("contains superseded writer gate: provider_access_audit_required"),
    ),
  );
});

test("active writer docs preserve progressive GitHub enforcement", () => {
  const failures = withTempTemplate((tempRoot) => {
    const rolloutPath = join(
      tempRoot,
      "docs/mission-control-v3-rollout-manual.md",
    );
    const rollout = readFileSync(rolloutPath, "utf8").replaceAll(
      "provider-enforced",
      "provider-rule-later",
    );
    writeFileSync(rolloutPath, rollout);
  });
  assert.ok(
    failures.includes(
      "docs/mission-control-v3-rollout-manual.md: must declare progressive enforcement phrase provider-enforced",
    ),
  );
});

test("Bun lockfile workspace identities match their package names", () => {
  for (const {
    lockPath,
    expectedPrefix,
    expectedPackagePath,
  } of [
    {
      lockPath: "bun.lock",
      expectedPrefix: "bun.lock: ",
      expectedPackagePath: "package.json",
    },
    {
      lockPath: "app/v3/bun.lock",
      expectedPrefix: "app/v3/bun.lock: ",
      expectedPackagePath: "app/v3/package.json",
    },
  ]) {
    const failures = withTempTemplate((tempRoot) => {
      const absolutePath = join(tempRoot, lockPath);
      const text = readFileSync(absolutePath, "utf8").replace(
        /("workspaces"\s*:\s*\{\s*""\s*:\s*\{\s*"name"\s*:\s*)"[^"]+"/,
        '$1"wrong-workspace-name"',
      );
      writeFileSync(absolutePath, text);
    });
    assert.ok(
      failures.some(
        (failure) =>
          failure.startsWith(expectedPrefix) &&
          failure.includes(`must match ${expectedPackagePath} name`),
      ),
      failures.join("\n"),
    );
  }
});

test("template scan ignores the documented .worktrees directory", () => {
  const failures = withTempTemplate((tempRoot) => {
    const worktreeFixture = join(
      tempRoot,
      ".worktrees/fixture/private-context.md",
    );
    mkdirSync(join(tempRoot, ".worktrees/fixture"), { recursive: true });
    writeFileSync(worktreeFixture, "Northwind\nBEGIN PRIVATE KEY\n");
  });
  assert.deepEqual(failures, []);
});

test("repository-db config must use the upstream repository-db.config.v1 contract", () => {
  const failures = withTempTemplate((tempRoot) => {
    const configPath = repositoryDbConfigPath(tempRoot);
    const text = readFileSync(configPath, "utf8")
      .replace("schema_version: repository-db.config.v1", "schema_version: companiesascode.repository_db.config.v1")
      .replace("app: mission-control", "app: mission-control\napp_id: mission-control");
    writeFileSync(configPath, text);
  });
  assert.ok(failures.some((failure) => failure.includes("schema_version must be repository-db.config.v1")), failures.join("\n"));
  assert.ok(failures.some((failure) => failure.includes("legacy key app_id")), failures.join("\n"));
});

test("repository-db config must declare a mission-control-data git remote", () => {
  const failures = withTempTemplate((tempRoot) => {
    const configPath = repositoryDbConfigPath(tempRoot);
    const text = readFileSync(configPath, "utf8").replace("REPLACE_WITH_ORG/mission-control-data.git", "REPLACE_WITH_ORG/generic-data.git");
    writeFileSync(configPath, text);
  });
  assert.ok(failures.some((failure) => failure.includes("data_repo.remote") && failure.includes("mission-control-data")), failures.join("\n"));
});

test("repository-db remote must be credential-free and network-owned", () => {
  for (const remote of [
    "https://user:token@git.example.invalid/ExampleOrganization/mission-control-data.git",
    "file:///tmp/ExampleOrganization/mission-control-data.git",
    "../ExampleOrganization/mission-control-data.git",
    "ext::sh -c evil/mission-control-data.git",
    "http://git.example.invalid/ExampleOrganization/mission-control-data.git",
  ]) {
    const failures = withTempTemplate((tempRoot) => {
      const configPath = repositoryDbConfigPath(tempRoot);
      const config = parseYaml(readFileSync(configPath, "utf8"));
      config.data_repo.remote = remote;
      writeFileSync(configPath, stringifyYaml(config));
    });
    assert.ok(
      failures.some(
        (failure) =>
          failure.includes("data_repo.remote") && failure.includes("credential-free"),
      ),
      `${remote}\n${failures.join("\n")}`,
    );
  }
});

test("pinned validator path manifest has an exact canonical contract", () => {
  for (const manifest of [
    {
      schema_version:
        "companiesascode.mission_control.pinned_validator_paths.v1",
      trusted_validator_paths: ["README.md"],
    },
    {
      schema_version:
        "companiesascode.mission_control.pinned_validator_paths.v1",
      trusted_validator_paths: [
        "templates/organization-data/scripts/unrelated-validator.mjs",
      ],
    },
    {
      schema_version:
        "companiesascode.mission_control.pinned_validator_paths.v1",
      trusted_validator_paths: [pinnedValidatorPath],
      unexpected: true,
    },
  ]) {
    const failures = withTempTemplate((tempRoot) => {
      writeFileSync(
        join(tempRoot, pinnedValidatorPathManifest),
        `${JSON.stringify(manifest, null, 2)}\n`,
      );
    });
    assert.ok(
      failures.some((failure) =>
        failure.startsWith(`${pinnedValidatorPathManifest}:`),
      ),
      failures.join("\n"),
    );
  }
});

test("repository-db layout must use safe data/generated/scripts directories", () => {
  const failures = withTempTemplate((tempRoot) => {
    const configPath = repositoryDbConfigPath(tempRoot);
    const text = readFileSync(configPath, "utf8").replace("  data: data", "  data: ../data");
    writeFileSync(configPath, text);
  });
  assert.ok(failures.some((failure) => failure.includes("layout.data") && failure.includes("data")), failures.join("\n"));
});

test("repository-db generated manifest paths must stay portable", () => {
  const invalidPaths = [
    "C:/outside",
    "C:outside",
    "C:\\outside",
    "\\\\server\\share\\outside",
    "generated\\file.txt",
    "generated/file.txt:stream",
    "generated/./file.txt",
    "generated/file?.txt",
    "generated/file\".txt",
    "generated/file<part>.txt",
    "generated/file|part.txt",
    "generated/\u0001file.txt",
    "generated/file.",
    "generated/file ",
    "generated/CON.txt",
    "../outside",
    "/outside",
  ];
  const failures = withTempTemplate((tempRoot) => {
    const configPath = repositoryDbConfigPath(tempRoot);
    const config = parseYaml(readFileSync(configPath, "utf8"));
    config.generated_manifest = invalidPaths.map((path) => ({ path }));
    writeFileSync(configPath, stringifyYaml(config));
  });
  assert.equal(
    failures.filter((failure) =>
      /generated_manifest\[[0-9]+\]\.path must be repo-relative/.test(failure),
    ).length,
    invalidPaths.length,
    failures.join("\n"),
  );
});

test("repository-db scaffold must include generated and scripts directories", () => {
  const failures = withTempTemplate((tempRoot) => {
    rmSync(join(tempRoot, "templates/organization-data/generated"), { recursive: true, force: true });
    rmSync(join(tempRoot, "templates/organization-data/scripts"), { recursive: true, force: true });
  });
  assert.ok(failures.some((failure) => failure.includes("missing required directory: templates/organization-data/generated")), failures.join("\n"));
  assert.ok(failures.some((failure) => failure.includes("missing required directory: templates/organization-data/scripts")), failures.join("\n"));
});

test("native writer changeset sentinels stay byte-empty across Windows checkouts", () => {
  for (const phase of ["pending", "published", "superseded"]) {
    const sentinel = readFileSync(
      join(
        root,
        "templates/organization-data/data/mission-control/changesets",
        phase,
        ".gitkeep",
      ),
    );
    assert.equal(
      sentinel.byteLength,
      0,
      `${phase}/.gitkeep must remain byte-empty so checkout line-ending rules cannot create false writer-history drift`,
    );
  }
});

test("Organization data scaffold keeps portable agent write guardrails", () => {
  const missingFailures = withTempTemplate((tempRoot) => {
    rmSync(join(tempRoot, "templates/organization-data/AGENTS.md"), { force: true });
  });
  assert.ok(
    missingFailures.some(
      (failure) =>
        failure.includes("missing required file: templates/organization-data/AGENTS.md"),
    ),
    missingFailures.join("\n"),
  );

  const driftFailures = withTempTemplate((tempRoot) => {
    writeFileSync(
      join(tempRoot, "templates/organization-data/AGENTS.md"),
      "# Incomplete data instructions\n",
    );
  });
  assert.ok(
    driftFailures.some(
      (failure) =>
        failure.includes("templates/organization-data/AGENTS.md") &&
        failure.includes("GitHub je jediná autorita přístupu"),
    ),
    driftFailures.join("\n"),
  );
});

test("Organization data validator requires its standalone AGENTS instructions", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    rmSync(join(dataRoot, "AGENTS.md"), { force: true });
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /missing AGENTS\.md/);
});

test("repository-db validate command must point at the bundled data validator", () => {
  const failures = withTempTemplate((tempRoot) => {
    const configPath = repositoryDbConfigPath(tempRoot);
    const text = readFileSync(configPath, "utf8").replace("node scripts/validate-mission-control-data.mjs", "node scripts/missing.mjs");
    writeFileSync(configPath, text);
  });
  assert.ok(failures.some((failure) => failure.includes("validate must include node scripts/validate-mission-control-data.mjs")), failures.join("\n"));
});

test("mission-control config paths must match repository-db data layout", () => {
  const failures = withTempTemplate((tempRoot) => {
    const configPath = missionControlConfigPath(tempRoot);
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.plans_dir = "mission-control/plans";
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  });
  assert.ok(failures.some((failure) => failure.includes("plans_dir") && failure.includes("data/mission-control/plans")), failures.join("\n"));
});

test("Organization data validator keeps every Mission Control path canonical", () => {
  const invalidPaths = {
    repository_db_config_path: "data/mission-control/repository-db.yaml",
    plans_dir: "data/mission-control",
    roadmaps_dir: "data/mission-control",
    reports_dir: "data/mission-control",
    import_reviews_dir: "data/mission-control",
    issues_open_path: "data/mission-control/custom-issues.json",
    issues_resolved_path: "data/mission-control/custom-resolved.json",
    todo_tasks_path: "data/mission-control/custom-todo.json",
    done_tasks_path: "data/mission-control/custom-done.json",
    schema_path: "data/mission-control/custom-plan-schema.json",
    roadmap_schema_path: "data/mission-control/custom-roadmap-schema.json",
  };
  for (const [field, invalidValue] of Object.entries(invalidPaths)) {
    const result = runOrganizationDataValidator((dataRoot) => {
      instantiateOrganizationData(dataRoot, "DEV");
      const configPath = join(dataRoot, "data/mission-control/mission-control.config.json");
      const config = JSON.parse(readFileSync(configPath, "utf8"));
      config[field] = invalidValue;
      writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, new RegExp(`${field} must be`));
  }
});

test("Organization data validator preserves canonical task-ledger invariants", () => {
  const configureInvariants = (dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const configPath = join(
      dataRoot,
      "data/mission-control/mission-control.config.json",
    );
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.validation = {
      invariants_enforced: true,
      canonical_plan_paths_required: true,
      materialized_plan_task_parity_required: true,
    };
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  };

  const valid = runOrganizationDataValidator(configureInvariants);
  assert.equal(valid.status, 0, `${valid.stdout}\n${valid.stderr}`);

  const tagSuperset = runOrganizationDataValidator((dataRoot) => {
    configureInvariants(dataRoot);
    const todoPath = join(dataRoot, "data/mission-control/TODO.tasks.json");
    const todo = JSON.parse(readFileSync(todoPath, "utf8"));
    todo[0].tags.push("exporter-generated-tag");
    writeFileSync(todoPath, `${JSON.stringify(todo, null, 2)}\n`);
  });
  assert.equal(tagSuperset.status, 0, `${tagSuperset.stdout}\n${tagSuperset.stderr}`);

  const missingBlueprintTag = runOrganizationDataValidator((dataRoot) => {
    configureInvariants(dataRoot);
    const todoPath = join(dataRoot, "data/mission-control/TODO.tasks.json");
    const todo = JSON.parse(readFileSync(todoPath, "utf8"));
    todo[0].tags = todo[0].tags.filter((tag) => tag !== "mission-control-template");
    writeFileSync(todoPath, `${JSON.stringify(todo, null, 2)}\n`);
  });
  assert.notEqual(missingBlueprintTag.status, 0);
  assert.match(
    `${missingBlueprintTag.stdout}\n${missingBlueprintTag.stderr}`,
    /plan\/TODO parity drift in tags/,
  );

  const missingProvenance = runOrganizationDataValidator((dataRoot) => {
    configureInvariants(dataRoot);
    const todoPath = join(dataRoot, "data/mission-control/TODO.tasks.json");
    const todo = JSON.parse(readFileSync(todoPath, "utf8"));
    delete todo[0].planning;
    writeFileSync(todoPath, `${JSON.stringify(todo, null, 2)}\n`);
  });
  assert.notEqual(missingProvenance.status, 0);
  assert.match(
    `${missingProvenance.stdout}\n${missingProvenance.stderr}`,
    /materialized plan task must keep mission-control planning provenance/,
  );

  const result = runOrganizationDataValidator((dataRoot) => {
    configureInvariants(dataRoot);

    const todoPath = join(dataRoot, "data/mission-control/TODO.tasks.json");
    const todo = JSON.parse(readFileSync(todoPath, "utf8"));
    todo[0].blocked_by = ["task-missing-blocker"];
    todo[0].planning.path = "plans/not-canonical.yaml";
    writeFileSync(todoPath, `${JSON.stringify(todo, null, 2)}\n`);
    const duplicate = structuredClone(todo[0]);
    duplicate.summary = "Injected parity drift";
    writeFileSync(
      join(dataRoot, "data/mission-control/DONE.tasks.json"),
      `${JSON.stringify([duplicate], null, 2)}\n`,
    );
  });

  assert.notEqual(result.status, 0);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, /duplicate task id task-2026-01-01-001/);
  assert.match(output, /blocked_by target does not exist: task-missing-blocker/);
  assert.match(output, /planning\.path must use data\/mission-control\/plans/);
  assert.match(output, /plan\/TODO parity drift in summary/);
});

test("Organization data validator validates repository-db control-plane config", () => {
  const valid = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const repositoryDbPath = join(dataRoot, "repository-db.yaml");
    const repositoryDbConfig = parseYaml(readFileSync(repositoryDbPath, "utf8"));
    repositoryDbConfig.data_repo.remote =
      "ssh://git@git.example.invalid/ExampleOrganization/mission-control-data.git";
    writeFileSync(repositoryDbPath, stringifyYaml(repositoryDbConfig));
  });
  assert.equal(valid.status, 0, `${valid.stdout}\n${valid.stderr}`);

  const cases = [
    {
      label: "malformed YAML",
      mutate: (_config, repositoryDbPath) =>
        writeFileSync(repositoryDbPath, "schema_version: [unterminated\n"),
      pattern: /repository-db\.yaml: invalid YAML/,
    },
    {
      label: "wrong schema",
      mutate: (config) => {
        config.schema_version = "repository-db.config.evil";
      },
      pattern: /schema_version must be repository-db\.config\.v1/,
    },
    {
      label: "wrong app",
      mutate: (config) => {
        config.app = "other";
      },
      pattern: /app must be mission-control/,
    },
    {
      label: "wrong branch",
      mutate: (config) => {
        config.data_repo.branch = "main";
      },
      pattern: /data_repo\.branch must be v3/,
    },
    {
      label: "placeholder remote",
      mutate: (config) => {
        config.data_repo.remote =
          "git@github.com:REPLACE_WITH_ORG/mission-control-data.git";
      },
      pattern: /data_repo\.remote must be a concrete credential-free Organization-owned HTTPS or SSH mission-control-data Git remote/,
    },
    {
      label: "credential-bearing HTTPS remote",
      mutate: (config) => {
        config.data_repo.remote =
          "https://user:token@git.example.invalid/ExampleOrganization/mission-control-data.git";
      },
      pattern: /data_repo\.remote must be a concrete credential-free/,
    },
    {
      label: "file remote",
      mutate: (config) => {
        config.data_repo.remote =
          "file:///tmp/ExampleOrganization/mission-control-data.git";
      },
      pattern: /data_repo\.remote must be a concrete credential-free/,
    },
    {
      label: "relative remote",
      mutate: (config) => {
        config.data_repo.remote =
          "../ExampleOrganization/mission-control-data.git";
      },
      pattern: /data_repo\.remote must be a concrete credential-free/,
    },
    {
      label: "escaping layout",
      mutate: (config) => {
        config.layout.data = "../outside";
      },
      pattern: /layout\.data must be data/,
    },
    {
      label: "missing validator command",
      mutate: (config) => {
        config.validate = [];
      },
      pattern: /validate must include node scripts\/validate-mission-control-data\.mjs/,
    },
  ];
  for (const { label, mutate, pattern } of cases) {
    const result = runOrganizationDataValidator((dataRoot) => {
      instantiateOrganizationData(dataRoot, "DEV");
      const repositoryDbPath = join(dataRoot, "repository-db.yaml");
      const repositoryDbConfig = parseYaml(readFileSync(repositoryDbPath, "utf8"));
      mutate(repositoryDbConfig, repositoryDbPath);
      if (label !== "malformed YAML") {
        writeFileSync(repositoryDbPath, stringifyYaml(repositoryDbConfig));
      }
    });
    assert.notEqual(result.status, 0, label);
    assert.match(`${result.stdout}\n${result.stderr}`, pattern, label);
  }
});

test("tracked-path Git porcelain tolerates Windows short root aliases", () => {
  const tempRoot = join(
    tmpdir(),
    `mission-control-git-porcelain-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  const runGit = (args, options = {}) =>
    spawnSync("git", args, {
      cwd: tempRoot,
      encoding: "utf8",
      stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      ...options,
    });
  try {
    mkdirSync(tempRoot, { recursive: true });
    writeFileSync(join(tempRoot, "README.md"), "tracked fixture\n");
    assert.equal(runGit(["init", "-q"]).status, 0);
    assert.equal(runGit(["add", "README.md"]).status, 0);

    const version = runGit(["--version"]);
    const repositoryRoot = runGit(["rev-parse", "--show-toplevel"]);
    const stage = runGit([
      "ls-files",
      "--cached",
      "--stage",
      "--error-unmatch",
      "-z",
      "--",
      "README.md",
    ]);
    const visibility = runGit([
      "ls-files",
      "--cached",
      "-v",
      "--error-unmatch",
      "-z",
      "--",
      "README.md",
    ]);
    const debug = runGit([
      "ls-files",
      "--debug",
      "--error-unmatch",
      "--",
      "README.md",
    ]);
    const emptyBlob = runGit(["hash-object", "--stdin"], { input: "" });
    const stageEntries = (stage.stdout ?? "").split("\0").filter(Boolean);
    const visibilityEntries = (visibility.stdout ?? "")
      .split("\0")
      .filter(Boolean);
    const stageEntry =
      stageEntries.length === 1
        ? stageEntries[0].match(/^[0-9]{6} ([0-9a-f]+) 0\t/u)
        : null;
    const repositoryStat = repositoryRoot.status === 0
      ? statSync(repositoryRoot.stdout.trim())
      : null;
    const fixtureStat = statSync(tempRoot);
    const canonicalRealPath = realpathSync.native ?? realpathSync;
    const sameFilesystemEntry = Boolean(
      repositoryStat
      && repositoryStat.dev === fixtureStat.dev
      && repositoryStat.ino !== 0
      && repositoryStat.ino === fixtureStat.ino,
    ) || (
      repositoryRoot.status === 0
      && canonicalRealPath(repositoryRoot.stdout.trim()).toLowerCase()
        === canonicalRealPath(tempRoot).toLowerCase()
    );
    const diagnostic = JSON.stringify(
      {
        platform: process.platform,
        git_version: version.stdout?.trim(),
        repository_root: repositoryRoot.stdout?.trim(),
        repository_realpath:
          repositoryRoot.status === 0
            ? realpathSync(repositoryRoot.stdout.trim())
            : null,
        fixture_realpath: realpathSync(tempRoot),
        repository_identity: repositoryStat
          ? { dev: repositoryStat.dev, ino: repositoryStat.ino }
          : null,
        fixture_identity: { dev: fixtureStat.dev, ino: fixtureStat.ino },
        stage: {
          status: stage.status,
          stdout: stage.stdout,
          stderr: stage.stderr,
        },
        visibility: {
          status: visibility.status,
          stdout: visibility.stdout,
          stderr: visibility.stderr,
        },
        debug: {
          status: debug.status,
          stdout: debug.stdout,
          stderr: debug.stderr,
        },
        empty_blob: {
          status: emptyBlob.status,
          stdout: emptyBlob.stdout,
          stderr: emptyBlob.stderr,
        },
      },
      null,
      2,
    );

    assert.equal(repositoryRoot.status, 0, diagnostic);
    assert.equal(sameFilesystemEntry, true, diagnostic);
    assert.equal(stage.status, 0, diagnostic);
    assert.ok(stageEntry, diagnostic);
    assert.equal(visibility.status, 0, diagnostic);
    assert.deepEqual(visibilityEntries, ["H README.md"], diagnostic);
    assert.equal(emptyBlob.status, 0, diagnostic);
    assert.notEqual(stageEntry[1], emptyBlob.stdout.trim(), diagnostic);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("pinned app-code validator resolves dependencies from an app/v3-only cold install", () => {
  const tempRoot = join(
    tmpdir(),
    `mission-control-validator-cold-install-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  const dataRoot = join(tempRoot, "data-repo");
  const validatorPath = join(
    tempRoot,
    "templates/organization-data/scripts/validate-mission-control-data.mjs",
  );
  try {
    cpSync(join(root, "templates/organization-data"), dataRoot, {
      recursive: true,
    });
    instantiateOrganizationData(dataRoot, "DEV");

    const rewriteYamlAsJson = (directory) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const absolutePath = join(directory, entry.name);
        if (entry.isDirectory()) {
          rewriteYamlAsJson(absolutePath);
        } else if (entry.isFile() && /\.(?:yaml|yml)$/i.test(entry.name)) {
          writeFileSync(
            absolutePath,
            `${JSON.stringify(parseYaml(readFileSync(absolutePath, "utf8")), null, 2)}\n`,
          );
        }
      }
    };
    rewriteYamlAsJson(dataRoot);
    assert.equal(spawnSync("git", ["init", "-q"], { cwd: dataRoot }).status, 0);
    assert.equal(spawnSync("git", ["add", "."], { cwd: dataRoot }).status, 0);

    mkdirSync(join(tempRoot, "templates/organization-data/scripts"), {
      recursive: true,
    });
    writeFileSync(
      validatorPath,
      readFileSync(
        join(
          root,
          "templates/organization-data/scripts/validate-mission-control-data.mjs",
        ),
        "utf8",
      ),
    );
    mkdirSync(join(tempRoot, "app/v3/node_modules/ajv/dist"), {
      recursive: true,
    });
    writeFileSync(
      join(tempRoot, "app/v3/package.json"),
      '{"name":"cold-install-app","private":true,"type":"module"}\n',
    );
    writeFileSync(
      join(tempRoot, "app/v3/node_modules/ajv/package.json"),
      '{"name":"ajv","version":"0.0.0-test","main":"index.js"}\n',
    );
    writeFileSync(
      join(tempRoot, "app/v3/node_modules/ajv/dist/2020.js"),
      `class TestAjv {
  compile() {
    const validate = () => true;
    validate.errors = [];
    return validate;
  }
}
module.exports = TestAjv;
module.exports.default = TestAjv;
`,
    );
    mkdirSync(join(tempRoot, "app/v3/node_modules/yaml"), {
      recursive: true,
    });
    writeFileSync(
      join(tempRoot, "app/v3/node_modules/yaml/package.json"),
      '{"name":"yaml","version":"0.0.0-test","main":"index.cjs"}\n',
    );
    writeFileSync(
      join(tempRoot, "app/v3/node_modules/yaml/index.cjs"),
      "module.exports = { parse: JSON.parse, parseDocument: () => ({}), visit: () => {} };\n",
    );

    const env = { ...process.env };
    for (const key of Object.keys(env)) {
      if (
        [
          "SSH_AUTH_SOCK",
          "SSH_AGENT_PID",
          "GPG_AGENT_INFO",
          "GNUPGHOME",
          "NODE_OPTIONS",
          "NODE_PATH",
          "BUN_OPTIONS",
          "LD_PRELOAD",
          "DYLD_INSERT_LIBRARIES",
          "DYLD_LIBRARY_PATH",
          "GIT_ASKPASS",
          "SSH_ASKPASS",
        ].includes(key) ||
        key === "GIT_CONFIG_COUNT" ||
        /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/.test(key)
      ) {
        delete env[key];
      }
    }
    const result = spawnSync(
      process.execPath,
      [
        validatorPath,
        "--pinned-app-code",
        "--allow-unborn-bootstrap",
      ],
      {
        cwd: dataRoot,
        env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    assert.equal(
      result.status,
      0,
      `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("reusable template keeps legacy changeset quarantine empty", () => {
  const failures = withTempTemplate((tempRoot) => {
    const configPath = missionControlConfigPath(tempRoot);
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.publish_policy.legacy_changeset_quarantine = [
      {
        id: "organization-specific-legacy-record",
        immutable_payload_digest_sha256: "a".repeat(64),
        terminal_action: "supersede",
      },
    ];
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  });
  assert.ok(
    failures.some((failure) =>
      failure.includes(
        "reusable publish_policy.legacy_changeset_quarantine must be an empty list",
      ),
    ),
    failures.join("\n"),
  );
});

test("Organization data validator checks the Mission Control config schema version", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const configPath = join(dataRoot, "data/mission-control/mission-control.config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.schema_version = "companiesascode.mission_control.config.obsolete";
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  });
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /schema_version must be companiesascode\.mission_control\.config\.v1/,
  );
});

test("Organization data validator rejects non-portable generated manifest paths", () => {
  const invalidPaths = [
    "C:/outside",
    "C:outside",
    "C:\\outside",
    "\\\\server\\share\\outside",
    "generated\\file.txt",
    "generated/file.txt:stream",
    "generated/./file.txt",
    "generated/file?.txt",
    "generated/file\".txt",
    "generated/file<part>.txt",
    "generated/file|part.txt",
    "generated/\u0001file.txt",
    "generated/file.",
    "generated/file ",
    "generated/CON.txt",
    "../outside",
    "/outside",
  ];
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const repositoryDbPath = join(dataRoot, "repository-db.yaml");
    const repositoryDbConfig = parseYaml(readFileSync(repositoryDbPath, "utf8"));
    repositoryDbConfig.generated_manifest = invalidPaths.map((path) => ({ path }));
    writeFileSync(repositoryDbPath, stringifyYaml(repositoryDbConfig));
  });
  assert.notEqual(result.status, 0);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.equal(
    output.match(/generated_manifest\[[0-9]+\]\.path must be repo-relative/g)?.length,
    invalidPaths.length,
    output,
  );
});

test("plan schemas support per-Organization prefixes and stay in sync", () => {
  const failures = withTempTemplate((tempRoot) => {
    const schemaPath = join(
      tempRoot,
      "templates/organization-data/schemas/mission-control-plan.schema.json",
    );
    const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
    schema.properties.dev_code.pattern = "^DEV-[0-9]{4}$";
    schema.properties.id.pattern = "^mcplan-dev-[0-9]{4}$";
    writeFileSync(schemaPath, `${JSON.stringify(schema, null, 2)}\n`);
  });
  assert.ok(
    failures.some(
      (failure) =>
        failure.includes("Organization prefix") ||
        failure.includes("must stay identical"),
    ),
    failures.join("\n"),
  );
});

test("mission-control scaffold requires canonical organization_admin", () => {
  for (const legacyReplacement of [false, true]) {
    const failures = withTempTemplate((tempRoot) => {
      const configPath = missionControlConfigPath(tempRoot);
      const config = JSON.parse(readFileSync(configPath, "utf8"));
      delete config.organization_admin;
      if (legacyReplacement) config.workspace_admin = "legacy-workspace-admin";
      writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    });
    assert.ok(
      failures.some((failure) => failure.includes("organization_admin must be a non-empty string")),
      failures.join("\n"),
    );
    if (legacyReplacement) {
      assert.ok(
        failures.some((failure) => failure.includes("not legacy workspace_admin")),
        failures.join("\n"),
      );
    }
  }
});

test("mission-control ledgers must be valid JSON arrays", () => {
  const failures = withTempTemplate((tempRoot) => {
    writeFileSync(join(tempRoot, "templates/organization-data/data/mission-control/TODO.tasks.json"), "{}\n");
  });
  assert.ok(failures.some((failure) => failure.includes("TODO.tasks.json") && failure.includes("JSON array")), failures.join("\n"));
});

test("mission-control config must reject legacy writes during compatibility bridge", () => {
  const failures = withTempTemplate((tempRoot) => {
    const configPath = missionControlConfigPath(tempRoot);
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.compatibility_bridge.legacy_write_paths_allowed = true;
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  });
  assert.ok(failures.some((failure) => failure.includes("legacy_write_paths_allowed must be false")), failures.join("\n"));
});

test("mission-control config requires concrete protected_paths inside its data boundary", () => {
  for (const invalidValue of [
    undefined,
    [],
    ["../outside/**"],
    ["data/mission-control/REPLACE_WITH_PATH/**"],
    ["data/mission-control\\reports/**"],
    ["data/mission-control/rep*orts/**"],
    ["data/mission-control//reports/**"],
    ["data/mission-control/./reports/**"],
    ["data/mission-control/../reports/**"],
  ]) {
    const failures = withTempTemplate((tempRoot) => {
      const configPath = missionControlConfigPath(tempRoot);
      const config = JSON.parse(readFileSync(configPath, "utf8"));
      if (invalidValue === undefined) delete config.publish_policy.protected_paths;
      else config.publish_policy.protected_paths = invalidValue;
      writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    });
    assert.ok(
      failures.some((failure) => failure.includes("publish_policy.protected_paths")),
      failures.join("\n"),
    );
  }
});

test("local Principal writer accepts a credential-free GitHub HTTPS data remote", () => {
  const failures = withTempTemplate((tempRoot) => {
    const repositoryDbPath = repositoryDbConfigPath(tempRoot);
    const repositoryDbConfig = parseYaml(
      readFileSync(repositoryDbPath, "utf8"),
    );
    repositoryDbConfig.data_repo.remote =
      "https://github.com/ExampleOrganization/mission-control-data.git";
    writeFileSync(repositoryDbPath, stringifyYaml(repositoryDbConfig));
  });
  assert.deepEqual(failures, []);
});

test("local Principal writer requires the canonical git GitHub SSH account", () => {
  const failures = withTempTemplate((tempRoot) => {
    const repositoryDbPath = repositoryDbConfigPath(tempRoot);
    const repositoryDbConfig = parseYaml(
      readFileSync(repositoryDbPath, "utf8"),
    );
    repositoryDbConfig.data_repo.remote =
      "alice@github.com:ExampleOrganization/mission-control-data.git";
    writeFileSync(repositoryDbPath, stringifyYaml(repositoryDbConfig));
  });
  assert.ok(
    failures.some((failure) =>
      failure.includes("requires a credential-free github.com SSH or HTTPS data_repo.remote"),
    ),
    failures.join("\n"),
  );
});

test("GitHub App Workspace writer accepts only a credential-free GitHub HTTPS data remote", () => {
  const failures = withTempTemplate((tempRoot) => {
    const configPath = missionControlConfigPath(tempRoot);
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.publish_policy.writer_mode = "github-app-workspace-v1";
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    const repositoryDbPath = repositoryDbConfigPath(tempRoot);
    const repositoryDbConfig = parseYaml(
      readFileSync(repositoryDbPath, "utf8"),
    );
    repositoryDbConfig.data_repo.remote =
      "https://github.com/ExampleOrganization/mission-control-data.git";
    writeFileSync(repositoryDbPath, stringifyYaml(repositoryDbConfig));
  });
  assert.deepEqual(failures, []);
});

test("GitHub App Workspace writer rejects SSH and embedded authority metadata", () => {
  const failures = withTempTemplate((tempRoot) => {
    const configPath = missionControlConfigPath(tempRoot);
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.publish_policy.writer_mode = "github-app-workspace-v1";
    config.publish_policy.credential_authority = { required: true };
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  });
  assert.ok(
    failures.some((failure) =>
      failure.includes(
        "github-app-workspace-v1 template requires a credential-free https://github.com data_repo.remote",
      ),
    ),
    failures.join("\n"),
  );
  assert.ok(
    failures.some((failure) =>
      failure.includes(
        "github-app-workspace-v1 template must not carry parallel credential_authority",
      ),
    ),
    failures.join("\n"),
  );
});

test("template rejects the retired capability writer mode", () => {
  const failures = withTempTemplate((tempRoot) => {
    const configPath = missionControlConfigPath(tempRoot);
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    useLegacyCapabilityWriter(config);
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  });
  assert.ok(failures.some((failure) =>
    failure.includes(
      "publish_policy.writer_mode must be local-principal-v1 or github-app-workspace-v1",
    )
  ), failures.join("\n"));
});

test("template requires an explicit supported native Git writer mode", () => {
  const failures = withTempTemplate((tempRoot) => {
    const configPath = missionControlConfigPath(tempRoot);
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    delete config.publish_policy.writer_mode;
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  });
  assert.ok(failures.some((failure) =>
    failure.includes(
      "publish_policy.writer_mode must be local-principal-v1 or github-app-workspace-v1",
    )
  ), failures.join("\n"));
});

test("local Principal template rejects parallel credential authority", () => {
  const failures = withTempTemplate((tempRoot) => {
    const configPath = missionControlConfigPath(tempRoot);
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.publish_policy.credential_authority = { required: true };
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  });
  assert.ok(failures.some((failure) =>
    failure.includes("must not carry parallel credential_authority")
  ), failures.join("\n"));
});

test("protected_paths must cover pending, published and superseded audit files", () => {
  const failures = withTempTemplate((tempRoot) => {
    const configPath = missionControlConfigPath(tempRoot);
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.publish_policy.protected_paths = ["data/mission-control/reports/**"];
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  });
  assert.ok(
    failures.some(
      (failure) =>
        failure.includes("protected_paths must cover audit files") &&
        failure.includes("pending_changesets_dir"),
    ),
    failures.join("\n"),
  );
  assert.ok(
    failures.some(
      (failure) =>
        failure.includes("protected_paths must cover audit files") &&
        failure.includes("published_changesets_dir"),
    ),
    failures.join("\n"),
  );
  assert.ok(
    failures.some(
      (failure) =>
        failure.includes("protected_paths must cover audit files") &&
        failure.includes("superseded_changesets_dir"),
    ),
    failures.join("\n"),
  );
});

test("Organization data validator fails closed on invalid protected_paths", () => {
  for (const invalidValue of [
    undefined,
    [],
    ["data/mission-control/../outside/**"],
    ["data/mission-control/REPLACE_WITH_PATH/**"],
    ["data/mission-control\\reports/**"],
    ["data/mission-control/rep*orts/**"],
    ["data/mission-control//reports/**"],
    ["data/mission-control/./reports/**"],
    ["data/mission-control/../reports/**"],
  ]) {
    const result = runOrganizationDataValidator((dataRoot) => {
      const configPath = join(dataRoot, "data/mission-control/mission-control.config.json");
      const config = JSON.parse(readFileSync(configPath, "utf8"));
      if (invalidValue === undefined) delete config.publish_policy.protected_paths;
      else config.publish_policy.protected_paths = invalidValue;
      writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /publish_policy\.protected_paths/);
  }
});

test("Organization data validator requires protected audit directories", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const configPath = join(dataRoot, "data/mission-control/mission-control.config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.publish_policy.protected_paths = ["data/mission-control/reports/**"];
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  });
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /protected_paths must cover audit files under publish_policy\.pending_changesets_dir/,
  );
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /protected_paths must cover audit files under publish_policy\.published_changesets_dir/,
  );
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /protected_paths must cover audit files under publish_policy\.superseded_changesets_dir/,
  );
});

test("Organization data validator binds active changesets to protected_paths", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const configPath = join(dataRoot, "data/mission-control/mission-control.config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.publish_policy.protected_paths = [
      "data/mission-control/changesets/pending/**",
      "data/mission-control/changesets/published/**",
      "data/mission-control/changesets/superseded/**",
    ];
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    writeFileSync(
      join(dataRoot, "data/mission-control/changesets/pending/outside-active-policy.json"),
      `${JSON.stringify({
        schema_version: "companiesascode.mission_control.changeset.v1",
        id: "outside-active-policy",
        status: "approved",
        summary: "Operation outside the active protected path policy",
        created_at: "2026-07-19T10:00:00.000Z",
        created_by: "template-builder",
        operations: [{
          action: "write_file",
          path: "data/mission-control/reports/outside-active-policy.txt",
          content: "blocked\n",
        }],
        approval: {
          approved_by: "template-steward",
          role: "steward",
          approved_at: "2026-07-19T10:05:00.000Z",
          comment: "",
        },
      }, null, 2)}\n`,
    );
  });
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /operations\[0\]\.path is not covered by publish_policy\.protected_paths/,
  );
});

test("Organization data validator enforces the complete credential authority policy", () => {
  const cases = [
    {
      mutate: (authority) => {
        authority.required = false;
      },
      pattern: /credential_authority\.required must be true/,
    },
    {
      mutate: (authority) => {
        authority.allowed_writer_ids = ["REPLACE_WITH_SCOPED_DATA_WRITER_ID"];
      },
      pattern: /credential_authority\.allowed_writer_ids must be a unique non-empty list of concrete strings/,
    },
    {
      mutate: (authority) => {
        authority.allowed_writer_ids = ["writer", "writer"];
      },
      pattern: /credential_authority\.allowed_writer_ids must be a unique non-empty list of concrete strings/,
    },
    {
      mutate: (authority) => {
        authority.allowed_writer_ids = ["žluťoučký-writer"];
      },
      pattern: /credential_authority\.allowed_writer_ids must be a unique non-empty list of concrete strings/,
    },
    {
      mutate: (authority) => {
        authority.custody = "everyone";
      },
      pattern: /credential_authority\.custody must be admin-or-steward/,
    },
    {
      mutate: (authority) => {
        authority.branch = "main";
      },
      pattern: /credential_authority\.branch must match repository-db\.yaml data_repo\.branch/,
    },
  ];
  for (const { mutate, pattern } of cases) {
    const result = runOrganizationDataValidator((dataRoot) => {
      instantiateOrganizationData(dataRoot, "DEV");
      const configPath = join(dataRoot, "data/mission-control/mission-control.config.json");
      const config = JSON.parse(readFileSync(configPath, "utf8"));
      mutate(config.publish_policy.credential_authority);
      writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, pattern);
  }
});

test("Organization data validator accepts a narrowed approval role policy", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const configPath = join(dataRoot, "data/mission-control/mission-control.config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.publish_policy.approval_roles = ["admin"];
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("Organization data validator rejects retired local roster metadata", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const configPath = join(dataRoot, "data/mission-control/mission-control.config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.publish_policy.writer_mode = "local-principal-v1";
    config.publish_policy.approval_roles = ["admin"];
    delete config.publish_policy.credential_authority;
    config.publish_policy.local_principal = {
      provider_access_audit: {
        status: "pending",
        roster_scope: "admin-steward",
        repository: null,
        branch: "v3",
        checked_at: null,
        checked_by: null,
      },
    };
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  });
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /must not configure retired publish_policy\.(?:approval_roles|local_principal)/,
  );
});

test("Organization data validator does not require a provider audit roster scope", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const configPath = join(dataRoot, "data/mission-control/mission-control.config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.publish_policy.writer_mode = "local-principal-v1";
    delete config.publish_policy.approval_roles;
    delete config.publish_policy.credential_authority;
    delete config.publish_policy.local_principal;
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("Organization data validator rejects a non-git GitHub SSH account", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const configPath = join(dataRoot, "data/mission-control/mission-control.config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.publish_policy.writer_mode = "local-principal-v1";
    config.publish_policy.approval_roles = ["admin", "steward"];
    delete config.publish_policy.credential_authority;
    config.publish_policy.local_principal = {
      provider_access_audit: {
        status: "pending",
        roster_scope: "admin-steward",
        repository: null,
        branch: "v3",
        checked_at: null,
        checked_by: null,
      },
    };
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    const repositoryDbPath = join(dataRoot, "repository-db.yaml");
    const repositoryDbConfig = parseYaml(readFileSync(repositoryDbPath, "utf8"));
    repositoryDbConfig.data_repo.remote =
      "alice@github.com:ExampleOrganization/mission-control-data.git";
    writeFileSync(repositoryDbPath, stringifyYaml(repositoryDbConfig));
  });
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /local-principal-v1 requires a github\.com SSH or credential-free HTTPS data_repo\.remote/,
  );
});

test("Organization data validator accepts the GitHub App Workspace writer profile", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const configPath = join(
      dataRoot,
      "data/mission-control/mission-control.config.json",
    );
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.publish_policy.writer_mode = "github-app-workspace-v1";
    delete config.publish_policy.approval_roles;
    delete config.publish_policy.credential_authority;
    delete config.publish_policy.local_principal;
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    const repositoryDbPath = join(dataRoot, "repository-db.yaml");
    const repositoryDbConfig = parseYaml(
      readFileSync(repositoryDbPath, "utf8"),
    );
    repositoryDbConfig.data_repo.remote =
      "https://github.com/ExampleOrganization/mission-control-data.git";
    writeFileSync(repositoryDbPath, stringifyYaml(repositoryDbConfig));
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("Organization data validator rejects unsafe GitHub App Workspace writer configuration", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const configPath = join(
      dataRoot,
      "data/mission-control/mission-control.config.json",
    );
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.publish_policy.writer_mode = "github-app-workspace-v1";
    delete config.publish_policy.approval_roles;
    config.publish_policy.local_principal = { actor: "shadow-admin" };
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    const repositoryDbPath = join(dataRoot, "repository-db.yaml");
    const repositoryDbConfig = parseYaml(
      readFileSync(repositoryDbPath, "utf8"),
    );
    repositoryDbConfig.data_repo.remote =
      "git@github.com:ExampleOrganization/mission-control-data.git";
    writeFileSync(repositoryDbPath, stringifyYaml(repositoryDbConfig));
  });
  assert.notEqual(result.status, 0);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(
    output,
    /github-app-workspace-v1 requires a credential-free https:\/\/github\.com data_repo\.remote/,
  );
  assert.match(
    output,
    /github-app-workspace-v1 must not configure publish_policy\.(?:credential_authority|local_principal)/,
  );
});

test("Organization data validator rejects forged local evidence in capability mode", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    commitFixture(dataRoot, "instantiate capability writer");
    const baseCommit = spawnSync(
      "git",
      ["rev-parse", "HEAD"],
      { cwd: dataRoot, encoding: "utf8" },
    ).stdout.trim();
    const id = "forged-local-capability";
    const reportPath =
      `data/mission-control/reports/${id}.txt`;
    const operations = [
      {
        action: "write_file",
        path: reportPath,
        content: "forged local evidence\n",
      },
    ];
    writeFileSync(join(dataRoot, reportPath), operations[0].content);
    writeFileSync(
      join(
        dataRoot,
        `data/mission-control/changesets/published/${id}.json`,
      ),
      `${JSON.stringify(
        localPrincipalPublishedChangeset({
          id,
          baseCommit,
          operations,
        }),
        null,
        2,
      )}\n`,
    );
    commitFixture(dataRoot, "forge local evidence");
  });
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /local Principal evidence requires a confirmed local-principal-v1 control plane/,
  );
});

test("Organization data validator binds local evidence to the introducing commit diff", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const configPath = join(
      dataRoot,
      "data/mission-control/mission-control.config.json",
    );
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.publish_policy.writer_mode = "local-principal-v1";
    delete config.publish_policy.approval_roles;
    delete config.publish_policy.credential_authority;
    delete config.publish_policy.local_principal;
    writeFileSync(
      configPath,
      `${JSON.stringify(config, null, 2)}\n`,
    );
    commitFixture(dataRoot, "confirm local Principal writer");
    const baseCommit = spawnSync(
      "git",
      ["rev-parse", "HEAD"],
      { cwd: dataRoot, encoding: "utf8" },
    ).stdout.trim();
    const id = "unrecorded-local-side-path";
    const reportPath =
      `data/mission-control/reports/${id}.txt`;
    const operations = [
      {
        action: "write_file",
        path: reportPath,
        content: "declared local change\n",
      },
    ];
    writeFileSync(join(dataRoot, reportPath), operations[0].content);
    writeFileSync(
      join(
        dataRoot,
        "data/mission-control/reports/unrecorded-side-path.txt",
      ),
      "not declared in local_publish evidence\n",
    );
    writeFileSync(
      join(
        dataRoot,
        `data/mission-control/changesets/published/${id}.json`,
      ),
      `${JSON.stringify(
        localPrincipalPublishedChangeset({
          id,
          baseCommit,
          operations,
        }),
        null,
        2,
      )}\n`,
    );
    commitFixture(dataRoot, "publish with an unrecorded side path");
  });
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /native Git writer profiles freeze data\/mission-control\/changesets/,
  );
});

test("Organization data validator rejects new local changeset audit records", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const configPath = join(
      dataRoot,
      "data/mission-control/mission-control.config.json",
    );
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.publish_policy.writer_mode = "local-principal-v1";
    delete config.publish_policy.approval_roles;
    delete config.publish_policy.credential_authority;
    delete config.publish_policy.local_principal;
    writeFileSync(
      configPath,
      `${JSON.stringify(config, null, 2)}\n`,
    );
    commitFixture(dataRoot, "confirm local Principal writer");
    const baseCommit = spawnSync(
      "git",
      ["rev-parse", "HEAD"],
      { cwd: dataRoot, encoding: "utf8" },
    ).stdout.trim();
    const id = "exact-local-introduction";
    const reportPath =
      `data/mission-control/reports/${id}.txt`;
    const operations = [
      {
        action: "write_file",
        path: reportPath,
        content: "exact local change\n",
      },
    ];
    writeFileSync(join(dataRoot, reportPath), operations[0].content);
    writeFileSync(
      join(
        dataRoot,
        `data/mission-control/changesets/published/${id}.json`,
      ),
      `${JSON.stringify(
        localPrincipalPublishedChangeset({
          id,
          baseCommit,
          operations,
        }),
        null,
        2,
      )}\n`,
    );
    commitFixture(dataRoot, "publish exact local evidence");
  });
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /native Git writer profiles freeze data\/mission-control\/changesets/,
  );
});

test("Organization data validator rejects a member-phase shadow roster", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const configPath = join(
      dataRoot,
      "data/mission-control/mission-control.config.json",
    );
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.publish_policy.writer_mode = "local-principal-v1";
    config.publish_policy.approval_roles = ["member"];
    delete config.publish_policy.credential_authority;
    config.publish_policy.local_principal = {
      provider_access_audit: {
        status: "confirmed",
        roster_scope: "organization-members",
        repository:
          "git@github.com:ExampleOrganization/mission-control-data.git",
        branch: "v3",
        checked_at: "2026-07-23T09:00:00.000Z",
        checked_by: "organization-admin",
      },
    };
    writeFileSync(
      configPath,
      `${JSON.stringify(config, null, 2)}\n`,
    );
    commitFixture(dataRoot, "confirm member-phase local Principal writer");
    const baseCommit = spawnSync(
      "git",
      ["rev-parse", "HEAD"],
      { cwd: dataRoot, encoding: "utf8" },
    ).stdout.trim();
    const id = "member-phase-local-introduction";
    const reportPath =
      `data/mission-control/reports/${id}.txt`;
    const operations = [
      {
        action: "write_file",
        path: reportPath,
        content: "member phase local change\n",
      },
    ];
    writeFileSync(join(dataRoot, reportPath), operations[0].content);
    writeFileSync(
      join(
        dataRoot,
        `data/mission-control/changesets/published/${id}.json`,
      ),
      `${JSON.stringify(
        localPrincipalPublishedChangeset({
          id,
          baseCommit,
          operations,
        }),
        null,
        2,
      )}\n`,
    );
    commitFixture(dataRoot, "publish member phase local evidence");
  });
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /must not configure retired publish_policy\.(?:approval_roles|local_principal)/,
  );
});

test("Organization data validator rejects invalid approval role policies", () => {
  for (const approvalRoles of [[], ["builder"], ["admin", "admin"], [" steward"]]) {
    const result = runOrganizationDataValidator((dataRoot) => {
      instantiateOrganizationData(dataRoot, "DEV");
      const configPath = join(dataRoot, "data/mission-control/mission-control.config.json");
      const config = JSON.parse(readFileSync(configPath, "utf8"));
      config.publish_policy.approval_roles = approvalRoles;
      writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /publish_policy\.approval_roles/);
  }
});

test("Organization data validator binds approval metadata to the configured role policy", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const configPath = join(dataRoot, "data/mission-control/mission-control.config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.publish_policy.approval_roles = ["admin"];
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    writeFileSync(
      join(
        dataRoot,
        "data/mission-control/changesets/pending/invalid-approved-role.json",
      ),
      `${JSON.stringify({
        schema_version: "companiesascode.mission_control.changeset.v1",
        id: "invalid-approved-role",
        status: "approved",
        summary: "Invalid approval role",
        created_at: "2026-07-19T10:00:00.000Z",
        created_by: "template-builder",
        operations: [{
          action: "write_file",
          path: "data/mission-control/reports/invalid-approved-role.txt",
          content: "blocked\n",
        }],
        approval: {
          approved_by: "template-steward",
          role: "steward",
          approved_at: "2026-07-19T10:05:00.000Z",
          comment: "",
        },
      }, null, 2)}\n`,
    );
  });
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /active approval\.role must be allowed by publish_policy\.approval_roles/,
  );
});

test("Organization data validator preserves terminal audit history after role policy narrows", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const configPath = join(dataRoot, "data/mission-control/mission-control.config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.publish_policy.approval_roles = ["admin"];
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    const approvedHistory = {
      schema_version: "companiesascode.mission_control.changeset.v1",
      summary: "Historical steward approval",
      created_at: "2026-07-19T10:00:00.000Z",
      created_by: "organization-user",
      operations: [{
        action: "write_file",
        path: "data/mission-control/reports/historical-steward.txt",
        content: "history\n",
      }],
      approval: {
        approved_by: "organization-steward",
        role: "steward",
        approved_at: "2026-07-19T10:05:00.000Z",
        comment: "",
      },
    };
    const published = attachAuthenticatedLifecycle({
      ...approvedHistory,
      approval: { ...approvedHistory.approval },
      id: "historical-steward-published",
      status: "published",
      published_at: "2026-07-19T10:10:00.000Z",
      published_by: "organization-steward",
      credential_authority: {
        writer_id: "organization-scoped-data-writer",
        custody_role: "steward",
        branch: "v3",
        path_allowlist: ["data/mission-control/**"],
      },
    });
    writeFileSync(
      join(
        dataRoot,
        "data/mission-control/changesets/published/historical-steward-published.json",
      ),
      `${JSON.stringify(published, null, 2)}\n`,
    );
    const superseded = attachAuthenticatedLifecycle({
      ...approvedHistory,
      approval: { ...approvedHistory.approval },
      id: "historical-steward-superseded",
      status: "superseded",
      supersession: {
        superseded_at: "2026-07-19T10:10:00.000Z",
        superseded_by: "organization-steward",
        role: "steward",
        reason: "Historical terminal audit.",
        replacement_changeset_id: null,
      },
    });
    writeFileSync(
      join(
        dataRoot,
        "data/mission-control/changesets/superseded/historical-steward-superseded.json",
      ),
      `${JSON.stringify(superseded, null, 2)}\n`,
    );
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("Organization data validator rejects supersession metadata on active and published records", () => {
  for (const status of ["approved", "published"]) {
    const result = runOrganizationDataValidator((dataRoot) => {
      instantiateOrganizationData(dataRoot, "DEV");
      const id = `contradictory-${status}`;
      const directory = status === "published" ? "published" : "pending";
      writeFileSync(
        join(dataRoot, `data/mission-control/changesets/${directory}/${id}.json`),
        `${JSON.stringify({
          schema_version: "companiesascode.mission_control.changeset.v1",
          id,
          status,
          summary: "Contradictory terminal audit metadata",
          created_at: "2026-07-19T10:00:00.000Z",
          created_by: "template-builder",
          operations: [{
            action: "write_file",
            path: `data/mission-control/reports/${id}.txt`,
            content: "blocked\n",
          }],
          approval: {
            approved_by: "template-steward",
            role: "steward",
            approved_at: "2026-07-19T10:05:00.000Z",
            comment: "",
          },
          ...(status === "published"
            ? {
                published_at: "2026-07-19T10:10:00.000Z",
                published_by: "template-steward",
                credential_authority: {
                  writer_id: "template-writer",
                  custody_role: "steward",
                  branch: "v3",
                  path_allowlist: ["data/mission-control/**"],
                },
              }
            : {}),
          supersession: {
            superseded_at: "2026-07-19T10:15:00.000Z",
            superseded_by: "template-steward",
            role: "steward",
            reason: "This metadata must not coexist with the current status.",
            replacement_changeset_id: null,
          },
        }, null, 2)}\n`,
      );
    });
    assert.notEqual(result.status, 0);
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /only a superseded changeset may contain supersession metadata/,
    );
  }
});

test("Organization data validator requires canonical ISO audit date-times", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    writeFileSync(
      join(dataRoot, "data/mission-control/changesets/pending/invalid-created-time.json"),
      `${JSON.stringify({
        schema_version: "companiesascode.mission_control.changeset.v1",
        id: "invalid-created-time",
        status: "pending",
        summary: "Invalid creation time",
        created_at: "2026-02-30T10:00:00.000Z",
        created_by: "template-builder",
        operations: [{
          action: "write_file",
          path: "data/mission-control/reports/invalid-created-time.txt",
          content: "blocked\n",
        }],
      }, null, 2)}\n`,
    );
    writeFileSync(
      join(dataRoot, "data/mission-control/changesets/pending/invalid-approval-time.json"),
      `${JSON.stringify({
        schema_version: "companiesascode.mission_control.changeset.v1",
        id: "invalid-approval-time",
        status: "approved",
        summary: "Invalid approval time",
        created_at: "2026-07-19T10:00:00.000Z",
        created_by: "template-builder",
        operations: [{
          action: "write_file",
          path: "data/mission-control/reports/invalid-approval-time.txt",
          content: "blocked\n",
        }],
        approval: {
          approved_by: "template-steward",
          role: "steward",
          approved_at: "2026-07-19",
          comment: "",
        },
      }, null, 2)}\n`,
    );
    writeFileSync(
      join(dataRoot, "data/mission-control/changesets/superseded/invalid-supersession-time.json"),
      `${JSON.stringify({
        schema_version: "companiesascode.mission_control.changeset.v1",
        id: "invalid-supersession-time",
        status: "superseded",
        summary: "Invalid supersession time",
        created_at: "2026-07-19T10:00:00.000Z",
        created_by: "template-builder",
        operations: [{
          action: "write_file",
          path: "data/mission-control/reports/invalid-supersession-time.txt",
          content: "blocked\n",
        }],
        supersession: {
          superseded_at: "2026-02-30T10:15:00.000Z",
          superseded_by: "template-steward",
          role: "steward",
          reason: "This invalid calendar date must fail closed.",
          replacement_changeset_id: null,
        },
      }, null, 2)}\n`,
    );
    writeFileSync(
      join(dataRoot, "data/mission-control/changesets/published/invalid-published-time.json"),
      `${JSON.stringify({
        schema_version: "companiesascode.mission_control.changeset.v1",
        id: "invalid-published-time",
        status: "published",
        summary: "Invalid publication time",
        created_at: "2026-07-19T10:00:00.000Z",
        created_by: "template-builder",
        operations: [{
          action: "write_file",
          path: "data/mission-control/reports/invalid-published-time.txt",
          content: "blocked\n",
        }],
        approval: {
          approved_by: "template-steward",
          role: "steward",
          approved_at: "2026-07-19T10:05:00.000Z",
          comment: "",
        },
        published_at: "2026-07-19",
        published_by: "template-steward",
        credential_authority: {
          writer_id: "template-writer",
          custody_role: "steward",
          branch: "v3",
          path_allowlist: ["data/mission-control/**"],
        },
      }, null, 2)}\n`,
    );
  });
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /created_at must be an ISO date-time/,
  );
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /approval\.approved_at must be an ISO date-time/,
  );
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /supersession\.superseded_at must be an ISO date-time/,
  );
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /published_at must be an ISO date-time/,
  );
});

test("Organization data validator requires complete publication audit metadata", () => {
  for (const field of ["published_at", "published_by", "credential_authority"]) {
    const result = runOrganizationDataValidator((dataRoot) => {
      instantiateOrganizationData(dataRoot, "DEV");
      const published = {
        schema_version: "companiesascode.mission_control.changeset.v1",
        id: `missing-${field.replaceAll("_", "-")}`,
        status: "published",
        summary: "Incomplete publication audit",
        created_at: "2026-07-19T10:00:00.000Z",
        created_by: "template-builder",
        operations: [{
          action: "write_file",
          path: `data/mission-control/reports/missing-${field}.txt`,
          content: "blocked\n",
        }],
        approval: {
          approved_by: "template-steward",
          role: "steward",
          approved_at: "2026-07-19T10:05:00.000Z",
          comment: "",
        },
        published_at: "2026-07-19T10:10:00.000Z",
        published_by: "template-steward",
        credential_authority: {
          writer_id: "template-writer",
          custody_role: "steward",
          branch: "v3",
          path_allowlist: ["data/mission-control/**"],
        },
      };
      delete published[field];
      writeFileSync(
        join(dataRoot, `data/mission-control/changesets/published/${published.id}.json`),
        `${JSON.stringify(published, null, 2)}\n`,
      );
    });
    assert.notEqual(result.status, 0);
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      new RegExp(`${field} must be (?:an ISO date-time|a non-empty string|an object)`),
    );
  }
});

test("Organization data validator validates published credential authority structurally", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    writeFileSync(
      join(dataRoot, "data/mission-control/changesets/published/invalid-credential-authority.json"),
      `${JSON.stringify({
        schema_version: "companiesascode.mission_control.changeset.v1",
        id: "invalid-credential-authority",
        status: "published",
        summary: "Invalid credential authority",
        created_at: "2026-07-19T10:00:00.000Z",
        created_by: "template-builder",
        operations: [{
          action: "write_file",
          path: "data/mission-control/reports/invalid-credential-authority.txt",
          content: "blocked\n",
        }],
        approval: {
          approved_by: "template-steward",
          role: "steward",
          approved_at: "2026-07-19T10:05:00.000Z",
          comment: "",
        },
        published_at: "2026-07-19T10:10:00.000Z",
        published_by: "template-steward",
        credential_authority: {
          writer_id: "REPLACE_WITH_WRITER",
          custody_role: "user",
          branch: " ",
          path_allowlist: ["C:/outside/**", "data/mission-control/**"],
        },
      }, null, 2)}\n`,
    );
  });
  assert.notEqual(result.status, 0);
  for (const pattern of [
    /credential_authority\.writer_id must be a concrete non-empty string/,
    /credential_authority\.custody_role must be admin or steward/,
    /credential_authority\.branch must be a concrete non-empty string/,
    /credential_authority\.path_allowlist\[0\] must be a concrete safe repository path/,
  ]) {
    assert.match(`${result.stdout}\n${result.stderr}`, pattern);
  }
});

test("Organization data validator accepts complete authenticated writer audit", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const changeset = authenticatedPublishedChangeset();
    writeFileSync(
      join(
        dataRoot,
        `data/mission-control/changesets/published/${changeset.id}.json`,
      ),
      `${JSON.stringify(changeset, null, 2)}\n`,
    );
  });
  assert.equal(
    result.status,
    0,
    `${result.stdout}\n${result.stderr}`,
  );
});

test("Organization data validator rejects fabricated pinned app-code commit, tree and validator digest", () => {
  for (const [field, forgedValue] of [
    ["commit", "f".repeat(40)],
    ["control_plane_tree_sha", "e".repeat(40)],
    ["validator_digest_sha256", "0".repeat(64)],
  ]) {
    const result = runOrganizationDataValidator((dataRoot) => {
      instantiateOrganizationData(dataRoot, "DEV");
      const changeset = authenticatedPublishedChangeset();
      changeset.creation_authorization.application[field] = forgedValue;
      changeset.writer_audit_provenance.first_authorization_digest_sha256 =
        jsonDigest(changeset.creation_authorization);
      writeFileSync(
        join(
          dataRoot,
          `data/mission-control/changesets/published/${changeset.id}.json`,
        ),
        `${JSON.stringify(changeset, null, 2)}\n`,
      );
    });
    assert.notEqual(
      result.status,
      0,
      `${field}\n${result.stdout}\n${result.stderr}`,
    );
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      new RegExp(`application\\.${field}.*pinned app-code`, "i"),
    );
  }
});

test("Organization data validator rejects a non-validator app-code blob as validator evidence", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const changeset = authenticatedPublishedChangeset();
    changeset.creation_authorization.application.validator_path =
      "README.md";
    changeset.creation_authorization.application.validator_digest_sha256 =
      createHash("sha256")
        .update(readFileSync(join(root, "README.md")))
        .digest("hex");
    changeset.writer_audit_provenance.first_authorization_digest_sha256 =
      jsonDigest(changeset.creation_authorization);
    writeFileSync(
      join(
        dataRoot,
        `data/mission-control/changesets/published/${changeset.id}.json`,
      ),
      `${JSON.stringify(changeset, null, 2)}\n`,
    );
  });
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /application\.validator_path is not trusted by its recorded app-code commit/i,
  );
});

test("Organization data validator rejects an annotated tag object as application commit", () => {
  const result = runOrganizationDataValidator(
    (dataRoot, { taggedApplication }) => {
      instantiateOrganizationData(dataRoot, "DEV");
      const changeset = authenticatedPublishedChangeset();
      for (const evidence of [
        changeset.creation_authorization,
        changeset.approval.runtime_authorization,
        changeset.runtime_authorization,
      ]) {
        evidence.application = { ...taggedApplication };
      }
      changeset.writer_audit_provenance.first_authorization_digest_sha256 =
        jsonDigest(changeset.creation_authorization);
      writeFileSync(
        join(
          dataRoot,
          `data/mission-control/changesets/published/${changeset.id}.json`,
        ),
        `${JSON.stringify(changeset, null, 2)}\n`,
      );
    },
    {
      prepareAppCode(appCodeRoot) {
        const head = spawnSync("git", ["rev-parse", "HEAD"], {
          cwd: appCodeRoot,
          encoding: "utf8",
        }).stdout.trim();
        const tree = spawnSync("git", ["rev-parse", "HEAD^{tree}"], {
          cwd: appCodeRoot,
          encoding: "utf8",
        }).stdout.trim();
        const tagResult = spawnSync("git", ["mktag"], {
          cwd: appCodeRoot,
          encoding: "utf8",
          input: [
            `object ${head}`,
            "type commit",
            "tag annotated-application-fixture",
            "tagger Mission Control Validator Test <validator@example.invalid> 1784451600 +0000",
            "",
            "Annotated tag objects are not exact application commits.",
            "",
          ].join("\n"),
        });
        assert.equal(tagResult.status, 0, tagResult.stderr);
        return {
          taggedApplication: {
            repository: "ExampleOrganization/mission-control",
            commit: tagResult.stdout.trim(),
            validator_path: pinnedValidatorPath,
            validator_digest_sha256: gitBlobDigest(
              appCodeRoot,
              head,
              pinnedValidatorPath,
            ),
            control_plane_tree_sha: tree,
          },
        };
      },
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /application\.commit must identify an exact commit object/i,
  );
});

test("Organization data validator rejects a side-branch commit outside reviewed validator path history", () => {
  const result = runOrganizationDataValidator(
    (dataRoot, { sideBranchApplication }) => {
      instantiateOrganizationData(dataRoot, "DEV");
      const changeset = authenticatedPublishedChangeset();
      for (const evidence of [
        changeset.creation_authorization,
        changeset.approval.runtime_authorization,
        changeset.runtime_authorization,
      ]) {
        evidence.application = { ...sideBranchApplication };
      }
      changeset.writer_audit_provenance.first_authorization_digest_sha256 =
        jsonDigest(changeset.creation_authorization);
      writeFileSync(
        join(
          dataRoot,
          `data/mission-control/changesets/published/${changeset.id}.json`,
        ),
        `${JSON.stringify(changeset, null, 2)}\n`,
      );
    },
    {
      prepareAppCode(appCodeRoot) {
        const git = (args, options = {}) => {
          const result = spawnSync("git", args, {
            cwd: appCodeRoot,
            encoding: "utf8",
            ...options,
          });
          assert.equal(result.status, 0, result.stderr);
          return result.stdout.trim();
        };
        const head = git(["rev-parse", "HEAD"]);
        const tree = git(["rev-parse", "HEAD^{tree}"]);
        const commitEnvironment = {
          ...process.env,
          GIT_AUTHOR_NAME: "Mission Control Validator Test",
          GIT_AUTHOR_EMAIL: "validator@example.invalid",
          GIT_AUTHOR_DATE: "2026-07-20T09:00:00Z",
          GIT_COMMITTER_NAME: "Mission Control Validator Test",
          GIT_COMMITTER_EMAIL: "validator@example.invalid",
          GIT_COMMITTER_DATE: "2026-07-20T09:00:00Z",
        };
        const sideBranchCommit = git(
          ["commit-tree", tree, "-p", head],
          {
            env: commitEnvironment,
            input: "Unreviewed descendant side history with a validator-shaped blob.\n",
          },
        );
        const mergeCommit = git(
          ["commit-tree", tree, "-p", head, "-p", sideBranchCommit],
          {
            env: {
              ...commitEnvironment,
              GIT_AUTHOR_DATE: "2026-07-20T09:01:00Z",
              GIT_COMMITTER_DATE: "2026-07-20T09:01:00Z",
            },
            input: "Merge unreviewed side history for the trust-boundary fixture.\n",
          },
        );
        git(["update-ref", "HEAD", mergeCommit, head]);
        return {
          sideBranchApplication: {
            repository: "ExampleOrganization/mission-control",
            commit: sideBranchCommit,
            validator_path: pinnedValidatorPath,
            validator_digest_sha256: gitBlobDigest(
              appCodeRoot,
              sideBranchCommit,
              pinnedValidatorPath,
            ),
            control_plane_tree_sha: tree,
          },
        };
      },
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /application\.commit must belong to the trusted pinned app-code first-parent history/i,
  );
});

test("Organization data validator rejects app-code replacement refs and grafts", () => {
  for (const replacementKind of ["replace-ref", "graft"]) {
    const result = runOrganizationDataValidator(
      (dataRoot, { rewrittenApplication }) => {
        instantiateOrganizationData(dataRoot, "DEV");
        const changeset = authenticatedPublishedChangeset();
        for (const evidence of [
          changeset.creation_authorization,
          changeset.approval.runtime_authorization,
          changeset.runtime_authorization,
        ]) {
          evidence.application = { ...rewrittenApplication };
        }
        changeset.writer_audit_provenance.first_authorization_digest_sha256 =
          jsonDigest(changeset.creation_authorization);
        writeFileSync(
          join(
            dataRoot,
            `data/mission-control/changesets/published/${changeset.id}.json`,
          ),
          `${JSON.stringify(changeset, null, 2)}\n`,
        );
      },
      {
        prepareAppCode(appCodeRoot) {
          const { preManifestApplication } =
            installCurrentPinnedValidatorManifest(appCodeRoot);
          const git = (args) => {
            const gitResult = spawnSync("git", args, {
              cwd: appCodeRoot,
              encoding: "utf8",
            });
            assert.equal(gitResult.status, 0, gitResult.stderr);
            return gitResult.stdout.trim();
          };
          const head = git(["rev-parse", "HEAD"]);
          const tree = git(["rev-parse", "HEAD^{tree}"]);
          const rewrittenApplication = {
            repository: "ExampleOrganization/mission-control",
            commit: head,
            validator_path: pinnedValidatorPath,
            validator_digest_sha256: gitBlobDigest(
              appCodeRoot,
              head,
              pinnedValidatorPath,
            ),
            control_plane_tree_sha: tree,
          };
          if (replacementKind === "replace-ref") {
            git(["replace", head, preManifestApplication.commit]);
          } else {
            const infoDirectory = join(appCodeRoot, ".git/info");
            mkdirSync(infoDirectory, { recursive: true });
            writeFileSync(
              join(infoDirectory, "grafts"),
              `${head} ${preManifestApplication.commit}\n`,
            );
          }
          return { rewrittenApplication };
        },
      },
    );
    assert.notEqual(
      result.status,
      0,
      `${replacementKind}\n${result.stdout}\n${result.stderr}`,
    );
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /app-code Git replacement refs or grafts are present/i,
    );
  }
});

test("pinned validator fixtures support GitHub template root histories", () => {
  const result = runOrganizationDataValidator(
    (dataRoot) => {
      instantiateOrganizationData(dataRoot, "DEV");
    },
    {
      prepareAppCode(appCodeRoot) {
        const git = (args) => {
          const gitResult = spawnSync("git", args, {
            cwd: appCodeRoot,
            encoding: "utf8",
          });
          assert.equal(gitResult.status, 0, gitResult.stderr);
          return gitResult.stdout.trim();
        };
        const tree = git(["rev-parse", "HEAD^{tree}"]);
        const organizationRoot = git([
          "-c",
          "user.name=Mission Control Validator Test",
          "-c",
          "user.email=validator@example.invalid",
          "commit-tree",
          tree,
          "-m",
          "Initialize Organization fork",
        ]);
        git(["checkout", "-q", "--detach", organizationRoot]);
        return installCurrentPinnedValidatorManifest(appCodeRoot);
      },
    },
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("Organization data validator rejects shallow app-code history", () => {
  const result = runOrganizationDataValidator(
    (dataRoot, { preManifestApplication }) => {
      instantiateOrganizationData(dataRoot, "DEV");
      const changeset = authenticatedPublishedChangeset();
      for (const evidence of [
        changeset.creation_authorization,
        changeset.approval.runtime_authorization,
        changeset.runtime_authorization,
      ]) {
        evidence.application = { ...preManifestApplication };
      }
      changeset.writer_audit_provenance.first_authorization_digest_sha256 =
        jsonDigest(changeset.creation_authorization);
      writeFileSync(
        join(
          dataRoot,
          `data/mission-control/changesets/published/${changeset.id}.json`,
        ),
        `${JSON.stringify(changeset, null, 2)}\n`,
      );
    },
    {
      prepareAppCode(appCodeRoot) {
        const installed = installCurrentPinnedValidatorManifest(appCodeRoot);
        const head = spawnSync("git", ["rev-parse", "HEAD"], {
          cwd: appCodeRoot,
          encoding: "utf8",
        });
        assert.equal(head.status, 0, head.stderr);
        writeFileSync(join(appCodeRoot, ".git", "shallow"), head.stdout);
        return installed;
      },
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /pinned app-code history requires a non-shallow repository/i,
  );
});

test("Organization data validator uses the recorded commit's validator path manifest", () => {
  const result = runOrganizationDataValidator(
    (dataRoot, { applicationWithoutTrustedPath }) => {
      instantiateOrganizationData(dataRoot, "DEV");
      const changeset = authenticatedPublishedChangeset();
      for (const evidence of [
        changeset.creation_authorization,
        changeset.approval.runtime_authorization,
        changeset.runtime_authorization,
      ]) {
        evidence.application = { ...applicationWithoutTrustedPath };
      }
      changeset.writer_audit_provenance.first_authorization_digest_sha256 =
        jsonDigest(changeset.creation_authorization);
      writeFileSync(
        join(
          dataRoot,
          `data/mission-control/changesets/published/${changeset.id}.json`,
        ),
        `${JSON.stringify(changeset, null, 2)}\n`,
      );
    },
    {
      prepareAppCode(appCodeRoot) {
        const manifestPath = join(appCodeRoot, pinnedValidatorPathManifest);
        const writeManifest = (trustedValidatorPaths) => {
          writeFileSync(
            manifestPath,
            `${JSON.stringify({
              schema_version:
                "companiesascode.mission_control.pinned_validator_paths.v1",
              trusted_validator_paths: trustedValidatorPaths,
            }, null, 2)}\n`,
          );
        };
        const commit = (message) => {
          const add = spawnSync("git", ["add", pinnedValidatorPathManifest], {
            cwd: appCodeRoot,
            encoding: "utf8",
          });
          assert.equal(add.status, 0, add.stderr);
          const result = spawnSync(
            "git",
            [
              "-c",
              "user.name=Mission Control Validator Test",
              "-c",
              "user.email=validator@example.invalid",
              "commit",
              "-q",
              "-m",
              message,
            ],
            { cwd: appCodeRoot, encoding: "utf8" },
          );
          assert.equal(result.status, 0, result.stderr);
        };
        writeManifest([
          "templates/organization-data/scripts/unrelated-validator.mjs",
        ]);
        commit("Record a historical manifest without the pinned path");
        const applicationCommit = spawnSync(
          "git",
          ["rev-parse", "HEAD"],
          { cwd: appCodeRoot, encoding: "utf8" },
        ).stdout.trim();
        const applicationTree = spawnSync(
          "git",
          ["rev-parse", "HEAD^{tree}"],
          { cwd: appCodeRoot, encoding: "utf8" },
        ).stdout.trim();
        writeManifest([pinnedValidatorPath]);
        commit("Restore the current trusted validator path manifest");
        return {
          applicationWithoutTrustedPath: {
            repository: "ExampleOrganization/mission-control",
            commit: applicationCommit,
            validator_path: pinnedValidatorPath,
            validator_digest_sha256: gitBlobDigest(
              appCodeRoot,
              applicationCommit,
              pinnedValidatorPath,
            ),
            control_plane_tree_sha: applicationTree,
          },
        };
      },
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /application\.validator_path is not trusted by its recorded app-code commit/i,
  );
});

test("Organization data validator accepts canonical evidence from before manifest introduction", () => {
  const result = runOrganizationDataValidator(
    (dataRoot, { preManifestApplication }) => {
      instantiateOrganizationData(dataRoot, "DEV");
      const changeset = authenticatedPublishedChangeset();
      for (const evidence of [
        changeset.creation_authorization,
        changeset.approval.runtime_authorization,
        changeset.runtime_authorization,
      ]) {
        evidence.application = { ...preManifestApplication };
      }
      changeset.writer_audit_provenance.first_authorization_digest_sha256 =
        jsonDigest(changeset.creation_authorization);
      writeFileSync(
        join(
          dataRoot,
          `data/mission-control/changesets/published/${changeset.id}.json`,
        ),
        `${JSON.stringify(changeset, null, 2)}\n`,
      );
    },
    {
      prepareAppCode(appCodeRoot) {
        return installCurrentPinnedValidatorManifest(appCodeRoot);
      },
    },
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("Organization data validator limits pre-manifest compatibility to the canonical path", () => {
  const result = runOrganizationDataValidator(
    (dataRoot, { preManifestReadmeApplication }) => {
      instantiateOrganizationData(dataRoot, "DEV");
      const changeset = authenticatedPublishedChangeset();
      for (const evidence of [
        changeset.creation_authorization,
        changeset.approval.runtime_authorization,
        changeset.runtime_authorization,
      ]) {
        evidence.application = { ...preManifestReadmeApplication };
      }
      changeset.writer_audit_provenance.first_authorization_digest_sha256 =
        jsonDigest(changeset.creation_authorization);
      writeFileSync(
        join(
          dataRoot,
          `data/mission-control/changesets/published/${changeset.id}.json`,
        ),
        `${JSON.stringify(changeset, null, 2)}\n`,
      );
    },
    {
      prepareAppCode(appCodeRoot) {
        return installCurrentPinnedValidatorManifest(appCodeRoot);
      },
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /application\.validator_path is not covered by the reviewed pre-manifest compatibility authority/i,
  );
});

test("Organization data validator rejects a newly introduced unauthenticated changeset", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    writeFileSync(
      join(
        dataRoot,
        "data/mission-control/changesets/pending/forged-legacy-record.json",
      ),
      `${JSON.stringify({
        schema_version: "companiesascode.mission_control.changeset.v1",
        id: "forged-legacy-record",
        status: "pending",
        summary: "New record must not masquerade as legacy",
        created_at: "2026-07-19T10:00:00.000Z",
        created_by: "organization-user",
        operations: [{
          action: "write_file",
          path: "data/mission-control/reports/forged-legacy-record.txt",
          content: "blocked\n",
        }],
      }, null, 2)}\n`,
    );
  });
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /changeset creation requires authenticated creation_authorization; legacy records require an exact history-backed quarantine entry/i,
  );
});

test("Organization data validator binds admin approval to organization_admin", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const changeset = {
      schema_version: "companiesascode.mission_control.changeset.v1",
      id: "wrong-admin-approval-actor",
      status: "approved",
      summary: "Admin role cannot be caller-asserted",
      created_at: "2026-07-19T10:00:00.000Z",
      created_by: "organization-user",
      operations: [{
        action: "write_file",
        path: "data/mission-control/reports/wrong-admin-approval-actor.txt",
        content: "blocked\n",
      }],
      approval: {
        approved_by: "organization-admin",
        role: "admin",
        approved_at: "2026-07-19T10:05:00.000Z",
        comment: "",
      },
    };
    attachAuthenticatedLifecycle(changeset);
    writeFileSync(
      join(
        dataRoot,
        "data/mission-control/changesets/pending/wrong-admin-approval-actor.json",
      ),
      `${JSON.stringify(changeset, null, 2)}\n`,
    );
  });
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /approval\.approved_by for role admin must equal configured organization_admin/i,
  );
});

test("Organization data validator preserves authenticated terminal admin approval after admin rotation", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const published = authenticatedPublishedChangeset();
    published.approval.approved_by = "organization-steward";
    published.approval.role = "admin";
    published.approval.runtime_authorization.principal.id =
      "organization-steward";
    published.approval.runtime_authorization.principal.role = "admin";

    const approved = JSON.parse(JSON.stringify(published));
    approved.status = "approved";
    delete approved.published_at;
    delete approved.published_by;
    delete approved.credential_authority;
    delete approved.runtime_authorization;
    const pendingPath = join(
      dataRoot,
      `data/mission-control/changesets/pending/${approved.id}.json`,
    );
    writeFileSync(
      pendingPath,
      `${JSON.stringify(approved, null, 2)}\n`,
    );
    commitFixture(dataRoot, "record authenticated admin approval");

    const publishedPath = join(
      dataRoot,
      `data/mission-control/changesets/published/${published.id}.json`,
    );
    rmSync(pendingPath);
    writeFileSync(
      publishedPath,
      `${JSON.stringify(published, null, 2)}\n`,
    );
    commitFixture(dataRoot, "publish authenticated approved changeset");

    const configPath = join(
      dataRoot,
      "data/mission-control/mission-control.config.json",
    );
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.organization_admin = "new-organization-admin";
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    commitFixture(dataRoot, "rotate organization admin");
  });
  assert.equal(
    result.status,
    0,
    `${result.stdout}\n${result.stderr}`,
  );
});

test("Organization data validator fails closed when instantiated Git history is unavailable", () => {
  const result = runOrganizationDataValidator(
    (dataRoot) => {
      instantiateOrganizationData(dataRoot, "DEV");
    },
    { initializeGit: false },
  );
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /authenticated writer audit history is unavailable .* instantiated data repositories require exact immutable Git history/i,
  );
});

test("Organization data validator requires an explicit empty unborn bootstrap mode", () => {
  const blocked = runOrganizationDataValidator(
    (dataRoot) => {
      instantiateOrganizationData(dataRoot, "DEV");
    },
    { initialCommit: false },
  );
  assert.notEqual(blocked.status, 0);
  assert.match(
    `${blocked.stdout}\n${blocked.stderr}`,
    /authenticated writer audit history is unavailable .* instantiated data repositories require exact immutable Git history/i,
  );

  const unpinned = runOrganizationDataValidator(
    (dataRoot) => {
      instantiateOrganizationData(dataRoot, "DEV");
    },
    {
      initialCommit: false,
      allowUnbornBootstrap: true,
      pinnedAppCode: false,
    },
  );
  assert.notEqual(unpinned.status, 0);
  assert.match(
    `${unpinned.stdout}\n${unpinned.stderr}`,
    /allow-unborn-bootstrap requires --pinned-app-code/i,
  );

  const allowed = runOrganizationDataValidator(
    (dataRoot) => {
      instantiateOrganizationData(dataRoot, "DEV");
    },
    {
      initialCommit: false,
      allowUnbornBootstrap: true,
    },
  );
  assert.equal(
    allowed.status,
    0,
    `${allowed.stdout}\n${allowed.stderr}`,
  );

  const nativeWriterAllowed = runOrganizationDataValidator(
    (dataRoot) => {
      instantiateNativeOrganizationData(dataRoot, "DEV");
    },
    {
      initialCommit: false,
      allowUnbornBootstrap: true,
    },
  );
  assert.equal(
    nativeWriterAllowed.status,
    0,
    `${nativeWriterAllowed.stdout}\n${nativeWriterAllowed.stderr}`,
  );

  const nonEmpty = runOrganizationDataValidator(
    (dataRoot) => {
      instantiateOrganizationData(dataRoot, "DEV");
      const id = "bootstrap-cannot-contain-audit";
      writeFileSync(
        join(
          dataRoot,
          `data/mission-control/changesets/pending/${id}.json`,
        ),
        `${JSON.stringify({
          schema_version:
            "companiesascode.mission_control.changeset.v1",
          id,
          status: "pending",
          summary: "Bootstrap must not hide audit history",
          created_at: "2026-07-19T10:00:00.000Z",
          created_by: "organization-user",
          operations: [
            {
              action: "write_file",
              path: `data/mission-control/reports/${id}.txt`,
              content: "blocked\n",
            },
          ],
        }, null, 2)}\n`,
      );
    },
    {
      initialCommit: false,
      allowUnbornBootstrap: true,
    },
  );
  assert.notEqual(nonEmpty.status, 0);
  assert.match(
    `${nonEmpty.stdout}\n${nonEmpty.stderr}`,
    /allow-unborn-bootstrap requires --pinned-app-code and is restricted to a proven never-committed instantiated data repository with no changeset audit records/i,
  );
});

test("Organization data validator does not classify a broken existing HEAD as a fresh repository", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    commitFixture(dataRoot, "initialize instantiated data repository");
    writeFileSync(
      join(dataRoot, ".git/HEAD"),
      "ref: refs/heads/missing-existing-branch\n",
    );
  });
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /authenticated writer audit history is unavailable .* instantiated data repositories require exact immutable Git history/i,
  );
});

test("Organization data validator does not classify deleted refs with historical objects as fresh", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    commitFixture(dataRoot, "initialize data repository before ref loss");
    const branchResult = spawnSync(
      "git",
      ["symbolic-ref", "HEAD"],
      { cwd: dataRoot, encoding: "utf8" },
    );
    assert.equal(branchResult.status, 0);
    const deleteResult = spawnSync(
      "git",
      ["update-ref", "-d", branchResult.stdout.trim()],
      { cwd: dataRoot, encoding: "utf8" },
    );
    assert.equal(deleteResult.status, 0);
  });
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /authenticated writer audit history is unavailable .* instantiated data repositories require exact immutable Git history/i,
  );
});

test("Organization data validator rejects Git replacement refs and grafts", () => {
  for (const replacementKind of ["replace-ref", "graft"]) {
    const result = runOrganizationDataValidator((dataRoot) => {
      instantiateOrganizationData(dataRoot, "DEV");
      commitFixture(dataRoot, "instantiate data repository");
      const head = spawnSync("git", ["rev-parse", "HEAD"], {
        cwd: dataRoot,
        encoding: "utf8",
      }).stdout.trim();
      const parent = spawnSync("git", ["rev-parse", "HEAD^"], {
        cwd: dataRoot,
        encoding: "utf8",
      }).stdout.trim();
      if (replacementKind === "replace-ref") {
        const replaceResult = spawnSync(
          "git",
          ["replace", head, parent],
          { cwd: dataRoot, encoding: "utf8" },
        );
        assert.equal(
          replaceResult.status,
          0,
          replaceResult.stderr,
        );
      } else {
        const infoDirectory = join(dataRoot, ".git/info");
        mkdirSync(infoDirectory, { recursive: true });
        writeFileSync(
          join(infoDirectory, "grafts"),
          `${head} ${parent}\n`,
        );
      }
    });
    assert.notEqual(result.status, 0);
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /replacement refs or grafts are present/i,
    );
  }
});

test("Organization data validator ignores an inherited external graft file", () => {
  const previousGraftFile = process.env.GIT_GRAFT_FILE;
  try {
    const result = runOrganizationDataValidator((dataRoot) => {
      instantiateOrganizationData(dataRoot, "DEV");
      const id = "external-graft-history";
      const legacy = {
        schema_version:
          "companiesascode.mission_control.changeset.v1",
        id,
        status: "pending",
        summary: "External graft must not rewrite trusted history",
        created_at: "2026-07-19T10:00:00.000Z",
        created_by: "organization-user",
        operations: [
          {
            action: "write_file",
            path: `data/mission-control/reports/${id}.txt`,
            content: "canonical history\n",
          },
        ],
      };
      writeFileSync(
        join(
          dataRoot,
          `data/mission-control/changesets/pending/${id}.json`,
        ),
        `${JSON.stringify(legacy, null, 2)}\n`,
      );
      commitFixture(dataRoot, "record external graft baseline");

      const configPath = join(
        dataRoot,
        "data/mission-control/mission-control.config.json",
      );
      const config = JSON.parse(readFileSync(configPath, "utf8"));
      config.publish_policy.legacy_changeset_quarantine = [
        {
          id,
          immutable_payload_digest_sha256: jsonDigest(
            immutableChangesetPayload(legacy),
          ),
          terminal_action: "supersede",
        },
      ];
      writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
      commitFixture(dataRoot, "record external graft quarantine");

      const head = spawnSync("git", ["rev-parse", "HEAD"], {
        cwd: dataRoot,
        encoding: "utf8",
      }).stdout.trim();
      const graftFile = join(dataRoot, "..", "attacker-grafts");
      writeFileSync(graftFile, `${head}\n`);
      const fabricated = spawnSync(
        "git",
        ["rev-list", "--parents", "-n", "1", "HEAD"],
        {
          cwd: dataRoot,
          env: { ...process.env, GIT_GRAFT_FILE: graftFile },
          encoding: "utf8",
        },
      );
      assert.equal(fabricated.status, 0, fabricated.stderr);
      assert.equal(fabricated.stdout.trim(), head);
      process.env.GIT_GRAFT_FILE = graftFile;
    });
    assert.equal(
      result.status,
      0,
      `${result.stdout}\n${result.stderr}`,
    );
  } finally {
    if (previousGraftFile === undefined) {
      delete process.env.GIT_GRAFT_FILE;
    } else {
      process.env.GIT_GRAFT_FILE = previousGraftFile;
    }
  }
});

test("Organization data validator grandfathers exact previously valid authenticated legacy transitions", () => {
  for (const phase of ["approval", "publication", "supersession"]) {
    const result = runOrganizationDataValidator((dataRoot) => {
      instantiateOrganizationData(dataRoot, "DEV");
      const id = `grandfather-legacy-${phase}`;
      const baseline = {
        schema_version:
          "companiesascode.mission_control.changeset.v1",
        id,
        status: phase === "publication" ? "approved" : "pending",
        summary: `Previously valid legacy ${phase}`,
        created_at: "2026-07-19T10:00:00.000Z",
        created_by: "organization-user",
        operations: [
          {
            action: "write_file",
            path: `data/mission-control/reports/${id}.txt`,
            content: "previously supported transition\n",
          },
        ],
      };
      if (phase === "publication") {
        baseline.approval = {
          approved_by: "organization-steward",
          role: "steward",
          approved_at: "2026-07-19T10:05:00.000Z",
          comment: "",
        };
      }
      const pendingPath = join(
        dataRoot,
        `data/mission-control/changesets/pending/${id}.json`,
      );
      writeFileSync(
        pendingPath,
        `${JSON.stringify(baseline, null, 2)}\n`,
      );
      commitFixture(dataRoot, `record legacy ${phase} baseline`);

      const evidence = writerAuditEvidence({
        principalId: "organization-steward",
        principalRole: "steward",
      });
      const authenticated = JSON.parse(JSON.stringify(baseline));
      let authenticatedPath = pendingPath;
      let recordedAt;
      if (phase === "approval") {
        authenticated.status = "approved";
        authenticated.approval = {
          approved_by: "organization-steward",
          role: "steward",
          approved_at: "2026-07-19T10:05:00.000Z",
          comment: "",
          runtime_authorization: evidence,
        };
        recordedAt = authenticated.approval.approved_at;
      } else if (phase === "publication") {
        authenticated.status = "published";
        authenticated.published_at = "2026-07-19T10:10:00.000Z";
        authenticated.published_by = "organization-steward";
        authenticated.credential_authority = {
          writer_id: "organization-scoped-data-writer",
          custody_role: "steward",
          branch: "v3",
          path_allowlist: ["data/mission-control/**"],
        };
        authenticated.runtime_authorization = evidence;
        recordedAt = authenticated.published_at;
        authenticatedPath = join(
          dataRoot,
          `data/mission-control/changesets/published/${id}.json`,
        );
        rmSync(pendingPath);
      } else {
        authenticated.status = "superseded";
        authenticated.supersession = {
          superseded_at: "2026-07-19T10:10:00.000Z",
          superseded_by: "organization-steward",
          role: "steward",
          reason: "Previously supported authenticated supersession.",
          replacement_changeset_id: null,
          runtime_authorization: evidence,
        };
        recordedAt = authenticated.supersession.superseded_at;
        authenticatedPath = join(
          dataRoot,
          `data/mission-control/changesets/superseded/${id}.json`,
        );
        rmSync(pendingPath);
      }
      authenticated.writer_audit_provenance =
        writerAuditProvenance({
          changeset: authenticated,
          phase,
          evidence,
          recordedAt,
          mode: "legacy-transition",
        });
      writeFileSync(
        authenticatedPath,
        `${JSON.stringify(authenticated, null, 2)}\n`,
      );
      commitFixture(
        dataRoot,
        `record previously supported authenticated ${phase}`,
      );

      const configPath = join(
        dataRoot,
        "data/mission-control/mission-control.config.json",
      );
      const config = JSON.parse(readFileSync(configPath, "utf8"));
      if (phase === "approval") {
        config.publish_policy.protected_paths = [
          "data/mission-control/changesets/pending/**",
          "data/mission-control/changesets/published/**",
          "data/mission-control/changesets/superseded/**",
          "data/mission-control/plans/**",
        ];
      }
      config.publish_policy.legacy_changeset_quarantine = [
        {
          id,
          immutable_payload_digest_sha256: jsonDigest(
            immutableChangesetPayload(authenticated),
          ),
          terminal_action: "grandfather-authenticated",
          authenticated_status: authenticated.status,
          record_digest_sha256: jsonDigest(authenticated),
          provenance_digest_sha256: jsonDigest(
            authenticated.writer_audit_provenance,
          ),
        },
      ];
      writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
      commitFixture(
        dataRoot,
        `grandfather authenticated legacy ${phase}`,
      );
    });
    assert.equal(
      result.status,
      0,
      `${phase}\n${result.stdout}\n${result.stderr}`,
    );
  }
});

test("Organization data validator grandfathers a later terminal state with the original pinned provenance", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const id = "grandfather-approval-then-publication";
    const baseline = {
      schema_version:
        "companiesascode.mission_control.changeset.v1",
      id,
      status: "pending",
      summary: "Legacy transition later reached publication",
      created_at: "2026-07-19T10:00:00.000Z",
      created_by: "organization-user",
      operations: [
        {
          action: "write_file",
          path: `data/mission-control/reports/${id}.txt`,
          content: "multi-phase transition\n",
        },
      ],
    };
    const pendingPath = join(
      dataRoot,
      `data/mission-control/changesets/pending/${id}.json`,
    );
    writeFileSync(
      pendingPath,
      `${JSON.stringify(baseline, null, 2)}\n`,
    );
    commitFixture(dataRoot, "record multi-phase legacy baseline");

    const evidence = writerAuditEvidence({
      principalId: "organization-steward",
      principalRole: "steward",
    });
    const approved = {
      ...baseline,
      status: "approved",
      approval: {
        approved_by: "organization-steward",
        role: "steward",
        approved_at: "2026-07-19T10:05:00.000Z",
        comment: "",
        runtime_authorization: evidence,
      },
    };
    approved.writer_audit_provenance = writerAuditProvenance({
      changeset: approved,
      phase: "approval",
      evidence,
      recordedAt: approved.approval.approved_at,
      mode: "legacy-transition",
    });
    writeFileSync(
      pendingPath,
      `${JSON.stringify(approved, null, 2)}\n`,
    );
    commitFixture(dataRoot, "record first authenticated approval");

    const published = {
      ...approved,
      status: "published",
      published_at: "2026-07-19T10:10:00.000Z",
      published_by: "organization-steward",
      credential_authority: {
        writer_id: "organization-scoped-data-writer",
        custody_role: "steward",
        branch: "v3",
        path_allowlist: ["data/mission-control/**"],
      },
      runtime_authorization: evidence,
    };
    const publishedPath = join(
      dataRoot,
      `data/mission-control/changesets/published/${id}.json`,
    );
    rmSync(pendingPath);
    writeFileSync(
      publishedPath,
      `${JSON.stringify(published, null, 2)}\n`,
    );
    commitFixture(dataRoot, "record later authenticated publication");

    const configPath = join(
      dataRoot,
      "data/mission-control/mission-control.config.json",
    );
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.publish_policy.legacy_changeset_quarantine = [
      {
        id,
        immutable_payload_digest_sha256: jsonDigest(
          immutableChangesetPayload(published),
        ),
        terminal_action: "grandfather-authenticated",
        authenticated_status: "published",
        record_digest_sha256: jsonDigest(published),
        provenance_digest_sha256: jsonDigest(
          published.writer_audit_provenance,
        ),
      },
    ];
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    commitFixture(dataRoot, "grandfather final multi-phase audit");
  });
  assert.equal(
    result.status,
    0,
    `${result.stdout}\n${result.stderr}`,
  );
});

test("Organization data validator rejects same-commit authenticated grandfathering", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const id = "same-commit-authenticated-grandfather";
    const baseline = {
      schema_version:
        "companiesascode.mission_control.changeset.v1",
      id,
      status: "pending",
      summary: "Grandfather entry must follow old authenticated audit",
      created_at: "2026-07-19T10:00:00.000Z",
      created_by: "organization-user",
      operations: [
        {
          action: "write_file",
          path: `data/mission-control/reports/${id}.txt`,
          content: "must predate migration\n",
        },
      ],
    };
    const pendingPath = join(
      dataRoot,
      `data/mission-control/changesets/pending/${id}.json`,
    );
    writeFileSync(
      pendingPath,
      `${JSON.stringify(baseline, null, 2)}\n`,
    );
    commitFixture(dataRoot, "record pre-authenticated legacy baseline");

    const evidence = writerAuditEvidence({
      principalId: "organization-steward",
      principalRole: "steward",
    });
    const authenticated = {
      ...baseline,
      status: "approved",
      approval: {
        approved_by: "organization-steward",
        role: "steward",
        approved_at: "2026-07-19T10:05:00.000Z",
        comment: "",
        runtime_authorization: evidence,
      },
    };
    authenticated.writer_audit_provenance =
      writerAuditProvenance({
        changeset: authenticated,
        phase: "approval",
        evidence,
        recordedAt: authenticated.approval.approved_at,
        mode: "legacy-transition",
      });
    writeFileSync(
      pendingPath,
      `${JSON.stringify(authenticated, null, 2)}\n`,
    );
    const configPath = join(
      dataRoot,
      "data/mission-control/mission-control.config.json",
    );
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.publish_policy.legacy_changeset_quarantine = [
      {
        id,
        immutable_payload_digest_sha256: jsonDigest(
          immutableChangesetPayload(authenticated),
        ),
        terminal_action: "grandfather-authenticated",
        authenticated_status: "approved",
        record_digest_sha256: jsonDigest(authenticated),
        provenance_digest_sha256: jsonDigest(
          authenticated.writer_audit_provenance,
        ),
      },
    ];
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    commitFixture(
      dataRoot,
      "forge transition and grandfather entry together",
    );
  });
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /exact already-authenticated predecessor Git history strictly before the quarantine entry|exact already-authenticated record both before and at its introduction commit/i,
  );
});

test("Organization data validator freezes a grandfathered authenticated record", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const id = "grandfathered-authenticated-read-only";
    const baseline = {
      schema_version:
        "companiesascode.mission_control.changeset.v1",
      id,
      status: "pending",
      summary: "Previously authenticated proposal becomes read-only",
      created_at: "2026-07-19T10:00:00.000Z",
      created_by: "organization-user",
      operations: [
        {
          action: "write_file",
          path: `data/mission-control/reports/${id}.txt`,
          content: "historical proposal\n",
        },
      ],
    };
    const pendingPath = join(
      dataRoot,
      `data/mission-control/changesets/pending/${id}.json`,
    );
    writeFileSync(
      pendingPath,
      `${JSON.stringify(baseline, null, 2)}\n`,
    );
    commitFixture(dataRoot, "record legacy proposal");

    const evidence = writerAuditEvidence({
      principalId: "organization-steward",
      principalRole: "steward",
    });
    const authenticated = {
      ...baseline,
      status: "approved",
      approval: {
        approved_by: "organization-steward",
        role: "steward",
        approved_at: "2026-07-19T10:05:00.000Z",
        comment: "",
        runtime_authorization: evidence,
      },
    };
    authenticated.writer_audit_provenance =
      writerAuditProvenance({
        changeset: authenticated,
        phase: "approval",
        evidence,
        recordedAt: authenticated.approval.approved_at,
        mode: "legacy-transition",
      });
    writeFileSync(
      pendingPath,
      `${JSON.stringify(authenticated, null, 2)}\n`,
    );
    commitFixture(dataRoot, "record old supported authenticated approval");

    const configPath = join(
      dataRoot,
      "data/mission-control/mission-control.config.json",
    );
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.publish_policy.legacy_changeset_quarantine = [
      {
        id,
        immutable_payload_digest_sha256: jsonDigest(
          immutableChangesetPayload(authenticated),
        ),
        terminal_action: "grandfather-authenticated",
        authenticated_status: "approved",
        record_digest_sha256: jsonDigest(authenticated),
        provenance_digest_sha256: jsonDigest(
          authenticated.writer_audit_provenance,
        ),
      },
    ];
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    commitFixture(dataRoot, "freeze old authenticated approval");

    authenticated.approval.comment = "Attempted post-migration edit.";
    writeFileSync(
      pendingPath,
      `${JSON.stringify(authenticated, null, 2)}\n`,
    );
    const mutationValidation = spawnSync(
      process.execPath,
      ["scripts/validate-mission-control-data.mjs"],
      {
        cwd: dataRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    assert.notEqual(mutationValidation.status, 0);
    assert.match(
      `${mutationValidation.stdout}\n${mutationValidation.stderr}`,
      /grandfather-authenticated entry must preserve the exact pinned read-only legacy-transition record/i,
    );

    authenticated.approval.comment = "";
    writeFileSync(
      pendingPath,
      `${JSON.stringify(authenticated, null, 2)}\n`,
    );
    const grandfatherEntry = structuredClone(
      config.publish_policy.legacy_changeset_quarantine,
    );
    config.publish_policy.legacy_changeset_quarantine = [];
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    commitFixture(
      dataRoot,
      "attempt to remove persistent authenticated grandfather",
    );
    config.publish_policy.legacy_changeset_quarantine =
      grandfatherEntry;
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    commitFixture(
      dataRoot,
      "attempt to restore persistent authenticated grandfather",
    );
  });
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /committed grandfather-authenticated quarantine entry .* must remain immutable/i,
  );
});

test("Organization data validator binds grandfathering to the immediate pre-authenticated lifecycle state", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const id = "grandfather-cannot-resurrect-terminal-id";
    const baseline = {
      schema_version:
        "companiesascode.mission_control.changeset.v1",
      id,
      status: "pending",
      summary: "A terminal id must not be resurrected",
      created_at: "2026-07-19T10:00:00.000Z",
      created_by: "organization-user",
      operations: [
        {
          action: "write_file",
          path: `data/mission-control/reports/${id}.txt`,
          content: "historical payload\n",
        },
      ],
    };
    const pendingPath = join(
      dataRoot,
      `data/mission-control/changesets/pending/${id}.json`,
    );
    const publishedPath = join(
      dataRoot,
      `data/mission-control/changesets/published/${id}.json`,
    );
    writeFileSync(
      pendingPath,
      `${JSON.stringify(baseline, null, 2)}\n`,
    );
    commitFixture(dataRoot, "record ancient pending proposal");

    const terminal = {
      ...baseline,
      status: "published",
      approval: {
        approved_by: "former-organization-steward",
        role: "steward",
        approved_at: "2026-07-19T10:02:00.000Z",
        comment: "",
      },
      published_at: "2026-07-19T10:03:00.000Z",
      published_by: "former-organization-steward",
      credential_authority: {
        writer_id: "legacy-writer",
        custody_role: "steward",
        branch: "v3",
        path_allowlist: ["data/mission-control/**"],
      },
    };
    rmSync(pendingPath);
    writeFileSync(
      publishedPath,
      `${JSON.stringify(terminal, null, 2)}\n`,
    );
    commitFixture(dataRoot, "make proposal terminal before authentication");

    const evidence = writerAuditEvidence({
      principalId: "organization-steward",
      principalRole: "steward",
    });
    const resurrected = {
      ...baseline,
      status: "approved",
      approval: {
        approved_by: "organization-steward",
        role: "steward",
        approved_at: "2026-07-19T10:05:00.000Z",
        comment: "",
        runtime_authorization: evidence,
      },
    };
    resurrected.writer_audit_provenance =
      writerAuditProvenance({
        changeset: resurrected,
        phase: "approval",
        evidence,
        recordedAt: resurrected.approval.approved_at,
        mode: "legacy-transition",
      });
    rmSync(publishedPath);
    writeFileSync(
      pendingPath,
      `${JSON.stringify(resurrected, null, 2)}\n`,
    );
    commitFixture(dataRoot, "attempt authenticated id resurrection");

    const configPath = join(
      dataRoot,
      "data/mission-control/mission-control.config.json",
    );
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.publish_policy.legacy_changeset_quarantine = [
      {
        id,
        immutable_payload_digest_sha256: jsonDigest(
          immutableChangesetPayload(resurrected),
        ),
        terminal_action: "grandfather-authenticated",
        authenticated_status: "approved",
        record_digest_sha256: jsonDigest(resurrected),
        provenance_digest_sha256: jsonDigest(
          resurrected.writer_audit_provenance,
        ),
      },
    ];
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    commitFixture(dataRoot, "attempt to grandfather resurrected id");
  });
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /requires the phase-compatible original pre-authenticated record in every immediate parent/i,
  );
});

test("Organization data validator retains exact pre-existing terminal legacy audit records", () => {
  for (const terminalStatus of ["published", "superseded"]) {
    const result = runOrganizationDataValidator((dataRoot) => {
      instantiateOrganizationData(dataRoot, "DEV");
      const id = `legacy-retained-${terminalStatus}`;
      const terminal = {
        schema_version: "companiesascode.mission_control.changeset.v1",
        id,
        status: terminalStatus,
        summary: `Retained legacy ${terminalStatus} audit`,
        created_at: "2026-07-18T10:00:00.000Z",
        created_by: "former-organization-user",
        operations: [
          {
            action: "legacy_write",
            path: "../legacy-location.txt",
            content: "historical immutable evidence\n",
          },
        ],
      };
      if (terminalStatus === "published") {
        terminal.approval = {
          approved_by: "former-organization-admin",
          role: "admin",
          approved_at: "2026-07-18T10:05:00.000Z",
          comment: "Historical approval retained verbatim.",
        };
        terminal.published_at = "2026-07-18T10:10:00.000Z";
        terminal.published_by = "former-organization-steward";
        terminal.credential_authority = {
          writer_id: "legacy-writer",
          custody_role: "steward",
          branch: "v3",
          path_allowlist: ["data/mission-control/**"],
        };
      } else {
        terminal.supersession = {
          superseded_at: "2026-07-18T10:10:00.000Z",
          superseded_by: "former-organization-steward",
          role: "steward",
          reason: "Historical terminal audit retained verbatim.",
          replacement_changeset_id: null,
        };
      }
      const directory =
        terminalStatus === "published" ? "published" : "superseded";
      writeFileSync(
        join(
          dataRoot,
          `data/mission-control/changesets/${directory}/${id}.json`,
        ),
        `${JSON.stringify(terminal, null, 2)}\n`,
      );
      commitFixture(dataRoot, `record legacy ${terminalStatus} audit`);

      const configPath = join(
        dataRoot,
        "data/mission-control/mission-control.config.json",
      );
      const config = JSON.parse(readFileSync(configPath, "utf8"));
      config.publish_policy.legacy_changeset_quarantine = [
        {
          id,
          immutable_payload_digest_sha256: jsonDigest(
            immutableChangesetPayload(terminal),
          ),
          terminal_action: "retain",
          terminal_status: terminalStatus,
          record_digest_sha256: jsonDigest(terminal),
        },
      ];
      writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
      commitFixture(
        dataRoot,
        `register retained legacy ${terminalStatus} audit`,
      );
    });
    assert.equal(
      result.status,
      0,
      `${terminalStatus}\n${result.stdout}\n${result.stderr}`,
    );
  }
});

test("Organization data validator rejects mutation of a retained terminal legacy audit", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const id = "legacy-retained-immutable";
    const terminal = {
      schema_version: "companiesascode.mission_control.changeset.v1",
      id,
      status: "superseded",
      summary: "Immutable retained terminal audit",
      created_at: "2026-07-18T10:00:00.000Z",
      created_by: "former-organization-user",
      operations: [
        {
          action: "legacy_write",
          path: "../legacy-location.txt",
          content: "historical immutable evidence\n",
        },
      ],
      supersession: {
        superseded_at: "2026-07-18T10:10:00.000Z",
        superseded_by: "former-organization-steward",
        role: "steward",
        reason: "Original historical reason.",
        replacement_changeset_id: null,
      },
    };
    const recordPath = join(
      dataRoot,
      `data/mission-control/changesets/superseded/${id}.json`,
    );
    writeFileSync(recordPath, `${JSON.stringify(terminal, null, 2)}\n`);
    commitFixture(dataRoot, "record immutable terminal legacy audit");

    const configPath = join(
      dataRoot,
      "data/mission-control/mission-control.config.json",
    );
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.publish_policy.legacy_changeset_quarantine = [
      {
        id,
        immutable_payload_digest_sha256: jsonDigest(
          immutableChangesetPayload(terminal),
        ),
        terminal_action: "retain",
        terminal_status: "superseded",
        record_digest_sha256: jsonDigest(terminal),
      },
    ];
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    commitFixture(dataRoot, "retain immutable terminal legacy audit");

    terminal.supersession.reason = "Tampered historical reason.";
    writeFileSync(recordPath, `${JSON.stringify(terminal, null, 2)}\n`);
  });
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /retained legacy changeset .* must remain the exact frozen unauthenticated superseded record/i,
  );
});

test("Organization data validator preserves a committed retain entry and its terminal audit", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const id = "committed-retain-cannot-disappear";
    const terminal = {
      schema_version: "companiesascode.mission_control.changeset.v1",
      id,
      status: "superseded",
      summary: "Committed retained terminal audit",
      created_at: "2026-07-18T10:00:00.000Z",
      created_by: "former-organization-user",
      operations: [
        {
          action: "legacy_write",
          path: "../legacy-location.txt",
          content: "historical immutable evidence\n",
        },
      ],
      supersession: {
        superseded_at: "2026-07-18T10:10:00.000Z",
        superseded_by: "former-organization-steward",
        role: "steward",
        reason: "Historical terminal audit.",
        replacement_changeset_id: null,
      },
    };
    const recordPath = join(
      dataRoot,
      `data/mission-control/changesets/superseded/${id}.json`,
    );
    writeFileSync(recordPath, `${JSON.stringify(terminal, null, 2)}\n`);
    commitFixture(dataRoot, "record terminal legacy audit");

    const configPath = join(
      dataRoot,
      "data/mission-control/mission-control.config.json",
    );
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.publish_policy.legacy_changeset_quarantine = [
      {
        id,
        immutable_payload_digest_sha256: jsonDigest(
          immutableChangesetPayload(terminal),
        ),
        terminal_action: "retain",
        terminal_status: "superseded",
        record_digest_sha256: jsonDigest(terminal),
      },
    ];
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    commitFixture(dataRoot, "retain terminal legacy audit");

    const retainEntry = structuredClone(
      config.publish_policy.legacy_changeset_quarantine,
    );
    config.publish_policy.legacy_changeset_quarantine = [];
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    rmSync(recordPath);
    commitFixture(dataRoot, "attempt to erase retained terminal audit");
    config.publish_policy.legacy_changeset_quarantine = retainEntry;
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    writeFileSync(recordPath, `${JSON.stringify(terminal, null, 2)}\n`);
    commitFixture(dataRoot, "attempt to restore retained terminal audit");
  });
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /committed retain quarantine entry .* and its terminal audit record must remain immutable/i,
  );
});

test("Organization data validator rejects removal and exact restoration of a retained record", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const id = "retained-record-cannot-return";
    const terminal = {
      schema_version:
        "companiesascode.mission_control.changeset.v1",
      id,
      status: "superseded",
      summary: "Retained record continuity",
      created_at: "2026-07-18T10:00:00.000Z",
      created_by: "former-organization-user",
      operations: [
        {
          action: "legacy_write",
          path: "../legacy-location.txt",
          content: "immutable retained evidence\n",
        },
      ],
      supersession: {
        superseded_at: "2026-07-18T10:10:00.000Z",
        superseded_by: "former-organization-steward",
        role: "steward",
        reason: "Historical terminal audit.",
        replacement_changeset_id: null,
      },
    };
    const recordPath = join(
      dataRoot,
      `data/mission-control/changesets/superseded/${id}.json`,
    );
    writeFileSync(recordPath, `${JSON.stringify(terminal, null, 2)}\n`);
    commitFixture(dataRoot, "record retained continuity baseline");

    const configPath = join(
      dataRoot,
      "data/mission-control/mission-control.config.json",
    );
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.publish_policy.legacy_changeset_quarantine = [
      {
        id,
        immutable_payload_digest_sha256: jsonDigest(
          immutableChangesetPayload(terminal),
        ),
        terminal_action: "retain",
        terminal_status: "superseded",
        record_digest_sha256: jsonDigest(terminal),
      },
    ];
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    commitFixture(dataRoot, "retain continuity baseline");

    rmSync(recordPath);
    commitFixture(dataRoot, "attempt to remove retained record");
    writeFileSync(recordPath, `${JSON.stringify(terminal, null, 2)}\n`);
    commitFixture(dataRoot, "attempt to restore retained record");
  });
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /committed retain quarantine entry .* must remain immutable and continuous/i,
  );
});

test("Organization data validator rejects a retained-record mutation on a pre-quarantine side branch", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const id = "retained-side-branch-mutation";
    const terminal = {
      schema_version:
        "companiesascode.mission_control.changeset.v1",
      id,
      status: "superseded",
      summary: "Retained audit must stay exact across reachable branches",
      created_at: "2026-07-18T10:00:00.000Z",
      created_by: "former-organization-user",
      operations: [
        {
          action: "legacy_write",
          path: "../legacy-location.txt",
          content: "immutable retained evidence\n",
        },
      ],
      supersession: {
        superseded_at: "2026-07-18T10:10:00.000Z",
        superseded_by: "former-organization-steward",
        role: "steward",
        reason: "Historical terminal audit.",
        replacement_changeset_id: null,
      },
    };
    const recordPath = join(
      dataRoot,
      `data/mission-control/changesets/superseded/${id}.json`,
    );
    writeFileSync(recordPath, `${JSON.stringify(terminal, null, 2)}\n`);
    commitFixture(dataRoot, "record terminal legacy audit");
    const mainBranch = spawnSync(
      "git",
      ["branch", "--show-current"],
      { cwd: dataRoot, encoding: "utf8" },
    ).stdout.trim();

    assert.equal(
      spawnSync(
        "git",
        ["switch", "-q", "-c", "retained-side-branch"],
        { cwd: dataRoot },
      ).status,
      0,
    );
    writeFileSync(
      recordPath,
      `${JSON.stringify(
        {
          ...terminal,
          summary: "Mutated terminal audit on a side branch",
        },
        null,
        2,
      )}\n`,
    );
    commitFixture(dataRoot, "mutate retained side-branch audit");
    writeFileSync(recordPath, `${JSON.stringify(terminal, null, 2)}\n`);
    commitFixture(dataRoot, "restore retained side-branch audit");

    assert.equal(
      spawnSync("git", ["switch", "-q", mainBranch], {
        cwd: dataRoot,
      }).status,
      0,
    );
    const configPath = join(
      dataRoot,
      "data/mission-control/mission-control.config.json",
    );
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.publish_policy.legacy_changeset_quarantine = [
      {
        id,
        immutable_payload_digest_sha256: jsonDigest(
          immutableChangesetPayload(terminal),
        ),
        terminal_action: "retain",
        terminal_status: "superseded",
        record_digest_sha256: jsonDigest(terminal),
      },
    ];
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    commitFixture(dataRoot, "retain terminal legacy audit");
    const merge = spawnSync(
      "git",
      [
        ...FIXTURE_GIT_IDENTITY_ARGS,
        "merge",
        "--no-ff",
        "-m",
        "merge restored retained side branch",
        "retained-side-branch",
      ],
      { cwd: dataRoot, encoding: "utf8" },
    );
    assert.equal(merge.status, 0, merge.stderr);
  });
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /committed retain quarantine entry .* must remain immutable and continuous/i,
  );
});

test("Organization data validator requires a legacy record to predate its quarantine entry", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const id = "same-commit-forged-legacy";
    const legacy = {
      schema_version: "companiesascode.mission_control.changeset.v1",
      id,
      status: "pending",
      summary: "Same-commit quarantine must not create legacy history",
      created_at: "2026-07-19T10:00:00.000Z",
      created_by: "organization-user",
      operations: [
        {
          action: "write_file",
          path: `data/mission-control/reports/${id}.txt`,
          content: "must be rejected\n",
        },
      ],
    };
    writeFileSync(
      join(
        dataRoot,
        `data/mission-control/changesets/pending/${id}.json`,
      ),
      `${JSON.stringify(legacy, null, 2)}\n`,
    );
    const configPath = join(
      dataRoot,
      "data/mission-control/mission-control.config.json",
    );
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.publish_policy.legacy_changeset_quarantine = [
      {
        id,
        immutable_payload_digest_sha256: jsonDigest(
          immutableChangesetPayload(legacy),
        ),
        terminal_action: "supersede",
      },
    ];
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    commitFixture(dataRoot, "forge legacy record and quarantine together");
  });
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /requires exact pre-authenticated predecessor Git history strictly before the quarantine entry/i,
  );
});

test("Organization data validator cannot reclassify terminal legacy audit as an active supersede quarantine", () => {
  for (const terminalStatus of ["published", "superseded"]) {
    const result = runOrganizationDataValidator((dataRoot) => {
      instantiateOrganizationData(dataRoot, "DEV");
      const id = `terminal-cannot-return-${terminalStatus}`;
      const pending = {
        schema_version:
          "companiesascode.mission_control.changeset.v1",
        id,
        status: "pending",
        summary: "Terminal legacy audit must stay terminal",
        created_at: "2026-07-18T10:00:00.000Z",
        created_by: "former-organization-user",
        operations: [
          {
            action: "write_file",
            path: `data/mission-control/reports/${id}.txt`,
            content: "historical content\n",
          },
        ],
      };
      const pendingPath = join(
        dataRoot,
        `data/mission-control/changesets/pending/${id}.json`,
      );
      writeFileSync(
        pendingPath,
        `${JSON.stringify(pending, null, 2)}\n`,
      );
      commitFixture(dataRoot, "record original active legacy proposal");

      const terminal = {
        ...pending,
        status: terminalStatus,
      };
      if (terminalStatus === "published") {
        terminal.approval = {
          approved_by: "former-organization-steward",
          role: "steward",
          approved_at: "2026-07-18T10:05:00.000Z",
          comment: "",
        };
        terminal.published_at = "2026-07-18T10:10:00.000Z";
        terminal.published_by = "former-organization-steward";
        terminal.credential_authority = {
          writer_id: "legacy-writer",
          custody_role: "steward",
          branch: "v3",
          path_allowlist: ["data/mission-control/**"],
        };
      } else {
        terminal.supersession = {
          superseded_at: "2026-07-18T10:10:00.000Z",
          superseded_by: "former-organization-steward",
          role: "steward",
          reason: "Historical terminal audit.",
          replacement_changeset_id: null,
        };
      }
      const terminalDirectory =
        terminalStatus === "published" ? "published" : "superseded";
      const terminalPath = join(
        dataRoot,
        `data/mission-control/changesets/${terminalDirectory}/${id}.json`,
      );
      rmSync(pendingPath);
      writeFileSync(
        terminalPath,
        `${JSON.stringify(terminal, null, 2)}\n`,
      );
      commitFixture(dataRoot, `record terminal ${terminalStatus} audit`);

      rmSync(terminalPath);
      writeFileSync(
        pendingPath,
        `${JSON.stringify(pending, null, 2)}\n`,
      );
      commitFixture(
        dataRoot,
        "attempt to resurrect terminal audit before quarantine",
      );
      const configPath = join(
        dataRoot,
        "data/mission-control/mission-control.config.json",
      );
      const config = JSON.parse(readFileSync(configPath, "utf8"));
      config.publish_policy.legacy_changeset_quarantine = [
        {
          id,
          immutable_payload_digest_sha256: jsonDigest(
            immutableChangesetPayload(pending),
          ),
          terminal_action: "supersede",
        },
      ];
      writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
      commitFixture(
        dataRoot,
        "attempt to reclassify terminal audit as active quarantine",
      );
    });
    assert.notEqual(result.status, 0);
    assert.match(
      `${terminalStatus}\n${result.stdout}\n${result.stderr}`,
      /requires exact pre-authenticated predecessor Git history strictly before the quarantine entry/i,
    );
  }
});

test("Organization data validator rejects independent legacy record introductions across quarantine merge parents", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    commitFixture(dataRoot, "configure organization data");
    const baseBranch = spawnSync(
      "git",
      ["branch", "--show-current"],
      { cwd: dataRoot, encoding: "utf8" },
    ).stdout.trim();
    const id = "merge-parent-introduction";
    const legacy = {
      schema_version:
        "companiesascode.mission_control.changeset.v1",
      id,
      status: "pending",
      summary: "One legacy identity needs one shared origin",
      created_at: "2026-07-18T10:00:00.000Z",
      created_by: "organization-user",
      operations: [
        {
          action: "write_file",
          path: `data/mission-control/reports/${id}.txt`,
          content: "independent branch introduction\n",
        },
      ],
    };
    const pendingPath = join(
      dataRoot,
      `data/mission-control/changesets/pending/${id}.json`,
    );

    assert.equal(
      spawnSync("git", ["switch", "-q", "-c", "legacy-left"], {
        cwd: dataRoot,
      }).status,
      0,
    );
    writeFileSync(
      pendingPath,
      `${JSON.stringify(legacy, null, 2)}\n`,
    );
    commitFixture(dataRoot, "introduce legacy record on left");

    assert.equal(
      spawnSync("git", ["switch", "-q", baseBranch], {
        cwd: dataRoot,
      }).status,
      0,
    );
    assert.equal(
      spawnSync("git", ["switch", "-q", "-c", "legacy-right"], {
        cwd: dataRoot,
      }).status,
      0,
    );
    writeFileSync(
      pendingPath,
      `${JSON.stringify(legacy, null, 2)}\n`,
    );
    commitFixture(dataRoot, "introduce legacy record on right");
    const merge = spawnSync(
      "git",
      [
        ...FIXTURE_GIT_IDENTITY_ARGS,
        "merge",
        "--no-commit",
        "--no-ff",
        "legacy-left",
      ],
      { cwd: dataRoot, encoding: "utf8" },
    );
    assert.equal(merge.status, 0, merge.stderr);

    const configPath = join(
      dataRoot,
      "data/mission-control/mission-control.config.json",
    );
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.publish_policy.legacy_changeset_quarantine = [
      {
        id,
        immutable_payload_digest_sha256: jsonDigest(
          immutableChangesetPayload(legacy),
        ),
        terminal_action: "supersede",
      },
    ];
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    commitFixture(dataRoot, "attempt quarantine across two origins");
  });
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /requires exact pre-authenticated predecessor Git history strictly before the quarantine entry/i,
  );
});

test("Organization data validator requires quarantine approval to predate authenticated legacy supersession", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const id = "quarantine-and-transition-same-commit";
    const baseline = {
      schema_version: "companiesascode.mission_control.changeset.v1",
      id,
      status: "pending",
      summary: "Quarantine approval must predate transition",
      created_at: "2026-07-18T10:00:00.000Z",
      created_by: "organization-user",
      operations: [
        {
          action: "legacy_write",
          path: "../historical-legacy-location.txt",
          content: "historical proposal\n",
        },
      ],
    };
    const pendingPath = join(
      dataRoot,
      `data/mission-control/changesets/pending/${id}.json`,
    );
    writeFileSync(
      pendingPath,
      `${JSON.stringify(baseline, null, 2)}\n`,
    );
    commitFixture(dataRoot, "record active legacy proposal");

    const configPath = join(
      dataRoot,
      "data/mission-control/mission-control.config.json",
    );
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.publish_policy.legacy_changeset_quarantine = [
      {
        id,
        immutable_payload_digest_sha256: jsonDigest(
          immutableChangesetPayload(baseline),
        ),
        terminal_action: "supersede",
      },
    ];
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

    const evidence = writerAuditEvidence({
      principalId: "organization-steward",
      principalRole: "steward",
    });
    const transitioned = {
      ...baseline,
      status: "superseded",
      supersession: {
        superseded_at: "2026-07-19T10:10:00.000Z",
        superseded_by: "organization-steward",
        role: "steward",
        reason: "Authenticated transition.",
        replacement_changeset_id: null,
        runtime_authorization: evidence,
      },
    };
    transitioned.writer_audit_provenance = writerAuditProvenance({
      changeset: transitioned,
      phase: "supersession",
      evidence,
      recordedAt: transitioned.supersession.superseded_at,
      mode: "legacy-transition",
    });
    const supersededPath = join(
      dataRoot,
      `data/mission-control/changesets/superseded/${id}.json`,
    );
    rmSync(pendingPath);
    writeFileSync(
      supersededPath,
      `${JSON.stringify(transitioned, null, 2)}\n`,
    );
    commitFixture(
      dataRoot,
      "attempt quarantine approval and transition together",
    );
  });
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /committed quarantine introduction to strictly predate the transition/i,
  );
});

test("Organization data validator requires continuous quarantine and active-record history through authenticated supersession", () => {
  for (const mutation of [
    "record-delete-restore",
    "record-terminal-restore",
    "quarantine-delete-restore",
  ]) {
    const result = runOrganizationDataValidator((dataRoot) => {
      instantiateOrganizationData(dataRoot, "DEV");
      const id = `post-quarantine-${mutation}`;
      const baseline = {
        schema_version:
          "companiesascode.mission_control.changeset.v1",
        id,
        status: "pending",
        summary: "Quarantine continuity must not have gaps",
        created_at: "2026-07-18T10:00:00.000Z",
        created_by: "organization-user",
        operations: [
          {
            action: "legacy_write",
            path: "../historical-legacy-location.txt",
            content: "historical proposal\n",
          },
        ],
      };
      const pendingPath = join(
        dataRoot,
        `data/mission-control/changesets/pending/${id}.json`,
      );
      writeFileSync(
        pendingPath,
        `${JSON.stringify(baseline, null, 2)}\n`,
      );
      commitFixture(dataRoot, "record active legacy proposal");

      const configPath = join(
        dataRoot,
        "data/mission-control/mission-control.config.json",
      );
      const config = JSON.parse(readFileSync(configPath, "utf8"));
      const quarantine = [
        {
          id,
          immutable_payload_digest_sha256: jsonDigest(
            immutableChangesetPayload(baseline),
          ),
          terminal_action: "supersede",
        },
      ];
      config.publish_policy.legacy_changeset_quarantine = quarantine;
      writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
      commitFixture(dataRoot, "approve exact legacy quarantine");

      if (mutation === "record-delete-restore") {
        rmSync(pendingPath);
        commitFixture(dataRoot, "delete quarantined active record");
      } else if (mutation === "record-terminal-restore") {
        const terminalPath = join(
          dataRoot,
          `data/mission-control/changesets/superseded/${id}.json`,
        );
        rmSync(pendingPath);
        writeFileSync(
          terminalPath,
          `${JSON.stringify(
            {
              ...baseline,
              status: "superseded",
              supersession: {
                superseded_at: "2026-07-18T10:05:00.000Z",
                superseded_by: "former-organization-steward",
                role: "steward",
                reason: "Unauthenticated terminal detour.",
                replacement_changeset_id: null,
              },
            },
            null,
            2,
          )}\n`,
        );
        commitFixture(
          dataRoot,
          "make quarantined record terminal without authentication",
        );
        rmSync(terminalPath);
      } else {
        config.publish_policy.legacy_changeset_quarantine = [];
        writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
        commitFixture(dataRoot, "delete quarantine entry");
        config.publish_policy.legacy_changeset_quarantine = quarantine;
        writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
      }
      writeFileSync(
        pendingPath,
        `${JSON.stringify(baseline, null, 2)}\n`,
      );
      commitFixture(dataRoot, "attempt exact quarantine restoration");

      const evidence = writerAuditEvidence({
        principalId: "organization-steward",
        principalRole: "steward",
      });
      const transitioned = {
        ...baseline,
        status: "superseded",
        supersession: {
          superseded_at: "2026-07-19T10:10:00.000Z",
          superseded_by: "organization-steward",
          role: "steward",
          reason: "Authenticated transition.",
          replacement_changeset_id: null,
          runtime_authorization: evidence,
        },
      };
      transitioned.writer_audit_provenance = writerAuditProvenance({
        changeset: transitioned,
        phase: "supersession",
        evidence,
        recordedAt: transitioned.supersession.superseded_at,
        mode: "legacy-transition",
      });
      rmSync(pendingPath);
      writeFileSync(
        join(
          dataRoot,
          `data/mission-control/changesets/superseded/${id}.json`,
        ),
        `${JSON.stringify(transitioned, null, 2)}\n`,
      );
    });
    assert.notEqual(result.status, 0);
    assert.match(
      `${mutation}\n${result.stdout}\n${result.stderr}`,
      /requires exact pre-authenticated predecessor Git history strictly before the quarantine entry/i,
    );
  }
});

test("Organization data validator rejects a pre-quarantine side-branch terminal detour merged after quarantine", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const id = "pre-quarantine-side-terminal";
    const baseline = {
      schema_version:
        "companiesascode.mission_control.changeset.v1",
      id,
      status: "pending",
      summary: "Reachable side branches must preserve active history",
      created_at: "2026-07-18T10:00:00.000Z",
      created_by: "organization-user",
      operations: [
        {
          action: "legacy_write",
          path: "../historical-legacy-location.txt",
          content: "historical proposal\n",
        },
      ],
    };
    const pendingPath = join(
      dataRoot,
      `data/mission-control/changesets/pending/${id}.json`,
    );
    const terminalPath = join(
      dataRoot,
      `data/mission-control/changesets/superseded/${id}.json`,
    );
    writeFileSync(
      pendingPath,
      `${JSON.stringify(baseline, null, 2)}\n`,
    );
    commitFixture(dataRoot, "record active legacy proposal");
    const mainBranch = spawnSync(
      "git",
      ["branch", "--show-current"],
      { cwd: dataRoot, encoding: "utf8" },
    ).stdout.trim();

    assert.equal(
      spawnSync(
        "git",
        ["switch", "-q", "-c", "pre-quarantine-side"],
        { cwd: dataRoot },
      ).status,
      0,
    );
    rmSync(pendingPath);
    writeFileSync(
      terminalPath,
      `${JSON.stringify(
        {
          ...baseline,
          status: "superseded",
          supersession: {
            superseded_at: "2026-07-18T10:05:00.000Z",
            superseded_by: "former-organization-steward",
            role: "steward",
            reason: "Hidden side-branch terminal state.",
            replacement_changeset_id: null,
          },
        },
        null,
        2,
      )}\n`,
    );
    commitFixture(dataRoot, "make side-branch record terminal");
    rmSync(terminalPath);
    writeFileSync(
      pendingPath,
      `${JSON.stringify(baseline, null, 2)}\n`,
    );
    commitFixture(dataRoot, "restore side-branch active record");

    assert.equal(
      spawnSync("git", ["switch", "-q", mainBranch], {
        cwd: dataRoot,
      }).status,
      0,
    );
    const configPath = join(
      dataRoot,
      "data/mission-control/mission-control.config.json",
    );
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.publish_policy.legacy_changeset_quarantine = [
      {
        id,
        immutable_payload_digest_sha256: jsonDigest(
          immutableChangesetPayload(baseline),
        ),
        terminal_action: "supersede",
      },
    ];
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    commitFixture(dataRoot, "approve exact legacy quarantine");
    const merge = spawnSync(
      "git",
      [
        ...FIXTURE_GIT_IDENTITY_ARGS,
        "merge",
        "--no-ff",
        "-m",
        "merge restored side branch",
        "pre-quarantine-side",
      ],
      { cwd: dataRoot, encoding: "utf8" },
    );
    assert.equal(merge.status, 0, merge.stderr);

    const evidence = writerAuditEvidence({
      principalId: "organization-steward",
      principalRole: "steward",
    });
    const transitioned = {
      ...baseline,
      status: "superseded",
      supersession: {
        superseded_at: "2026-07-19T10:10:00.000Z",
        superseded_by: "organization-steward",
        role: "steward",
        reason: "Authenticated transition.",
        replacement_changeset_id: null,
        runtime_authorization: evidence,
      },
    };
    transitioned.writer_audit_provenance = writerAuditProvenance({
      changeset: transitioned,
      phase: "supersession",
      evidence,
      recordedAt: transitioned.supersession.superseded_at,
      mode: "legacy-transition",
    });
    rmSync(pendingPath);
    writeFileSync(
      terminalPath,
      `${JSON.stringify(transitioned, null, 2)}\n`,
    );
  });
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /requires exact pre-authenticated predecessor Git history strictly before the quarantine entry/i,
  );
});

test("Organization data validator quarantines exact legacy records for authenticated supersession only", () => {
  for (const phase of [
    "approval",
    "publication",
    "supersession",
    "supersession-narrow-scope",
  ]) {
    const result = runOrganizationDataValidator((dataRoot) => {
      instantiateOrganizationData(dataRoot, "DEV");
      const id = `legacy-transition-${phase}`;
      const isSupersession = phase.startsWith("supersession");
      const operation =
        isSupersession
          ? {
              action: "legacy_write",
              path: "../historical-legacy-location.txt",
              content: "legacy transition\n",
            }
          : {
              action: "write_file",
              path: `data/mission-control/reports/${id}.txt`,
              content: "legacy transition\n",
            };
      const baseline = {
        schema_version: "companiesascode.mission_control.changeset.v1",
        id,
        status: phase === "publication" ? "approved" : "pending",
        summary: `Legacy transition ${phase}`,
        created_at: "2026-07-19T10:00:00.000Z",
        created_by: "organization-user",
        operations: [operation],
      };
      if (phase === "publication") {
        baseline.approval = {
          approved_by: "organization-steward",
          role: "steward",
          approved_at: "2026-07-19T10:05:00.000Z",
          comment: "",
        };
      }
      const pendingPath = join(
        dataRoot,
        `data/mission-control/changesets/pending/${id}.json`,
      );
      writeFileSync(
        pendingPath,
        `${JSON.stringify(baseline, null, 2)}\n`,
      );
      assert.equal(
        spawnSync("git", ["add", "."], { cwd: dataRoot }).status,
        0,
      );
      assert.equal(
        spawnSync(
          "git",
          [
            "-c",
            "user.name=Mission Control Validator Test",
            "-c",
            "user.email=validator@example.invalid",
            "commit",
            "-q",
            "-m",
            `legacy ${phase} baseline`,
          ],
          { cwd: dataRoot },
        ).status,
        0,
      );
      const configPath = join(
        dataRoot,
        "data/mission-control/mission-control.config.json",
      );
      const config = JSON.parse(readFileSync(configPath, "utf8"));
      config.publish_policy.legacy_changeset_quarantine = [
        {
          id,
          immutable_payload_digest_sha256: jsonDigest(
            immutableChangesetPayload(baseline),
          ),
          terminal_action: "supersede",
        },
      ];
      writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
      if (isSupersession) {
        commitFixture(
          dataRoot,
          "approve exact legacy quarantine before supersession",
        );
      }

      const evidence = writerAuditEvidence({
        principalId: "organization-steward",
        principalRole: "steward",
      });
      if (phase === "supersession-narrow-scope") {
        evidence.scope.path_allowlist = [
          "data/mission-control/reports/**",
        ];
      }
      const current = JSON.parse(JSON.stringify(baseline));
      let currentPath = pendingPath;
      let recordedAt;
      if (phase === "approval") {
        current.status = "approved";
        current.approval = {
          approved_by: "organization-steward",
          role: "steward",
          approved_at: "2026-07-19T10:05:00.000Z",
          comment: "",
          runtime_authorization: evidence,
        };
        recordedAt = current.approval.approved_at;
      } else if (phase === "publication") {
        current.status = "published";
        current.published_at = "2026-07-19T10:10:00.000Z";
        current.published_by = "organization-steward";
        current.credential_authority = {
          writer_id: "organization-scoped-data-writer",
          custody_role: "steward",
          branch: "v3",
          path_allowlist: ["data/mission-control/**"],
        };
        current.runtime_authorization = evidence;
        recordedAt = current.published_at;
        currentPath = join(
          dataRoot,
          `data/mission-control/changesets/published/${id}.json`,
        );
      } else {
        current.status = "superseded";
        current.supersession = {
          superseded_at: "2026-07-19T10:10:00.000Z",
          superseded_by: "organization-steward",
          role: "steward",
          reason: "Nahrazeno autentizovaným writerem.",
          replacement_changeset_id: null,
          runtime_authorization: evidence,
        };
        recordedAt = current.supersession.superseded_at;
        currentPath = join(
          dataRoot,
          `data/mission-control/changesets/superseded/${id}.json`,
        );
      }
      current.writer_audit_provenance = writerAuditProvenance({
        changeset: current,
        phase: isSupersession ? "supersession" : phase,
        evidence,
        recordedAt,
        mode: "legacy-transition",
      });
      if (currentPath !== pendingPath) rmSync(pendingPath);
      writeFileSync(
        currentPath,
        `${JSON.stringify(current, null, 2)}\n`,
      );
    });
    if (phase === "supersession") {
      assert.equal(
        result.status,
        0,
        `${phase}\n${result.stdout}\n${result.stderr}`,
      );
    } else if (phase === "supersession-narrow-scope") {
      assert.notEqual(result.status, 0);
      assert.match(
        `${result.stdout}\n${result.stderr}`,
        /scope\.path_allowlist does not cover operation data\/mission-control\/changesets\/(?:pending|superseded)\//i,
      );
    } else {
      assert.notEqual(result.status, 0);
      assert.match(
        `${result.stdout}\n${result.stderr}`,
        /quarantined legacy changeset .* may only (?:enter an authenticated superseded state|be superseded, never published)/i,
      );
    }
  }
});

test("Organization data validator rejects forged or incomplete writer audit", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const changeset = authenticatedPublishedChangeset();
    changeset.runtime_authorization.principal.id = "forged-principal";
    changeset.runtime_authorization.credential.private_key =
      "must-never-be-persisted";
    delete changeset.approval.runtime_authorization;
    writeFileSync(
      join(
        dataRoot,
        `data/mission-control/changesets/published/${changeset.id}.json`,
      ),
      `${JSON.stringify(changeset, null, 2)}\n`,
    );
  });
  assert.notEqual(result.status, 0);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, /credential.*must NOT have additional properties/i);
  assert.match(
    output,
    /authenticated lifecycle from creation requires approval runtime authorization/i,
  );
});

test("Organization data validator preserves authenticated audit provenance from Git history", () => {
  for (const mutation of [
    "strip",
    "strip-two-commits",
    "delete",
    "delete-restore",
    "rewrite-evidence",
    "rewrite-payload",
    "rewrite-payload-restore",
  ]) {
    const result = runOrganizationDataValidator((dataRoot) => {
      instantiateOrganizationData(dataRoot, "DEV");
      const changeset = authenticatedPublishedChangeset();
      const originalChangeset = structuredClone(changeset);
      const changesetPath = join(
        dataRoot,
        `data/mission-control/changesets/published/${changeset.id}.json`,
      );
      writeFileSync(
        changesetPath,
        `${JSON.stringify(changeset, null, 2)}\n`,
      );
      assert.equal(
        spawnSync("git", ["add", "."], { cwd: dataRoot }).status,
        0,
      );
      assert.equal(
        spawnSync(
          "git",
          [
            "-c",
            "user.name=Mission Control Validator Test",
            "-c",
            "user.email=validator@example.invalid",
            "commit",
            "-q",
            "-m",
            "authenticated audit baseline",
          ],
          { cwd: dataRoot },
        ).status,
        0,
      );
      if (mutation === "delete") {
        rmSync(changesetPath);
        return;
      }
      if (mutation === "delete-restore") {
        rmSync(changesetPath);
        commitFixture(dataRoot, "delete authenticated audit");
        writeFileSync(
          changesetPath,
          `${JSON.stringify(originalChangeset, null, 2)}\n`,
        );
        commitFixture(dataRoot, "attempt to restore authenticated audit");
        return;
      }
      if (mutation === "strip" || mutation === "strip-two-commits") {
        delete changeset.writer_audit_provenance;
        delete changeset.creation_authorization;
        delete changeset.approval.runtime_authorization;
        delete changeset.runtime_authorization;
      } else if (mutation === "rewrite-evidence") {
        changeset.creation_authorization.authorization_source.issue_id =
          "forged-issue";
      } else {
        changeset.operations[0].content = "rewritten after authentication\n";
      }
      writeFileSync(
        changesetPath,
        `${JSON.stringify(changeset, null, 2)}\n`,
      );
      if (mutation === "rewrite-payload-restore") {
        commitFixture(dataRoot, "rewrite authenticated payload");
        writeFileSync(
          changesetPath,
          `${JSON.stringify(originalChangeset, null, 2)}\n`,
        );
        commitFixture(
          dataRoot,
          "attempt to restore authenticated payload",
        );
        return;
      }
      if (mutation === "strip-two-commits") {
        assert.equal(
          spawnSync("git", ["add", "."], { cwd: dataRoot }).status,
          0,
        );
        assert.equal(
          spawnSync(
            "git",
            [
              "-c",
              "user.name=Mission Control Validator Test",
              "-c",
              "user.email=validator@example.invalid",
              "commit",
              "-q",
              "-m",
              "strip authenticated evidence",
            ],
            { cwd: dataRoot },
          ).status,
          0,
        );
        writeFileSync(
          join(
            dataRoot,
            "data/mission-control/reports/unrelated-after-strip.txt",
          ),
          "unrelated second commit\n",
        );
        assert.equal(
          spawnSync("git", ["add", "."], { cwd: dataRoot }).status,
          0,
        );
        assert.equal(
          spawnSync(
            "git",
            [
              "-c",
              "user.name=Mission Control Validator Test",
              "-c",
              "user.email=validator@example.invalid",
              "commit",
              "-q",
              "-m",
              "unrelated follow-up",
            ],
            { cwd: dataRoot },
          ).status,
          0,
        );
      }
    });
    assert.notEqual(result.status, 0);
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      mutation === "delete"
        ? /authenticated changeset authenticated-publication must not be deleted/i
        : mutation === "delete-restore" ||
            mutation === "rewrite-payload-restore"
          ? /must remain continuously present on one canonical audit path with self-bound provenance and a monotonic lifecycle/i
        : mutation === "strip" || mutation === "strip-two-commits"
          ? /authenticated changeset authenticated-publication must retain writer_audit_provenance/i
          : mutation === "rewrite-evidence"
            ? /first_authorization_digest_sha256 must equal first authenticated creation evidence/i
            : /changeset_payload_digest_sha256 must equal immutable changeset payload/i,
    );
  }
});

test("Organization data validator preserves exact authenticated lifecycle metadata across phases", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const published = authenticatedPublishedChangeset();
    const pending = structuredClone(published);
    pending.status = "pending";
    delete pending.approval;
    delete pending.published_at;
    delete pending.published_by;
    delete pending.credential_authority;
    delete pending.runtime_authorization;
    const pendingPath = join(
      dataRoot,
      `data/mission-control/changesets/pending/${pending.id}.json`,
    );
    writeFileSync(
      pendingPath,
      `${JSON.stringify(pending, null, 2)}\n`,
    );
    commitFixture(dataRoot, "record authenticated pending proposal");

    const forgedApproval = structuredClone(pending);
    forgedApproval.status = "approved";
    forgedApproval.approval = structuredClone(published.approval);
    forgedApproval.approval.approved_by = "forged-approver";
    forgedApproval.approval.role = "admin";
    forgedApproval.approval.comment = "forged historical metadata";
    writeFileSync(
      pendingPath,
      `${JSON.stringify(forgedApproval, null, 2)}\n`,
    );
    commitFixture(dataRoot, "forge authenticated approval metadata");

    rmSync(pendingPath);
    writeFileSync(
      join(
        dataRoot,
        `data/mission-control/changesets/published/${published.id}.json`,
      ),
      `${JSON.stringify(published, null, 2)}\n`,
    );
    commitFixture(dataRoot, "attempt corrected authenticated publication");
  });
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /must remain continuously present on one canonical audit path with self-bound provenance and a monotonic lifecycle/i,
  );
});

test("Organization data validator rejects pre-staged lifecycle metadata in authenticated history", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const published = authenticatedPublishedChangeset();
    const preStagedPending = structuredClone(published);
    preStagedPending.status = "pending";
    delete preStagedPending.published_at;
    delete preStagedPending.published_by;
    delete preStagedPending.credential_authority;
    delete preStagedPending.runtime_authorization;
    const pendingPath = join(
      dataRoot,
      `data/mission-control/changesets/pending/${published.id}.json`,
    );
    writeFileSync(
      pendingPath,
      `${JSON.stringify(preStagedPending, null, 2)}\n`,
    );
    commitFixture(
      dataRoot,
      "pre-stage approval metadata on authenticated pending record",
    );

    rmSync(pendingPath);
    writeFileSync(
      join(
        dataRoot,
        `data/mission-control/changesets/published/${published.id}.json`,
      ),
      `${JSON.stringify(published, null, 2)}\n`,
    );
    commitFixture(dataRoot, "attempt corrected publication lifecycle");
  });
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /must remain continuously present on one canonical audit path with self-bound provenance and a monotonic lifecycle/i,
  );
});

test("Organization data validator cannot relabel a pre-existing legacy record as an authenticated creation", () => {
  for (const commitRelabel of [false, true]) {
    const result = runOrganizationDataValidator((dataRoot) => {
      instantiateOrganizationData(dataRoot, "DEV");
      const authenticated = authenticatedPublishedChangeset();
      const pending = structuredClone(authenticated);
      pending.status = "pending";
      delete pending.approval;
      delete pending.published_at;
      delete pending.published_by;
      delete pending.credential_authority;
      delete pending.runtime_authorization;
      delete pending.creation_authorization;
      delete pending.writer_audit_provenance;
      const pendingPath = join(
        dataRoot,
        `data/mission-control/changesets/pending/${pending.id}.json`,
      );
      writeFileSync(
        pendingPath,
        `${JSON.stringify(pending, null, 2)}\n`,
      );
      commitFixture(dataRoot, "record pre-authenticated legacy proposal");

      pending.creation_authorization =
        authenticated.creation_authorization;
      pending.writer_audit_provenance = writerAuditProvenance({
        changeset: pending,
        phase: "creation",
        evidence: pending.creation_authorization,
        recordedAt: pending.created_at,
        mode: "authenticated",
      });
      writeFileSync(
        pendingPath,
        `${JSON.stringify(pending, null, 2)}\n`,
      );
      if (commitRelabel) {
        commitFixture(
          dataRoot,
          "attempt to relabel legacy proposal as authenticated creation",
        );
      }
    });
    assert.notEqual(result.status, 0);
    assert.match(
      `${commitRelabel}\n${result.stdout}\n${result.stderr}`,
      /cannot relabel a pre-existing unauthenticated Git record|must remain continuously present on one canonical audit path with self-bound provenance and a monotonic lifecycle/i,
    );
  }
});

test("Organization data validator rejects independent authenticated introductions hidden by a merge", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    commitFixture(dataRoot, "configure organization data");
    const baseBranch = spawnSync(
      "git",
      ["branch", "--show-current"],
      { cwd: dataRoot, encoding: "utf8" },
    ).stdout.trim();
    const changeset = authenticatedPublishedChangeset();
    const changesetPath = join(
      dataRoot,
      `data/mission-control/changesets/published/${changeset.id}.json`,
    );

    assert.equal(
      spawnSync("git", ["switch", "-q", "-c", "authenticated-left"], {
        cwd: dataRoot,
      }).status,
      0,
    );
    writeFileSync(
      changesetPath,
      `${JSON.stringify(changeset, null, 2)}\n`,
    );
    commitFixture(dataRoot, "introduce authenticated audit on left");

    assert.equal(
      spawnSync("git", ["switch", "-q", baseBranch], {
        cwd: dataRoot,
      }).status,
      0,
    );
    assert.equal(
      spawnSync(
        "git",
        ["switch", "-q", "-c", "authenticated-right"],
        { cwd: dataRoot },
      ).status,
      0,
    );
    writeFileSync(
      changesetPath,
      `${JSON.stringify(changeset, null, 2)}\n`,
    );
    commitFixture(dataRoot, "introduce authenticated audit on right");
    const merge = spawnSync(
      "git",
      [
        ...FIXTURE_GIT_IDENTITY_ARGS,
        "merge",
        "--no-commit",
        "--no-ff",
        "authenticated-left",
      ],
      { cwd: dataRoot, encoding: "utf8" },
    );
    assert.equal(merge.status, 0, merge.stderr);
    commitFixture(dataRoot, "merge two authenticated origins");
  });
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /must remain continuously present on one canonical audit path with self-bound provenance and a monotonic lifecycle/i,
  );
});

test("Organization data validator binds writer audit to the configured data repository", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const changeset = authenticatedPublishedChangeset();
    changeset.runtime_authorization.scope.data_repository =
      "OtherOrganization/mission-control-data";
    writeFileSync(
      join(
        dataRoot,
        `data/mission-control/changesets/published/${changeset.id}.json`,
      ),
      `${JSON.stringify(changeset, null, 2)}\n`,
    );
  });
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /runtime_authorization: scope\.data_repository must match repository-db\.yaml data_repo\.remote \(ExampleOrganization\/mission-control-data\)/i,
  );
});

test("Organization data validator binds recorded custody to writer authorization", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const changeset = authenticatedPublishedChangeset();
    changeset.runtime_authorization.credential.custody_role = "admin";
    writeFileSync(
      join(
        dataRoot,
        `data/mission-control/changesets/published/${changeset.id}.json`,
      ),
      `${JSON.stringify(changeset, null, 2)}\n`,
    );
  });
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /runtime_authorization scope and custody must equal credential_authority/i,
  );
});

test("Organization data validator binds superseded writer audit to both transition paths", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const changeset = authenticatedPublishedChangeset();
    changeset.status = "superseded";
    delete changeset.published_at;
    delete changeset.published_by;
    delete changeset.credential_authority;
    delete changeset.runtime_authorization;
    const supersessionAuthorization = writerAuditEvidence({
      principalId: "organization-steward",
      principalRole: "steward",
    });
    supersessionAuthorization.scope.path_allowlist = [
      "data/mission-control/ISSUES.open.json",
    ];
    changeset.supersession = {
      superseded_at: "2026-07-19T10:10:00.000Z",
      superseded_by: "organization-steward",
      role: "steward",
      reason: "Nahrazeno novým schváleným záměrem.",
      replacement_changeset_id: null,
      runtime_authorization: supersessionAuthorization,
    };
    writeFileSync(
      join(
        dataRoot,
        `data/mission-control/changesets/superseded/${changeset.id}.json`,
      ),
      `${JSON.stringify(changeset, null, 2)}\n`,
    );
  });
  assert.notEqual(result.status, 0);
  for (const state of ["pending", "superseded"]) {
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      new RegExp(
        `supersession\\.runtime_authorization: scope\\.path_allowlist does not cover operation data/mission-control/changesets/${state}/authenticated-publication\\.json`,
        "i",
      ),
    );
  }
});

test("Organization data validator preserves committed pre-manifest supersession scope", () => {
  const result = runOrganizationDataValidator(
    (dataRoot, { preManifestApplication }) => {
      instantiateOrganizationData(dataRoot, "DEV");
      const changeset = preManifestDomainScopedSupersededChangeset(
        preManifestApplication,
      );
      writeFileSync(
        join(
          dataRoot,
          `data/mission-control/changesets/superseded/${changeset.id}.json`,
        ),
        `${JSON.stringify(changeset, null, 2)}\n`,
      );
      commitFixture(
        dataRoot,
        "record supersession with the pre-manifest domain scope",
      );
      const configPath = join(
        dataRoot,
        "data/mission-control/mission-control.config.json",
      );
      const config = JSON.parse(readFileSync(configPath, "utf8"));
      config.publish_policy.legacy_changeset_quarantine = [
        {
          id: changeset.id,
          immutable_payload_digest_sha256: jsonDigest(
            immutableChangesetPayload(changeset),
          ),
          terminal_action: "grandfather-supersession-scope",
          record_digest_sha256: jsonDigest(changeset),
          provenance_digest_sha256: jsonDigest(
            changeset.writer_audit_provenance,
          ),
        },
      ];
      writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
      commitFixture(
        dataRoot,
        "grandfather the historical supersession scope",
      );
    },
    {
      prepareAppCode(appCodeRoot) {
        return installCurrentPinnedValidatorManifest(appCodeRoot);
      },
    },
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("Organization data validator rejects same-commit supersession scope grandfathering", () => {
  const result = runOrganizationDataValidator(
    (dataRoot, { preManifestApplication }) => {
      instantiateOrganizationData(dataRoot, "DEV");
      const changeset = preManifestDomainScopedSupersededChangeset(
        preManifestApplication,
      );
      writeFileSync(
        join(
          dataRoot,
          `data/mission-control/changesets/superseded/${changeset.id}.json`,
        ),
        `${JSON.stringify(changeset, null, 2)}\n`,
      );
      const configPath = join(
        dataRoot,
        "data/mission-control/mission-control.config.json",
      );
      const config = JSON.parse(readFileSync(configPath, "utf8"));
      config.publish_policy.legacy_changeset_quarantine = [
        {
          id: changeset.id,
          immutable_payload_digest_sha256: jsonDigest(
            immutableChangesetPayload(changeset),
          ),
          terminal_action: "grandfather-supersession-scope",
          record_digest_sha256: jsonDigest(changeset),
          provenance_digest_sha256: jsonDigest(
            changeset.writer_audit_provenance,
          ),
        },
      ];
      writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
      commitFixture(
        dataRoot,
        "attempt to self-grandfather a supersession scope",
      );
    },
    {
      prepareAppCode(appCodeRoot) {
        return installCurrentPinnedValidatorManifest(appCodeRoot);
      },
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /exact already-authenticated predecessor Git history strictly before the quarantine entry|grandfather-supersession-scope quarantine entry .* must remain immutable and continuous/i,
  );
});

test("Organization data validator denies pre-manifest scope fallback to an uncommitted supersession", () => {
  const result = runOrganizationDataValidator(
    (dataRoot, { preManifestApplication }) => {
      instantiateOrganizationData(dataRoot, "DEV");
      const changeset = preManifestDomainScopedSupersededChangeset(
        preManifestApplication,
      );
      writeFileSync(
        join(
          dataRoot,
          `data/mission-control/changesets/superseded/${changeset.id}.json`,
        ),
        `${JSON.stringify(changeset, null, 2)}\n`,
      );
    },
    {
      prepareAppCode(appCodeRoot) {
        return installCurrentPinnedValidatorManifest(appCodeRoot);
      },
    },
  );
  assert.notEqual(result.status, 0);
  for (const state of ["pending", "superseded"]) {
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      new RegExp(
        `supersession\\.runtime_authorization: scope\\.path_allowlist does not cover operation data/mission-control/changesets/${state}/authenticated-publication\\.json`,
        "i",
      ),
    );
  }
});

test("Organization data validator requires chronological audit histories", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const operation = (id) => [{
      action: "write_file",
      path: `data/mission-control/reports/${id}.txt`,
      content: "blocked\n",
    }];
    writeFileSync(
      join(dataRoot, "data/mission-control/changesets/pending/approval-before-creation.json"),
      `${JSON.stringify({
        schema_version: "companiesascode.mission_control.changeset.v1",
        id: "approval-before-creation",
        status: "approved",
        summary: "Approval before creation",
        created_at: "2026-07-19T10:00:00.000000002Z",
        created_by: "template-builder",
        operations: operation("approval-before-creation"),
        approval: {
          approved_by: "template-steward",
          role: "steward",
          approved_at: "2026-07-19T10:00:00.000000001Z",
          comment: "",
        },
      }, null, 2)}\n`,
    );
    writeFileSync(
      join(dataRoot, "data/mission-control/changesets/published/publication-before-approval.json"),
      `${JSON.stringify({
        schema_version: "companiesascode.mission_control.changeset.v1",
        id: "publication-before-approval",
        status: "published",
        summary: "Publication before approval",
        created_at: "2026-07-19T10:00:00.000000000Z",
        created_by: "template-builder",
        operations: operation("publication-before-approval"),
        approval: {
          approved_by: "template-steward",
          role: "steward",
          approved_at: "2026-07-19T10:00:00.000000002Z",
          comment: "",
        },
        published_at: "2026-07-19T10:00:00.000000001Z",
        published_by: "template-steward",
        credential_authority: {
          writer_id: "template-writer",
          custody_role: "steward",
          branch: "v3",
          path_allowlist: ["data/mission-control/**"],
        },
      }, null, 2)}\n`,
    );
    writeFileSync(
      join(dataRoot, "data/mission-control/changesets/superseded/supersession-before-approval.json"),
      `${JSON.stringify({
        schema_version: "companiesascode.mission_control.changeset.v1",
        id: "supersession-before-approval",
        status: "superseded",
        summary: "Supersession before approval",
        created_at: "2026-07-19T10:00:00.000000000Z",
        created_by: "template-builder",
        operations: operation("supersession-before-approval"),
        approval: {
          approved_by: "template-steward",
          role: "steward",
          approved_at: "2026-07-19T10:00:00.000000002Z",
          comment: "",
        },
        supersession: {
          superseded_at: "2026-07-19T10:00:00.000000001Z",
          superseded_by: "template-steward",
          role: "steward",
          reason: "Invalid audit order.",
          replacement_changeset_id: null,
        },
      }, null, 2)}\n`,
    );
  });
  assert.notEqual(result.status, 0);
  for (const pattern of [
    /approval\.approved_at must not precede created_at/,
    /published_at must not precede approval\.approved_at/,
    /supersession\.superseded_at must not precede approval\.approved_at/,
  ]) {
    assert.match(`${result.stdout}\n${result.stderr}`, pattern);
  }
});

test("Organization data validator binds published operations to recorded credential scope", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    writeFileSync(
      join(dataRoot, "data/mission-control/changesets/published/out-of-scope-publication.json"),
      `${JSON.stringify({
        schema_version: "companiesascode.mission_control.changeset.v1",
        id: "out-of-scope-publication",
        status: "published",
        summary: "Operation outside recorded credential scope",
        created_at: "2026-07-19T10:00:00.000Z",
        created_by: "template-builder",
        operations: [{
          action: "write_file",
          path: "data/mission-control/reports/out-of-scope-publication.txt",
          content: "blocked\n",
        }],
        approval: {
          approved_by: "template-steward",
          role: "steward",
          approved_at: "2026-07-19T10:05:00.000Z",
          comment: "",
        },
        published_at: "2026-07-19T10:10:00.000Z",
        published_by: "template-steward",
        credential_authority: {
          writer_id: "template-writer",
          custody_role: "steward",
          branch: "v3",
          path_allowlist: ["data/mission-control/plans/**"],
        },
      }, null, 2)}\n`,
    );
  });
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /credential_authority\.path_allowlist does not cover published operation data\/mission-control\/reports\/out-of-scope-publication\.txt/,
  );
});

test("Organization data validator binds published credential branch to repository-db", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    writeFileSync(
      join(dataRoot, "data/mission-control/changesets/published/wrong-published-branch.json"),
      `${JSON.stringify({
        schema_version: "companiesascode.mission_control.changeset.v1",
        id: "wrong-published-branch",
        status: "published",
        summary: "Wrong published credential branch",
        created_at: "2026-07-19T10:00:00.000Z",
        created_by: "template-builder",
        operations: [{
          action: "write_file",
          path: "data/mission-control/reports/wrong-published-branch.txt",
          content: "blocked\n",
        }],
        approval: {
          approved_by: "template-steward",
          role: "steward",
          approved_at: "2026-07-19T10:05:00.000Z",
          comment: "",
        },
        published_at: "2026-07-19T10:10:00.000Z",
        published_by: "template-steward",
        credential_authority: {
          writer_id: "template-writer",
          custody_role: "steward",
          branch: "main",
          path_allowlist: ["data/mission-control/**"],
        },
      }, null, 2)}\n`,
    );
  });
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /credential_authority\.branch must match repository-db\.yaml data_repo\.branch/,
  );
});

test("Organization data validator preserves terminal audit across configured path migrations", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const published = attachAuthenticatedLifecycle({
      schema_version: "companiesascode.mission_control.changeset.v1",
      id: "historical-custom-report",
      status: "published",
      summary: "Historical custom report directory",
      created_at: "2026-07-19T10:00:00.000Z",
      created_by: "organization-user",
      operations: [{
        action: "write_file",
        path: "data/mission-control/historical-reports/custom-report.txt",
        content: "historical\n",
      }],
      approval: {
        approved_by: "organization-steward",
        role: "steward",
        approved_at: "2026-07-19T10:05:00.000Z",
        comment: "",
      },
      published_at: "2026-07-19T10:10:00.000Z",
      published_by: "organization-steward",
      credential_authority: {
        writer_id: "organization-scoped-data-writer",
        custody_role: "steward",
        branch: "v3",
        path_allowlist: ["data/mission-control/**"],
      },
    });
    writeFileSync(
      join(dataRoot, "data/mission-control/changesets/published/historical-custom-report.json"),
      `${JSON.stringify(published, null, 2)}\n`,
    );
    const superseded = attachAuthenticatedLifecycle({
      schema_version: "companiesascode.mission_control.changeset.v1",
      id: "historical-custom-draft",
      status: "superseded",
      summary: "Historical custom draft directory",
      created_at: "2026-07-19T10:00:00.000Z",
      created_by: "organization-user",
      operations: [{
        action: "write_file",
        path: "data/mission-control/historical-drafts/custom-draft.txt",
        content: "historical\n",
      }],
      supersession: {
        superseded_at: "2026-07-19T10:10:00.000Z",
        superseded_by: "organization-steward",
        role: "steward",
        reason: "Historical policy was replaced.",
        replacement_changeset_id: null,
      },
    });
    writeFileSync(
      join(dataRoot, "data/mission-control/changesets/superseded/historical-custom-draft.json"),
      `${JSON.stringify(superseded, null, 2)}\n`,
    );
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("Organization data validator requires a preserved operation payload on superseded audit", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    writeFileSync(
      join(dataRoot, "data/mission-control/changesets/superseded/missing-operation-payload.json"),
      `${JSON.stringify({
        schema_version: "companiesascode.mission_control.changeset.v1",
        id: "missing-operation-payload",
        status: "superseded",
        summary: "Superseded audit without its original payload",
        created_at: "2026-07-18T10:00:00.000Z",
        created_by: "template-builder",
        operations: [],
        supersession: {
          superseded_at: "2026-07-18T10:10:00.000Z",
          superseded_by: "template-steward",
          role: "steward",
          reason: "The terminal audit must preserve the original operation array.",
          replacement_changeset_id: null,
        },
      }, null, 2)}\n`,
    );
  });
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /operations must be a non-empty array/,
  );
});

test("Organization data validator keeps published audit inside the Mission Control data boundary", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    writeFileSync(
      join(dataRoot, "data/mission-control/changesets/published/outside-data-boundary.json"),
      `${JSON.stringify({
        schema_version: "companiesascode.mission_control.changeset.v1",
        id: "outside-data-boundary",
        status: "published",
        summary: "Invalid publication outside Mission Control data",
        created_at: "2026-07-18T10:00:00.000Z",
        created_by: "template-builder",
        operations: [{
          action: "write_file",
          path: "AGENTS.md",
          content: "must never be published by a Mission Control changeset\n",
        }],
        approval: {
          approved_by: "template-steward",
          role: "steward",
          approved_at: "2026-07-18T10:05:00.000Z",
          comment: "",
        },
        published_at: "2026-07-18T10:10:00.000Z",
        published_by: "template-steward",
        credential_authority: {
          writer_id: "historical-template-writer",
          custody_role: "steward",
          branch: "v3",
          path_allowlist: ["AGENTS.md"],
        },
      }, null, 2)}\n`,
    );
  });
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /operations\[0\]\.path is not an allowed Mission Control data path/,
  );
});

test("Organization data validator keeps recorded publication credential scope inside Mission Control data", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    writeFileSync(
      join(dataRoot, "data/mission-control/changesets/published/broad-credential-scope.json"),
      `${JSON.stringify({
        schema_version: "companiesascode.mission_control.changeset.v1",
        id: "broad-credential-scope",
        status: "published",
        summary: "Invalid broad publication credential scope",
        created_at: "2026-07-18T10:00:00.000Z",
        created_by: "template-builder",
        operations: [{
          action: "write_file",
          path: "data/mission-control/reports/broad-credential-scope.txt",
          content: "historical\n",
        }],
        approval: {
          approved_by: "template-steward",
          role: "steward",
          approved_at: "2026-07-18T10:05:00.000Z",
          comment: "",
        },
        published_at: "2026-07-18T10:10:00.000Z",
        published_by: "template-steward",
        credential_authority: {
          writer_id: "historical-template-writer",
          custody_role: "steward",
          branch: "v3",
          path_allowlist: ["AGENTS.md", "data/mission-control/**"],
        },
      }, null, 2)}\n`,
    );
  });
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /credential_authority\.path_allowlist\[0\] must stay inside the Mission Control data boundary/,
  );
});

test("Organization data validator rejects approval metadata on pending records", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    writeFileSync(
      join(dataRoot, "data/mission-control/changesets/pending/pending-with-approval.json"),
      `${JSON.stringify({
        schema_version: "companiesascode.mission_control.changeset.v1",
        id: "pending-with-approval",
        status: "pending",
        summary: "Pending record with contradictory approval",
        created_at: "2026-07-19T10:00:00.000Z",
        created_by: "template-builder",
        operations: [{
          action: "write_file",
          path: "data/mission-control/reports/pending-with-approval.txt",
          content: "blocked\n",
        }],
        approval: {
          approved_by: "template-steward",
          role: "steward",
          approved_at: "2026-07-19T10:05:00.000Z",
          comment: "",
        },
      }, null, 2)}\n`,
    );
  });
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /pending changeset must not contain approval metadata/,
  );
});

test("Organization data validator rejects control-plane changeset operations", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const configPath = join(dataRoot, "data/mission-control/mission-control.config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.reports_dir = "data/mission-control";
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    writeFileSync(
      join(dataRoot, "data/mission-control/changesets/pending/control-plane-operation.json"),
      `${JSON.stringify({
        schema_version: "companiesascode.mission_control.changeset.v1",
        id: "control-plane-operation",
        status: "pending",
        summary: "Control-plane operation",
        created_at: "2026-07-19T10:00:00.000Z",
        created_by: "template-builder",
        operations: [{
          action: "write_file",
          path: "data/mission-control/MISSION-CONTROL.CONFIG.JSON",
          content: "{}\n",
        }],
      }, null, 2)}\n`,
    );
  });
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /operations\[0\]\.path is not an allowed Mission Control data path/,
  );
});

test("Organization data validator rejects non-portable active operation paths", () => {
  const invalidPaths = [
    "data/mission-control/reports/result:part.txt",
    "data\\mission-control\\reports\\result.txt",
    "data/mission-control/reports/./result.txt",
    "data/mission-control/reports/result?.txt",
    "data/mission-control/reports/result\".txt",
    "data/mission-control/reports/result<part>.txt",
    "data/mission-control/reports/result|part.txt",
    "data/mission-control/reports/\u0001result.txt",
    "data/mission-control/reports/result.",
    "data/mission-control/reports/result ",
    "data/mission-control/reports/CON.txt",
  ];
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    writeFileSync(
      join(dataRoot, "data/mission-control/changesets/pending/non-portable-operations.json"),
      `${JSON.stringify({
        schema_version: "companiesascode.mission_control.changeset.v1",
        id: "non-portable-operations",
        status: "pending",
        summary: "Non-portable operation paths",
        created_at: "2026-07-19T10:00:00.000Z",
        created_by: "template-builder",
        operations: invalidPaths.map((path) => ({
          action: "write_file",
          path,
          content: "blocked\n",
        })),
      }, null, 2)}\n`,
    );
  });
  assert.notEqual(result.status, 0);
  assert.equal(
    `${result.stdout}\n${result.stderr}`.match(
      /operations\[[0-9]+\]\.path must be a portable path inside the repository/g,
    )?.length,
    invalidPaths.length,
    `${result.stdout}\n${result.stderr}`,
  );
});

test("Organization data validator rejects publication metadata on superseded records", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    writeFileSync(
      join(dataRoot, "data/mission-control/changesets/superseded/contradictory-publication.json"),
      `${JSON.stringify({
        schema_version: "companiesascode.mission_control.changeset.v1",
        id: "contradictory-publication",
        status: "superseded",
        summary: "Contradictory publication metadata",
        created_at: "2026-07-19T10:00:00.000Z",
        created_by: "template-builder",
        operations: [{
          action: "write_file",
          path: "data/mission-control/reports/contradictory-publication.txt",
          content: "blocked\n",
        }],
        published_at: "2026-07-19T10:10:00.000Z",
        published_by: "template-steward",
        credential_authority: {
          writer_id: "template-writer",
          custody_role: "steward",
          branch: "v3",
          path_allowlist: ["data/mission-control/**"],
        },
        supersession: {
          superseded_at: "2026-07-19T10:15:00.000Z",
          superseded_by: "template-steward",
          role: "steward",
          reason: "A proposal cannot be both published and superseded.",
          replacement_changeset_id: null,
        },
      }, null, 2)}\n`,
    );
  });
  assert.notEqual(result.status, 0);
  for (const field of ["published_at", "published_by", "credential_authority"]) {
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      new RegExp(`only a published changeset may contain ${field}`),
    );
  }
});

test("Organization data validator rejects a lowercase plan_prefix", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "avt");
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /plan_prefix must be 2-6 uppercase letters/);
});

test("Organization data validator rejects DEV plans left under an AVT config", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "AVT");
  });
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /DEV-0001-template-runtime\.yaml: dev_code must match configured plan_prefix \(AVT-dddd\)/,
  );
});

test("Organization data validator accepts plans and roadmap refs consistently instantiated with an AVT prefix", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "AVT");
    rewritePlanPrefix(dataRoot, "DEV", "AVT");
    rewriteRoadmapPlanPrefix(dataRoot, "DEV", "AVT");
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("Organization data validator accepts a strict incident addendum", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const planPath = join(
      dataRoot,
      "data/mission-control/plans/2026/01/DEV-0001-template-runtime.yaml",
    );
    const plan = parseYaml(readFileSync(planPath, "utf8"));
    plan.incident_addendum = {
      reported_at: "2026-07-29T08:47:00+02:00",
      reporter: "organization-user",
      authorization: "The Organization owner authorized a bounded recovery.",
      observed_state: "The hosted writer stopped before creating a commit.",
    };
    writeFileSync(planPath, stringifyYaml(plan));
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("Organization data validator rejects unknown incident addendum fields", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const planPath = join(
      dataRoot,
      "data/mission-control/plans/2026/01/DEV-0001-template-runtime.yaml",
    );
    const plan = parseYaml(readFileSync(planPath, "utf8"));
    plan.incident_addendum = {
      reported_at: "2026-07-29T08:47:00+02:00",
      reporter: "organization-user",
      authorization: "The Organization owner authorized a bounded recovery.",
      observed_state: "The hosted writer stopped before creating a commit.",
      private_runtime_path: "/private/host/path",
    };
    writeFileSync(planPath, stringifyYaml(plan));
  });
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /incident_addendum.*additional properties|additional properties.*incident_addendum/i,
  );
});

test("Organization data validator checks legacy ClickUp custom IDs against the configured prefix only", () => {
  const configureLegacySource = (dataRoot, planPrefix, customId) => {
    instantiateOrganizationData(dataRoot, planPrefix);
    if (planPrefix !== "DEV") {
      rewritePlanPrefix(dataRoot, "DEV", planPrefix);
      rewriteRoadmapPlanPrefix(dataRoot, "DEV", planPrefix);
    }
    const planPath = join(
      dataRoot,
      `data/mission-control/plans/2026/01/${planPrefix}-0001-template-runtime.yaml`,
    );
    const plan = parseYaml(readFileSync(planPath, "utf8"));
    plan.legacy_sources = {
      clickup: {
        task_id: "generic-task-id",
        custom_id: customId,
        url: "https://example.invalid/tasks/generic-task-id",
      },
    };
    writeFileSync(planPath, stringifyYaml(plan));
  };

  const positive = runOrganizationDataValidator((dataRoot) => {
    configureLegacySource(dataRoot, "DEV", "DEV-9876");
  });
  assert.equal(positive.status, 0, `${positive.stdout}\n${positive.stderr}`);

  for (const [planPrefix, foreignCustomId] of [
    ["DEV", "ACME-0001"],
    ["ACME", "AVT-0001"],
    ["AVT", "DEV-0001"],
  ]) {
    const negative = runOrganizationDataValidator((dataRoot) => {
      configureLegacySource(dataRoot, planPrefix, foreignCustomId);
    });
    assert.notEqual(negative.status, 0);
    assert.match(
      `${negative.stdout}\n${negative.stderr}`,
      new RegExp(
        `legacy_sources\\.clickup\\.custom_id must match configured plan_prefix \\(${planPrefix}-dddd\\)`,
      ),
    );
  }
});

test("Organization data validator preserves generic external task provenance", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const planPath = join(
      dataRoot,
      "data/mission-control/plans/2026/01/DEV-0001-template-runtime.yaml",
    );
    const plan = parseYaml(readFileSync(planPath, "utf8"));
    plan.legacy_sources = {
      external_task: {
        system: "Example tracker",
        id: "external-123",
        url: "https://example.invalid/tasks/external-123",
        status: "open",
      },
    };
    writeFileSync(planPath, stringifyYaml(plan));
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("Organization data validator parses YAML and applies the complete plan schema", () => {
  const malformedResult = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const planPath = join(
      dataRoot,
      "data/mission-control/plans/2026/01/DEV-0001-template-runtime.yaml",
    );
    writeFileSync(planPath, `${readFileSync(planPath, "utf8")}\nmalformed: [\n`);
  });
  assert.notEqual(malformedResult.status, 0);
  assert.match(`${malformedResult.stdout}\n${malformedResult.stderr}`, /invalid YAML/);

  const schemaResult = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const planPath = join(
      dataRoot,
      "data/mission-control/plans/2026/01/DEV-0001-template-runtime.yaml",
    );
    const text = readFileSync(planPath, "utf8").replace(
      "title: Template runtime fixture",
      'title: ""',
    );
    writeFileSync(planPath, text);
  });
  assert.notEqual(schemaResult.status, 0);
  assert.match(`${schemaResult.stdout}\n${schemaResult.stderr}`, /plan schema \/title/);
});

test("Organization data validator reports the path and location of leading-backtick YAML scalars", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const planPath = join(
      dataRoot,
      "data/mission-control/plans/2026/01/DEV-0001-template-runtime.yaml",
    );
    const text = readFileSync(planPath, "utf8").replace(
      /validation:\r?\n  - bun run check/,
      "validation:\n  - `bun run check`",
    );
    writeFileSync(planPath, text);
  });

  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /data\/mission-control\/plans\/2026\/01\/DEV-0001-template-runtime\.yaml: invalid YAML: Plain value cannot start with reserved character ` at line \d+, column \d+/is,
  );
});

test("Organization data validator rejects colon-bearing plain scalars that YAML coerces to mappings", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const planPath = join(
      dataRoot,
      "data/mission-control/plans/2026/01/DEV-0001-template-runtime.yaml",
    );
    const text = readFileSync(planPath, "utf8").replace(
      /validation:\r?\n  - bun run check/,
      "validation:\n  - Preview fakeConnection=1: must stay a string",
    );
    writeFileSync(planPath, text);
  });

  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /DEV-0001-template-runtime\.yaml: plan schema \/validation\/0.*must be string/is,
  );
});

test("Organization data validator rejects .yml plan files while roadmaps keep both lowercase YAML extensions", () => {
  const planResult = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const plansRoot = join(dataRoot, "data/mission-control/plans/2026/01");
    renameSync(
      join(plansRoot, "DEV-0001-template-runtime.yaml"),
      join(plansRoot, "DEV-0001-template-runtime.yml"),
    );
  });
  assert.notEqual(planResult.status, 0);
  assert.match(
    `${planResult.stdout}\n${planResult.stderr}`,
    /DEV-0001-template-runtime\.yml: canonical plan extension must be \.yaml/,
  );

  const roadmapResult = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const roadmapsRoot = join(dataRoot, "data/mission-control/roadmaps/2026");
    renameSync(
      join(roadmapsRoot, "RM-0001-template-runtime.yaml"),
      join(roadmapsRoot, "RM-0001-template-runtime.yml"),
    );
  });
  assert.equal(
    roadmapResult.status,
    0,
    `${roadmapResult.stdout}\n${roadmapResult.stderr}`,
  );
});

test("Organization data validator rejects duplicate and merge keys in plan YAML", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const plansRoot = join(dataRoot, "data/mission-control/plans/2026/01");
    const duplicatePath = join(plansRoot, "DEV-0001-template-runtime.yaml");
    writeFileSync(
      duplicatePath,
      `${readFileSync(duplicatePath, "utf8")}\ntitle: Duplicate title\n`,
    );
    const mergePath = join(
      plansRoot,
      "DEV-0002-template-close-blocker.yaml",
    );
    writeFileSync(mergePath, `${readFileSync(mergePath, "utf8")}\n<<: {}\n`);
  });
  assert.notEqual(result.status, 0);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, /DEV-0001-template-runtime\.yaml: invalid YAML:.*keys must be unique/is);
  assert.match(output, /DEV-0002-template-close-blocker\.yaml: plan schema.*additional properties/is);
});

test("Organization data validator accepts the valid roadmap scaffold", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("Organization data validator recursively parses and schema-validates roadmap YAML", () => {
  const malformedResult = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const nestedRoadmapRoot = join(
      dataRoot,
      "data/mission-control/roadmaps/2026/07/nested",
    );
    mkdirSync(nestedRoadmapRoot, { recursive: true });
    writeFileSync(join(nestedRoadmapRoot, "RM-0002-malformed.yaml"), "schema_version: [\n");
  });
  assert.notEqual(malformedResult.status, 0);
  assert.match(
    `${malformedResult.stdout}\n${malformedResult.stderr}`,
    /roadmaps\/2026\/07\/nested\/RM-0002-malformed\.yaml: invalid YAML/,
  );

  const schemaResult = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const nestedRoadmapRoot = join(
      dataRoot,
      "data/mission-control/roadmaps/2026/07/nested",
    );
    mkdirSync(nestedRoadmapRoot, { recursive: true });
    const roadmapPath = join(nestedRoadmapRoot, "RM-0002-invalid.yaml");
    writeFileSync(
      roadmapPath,
      stringifyYaml({
        schema_version: "companiesascode.mission_control.roadmap.v1",
        id: "mcroadmap-rm-0002",
        roadmap_code: "RM-0002",
        title: "   ",
        status: "ready",
        owner: "template-steward",
        priority: "medium",
        created_at: "2026-07-19",
        updated_at: "2026-07-19",
        source_plan: "DEV-0001",
        summary: "Generic invalid roadmap fixture.",
        priorities: [],
        steps: [],
      }),
    );
  });
  assert.notEqual(schemaResult.status, 0);
  assert.match(
    `${schemaResult.stdout}\n${schemaResult.stderr}`,
    /roadmaps\/2026\/07\/nested\/RM-0002-invalid\.yaml: title must contain a non-whitespace character/,
  );

  const uppercaseExtensionResult = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const roadmapRoot = join(dataRoot, "data/mission-control/roadmaps/2026");
    renameSync(
      join(roadmapRoot, "RM-0001-template-runtime.yaml"),
      join(roadmapRoot, "RM-0001-template-runtime.YAML"),
    );
  });
  assert.notEqual(uppercaseExtensionResult.status, 0);
  assert.match(
    `${uppercaseExtensionResult.stdout}\n${uppercaseExtensionResult.stderr}`,
    /RM-0001-template-runtime\.YAML: YAML extension must be lowercase \.yaml or \.yml/,
  );
});

test("Organization data validator enforces repository-aware roadmap references and identity", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const roadmapRoot = join(dataRoot, "data/mission-control/roadmaps/2026");
    const roadmapPath = join(roadmapRoot, "RM-0001-template-runtime.yaml");
    const roadmap = parseYaml(readFileSync(roadmapPath, "utf8"));
    roadmap.source_plan = "DEV-9999";
    roadmap.steps[0].priority_refs = ["priority-999"];
    roadmap.steps[0].plan_refs = ["DEV-9999"];
    roadmap.steps[0].evidence_refs[0].path = "missing-evidence.md";
    roadmap.steps[1].todo_refs = ["task-2026-01-01-999"];
    roadmap.steps[1].issue_refs = ["issue-2026-01-01-001"];
    writeFileSync(roadmapPath, stringifyYaml(roadmap));

    const duplicateRoot = join(roadmapRoot, "07/nested");
    mkdirSync(duplicateRoot, { recursive: true });
    cpSync(roadmapPath, join(duplicateRoot, "RM-0001-duplicate.yaml"));
  });
  assert.notEqual(result.status, 0);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, /source_plan references missing plan DEV-9999/);
  assert.match(output, /priority_refs\[0\] references missing roadmap priority priority-999/);
  assert.match(output, /plan_refs\[0\] references missing plan DEV-9999/);
  assert.match(output, /todo_refs\[0\] references missing TODO\/DONE item task-2026-01-01-999/);
  assert.match(output, /issue_refs\[0\] references missing open\/resolved issue issue-2026-01-01-001/);
  assert.match(output, /evidence_refs\[0\]\.path does not exist: missing-evidence\.md/);
  assert.match(output, /duplicate roadmap_code RM-0001/);
  assert.match(output, /duplicate id mcroadmap-rm-0001/);
});

test("Organization data validator matches roadmap date, URL and YAML label semantics", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const roadmapPath = join(
      dataRoot,
      "data/mission-control/roadmaps/2026/RM-0001-template-runtime.yaml",
    );
    const roadmap = parseYaml(readFileSync(roadmapPath, "utf8"));
    roadmap.created_at = "2026-02-31";
    roadmap.steps[0].evidence_refs = [
      {
        label: "Broken external evidence",
        kind: "external",
        url: "https://",
        verification: "external",
      },
      {
        label: "Credential-bearing evidence",
        kind: "external",
        url: "https://user:secret@example.invalid/proof",
        verification: "external",
      },
      {
        label: "Token-bearing query",
        kind: "external",
        url: "https://example.invalid/proof?access_token=secret",
        verification: "external",
      },
      {
        label: "Fragment-bearing URL",
        kind: "external",
        url: "https://example.invalid/proof#token=secret",
        verification: "external",
      },
    ];
    const source = stringifyYaml(roadmap).replace(
      "label: Broken external evidence",
      "label: Evidence#1 # silently truncated",
    );
    writeFileSync(roadmapPath, source);
  });
  assert.notEqual(result.status, 0);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(output, /created_at must be a real YYYY-MM-DD calendar date/);
  assert.match(output, /evidence_refs\[0\]\.url must be a credential-free external http\(s\) URL/);
  assert.match(output, /evidence_refs\[1\]\.url must be a credential-free external http\(s\) URL/);
  assert.match(output, /evidence_refs\[2\]\.url must be a credential-free external http\(s\) URL/);
  assert.match(output, /evidence_refs\[3\]\.url must be a credential-free external http\(s\) URL/);
  assert.match(output, /label contains an unquoted #/);

  const pathResult = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const roadmapPath = join(
      dataRoot,
      "data/mission-control/roadmaps/2026/RM-0001-template-runtime.yaml",
    );
    const roadmap = parseYaml(readFileSync(roadmapPath, "utf8"));
    roadmap.steps[0].evidence_refs[0].path = "C:/report.md";
    writeFileSync(roadmapPath, stringifyYaml(roadmap));
  });
  assert.notEqual(pathResult.status, 0);
  assert.match(
    `${pathResult.stdout}\n${pathResult.stderr}`,
    /evidence_refs\[0\]\.path must be a portable repo-relative path inside the data repository/,
  );
});

test("Organization data validator keeps top-level roadmap links portable and credential-free", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const roadmapPath = join(
      dataRoot,
      "data/mission-control/roadmaps/2026/RM-0001-template-runtime.yaml",
    );
    const roadmap = parseYaml(readFileSync(roadmapPath, "utf8"));
    roadmap.links = [
      {
        label: "Credential-bearing URL",
        url: "https://user:secret@example.invalid/private",
      },
      {
        label: "Token-bearing query",
        url: "https://example.invalid/private?client_secret=secret",
      },
      {
        label: "Fragment-bearing URL",
        url: "https://example.invalid/private#access_token=secret",
      },
      {
        label: "Machine-local path",
        path: "C:/Users/template/private.md",
      },
      {
        label: "Git metadata path",
        path: ".git/config",
      },
      {
        label: "Case-insensitive Git metadata path",
        path: ".GIT/config",
      },
    ];
    writeFileSync(roadmapPath, stringifyYaml(roadmap));
  });
  assert.notEqual(result.status, 0);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(
    output,
    /links\[0\]\.url must be a credential-free external http\(s\) URL/,
  );
  assert.match(
    output,
    /links\[1\]\.url must be a credential-free external http\(s\) URL/,
  );
  assert.match(
    output,
    /links\[2\]\.url must be a credential-free external http\(s\) URL/,
  );
  assert.match(
    output,
    /links\[3\]\.path must be a portable repo-relative path inside the data repository/,
  );
  assert.match(
    output,
    /links\[4\]\.path must be a portable repo-relative path inside the data repository/,
  );
  assert.match(
    output,
    /links\[5\]\.path must be a portable repo-relative path inside the data repository/,
  );
});

test("Organization data validator accepts credential-free roadmap URL query and fragment context", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const roadmapPath = join(
      dataRoot,
      "data/mission-control/roadmaps/2026/RM-0001-template-runtime.yaml",
    );
    const roadmap = parseYaml(readFileSync(roadmapPath, "utf8"));
    roadmap.links = [
      {
        label: "Documentation section",
        url: "https://docs.example.invalid/guide?code=example&key=section#access-token",
      },
      {
        label: "Nested documentation URL",
        url: "https://docs.example.invalid/guide?next=https%3A%2F%2Fdocs.example.invalid%2Fnested%3Fcode%3Dexample%23access-token#deployment",
      },
    ];
    roadmap.steps[0].evidence_refs = [
      {
        label: "External documentation section",
        kind: "external",
        url: "https://docs.example.invalid/guide?code=example#secret-management",
        verification: "external",
      },
    ];
    writeFileSync(roadmapPath, stringifyYaml(roadmap));
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("Organization data validator rejects credential-shaped URL values under arbitrary names", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const roadmapPath = join(
      dataRoot,
      "data/mission-control/roadmaps/2026/RM-0001-template-runtime.yaml",
    );
    const roadmap = parseYaml(readFileSync(roadmapPath, "utf8"));
    roadmap.links = [
      {
        label: "Token hidden in query value",
        url: "https://example.invalid/proof?value=ghp_secret",
      },
      {
        label: "Token hidden in path",
        url: "https://example.invalid/proof/ghp_secret",
      },
      {
        label: "JWT hidden in fragment value",
        url: "https://example.invalid/proof#proof=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature",
      },
      {
        label: "Credential hidden in a nested URL",
        url: "https://example.invalid/proof?next=https%3A%2F%2Fapi.example.invalid%2Fcallback%3Faccess_token%3Dsecret",
      },
      {
        label: "Credential hidden in hostname",
        url: "https://ghp_abcdef.example.invalid/proof",
      },
      {
        label: "Credential hidden in a nested relative target",
        url: "https://example.invalid/proof?next=%2Fcallback%3Faccess_token%3Dsecret",
      },
      {
        label: "Credential hidden behind repeated encoding",
        url: "https://example.invalid/proof?next=%2525252Fcallback%2525253Faccess_token%2525253Dsecret",
      },
      {
        label: "Credential hidden in an encoded parameter name",
        url: "https://example.invalid/proof?access_%2574oken=secret",
      },
      {
        label: "Credential parameter hidden in path",
        url: "https://example.invalid/proof/access_token=secret",
      },
      {
        label: "Case-sensitive credential hidden in hostname",
        url: "https://AKIAABCDEFGHIJKLMNOP.example.invalid/proof", // gitleaks:allow (synthetic fixture)
      },
      {
        label: "Credential-bearing nested URL hidden in fragment",
        url: "https://example.invalid/#https://user:secret@inner.invalid/",
      },
      {
        label: "Credential-bearing nested URL hidden in path",
        url: "https://example.invalid/proof/https%3A%2F%2Fuser%3Asecret%40inner.invalid%2F",
      },
      {
        label: "Serialized authorization header hidden in query",
        url: "https://example.invalid/?header=Authorization%3A%20Bearer%20opaque-secret-value",
      },
      {
        label: "Credential key hidden in a serialized JSON query value",
        url: "https://example.invalid/callback?state=%7B%22access_token%22%3A%22secret-value%22%7D",
      },
      {
        label: "Credential prefix hidden before malformed percent encoding",
        url: "https://example.invalid/%67hp_abcdef%ZZ",
      },
    ];
    writeFileSync(roadmapPath, stringifyYaml(roadmap));
  });
  assert.notEqual(result.status, 0);
  const output = `${result.stdout}\n${result.stderr}`;
  for (const index of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]) {
    assert.match(
      output,
      new RegExp(`links\\[${index}\\]\\.url must be a credential-free external http\\(s\\) URL`),
    );
  }
});

symlinkTest("Organization data validator rejects missing roadmap link targets behind symlinks", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const outsideRoot = join(dataRoot, "..", "outside-link-target");
    mkdirSync(outsideRoot, { recursive: true });
    symlinkSync(outsideRoot, join(dataRoot, "redirect"), "dir");
    const roadmapPath = join(
      dataRoot,
      "data/mission-control/roadmaps/2026/RM-0001-template-runtime.yaml",
    );
    const roadmap = parseYaml(readFileSync(roadmapPath, "utf8"));
    roadmap.links = [
      {
        label: "Future report outside the repository",
        path: "redirect/future-report.md",
      },
    ];
    writeFileSync(roadmapPath, stringifyYaml(roadmap));
  });
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /links\[0\]\.path must be a portable repo-relative path inside the data repository/,
  );

  const danglingResult = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    symlinkSync(
      join(dataRoot, "..", "outside-link-target-that-does-not-exist"),
      join(dataRoot, "redirect"),
      "dir",
    );
    const roadmapPath = join(
      dataRoot,
      "data/mission-control/roadmaps/2026/RM-0001-template-runtime.yaml",
    );
    const roadmap = parseYaml(readFileSync(roadmapPath, "utf8"));
    roadmap.links = [
      {
        label: "Future report behind a dangling symlink",
        path: "redirect/future-report.md",
      },
    ];
    writeFileSync(roadmapPath, stringifyYaml(roadmap));
  });
  assert.notEqual(danglingResult.status, 0);
  assert.match(
    `${danglingResult.stdout}\n${danglingResult.stderr}`,
    /links\[0\]\.path must be a portable repo-relative path inside the data repository/,
  );
});

test("Organization data validator requires local roadmap evidence to be tracked or staged", () => {
  const runEvidenceCase = (stageEvidence) =>
    runOrganizationDataValidator((dataRoot) => {
      instantiateOrganizationData(dataRoot, "DEV");
      const roadmapPath = join(
        dataRoot,
        "data/mission-control/roadmaps/2026/RM-0001-template-runtime.yaml",
      );
      const roadmap = parseYaml(readFileSync(roadmapPath, "utf8"));
      roadmap.steps[0].evidence_refs[0].path = "local-evidence.md";
      writeFileSync(roadmapPath, stringifyYaml(roadmap));
      writeFileSync(join(dataRoot, "local-evidence.md"), "# Local-only evidence\n");
      assert.equal(
        spawnSync("git", ["init", "-q"], { cwd: dataRoot }).status,
        0,
      );
      assert.equal(
        spawnSync("git", ["add", "."], { cwd: dataRoot }).status,
        0,
      );
      if (!stageEvidence) {
        assert.equal(
          spawnSync("git", ["reset", "-q", "--", "local-evidence.md"], {
            cwd: dataRoot,
          }).status,
          0,
        );
      }
    });

  const untrackedResult = runEvidenceCase(false);
  assert.notEqual(untrackedResult.status, 0);
  assert.match(
    `${untrackedResult.stdout}\n${untrackedResult.stderr}`,
    /evidence_refs\[0\]\.path must point to a Git-tracked or staged file: local-evidence\.md/,
  );

  const stagedResult = runEvidenceCase(true);
  assert.equal(stagedResult.status, 0, `${stagedResult.stdout}\n${stagedResult.stderr}`);

  for (const indexFlag of ["--assume-unchanged", "--skip-worktree"]) {
    const flaggedResult = runOrganizationDataValidator((dataRoot) => {
      instantiateOrganizationData(dataRoot, "DEV");
      const roadmapPath = join(
        dataRoot,
        "data/mission-control/roadmaps/2026/RM-0001-template-runtime.yaml",
      );
      const roadmap = parseYaml(readFileSync(roadmapPath, "utf8"));
      roadmap.steps[0].evidence_refs[0].path = "flagged-evidence.md";
      writeFileSync(roadmapPath, stringifyYaml(roadmap));
      writeFileSync(join(dataRoot, "flagged-evidence.md"), "# Flagged evidence\n");
      assert.equal(spawnSync("git", ["init", "-q"], { cwd: dataRoot }).status, 0);
      assert.equal(spawnSync("git", ["add", "."], { cwd: dataRoot }).status, 0);
      assert.equal(
        spawnSync("git", ["update-index", indexFlag, "flagged-evidence.md"], {
          cwd: dataRoot,
        }).status,
        0,
      );
    });
    assert.notEqual(flaggedResult.status, 0);
    assert.match(
      `${flaggedResult.stdout}\n${flaggedResult.stderr}`,
      /evidence_refs\[0\]\.path must point to a Git-tracked or staged file: flagged-evidence\.md/,
    );
  }

  const runPublishedEvidenceCase = (stagePublishPaths) =>
    runOrganizationDataValidator((dataRoot) => {
      instantiateOrganizationData(dataRoot, "DEV");
      const evidencePath = "data/mission-control/reports/atomic-evidence.md";
      const evidenceContent = "# Atomic evidence\n";
      const roadmapRelativePath =
        "data/mission-control/roadmaps/2026/RM-0001-template-runtime.yaml";
      const publishedRelativePath =
        "data/mission-control/changesets/published/atomic-roadmap-evidence.json";
      const roadmapPath = join(dataRoot, roadmapRelativePath);
      const roadmap = parseYaml(readFileSync(roadmapPath, "utf8"));
      roadmap.steps[0].evidence_refs[0].path = evidencePath;
      writeFileSync(roadmapPath, stringifyYaml(roadmap));
      writeFileSync(join(dataRoot, evidencePath), evidenceContent);
      const published = attachAuthenticatedLifecycle({
        schema_version: "companiesascode.mission_control.changeset.v1",
        id: "atomic-roadmap-evidence",
        status: "published",
        summary: "Atomic roadmap evidence",
        created_at: "2026-07-19T10:00:00.000Z",
        created_by: "organization-user",
        operations: [
          {
            action: "write_file",
            path: evidencePath,
            content: evidenceContent,
          },
        ],
        approval: {
          approved_at: "2026-07-19T10:01:00.000Z",
          approved_by: "organization-steward",
          role: "steward",
        },
        published_at: "2026-07-19T10:02:00.000Z",
        published_by: "organization-steward",
        credential_authority: {
          writer_id: "organization-scoped-data-writer",
          custody_role: "steward",
          branch: "v3",
          path_allowlist: ["data/mission-control/**"],
        },
      });
      writeFileSync(
        join(dataRoot, publishedRelativePath),
        `${JSON.stringify(published, null, 2)}\n`,
      );
      if (stagePublishPaths) {
        assert.equal(
          spawnSync(
            "git",
            ["add", "--", roadmapRelativePath, evidencePath, publishedRelativePath],
            { cwd: dataRoot },
          ).status,
          0,
        );
      }
    });

  const forgedPublishedResult = runPublishedEvidenceCase(false);
  assert.notEqual(forgedPublishedResult.status, 0);
  assert.match(
    `${forgedPublishedResult.stdout}\n${forgedPublishedResult.stderr}`,
    /evidence_refs\[0\]\.path must point to a Git-tracked or staged file: data\/mission-control\/reports\/atomic-evidence\.md/,
  );

  const stagedAtomicPublishResult = runPublishedEvidenceCase(true);
  assert.equal(
    stagedAtomicPublishResult.status,
    0,
    `${stagedAtomicPublishResult.stdout}\n${stagedAtomicPublishResult.stderr}`,
  );

  const metadataResult = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    assert.equal(spawnSync("git", ["init", "-q"], { cwd: dataRoot }).status, 0);
    const roadmapPath = join(
      dataRoot,
      "data/mission-control/roadmaps/2026/RM-0001-template-runtime.yaml",
    );
    const roadmap = parseYaml(readFileSync(roadmapPath, "utf8"));
    roadmap.steps[0].evidence_refs[0].path = ".GIT/config";
    writeFileSync(roadmapPath, stringifyYaml(roadmap));
  });
  assert.notEqual(metadataResult.status, 0);
  assert.match(
    `${metadataResult.stdout}\n${metadataResult.stderr}`,
    /evidence_refs\[0\]\.path must not point into Git repository metadata/,
  );

  const noGitResult = runOrganizationDataValidator(
    (dataRoot) => {
      instantiateOrganizationData(dataRoot, "DEV");
      writeFileSync(
        join(dataRoot, ".git"),
        "gitdir: missing-git-directory\n",
      );
    },
    { initializeGit: false },
  );
  assert.notEqual(noGitResult.status, 0);
  assert.match(
    `${noGitResult.stdout}\n${noGitResult.stderr}`,
    /evidence_refs\[0\]\.path must point to a Git-tracked or staged file/,
  );

  const enclosingGitResult = runOrganizationDataValidator(
    (dataRoot) => {
      instantiateOrganizationData(dataRoot, "DEV");
      const enclosingRoot = join(dataRoot, "..");
      assert.equal(spawnSync("git", ["init", "-q"], { cwd: enclosingRoot }).status, 0);
      assert.equal(
        spawnSync("git", ["add", "organization-data"], { cwd: enclosingRoot }).status,
        0,
      );
    },
    { initializeGit: false },
  );
  assert.notEqual(enclosingGitResult.status, 0);
  assert.match(
    `${enclosingGitResult.stdout}\n${enclosingGitResult.stderr}`,
    /evidence_refs\[0\]\.path must point to a Git-tracked or staged file/,
  );

  const intentToAddResult = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const roadmapPath = join(
      dataRoot,
      "data/mission-control/roadmaps/2026/RM-0001-template-runtime.yaml",
    );
    const roadmap = parseYaml(readFileSync(roadmapPath, "utf8"));
    roadmap.steps[0].evidence_refs[0].path = "intent-to-add-evidence.md";
    writeFileSync(roadmapPath, stringifyYaml(roadmap));
    writeFileSync(
      join(dataRoot, "intent-to-add-evidence.md"),
      "# Intent-to-add is not staged evidence\n",
    );
    assert.equal(
      spawnSync("git", ["add", "-N", "intent-to-add-evidence.md"], {
        cwd: dataRoot,
      }).status,
      0,
    );
  });
  assert.notEqual(intentToAddResult.status, 0);
  assert.match(
    `${intentToAddResult.stdout}\n${intentToAddResult.stderr}`,
    /evidence_refs\[0\]\.path must point to a Git-tracked or staged file/,
  );
});

symlinkTest("Organization data validator rejects symlinks at or above the roadmap root", () => {
  const rootSymlinkResult = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const roadmapsRoot = join(dataRoot, "data/mission-control/roadmaps");
    const outsideRoot = join(dataRoot, "..", "outside-roadmaps");
    rmSync(roadmapsRoot, { recursive: true, force: true });
    mkdirSync(outsideRoot, { recursive: true });
    symlinkSync(outsideRoot, roadmapsRoot, "dir");
  });
  assert.notEqual(rootSymlinkResult.status, 0);
  assert.match(
    `${rootSymlinkResult.stdout}\n${rootSymlinkResult.stderr}`,
    /mission-control\.config\.json: roadmaps_dir must be a real directory inside the data repository/,
  );

  const ancestorSymlinkResult = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const missionControlRoot = join(dataRoot, "data/mission-control");
    const redirectedRoot = join(dataRoot, "redirected-mission-control");
    renameSync(missionControlRoot, redirectedRoot);
    symlinkSync(redirectedRoot, missionControlRoot, "dir");
  });
  assert.notEqual(ancestorSymlinkResult.status, 0);
  assert.match(
    `${ancestorSymlinkResult.stdout}\n${ancestorSymlinkResult.stderr}`,
    /mission-control\.config\.json: roadmaps_dir must be a real directory inside the data repository/,
  );

  const nestedSymlinkResult = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const roadmapYearRoot = join(dataRoot, "data/mission-control/roadmaps/2026");
    const outsideRoot = join(dataRoot, "..", "outside-roadmap-year");
    renameSync(roadmapYearRoot, outsideRoot);
    symlinkSync(outsideRoot, roadmapYearRoot, "dir");
  });
  assert.notEqual(nestedSymlinkResult.status, 0);
  assert.match(
    `${nestedSymlinkResult.stdout}\n${nestedSymlinkResult.stderr}`,
    /roadmaps\/2026: YAML source tree must not contain symlinks/,
  );
});

symlinkTest("Organization data validator rejects a symlinked published changeset directory without traversing it", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    assert.equal(spawnSync("git", ["init", "-q"], { cwd: dataRoot }).status, 0);
    assert.equal(spawnSync("git", ["add", "."], { cwd: dataRoot }).status, 0);

    const evidencePath = "data/mission-control/reports/symlink-authorized-evidence.md";
    const evidenceContent = "# Symlink-authorized evidence\n";
    const roadmapPath = join(
      dataRoot,
      "data/mission-control/roadmaps/2026/RM-0001-template-runtime.yaml",
    );
    const roadmap = parseYaml(readFileSync(roadmapPath, "utf8"));
    roadmap.steps[0].evidence_refs[0].path = evidencePath;
    writeFileSync(roadmapPath, stringifyYaml(roadmap));
    writeFileSync(join(dataRoot, evidencePath), evidenceContent);

    const publishedRoot = join(dataRoot, "data/mission-control/changesets/published");
    const outsidePublishedRoot = join(dataRoot, "..", "outside-published");
    rmSync(publishedRoot, { recursive: true, force: true });
    mkdirSync(outsidePublishedRoot, { recursive: true });
    writeFileSync(
      join(outsidePublishedRoot, "symlink-authority.json"),
      `${JSON.stringify({
        schema_version: "companiesascode.mission_control.changeset.v1",
        id: "symlink-authority",
        status: "published",
        created_at: "2026-07-19T10:00:00.000Z",
        created_by: "template-agent",
        operations: [
          {
            action: "write_file",
            path: evidencePath,
            content: evidenceContent,
          },
        ],
        approval: {
          approved_at: "2026-07-19T10:01:00.000Z",
          approved_by: "template-steward",
          role: "steward",
        },
        published_at: "2026-07-19T10:02:00.000Z",
        published_by: "template-publisher",
        credential_authority: {
          writer_id: "template-data-writer",
          custody_role: "steward",
          branch: "v3",
          path_allowlist: ["data/mission-control/reports/**"],
        },
      }, null, 2)}\n`,
    );
    writeFileSync(
      join(outsidePublishedRoot, "attacker-controlled.json"),
      "{malformed external audit\n",
    );
    symlinkSync(outsidePublishedRoot, publishedRoot, "dir");
  });
  assert.notEqual(result.status, 0);
  const output = `${result.stdout}\n${result.stderr}`;
  assert.match(
    output,
    /directory data\/mission-control\/changesets\/published must be a real directory inside the data repository/,
  );
  assert.doesNotMatch(output, /attacker-controlled\.json/);
});

symlinkTest("Organization data validator skips every unsafe changeset directory", () => {
  for (const directoryName of ["pending", "superseded"]) {
    const result = runOrganizationDataValidator((dataRoot) => {
      instantiateOrganizationData(dataRoot, "DEV");
      const changesetRoot = join(
        dataRoot,
        "data/mission-control/changesets",
        directoryName,
      );
      const outsideRoot = join(dataRoot, "..", `outside-${directoryName}`);
      rmSync(changesetRoot, { recursive: true, force: true });
      mkdirSync(outsideRoot, { recursive: true });
      writeFileSync(
        join(outsideRoot, "attacker-controlled.json"),
        "{malformed external audit\n",
      );
      symlinkSync(outsideRoot, changesetRoot, "dir");
    });
    assert.notEqual(result.status, 0);
    const output = `${result.stdout}\n${result.stderr}`;
    assert.match(
      output,
      new RegExp(
        `directory data/mission-control/changesets/${directoryName} must be a real directory inside the data repository`,
      ),
    );
    assert.doesNotMatch(output, /attacker-controlled\.json/);
  }
});

test("Organization data validator matches runtime planning-target invariants", () => {
  const missingTargetResult = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    mutateTemplatePlan(dataRoot, (plan) => {
      delete plan.planning_target;
    });
  });
  assert.notEqual(missingTargetResult.status, 0);
  assert.match(
    `${missingTargetResult.stdout}\n${missingTargetResult.stderr}`,
    /planning_target is required when proposed_tasks is non-empty/,
  );

  const missingTasksResult = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    mutateTemplatePlan(dataRoot, (plan) => {
      plan.proposed_tasks = [];
    });
  });
  assert.notEqual(missingTasksResult.status, 0);
  assert.match(
    `${missingTasksResult.stdout}\n${missingTasksResult.stderr}`,
    /proposed_tasks must be non-empty when planning_target is present/,
  );

  const missingLedgerResult = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    mutateTemplatePlan(dataRoot, (plan) => {
      plan.planning_target.todo_tasks_path =
        "data/mission-control/missing/TODO.tasks.json";
    });
  });
  assert.notEqual(missingLedgerResult.status, 0);
  assert.match(
    `${missingLedgerResult.stdout}\n${missingLedgerResult.stderr}`,
    /planning_target\.todo_tasks_path does not exist/,
  );
});

test("Organization data validator matches runtime quality and placement invariants", () => {
  const placeholderResult = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    mutateTemplatePlan(dataRoot, (plan) => {
      plan.context = "Doplnit kontext.";
    });
  });
  assert.notEqual(placeholderResult.status, 0);
  assert.match(
    `${placeholderResult.stdout}\n${placeholderResult.stderr}`,
    /context must not contain placeholder text/,
  );

  const placementResult = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const sourcePath = join(
      dataRoot,
      "data/mission-control/plans/2026/01/DEV-0001-template-runtime.yaml",
    );
    const targetDirectory = join(dataRoot, "data/mission-control/plans/2026/02");
    mkdirSync(targetDirectory, { recursive: true });
    renameSync(sourcePath, join(targetDirectory, "DEV-0001-template-runtime.yaml"));
  });
  assert.notEqual(placementResult.status, 0);
  assert.match(
    `${placementResult.stdout}\n${placementResult.stderr}`,
    /plan must stay in data\/mission-control\/plans\/2026\/01\/ according to created_at/,
  );
});

test("Organization data validator binds plan id and filename to dev_code", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const planRoot = join(dataRoot, "data/mission-control/plans/2026/01");
    const sourcePath = join(planRoot, "DEV-0001-template-runtime.yaml");
    const targetPath = join(planRoot, "wrong-name.yaml");
    const text = readFileSync(sourcePath, "utf8").replace(
      "id: mcplan-dev-0001",
      "id: mcplan-dev-9999",
    );
    writeFileSync(sourcePath, text);
    renameSync(sourcePath, targetPath);
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /id must equal mcplan-dev-0001/);
  assert.match(`${result.stdout}\n${result.stderr}`, /filename must start with DEV-0001-/);
});

test("Organization data validator rejects duplicate plan ids and dev_codes", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const planRoot = join(dataRoot, "data/mission-control/plans/2026/01");
    cpSync(
      join(planRoot, "DEV-0001-template-runtime.yaml"),
      join(planRoot, "DEV-0001-duplicate.yaml"),
    );
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /duplicate dev_code DEV-0001/);
  assert.match(`${result.stdout}\n${result.stderr}`, /duplicate id mcplan-dev-0001/);
});

test("Organization data validator keeps changeset audit directories canonical", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const configPath = join(dataRoot, "data/mission-control/mission-control.config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.publish_policy.pending_changesets_dir = "data/other/pending";
    config.publish_policy.published_changesets_dir = "data/other/published";
    config.publish_policy.superseded_changesets_dir = "data/other/superseded";
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /publish_policy\.pending_changesets_dir/);
  assert.match(`${result.stdout}\n${result.stderr}`, /publish_policy\.published_changesets_dir/);
  assert.match(`${result.stdout}\n${result.stderr}`, /publish_policy\.superseded_changesets_dir/);
});

test("Organization data validator binds changeset ids to filenames across all changeset ledgers", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const changeset = (id, status) => ({
      schema_version: "companiesascode.mission_control.changeset.v1",
      id,
      status,
      operations: [
        {
          action: "write_file",
          path: "data/mission-control/reports/audit-id-check.txt",
          content: "checked\n",
        },
      ],
    });
    writeFileSync(
      join(dataRoot, "data/mission-control/changesets/pending/alias.json"),
      `${JSON.stringify(changeset("shared-id", "pending"), null, 2)}\n`,
    );
    writeFileSync(
      join(dataRoot, "data/mission-control/changesets/published/shared-id.json"),
      `${JSON.stringify(changeset("shared-id", "published"), null, 2)}\n`,
    );
    writeFileSync(
      join(dataRoot, "data/mission-control/changesets/pending/invalid.json"),
      `${JSON.stringify(changeset("Invalid_ID", "pending"), null, 2)}\n`,
    );
    writeFileSync(
      join(dataRoot, "data/mission-control/changesets/superseded/shared-id.json"),
      `${JSON.stringify(changeset("shared-id", "superseded"), null, 2)}\n`,
    );
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /id must equal filename basename alias/);
  assert.match(`${result.stdout}\n${result.stderr}`, /duplicate changeset id shared-id/);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /id must use lowercase letters, numbers and hyphens only/,
  );
});

test("Organization data validator requires a supersession audit and an existing replacement", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const superseded = {
      schema_version: "companiesascode.mission_control.changeset.v1",
      id: "stale-change",
      status: "superseded",
      operations: [{
        action: "write_file",
        path: "data/mission-control/reports/stale-change.txt",
        content: "stale\n",
      }],
      supersession: {
        superseded_at: "2026-07-19T08:00:00.000Z",
        superseded_by: "template-steward",
        role: "steward",
        reason: "Replaced by a corrected proposal.",
        replacement_changeset_id: "missing-replacement",
      },
    };
    writeFileSync(
      join(dataRoot, "data/mission-control/changesets/superseded/stale-change.json"),
      `${JSON.stringify(superseded, null, 2)}\n`,
    );
    const cyclicTarget = {
      ...superseded,
      id: "cyclic-target",
      supersession: {
        ...superseded.supersession,
        replacement_changeset_id: "cyclic-source",
      },
    };
    const cyclicSource = {
      ...superseded,
      id: "cyclic-source",
      supersession: {
        ...superseded.supersession,
        replacement_changeset_id: cyclicTarget.id,
      },
    };
    for (const changeset of [cyclicTarget, cyclicSource]) {
      writeFileSync(
        join(dataRoot, `data/mission-control/changesets/superseded/${changeset.id}.json`),
        `${JSON.stringify(changeset, null, 2)}\n`,
      );
    }
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /replacement changeset does not exist: missing-replacement/);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /changeset supersession cycle:/,
  );
});

test("Organization data validator requires canonical organization_admin", () => {
  const result = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
    const configPath = join(dataRoot, "data/mission-control/mission-control.config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    delete config.organization_admin;
    config.workspace_admin = "legacy-workspace-admin";
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /organization_admin/);
  assert.match(`${result.stdout}\n${result.stderr}`, /legacy workspace_admin/);
});

test("Organization data validator rejects the unreplaced admin placeholder", () => {
  for (const placeholder of [
    "REPLACE_WITH_ORGANIZATION_ADMIN",
    " REPLACE_WITH_ORGANIZATION_ADMIN ",
  ]) {
    const placeholderResult = runOrganizationDataValidator((dataRoot) => {
      instantiateOrganizationData(dataRoot, "DEV");
      const configPath = join(dataRoot, "data/mission-control/mission-control.config.json");
      const config = JSON.parse(readFileSync(configPath, "utf8"));
      config.organization_admin = placeholder;
      writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    });
    assert.notEqual(placeholderResult.status, 0);
    assert.match(
      `${placeholderResult.stdout}\n${placeholderResult.stderr}`,
      /organization_admin placeholder must be replaced/,
    );
  }

  const instantiatedResult = runOrganizationDataValidator((dataRoot) => {
    instantiateOrganizationData(dataRoot, "DEV");
  });
  assert.equal(
    instantiatedResult.status,
    0,
    `${instantiatedResult.stdout}\n${instantiatedResult.stderr}`,
  );
});

test("MissionControlDataAdapter runtime remains part of the template contract", () => {
  const failures = withTempTemplate((tempRoot) => {
    rmSync(join(tempRoot, "src/mission-control-data-adapter.mjs"), { force: true });
    const packageJson = JSON.parse(readFileSync(packageJsonPath(tempRoot), "utf8"));
    packageJson.scripts.test = "node --test scripts/check-template.test.mjs";
    writeFileSync(packageJsonPath(tempRoot), `${JSON.stringify(packageJson, null, 2)}\n`);
  });
  assert.ok(
    failures.some((failure) => failure.includes("missing required file: src/mission-control-data-adapter.mjs")),
    failures.join("\n"),
  );
  assert.ok(
    failures.some((failure) => failure.includes("package.json: test script must include src/mission-control-data-adapter.test.mjs")),
    failures.join("\n"),
  );
});

test("v3 app runtime is part of the reusable template contract", () => {
  const failures = withTempTemplate((tempRoot) => {
    rmSync(join(tempRoot, "app/v3/src/server.ts"), { force: true });
    const packageJson = JSON.parse(readFileSync(packageJsonPath(tempRoot), "utf8"));
    delete packageJson.scripts["app:validate"];
    delete packageJson.scripts["app:typecheck"];
    delete packageJson.scripts["app:test"];
    delete packageJson.scripts["app:build"];
    writeFileSync(packageJsonPath(tempRoot), `${JSON.stringify(packageJson, null, 2)}\n`);
  });
  assert.ok(failures.some((failure) => failure.includes("missing required file: app/v3/src/server.ts")), failures.join("\n"));
  assert.ok(failures.some((failure) => failure.includes("package.json: scripts must include app:validate")), failures.join("\n"));
  assert.ok(failures.some((failure) => failure.includes("package.json: scripts must include app:build")), failures.join("\n"));
});

test("checker accepts explicit template and Organization instance modes", () => {
  const templateFailures = validateTemplate(root);
  assert.deepEqual(templateFailures, []);

  const organizationFailures = withTempTemplate((tempRoot) => {
    configureOrganizationRuntime(tempRoot);
  });
  assert.deepEqual(organizationFailures, []);
});

test("Organization mode may omit template distribution files but keeps shared documentation checks", () => {
  const organizationFailures = withTempTemplate((tempRoot) => {
    configureOrganizationRuntime(tempRoot);
    removeTemplateOnlyDistributionFiles(tempRoot);
  });
  assert.deepEqual(organizationFailures, []);

  const partialDistributionFailures = withTempTemplate((tempRoot) => {
    configureOrganizationRuntime(tempRoot);
    rmSync(join(tempRoot, "templates/launchpad-app/package.json.template"), {
      force: true,
    });
  });
  assert.ok(
    partialDistributionFailures.some((failure) =>
      failure.includes("templates/launchpad-app/package.json.template: must contain lazurio.runtime"),
    ),
    partialDistributionFailures.join("\n"),
  );

  const documentationFailures = withTempTemplate((tempRoot) => {
    configureOrganizationRuntime(tempRoot);
    removeTemplateOnlyDistributionFiles(tempRoot);
    writeFileSync(
      join(tempRoot, "docs/doctor-managed-install.md"),
      "# Doctor-managed install contract\n\nMissing shared install vocabulary.\n",
    );
    writeFileSync(
      join(tempRoot, "docs/mission-control-v3-operating-manual.md"),
      "# Mission Control\n\nMissing shared operating vocabulary.\n",
    );
  });
  assert.ok(
    documentationFailures.some((failure) =>
      failure.includes("doctor install docs must explain origin=<Org>/mission-control"),
    ),
    documentationFailures.join("\n"),
  );
  assert.ok(
    documentationFailures.some((failure) =>
      failure.includes("operating manual must explain Lazurio"),
    ),
    documentationFailures.join("\n"),
  );
});

test("checker binds Organization package and Launchpad identities to explicit mode", () => {
  const failures = withTempTemplate((tempRoot) => {
    const packagePath = packageJsonPath(tempRoot);
    const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
    packageJson.companyascode.mission_control.mode = "organization";
    packageJson.companyascode.mission_control.organization = {
      slug: "Example-Org",
      display_name: "REPLACE_WITH_ORG_NAME",
    };
    writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

    const appPath = join(tempRoot, "app/v3/package.json");
    const appPackage = JSON.parse(readFileSync(appPath, "utf8"));
    appPackage.lazurio.runtime.id = "different-mission-control-v3";
    appPackage.lazurio.runtime.company = "Different";
    writeFileSync(appPath, `${JSON.stringify(appPackage, null, 2)}\n`);

    const modulePath = join(tempRoot, "lazurio.module.json");
    const moduleManifest = JSON.parse(readFileSync(modulePath, "utf8"));
    moduleManifest.company = "Different";
    moduleManifest.port_leases[0].port = 80;
    writeFileSync(modulePath, `${JSON.stringify(moduleManifest, null, 2)}\n`);
  });
  assert.ok(
    failures.some((failure) => failure.includes("display_name must be concrete")),
    failures.join("\n"),
  );
  assert.ok(
    failures.some((failure) => failure.includes("root package name must be example-org-mission-control")),
    failures.join("\n"),
  );
  assert.ok(
    failures.some((failure) => failure.includes("app/v3 package name must be @example-org/mission-control-v3")),
    failures.join("\n"),
  );
  assert.ok(
    failures.some((failure) => failure.includes("company/id must match")),
    failures.join("\n"),
  );
  assert.ok(
    failures.some((failure) => failure.includes("must own one main lease")),
    failures.join("\n"),
  );
});

test("Launchpad runtime declares the Mission Control data slot prerequisite", () => {
  const failures = withTempTemplate((tempRoot) => {
    const appPath = join(tempRoot, "app/v3/package.json");
    const appPackage = JSON.parse(readFileSync(appPath, "utf8"));
    delete appPackage.lazurio.runtime.required_module_slots;
    writeFileSync(appPath, `${JSON.stringify(appPackage, null, 2)}\n`);
  });
  assert.ok(
    failures.some((failure) => failure.includes("required_module_slots")),
    failures.join("\n"),
  );
});

test("root tooling uses the cross-platform v3 wrapper and offers no second start path", () => {
  const failures = withTempTemplate((tempRoot) => {
    const packagePath = packageJsonPath(tempRoot);
    const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
    packageJson.scripts.dev =
      "export MISSION_CONTROL_ROOT=$PWD; cd app/v3 && bun run dev";
    packageJson.scripts.export = "cd app/v3 && bun run export";
    delete packageJson.packageManager;
    packageJson.scripts.test = packageJson.scripts.test.replace(
      "scripts/run-v3.test.mjs ",
      "",
    );
    writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  });
  assert.ok(
    failures.some((failure) =>
      failure.includes("package.json: dev must not be declared; the App starts only through app/v3 dev"),
    ),
    failures.join("\n"),
  );
  assert.ok(
    failures.some((failure) => failure.includes("export must use the cross-platform")),
    failures.join("\n"),
  );
  assert.ok(
    failures.some((failure) => failure.includes("package.json: packageManager must pin an exact bun@<version>")),
    failures.join("\n"),
  );
  assert.ok(
    failures.some((failure) => failure.includes("test script must include scripts/run-v3.test.mjs")),
    failures.join("\n"),
  );
});

test("root test validates the Organization mount before isolated app fixtures", () => {
  const failures = withTempTemplate((tempRoot) => {
    const packagePath = packageJsonPath(tempRoot);
    const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
    packageJson.scripts.test = packageJson.scripts.test.replace(
      "bun run check && ",
      "",
    );
    writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  });
  assert.ok(
    failures.some((failure) =>
      failure.includes("must run bun run check before isolated app fixtures"),
    ),
    failures.join("\n"),
  );
});

test("template guard rejects concrete Organization identity in reusable code and docs", () => {
  const failures = withTempTemplate((tempRoot) => {
    const company = ["North", "wind"].join("");
    const person = ["jane", "roe"].join("-");
    writeFileSync(join(tempRoot, "docs/doctor-managed-install.md"), `# Install\n\n${company} / ${person} should not be baked into the template.\n`);
  });
  assert.ok(failures.some((failure) => failure.includes("forbidden live-data marker Northwind")), failures.join("\n"));
  assert.ok(failures.some((failure) => failure.includes("forbidden live-data marker jane-roe")), failures.join("\n"));
});

test("Organization identity exemption applies only to package and Lazurio identity fields", () => {
  const failures = withTempTemplate((tempRoot) => {
    configureOrganizationRuntime(tempRoot, {
      slug: "Northwind",
      displayName: "Northwind",
    });

    writeFileSync(
      join(tempRoot, "docs/doctor-managed-install.md"),
      `${readFileSync(join(tempRoot, "docs/doctor-managed-install.md"), "utf8")}\nNorthwind must not leak into reusable documentation.\n`,
    );
  });
  assert.ok(
    failures.some(
      (failure) =>
        failure.includes("docs/doctor-managed-install.md") &&
        failure.includes("forbidden live-data marker Northwind"),
    ),
    failures.join("\n"),
  );
  assert.ok(
    !failures.some(
      (failure) =>
        (failure.startsWith("package.json:") ||
          failure.startsWith("app/v3/package.json:") ||
          failure.startsWith("lazurio.module.json:")) &&
        failure.includes("forbidden live-data marker Northwind"),
    ),
    failures.join("\n"),
  );
});

test("Organization no-live-data guard ignores only the root db mount", () => {
  const person = ["Ren", "ée Roe"].join("");
  const failures = withTempTemplate((tempRoot) => {
    configureOrganizationRuntime(tempRoot);

    mkdirSync(join(tempRoot, "db", "data", "mission-control"), {
      recursive: true,
    });
    writeFileSync(
      join(tempRoot, "db", "data", "mission-control", "TODO.tasks.json"),
      `${JSON.stringify([{ owner: person }], null, 2)}\n`,
    );
    writeFileSync(
      join(tempRoot, "client-note.md"),
      `# App-code leak\n\n${person} must still be rejected outside the nested data mount.\n`,
    );
  });
  assert.ok(
    !failures.some((failure) => failure.startsWith("db/")),
    failures.join("\n"),
  );
  assert.ok(
    failures.some(
      (failure) =>
        failure.startsWith("client-note.md:") &&
        failure.includes("forbidden live-data marker Renée Roe"),
    ),
    failures.join("\n"),
  );
});

test("template no-live-data guard still scans a stray root db directory", () => {
  const person = ["Ren", "ée Roe"].join("");
  const failures = withTempTemplate((tempRoot) => {
    const packagePath = packageJsonPath(tempRoot);
    const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
    packageJson.name = "mission-control-template";
    packageJson.companyascode.mission_control.mode = "template";
    packageJson.companyascode.mission_control.organization = {
      slug: "REPLACE_WITH_ORG_SLUG",
      display_name: "REPLACE_WITH_ORG_NAME",
    };
    writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

    const appPath = join(tempRoot, "app/v3/package.json");
    const appPackage = JSON.parse(readFileSync(appPath, "utf8"));
    appPackage.name = "mission-control-v3-app";
    appPackage.lazurio.runtime.id =
      "replace-with-org-slug-mission-control-v3";
    appPackage.lazurio.runtime.company = "REPLACE-WITH-ORG-NAME";
    writeFileSync(appPath, `${JSON.stringify(appPackage, null, 2)}\n`);

    mkdirSync(join(tempRoot, "db"), { recursive: true });
    writeFileSync(join(tempRoot, "db", "stray.md"), `${person}\n`);
  });
  assert.ok(
    failures.some(
      (failure) =>
        failure.startsWith("db/stray.md:") &&
        failure.includes("forbidden live-data marker Renée Roe"),
    ),
    failures.join("\n"),
  );
});

test("doctor install docs explain fork-sync and data mount contract", () => {
  const failures = withTempTemplate((tempRoot) => {
    writeFileSync(join(tempRoot, "docs/doctor-managed-install.md"), "# Doctor-managed install contract\n\nMissing fork-sync vocabulary.\n");
  });
  assert.ok(failures.some((failure) => failure.includes("doctor install docs must explain origin=<Org>/mission-control")), failures.join("\n"));
  assert.ok(failures.some((failure) => failure.includes("doctor install docs must explain branch v3")), failures.join("\n"));
});

templateContractTest("Launchpad app package template keeps one module-owned listener", () => {
  const failures = withTempTemplate((tempRoot) => {
    const packagePath = join(tempRoot, "templates/launchpad-app/package.json.template");
    const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
    packageJson.lazurio.runtime.listeners.push({
      id: "api",
      role: "internal",
      lease: "api",
      protocol: "http",
    });
    packageJson.lazurio.runtime.tags = ["mission-control"];
    writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

    const modulePath = join(tempRoot, "templates/launchpad-app/lazurio.module.json.template");
    const moduleManifest = JSON.parse(readFileSync(modulePath, "utf8"));
    moduleManifest.tcp_port_policy.mode = "exception";
    moduleManifest.port_leases.push({ id: "api", host: "127.0.0.1", port: 5502 });
    writeFileSync(modulePath, `${JSON.stringify(moduleManifest, null, 2)}\n`);
  });
  assert.ok(failures.some((failure) => failure.includes("one valid main entrypoint lease")), failures.join("\n"));
  assert.ok(failures.some((failure) => failure.includes("must own one static main lease")), failures.join("\n"));
  assert.ok(failures.some((failure) => failure.includes("tags must include mission-control and first-client")), failures.join("\n"));
});

test("runtime source rejects a hidden second listener and ambient port fallback", () => {
  const failures = withTempTemplate((tempRoot) => {
    const serverPath = join(tempRoot, "app/v3/src/server.ts");
    const anchor = "const { host, port, externalOrigin, security } = startConfiguration();";
    const source = readFileSync(serverPath, "utf8");
    assert.ok(source.includes(anchor));
    const server = source.replace(
      anchor,
      `${anchor}\n\tconst ambientPort = process.env.PORT;`,
    );
    writeFileSync(serverPath, server);

    const vitePath = join(tempRoot, "app/v3/vite.config.ts");
    const vite = readFileSync(vitePath, "utf8").replace(
      "plugins: [react()],",
      "plugins: [react()],\n  server: { port: 5502 },",
    );
    writeFileSync(vitePath, vite);
  });
  assert.ok(failures.some((failure) => failure.includes("must not use process.env.PORT")), failures.join("\n"));
  assert.ok(failures.some((failure) => failure.includes("Vite must not own a server")), failures.join("\n"));
});

test("runtime source must read the hosted external origin contract", () => {
  const failures = withTempTemplate((tempRoot) => {
    const serverPath = join(tempRoot, "app/v3/src/server.ts");
    const server = readFileSync(serverPath, "utf8").replaceAll(
      "LAZURIO_RUNTIME_LISTENER_WEB_EXTERNAL_ORIGIN",
      "LAZURIO_RUNTIME_LISTENER_WEB_PUBLIC_ORIGIN",
    );
    writeFileSync(serverPath, server);
  });
  assert.ok(
    failures.some((failure) =>
      failure.includes("app/v3/src/server.ts: must read LAZURIO_RUNTIME_LISTENER_WEB_EXTERNAL_ORIGIN"),
    ),
    failures.join("\n"),
  );
});

test("runtime source rejects a duplicated numeric lease fallback", () => {
  const failures = withTempTemplate((tempRoot) => {
    const moduleManifest = JSON.parse(
      readFileSync(join(tempRoot, "lazurio.module.json"), "utf8"),
    );
    const mainLeasePort = moduleManifest.port_leases.find(
      (lease) => lease.id === "main",
    ).port;
    const serverPath = join(tempRoot, "app/v3/src/server.ts");
    const anchor = "const { host, port, externalOrigin, security } = startConfiguration();";
    const source = readFileSync(serverPath, "utf8");
    assert.ok(source.includes(anchor));
    const server = source.replace(
      anchor,
      `${anchor}\n\tconst fallbackPort = port || ${mainLeasePort};`,
    );
    writeFileSync(serverPath, server);
  });
  assert.ok(
    failures.some((failure) =>
      failure.includes("runtime source must not duplicate lazurio.module.json lease ports"),
    ),
    failures.join("\n"),
  );
});

test("runtime source rejects reading the lease file instead of the listener environment", () => {
  const failures = withTempTemplate((tempRoot) => {
    const serverPath = join(tempRoot, "app/v3/src/server.ts");
    const server = readFileSync(serverPath, "utf8")
      .replace("listener('web')", "readLease('../../../lazurio.module.json')");
    writeFileSync(serverPath, server);
  });
  assert.ok(
    failures.some((failure) => failure.includes("app/v3/src/server.ts: must read listener('web')")),
    failures.join("\n"),
  );
  assert.ok(
    failures.some((failure) => failure.includes("must not read the lazurio.module.json lease file")),
    failures.join("\n"),
  );
});

test("app start stays one process with the client build as declared preparation", () => {
  const failures = withTempTemplate((tempRoot) => {
    const appPath = join(tempRoot, "app/v3/package.json");
    const appPackage = JSON.parse(readFileSync(appPath, "utf8"));
    appPackage.scripts.dev =
      'bun run prepare:app && concurrently "bun run src/server.ts" "bun run dev:client"';
    appPackage.scripts.prepare = appPackage.scripts["prepare:app"];
    appPackage.devDependencies.concurrently = "^9.2.1";
    delete appPackage.lazurio.preparation;
    delete appPackage.packageManager;
    writeFileSync(appPath, `${JSON.stringify(appPackage, null, 2)}\n`);
  });
  for (const expected of [
    "dev must start exactly one Bun server process",
    "lazurio.preparation must declare prepare:app and check:prepared",
    "prepare is an npm lifecycle script",
    "concurrently is not allowed",
    "app/v3/package.json: packageManager must pin an exact bun@<version>",
  ]) {
    assert.ok(failures.some((failure) => failure.includes(expected)), `${expected}\n${failures.join("\n")}`);
  }
});

test("readiness check must be the App's own read-only check of the client build", () => {
  const failures = withTempTemplate((tempRoot) => {
    const appPath = join(tempRoot, "app/v3/package.json");
    const appPackage = JSON.parse(readFileSync(appPath, "utf8"));
    appPackage.scripts["check:prepared"] = 'bun -e "process.exit(0)"';
    writeFileSync(appPath, `${JSON.stringify(appPackage, null, 2)}\n`);
  });
  assert.ok(
    failures.some((failure) =>
      failure.includes("check:prepared must run the App's own readiness check (bun run src/prepared.ts)"),
    ),
    failures.join("\n"),
  );
});

function readinessFailures(source) {
  return withTempTemplate((tempRoot) => {
    writeFileSync(join(tempRoot, "app/v3/src/prepared.ts"), source);
  });
}

test("readiness check is run: inert markers in comments do not certify an unprepared App", () => {
  const failures = readinessFailures(
    "// '../dist/index.html' and process.exit(1) are inert text.\nprocess.exit(0);\n",
  );
  assert.ok(
    failures.some((failure) =>
      failure.includes("app/v3/src/prepared.ts: readiness check exits 0 without dist/index.html"),
    ),
    failures.join("\n"),
  );
});

test("readiness check must pass once dist/index.html exists", () => {
  const failures = readinessFailures("process.exit(1);\n");
  assert.ok(
    failures.some((failure) =>
      failure.includes("app/v3/src/prepared.ts: readiness check exits 1 although dist/index.html exists"),
    ),
    failures.join("\n"),
  );
});

test("readiness check must write nothing, even when it hides the write API", () => {
  const failures = readinessFailures(
    [
      "const fs = await import(['node', 'fs'].join(':'));",
      "const make = fs[['mk', 'dir', 'Sync'].join('')];",
      "make(new URL('../dist/', import.meta.url), { recursive: true });",
      "fs[['write', 'File', 'Sync'].join('')](new URL('../dist/index.html', import.meta.url), 'x');",
      "",
    ].join("\n"),
  );
  for (const expected of [
    "app/v3/src/prepared.ts: readiness check without dist/index.html wrote files",
    "app/v3/src/prepared.ts: readiness check exits 0 without dist/index.html",
  ]) {
    assert.ok(failures.some((failure) => failure.includes(expected)), `${expected}\n${failures.join("\n")}`);
  }
  const visible = readinessFailures("await Bun.spawn(['bun', 'run', 'prepare:app']).exited;\n");
  assert.ok(
    visible.some((failure) => failure.includes("app/v3/src/prepared.ts: readiness check must be read-only")),
    visible.join("\n"),
  );
});

test("readiness check must not start or wait for a server", () => {
  const failures = readinessFailures(
    "Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('ok') });\n",
  );
  assert.ok(
    failures.some((failure) =>
      failure.includes("readiness check without dist/index.html did not finish within 15 s"),
    ),
    failures.join("\n"),
  );
});

test("readiness check source is required", () => {
  const missing = withTempTemplate((tempRoot) => {
    rmSync(join(tempRoot, "app/v3/src/prepared.ts"));
  });
  assert.ok(
    missing.some((failure) => failure.includes("app/v3/src/prepared.ts: missing")),
    missing.join("\n"),
  );
});

test("the Launchpad entry is only dev_script dev, with no preview_script", () => {
  const failures = withTempTemplate((tempRoot) => {
    const appPath = join(tempRoot, "app/v3/package.json");
    const appPackage = JSON.parse(readFileSync(appPath, "utf8"));
    appPackage.scripts.start = "bun run src/server.ts";
    appPackage.lazurio.runtime.dev_script = "start";
    appPackage.lazurio.runtime.preview_script = "start";
    writeFileSync(appPath, `${JSON.stringify(appPackage, null, 2)}\n`);
  });
  assert.ok(
    failures.some((failure) =>
      failure.includes("lazurio.runtime must start only dev_script dev and declare no preview_script"),
    ),
    failures.join("\n"),
  );
});

test("developer convenience scripts are not policed as start paths", () => {
  // The Launchpad runs only dev_script; aliases are not a security boundary.
  const failures = withTempTemplate((tempRoot) => {
    const appPath = join(tempRoot, "app/v3/package.json");
    const appPackage = JSON.parse(readFileSync(appPath, "utf8"));
    appPackage.scripts["serve:app"] = "bun run -- dev";
    writeFileSync(appPath, `${JSON.stringify(appPackage, null, 2)}\n`);
  });
  assert.deepEqual(failures, []);
});

test("roadmap schema must keep Priority and Roadmap Step planning gates", () => {
  const failures = withTempTemplate((tempRoot) => {
    const schemaPath = join(tempRoot, "schemas/mission-control-roadmap.schema.json");
    const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
    schema.required = schema.required.filter((field) => field !== "priorities");
    delete schema.properties.steps.items.allOf;
    writeFileSync(schemaPath, `${JSON.stringify(schema, null, 2)}\n`);
  });
  assert.ok(failures.some((failure) => failure.includes("roadmap schema must require priorities")), failures.join("\n"));
  assert.ok(failures.some((failure) => failure.includes("executable Roadmap Steps must require plan_refs, todo_refs, or issue_refs")), failures.join("\n"));
  assert.ok(failures.some((failure) => failure.includes("done Roadmap Steps must require evidence_refs")), failures.join("\n"));
});

test("roadmap schema must keep executable refs non-empty", () => {
  const failures = withTempTemplate((tempRoot) => {
    const schemaPath = join(tempRoot, "schemas/mission-control-roadmap.schema.json");
    const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
    const step = schema.properties.steps.items;
    for (const ref of ["plan_refs", "todo_refs", "issue_refs"]) {
      delete step.properties[ref].minItems;
    }
    for (const option of step.allOf[0].then.anyOf) {
      for (const ref of ["plan_refs", "todo_refs", "issue_refs"]) {
        if (option.properties?.[ref]) delete option.properties[ref].minItems;
      }
    }
    writeFileSync(schemaPath, `${JSON.stringify(schema, null, 2)}\n`);
  });
  assert.ok(failures.some((failure) => failure.includes("roadmap schema executable refs must have minItems 1")), failures.join("\n"));
});

test("roadmap schema must keep done evidence non-empty", () => {
  const failures = withTempTemplate((tempRoot) => {
    const schemaPath = join(tempRoot, "schemas/mission-control-roadmap.schema.json");
    const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
    delete schema.properties.steps.items.properties.evidence_refs.minItems;
    writeFileSync(schemaPath, `${JSON.stringify(schema, null, 2)}\n`);
  });
  assert.ok(failures.some((failure) => failure.includes("roadmap schema evidence_refs must have minItems 1")), failures.join("\n"));
});

test("roadmap planning model docs are part of the template contract", () => {
  const failures = withTempTemplate((tempRoot) => {
    writeFileSync(join(tempRoot, "docs/roadmap-planning-model.md"), "# Roadmaps\n\nMissing the required vocabulary.\n");
  });
  assert.ok(failures.some((failure) => failure.includes("roadmap planning docs must explain Roadmap Priority")), failures.join("\n"));
  assert.ok(failures.some((failure) => failure.includes("roadmap planning docs must explain Roadmap Step")), failures.join("\n"));
});

test("operating manual is part of the shared template and Organization contract", () => {
  const failures = withTempTemplate((tempRoot) => {
    writeFileSync(join(tempRoot, "docs/mission-control-v3-operating-manual.md"), "# Mission Control\n\nMissing required operating vocabulary.\n");
  });
  assert.ok(failures.some((failure) => failure.includes("operating manual must explain Lazurio")), failures.join("\n"));
});

templateContractTest("license and module docs are part of the template distribution contract", () => {
  const failures = withTempTemplate((tempRoot) => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath(tempRoot), "utf8"));
    delete packageJson.license;
    writeFileSync(packageJsonPath(tempRoot), `${JSON.stringify(packageJson, null, 2)}\n`);
    writeFileSync(join(tempRoot, "LICENSE"), "Proprietary\n");
    writeFileSync(join(tempRoot, "docs/v3-module-documentation-standard.md"), "# Modules\n\nMissing required module vocabulary.\n");
  });
  assert.ok(failures.some((failure) => failure.includes("package.json: license must be MIT")), failures.join("\n"));
  assert.ok(failures.some((failure) => failure.includes("LICENSE: must contain the MIT License grant")), failures.join("\n"));
  assert.ok(
    failures.some((failure) => failure.includes("v3 module documentation standard must explain Required files")),
    failures.join("\n"),
  );
});
