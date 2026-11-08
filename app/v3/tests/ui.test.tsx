import { describe, expect, test } from "bun:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Locale } from "../src/i18n/locale.ts";
import type { MissionData } from "../src/ui/App.tsx";
import { LocaleProvider } from "../src/ui/i18n.tsx";
import { OverviewPage } from "../src/ui/pages/OverviewPage.tsx";
import { PlanDetailPage } from "../src/ui/pages/PlanDetailPage.tsx";
import { PlanEditForm } from "../src/ui/pages/PlanEditPage.tsx";
import { PlanListPage } from "../src/ui/pages/PlanListPage.tsx";
import { RoadmapDetailPage } from "../src/ui/pages/RoadmapDetailPage.tsx";
import { RoadmapListPage } from "../src/ui/pages/RoadmapListPage.tsx";
import { listsOf, planFromForm } from "../src/ui/plan-form.ts";
import { href, parseRoute } from "../src/ui/routes.ts";
import { sampleData } from "./support/seed.ts";

const dataFor = (locale: Locale): MissionData => {
  const sample = sampleData(locale);
  return {
    config: sample.config,
    plans: sample.plans.map((value) => ({ value, revision: "r" })),
    roadmaps: sample.roadmaps.map((value) => ({ value, revision: "r" })),
  };
};

const render = (locale: Locale, node: ReactNode) =>
  renderToStaticMarkup(<LocaleProvider locale={locale}>{node}</LocaleProvider>);

/** Letters only Czech has; an English screen of English data holds none. */
const CZECH = /[ěščřžýáíéůúňťďĚŠČŘŽÝÁÍÉŮÚŇŤĎ]/;

const pages = (data: MissionData) => [
  <OverviewPage key="overview" data={data} />,
  <RoadmapListPage key="roadmaps" data={data} />,
  <RoadmapDetailPage key="roadmap" data={data} code="RM-0001" />,
  <PlanListPage key="plans" data={data} status={null} />,
  <PlanDetailPage key="plan" data={data} code="EX-0002" />,
];

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

describe("pages in Czech", () => {
  const data = dataFor("cs");

  test("the overview says what Mission Control is for and shows the main roadmap", () => {
    const html = render("cs", <OverviewPage data={data} />);
    expect(html).toContain("Mission Control je místo, kde Organizace plánuje práci lidí a agentů");
    expect(html).toContain("Kdo na čem pracuje");
    expect(html).toContain("Provozní roadmapa 2026–2027");
    expect(html).toContain("Zahájit týdenní revize plánů");
    expect(html).toContain("4 plány a 1 roadmapa");
  });

  test("an empty Organization is told how to start", () => {
    const html = render("cs", <OverviewPage data={{ ...data, plans: [], roadmaps: [] }} />);
    expect(html).toContain("Mission Control je místo");
    expect(html).toContain("Začněte prvním plánem");
    expect(html).toContain("Zatím žádná roadmapa");
    expect(html).toContain("0 plánů a 0 roadmap");
  });

  test("a plan shows its sections, who works on its tasks and its roadmaps", () => {
    const html = render("cs", <PlanDetailPage data={data} code="EX-0002" />);
    expect(html).toContain("Pilot týdenního přehledu výzkumu");
    expect(html).toContain("Kritéria přijetí");
    expect(html).toContain("Řeší research-agent");
    expect(html).toContain("RM-0001 · Provozní roadmapa");
    expect(html).toContain("15. 9. 2026");
  });

  test("a roadmap groups its steps by period and names who works on it", () => {
    const html = render("cs", <RoadmapDetailPage data={data} code="RM-0001" />);
    expect(html).toContain("Q4 2026");
    expect(html).toContain("10/2026");
    expect(html).toContain("Kdo na roadmapě pracuje");
    expect(html).toContain("planning-agent, research-agent");
  });

  test("the plan list filters by state", () => {
    const html = render("cs", <PlanListPage data={data} status="ready" />);
    expect(html).toContain("EX-0003");
    expect(html).not.toContain("EX-0001</a>");
  });

  test("no page shows English interface words", () => {
    for (const page of pages(data)) {
      const html = render("cs", page);
      for (const word of ["Overview", "Acceptance criteria", "Owner", "Priorities", " done<"]) {
        expect(html).not.toContain(word);
      }
    }
  });
});

describe("pages in English", () => {
  const data = dataFor("en");

  test("the overview says what Mission Control is for and shows the main roadmap", () => {
    const html = render("en", <OverviewPage data={data} />);
    expect(html).toContain("Mission Control is where your Organization plans the work");
    expect(html).toContain("Operating roadmap 2026–2027");
    expect(html).toContain("Start the weekly planning review");
    expect(html).toContain("4 plans and 1 roadmap");
  });

  test("a plan and a roadmap read in English", () => {
    expect(render("en", <PlanDetailPage data={data} code="EX-0002" />)).toContain(
      "Assigned to research-agent",
    );
    const roadmap = render("en", <RoadmapDetailPage data={data} code="RM-0001" />);
    expect(roadmap).toContain("Who works on this roadmap");
    expect(roadmap).toContain("Oct 2026");
  });

  test("no page holds a Czech letter", () => {
    for (const page of [
      ...pages(data),
      <OverviewPage key="empty" data={{ ...data, plans: [], roadmaps: [] }} />,
    ]) {
      expect(render("en", page)).not.toMatch(CZECH);
    }
  });
});

describe("the plan form", () => {
  const plan = dataFor("en").plans[1]?.value;
  if (!plan) throw new Error("no example plan");

  test("keeps a list field's text exactly as typed", () => {
    // Every keystroke of "Pilot with two teams", a new line, then "Second " is
    // shown back as typed: the space before the next word and the new line
    // before the next item stay.
    const typed = "Pilot with two teams\nSecond ";
    let lists = listsOf({ ...plan, acceptance_criteria: [] });
    for (let length = 1; length <= typed.length; length += 1) {
      lists = { ...lists, acceptance_criteria: typed.slice(0, length) };
      const html = render(
        "en",
        <PlanEditForm
          code={plan.dev_code}
          plan={plan}
          lists={lists}
          error={null}
          saving={false}
          onPlan={() => {}}
          onList={() => {}}
          onSubmit={() => {}}
        />,
      );
      expect(html).toContain(`name="acceptance_criteria">${typed.slice(0, length)}</textarea>`);
    }
    expect(planFromForm(plan, lists).acceptance_criteria).toEqual([
      "Pilot with two teams",
      "Second",
    ]);
  });

  test("reads the lists into items only when saved, and drops empty optional lists", () => {
    const saved = planFromForm(plan, {
      ...listsOf(plan),
      scope_in: "  One  \n\n Two\n",
      open_questions: " \n ",
    });
    expect(saved.scope.in).toEqual(["One", "Two"]);
    expect("open_questions" in saved).toBe(false);
    expect(saved.risk_notes).toEqual(plan.risk_notes);
  });
});
