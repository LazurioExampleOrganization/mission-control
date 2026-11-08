import {
  allowedHosts,
  type Listener,
  listener,
  ModuleKitError,
  onShutdown,
  withHealth,
} from "@lazurio/module-kit";
import type { MissionControlStore } from "../data/store.ts";
import type { Locale } from "../i18n/locale.ts";
import { createApi } from "./api.ts";
import { clientDirectory, createStaticHandler } from "./static.ts";

const LISTENER = "web";
export const HEALTH_PATH = "/healthz";
/**
 * Lazurio's own paths (`/.lazurio/shell.json` with the person's language).
 * Where Lazurio serves them on the App's origin, a request never reaches the
 * App; where it does not, the App answers 404 rather than its page, so the
 * client knows at once that Lazurio said nothing.
 */
const LAZURIO_PATHS = "/.lazurio/";
const notLazurio = () => new Response("Not found", { status: 404 });

/**
 * Starts the one server process of the App over a store: the API, the health
 * path and the client. Host and port come only from the Lazurio listener
 * (Module Standard); without them the process exits 2.
 */
export async function serve(
  createStore: () => MissionControlStore,
  label: string,
  options: { locale?: Locale } = {},
) {
  let app: Listener;
  try {
    app = listener(LISTENER);
  } catch (error) {
    if (!(error instanceof ModuleKitError)) throw error;
    console.error(`Start through Lazurio lifecycle: ${error.message}`);
    process.exit(2);
  }

  const store = createStore();
  const hosts = new Set(allowedHosts(LISTENER));
  const origins = new Set<string>();
  for (const host of hosts) {
    origins.add(`http://${host.includes(":") ? `[${host}]` : host}:${app.port}`);
  }
  if (app.externalOrigin) origins.add(app.externalOrigin);
  const api = createApi(store, {
    allowedOrigins: origins,
    ...(options.locale ? { locale: options.locale } : {}),
  });

  const hostAllowed = (req: Request) => {
    const header = req.headers.get("host") ?? "";
    const hostname = header.startsWith("[")
      ? header.slice(1, header.indexOf("]"))
      : header.split(":")[0];
    return hostname !== undefined && hosts.has(hostname);
  };

  const production = process.env.NODE_ENV === "production";
  const serveClient = production ? createStaticHandler(clientDirectory()) : null;
  const handle = withHealth(async (req: Request) => {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) return api(req);
    if (url.pathname.startsWith(LAZURIO_PATHS)) return notLazurio();
    if (serveClient && (req.method === "GET" || req.method === "HEAD")) {
      return serveClient(url.pathname);
    }
    return new Response("Not found", { status: 404 });
  }, HEALTH_PATH);
  const guarded = (req: Request) =>
    hostAllowed(req) ? handle(req) : new Response("Forbidden host", { status: 403 });

  // A development run bundles the client itself (Bun's HTML import with hot
  // reload), a production run serves the client build: one process either way.
  const server = production
    ? Bun.serve({ hostname: app.host, port: app.port, idleTimeout: 0, fetch: guarded })
    : Bun.serve({
        hostname: app.host,
        port: app.port,
        idleTimeout: 0,
        development: { hmr: true, console: false },
        routes: {
          "/api/*": guarded,
          "/.lazurio/*": guarded,
          [HEALTH_PATH]: guarded,
          "/*": (await import("../ui/index.html")).default,
        },
        fetch: guarded,
      });

  console.log(`Mission Control ${label} serves ${server.url.href}`);

  // SIGTERM from Lazurio: stop the data sync, close every connection, exit 0.
  onShutdown(async () => {
    store.close();
    await server.stop(true);
  });
}
