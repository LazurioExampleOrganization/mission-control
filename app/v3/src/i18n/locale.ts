/**
 * The languages of the interface. Czech is the default: an Organization
 * whose Lazurio does not say otherwise gets Czech.
 */
export const LOCALES = ["cs", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "cs";

export function isLocale(value: unknown): value is Locale {
  return value === "cs" || value === "en";
}

/** A query or option value as a locale; anything else is the default. */
export function localeOr(value: unknown, fallback: Locale = DEFAULT_LOCALE): Locale {
  return isLocale(value) ? value : fallback;
}
