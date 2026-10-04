/**
 * Teil-Inventar / Lücken-Flow — SSOT für gap_fill vs full_discover.
 * Yorro sucht nur, was noch fehlt; schon Gebuchtes nicht nochmal.
 * Fast-Scope: researchFocus flight|stay|activity schrumpft Brief + Live-Suche.
 */

import type { ReiseLedger } from './types';

export type InventoryMode = 'full_discover' | 'gap_fill' | 'add_on';

/** Schnell-Recherche: nur eine Spur — ohne Full-Trip-Pflicht. */
export type ResearchFocus = 'full' | 'flight' | 'stay' | 'activity';

export type BookedActivity = {
  name: string;
  dayHint?: string | null;
};

export function needsNightStay(ledger: ReiseLedger): boolean {
  return ledger.mode?.value !== 'daytrip' && ledger.tripShape?.value !== 'cruise';
}

/**
 * Struktur-Heuristik: nur Flug / nur Hotel / nur Aktivitäten.
 * Keine Orts-Hardcodes — Wortlaut frei.
 */
export function detectResearchFocus(text: string): ResearchFocus | null {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (t.length < 6) return null;

  const fullTrip =
    /\b(flug\s*\+|flug.{0,24}hotel|hotel.{0,24}flug|komplett|paket|pauschal|alles\s+dazu|full\s*trip|reise\s+planen|plane\s+mir)\b/iu.test(
      t,
    );
  if (fullTrip) return null;

  const activityOnly =
    /\b(nur\s+(?:noch\s+)?(?:die\s+|den\s+)?(?:aktivit[aä]ten|ausfl[uü]ge|events?|tickets?|programm|erlebnisse)|nur\s+ausfl[uü]ge|nur\s+events?|aktivit[aä]ten\s+raussuchen|ausfl[uü]ge\s+suchen)\b/iu.test(
      t,
    ) ||
    (/\b(aktivit[aä]ten|ausfl[uü]ge|events?|tickets?)\b/iu.test(t) &&
      /\b(nur|raussuchen|suche|brauch)\b/iu.test(t) &&
      !/\b(flug|hotel|unterkunft)\b/iu.test(t));
  if (activityOnly) return 'activity';

  const flightOnly =
    /\b(nur\s+(?:noch\s+)?(?:den\s+|die\s+)?flug|nur\s+flüge|nur\s+fluege|nur\s+flights?|flüge?\s+raussuchen|flug\s+raussuchen|such(?:e|t)?\s+mir\s+(?:einen?\s+)?flug|brauche?\s+(?:einen?\s+)?flieger|nur\s+(?:noch\s+)?(?:einen\s+)?flieger)\b/iu.test(
      t,
    ) ||
    (/\b(flug|flüge|fluege|flieger)\b/iu.test(t) &&
      /\b(nur|raussuchen|suche|such\s+mir|günstig(?:e|en)?\s+flüge)\b/iu.test(t) &&
      !/\b(hotel|unterkunft|apartment|ferienhaus|mietwagen)\b/iu.test(t) &&
      !/\b(urlaub|kurztrip|städtetrip|staedtetrip|wochenende\s+weg)\b/iu.test(t));
  if (flightOnly) return 'flight';
  // Solo A→B (Modul-2 / Fast-Scope): von…nach… ohne Hotel-Rahmen
  try {
    const { isSoloFlightAbSearch } = require('../services/flights/flightTripIntent') as {
      isSoloFlightAbSearch: (s: string) => boolean;
    };
    if (isSoloFlightAbSearch(t)) return 'flight';
  } catch {
    /* soft */
  }

  const stayOnly =
    /\b(nur\s+(?:noch\s+)?(?:ein\s+|das\s+)?hotel|nur\s+unterkunft|nur\s+hotels?|nur\s+apartment|hotel\s+raussuchen|brauche?\s+nur\s+(?:noch\s+)?(?:ein\s+)?hotel)\b/iu.test(
      t,
    ) ||
    (/\b(hotel|unterkunft|apartment)\b/iu.test(t) &&
      /\b(nur|raussuchen)\b/iu.test(t) &&
      !/\b(flug|flüge|fluege)\b/iu.test(t));
  if (stayOnly) return 'stay';

  return null;
}

/** Slot oder Ableitung aus booked/need und Text. */
export function effectiveResearchFocus(ledger: ReiseLedger): ResearchFocus {
  const slotted = ledger.researchFocus?.value;
  if (slotted === 'flight' || slotted === 'stay' || slotted === 'activity' || slotted === 'full') {
    return slotted;
  }
  // Gap-Fill-Heuristik: nur Flug fehlt / nur Stay fehlt
  if (
    ledger.bookedStay?.value === true &&
    ledger.bookedFlight?.value === false &&
    !ledger.needCar?.value
  ) {
    return 'flight';
  }
  if (
    ledger.bookedFlight?.value === true &&
    ledger.bookedStay?.value === false &&
    needsNightStay(ledger)
  ) {
    return 'stay';
  }
  if (
    (ledger.bookedActivities?.value?.length ?? 0) > 0 &&
    ledger.bookedStay?.value === true &&
    ledger.bookedFlight?.value === true
  ) {
    return 'activity';
  }
  return 'full';
}

