import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter-tight";
import "@fontsource/geist-mono/400.css";
import "./styles.css";
import "../instance/theme.css";
import { App } from "./App.tsx";

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
