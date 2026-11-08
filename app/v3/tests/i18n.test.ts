import { describe, expect, test } from "bun:test";
import { formatDate, formatPeriod, plural } from "../src/i18n/format.ts";
import { MESSAGES } from "../src/i18n/messages.ts";
import { lazurioLocale, resolveLocale } from "../src/ui/locale-source.ts";

const CZECH = /[ěščřžýáíéůúňťďĚŠČŘŽÝÁÍÉŮÚŇŤĎ]/;

/** Every text of a catalog, its functions called with one value that serves as any argument. */
function texts(value: unknown, path = ""): [string, string][] {
  if (typeof value === "string") return [[path, value]];
  if (typeof value === "function") {
    const any = {
      path: "x",
      kind: "too_small",
      step: "step-001",
      ref: "x",
      expected: "x",
      prefix: "EX",
      plan: "EX-0001",
      code: "x",
      valueOf: () => 2,
      toString: () => "x",
    };
    return texts((value as (...args: unknown[]) => unknown)(any, any, any), path);
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => texts(item, `${path}.${key}`));
  }
  return [];
}

describe("catalogs", () => {
  test("Czech and English have the same texts", () => {
    const keys = (catalog: unknown) => texts(catalog).map(([path]) => path);
    expect(keys(MESSAGES.en)).toEqual(keys(MESSAGES.cs));
  });

  test("the English catalog holds no Czech", () => {
    expect(texts(MESSAGES.en).filter(([, text]) => CZECH.test(text))).toEqual([]);
  });
});

describe("formats", () => {
  test("counted words take the form of their number", () => {
    const forms = { one: "plán", few: "plány", other: "plánů" };
    expect([1, 2, 4, 5, 0].map((count) => plural("cs", count, forms))).toEqual([
      "1 plán",
      "2 plány",
      "4 plány",
      "5 plánů",
      "0 plánů",
    ]);
    expect(plural("en", 1, { one: "plan", other: "plans" })).toBe("1 plan");
    expect(plural("en", 3, { one: "plan", other: "plans" })).toBe("3 plans");
  });

  test("dates and periods read as people write them", () => {
    expect(formatDate("cs", "2026-11-06")).toBe("6. 11. 2026");
    expect(formatDate("en", "2026-11-06")).toBe("6 Nov 2026");
    expect(formatPeriod("cs", "2026-03")).toBe("3/2026");
    expect(formatPeriod("en", "2026-03")).toBe("Mar 2026");
    expect(formatPeriod("en", "2026-Q2")).toBe("Q2 2026");
  });
});

describe("the language of the App", () => {
  type Answer = { status: number; body?: unknown; text?: string };
  const fetcher = (answers: Record<string, Answer>) => async (path: string) => {
    const answer = answers[path] ?? { status: 404 };
    return new Response(
      answer.text ?? (answer.body === undefined ? "" : JSON.stringify(answer.body)),
      {
        status: answer.status,
      },
    );
  };

  test("Lazurio's language comes first", async () => {
    const fetch = fetcher({
      "/.lazurio/shell.json": { status: 200, body: { locale: "en" } },
      "/api/status": { status: 200, body: { ok: true, locale: "cs" } },
    });
    expect(await resolveLocale(fetch)).toBe("en");
  });

  test("without Lazurio's, the server's", async () => {
    const fetch = fetcher({ "/api/status": { status: 200, body: { ok: true, locale: "en" } } });
    expect(await resolveLocale(fetch)).toBe("en");
  });

  test("without either, Czech", async () => {
    expect(
      await resolveLocale(fetcher({ "/api/status": { status: 200, body: { ok: false } } })),
    ).toBe("cs");
  });

  test("a page instead of the document, or an unknown language, says nothing", async () => {
    expect(
      await lazurioLocale(
        fetcher({ "/.lazurio/shell.json": { status: 200, text: "<!doctype html>" } }),
      ),
    ).toBeNull();
    expect(
      await lazurioLocale(
        fetcher({ "/.lazurio/shell.json": { status: 200, body: { locale: "de" } } }),
      ),
    ).toBeNull();
    expect(await lazurioLocale(async () => Promise.reject(new Error("offline")))).toBeNull();
  });
});
