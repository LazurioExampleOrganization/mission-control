import { resolve, sep } from "node:path";

/**
 * Serves the client build: a start from `main` gets it as
 * `LAZURIO_RUNTIME_BUILD_OUTPUT` (outside the checkout), a local production
 * run uses the package's own `dist/`. Unknown paths without an extension get
 * `index.html`, so the App's own routes work after a reload.
 */
export function clientDirectory(env: Record<string, string | undefined> = process.env): string {
  const output = env.LAZURIO_RUNTIME_BUILD_OUTPUT;
  return output ? resolve(output) : resolve(import.meta.dir, "..", "..", "dist");
}

export function createStaticHandler(root: string) {
  const base = resolve(root);
  return async function serve(pathname: string): Promise<Response> {
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    const target = resolve(base, `.${decoded === "/" ? "/index.html" : decoded}`);
    if (target !== base && !target.startsWith(`${base}${sep}`)) {
      return new Response("Not found", { status: 404 });
    }
    const file = Bun.file(target);
    if (await file.exists()) {
      const immutable = decoded.startsWith("/assets/");
      return new Response(file, {
        headers: {
          "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
        },
      });
    }
    if (/\.[a-z0-9]+$/i.test(decoded)) return new Response("Not found", { status: 404 });
    return new Response(Bun.file(resolve(base, "index.html")), {
      headers: { "cache-control": "no-cache", "content-type": "text/html; charset=utf-8" },
    });
  };
}
