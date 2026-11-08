import type { Priority, Status } from "../../domain/common.ts";
import { useI18n } from "../i18n.tsx";

export function StatusChip({ status }: { status: Status }) {
  const { messages } = useI18n();
  return <span className={`chip chip-status chip-${status}`}>{messages.status[status]}</span>;
}

export function PriorityChip({ priority }: { priority: Priority }) {
  const { messages } = useI18n();
  return (
    <span className={`chip chip-priority chip-${priority}`}>{messages.priority[priority]}</span>
  );
}

export function Progress({ done, total }: { done: number; total: number }) {
  const { messages } = useI18n();
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div className="progress" title={messages.progress.title(done, total)}>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${percent}%` }} />
      </div>
      <span className="progress-label">{messages.progress.label(done, total)}</span>
    </div>
  );
}
