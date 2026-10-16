import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertRepositoryReadyForLocalMutation,
  assertRepositoryReadyForPublish,
  createMissionControlLocalDraft,
  getMissionControlRepositoryStatus,
  getMissionControlWriterStatus,
  installMissionControlTestGitExecutable,
  listMissionControlChangesets,
  listMissionControlLocalDrafts,
  publishMissionControlLocalDraft,
  withMissionControlRepositoryWriteLock,
} from "./mission-control-publish-flow.mjs";
import {
  getMissionControlFreshness,
  pullMissionControlRepository,
} from "./mission-control-pull.mjs";
import { installLocalCredentialHelperFixture } from "../test-support/local-credential-helper.mjs";
import {
  installLocalSshGitTransport,
  localSshRemoteUrl,
  seedMissionControlDataFixture,
} from "../test-support/local-ssh-git.mjs";
import { resolveNativeGitExecutable } from "../test-support/native-git.mjs";

// Test fixtures create Git repositories with the host's default line-ending
// policy. Force LF so Windows hosts with core.autocrlf=true cannot turn
// fixture worktrees into CRLF copies that no longer match their LF blobs.
process.env.GIT_CONFIG_PARAMETERS = [
  process.env.GIT_CONFIG_PARAMETERS,
  "'core.autocrlf=false' 'core.eol=lf'",
].filter(Boolean).join(" ");

const releaseLocalSshTransport = installLocalSshGitTransport();
test.after(releaseLocalSshTransport);

const REAL_GIT_EXECUTABLE = resolveNativeGitExecutable();

