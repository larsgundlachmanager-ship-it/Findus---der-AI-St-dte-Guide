/**
 * Modul 5 — Tagesplan Typen (Timeline + Änderungen).
 */

export type DayPlanItemKind =
  | 'wake'
  | 'hotel'
  | 'breakfast'
  | 'checkout'
  | 'checkin'
  | 'pack'
  | 'transit'
  | 'taxi'
  | 'nav'
  | 'meal'
  | 'activity'
  | 'sunset'
  | 'todo'
  | 'buffer'
  | 'weather'
  | 'parking'
  | 'flight'
  | 'custom';

export type DayPlanItemStatus =
  | 'planned'
  | 'in_progress'
  | 'done'
  | 'skipped'
  | 'moved';

export type DayPlanItemSource =
  | 'user'
  | 'module2'
  | 'module5'
  | 'nav'
  | 'weather'
  | 'hotel'
  | 'carryover'
  | 'voice';

export type DayPlanItem = {
  id: string;
  kind: DayPlanItemKind;
  title: string;
  /** null = untimed „Punkt“ (heute noch erledigen) */
  startMs: number | null;
  endMs: number | null;
  timed: boolean;
  status: DayPlanItemStatus;
  lat?: number | null;
  lng?: number | null;
  placeName?: string | null;
  durationMin?: number | null;
  /** Minuten Puffer vor diesem Event */
  bufferMin?: number | null;
  notes?: string;
  source: DayPlanItemSource;
  /** Harte Deadline (Zug, Flug, Reservation) */
  hardDeadline?: boolean;
  /** Nicht erledigt → nächster Tag */
  carryOver?: boolean;
  /** Tatsächlicher Verlauf (Timeline-Geschichte) */
  actualStartMs?: number | null;
  actualEndMs?: number | null;
  /** Multi-Stop Reihenfolge */
  sortOrder?: number;
  meta?: Record<string, unknown>;
};

export type DayPlanChange = {
  id: string;
  atMs: number;
  summary: string;
  reason: string;
  /** User sieht blauen Badge — Findus erklärt auf Tap */
  significant: boolean;
  spoken?: boolean;
};

export type DayPlan = {
  /** YYYY-MM-DD lokal */
  dateKey: string;
  items: DayPlanItem[];
  changes: DayPlanChange[];
  unreadSignificantChangeIds: string[];
  goalSummary?: string;
  updatedAtMs: number;
};

export function dateKeyFromMs(ms: number, timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone ?? undefined,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(ms));
  } catch {
    const d = new Date(ms);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}

export function todayDateKey(): string {
  return dateKeyFromMs(Date.now());
}

export function clockLabel(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function uid(prefix = 'm5'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}
