import {
  parseYaml,
  REVIEW_SURFACE_CONTRACT_VERSION,
  type ReviewableResource,
  type ReviewFieldSummary,
  type ReviewInputChange,
  type ReviewSurfaceAdapter,
  structuralDiff,
} from "@lazurio/repository-db";

/** Czech labels of the fields a reviewer sees; a field without one shows its key. */
const FIELD_LABELS: Record<string, string> = {
  title: "Název",
  status: "Stav",
  owner: "Vlastník",
  priority: "Priorita",
  priority_rank: "Pořadí",
  updated_at: "Upraveno",
  context: "Kontext",
  current_problem: "Současný problém",
  target_state: "Cílový stav",
  scope: "Rozsah",
  acceptance_criteria: "Kritéria přijetí",
  validation: "Ověření",
  open_questions: "Otevřené otázky",
  decisions: "Rozhodnutí",
  risk_notes: "Rizika",
  summary: "Shrnutí",
  steps: "Kroky",
  priorities: "Priority",
  main: "Hlavní roadmapa",
};

/** Names changed fields as a reviewer knows them. */
export function labelFields(fields: readonly ReviewFieldSummary[]): ReviewFieldSummary[] {
  return fields.map((field) => {
    const key = field.fieldPath.split("/")[1] ?? "";
    return { ...field, label: FIELD_LABELS[key] ?? field.label };
  });
}

function parsed(text: string | undefined): Record<string, unknown> | undefined {
  if (text === undefined) return undefined;
  try {
    const value = parseYaml(text);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function describe(path: string, record: Record<string, unknown> | undefined) {
  const planCode = typeof record?.dev_code === "string" ? record.dev_code : null;
  const roadmapCode = typeof record?.roadmap_code === "string" ? record.roadmap_code : null;
  const title = typeof record?.title === "string" ? record.title : null;
  if (path.includes("/plans/") && planCode) {
    return {
      type: "plan",
      typeLabel: "Plán",
      id: planCode,
      label: title ? `${planCode} · ${title}` : planCode,
      href: `#/plans/${encodeURIComponent(planCode)}`,
    };
  }
  if (path.includes("/roadmaps/") && roadmapCode) {
    return {
      type: "roadmap",
      typeLabel: "Roadmapa",
      id: roadmapCode,
      label: title ? `${roadmapCode} · ${title}` : roadmapCode,
      href: `#/roadmaps/${encodeURIComponent(roadmapCode)}`,
    };
  }
  if (path.endsWith("mission-control.config.json")) {
    return {
      type: "config",
      typeLabel: "Nastavení",
      id: "config",
      label: "Nastavení Mission Control",
      href: undefined,
    };
  }
  return null;
}

/**
 * Turns changed data files into the records a person recognises: a plan by
 * its code and title, with the changed fields named in Czech. A file this
 * adapter does not know falls through to the engine's generic review.
 */
export const missionControlReviewAdapter: ReviewSurfaceAdapter = {
  id: "mission-control-v3",
  appId: "mission-control",
  contractVersion: REVIEW_SURFACE_CONTRACT_VERSION,
  adapterVersion: "1.0.0",
  supportedPathGlobs: [
    "data/mission-control/plans/**/*.yaml",
    "data/mission-control/roadmaps/**/*.yaml",
    "data/mission-control/mission-control.config.json",
  ],
  toReviewableResources(changes: readonly ReviewInputChange[]): ReviewableResource[] {
    const resources: ReviewableResource[] = [];
    for (const change of changes) {
      const path = change.technicalRefs[0]?.path ?? "";
      const before = path.endsWith(".json") ? undefined : parsed(change.baselineText);
      const after = path.endsWith(".json") ? undefined : parsed(change.draftText);
      const subject = describe(path, after ?? before);
      if (!subject) continue;
      const diff = structuralDiff(before ?? {}, after ?? {}, { maxFields: 12 });
      const fields = labelFields(diff.fields);
      const kind = change.kind === "renamed" ? "modified" : change.kind;
      resources.push({
        appId: "mission-control",
        resourceType: subject.type,
        stableResourceId: `${subject.type}:${subject.id}`,
        label: subject.label,
        ...(subject.href ? { routeTarget: { href: subject.href, label: "Otevřít" } } : {}),
        changes: [
          {
            changeId: change.changeId,
            kind,
            summary:
              kind === "created"
                ? "Nový záznam"
                : kind === "deleted"
                  ? "Smazaný záznam"
                  : `Změněno polí: ${fields.length + diff.truncated}`,
            technicalRefs: change.technicalRefs,
            fields,
          },
        ],
        fallback: { activeLevel: "resource_adapter", steps: [] },
        metadata: { typeLabel: subject.typeLabel },
      });
    }
    return resources;
  },
};
