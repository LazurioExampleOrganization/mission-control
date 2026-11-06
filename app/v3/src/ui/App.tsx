import type { DraftPanelInput } from "@lazurio/repository-db";
import { useCallback, useEffect, useState } from "react";
import type { MissionControlConfig } from "../domain/config.ts";
import type { Plan } from "../domain/plan.ts";
import type { Roadmap } from "../domain/roadmap.ts";
import { api, type Stored, subscribe } from "./api.ts";
import { Layout } from "./components/Layout.tsx";
import { DraftPage } from "./pages/DraftPage.tsx";
import { NewPlanPage } from "./pages/NewPlanPage.tsx";
import { OverviewPage } from "./pages/OverviewPage.tsx";
import { PlanDetailPage } from "./pages/PlanDetailPage.tsx";
import { PlanEditPage } from "./pages/PlanEditPage.tsx";
import { PlanListPage } from "./pages/PlanListPage.tsx";
import { RoadmapDetailPage } from "./pages/RoadmapDetailPage.tsx";
import { RoadmapListPage } from "./pages/RoadmapListPage.tsx";
import { parseRoute, type Route } from "./routes.ts";

export interface MissionData {
  config: MissionControlConfig;
  plans: Stored<Plan>[];
  roadmaps: Stored<Roadmap>[];
}

function useHashRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const update = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return route;
}

export function App() {
  const route = useHashRoute();
  const [data, setData] = useState<MissionData | null>(null);
  const [draft, setDraft] = useState<DraftPanelInput | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [config, plans, roadmaps] = await Promise.all([
        api.config(),
        api.plans(),
        api.roadmaps(),
      ]);
      setData({ config, plans, roadmaps });
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, []);
  const reloadDraft = useCallback(async () => {
    setDraft(await api.draft().catch(() => null));
  }, []);

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
    <Layout route={route} draft={draft}>
      {error ? (
        <div className="notice notice-danger" role="alert">
          <strong>Data se nepodařilo načíst.</strong> {error}
        </div>
      ) : null}
      {data ? <Page route={route} data={data} onChanged={changed} /> : null}
      {!data && !error ? <p className="muted">Načítám…</p> : null}
    </Layout>
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
          <h1 className="page-title">Stránka neexistuje</h1>
          <p>
            <a href="#/">Zpět na přehled</a>
          </p>
        </section>
      );
  }
}