function git(cwd, args, env = process.env) {
  return execFileSync(REAL_GIT_EXECUTABLE, args, {
    cwd,
    encoding: "utf8",
    env: { ...env },
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function testGitProxySource() {
  return [
    "#!/usr/bin/env node",
    "const { spawnSync } = require('node:child_process');",
    "const { appendFileSync, existsSync, writeFileSync } = require('node:fs');",
    "const { join } = require('node:path');",
    "const args = process.argv.slice(2);",
    "const realGit = process.env.MISSION_CONTROL_TEST_REAL_GIT;",
    "const mode = process.env.MISSION_CONTROL_TEST_GIT_PROXY_MODE || 'delegate';",
    "const marker = process.env.MISSION_CONTROL_TEST_GIT_PROXY_MARKER;",
    "const capture = process.env.MISSION_CONTROL_TEST_GIT_PROXY_CAPTURE;",
    "function commandFrom(values) {",
    "  for (let index = 0; index < values.length; index += 1) {",
    "    const value = values[index];",
    "    if (['-c', '-C', '--git-dir', '--work-tree'].includes(value)) { index += 1; continue; }",
    "    if (value.startsWith('-')) continue;",
    "    return value;",
    "  }",
    "  return '';",
    "}",
    "const command = commandFrom(args);",
    "if (capture) appendFileSync(capture, command + '\\n');",
    "if (marker && existsSync(marker) && command === 'ls-remote' &&",
    "    ['push-error-verify-fail', 'post-push-verify-fail'].includes(mode)) {",
    "  process.stderr.write('fixture remote verification failed\\n');",
    "  process.exit(98);",
    "}",
    "let delegatedArgs = args;",
    "if (mode === 'https' && ['fetch', 'push', 'ls-remote'].includes(command)) {",
    "  const helperConfig = [];",
    "  for (let index = 0; index < args.length - 1; index += 1) {",
    "    if (args[index] === '-c' && args[index + 1].startsWith('credential.helper=')) {",
    "      helperConfig.push('-c', args[index + 1]);",
    "      index += 1;",
    "    }",
    "  }",
    "  if (!helperConfig.some((value) => value.startsWith('credential.helper=') && value !== 'credential.helper=')) {",
    "    process.stderr.write('fixture HTTPS command received no credential helper\\n');",
    "    process.exit(91);",
    "  }",
    "  const filled = spawnSync(realGit, [...helperConfig, 'credential', 'fill'], {",
    "    input: 'protocol=https\\nhost=localhost\\n\\n',",
    "    encoding: 'utf8',",
    "    env: process.env,",
    "  });",
    "  if (filled.status !== 0 || !filled.stdout.includes('username=fixture-user')) {",
    "    process.stderr.write('fixture credential helper failed\\n');",
    "    process.exit(92);",
    "  }",
    "  if (capture) appendFileSync(capture, 'credential-ok\\n');",
    "  const mapping = 'url.' + process.env.MISSION_CONTROL_TEST_FILE_REMOTE_URL +",
    "    '.insteadOf=' + process.env.MISSION_CONTROL_TEST_HTTPS_REMOTE_URL;",
    "  delegatedArgs = ['-c', mapping, ...args];",
    "}",
    "if (mode === 'push-error-verify-fail' && command === 'push') {",
    "  if (marker) writeFileSync(marker, 'push-attempted\\n');",
    "  process.stderr.write('fixture push failed\\n');",
    "  process.exit(97);",
    "}",
    "if (mode === 'commit-extra-path' && command === 'commit') {",
    "  const injected = join(process.cwd(), 'data/mission-control/reports/fixture-injected.txt');",
    "  writeFileSync(injected, 'unexpected path\\n');",
    "  const added = spawnSync(realGit, ['add', '--', injected], { cwd: process.cwd(), env: process.env });",
    "  if (added.status !== 0) process.exit(added.status || 93);",
    "}",
    "const result = spawnSync(realGit, delegatedArgs, {",
    "  cwd: process.cwd(),",
    "  env: process.env,",
    "  stdio: ['inherit', 'pipe', 'pipe'],",
    "});",
    "if (result.stdout) process.stdout.write(result.stdout);",
    "if (result.stderr) process.stderr.write(result.stderr);",
    "if (result.status !== 0) process.exit(result.status || 1);",
    "if (mode === 'commit-extra-parent' && command === 'commit') {",
    "  const output = (gitArgs) => spawnSync(realGit, gitArgs, { cwd: process.cwd(), env: process.env, encoding: 'utf8' }).stdout.trim();",
    "  const committed = output(['rev-parse', 'HEAD']);",
    "  const parent = output(['rev-parse', committed + '^']);",
    "  const tree = output(['rev-parse', committed + '^{tree}']);",
    "  const sibling = output(['commit-tree', tree, '-p', parent, '-m', 'fixture sibling']);",
    "  const merge = output(['commit-tree', tree, '-p', parent, '-p', sibling, '-m', 'fixture merge']);",
    "  const updated = spawnSync(realGit, ['update-ref', 'HEAD', merge, committed], { cwd: process.cwd(), env: process.env });",
    "  if (updated.status !== 0) process.exit(updated.status || 94);",
    "}",
    "if (mode === 'post-push-verify-fail' && command === 'push' && marker) {",
    "  writeFileSync(marker, 'push-completed\\n');",
    "}",
    "process.exit(0);",
    "",
  ].join("\n");
}

function installTestGitProxy({
  mode,
  capturePath,
  fileRemoteUrl = null,
  httpsRemoteUrl = null,
}) {
  const proxyRoot = join(tmpdir(), `mission-control-test-git-${process.pid}`);
  const proxyPath = join(proxyRoot, "git");
  const markerPath = join(proxyRoot, "network-marker");
  rmSync(proxyRoot, { recursive: true, force: true });
  mkdirSync(proxyRoot, { recursive: true });
  writeFileSync(proxyPath, testGitProxySource(), { mode: 0o700 });
  chmodSync(proxyPath, 0o700);
  const keys = {
    MISSION_CONTROL_TEST_REAL_GIT: REAL_GIT_EXECUTABLE,
    MISSION_CONTROL_TEST_GIT_PROXY_MODE: mode,
    MISSION_CONTROL_TEST_GIT_PROXY_MARKER: markerPath,
    MISSION_CONTROL_TEST_GIT_PROXY_CAPTURE: capturePath,
    MISSION_CONTROL_TEST_FILE_REMOTE_URL: fileRemoteUrl,
    MISSION_CONTROL_TEST_HTTPS_REMOTE_URL: httpsRemoteUrl,
  };
  const previous = new Map();
  for (const [key, value] of Object.entries(keys)) {
    previous.set(key, process.env[key]);
    if (value === null || value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const releaseInstalled = installMissionControlTestGitExecutable(proxyPath);
  return () => {
    releaseInstalled();
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(proxyRoot, { recursive: true, force: true });
  };
}

function createReportDraft(repositoryDbRoot, id) {
  return createMissionControlLocalDraft({
    repositoryDbRoot,
    draft: {
      id,
      summary: `Publish ${id}`,
      operations: [
        {
          action: "write_file",
          path: `data/mission-control/reports/${id}.txt`,
          content: `${id}\n`,
        },
      ],
    },
  });
}

function configureGitHubAppWorkspaceWriter({
  repositoryDbRoot,
  remotePath = null,
  extraPolicy = {},
}) {
  const configPath = join(
    repositoryDbRoot,
    "data/mission-control/mission-control.config.json",
  );
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  config.publish_policy.writer_mode = "github-app-workspace-v1";
  delete config.publish_policy.credential_authority;
  delete config.publish_policy.approval_roles;
  delete config.publish_policy.local_principal;
  Object.assign(config.publish_policy, extraPolicy);
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  if (remotePath !== null) {
    git(repositoryDbRoot, ["add", configPath]);
    git(repositoryDbRoot, [
      "commit",
      "-m",
      "test: enable GitHub App Workspace writer",
    ]);
    git(repositoryDbRoot, ["push", remotePath, "v3:v3"]);
    git(repositoryDbRoot, [
      "update-ref",
      "refs/remotes/origin/v3",
      "HEAD",
    ]);
  }
}

function withDataRepository(action) {
  const tempRoot = join(
    tmpdir(),
    `mission-control-native-writer-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  const remotePath = join(tempRoot, "mission-control-data.git");
  const remote = localSshRemoteUrl(remotePath);
  const repositoryDbRoot = join(tempRoot, "mission-control-data");
  mkdirSync(tempRoot, { recursive: true });
  const cleanup = () => rmSync(tempRoot, { recursive: true, force: true });
  try {
    git(tempRoot, ["init", "--bare", remotePath]);
    git(tempRoot, ["init", "--initial-branch=v3", repositoryDbRoot]);
    git(repositoryDbRoot, ["config", "user.name", "Native Writer Fixture"]);
    git(repositoryDbRoot, [
      "config",
      "user.email",
      "native-writer@example.invalid",
    ]);
    seedMissionControlDataFixture(repositoryDbRoot, { remote });
    git(repositoryDbRoot, ["add", "."]);
    git(repositoryDbRoot, ["commit", "-m", "seed Mission Control data"]);
    git(repositoryDbRoot, ["remote", "add", "origin", remote]);
    git(repositoryDbRoot, ["push", "-u", "origin", "v3"]);
    const result = action({ tempRoot, remote, remotePath, repositoryDbRoot });
    if (result && typeof result.then === "function") {
      return Promise.resolve(result).finally(cleanup);
    }
    cleanup();
    return result;
  } catch (error) {
    cleanup();
    throw error;
  }
}

function withHttpsDataRepository(action) {
  const tempRoot = join(
    tmpdir(),
    `mission-control-native-https-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  const remotePath = join(tempRoot, "mission-control-data.git");
  const remote = `https://github.com/mission-control-fixture-${process.pid}/mission-control-data.git`;
  const repositoryDbRoot = join(tempRoot, "mission-control-data");
  const capturePath = join(tempRoot, "https-git-commands.txt");
  mkdirSync(tempRoot, { recursive: true });
  let releaseCredentialHelper = null;
  let releaseGitProxy = null;
  const cleanup = () => {
    releaseGitProxy?.();
    releaseCredentialHelper?.();
    rmSync(tempRoot, { recursive: true, force: true });
  };
  try {
    git(tempRoot, ["init", "--bare", remotePath]);
    git(tempRoot, ["init", "--initial-branch=v3", repositoryDbRoot]);
    git(repositoryDbRoot, ["config", "user.name", "HTTPS Writer Fixture"]);
    git(repositoryDbRoot, [
      "config",
      "user.email",
      "https-writer@example.invalid",
    ]);
    seedMissionControlDataFixture(repositoryDbRoot, { remote });
    git(repositoryDbRoot, ["add", "."]);
    git(repositoryDbRoot, ["commit", "-m", "seed HTTPS Mission Control data"]);
    git(repositoryDbRoot, ["remote", "add", "origin", remotePath]);
    git(repositoryDbRoot, ["push", "-u", "origin", "v3"]);
    git(repositoryDbRoot, ["remote", "set-url", "origin", remote]);
    const helper = installLocalCredentialHelperFixture();
    releaseCredentialHelper = helper.release;
    releaseGitProxy = installTestGitProxy({
      mode: "https",
      capturePath,
      fileRemoteUrl: `file://${remotePath}`,
      httpsRemoteUrl: remote,
    });
    const result = action({
      capturePath,
      remote,
      remotePath,
      repositoryDbRoot,
      tempRoot,
    });
    if (result && typeof result.then === "function") {
      return Promise.resolve(result).finally(cleanup);
    }
    cleanup();
    return result;
  } catch (error) {
    cleanup();
    throw error;
  }
}

test("local-principal-v1 is the ready writer for a reviewed native Git checkout", () => {
  withDataRepository(({ repositoryDbRoot }) => {
    assert.deepEqual(getMissionControlWriterStatus({ repositoryDbRoot }), {
      mode: "local-principal-v1",
      writer_ready: true,
      local_principal_ready: true,
      reason: null,
    });
    const status = getMissionControlRepositoryStatus({
      repositoryDbRoot,
      fetch: false,
    });
    assert.equal(status.remoteMatches, true);
    assert.equal(status.commitIdentityConfigured, true);
    assert.equal(status.clean, true);
    assert.equal(
      assertRepositoryReadyForPublish({
        repositoryDbRoot,
        fetch: true,
      }).head,
      status.head,
    );
  });
});

test("native draft publication creates one validated fast-forward commit", () => {
  withDataRepository(({ remotePath, repositoryDbRoot }) => {
    const before = git(repositoryDbRoot, ["rev-parse", "HEAD"]);
    const created = createMissionControlLocalDraft({
      repositoryDbRoot,
      draft: {
        id: "native-publish",
        summary: "Publish through the Principal Git identity",
        operations: [
          {
            action: "write_file",
            path: "data/mission-control/reports/native-publish.txt",
            content: "native Git publication\n",
          },
        ],
      },
    });
    assert.equal(git(repositoryDbRoot, ["rev-parse", "HEAD"]), before);
    assert.equal(git(repositoryDbRoot, ["status", "--porcelain"]), "");

    const published = publishMissionControlLocalDraft({
      repositoryDbRoot,
      draftId: created.id,
      draftRevision: created.draft.draft_revision,
    });
    assert.equal(published.commit.committed, true);
    assert.equal(published.commit.pushed, true);
    assert.equal(
      git(remotePath, ["rev-parse", "refs/heads/v3"]),
      published.commit.head,
    );
    assert.equal(
      git(repositoryDbRoot, ["rev-list", "--parents", "-n", "1", "HEAD"]),
      `${published.commit.head} ${before}`,
    );
    assert.equal(
      readFileSync(
        join(
          repositoryDbRoot,
          "data/mission-control/reports/native-publish.txt",
        ),
        "utf8",
      ),
      "native Git publication\n",
    );
    assert.equal(
      existsSync(
        join(
          repositoryDbRoot,
          "data/mission-control/changesets/published/native-publish.json",
        ),
      ),
      false,
    );
    assert.deepEqual(listMissionControlChangesets({ repositoryDbRoot }), {
      pending: [],
      published: [],
      superseded: [],
    });
  });
});

test("HTTPS publish, freshness fetch and pull use the Principal credential helper", () => {
  withHttpsDataRepository(
    ({ capturePath, remotePath, repositoryDbRoot, tempRoot }) => {
      const before = git(repositoryDbRoot, ["rev-parse", "HEAD"]);
      const created = createReportDraft(repositoryDbRoot, "https-publish");
      const published = publishMissionControlLocalDraft({
        repositoryDbRoot,
        draftId: created.id,
        draftRevision: created.draft.draft_revision,
      });
      assert.equal(
        git(remotePath, ["rev-parse", "refs/heads/v3"]),
        published.commit.head,
      );
      assert.notEqual(published.commit.head, before);

      const peer = join(tempRoot, "peer");
      git(tempRoot, ["clone", "--branch", "v3", remotePath, peer]);
      git(peer, ["config", "user.name", "HTTPS Peer"]);
      git(peer, ["config", "user.email", "https-peer@example.invalid"]);
      writeFileSync(
        join(peer, "data/mission-control/reports/https-peer.txt"),
        "peer update\n",
      );
      git(peer, ["add", "data/mission-control/reports/https-peer.txt"]);
      git(peer, ["commit", "-m", "mission-control: HTTPS peer update"]);
      git(peer, ["push", "origin", "v3"]);

      const freshness = getMissionControlFreshness({
        repositoryDbRoot,
        fetch: true,
      });
      assert.equal(
        freshness.fetch.ok,
        true,
        JSON.stringify(freshness, null, 2),
      );
      assert.equal(freshness.newerAvailable, true);
      assert.equal(freshness.pullSafe, true);
      const pulled = pullMissionControlRepository({ repositoryDbRoot });
      assert.equal(pulled.pulled, true);
      assert.equal(
        readFileSync(
          join(repositoryDbRoot, "data/mission-control/reports/https-peer.txt"),
          "utf8",
        ).replaceAll("\r\n", "\n"),
        "peer update\n",
      );
      const capture = readFileSync(capturePath, "utf8");
      assert.match(capture, /^fetch$/m);
      assert.match(capture, /^push$/m);
      assert.match(capture, /^ls-remote$/m);
      assert.ok(
        capture.split("\n").filter((line) => line === "credential-ok").length >=
          3,
      );
    },
  );
});

test("github-app-workspace-v1 uses the same native draft and publish engine through an external credential helper", () => {
  withHttpsDataRepository(
    ({ capturePath, remotePath, repositoryDbRoot }) => {
      configureGitHubAppWorkspaceWriter({ repositoryDbRoot, remotePath });
      assert.deepEqual(getMissionControlWriterStatus({ repositoryDbRoot }), {
        mode: "github-app-workspace-v1",
        writer_ready: true,
        local_principal_ready: false,
        reason: null,
      });

      const created = createReportDraft(
        repositoryDbRoot,
        "github-app-workspace-publish",
      );
      const published = publishMissionControlLocalDraft({
        repositoryDbRoot,
        draftId: created.id,
        draftRevision: created.draft.draft_revision,
      });
      assert.equal(
        git(remotePath, ["rev-parse", "refs/heads/v3"]),
        published.commit.head,
      );
      assert.equal(
        git(remotePath, [
          "show",
          "v3:data/mission-control/reports/github-app-workspace-publish.txt",
        ]),
        "github-app-workspace-publish",
      );
      const capture = readFileSync(capturePath, "utf8");
      assert.match(capture, /^push$/m);
      assert.match(capture, /^credential-ok$/m);
    },
  );
});

test("github-app-workspace-v1 rejects SSH and embedded authority configuration without a fallback", () => {
  withDataRepository(({ repositoryDbRoot }) => {
    configureGitHubAppWorkspaceWriter({ repositoryDbRoot });
    assert.deepEqual(getMissionControlWriterStatus({ repositoryDbRoot }), {
      mode: "github-app-workspace-v1",
      writer_ready: false,
      local_principal_ready: false,
      reason: "github_app_https_remote_required",
    });
    assert.throws(
      () => createReportDraft(repositoryDbRoot, "github-app-ssh-blocked"),
      (error) => error?.code === "github_app_https_remote_required",
    );
  });

  withHttpsDataRepository(({ repositoryDbRoot }) => {
    configureGitHubAppWorkspaceWriter({
      repositoryDbRoot,
      extraPolicy: { approval_roles: ["admin"] },
    });
    assert.deepEqual(getMissionControlWriterStatus({ repositoryDbRoot }), {
      mode: "github-app-workspace-v1",
      writer_ready: false,
      local_principal_ready: false,
      reason: "github_app_writer_config_invalid",
    });
    assert.throws(
      () => createReportDraft(repositoryDbRoot, "github-app-roster-blocked"),
      (error) => error?.code === "github_app_writer_config_invalid",
    );
  });
});

test("protected paths block a draft before repository mutation", () => {
  withDataRepository(({ repositoryDbRoot }) => {
    const configPath = join(
      repositoryDbRoot,
      "data/mission-control/mission-control.config.json",
    );
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.publish_policy.protected_paths = ["data/mission-control/reports/**"];
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    git(repositoryDbRoot, ["add", configPath]);
    git(repositoryDbRoot, ["commit", "-m", "test: narrow protected paths"]);
    git(repositoryDbRoot, ["push", "origin", "v3"]);
    const before = git(repositoryDbRoot, ["rev-parse", "HEAD"]);
    assert.throws(
      () =>
        createMissionControlLocalDraft({
          repositoryDbRoot,
          draft: {
            id: "protected-path-block",
            operations: [
              {
                action: "write_file",
                path: "data/mission-control/plans/blocked.yaml",
                content:
                  "schema_version: companiesascode.mission_control.plan.v1\n",
              },
            ],
          },
        }),
      /protected_paths.*does not allow/i,
    );
    assert.equal(git(repositoryDbRoot, ["rev-parse", "HEAD"]), before);
    assert.equal(git(repositoryDbRoot, ["status", "--porcelain"]), "");
    assert.equal(listMissionControlLocalDrafts({ repositoryDbRoot }).length, 0);
  });
});

test("dirty checkout blocks publish without changing the confirmed draft", () => {
  withDataRepository(({ repositoryDbRoot }) => {
    const created = createReportDraft(repositoryDbRoot, "dirty-block");
    const before = git(repositoryDbRoot, ["rev-parse", "HEAD"]);
    const unrelatedPath = join(
      repositoryDbRoot,
      "data/mission-control/reports/unrelated-local.txt",
    );
    writeFileSync(unrelatedPath, "local work\n");
    assert.throws(
      () =>
        publishMissionControlLocalDraft({
          repositoryDbRoot,
          draftId: created.id,
          draftRevision: created.draft.draft_revision,
        }),
      /uncommitted changes/i,
    );
    assert.equal(git(repositoryDbRoot, ["rev-parse", "HEAD"]), before);
    assert.equal(readFileSync(unrelatedPath, "utf8"), "local work\n");
    assert.equal(listMissionControlLocalDrafts({ repositoryDbRoot }).length, 1);
    assert.equal(
      existsSync(
        join(repositoryDbRoot, "data/mission-control/reports/dirty-block.txt"),
      ),
      false,
    );
  });
});

test("a remote advance blocks stale-draft publish before local mutation", () => {
  withDataRepository(({ remote, remotePath, repositoryDbRoot, tempRoot }) => {
    const created = createReportDraft(repositoryDbRoot, "remote-moved");
    const before = git(repositoryDbRoot, ["rev-parse", "HEAD"]);
    const peer = join(tempRoot, "peer");
    git(tempRoot, ["clone", "--branch", "v3", remote, peer]);
    git(peer, ["config", "user.name", "Remote Peer"]);
    git(peer, ["config", "user.email", "remote-peer@example.invalid"]);
    writeFileSync(
      join(peer, "data/mission-control/reports/remote-peer.txt"),
      "remote update\n",
    );
    git(peer, ["add", "data/mission-control/reports/remote-peer.txt"]);
    git(peer, ["commit", "-m", "mission-control: remote peer update"]);
    git(peer, ["push", "origin", "v3"]);
    assert.throws(
      () =>
        publishMissionControlLocalDraft({
          repositoryDbRoot,
          draftId: created.id,
          draftRevision: created.draft.draft_revision,
        }),
      /divergence|draft.*no longer matches/i,
    );
    assert.equal(git(repositoryDbRoot, ["rev-parse", "HEAD"]), before);
    assert.notEqual(git(remotePath, ["rev-parse", "refs/heads/v3"]), before);
    assert.equal(git(repositoryDbRoot, ["status", "--porcelain"]), "");
    assert.equal(listMissionControlLocalDrafts({ repositoryDbRoot }).length, 1);
  });
});

test("rejected push rolls back the writer commit and retains the draft", () => {
  withDataRepository(({ remotePath, repositoryDbRoot }) => {
    const created = createReportDraft(repositoryDbRoot, "push-rejected");
    const before = git(repositoryDbRoot, ["rev-parse", "HEAD"]);
    const hook = join(remotePath, "hooks", "pre-receive");
    writeFileSync(hook, "#!/bin/sh\necho fixture rejection >&2\nexit 1\n", {
      mode: 0o700,
    });
    chmodSync(hook, 0o700);
    assert.throws(
      () =>
        publishMissionControlLocalDraft({
          repositoryDbRoot,
          draftId: created.id,
          draftRevision: created.draft.draft_revision,
        }),
      (error) => error?.code === "publish_failed_rolled_back",
    );
    assert.equal(git(repositoryDbRoot, ["rev-parse", "HEAD"]), before);
    assert.equal(git(remotePath, ["rev-parse", "refs/heads/v3"]), before);
    assert.equal(git(repositoryDbRoot, ["status", "--porcelain"]), "");
    assert.equal(listMissionControlLocalDrafts({ repositoryDbRoot }).length, 1);
    assert.equal(
      existsSync(
        join(
          repositoryDbRoot,
          "data/mission-control/reports/push-rejected.txt",
        ),
      ),
      false,
    );
  });
});

test("ambiguous failed push preserves the local commit for reconciliation", () => {
  withDataRepository(({ remotePath, repositoryDbRoot, tempRoot }) => {
    const created = createReportDraft(repositoryDbRoot, "unknown-after-error");
    const before = git(repositoryDbRoot, ["rev-parse", "HEAD"]);
    const releaseProxy = installTestGitProxy({
      mode: "push-error-verify-fail",
      capturePath: join(tempRoot, "unknown-after-error.commands"),
    });
    try {
      assert.throws(
        () =>
          publishMissionControlLocalDraft({
            repositoryDbRoot,
            draftId: created.id,
            draftRevision: created.draft.draft_revision,
          }),
        (error) => error?.code === "publish_outcome_unknown",
      );
    } finally {
      releaseProxy();
    }
    assert.notEqual(git(repositoryDbRoot, ["rev-parse", "HEAD"]), before);
    assert.equal(git(remotePath, ["rev-parse", "refs/heads/v3"]), before);
    assert.equal(
      readFileSync(
        join(
          repositoryDbRoot,
          "data/mission-control/reports/unknown-after-error.txt",
        ),
        "utf8",
      ),
      "unknown-after-error\n",
    );
    assert.equal(listMissionControlLocalDrafts({ repositoryDbRoot }).length, 1);
  });
});

test("failed post-push verification preserves known local and remote state", () => {
  withDataRepository(({ remotePath, repositoryDbRoot, tempRoot }) => {
    const created = createReportDraft(repositoryDbRoot, "unknown-after-push");
    const before = git(repositoryDbRoot, ["rev-parse", "HEAD"]);
    const releaseProxy = installTestGitProxy({
      mode: "post-push-verify-fail",
      capturePath: join(tempRoot, "unknown-after-push.commands"),
    });
    try {
      assert.throws(
        () =>
          publishMissionControlLocalDraft({
            repositoryDbRoot,
            draftId: created.id,
            draftRevision: created.draft.draft_revision,
          }),
        (error) => error?.code === "publish_outcome_unknown",
      );
    } finally {
      releaseProxy();
    }
    const localHead = git(repositoryDbRoot, ["rev-parse", "HEAD"]);
    assert.notEqual(localHead, before);
    assert.equal(git(remotePath, ["rev-parse", "refs/heads/v3"]), localHead);
    assert.equal(listMissionControlLocalDrafts({ repositoryDbRoot }).length, 1);
  });
});

for (const [mode, id, message] of [
  ["commit-extra-path", "unexpected-commit-path", /commit paths differ/i],
  ["commit-extra-parent", "unexpected-commit-parent", /exactly one parent/i],
]) {
  test(`${mode} is rolled back before push`, () => {
    withDataRepository(({ remotePath, repositoryDbRoot, tempRoot }) => {
      const created = createReportDraft(repositoryDbRoot, id);
      const before = git(repositoryDbRoot, ["rev-parse", "HEAD"]);
      const releaseProxy = installTestGitProxy({
        mode,
        capturePath: join(tempRoot, `${mode}.commands`),
      });
      try {
        assert.throws(
          () =>
            publishMissionControlLocalDraft({
              repositoryDbRoot,
              draftId: created.id,
              draftRevision: created.draft.draft_revision,
            }),
          message,
        );
      } finally {
        releaseProxy();
      }
      assert.equal(git(repositoryDbRoot, ["rev-parse", "HEAD"]), before);
      assert.equal(git(remotePath, ["rev-parse", "refs/heads/v3"]), before);
      assert.equal(git(repositoryDbRoot, ["status", "--porcelain"]), "");
      assert.equal(
        listMissionControlLocalDrafts({ repositoryDbRoot }).length,
        1,
      );
    });
  });
}

test("repository diagnostics redact credentials embedded in remote URLs", () => {
  withDataRepository(({ repositoryDbRoot }) => {
    const repositoryDbPath = join(repositoryDbRoot, "repository-db.yaml");
    const credentialRemote =
      "https://fixture-user:fixture-password@github.com/example/mission-control-data.git";
    const current = readFileSync(repositoryDbPath, "utf8");
    writeFileSync(
      repositoryDbPath,
      current.replace(/ssh:\/\/fixture@localhost[^\n]+/, credentialRemote),
    );
    git(repositoryDbRoot, ["remote", "set-url", "origin", credentialRemote]);
    git(repositoryDbRoot, ["add", "repository-db.yaml"]);
    git(repositoryDbRoot, [
      "commit",
      "-m",
      "test: credential redaction fixture",
    ]);
    const serialized = JSON.stringify(
      getMissionControlRepositoryStatus({
        repositoryDbRoot,
        fetch: false,
      }),
    );
    assert.equal(serialized.includes("fixture-password"), false);
    assert.equal(serialized.includes("fixture-user:"), false);
    assert.match(
      serialized,
      /https:\/\/github\.com\/example\/mission-control-data\.git/,
    );
  });
});

test("a foreign writer mode has no fallback mutation path", () => {
  withDataRepository(({ repositoryDbRoot }) => {
    const before = git(repositoryDbRoot, ["rev-parse", "HEAD"]);
    const configPath = join(
      repositoryDbRoot,
      "data/mission-control/mission-control.config.json",
    );
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.publish_policy.writer_mode = "retired-writer-mode";
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    assert.deepEqual(getMissionControlWriterStatus({ repositoryDbRoot }), {
      mode: "retired-writer-mode",
      writer_ready: false,
      local_principal_ready: false,
      reason: "writer_mode_unsupported",
    });
    assert.throws(
      () =>
        createMissionControlLocalDraft({
          repositoryDbRoot,
          draft: {
            id: "no-fallback",
            operations: [
              {
                action: "write_file",
                path: "data/mission-control/reports/no-fallback.txt",
                content: "blocked\n",
              },
            ],
          },
        }),
      (error) => error?.code === "writer_mode_unsupported",
    );
    assert.equal(git(repositoryDbRoot, ["rev-parse", "HEAD"]), before);
    assert.equal(listMissionControlLocalDrafts({ repositoryDbRoot }).length, 0);
    assert.equal(
      existsSync(
        join(repositoryDbRoot, "data/mission-control/reports/no-fallback.txt"),
      ),
      false,
    );
  });
});

test("native publication requires an explicitly configured Git identity", () => {
  withDataRepository(({ tempRoot, repositoryDbRoot }) => {
    const globalConfig = join(tempRoot, "empty-global.gitconfig");
    const systemConfig = join(tempRoot, "empty-system.gitconfig");
    writeFileSync(globalConfig, "");
    writeFileSync(systemConfig, "");
    git(repositoryDbRoot, ["config", "--unset", "user.name"]);
    git(repositoryDbRoot, ["config", "--unset", "user.email"]);
    const previousGlobal = process.env.GIT_CONFIG_GLOBAL;
    const previousSystem = process.env.GIT_CONFIG_SYSTEM;
    try {
      process.env.GIT_CONFIG_GLOBAL = globalConfig;
      process.env.GIT_CONFIG_SYSTEM = systemConfig;
      assert.deepEqual(getMissionControlWriterStatus({ repositoryDbRoot }), {
        mode: "local-principal-v1",
        writer_ready: false,
        local_principal_ready: false,
        reason: "commit_identity_required",
      });
      assert.throws(
        () =>
          createMissionControlLocalDraft({
            repositoryDbRoot,
            draft: {
              id: "missing-identity",
              operations: [
                {
                  action: "write_file",
                  path: "data/mission-control/reports/missing-identity.txt",
                  content: "blocked\n",
                },
              ],
            },
          }),
        /Git commit identity|user\.name|user\.email/i,
      );
    } finally {
      if (previousGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
      else process.env.GIT_CONFIG_GLOBAL = previousGlobal;
      if (previousSystem === undefined) delete process.env.GIT_CONFIG_SYSTEM;
      else process.env.GIT_CONFIG_SYSTEM = previousSystem;
    }
  });
});

test("global pushInsteadOf rewrites fail the exact remote gate", () => {
  withDataRepository(({ tempRoot, remote, repositoryDbRoot }) => {
    const redirectedRemote = join(tempRoot, "redirected.git");
    const globalConfig = join(tempRoot, "principal.gitconfig");
    const systemConfig = join(tempRoot, "system.gitconfig");
    git(tempRoot, ["init", "--bare", redirectedRemote]);
    git(tempRoot, [
      "config",
      "--file",
      globalConfig,
      `url.${redirectedRemote}.pushInsteadOf`,
      remote,
    ]);
    writeFileSync(systemConfig, "");
    const previousGlobal = process.env.GIT_CONFIG_GLOBAL;
    const previousSystem = process.env.GIT_CONFIG_SYSTEM;
    try {
      process.env.GIT_CONFIG_GLOBAL = globalConfig;
      process.env.GIT_CONFIG_SYSTEM = systemConfig;
      assert.equal(
        getMissionControlRepositoryStatus({
          repositoryDbRoot,
          fetch: false,
        }).remoteMatches,
        false,
      );
      assert.throws(
        () => assertRepositoryReadyForLocalMutation({ repositoryDbRoot }),
        /remote|push URL/i,
      );
      assert.equal(
        git(redirectedRemote, ["for-each-ref", "--format=%(refname)"]),
        "",
      );
    } finally {
      if (previousGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
      else process.env.GIT_CONFIG_GLOBAL = previousGlobal;
      if (previousSystem === undefined) delete process.env.GIT_CONFIG_SYSTEM;
      else process.env.GIT_CONFIG_SYSTEM = previousSystem;
    }
  });
});

test("repository write lock remains held until an async transaction settles", async () => {
  await withDataRepository(async ({ repositoryDbRoot }) => {
    let release;
    const pending = withMissionControlRepositoryWriteLock(
      repositoryDbRoot,
      () => {
        assert.equal(
          withMissionControlRepositoryWriteLock(
            repositoryDbRoot,
            () => "nested",
          ),
          "nested",
        );
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    );
    assert.throws(
      () =>
        withMissionControlRepositoryWriteLock(
          repositoryDbRoot,
          () => "outside",
        ),
      /write transaction is active/i,
    );
    release("done");
    assert.equal(await pending, "done");
  });
});

for (const name of ["ISSUES.open.json", "ISSUES.resolved.json"]) {
  test(`legacy ${name} cannot be edited through a canonical data draft`, () => {
    withDataRepository(({ repositoryDbRoot }) => {
      const before = git(repositoryDbRoot, ["rev-parse", "HEAD"]);
      assert.throws(() => createMissionControlLocalDraft({
        repositoryDbRoot,
        draft: { id: "legacy-issue-write", operations: [{
          action: "write_file", path: `data/mission-control/${name}`,
          content: JSON.stringify({ issues: [{ id: "new-issue" }] }),
        }] },
      }), /legacy.*read.only/i);
      assert.equal(git(repositoryDbRoot, ["rev-parse", "HEAD"]), before);
      assert.equal(git(repositoryDbRoot, ["status", "--porcelain"]), "");
      assert.equal(listMissionControlLocalDrafts({ repositoryDbRoot }).length, 0);
    });
  });
}
