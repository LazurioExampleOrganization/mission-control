import { periodStart, progress, type RoadmapStep } from "../../domain/roadmap.ts";
import { formatPeriod } from "../../i18n/format.ts";
import type { MissionData } from "../App.tsx";
import { PriorityChip, Progress, StatusChip } from "../components/Chips.tsx";
import { useI18n } from "../i18n.tsx";
import { href } from "../routes.ts";

/** Steps grouped by the period they end in; steps without timing come last. */
function byPeriod(steps: readonly RoadmapStep[]): [string, RoadmapStep[]][] {
  const groups = new Map<string, RoadmapStep[]>();
  for (const step of steps) {
    const key = step.timing?.to ?? "";
    groups.set(key, [...(groups.get(key) ?? []), step]);
  }
  return [...groups.entries()].sort(([left], [right]) => {
    if (left === "") return 1;
    if (right === "") return -1;
    return periodStart(left).localeCompare(periodStart(right)) || left.localeCompare(right);
  });
}

export function RoadmapDetailPage({ data, code }: { data: MissionData; code: string }) {
  const { locale, messages } = useI18n();
  const words = messages.roadmap;
  const found = data.roadmaps.find((entry) => entry.value.roadmap_code === code);
  if (!found) {
    return (
      <section>
        <h1 className="page-title">{words.notFound(code)}</h1>
        <a href={href({ page: "roadmaps" })}>{words.back}</a>
      </section>
    );
  }
  const roadmap = found.value;
  const titles = new Map(data.plans.map((entry) => [entry.value.dev_code, entry.value.title]));
  const priorities = new Map(roadmap.priorities.map((entry) => [entry.id, entry.title]));
  const lane = roadmap.agent_lane;
  return (
    <section>
      <header className="page-header">
        <p className="eyebrow">
          <a href={href({ page: "roadmaps" })}>{messages.roadmaps.title}</a> /{" "}
          {roadmap.roadmap_code}
        </p>
        <h1 className="page-title">{roadmap.title}</h1>
        <div className="meta-row">
          <StatusChip status={roadmap.status} />
          <PriorityChip priority={roadmap.priority} />
          <span className="muted">{words.owner(roadmap.owner)}</span>
          <span className="muted">
            {words.sourcePlan}{" "}
            <a href={href({ page: "plan", code: roadmap.source_plan })}>{roadmap.source_plan}</a>
          </span>
          <Progress {...progress(roadmap)} />
        </div>
        <p className="lead">{roadmap.summary}</p>
      </header>

      <div className="roadmap-panels">
        <article className="panel">
          <h2>{words.priorities}</h2>
          <ol className="priority-list">
            {[...roadmap.priorities]
              .sort((left, right) => left.rank - right.rank)
              .map((entry) => (
                <li key={entry.id}>
                  <strong>{entry.title}</strong>
                  {entry.rationale ? <p className="muted">{entry.rationale}</p> : null}
                </li>
              ))}
          </ol>
        </article>
        {lane ? (
          <article className="panel">
            <h2>{words.lane}</h2>
            <dl className="lane">
              <dt>{words.laneAgents}</dt>
              <dd>{lane.execution_agents.join(", ")}</dd>
              <dt>{words.laneReviewers}</dt>
              <dd>{lane.reviewers.join(", ")}</dd>
              <dt>{words.laneEscalation}</dt>
              <dd>{lane.escalation_policy}</dd>
            </dl>
          </article>
        ) : null}
      </div>

      <div className="timeline">
        {byPeriod(roadmap.steps).map(([period, steps]) => (
          <section key={period || "none"} className="timeline-period">
            <h2 className="timeline-label">
              {period ? formatPeriod(locale, period) : words.noTiming}
            </h2>
            <ul className="timeline-steps">
              {steps.map((step) => (
                <li key={step.id} className={`timeline-step step-${step.status}`}>
                  <div className="step-head">
                    <StatusChip status={step.status} />
                    <strong>{step.title}</strong>
                    {step.timing?.confidence ? (
                      <span className="muted">{messages.confidence[step.timing.confidence]}</span>
                    ) : null}
                  </div>
                  <div className="step-refs">
                    {step.plan_refs?.map((planCode) => (
                      <a
                        key={planCode}
                        className="code-link"
                        href={href({ page: "plan", code: planCode })}
                        title={titles.get(planCode)}
                      >
                        {planCode} {titles.get(planCode) ? `· ${titles.get(planCode)}` : ""}
                      </a>
                    ))}
                    {step.priority_refs?.map((ref) => (
                      <span key={ref} className="chip">
                        {priorities.get(ref) ?? ref}
                      </span>
                    ))}
                  </div>
                  {step.acceptance_criteria?.length ? (
                    <ul className="criteria">
                      {step.acceptance_criteria.map((criterion) => (
                        <li key={criterion}>{criterion}</li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </section>
  );
}
