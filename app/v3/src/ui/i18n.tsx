import { createContext, type ReactNode, useContext, useMemo } from "react";
import { DEFAULT_LOCALE, type Locale } from "../i18n/locale.ts";
import { type Messages, messagesFor } from "../i18n/messages.ts";

interface LocaleValue {
  locale: Locale;
  messages: Messages;
}

const LocaleContext = createContext<LocaleValue>({
  locale: DEFAULT_LOCALE,
  messages: messagesFor(DEFAULT_LOCALE),
});

/** The language of every screen below it; one language per page, never mixed. */
export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo(() => ({ locale, messages: messagesFor(locale) }), [locale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useI18n(): LocaleValue {
  return useContext(LocaleContext);
}
