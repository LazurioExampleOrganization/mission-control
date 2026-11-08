import type { ReactNode } from "react";
import { formatDate } from "../../i18n/format.ts";
import type { MissionData } from "../App.tsx";
import { PriorityChip, StatusChip } from "../components/Chips.tsx";
import { useI18n } from "../i18n.tsx";
import { href } from "../routes.ts";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="plan-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Items({ items }: { items: readonly string[] | undefined }) {
  if (!items?.length) return <p className="muted">—</p>;
  return (
    <ul>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

export function PlanDetailPage({ data, code }: { data: MissionData; code: string }) {
  const { locale, messages } = useI18n();
  const words = messages.plan;
  const found = data.plans.find((entry) => entry.value.dev_code === code);
  if (!found) {
    return (
      <section>
        <h1 className="page-title">{words.notFound(code)}</h1>
        <a href={href({ page: "plans", status: null })}>{words.back}</a>
      </section>
    );
  }
  const plan = found.value;
  const roadmaps = data.roadmaps.filter(
    (entry) =>
      entry.value.source_plan === code ||
      entry.value.steps.some((step) => step.plan_refs?.includes(code)),
  );
  return (
    <article className="plan">
      <header className="page-header">
        <p className="eyebrow">
          <a href={href({ page: "plans", status: null })}>{messages.plans.title}</a> /{" "}
          {plan.dev_code}
        </p>
        <div className="title-row">
          <h1 className="page-title">{plan.title}</h1>
          <a className="button primary" href={href({ page: "edit-plan", code })}>
            {words.edit}
          </a>
        </div>
        <div className="meta-row">
          <StatusChip status={plan.status} />
          <PriorityChip priority={plan.priority} />
          <span className="muted">{words.rank(plan.priority_rank)}</span>
          <span className="muted">{words.owner(plan.owner)}</span>
          <span className="muted">
            {words.dates(formatDate(locale, plan.created_at), formatDate(locale, plan.updated_at))}
          </span>
        </div>
      </header>

      <div className="plan-grid">
        <div>
          <Section title={words.context}>
            <p>{plan.context}</p>
          </Section>
          <Section title={words.currentProblem}>
            <p>{plan.current_problem}</p>
          </Section>
          <Section title={words.targetState}>
            <p>{plan.target_state}</p>
          </Section>
          <Section title={words.scope}>
            <div className="scope">
              <div>
                <h3>{words.scopeIn}</h3>
                <Items items={plan.scope.in} />
              </div>
              <div>
                <h3>{words.scopeOut}</h3>
                <Items items={plan.scope.out} />
              </div>
            </div>
          </Section>
          <Section title={words.acceptanceCriteria}>
            <Items items={plan.acceptance_criteria} />
          </Section>
          <Section title={words.validation}>
            <Items items={plan.validation} />
          </Section>
          {plan.proposed_tasks?.length ? (
            <Section title={words.proposedTasks}>
              <ul className="task-list">
                {plan.proposed_tasks.map((task) => (
                  <li key={task.id ?? task.title}>
                    <div className="task-head">
                      <strong>{task.title}</strong>
                      {task.priority ? <PriorityChip priority={task.priority} /> : null}
                      {task.assignee ? (
                        <span className="chip chip-assignee">{words.assignee(task.assignee)}</span>
                      ) : null}
                    </div>
                    <p>{task.summary}</p>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
        </div>
        <aside className="plan-aside">
          {roadmaps.length ? (
            <Section title={words.onRoadmaps}>
              <ul>
                {roadmaps.map(({ value }) => (
                  <li key={value.roadmap_code}>
                    <a href={href({ page: "roadmap", code: value.roadmap_code })}>
                      {value.roadmap_code} · {value.title}
                    </a>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
          <Section title={words.decisions}>
            {plan.decisions?.length ? (
              <ul className="decisions">
                {plan.decisions.map((decision) => (
                  <li key={`${decision.date}-${decision.decision}`}>
                    <span className="muted">{formatDate(locale, decision.date)}</span>{" "}
                    {decision.decision}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">—</p>
            )}
          </Section>
          <Section title={words.openQuestions}>
            <Items items={plan.open_questions} />
          </Section>
          <Section title={words.risks}>
            <Items items={plan.risk_notes} />
          </Section>
          {plan.links?.length ? (
            <Section title={words.links}>
              <ul>
                {plan.links.map((entry) => (
                  <li key={entry.label}>
                    {entry.url ? (
                      <a href={entry.url} target="_blank" rel="noreferrer">
                        {entry.label}
                      </a>
                    ) : (
                      <span>
                        {entry.label} {entry.path ? <code>{entry.path}</code> : null}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
        </aside>
      </div>
    </article>
  );
}
