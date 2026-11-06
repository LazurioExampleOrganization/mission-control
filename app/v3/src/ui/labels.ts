import type { Priority, Status } from "../domain/common.ts";

export const STATUS_LABELS: Record<Status, string> = {
  shaping: "Tvarování",
  ready: "Připraveno",
  in_progress: "Rozpracováno",
  review: "Kontrola",
  blocked: "Blokováno",
  done: "Hotovo",
  archived: "Archiv",
};

export const PRIORITY_LABELS: Record<Priority, string> = {
  urgent: "Naléhavá",
  high: "Vysoká",
  medium: "Střední",
  low: "Nízká",
};

/** `2026-Q2` → `Q2 2026`, `2026-03` → `3/2026`. */
export function periodLabel(value: string): string {
  const quarter = /^([0-9]{4})-(Q[1-4])$/.exec(value);
  if (quarter) return `${quarter[2]} ${quarter[1]}`;
  const month = /^([0-9]{4})-([0-9]{2})$/.exec(value);
  if (month) return `${Number(month[2])}/${month[1]}`;
  return value;
}
