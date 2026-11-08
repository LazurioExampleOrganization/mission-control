import {
  type DraftPanelAction,
  type DraftPanelCapabilities,
  type DraftPanelInput,
  type DraftPanelModel,
  type DraftPanelRecord,
  deriveDraftPanel,
} from "@lazurio/repository-db";
import type { Messages } from "../i18n/messages.ts";

/**
 * The Draft & Publish card in the page's language.
 *
 * repository-db decides what the card offers (`deriveDraftPanel`: the state,
 * the count, which actions are enabled, which record may be returned); this
 * module only words that decision, from the structure of the model and never
 * from its Czech sentences. Its Czech wording is the shared card's own, which
 * `tests/draft-card.test.ts` holds equal. Texts the engine writes itself (a
 * conflict's message and hand-off, refused paths) are technical evidence,
 * shown as such and never as the headline.
 */

/** What Mission Control's API implements; the rest is shown as unavailable. */
export const MISSION_CONTROL_CAPABILITIES: Required<DraftPanelCapabilities> = {
  finishSend: true,
  pull: true,
  abortConflict: false,
  markConflictResolved: false,
};

export interface WordedAction {
  kind: DraftPanelAction["kind"];
  label: string;
  enabled: boolean;
  reason?: string;
  destructive: boolean;
}

export interface WordedRecord {
  record: DraftPanelRecord;
  changeLabel: string;
  originLabel: string;
  revertBlockedReason?: string;
  /** The engine's own reason a record cannot be returned, for the technical detail. */
  technicalReason?: string;
}

export interface WordedCard {
  model: DraftPanelModel;
  pill: string;
  headline: string;
  notes: string[];
  /** Engine texts behind the state: a conflict, a refused pull, a blocked publish. */
  technical: string[];
  records: WordedRecord[];
  actions: WordedAction[];
}

const unsent = (input: DraftPanelInput) =>
  input.status?.state === "committed_not_pushed" || (input.status?.ahead ?? 0) > 0;

function actionReason(
  action: DraftPanelAction,
  model: DraftPanelModel,
  input: DraftPanelInput,
  capabilities: Required<DraftPanelCapabilities>,
  messages: Messages,
): string {
  const reason = messages.draft.reason;
  const blocking = input.publishReadiness?.references.filter((entry) => entry.blocking) ?? [];
  switch (action.kind) {
    case "publish":
      if (model.tone === "conflict") return reason.resolveConflictFirst;
      if (blocking.length > 0) {
        return blocking[0]?.kind === "conflict"
          ? reason.resolveConflictFirst
          : reason.publishBlocked;
      }
      break;
    case "discard_draft":
      if (model.tone === "sending") return reason.alreadySaved;
      if (unsent(input)) return reason.finishSendFirst;
      break;
    case "finish_send":
      if (!capabilities.finishSend) return reason.unsupported;
      if (!model.pendingHead) return reason.pendingUnknown;
      break;
    case "pull":
      if (!capabilities.pull) return reason.unsupported;
      if (input.pullBlocked) return reason.pullBlocked;
      break;
    default:
      break;
  }
  return reason.unsupported;
}

function headline(model: DraftPanelModel, messages: Messages): string {
  const words = messages.draft.headline;
  switch (model.tone) {
    case "draft":
      return words.draft(model.count);
    case "sending":
      return words.sending(model.count);
    default:
      return words[model.tone];
  }
}

export function wordDraftCard(
  input: DraftPanelInput,
  messages: Messages,
  capabilities: Required<DraftPanelCapabilities> = MISSION_CONTROL_CAPABILITIES,
): WordedCard {
  const model = deriveDraftPanel(input, capabilities);
  const words = messages.draft;

  const notes: string[] = [];
  if (model.tone === "draft") notes.push(words.wholeDraft);
  if (model.tone === "conflict" && model.waitingRecordCount > model.count) {
    notes.push(words.waitingForConflict(model.waitingRecordCount - model.count));
  }
  if (input.draftOwner?.actor) notes.push(words.owner(input.draftOwner.actor));

  const technical: string[] = [];
  if (!input.status && input.unavailableReason) technical.push(input.unavailableReason);
  if (input.conflict?.message) technical.push(input.conflict.message);
  if (input.conflict?.handoff) technical.push(input.conflict.handoff);
  if (input.conflict?.paths?.length) technical.push(input.conflict.paths.join("\n"));
  if (input.pullBlocked) {
    technical.push([input.pullBlocked.message, ...input.pullBlocked.paths].join("\n"));
  }
  for (const reference of input.publishReadiness?.references ?? []) {
    if (reference.blocking) technical.push(reference.message);
  }

  const records = model.records.map((record, index): WordedRecord => {
    const source = input.records?.[index];
    const kinds = [...new Set(source?.resource.changes.map((change) => change.kind) ?? [])];
    const kind = kinds.length === 1 ? (kinds[0] ?? "unknown") : "modified";
    const worded: WordedRecord = {
      record,
      changeLabel: words.change[kind as keyof typeof words.change] ?? words.change.unknown,
      originLabel: words.origin[record.originKind],
    };
    if (!record.revertSupported) {
      if (model.tone === "conflict") worded.revertBlockedReason = words.revertBlocked.conflict;
      else if (unsent(input)) worded.revertBlockedReason = words.revertBlocked.sending;
      else {
        worded.revertBlockedReason = words.revertBlocked.other;
        if (record.revertBlockedReason) worded.technicalReason = record.revertBlockedReason;
      }
    }
    return worded;
  });

  const actions = model.actions.map((action): WordedAction => {
    const label =
      action.kind === "finish_send" && model.tone === "conflict"
        ? words.action.retry_send
        : action.kind === "pull" && model.tone === "remote"
          ? words.action.pull_remote
          : words.action[action.kind];
    return {
      kind: action.kind,
      label,
      enabled: action.enabled,
      destructive: action.destructive === true,
      ...(action.enabled
        ? {}
        : { reason: actionReason(action, model, input, capabilities, messages) }),
    };
  });

  return {
    model,
    pill: words.pill[model.tone],
    headline: headline(model, messages),
    notes,
    technical,
    records,
    actions,
  };
}
