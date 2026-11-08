import { useEffect, useState } from "react";
import type { RuleIssue } from "../../domain/rules.ts";
import { api, subscribe } from "../api.ts";
import { DraftCard } from "../components/DraftCard.tsx";
import { Issues } from "../components/fields.tsx";
import { useI18n } from "../i18n.tsx";

const onAnyChange = (onChange: () => void) => subscribe(() => onChange());

/**
 * Draft & Publish: the card shows what changed and publishes it as one change
 * or returns it. The App adds the data check below it.
 */
export function DraftPage({ onChanged }: { onChanged: () => Promise<void> }) {
  const { messages } = useI18n();
  const words = messages.draftPage;
  const [issues, setIssues] = useState<RuleIssue[] | null>(null);

  useEffect(() => {
    const load = () => {
      api.check().then(setIssues, () => setIssues(null));
    };
    load();
    return subscribe(load);
  }, []);

  return (
    <section>
      <header className="page-header">
        <h1 className="page-title">{words.title}</h1>
        <p className="page-subtitle">{words.subtitle}</p>
      </header>
      <div className="draft-panel">
        <DraftCard subscribe={onAnyChange} onChanged={onChanged} />
      </div>
      <article className="panel">
        <h2>{words.check}</h2>
        {issues === null ? (
          <p className="muted">{words.checkUnavailable}</p>
        ) : issues.length === 0 ? (
          <p className="ok">{words.checkOk}</p>
        ) : (
          <Issues issues={issues} />
        )}
      </article>
    </section>
  );
}
