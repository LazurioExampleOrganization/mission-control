import { STATUSES } from "../../domain/common.ts";
import { nextSteps, progress } from "../../domain/roadmap.ts";
import { formatPeriod } from "../../i18n/format.ts";
import type { MissionData } from "../App.tsx";
import { Progress, StatusChip } from "../components/Chips.tsx";
import { Intro } from "../components/Intro.tsx";
import { useI18n } from "../i18n.tsx";
import { href } from "../routes.ts";

export function OverviewPage({ data }: { data: MissionData }) {
  const { locale, messages } = useI18n();
  const words = messages.overview;
  const main = data.roadmaps.find((entry) => entry.value.main) ?? data.roadmaps[0];
  const active = data.plans.filter((entry) =>
    ["ready", "in_progress", "review", "blocked"].includes(entry.value.status),
  );
  const empty = data.plans.length === 0;
  return (
    <section>
      <header className="page-header">
        <h1 className="page-title">{words.title}</h1>
        <p className="page-subtitle">
          {words.subtitle(data.plans.length, data.roadmaps.length, data.config.plan_prefix)}
        </p>
      </header>

      <Intro />

      {empty ? (
        <article className="panel empty">
          <div className="panel-head">
            <h2>{words.firstPlanTitle}</h2>
            <a className="button primary" href={href({ page: "new-plan" })}>
              {messages.nav.newPlan}
            </a>
          </div>
          <p>{words.firstPlanText}</p>
        </article>
      ) : (
        <div className="stats">
          {STATUSES.filter((status) => status !== "archived").map((status) => (
            <a key={status} className="stat" href={href({ page: "plans", status })}>
              <span className="stat-value">
                {data.plans.filter((entry) => entry.value.status === status).length}
              </span>
              <span className="stat-label">{messages.status[status]}</span>
            </a>
          ))}
        </div>
      )}

      {main ? (
        <article className="panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">{main.value.main ? words.mainRoadmap : words.roadmap}</p>
              <h2>
                <a href={href({ page: "roadmap", code: main.value.roadmap_code })}>
                  {main.value.title}
                </a>
              </h2>
            </div>
            <Progress {...progress(main.value)} />
          </div>
          <p>{main.value.summary}</p>
          <h3>{words.nextSteps}</h3>
          {nextSteps(main.value).length === 0 ? (
            <p className="muted">{words.noNextStep}</p>
          ) : (
            <ul className="step-list">
              {nextSteps(main.value).map((step) => (
                <li key={step.id} className="step-row">
                  <StatusChip status={step.status} />
                  <span className="step-title">{step.title}</span>
                  {step.timing ? (
                    <span className="muted">
                      {words.until(formatPeriod(locale, step.timing.to))}
                    </span>
                  ) : null}
                  {step.plan_refs?.map((code) => (
                    <a key={code} className="code-link" href={href({ page: "plan", code })}>
                      {code}
                    </a>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </article>
      ) : (
        <article className="panel empty">
          <h2>{words.noRoadmapTitle}</h2>
          <p>{words.noRoadmapText}</p>
        </article>
      )}

      {empty ? null : (
        <article className="panel">
          <div className="panel-head">
            <h2>{words.activePlans}</h2>
            <a className="button" href={href({ page: "new-plan" })}>
              {messages.nav.newPlan}
            </a>
          </div>
          {active.length === 0 ? (
            <p className="muted">{words.nothingActive}</p>
          ) : (
            <ul className="plan-rows">
              {active.map(({ value }) => (
                <li key={value.dev_code}>
                  <a className="plan-row" href={href({ page: "plan", code: value.dev_code })}>
                    <span className="code">{value.dev_code}</span>
                    <span className="plan-row-title">{value.title}</span>
                    <StatusChip status={value.status} />
                    <span className="muted">{value.owner}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </article>
      )}
    </section>
  );
}
