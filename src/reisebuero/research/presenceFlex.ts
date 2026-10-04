/**
 * Feste Anwesenheit vs. flexible An-/Abreise — Kandidatenfenster für Kalender/Stay.
 * Stadt-agnostisch, reine Datums-Math.
 */

import { offsetDateKey } from '../../utils/dateKeys';
import type { ReiseLedger } from '../types';

export type FlexTravelWindow = {
  checkin: string;
  checkout: string;
  label: string;
  /** Tage früher als Must-Start (0 = pünktlich). */
  earlyDays: number;
  /** Tage länger als Must-Ende (0 = pünktlich). */
  lateDays: number;
  /** Gesamtes Fenster verschoben (gleiche Länge). */
  shiftDays: number;
};

function nightsBetween(start: string, end: string): number {
  const a = Date.parse(`${start}T12:00:00`);
  const b = Date.parse(`${end}T12:00:00`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 1;
  return Math.max(1, Math.round((b - a) / 86_400_000));
}

/** Hard-Anwesenheit: User muss an diesen Tagen vor Ort sein. */
export function resolvePresenceBounds(ledger: ReiseLedger): {
  start: string;
  end: string;
} | null {
  const start = ledger.dateStart?.value?.slice(0, 10) || null;
  const end = ledger.dateEnd?.value?.slice(0, 10) || start;
  if (!start) return null;
  if (ledger.dateAnchor?.value === 'presence') {
    return { start, end: end || start };
  }
  // „must“ auf beiden Enden + exact span ≈ Anwesenheit
  if (
    ledger.dateAnchor?.value === 'span' &&
    ledger.dateStart?.hardness === 'must' &&
    ledger.dateEnd?.hardness === 'must'
  ) {
    return { start, end: end || start };
  }
  return null;
}

export function arrivalFlexOf(ledger: ReiseLedger): number {
  const n = ledger.arrivalFlexDays?.value;
  if (typeof n === 'number' && n >= 0) return Math.min(14, Math.floor(n));
  return 0;
}

export function departureFlexOf(ledger: ReiseLedger): number {
  const n = ledger.departureFlexDays?.value;
  if (typeof n === 'number' && n >= 0) return Math.min(14, Math.floor(n));
  // Fallback: gleiche Flex-Angabe gilt oft für beide Seiten („±1 Tag“)
  if (arrivalFlexOf(ledger) > 0 && ledger.dateAnchor?.value === 'presence') {
    return arrivalFlexOf(ledger);
  }
  return 0;
}

/**
 * Kandidaten: Anwesenheit abdecken (früher an / länger bleiben)
 * oder bei normalem Span das Fenster um ±Flex verschieben.
 */
export function buildFlexTravelWindows(ledger: ReiseLedger): FlexTravelWindow[] {
  const start = ledger.dateStart?.value?.slice(0, 10);
  if (!start) return [];
  const endRaw = ledger.dateEnd?.value?.slice(0, 10);
  const end =
    endRaw ||
    (() => {
      const nights =
        ledger.stayNights?.value ??
        (ledger.stayDays?.value ? Math.max(1, ledger.stayDays.value - 1) : 2);
      return offsetDateKey(nights, Date.parse(`${start}T12:00:00`));
    })();
  const arriveFlex = arrivalFlexOf(ledger);
  const departFlex = departureFlexOf(ledger);
  const presence = resolvePresenceBounds(ledger);
  const out: FlexTravelWindow[] = [];
  const seen = new Set<string>();

  const push = (w: FlexTravelWindow) => {
    const key = `${w.checkin}:${w.checkout}`;
    if (seen.has(key)) return;
    if (w.checkout <= w.checkin) return;
    seen.add(key);
    out.push(w);
  };

  if (presence) {
    const pStart = presence.start;
    const pEnd = presence.end;
    const aFlex = Math.max(arriveFlex, 0);
    const dFlex = Math.max(departFlex, 0);
    for (let early = 0; early <= aFlex; early++) {
      for (let late = 0; late <= dFlex; late++) {
        const checkin =
          early === 0 ? pStart : offsetDateKey(-early, Date.parse(`${pStart}T12:00:00`));
        const checkout =
          late === 0 ? pEnd : offsetDateKey(late, Date.parse(`${pEnd}T12:00:00`));
        const bits: string[] = [];
        if (early > 0) bits.push(`${early}d früher`);
        if (late > 0) bits.push(`${late}d länger`);
        push({
          checkin,
          checkout,
          label: bits.length ? `Da ${pStart}→${pEnd} · ${bits.join(', ')}` : `Da ${pStart}→${pEnd}`,
          earlyDays: early,
          lateDays: late,
          shiftDays: 0,
        });
      }
    }
    return out.sort(
      (a, b) => a.earlyDays + a.lateDays - (b.earlyDays + b.lateDays) || a.checkin.localeCompare(b.checkin),
    );
  }

  // Span/Arrive: Fenster gleicher Länge um ±arrivalFlex verschieben (billigere Flüge)
  const flex = Math.max(arriveFlex, departFlex, 0);
  if (flex <= 0) {
    push({
      checkin: start,
      checkout: end,
      label: `Fix ${start}`,
      earlyDays: 0,
      lateDays: 0,
      shiftDays: 0,
    });
    return out;
  }
  for (let shift = -flex; shift <= flex; shift++) {
    const checkin =
      shift === 0 ? start : offsetDateKey(shift, Date.parse(`${start}T12:00:00`));
    const checkout =
      shift === 0 ? end : offsetDateKey(shift, Date.parse(`${end}T12:00:00`));
    push({
      checkin,
      checkout,
      label:
        shift === 0
          ? `Fix ${start}`
          : shift < 0
            ? `${Math.abs(shift)} Tag${Math.abs(shift) === 1 ? '' : 'e'} früher`
            : `${shift} Tag${shift === 1 ? '' : 'e'} später`,
      earlyDays: shift < 0 ? -shift : 0,
      lateDays: shift > 0 ? shift : 0,
      shiftDays: shift,
    });
  }
  return out;
}

/** Basis-Stay-Fenster (ohne Flex-Kandidaten). */
export function baseStayWindow(ledger: ReiseLedger): { checkin: string; checkout: string } | null {
  const start = ledger.dateStart?.value?.slice(0, 10);
  if (!start) return null;
  const end = ledger.dateEnd?.value?.slice(0, 10);
  if (end) return { checkin: start, checkout: end };
  const nights = ledger.stayNights?.value ?? Math.max(1, (ledger.stayDays?.value ?? 3) - 1);
  return {
    checkin: start,
    checkout: offsetDateKey(nights, Date.parse(`${start}T12:00:00`)),
  };
}

export function nightsForLedgerWindow(ledger: ReiseLedger): number {
  const w = baseStayWindow(ledger);
  if (!w) return nightsBetween(
    ledger.dateStart?.value || '2026-01-01',
    ledger.dateEnd?.value || '2026-01-03',
  );
  return nightsBetween(w.checkin, w.checkout);
}
