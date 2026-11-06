import type { ReactNode } from "react";
import type { MissionData } from "../App.tsx";
import { PriorityChip, StatusChip } from "../components/Chips.tsx";
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
  const found = data.plans.find((entry) => entry.value.dev_code === code);
  if (!found) {
    return (
      <section>
        <h1 className="page-title">Plán {code} neexistuje</h1>
        <a href={href({ page: "plans", status: null })}>Zpět na plány</a>
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
          <a href={href({ page: "plans", status: null })}>Plány</a> / {plan.dev_code}
        </p>
        <div className="title-row">
          <h1 className="page-title">{plan.title}</h1>
          <a className="button primary" href={href({ page: "edit-plan", code })}>
            Upravit
          </a>
        </div>
        <div className="meta-row">
          <StatusChip status={plan.status} />
          <PriorityChip priority={plan.priority} />
          <span className="muted">Pořadí {plan.priority_rank}</span>
          <span className="muted">Vlastník {plan.owner}</span>
          <span className="muted">
            Založeno {plan.created_at} · upraveno {plan.updated_at}
          </span>
        </div>
      </header>

      <div className="plan-grid">
        <div>
          <Section title="Kontext">
            <p>{plan.context}</p>
          </Section>
          <Section title="Současný problém">
            <p>{plan.current_problem}</p>
          </Section>
          <Section title="Cílový stav">
            <p>{plan.target_state}</p>
          </Section>
          <Section title="Rozsah">
            <div className="scope">
              <div>
                <h3>Patří do něj</h3>
                <Items items={plan.scope.in} />
              </div>
              <div>
                <h3>Nepatří do něj</h3>
                <Items items={plan.scope.out} />
              </div>
            </div>
          </Section>
          <Section title="Kritéria přijetí">
            <Items items={plan.acceptance_criteria} />
          </Section>
          <Section title="Ověření">
            <Items items={plan.validation} />
          </Section>
          {plan.proposed_tasks?.length ? (
            <Section title="Navržené úkoly">
              <ul className="task-list">
                {plan.proposed_tasks.map((task) => (
                  <li key={task.id ?? task.title}>
                    <strong>{task.title}</strong>
                    {task.priority ? <PriorityChip priority={task.priority} /> : null}
                    <p>{task.summary}</p>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
        </div>
        <aside className="plan-aside">
          {roadmaps.length ? (
            <Section title="Na roadmapách">
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
          <Section title="Rozhodnutí">
            {plan.decisions?.length ? (
              <ul className="decisions">
                {plan.decisions.map((decision) => (
                  <li key={`${decision.date}-${decision.decision}`}>
                    <span className="muted">{decision.date}</span> {decision.decision}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">—</p>
            )}
          </Section>
          <Section title="Otevřené otázky">
            <Items items={plan.open_questions} />
          </Section>
          <Section title="Rizika">
            <Items items={plan.risk_notes} />
          </Section>
          {plan.links?.length ? (
            <Section title="Odkazy">
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
