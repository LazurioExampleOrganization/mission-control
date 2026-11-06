import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { MissionData } from "../src/ui/App.tsx";
import { OverviewPage } from "../src/ui/pages/OverviewPage.tsx";
import { PlanDetailPage } from "../src/ui/pages/PlanDetailPage.tsx";
import { PlanListPage } from "../src/ui/pages/PlanListPage.tsx";
import { RoadmapDetailPage } from "../src/ui/pages/RoadmapDetailPage.tsx";
import { href, parseRoute } from "../src/ui/routes.ts";
import { sampleData } from "./support/seed.ts";

const sample = sampleData();
const data: MissionData = {
  config: sample.config,
  plans: sample.plans.map((value) => ({ value, revision: "r" })),
  roadmaps: sample.roadmaps.map((value) => ({ value, revision: "r" })),
};

describe("routes", () => {
  test("every page round-trips through its hash", () => {
    for (const route of [
      { page: "overview" },
      { page: "roadmaps" },
      { page: "roadmap", code: "RM-0001" },
      { page: "plans", status: null },
      { page: "plans", status: "ready" },
      { page: "new-plan" },
      { page: "plan", code: "EX-0001" },
      { page: "edit-plan", code: "EX-0001" },
      { page: "draft" },
    ] as const) {
      expect(parseRoute(href(route))).toEqual(route);
    }
    expect(parseRoute("#/nowhere/at/all").page).toBe("not-found");
  });
});

describe("pages", () => {
  test("the overview shows the main roadmap and its next step", () => {
    const html = renderToStaticMarkup(<OverviewPage data={data} />);
    expect(html).toContain("Operating roadmap 2026–2027");
    expect(html).toContain("Start the weekly planning review");
  });

  test("the plan list filters by state", () => {
    const html = renderToStaticMarkup(<PlanListPage data={data} status="ready" />);
    expect(html).toContain("EX-0003");
    expect(html).not.toContain("EX-0001</a>");
  });

  test("a plan shows its sections and the roadmaps it is on", () => {
    const html = renderToStaticMarkup(<PlanDetailPage data={data} code="EX-0002" />);
    expect(html).toContain("Weekly research digest pilot");
    expect(html).toContain("Kritéria přijetí");
    expect(html).toContain("RM-0001 · Operating roadmap");
  });

  test("a roadmap groups its steps by period", () => {
    const html = renderToStaticMarkup(<RoadmapDetailPage data={data} code="RM-0001" />);
    expect(html).toContain("Q4 2026");
    expect(html).toContain("Q1 2027");
  });
});
