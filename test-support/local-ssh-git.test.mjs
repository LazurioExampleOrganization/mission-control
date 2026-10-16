import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { localSshRemoteUrl } from "./local-ssh-git.mjs";

test("builds a valid local SSH fixture URL for POSIX paths", () => {
  assert.equal(
    localSshRemoteUrl(
      "/tmp/fixture/mission-control-data.git",
      path.posix,
    ),
    "ssh://fixture@localhost/tmp/fixture/mission-control-data.git",
  );
});

test("keeps a Windows drive path in the SSH URL path component", () => {
  const remote = localSshRemoteUrl(
    "C:\\Temp\\fixture\\mission-control-data.git",
    path.win32,
  );
  assert.equal(
    remote,
    "ssh://fixture@localhost/C:/Temp/fixture/mission-control-data.git",
  );
  const parsed = new URL(remote);
  assert.equal(parsed.hostname, "localhost");
  assert.equal(parsed.pathname, "/C:/Temp/fixture/mission-control-data.git");
});
