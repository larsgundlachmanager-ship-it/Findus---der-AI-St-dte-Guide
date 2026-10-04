/**
 * Hochzeit mit Ort+Datum → Timeline-Stop (soft).
 */

export function ensureWeddingTimelineStop(ledger: {
  purpose?: { value?: string } | null;
  highlightWant?: { value?: string } | null;
  destinationHint?: { value?: string } | null;
  dateStart?: { value?: string } | null;
}): boolean {
  const blob = `${ledger.purpose?.value || ''} ${ledger.highlightWant?.value || ''}`;
  if (!/hochzeit|trauung/i.test(blob)) return false;
  const dest = ledger.destinationHint?.value?.trim();
  const day = ledger.dateStart?.value?.trim();
  if (!dest || !day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  try {
    const { upsertFutureStopSafe } = require('../module2/timeline/planNowGuard') as {
      upsertFutureStopSafe: (s: {
        id: string;
        title: string;
        plannedStartMs: number;
        plannedEndMs: number;
        bufferMin: number;
        transport: string;
        kind: string;
        emoji: string;
        notes?: string;
        planPriority?: number;
        userFixedTime?: boolean;
      }) => void;
    };
    const ms = Date.parse(`${day}T16:00:00`);
    if (!Number.isFinite(ms)) return false;
    upsertFutureStopSafe({
      id: `wedding_${day}_${dest.toLowerCase().replace(/\s+/g, '_').slice(0, 24)}`,
      title: `Hochzeit · ${dest}`.slice(0, 48),
      plannedStartMs: ms,
      plannedEndMs: ms + 4 * 3600_000,
      bufferMin: 30,
      transport: 'walk',
      kind: 'stop',
      emoji: '💒',
      notes: 'Aus Reisebüro-Briefing',
      planPriority: 2,
      userFixedTime: true,
    });
    return true;
  } catch {
    return false;
  }
}
