import type { Locale } from "./locale.ts";

/** The forms a counted word takes; Czech needs `few` and `many`, English only `one` and `other`. */
export interface PluralForms {
  one: string;
  few?: string;
  many?: string;
  other: string;
}

const pluralRules = new Map<Locale, Intl.PluralRules>();

/** `count` with the word in the right form: `1 plán`, `3 plány`, `5 plánů`. */
export function plural(locale: Locale, count: number, forms: PluralForms): string {
  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    pluralRules.set(locale, rules);
  }
  const category = rules.select(count);
  const word =
    category === "one"
      ? forms.one
      : category === "few"
        ? (forms.few ?? forms.other)
        : category === "many"
          ? (forms.many ?? forms.other)
          : forms.other;
  return `${count} ${word}`;
}

const DATE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;

/** A stored date (`2026-11-06`) as people read it: `6. 11. 2026`, `6 Nov 2026`. */
export function formatDate(locale: Locale, value: string): string {
  const match = DATE.exec(value);
  if (!match) return value;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat(locale === "cs" ? "cs-CZ" : "en-GB", {
    day: "numeric",
    month: locale === "cs" ? "numeric" : "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/** A roadmap period: `2026-Q2` → `Q2 2026`; `2026-03` → `3/2026` or `Mar 2026`. */
export function formatPeriod(locale: Locale, value: string): string {
  const quarter = /^([0-9]{4})-(Q[1-4])$/.exec(value);
  if (quarter) return `${quarter[2]} ${quarter[1]}`;
  const month = /^([0-9]{4})-([0-9]{2})$/.exec(value);
  if (!month) return value;
  if (locale === "cs") return `${Number(month[2])}/${month[1]}`;
  const date = new Date(Date.UTC(Number(month[1]), Number(month[2]) - 1, 1));
  return new Intl.DateTimeFormat("en-GB", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}
