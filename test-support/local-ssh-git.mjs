import {
  chmodSync,
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path, { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { installMissionControlTestSshExecutable } from "../src/mission-control-publish-flow.mjs";
import { resolveNativeGitExecutable } from "./native-git.mjs";

let activeInstallations = 0;
let originalPath;
let transportRoot;
let releaseTrustedExecutable;
let originalGitSshCommand;
let originalGitSshVariant;
let originalTransportGit;
const LOCAL_SSH_TRANSPORT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "local-ssh-transport.mjs",
);
const ORGANIZATION_DATA_TEMPLATE_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../templates/organization-data",
);

function gitShellQuote(value) {
  return `'${value.replaceAll("\\", "/").replaceAll("'", "'\\''")}'`;
}

// Test-only SSH transport: accepted ssh:// fixture URLs still cross Git's
// normal SSH transport boundary, but the remote command executes locally
// against the temporary bare repository. Runtime code never imports this.
export function installLocalSshGitTransport() {
  if (activeInstallations === 0) {
    originalPath = process.env.PATH;
    originalGitSshCommand = process.env.GIT_SSH_COMMAND;
    originalGitSshVariant = process.env.GIT_SSH_VARIANT;
    originalTransportGit = process.env.MISSION_CONTROL_TEST_TRANSPORT_GIT;
    transportRoot = join(tmpdir(), `mission-control-test-ssh-${process.pid}`);
    const sshPath = join(transportRoot, "ssh");
    mkdirSync(transportRoot, { recursive: true });
    cpSync(LOCAL_SSH_TRANSPORT_PATH, sshPath);
    chmodSync(sshPath, 0o755);
    releaseTrustedExecutable =
      installMissionControlTestSshExecutable(sshPath);
    process.env.PATH = `${transportRoot}${path.delimiter}${originalPath ?? ""}`;
    process.env.GIT_SSH_COMMAND = `${gitShellQuote(process.execPath)} ${gitShellQuote(sshPath)}`;
    process.env.GIT_SSH_VARIANT = "ssh";
    process.env.MISSION_CONTROL_TEST_TRANSPORT_GIT =
      resolveNativeGitExecutable();
  }
  activeInstallations += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeInstallations -= 1;
    if (activeInstallations !== 0) return;
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    if (originalGitSshCommand === undefined) delete process.env.GIT_SSH_COMMAND;
    else process.env.GIT_SSH_COMMAND = originalGitSshCommand;
    if (originalGitSshVariant === undefined) delete process.env.GIT_SSH_VARIANT;
    else process.env.GIT_SSH_VARIANT = originalGitSshVariant;
    if (originalTransportGit === undefined) {
      delete process.env.MISSION_CONTROL_TEST_TRANSPORT_GIT;
    } else {
      process.env.MISSION_CONTROL_TEST_TRANSPORT_GIT = originalTransportGit;
    }
    releaseTrustedExecutable?.();
    rmSync(transportRoot, { recursive: true, force: true });
    originalPath = undefined;
    transportRoot = undefined;
    releaseTrustedExecutable = undefined;
    originalGitSshCommand = undefined;
    originalGitSshVariant = undefined;
    originalTransportGit = undefined;
  };
}

export function localSshRemoteUrl(repositoryPath, pathImplementation = path) {
  if (
    !pathImplementation.isAbsolute(repositoryPath) ||
    repositoryPath.split(pathImplementation.sep).at(-1) !==
      "mission-control-data.git" ||
    /[%?#\s\u0000-\u001f\u007f]/.test(repositoryPath)
  ) {
    throw new Error(
      `Local SSH fixture path must be absolute, portable and end in mission-control-data.git: ${repositoryPath}`,
    );
  }
  const portablePath = repositoryPath
    .split(pathImplementation.sep)
    .join("/");
  const urlPath = portablePath.startsWith("/")
    ? portablePath
    : `/${portablePath}`;
  return `ssh://fixture@localhost${urlPath}`;
}

export function seedMissionControlDataFixture(
  repositoryPath,
  {
    remote,
    organizationAdmin = "fixture-admin",
  } = {},
) {
  cpSync(ORGANIZATION_DATA_TEMPLATE_ROOT, repositoryPath, {
    recursive: true,
    force: true,
  });
  const repositoryConfigPath = join(repositoryPath, "repository-db.yaml");
  writeFileSync(
    repositoryConfigPath,
    readFileSync(repositoryConfigPath, "utf8").replace(
      "git@github.com:REPLACE_WITH_ORG/mission-control-data.git",
      remote,
    ),
  );
  const missionControlConfigPath = join(
    repositoryPath,
    "data/mission-control/mission-control.config.json",
  );
  const missionControlConfig = JSON.parse(
    readFileSync(missionControlConfigPath, "utf8"),
  );
  missionControlConfig.organization_admin = organizationAdmin;
  missionControlConfig.publish_policy.writer_mode = "local-principal-v1";
  delete missionControlConfig.publish_policy.credential_authority;
  delete missionControlConfig.publish_policy.approval_roles;
  delete missionControlConfig.publish_policy.local_principal;
  writeFileSync(
    missionControlConfigPath,
    `${JSON.stringify(missionControlConfig, null, 2)}\n`,
  );
}
