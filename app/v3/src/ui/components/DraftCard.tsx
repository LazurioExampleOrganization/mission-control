import type { DraftPanelInput } from "@lazurio/repository-db";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { errorText } from "../../i18n/messages.ts";
import { ApiError, api } from "../api.ts";
import { type WordedRecord, wordDraftCard } from "../draft-wording.ts";
import { useI18n } from "../i18n.tsx";

/**
 * The Draft & Publish card. It behaves as repository-db's shared
 * `DraftPublishPanel` (the same states, actions, confirmations and the same
 * `rdb-draft-*` classes) and speaks the page's language; see
 * `draft-wording.ts`.
 */
export function DraftCard({
  subscribe,
  onChanged,
  pollIntervalMs = 60_000,
}: {
  subscribe: (onChange: () => void) => () => void;
  onChanged: () => Promise<void>;
  pollIntervalMs?: number;
}) {
  const { locale, messages } = useI18n();
  const words = messages.draft;
  const [input, setInput] = useState<DraftPanelInput | null>(null);
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "info" | "error" } | null>(null);
  // Refreshes overlap (poll, events, after an action); only the newest may
  // put its draft and revision on screen.
  const latest = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++latest.current;
    try {
      const next = await api.draft(locale);
      if (request === latest.current) setInput(next);
    } catch {
      // The last review is no longer trustworthy: its records and actions go.
      if (request === latest.current) setInput(null);
    }
  }, [locale]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), pollIntervalMs);
    const unsubscribe = subscribe(() => void refresh());
    return () => {
      clearInterval(timer);
      unsubscribe();
    };
  }, [refresh, pollIntervalMs, subscribe]);

  const card = useMemo(() => (input ? wordDraftCard(input, messages) : null), [input, messages]);

  const run = async (action: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      await onChanged();
      setMessage({ text: done, tone: "info" });
    } catch (error) {
      const code = error instanceof ApiError ? error.code : "unexpected";
      setMessage({
        text: code === "draft_changed" ? words.draftChanged : errorText(messages, code),
        tone: "error",
      });
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  if (!card?.model.visible) return null;
  const { model } = card;

  const runAction = (kind: string) => {
    if (kind === "publish") {
      void run(() => api.publish(model.revision), words.done.published);
    } else if (kind === "discard_draft") {
      if (!window.confirm(words.confirm.discardAll(model.count))) return;
      void run(() => api.discard({ kind: "draft" }, model.revision), words.done.discarded);
    } else if (kind === "finish_send") {
      void run(
        () => api.finishSend(model.pendingHead ?? ""),
        model.tone === "conflict" ? words.done.merged : words.done.sent,
      );
    } else if (kind === "pull") {
      void run(() => api.pull(), words.done.pulled);
    }
  };

  const revert = ({ record }: WordedRecord) => {
    if (!window.confirm(words.confirm.revert(record.label))) return;
    void run(
      () => api.discard({ kind: "record", path: record.technicalPath }, model.revision),
      words.done.reverted(record.label),
    );
  };

  return (
    <section
      className={`rdb-draft-card rdb-draft-${model.tone} rdb-draft-tone-${model.tone}${open ? " rdb-draft-open" : ""}`}
      aria-label={words.label}
    >
      <button
        type="button"
        className="rdb-draft-pill"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="rdb-draft-dot" aria-hidden="true" />
        <span>{card.pill}</span>
        {model.count > 0 ? <span className="rdb-draft-count">{model.count}</span> : null}
      </button>

      {open ? (
        <div className="rdb-draft-body">
          <p className="rdb-draft-headline">{card.headline}</p>
          {card.notes.map((note) => (
            <p key={note} className="rdb-draft-note">
              {note}
            </p>
          ))}
          {card.technical.length > 0 ? (
            <details className="rdb-draft-handoff">
              <summary>{words.details}</summary>
              <pre>{card.technical.join("\n\n")}</pre>
            </details>
          ) : null}
          {message ? (
            <p className={`rdb-draft-message rdb-draft-message-${message.tone}`} role="status">
              {message.text}
            </p>
          ) : null}

          {card.records.length > 0 ? (
            <ul className="rdb-draft-records">
              {card.records.map((worded) => (
                <RecordRow key={worded.record.id} worded={worded} busy={busy} onRevert={revert} />
              ))}
            </ul>
          ) : null}

          {card.actions.length > 0 ? (
            <div className="rdb-draft-actions">
              {card.actions.map((action) => (
                <span key={action.kind} className="rdb-draft-action">
                  <button
                    type="button"
                    className={action.destructive ? "rdb-draft-destructive" : undefined}
                    disabled={!action.enabled || busy}
                    onClick={() => runAction(action.kind)}
                  >
                    {action.label}
                  </button>
                  {action.reason ? (
                    <small className="rdb-draft-disabled-reason">{action.reason}</small>
                  ) : null}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function RecordRow({
  worded,
  busy,
  onRevert,
}: {
  worded: WordedRecord;
  busy: boolean;
  onRevert: (worded: WordedRecord) => void;
}) {
  const { messages } = useI18n();
  const words = messages.draft;
  const { record } = worded;
  const [technical, setTechnical] = useState(false);
  return (
    <li className={`rdb-draft-record rdb-draft-origin-${record.originKind}`}>
      <div className="rdb-draft-record-head">
        <span className="rdb-draft-chip">{worded.changeLabel}</span>
        <span className="rdb-draft-type">{record.typeLabel}</span>
        <strong className="rdb-draft-label">{record.label}</strong>
        <span className="rdb-draft-origin" title={words.origin.title}>
          {worded.originLabel}
        </span>
      </div>
      <p className="rdb-draft-summary">{record.summary}</p>
      {record.fields.length > 0 ? (
        <ul className="rdb-draft-fields">
          {record.fields.map((field) => (
            <li key={field.fieldPath}>
              <span className="rdb-draft-field-label">{field.label}</span>
              <span className="rdb-draft-before">{field.before}</span>
              <span className="rdb-draft-arrow" aria-hidden="true">
                →
              </span>
              <span className="rdb-draft-after">{field.after}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="rdb-draft-record-actions">
        {record.href ? (
          <a className="rdb-draft-open-link" href={record.href}>
            {words.open}
          </a>
        ) : null}
        {record.revertSupported ? (
          <button
            type="button"
            className="rdb-draft-revert"
            disabled={busy}
            onClick={() => onRevert(worded)}
          >
            {words.revert}
          </button>
        ) : (
          <span className="rdb-draft-revert-blocked">{worded.revertBlockedReason}</span>
        )}
        <button
          type="button"
          className="rdb-draft-technical-toggle"
          aria-expanded={technical}
          onClick={() => setTechnical((value) => !value)}
        >
          {technical ? words.hideTechnical : words.technical}
        </button>
      </div>
      {technical ? (
        <code className="rdb-draft-technical">
          {[record.technicalPath, worded.technicalReason].filter(Boolean).join("\n")}
        </code>
      ) : null}
    </li>
  );
}
