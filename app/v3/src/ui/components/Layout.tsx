import type { DraftPanelInput } from "@lazurio/repository-db";
import type { ReactNode } from "react";
import { missionControlBrand } from "../../instance/brand.ts";
import { href, type Route } from "../routes.ts";

const NAV: { label: string; route: Route; matches: Route["page"][] }[] = [
  { label: "Přehled", route: { page: "overview" }, matches: ["overview"] },
  { label: "Roadmapy", route: { page: "roadmaps" }, matches: ["roadmaps", "roadmap"] },
  {
    label: "Plány",
    route: { page: "plans", status: null },
    matches: ["plans", "plan", "edit-plan"],
  },
  { label: "Nový plán", route: { page: "new-plan" }, matches: ["new-plan"] },
  { label: "Koncept a publikování", route: { page: "draft" }, matches: ["draft"] },
];

/** How many records the unpublished draft changes; null when there is no draft. */
function draftCount(draft: DraftPanelInput | null): number | null {
  if (!draft?.status) return null;
  const count = draft.records?.length ?? draft.status.dirtyPaths.length;
  return count > 0 ? count : null;
}

export function Layout({
  route,
  draft,
  children,
}: {
  route: Route;
  draft: DraftPanelInput | null;
  children: ReactNode;
}) {
  const count = draftCount(draft);
  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Hlavní navigace">
        <div className="sidebar-header">
          <span className="sidebar-product">Mission Control</span>
          <span className="sidebar-context">{missionControlBrand.organization}</span>
        </div>
        <ul className="sidebar-items">
          {NAV.map((item) => {
            const active = item.matches.includes(route.page);
            return (
              <li key={item.label}>
                <a
                  className={`sidebar-item${active ? " active" : ""}`}
                  href={href(item.route)}
                  aria-current={active ? "page" : undefined}
                >
                  <span>{item.label}</span>
                  {item.route.page === "draft" && count !== null ? (
                    <span className="badge badge-draft" title="Nepublikované změny">
                      {count}
                    </span>
                  ) : null}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
      <main className="content-area">{children}</main>
    </div>
  );
}
