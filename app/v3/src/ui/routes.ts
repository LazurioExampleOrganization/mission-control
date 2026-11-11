import { STATUSES, type Status } from "../domain/common.ts";

/** The App's pages, addressed by the URL hash so a reload keeps the page. */
export type Route =
  | { page: "overview" }
  | { page: "roadmaps" }
  | { page: "roadmap"; code: string }
  | { page: "plans"; status: Status | null }
  | { page: "new-plan" }
  | { page: "plan"; code: string }
  | { page: "edit-plan"; code: string }
  | { page: "draft" }
  | { page: "not-found" };

export function parseRoute(hash: string): Route {
  const [path = "", query = ""] = hash.replace(/^#/, "").split("?");
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts.length === 0) return { page: "overview" };
  const [first, second, third] = parts;
  if (first === "roadmaps" && parts.length === 1) return { page: "roadmaps" };
  if (first === "roadmaps" && second && parts.length === 2)
    return { page: "roadmap", code: second };
  if (first === "plans" && parts.length === 1) {
    const status = new URLSearchParams(query).get("status");
    return {
      page: "plans",
      status: STATUSES.includes(status as Status) ? (status as Status) : null,
    };
  }
  if (first === "plans" && second === "new" && parts.length === 2) return { page: "new-plan" };
  if (first === "plans" && second && parts.length === 2) return { page: "plan", code: second };
  if (first === "plans" && second && third === "edit" && parts.length === 3) {
    return { page: "edit-plan", code: second };
  }
  if (first === "draft" && parts.length === 1) return { page: "draft" };
  return { page: "not-found" };
}

export function href(route: Route): string {
  switch (route.page) {
    case "overview":
      return "#/";
    case "roadmaps":
      return "#/roadmaps";
    case "roadmap":
      return `#/roadmaps/${encodeURIComponent(route.code)}`;
    case "plans":
      return route.status ? `#/plans?status=${route.status}` : "#/plans";
    case "new-plan":
      return "#/plans/new";
    case "plan":
      return `#/plans/${encodeURIComponent(route.code)}`;
    case "edit-plan":
      return `#/plans/${encodeURIComponent(route.code)}/edit`;
    case "draft":
      return "#/draft";
    case "not-found":
      return "#/";
  }
}
