/**
 * Harte User-Pins: Datum, Budget, Personen — dürfen im Funnel nicht wegrutschen.
 */

import { offsetDateKey } from '../../utils/dateKeys';
import type { ComboWindow, ReiseLedger } from '../types';
import { arrivalFlexOf, departureFlexOf, buildFlexTravelWindows } from './presenceFlex';

/** Explizites Los-/Span-Datum ohne erlaubte Flex → Kalender darf nicht umbiegen. */
export function isDateHardPinned(ledger: ReiseLedger): boolean {
  if (!ledger.dateStart?.value && !ledger.dateEnd?.value) return false;
  if ((arrivalFlexOf(ledger) > 0 || departureFlexOf(ledger) > 0) && ledger.dateAnchor?.value === 'presence') {
    // Presence: Fenster darf nur innerhalb Flex wachsen — Basis bleibt hart
    return true;
  }
  if (arrivalFlexOf(ledger) > 0 || departureFlexOf(ledger) > 0) {
    // Explizite ±Tage: Verschieben innerhalb Flex ok, nicht frei im Monat
    return true;
  }
  if (ledger.dateFlex?.value === 'open') return false;
  if (ledger.dateFlex?.value === 'weekend' || ledger.dateFlex?.value === 'month') {
    // Monat/Wochenende ohne Tag → Kalender darf optimieren
    if (!ledger.dateStart?.value) return false;
  }
  if (ledger.dateFlex?.value === 'exact') return true;
  if (ledger.dateStart?.hardness === 'must' || ledger.dateEnd?.hardness === 'must') return true;
  if (ledger.dateAnchor?.value === 'arrive' && ledger.dateStart?.value) return true;
  if (ledger.dateAnchor?.value === 'span' && ledger.dateStart?.value && ledger.dateEnd?.value) {
    return true;
  }
  if (ledger.dateAnchor?.value === 'presence') return true;
  // Fester Tag ohne Flex-Flag (z. B. „am 16.10. los“)
  if (ledger.dateStart?.value && ledger.dateStart.source === 'user') return true;
  if (ledger.dateEnd?.value && ledger.dateEnd.source === 'user' && ledger.dateAnchor?.value === 'depart') {
    // Abreise-Termin hart; Anreise kann offen sein → nicht als checkin-pin
    return false;
  }
  return false;
}

/** Erlaubte Check-in-Tage (leer = keine Einschränkung). */
export function allowedCheckinKeys(ledger: ReiseLedger): Set<string> | null {
  if (!isDateHardPinned(ledger)) return null;
  const wins = buildFlexTravelWindows(ledger);
  if (!wins.length) {
    const start = ledger.dateStart?.value?.slice(0, 10);
    return start ? new Set([start]) : null;
  }
  return new Set(wins.map((w) => w.checkin));
}

export function pinnedAdults(ledger: ReiseLedger): number {
  const n = ledger.adults?.value;
  if (typeof n === 'number' && n >= 1 && n <= 20) return Math.floor(n);
  return 2;
}

export function pinnedBudgetEur(ledger: ReiseLedger): number | null {
  const n = ledger.budgetEur?.value;
  if (typeof n === 'number' && n > 0) return n;
  return null;
}

/**
 * Stay-/Flug-Fenster für Enrich: bei Hard-Pin nie Kalender-Deal mit anderem Datum.
 * Flex-Kandidaten nur innerhalb allowedCheckinKeys; Preferenz = Ledger-Basis.
 */
export function resolvePinnedTravelWindow(
  ledger: ReiseLedger,
  base: { checkin: string; checkout: string },
  comboWindows: ComboWindow[],
): { checkin: string; checkout: string; fromCombo: boolean } {
  const allowed = allowedCheckinKeys(ledger);
  if (!allowed || !isDateHardPinned(ledger)) {
    const best = comboWindows[0];
    if (best?.checkin && best?.checkout) {
      return { checkin: best.checkin, checkout: best.checkout, fromCombo: true };
    }
    return { ...base, fromCombo: false };
  }

  // Presence / ±Flex: nur Fenster, die Must abdecken und in allowed liegen
  const flexOk = comboWindows.filter((w) => allowed.has(w.checkin.slice(0, 10)));
  // Primär immer Ledger-Basis (User-Los), nicht günstigstes Flex-Fenster
  const baseOk = allowed.has(base.checkin.slice(0, 10));
  if (baseOk) {
    return { checkin: base.checkin, checkout: base.checkout, fromCombo: false };
  }
  if (flexOk[0]) {
    return {
      checkin: flexOk[0].checkin,
      checkout: flexOk[0].checkout,
      fromCombo: true,
    };
  }
  // Fallback: erstes erlaubtes Flex-Fenster aus Math
  const wins = buildFlexTravelWindows(ledger);
  const first = wins[0];
  if (first) {
    return { checkin: first.checkin, checkout: first.checkout, fromCombo: false };
  }
  return { ...base, fromCombo: false };
}

/** Kalender-Slots auf erlaubte Check-ins filtern (Hard-Pin). */
export function filterSlotsToHardPin<T extends { checkin: string }>(
  ledger: ReiseLedger,
  slots: T[],
): T[] {
  const allowed = allowedCheckinKeys(ledger);
  if (!allowed) return slots;
  const kept = slots.filter((s) => allowed.has(s.checkin.slice(0, 10)));
  return kept.length ? kept : slots.filter((s) => s.checkin.slice(0, 10) === ledger.dateStart?.value?.slice(0, 10));
}

/**
 * Budget-Hart: Option klar über Cap → für Ranking bestrafen / Flag.
 * scope per_person → buyIn; total → totalEur.
 */
export function budgetBreachEur(
  ledger: ReiseLedger,
  opts: { buyInEur: number | null; totalEur: number | null },
): number | null {
  const cap = pinnedBudgetEur(ledger);
  if (cap == null) return null;
  const scope = ledger.budgetScope?.value || 'per_person';
  const val =
    scope === 'total'
      ? opts.totalEur
      : opts.buyInEur ?? (opts.totalEur != null ? Math.round(opts.totalEur / pinnedAdults(ledger)) : null);
  if (val == null) return null;
  if (val <= cap) return 0;
  return Math.round(val - cap);
}

/** Synthetisches Basis-Fenster wenn nur dateStart (Los) gesetzt. */
export function syntheticPinnedCheckout(ledger: ReiseLedger, checkin: string): string {
  if (ledger.dateEnd?.value) return ledger.dateEnd.value.slice(0, 10);
  const nights =
    ledger.stayNights?.value ??
    (ledger.stayDays?.value ? Math.max(1, ledger.stayDays.value - 1) : 2);
  return offsetDateKey(nights, Date.parse(`${checkin}T12:00:00`));
}
