import { STATUSES } from "../../domain/common.ts";
import { nextSteps, progress } from "../../domain/roadmap.ts";
import type { MissionData } from "../App.tsx";
import { Progress, StatusChip } from "../components/Chips.tsx";
import { periodLabel, STATUS_LABELS } from "../labels.ts";
import { href } from "../routes.ts";

export function OverviewPage({ data }: { data: MissionData }) {
  const main = data.roadmaps.find((entry) => entry.value.main) ?? data.roadmaps[0];
  const active = data.plans.filter((entry) =>
    ["ready", "in_progress", "review", "blocked"].includes(entry.value.status),
  );
  return (
    <section>
      <header className="page-header">
        <h1 className="page-title">Přehled</h1>
        <p className="page-subtitle">
          {data.plans.length} plánů a {data.roadmaps.length} roadmap · prefix plánů{" "}
          <code>{data.config.plan_prefix}</code>
        </p>
      </header>

      <div className="stats">
        {STATUSES.filter((status) => status !== "archived").map((status) => (
          <a key={status} className="stat" href={href({ page: "plans", status })}>
            <span className="stat-value">
              {data.plans.filter((entry) => entry.value.status === status).length}
            </span>
            <span className="stat-label">{STATUS_LABELS[status]}</span>
          </a>
        ))}
      </div>

      {main ? (
        <article className="panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">{main.value.main ? "Hlavní roadmapa" : "Roadmapa"}</p>
              <h2>
                <a href={href({ page: "roadmap", code: main.value.roadmap_code })}>
                  {main.value.title}
                </a>
              </h2>
            </div>
            <Progress {...progress(main.value)} />
          </div>
          <p>{main.value.summary}</p>
          <h3>Další kroky</h3>
          {nextSteps(main.value).length === 0 ? (
            <p className="muted">Žádný krok teď nečeká na start.</p>
          ) : (
            <ul className="step-list">
              {nextSteps(main.value).map((step) => (
                <li key={step.id} className="step-row">
                  <StatusChip status={step.status} />
                  <span className="step-title">{step.title}</span>
                  {step.timing ? (
                    <span className="muted">do {periodLabel(step.timing.to)}</span>
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
          <h2>Zatím žádná roadmapa</h2>
          <p>
            Roadmapy vznikají v datovém repozitáři. Začněte plánem a požádejte agenta, ať z plánů
            připraví roadmapu.
          </p>
        </article>
      )}

      <article className="panel">
        <div className="panel-head">
          <h2>Rozpracované plány</h2>
          <a className="button" href={href({ page: "new-plan" })}>
            Nový plán
          </a>
        </div>
        {active.length === 0 ? (
          <p className="muted">Nic není rozpracované.</p>
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
    </section>
  );
}
