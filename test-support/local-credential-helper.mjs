import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installMissionControlTestCredentialHelperExecutable } from "../src/mission-control-publish-flow.mjs";

// Test-only Git credential helper fixture. It answers `git credential fill`
// like a real OS helper (Git Credential Manager) would, but with fixture
// data only: the username comes from MISSION_CONTROL_TEST_CREDENTIAL_USERNAME
// (default fixture-user) and the password is a constant fixture value that
// never leaves the test. While the fixture is installed, production helper
// discovery is pinned to it and never reads real local/system Git config.
function helperScript() {
  if (process.platform === "win32") {
    return [
      "#!/usr/bin/env node",
      "if (process.argv[2] !== 'get') process.exit(0);",
      "process.stdout.write(`username=${process.env.MISSION_CONTROL_TEST_CREDENTIAL_USERNAME || 'fixture-user'}\\n`);",
      "process.stdout.write('password=fixture-secret\\n');",
      "",
    ].join("\n");
  }
  return [
    "#!/bin/sh",
    '[ "$1" = "get" ] || exit 0',
    'printf \'username=%s\\n\' "${MISSION_CONTROL_TEST_CREDENTIAL_USERNAME:-fixture-user}"',
    "printf 'password=fixture-secret\\n'",
    "",
  ].join("\n");
}

export function installLocalCredentialHelperFixture() {
  const fixtureRoot = join(
    tmpdir(),
    `mission-control-test-credential-helper-${process.pid}`,
  );
  const helperPath = join(fixtureRoot, "credential-helper");
  mkdirSync(fixtureRoot, { recursive: true });
  writeFileSync(helperPath, helperScript(), { mode: 0o755 });
  chmodSync(helperPath, 0o755);
  const releaseInstalled =
    installMissionControlTestCredentialHelperExecutable(helperPath);
  let released = false;
  return {
    helperPath,
    release: () => {
      if (released) return;
      released = true;
      releaseInstalled();
      rmSync(fixtureRoot, { recursive: true, force: true });
    },
  };
}
