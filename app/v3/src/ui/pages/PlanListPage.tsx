import { STATUSES, type Status } from "../../domain/common.ts";
import type { MissionData } from "../App.tsx";
import { PriorityChip, StatusChip } from "../components/Chips.tsx";
import { STATUS_LABELS } from "../labels.ts";
import { href } from "../routes.ts";

export function PlanListPage({ data, status }: { data: MissionData; status: Status | null }) {
  const plans = status ? data.plans.filter((entry) => entry.value.status === status) : data.plans;
  return (
    <section>
      <header className="page-header">
        <h1 className="page-title">Plány</h1>
        <p className="page-subtitle">Seřazené podle pořadí a kódu.</p>
      </header>
      <nav className="filters" aria-label="Filtr stavu">
        <a
          className={`filter${status === null ? " active" : ""}`}
          href={href({ page: "plans", status: null })}
        >
          Všechny <span className="muted">{data.plans.length}</span>
        </a>
        {STATUSES.map((value) => (
          <a
            key={value}
            className={`filter${status === value ? " active" : ""}`}
            href={href({ page: "plans", status: value })}
          >
            {STATUS_LABELS[value]}{" "}
            <span className="muted">
              {data.plans.filter((entry) => entry.value.status === value).length}
            </span>
          </a>
        ))}
      </nav>
      {plans.length === 0 ? (
        <p className="muted">V tomto stavu není žádný plán.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Kód</th>
              <th>Název</th>
              <th>Stav</th>
              <th>Priorita</th>
              <th>Vlastník</th>
              <th>Upraveno</th>
            </tr>
          </thead>
          <tbody>
            {plans.map(({ value }) => (
              <tr key={value.dev_code}>
                <td>
                  <a className="code" href={href({ page: "plan", code: value.dev_code })}>
                    {value.dev_code}
                  </a>
                </td>
                <td>
                  <a href={href({ page: "plan", code: value.dev_code })}>{value.title}</a>
                </td>
                <td>
                  <StatusChip status={value.status} />
                </td>
                <td>
                  <PriorityChip priority={value.priority} />
                </td>
                <td>{value.owner}</td>
                <td className="muted">{value.updated_at}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
