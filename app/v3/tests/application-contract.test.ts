import { describe, expect, test } from "bun:test";
import { withHealth } from "@lazurio/module-kit";
import {
  type GatewayCaller,
  gatewayRequest,
  hostedEnvironment,
  localEnvironment,
  TEST_ORIGIN,
} from "@lazurio/module-kit/tools/testing";
import { createMemoryStore } from "../src/data/memory-store.ts";
import { accessOf, type Env } from "../src/server/access.ts";
import { createApi } from "../src/server/api.ts";
import { sampleData } from "./support/seed.ts";

/**
 * The contract of a ready Application (Module Standard, Applications of an
 * Organization; docs/module-readiness.md of LazurioPlatform): who came only
 * through `appAccess`, no role grants nothing, one writer rule (`dataWriter`
 * of the module kit) and a deep health. The requests are the Application
 * host's gateway's, built by `@lazurio/module-kit/tools/testing`.
 */

function api(env: Env) {
  const store = createMemoryStore(sampleData());
  return createApi(store, {
    allowedOrigins: new Set([TEST_ORIGIN]),
    access: (request) => accessOf(request, env),
    today: () => "2026-11-03",
  });
}

const hosted = (writer?: boolean) =>
  hostedEnvironment({ listener: "web", ...(writer === undefined ? {} : { writer }) });

const roadmapChange = (caller: GatewayCaller) =>
  gatewayRequest("/api/draft/pull", { caller, origin: TEST_ORIGIN, body: {} });

describe("the Application's writer rule", () => {
  test("on the application host, false refuses every change before the store", async () => {
    const response = await api(hosted(false))(roadmapChange({ role: "admin" }));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("data_read_only");
  });

  test("any value other than true refuses", async () => {
    const env = { ...hosted(), LAZURIO_RUNTIME_DATA_WRITER: "yes" };
    const response = await api(env)(roadmapChange({ role: "admin" }));
    expect(response.status).toBe(409);
  });

  test("without the variable, a person who has only the application cannot write", async () => {
    const env = { ...hosted(), LAZURIO_RUNTIME_DATA_WRITER: undefined };
    const response = await api(env)(roadmapChange({ role: "user" }));
    expect(response.status).toBe(409);
  });

  test("true lets a change reach the store", async () => {
    const response = await api(hosted(true))(roadmapChange({ role: "user" }));
    expect(response.status).not.toBe(409);
    expect(response.status).not.toBe(403);
  });

  test("without the variable, the Environment's own entry reaches the store", async () => {
    const env = { ...hosted(), LAZURIO_RUNTIME_DATA_WRITER: undefined };
    const response = await api(env)(roadmapChange({ role: "environment" }));
    expect(response.status).not.toBe(409);
    expect(response.status).not.toBe(403);
  });

  test("reading never needs the writer", async () => {
    const response = await api(hosted(false))(
      gatewayRequest("/api/plans", { caller: { role: "user" } }),
    );
    expect(response.status).toBe(200);
  });
});

describe("the page learns the writer rule from /api/status", () => {
  const mayWrite = async (env: Env, caller: GatewayCaller) => {
    const response = await api(env)(gatewayRequest("/api/status", { caller }));
    expect(response.status).toBe(200);
    return (await response.json()).mayWrite as boolean;
  };

  for (const role of ["admin", "user"] as const) {
    test(`an Application ${role} may write with the writer`, async () => {
      expect(await mayWrite(hosted(true), { role })).toBe(true);
    });
    test(`an Application ${role} may not write without it`, async () => {
      expect(await mayWrite(hosted(false), { role })).toBe(false);
    });
  }

  test("without the variable, the Environment's own entry may write and the application may not", async () => {
    const env = { ...hosted(), LAZURIO_RUNTIME_DATA_WRITER: undefined };
    expect(await mayWrite(env, { role: "environment" })).toBe(true);
    expect(await mayWrite(env, { role: "admin" })).toBe(false);
  });

  test("a request without a role learns nothing", async () => {
    const response = await api(hosted(true))(
      gatewayRequest("/api/status", { caller: { role: "none" } }),
    );
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("forbidden");
  });
});

describe("a runtime stating production never writes without the writer", () => {
  const production = {
    ...hosted(),
    LAZURIO_RUNTIME_DATA_WRITER: undefined,
    LAZURIO_RUNTIME_DEPLOYMENT: "production",
  };

  test("the Environment's own entry is refused, and the status offers no writing", async () => {
    const response = await api(production)(roadmapChange({ role: "environment" }));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("data_read_only");
    const status = await api(production)(
      gatewayRequest("/api/status", { caller: { role: "environment" } }),
    );
    expect((await status.json()).mayWrite).toBe(false);
  });

  test("a local entry is refused too", async () => {
    const env = { ...localEnvironment("web"), LAZURIO_RUNTIME_DEPLOYMENT: "production" };
    const request = new Request("http://127.0.0.1:43100/api/draft/pull", {
      method: "POST",
      headers: { "content-type": "application/json", origin: TEST_ORIGIN },
      body: "{}",
    });
    expect(accessOf(request, env)).toEqual({ admitted: true, mayWrite: false, subject: null });
    const response = await api(env)(request);
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("data_read_only");
  });
});

describe("who came", () => {
  test("a request through the gateway without a role gets nothing", async () => {
    const read = await api(hosted(true))(
      gatewayRequest("/api/plans", { caller: { role: "none" } }),
    );
    expect(read.status).toBe(403);
    const change = await api(hosted(true))(roadmapChange({ role: "none" }));
    expect(change.status).toBe(403);
  });

  test("an Application User and an Application Admin read alike", async () => {
    for (const role of ["user", "admin"] as const) {
      const response = await api(hosted(true))(gatewayRequest("/api/plans", { caller: { role } }));
      expect(response.status).toBe(200);
    }
  });

  test("a local entry in a development version is admitted and writes", () => {
    const env = localEnvironment("web");
    const access = accessOf(new Request("http://127.0.0.1:43100/api/plans"), env);
    expect(access).toEqual({ admitted: true, mayWrite: true, subject: null });
  });
});

describe("deep health", () => {
  test("health answers 503 until the data are open, then 200", async () => {
    let open = false;
    const health = withHealth(
      () => new Response("app"),
      "/healthz",
      () => open,
    );
    expect((await health(new Request(`${TEST_ORIGIN}/healthz`))).status).toBe(503);
    open = true;
    expect((await health(new Request(`${TEST_ORIGIN}/healthz`))).status).toBe(200);
  });
});
