import type { Priority, Status } from "../../domain/common.ts";
import { PRIORITY_LABELS, STATUS_LABELS } from "../labels.ts";

export function StatusChip({ status }: { status: Status }) {
  return <span className={`chip chip-status chip-${status}`}>{STATUS_LABELS[status]}</span>;
}

export function PriorityChip({ priority }: { priority: Priority }) {
  return <span className={`chip chip-priority chip-${priority}`}>{PRIORITY_LABELS[priority]}</span>;
}

export function Progress({ done, total }: { done: number; total: number }) {
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div className="progress" title={`${done} z ${total} kroků hotovo`}>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${percent}%` }} />
      </div>
      <span className="progress-label">
        {done}/{total} kroků
      </span>
    </div>
  );
}
