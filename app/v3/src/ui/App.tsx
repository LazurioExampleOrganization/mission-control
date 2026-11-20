import type { DraftPanelInput } from "@lazurio/repository-db";
import { useCallback, useEffect, useState } from "react";
import type { MissionControlConfig } from "../domain/config.ts";
import type { Plan } from "../domain/plan.ts";
import type { Roadmap } from "../domain/roadmap.ts";
import { ApiError, api, type Stored, subscribe } from "./api.ts";
import { ErrorNotice } from "./components/fields.tsx";
import { Intro } from "./components/Intro.tsx";
import { Layout } from "./components/Layout.tsx";
import { useI18n } from "./i18n.tsx";
import { DraftPage } from "./pages/DraftPage.tsx";
import { NewPlanPage } from "./pages/NewPlanPage.tsx";
import { OverviewPage } from "./pages/OverviewPage.tsx";
import { PlanDetailPage } from "./pages/PlanDetailPage.tsx";
import { PlanEditPage } from "./pages/PlanEditPage.tsx";
import { PlanListPage } from "./pages/PlanListPage.tsx";
import { RoadmapDetailPage } from "./pages/RoadmapDetailPage.tsx";
import { RoadmapListPage } from "./pages/RoadmapListPage.tsx";
import { parseRoute, type Route, samePage } from "./routes.ts";
import { useCanWrite, WriteContext } from "./write.tsx";

export interface MissionData {
  config: MissionControlConfig;
  plans: Stored<Plan>[];
  roadmaps: Stored<Roadmap>[];
}

function useHashRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    let shown = window.location.hash;
    const update = () => {
      const next = window.location.hash;
      // A link to another page opens it at its top, not at the height the
      // previous page was scrolled to; a filter of the same page keeps it.
      if (!samePage(shown, next)) window.scrollTo(0, 0);
      shown = next;
      setRoute(parseRoute(next));
    };
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return route;
}

export function App() {
  const { locale, messages } = useI18n();
  const route = useHashRoute();
  const [data, setData] = useState<MissionData | null>(null);
  const [draft, setDraft] = useState<DraftPanelInput | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  // Nothing is offered for change until the server says this copy writes.
  const [canWrite, setCanWrite] = useState<boolean | null>(null);

  const reload = useCallback(async () => {
    try {
      const [config, plans, roadmaps, status] = await Promise.all([
        api.config(),
        api.plans(),
        api.roadmaps(),
        api.status(),
      ]);
      setData({ config, plans, roadmaps });
      setCanWrite(status.mayWrite === true);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught : new ApiError("unexpected", String(caught)));
    }
  }, []);
  const reloadDraft = useCallback(async () => {
    setDraft(await api.draft(locale).catch(() => null));
  }, [locale]);

  useEffect(() => {
    void reload();
    void reloadDraft();
    return subscribe((type) => {
      if (type === "records-changed") void reload();
      void reloadDraft();
    });
  }, [reload, reloadDraft]);

  const changed = async () => {
    await Promise.all([reload(), reloadDraft()]);
  };

  return (
    <WriteContext.Provider value={canWrite}>
      <Layout route={route} draft={draft}>
        {error ? (
          <>
            {route.page === "overview" ? (
              <header className="page-header">
                <h1 className="page-title">{messages.overview.title}</h1>
              </header>
            ) : null}
            <ErrorNotice error={error} lead={messages.app.loadFailed} />
            {route.page === "overview" ? <Intro /> : null}
          </>
        ) : null}
        {data && !error ? <Page route={route} data={data} onChanged={changed} /> : null}
        {!data && !error ? <p className="muted">{messages.app.loading}</p> : null}
      </Layout>
    </WriteContext.Provider>
  );
}

function Page({
  route,
  data,
  onChanged,
}: {
  route: Route;
  data: MissionData;
  onChanged: () => Promise<void>;
}) {
  const { messages } = useI18n();
  const canWrite = useCanWrite();
  // A copy that may not write opens no form: the notice above says why.
  if (!canWrite && (route.page === "new-plan" || route.page === "edit-plan"))
    return route.page === "edit-plan" ? (
      <PlanDetailPage data={data} code={route.code} />
    ) : (
      <OverviewPage data={data} />
    );
  switch (route.page) {
    case "overview":
      return <OverviewPage data={data} />;
    case "roadmaps":
      return <RoadmapListPage data={data} />;
    case "roadmap":
      return <RoadmapDetailPage data={data} code={route.code} />;
    case "plans":
      return <PlanListPage data={data} status={route.status} />;
    case "new-plan":
      return <NewPlanPage onChanged={onChanged} />;
    case "plan":
      return <PlanDetailPage data={data} code={route.code} />;
    case "edit-plan":
      return <PlanEditPage key={route.code} code={route.code} onChanged={onChanged} />;
    case "draft":
      return <DraftPage onChanged={onChanged} />;
    case "not-found":
      return (
        <section>
          <h1 className="page-title">{messages.app.notFoundTitle}</h1>
          <p>
            <a href="#/">{messages.app.backToOverview}</a>
          </p>
        </section>
      );
  }
}
