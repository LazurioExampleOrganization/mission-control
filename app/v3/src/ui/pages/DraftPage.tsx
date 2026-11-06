import { DraftPublishPanel, type DraftPublishPanelApi } from "@lazurio/repository-db/ui";
import { useEffect, useState } from "react";
import type { RuleIssue } from "../../domain/rules.ts";
import { api, subscribe } from "../api.ts";

/**
 * Draft & Publish: the shared card of repository-db shows what changed,
 * publishes it as one change or returns it. The App adds only the data check.
 */
export function DraftPage({ onChanged }: { onChanged: () => Promise<void> }) {
  const [issues, setIssues] = useState<RuleIssue[] | null>(null);

  useEffect(() => {
    const load = () => {
      api.check().then(setIssues, () => setIssues(null));
    };
    load();
    return subscribe(load);
  }, []);

  const panelApi: DraftPublishPanelApi = {
    loadReview: () => api.draft(),
    publish: async (expectedRevision) => {
      await api.publish(expectedRevision);
      await onChanged();
    },
    discard: async (scope, expectedRevision) => {
      await api.discard(scope, expectedRevision);
      await onChanged();
    },
    finishSend: async (expectedHead) => {
      await api.finishSend(expectedHead ?? "");
      await onChanged();
    },
    pull: async () => {
      await api.pull();
      await onChanged();
    },
  };

  return (
    <section>
      <header className="page-header">
        <h1 className="page-title">Koncept a publikování</h1>
        <p className="page-subtitle">
          Uložené úpravy jsou koncept. Publikováním je jedním krokem odešlete do datového repozitáře
          Organizace, kde je uvidí ostatní.
        </p>
      </header>
      <div className="draft-panel">
        <DraftPublishPanel
          api={panelApi}
          pollIntervalMs={60_000}
          subscribe={(onChange) => subscribe(() => onChange())}
        />
      </div>
      <article className="panel">
        <h2>Kontrola dat</h2>
        {issues === null ? (
          <p className="muted">Kontrolu teď nejde spustit.</p>
        ) : issues.length === 0 ? (
          <p className="ok">Všechny záznamy odpovídají schématům a pravidlům.</p>
        ) : (
          <ul className="issues">
            {issues.map((issue) => (
              <li key={`${issue.record}:${issue.message}`}>
                <code>{issue.record}</code> {issue.message}
              </li>
            ))}
          </ul>
        )}
      </article>
    </section>
  );
}
