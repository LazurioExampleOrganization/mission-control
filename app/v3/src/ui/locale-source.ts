import { DEFAULT_LOCALE, isLocale, type Locale } from "../i18n/locale.ts";

/**
 * Which language the App speaks, decided once before the first screen:
 *
 * 1. Lazurio's: the `locale` of the shell document `/.lazurio/shell.json`
 *    (contract `lazurio.shell.v1` of LazurioPlatform, decision F36), the
 *    language of the person's Environment that Lazurio carries into its apps.
 *    Where Lazurio does not serve that path on the App's origin, the App
 *    itself answers 404 and the next source decides.
 * 2. The server's: the language `bun run dev:demo -- --locale en` was started
 *    with, from `/api/status`.
 * 3. Czech.
 */
type Fetch = (input: string, init: RequestInit) => Promise<Response>;

export const SHELL_DOCUMENT = "/.lazurio/shell.json";
const SHELL_TIMEOUT_MS = 1_500;

async function json(fetcher: Fetch, path: string, init: RequestInit): Promise<unknown> {
  const response = await fetcher(path, init);
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    return null;
  }
  return response.json();
}

function localeOf(document: unknown): Locale | null {
  const value =
    document && typeof document === "object" ? (document as { locale?: unknown }).locale : null;
  return isLocale(value) ? value : null;
}

/** The person's language as Lazurio states it, or null when it says nothing. */
export async function lazurioLocale(
  fetcher: Fetch = fetch,
  timeoutMs = SHELL_TIMEOUT_MS,
): Promise<Locale | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return localeOf(
      await json(fetcher, SHELL_DOCUMENT, {
        credentials: "same-origin",
        cache: "no-store",
        // A session Lazurio no longer admits is no answer, never a sign-in page.
        redirect: "manual",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      }),
    );
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The language the server was started with, or null. */
export async function serverLocale(fetcher: Fetch = fetch): Promise<Locale | null> {
  try {
    return localeOf(
      await json(fetcher, "/api/status", { headers: { Accept: "application/json" } }),
    );
  } catch {
    return null;
  }
}

export async function resolveLocale(fetcher: Fetch = fetch): Promise<Locale> {
  const [lazurio, server] = await Promise.all([lazurioLocale(fetcher), serverLocale(fetcher)]);
  return lazurio ?? server ?? DEFAULT_LOCALE;
}
