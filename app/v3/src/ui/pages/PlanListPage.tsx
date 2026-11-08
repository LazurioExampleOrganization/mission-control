import { STATUSES, type Status } from "../../domain/common.ts";
import { formatDate } from "../../i18n/format.ts";
import type { MissionData } from "../App.tsx";
import { PriorityChip, StatusChip } from "../components/Chips.tsx";
import { useI18n } from "../i18n.tsx";
import { href } from "../routes.ts";

export function PlanListPage({ data, status }: { data: MissionData; status: Status | null }) {
  const { locale, messages } = useI18n();
  const words = messages.plans;
  const plans = status ? data.plans.filter((entry) => entry.value.status === status) : data.plans;
  return (
    <section>
      <header className="page-header">
        <h1 className="page-title">{words.title}</h1>
        <p className="page-subtitle">{words.subtitle}</p>
      </header>
      <nav className="filters" aria-label={words.filterLabel}>
        <a
          className={`filter${status === null ? " active" : ""}`}
          href={href({ page: "plans", status: null })}
        >
          {words.all} <span className="muted">{data.plans.length}</span>
        </a>
        {STATUSES.map((value) => (
          <a
            key={value}
            className={`filter${status === value ? " active" : ""}`}
            href={href({ page: "plans", status: value })}
          >
            {messages.status[value]}{" "}
            <span className="muted">
              {data.plans.filter((entry) => entry.value.status === value).length}
            </span>
          </a>
        ))}
      </nav>
      {plans.length === 0 ? (
        <p className="muted">
          {data.plans.length === 0 ? (
            <>
              {words.none} <a href={href({ page: "new-plan" })}>{messages.nav.newPlan}</a>
            </>
          ) : (
            words.noneInState
          )}
        </p>
      ) : (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>{words.columns.code}</th>
                <th>{words.columns.title}</th>
                <th>{words.columns.status}</th>
                <th>{words.columns.priority}</th>
                <th>{words.columns.owner}</th>
                <th>{words.columns.updated}</th>
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
                  <td className="muted nowrap">{formatDate(locale, value.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
