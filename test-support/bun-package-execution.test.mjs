import { afterAll, expect, test } from "bun:test";
import { chmod, copyFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

// Lazurio Module Standard: the App's preparation and start path work when the
// only executable on PATH is bun (no node, npx or standalone bunx).
const sourceRoot = join(import.meta.dirname, "..");
const fixtureRoot = await mkdtemp(join(tmpdir(), "mission-control-bun-only-"));
const bunName = process.platform === "win32" ? "bun.exe" : "bun";
const isolatedBun = join(fixtureRoot, bunName);

afterAll(async () => {
  await rm(fixtureRoot, { recursive: true, force: true });
});

test("client preparation (prepare:app) runs with only bun on PATH", async () => {
  await copyFile(process.execPath, isolatedBun);
  if (process.platform !== "win32") await chmod(isolatedBun, 0o755);
  expect(await readdir(fixtureRoot)).toEqual([bunName]);

  const appRoot = join(sourceRoot, "app", "v3");
  const result = spawnSync(isolatedBun, ["run", "--cwd", appRoot, "prepare:app"], {
    cwd: sourceRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: dirname(isolatedBun),
    },
    timeout: 120_000,
  });

  if (result.status !== 0) {
    throw new Error(
      `isolated prepare:app failed (${result.status}):\n${result.stdout}\n${result.stderr}`,
    );
  }
  expect(result.status).toBe(0);
  expect(await readdir(fixtureRoot)).toEqual([bunName]);

  const readiness = spawnSync(isolatedBun, ["run", "--cwd", appRoot, "check:prepared"], {
    cwd: sourceRoot,
    encoding: "utf8",
    env: { ...process.env, PATH: dirname(isolatedBun) },
    timeout: 30_000,
  });
  expect(readiness.status).toBe(0);
}, 120_000);
