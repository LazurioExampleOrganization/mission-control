import { progress } from "../../domain/roadmap.ts";
import type { MissionData } from "../App.tsx";
import { PriorityChip, Progress, StatusChip } from "../components/Chips.tsx";
import { href } from "../routes.ts";

export function RoadmapListPage({ data }: { data: MissionData }) {
  return (
    <section>
      <header className="page-header">
        <h1 className="page-title">Roadmapy</h1>
        <p className="page-subtitle">Roadmapa řadí plány do kroků v čase.</p>
      </header>
      {data.roadmaps.length === 0 ? (
        <p className="muted">Datový repozitář zatím nemá žádnou roadmapu.</p>
      ) : (
        <div className="cards">
          {data.roadmaps.map(({ value }) => (
            <a
              key={value.roadmap_code}
              className="card"
              href={href({ page: "roadmap", code: value.roadmap_code })}
            >
              <div className="card-head">
                <span className="code">{value.roadmap_code}</span>
                {value.main ? <span className="chip chip-main">Hlavní</span> : null}
                <StatusChip status={value.status} />
                <PriorityChip priority={value.priority} />
              </div>
              <h2>{value.title}</h2>
              <p>{value.summary}</p>
              <Progress {...progress(value)} />
            </a>
          ))}
        </div>
      )}
    </section>
  );
}
