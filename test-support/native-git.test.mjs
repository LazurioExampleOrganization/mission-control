import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  nativeGitExecutableCandidates,
  resolveNativeGitExecutable,
} from "./native-git.mjs";

test("builds native absolute Git candidates without a shell", () => {
  assert.deepEqual(
    nativeGitExecutableCandidates({
      env: { Path: '"C:\\Program Files\\Git\\cmd";relative' },
      platform: "win32",
      pathImplementation: path.win32,
    }),
    ["C:\\Program Files\\Git\\cmd\\git.exe"],
  );
  assert.deepEqual(
    nativeGitExecutableCandidates({
      env: { PATH: "/usr/local/bin:relative:/usr/bin" },
      platform: "linux",
      pathImplementation: path.posix,
    }),
    ["/usr/local/bin/git", "/usr/bin/git"],
  );
});

test("pins and probes the exact canonical Git executable", () => {
  const probes = [];
  const result = resolveNativeGitExecutable({
    env: { PATH: "/first:/second" },
    platform: "linux",
    pathImplementation: path.posix,
    assertAccessible(candidate) {
      if (candidate.includes("first")) throw new Error("missing");
    },
    canonicalize: (candidate) => `/canonical${candidate}`,
    assertRegularFile() {},
    probe(candidate) {
      probes.push(candidate);
      return "git version 2.55.0";
    },
  });
  assert.equal(result, "/canonical/second/git");
  assert.deepEqual(probes, ["/canonical/second/git"]);
});

test("reports one clear prerequisite failure when Git is unavailable", () => {
  assert.throws(
    () =>
      resolveNativeGitExecutable({
        candidates: ["/missing/git"],
        assertAccessible() {
          throw new Error("missing");
        },
      }),
    /Git prerequisite failed/,
  );
});