/** Ableitung: hat der User schon Teile, und fehlen noch welche? */
export function deriveInventoryMode(ledger: ReiseLedger): InventoryMode {
  const focus = effectiveResearchFocus(ledger);
  if (focus === 'flight' || focus === 'stay' || focus === 'activity') {
    return 'gap_fill';
  }

  const anyBooked =
    ledger.bookedStay?.value === true ||
    ledger.bookedFlight?.value === true ||
    ledger.bookedTransfer?.value === true ||
    ledger.bookedRail?.value === true ||
    ledger.bookedBus?.value === true ||
    ledger.bookedCar?.value === true ||
    (ledger.bookedActivities?.value?.length ?? 0) > 0;

  const unclearAnreise =
    ledger.bookedStay?.value === true &&
    ledger.bookedFlight == null &&
    ledger.bookedRail == null &&
    ledger.bookedBus == null &&
    !ledger.mode;
  const unclearStay =
    ledger.bookedFlight?.value === true &&
    ledger.bookedStay == null &&
    needsNightStay(ledger);

  const anyNeed =
    ledger.bookedStay?.value === false ||
    ledger.bookedFlight?.value === false ||
    ledger.bookedRail?.value === false ||
    ledger.needCar?.value === true ||
    unclearAnreise ||
    unclearStay ||
    (ledger.rentalCar?.value === true && ledger.bookedCar?.value !== true);

  if (anyBooked && anyNeed) return 'gap_fill';
  if (anyBooked && !anyNeed) return 'add_on';
  return 'full_discover';
}

export function searchFlightLive(ledger: ReiseLedger): boolean {
  const focus = effectiveResearchFocus(ledger);
  if (focus === 'stay' || focus === 'activity') return false;
  return ledger.bookedFlight?.value !== true;
}

export function searchStayLive(ledger: ReiseLedger): boolean {
  const focus = effectiveResearchFocus(ledger);
  if (focus === 'flight' || focus === 'activity') return false;
  if (!needsNightStay(ledger)) return false;
  return ledger.bookedStay?.value !== true;
}

/** Activity-Focus: Stay/Flug skippen — Events/Wishes priorisieren. */
export function searchActivityOnly(ledger: ReiseLedger): boolean {
  return effectiveResearchFocus(ledger) === 'activity';
}

export function searchRailLive(ledger: ReiseLedger): boolean {
  if (ledger.bookedRail?.value === true) return false;
  if (ledger.mode?.value === 'train') return true;
  if (ledger.bookedRail?.value === false) return true;
  return false;
}

export function searchBusLive(ledger: ReiseLedger): boolean {
  if (ledger.bookedBus?.value === true) return false;
  if (ledger.mode?.value === 'bus') return true;
  if (ledger.bookedBus?.value === false) return true;
  return false;
}

export function searchCarLive(ledger: ReiseLedger): boolean {
  if (ledger.bookedCar?.value === true) return false;
  if (ledger.needCar?.value === true) return true;
  if (ledger.rentalCar?.value === true) return true;
  if (ledger.localMovePref?.value === 'rental') return true;
  if (ledger.transferPref?.value === 'rental') return true;
  return false;
}

export function inventoryGapLabels(ledger: ReiseLedger): string[] {
  const gaps: string[] = [];
  if (ledger.bookedFlight?.value === false || (ledger.bookedStay?.value === true && ledger.bookedFlight == null && ledger.mode?.value === 'fly')) {
    gaps.push('Flug');
  }
  if (searchFlightLive(ledger) && ledger.bookedStay?.value === true && ledger.mode?.value === 'fly') {
    if (!gaps.includes('Flug')) gaps.push('Flug');
  }
  if (ledger.bookedStay?.value === false || (ledger.bookedFlight?.value === true && ledger.bookedStay == null && needsNightStay(ledger))) {
    gaps.push('Unterkunft');
  }
  if (searchStayLive(ledger) && ledger.bookedFlight?.value === true) {
    if (!gaps.includes('Unterkunft')) gaps.push('Unterkunft');
  }
  if (searchRailLive(ledger) || ledger.bookedRail?.value === false) {
    if (!gaps.includes('Bahn')) gaps.push('Bahn');
  }
  if (searchBusLive(ledger) || ledger.bookedBus?.value === false) {
    if (!gaps.includes('Fernbus')) gaps.push('Fernbus');
  }
  if (searchCarLive(ledger)) {
    if (!gaps.includes('Mietwagen')) gaps.push('Mietwagen');
  }
  if (ledger.bookedTransfer?.value === false) {
    gaps.push('Transfer');
  }
  return gaps;
}

export function inventoryHaveLabels(ledger: ReiseLedger): string[] {
  const have: string[] = [];
  if (ledger.bookedFlight?.value === true) have.push('Flug');
  if (ledger.bookedStay?.value === true) have.push('Unterkunft');
  if (ledger.bookedRail?.value === true) have.push('Bahn');
  if (ledger.bookedBus?.value === true) have.push('Fernbus');
  if (ledger.bookedCar?.value === true) have.push('Mietwagen');
  if (ledger.bookedTransfer?.value === true) have.push('Transfer');
  for (const a of ledger.bookedActivities?.value ?? []) {
    if (a?.name) have.push(a.name.slice(0, 28));
  }
  return have;
}

/** Magazin-Mic: nachträglich Lücke — kein neuer Full-Brief. */
export function looksLikeGapAddOn(text: string): boolean {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (t.length < 8) return false;
  return (
    /\b(noch|brauch(?:e|en)?|fehlt|suche|raussuchen).{0,28}(mietwagen|leihwagen|flug|flüge|hotel|unterkunft|transfer|bahn|zug)\b/iu.test(
      t,
    ) ||
    /\b(mietwagen|leihwagen|flug|hotel|transfer).{0,20}(noch|fehlt|brauchen)\b/iu.test(t) ||
    /\bnur\s+(?:noch\s+)?(?:einen?\s+)?(mietwagen|flug|hotel)\b/iu.test(t)
  );
}
