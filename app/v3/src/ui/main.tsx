import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter-tight";
import "@fontsource/geist-mono/400.css";
import "./styles.css";
import "../instance/theme.css";
import { App } from "./App.tsx";
import { LocaleProvider } from "./i18n.tsx";
import { resolveLocale } from "./locale-source.ts";

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root");

// The language is decided before the first screen, so no page ever shows
// one language and then the other.
void resolveLocale().then((locale) => {
  document.documentElement.lang = locale;
  createRoot(root).render(
    <StrictMode>
      <LocaleProvider locale={locale}>
        <App />
      </LocaleProvider>
    </StrictMode>,
  );
});
