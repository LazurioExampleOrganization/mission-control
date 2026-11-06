import { describe, expect, test } from "bun:test";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import packageJson from "../package.json";

// The start contract of the Module Standard: Lazurio runs the `dev` script
// with only bun on PATH and the listener environment; without it the App
// refuses to start, with it the health path answers 200 directly, a foreign
// Host is refused and SIGTERM ends the App with exit 0.
const app = resolve(import.meta.dir, "..");
const runtime = packageJson.lazurio.runtime;
const [entrypoint] = runtime.listeners;
if (!entrypoint) throw new Error("lazurio.runtime declares no listener");
const variable = `LAZURIO_RUNTIME_LISTENER_${entrypoint.id.toUpperCase().replaceAll("-", "_")}`;
const baseEnv = { HOME: process.env.HOME ?? "", PATH: dirname(process.execPath) };
const startTimeoutMs = 60_000;

describe("start contract", () => {
  test("refuses to start without the listener environment", () => {
    const run = Bun.spawnSync([process.execPath, "run", runtime.dev_script], {
      cwd: app,
      env: baseEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(run.exitCode).toBe(2);
    expect(run.stderr.toString()).toContain(`${variable}_HOST`);
  });

  test(
    "answers health with 200, refuses a foreign Host and exits 0 on SIGTERM",
    async () => {
      const port = await freePort();
      const server = Bun.spawn([process.execPath, "run", runtime.dev_script], {
        cwd: app,
        env: { ...baseEnv, [`${variable}_HOST`]: "127.0.0.1", [`${variable}_PORT`]: `${port}` },
        stdout: "ignore",
        stderr: "inherit",
      });
      try {
        const url = `http://127.0.0.1:${port}${entrypoint.health.path}`;
        const health = await firstResponse(url, startTimeoutMs);
        expect(health.status).toBe(200);
        const foreign = await fetch(url, {
          headers: { host: "foreign.invalid" },
          redirect: "manual",
        });
        expect(foreign.status).toBe(403);
        // Without a data checkout the App runs and says so, quietly.
        const status = await fetch(`http://127.0.0.1:${port}/api/status`);
        expect((await status.json()).ok).toBe(false);
      } finally {
        server.kill("SIGTERM");
      }
      const exitCode = await server.exited;
      // Windows has no SIGTERM; the platform terminates the process instead.
      if (process.platform !== "win32") expect(exitCode).toBe(0);
    },
    startTimeoutMs + 30_000,
  );
});

async function firstResponse(url: string, timeoutMs: number): Promise<Response> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(url, { redirect: "manual" }).catch(() => null);
    if (response) return response;
    await Bun.sleep(200);
  }
  throw new Error(`${url} did not answer within ${timeoutMs} ms`);
}

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() =>
        address && typeof address === "object"
          ? resolvePort(address.port)
          : reject(new Error("no free port")),
      );
    });
  });
}
