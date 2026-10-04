/**
 * Kalender-Spanne für Magazin-Tagesplan (Anreise … Abreise).
 * Nie nur 1 Tag bei Übernachtung, weil checkout==checkin oder days[] kollabiert war.
 */

import type { ReiseLedger } from '../types';

export function addCalendarDays(dateKey: string, days: number): string {
  const key = (dateKey || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return key;
  const d = new Date(`${key}T12:00:00`);
  if (!Number.isFinite(d.getTime())) return key;
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Inklusive Start und Ende (Check-in-Tag bis Check-out-Tag). */
export function enumerateDateKeysInclusive(startKey: string, endKey: string): string[] {
  const start = (startKey || '').slice(0, 10);
  const end = (endKey || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return start ? [start] : [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start) return [start];
  const out: string[] = [];
  let cur = start;
  for (let i = 0; i < 21; i++) {
    out.push(cur);
    if (cur >= end) break;
    cur = addCalendarDays(cur, 1);
  }
  return out;
}

function nightsFromLedger(ledger: ReiseLedger | null | undefined): number {
  if (ledger?.stayNights?.value != null && ledger.stayNights.value >= 1) {
    return Math.max(1, Math.round(ledger.stayNights.value));
  }
  if (ledger?.stayDays?.value != null && ledger.stayDays.value >= 2) {
    return Math.max(1, Math.round(ledger.stayDays.value) - 1);
  }
  return 2;
}

/**
 * Check-in / Check-out für den Tagesplan.
 * Ledger-Daten schlagen kollabierte days[] (ein Tag).
 */
export function resolveTripDaySpan(opts: {
  checkin?: string | null;
  checkout?: string | null;
  ledger?: ReiseLedger | null;
  comboCheckin?: string | null;
  comboCheckout?: string | null;
}): { checkin: string; checkout: string } {
  const ledger = opts.ledger ?? null;
  const ledStart = ledger?.dateStart?.value?.slice(0, 10) || null;
  const ledEnd = ledger?.dateEnd?.value?.slice(0, 10) || null;

  let checkin = (ledStart || opts.checkin || opts.comboCheckin || '').slice(0, 10);
  let checkout = (ledEnd || opts.checkout || opts.comboCheckout || '').slice(0, 10);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkin)) {
    checkin = (opts.checkin || opts.comboCheckin || '').slice(0, 10);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkout)) {
    checkout = (opts.checkout || opts.comboCheckout || checkin).slice(0, 10);
  }

  if (ledger?.mode?.value === 'daytrip' && /^\d{4}-\d{2}-\d{2}$/.test(checkin)) {
    return { checkin, checkout: checkin };
  }

  // Volle Ledger-Spanne immer bevorzugen, wenn länger als übergebene Keys
  if (
    ledStart &&
    ledEnd &&
    ledEnd > ledStart &&
    /^\d{4}-\d{2}-\d{2}$/.test(ledStart) &&
    /^\d{4}-\d{2}-\d{2}$/.test(ledEnd)
  ) {
    const passedCollapsed = !checkout || checkout <= checkin;
    const passedShorter = checkout && checkout < ledEnd && checkin === ledStart;
    if (passedCollapsed || passedShorter || !opts.checkin) {
      checkin = ledStart;
      checkout = ledEnd;
    }
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(checkin) && (!checkout || checkout <= checkin)) {
    checkout = addCalendarDays(checkin, nightsFromLedger(ledger));
  }

  return {
    checkin: checkin || 'tag-1',
    checkout: checkout || checkin || 'tag-1',
  };
}
