import type { DraftPanelInput } from "@lazurio/repository-db";
import type { ReactNode } from "react";
import type { Messages } from "../../i18n/messages.ts";
import { missionControlBrand } from "../../instance/brand.ts";
import { useI18n } from "../i18n.tsx";
import { href, type Route } from "../routes.ts";

const NAV: { label: keyof Messages["nav"]; route: Route; matches: Route["page"][] }[] = [
  { label: "overview", route: { page: "overview" }, matches: ["overview"] },
  { label: "roadmaps", route: { page: "roadmaps" }, matches: ["roadmaps", "roadmap"] },
  {
    label: "plans",
    route: { page: "plans", status: null },
    matches: ["plans", "plan", "edit-plan"],
  },
  { label: "newPlan", route: { page: "new-plan" }, matches: ["new-plan"] },
  { label: "draft", route: { page: "draft" }, matches: ["draft"] },
];

/**
 * The template's placeholder in `instance/brand.ts`, which an adopting
 * Organization replaces with its display name; until then the sidebar says
 * "your Organization" in the page's language.
 */
const PLACEHOLDER_ORGANIZATION: string = "Organization";

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
  const { messages } = useI18n();
  const count = draftCount(draft);
  const organization =
    missionControlBrand.organization === PLACEHOLDER_ORGANIZATION
      ? messages.nav.organizationPlaceholder
      : missionControlBrand.organization;
  return (
    <div className="shell">
      <nav className="sidebar" aria-label={messages.nav.label}>
        <div className="sidebar-header">
          <span className="sidebar-product">Mission Control</span>
          <span className="sidebar-context">{organization}</span>
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
                  <span>{messages.nav[item.label]}</span>
                  {item.route.page === "draft" && count !== null ? (
                    <span className="badge badge-draft" title={messages.nav.draftBadge}>
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
