/**
 * Reisebüro Research-Pfad: flight/access-first vs stay-first vs route-tour.
 * Yorro wählt Regionen selbst — kein User-Confirm.
 */

import type { ReiseLedger, ReiseMode } from '../types';

export type ResearchPathKind = 'flight_first' | 'stay_first' | 'route_tour';

function mustIds(ledger: ReiseLedger): string[] {
  const raw = [
    ...(ledger.mustHaves?.value ?? []),
    ...(ledger.wishHaves?.value ?? []),
  ];
  return raw.map((m) => String(m).toLowerCase());
}

function textBlob(ledger: ReiseLedger): string {
  return [
    ledger.destinationHint?.value,
    ledger.corridor?.value,
    ledger.highlightWant?.value,
    ledger.partyStyle?.value,
    ledger.spaStyle?.value,
    ledger.tripShape?.value,
    ledger.lodgingKind?.value,
    ledger.extraWishes?.value,
    ...(ledger.mustHaves?.value ?? []),
    ...(ledger.wishHaves?.value ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/** Hochspezifische Stay-Amenities → Inventory zuerst. */
export function looksLikeStayFirstBrief(ledger: ReiseLedger): boolean {
  const musts = mustIds(ledger);
  const blob = textBlob(ledger);
  const amenityHits = [
    'tennis',
    'padel',
    'paddle',
    'grill',
    'sauna',
    'spa',
    'pool',
    'pet',
    'wheelchair',
    'access',
  ].filter((k) => musts.includes(k) || blob.includes(k));
  const lodgingSpecific =
    musts.includes('ferienhaus') ||
    musts.includes('apartment') ||
    ledger.lodgingKind?.value === 'ferienhaus' ||
    ledger.lodgingKind?.value === 'apartment' ||
    /villa|ferienhaus|eigenes\s+haus|airbnb|agoda/i.test(blob);
  const countHint = /\b\d+\s*saunen?\b|\b8\s*sauna/i.test(blob);
  // Tennis+Pool / Villa+Amenities / exakte Spa-Zahl
  if (countHint) return true;
  if (lodgingSpecific && amenityHits.length >= 1) return true;
  if (amenityHits.filter((k) => k !== 'pool' && k !== 'spa').length >= 2) {
    return true;
  }
  return false;
}

export function looksLikeRouteTourBrief(ledger: ReiseLedger): boolean {
  const mode = ledger.mode?.value as ReiseMode | undefined;
  if (mode === 'hike' || mode === 'bike' || mode === 'camping') return true;
  const blob = textBlob(ledger);
  return /\b(wander|hiking|radtour|fahrrad|camper|etappe|hütte|huette)\b/i.test(
    blob,
  );
}

/**
 * Pfadwahl für Funnel — SSOT über Research-Lead (was jetzt am wichtigsten ist).
 */
export function resolveResearchPath(ledger: ReiseLedger): ResearchPathKind {
  try {
    const { researchPathFromLead } = require('./researchLead') as {
      researchPathFromLead: (l: ReiseLedger) => ResearchPathKind;
    };
    return researchPathFromLead(ledger);
  } catch {
    /* fallback below */
  }
  if (looksLikeRouteTourBrief(ledger)) return 'route_tour';
  if (
    ledger.tripShape?.value === 'cruise' ||
    ledger.tripShape?.value === 'ferry' ||
    (ledger.mustHaves?.value ?? []).includes('cruise') ||
    (ledger.mustHaves?.value ?? []).includes('ferry') ||
    /\bkreuzfahrt|cruise|fähre|faehre|ferry\b/i.test(textBlob(ledger))
  ) {
    return 'flight_first';
  }
  if (looksLikeStayFirstBrief(ledger)) return 'stay_first';
  return 'flight_first';
}

/** Prefer eco modes when mode open / explicit no-fly. */
export function preferEcoAccess(ledger: ReiseLedger): boolean {
  const mode = ledger.mode?.value as ReiseMode | undefined;
  if (mode === 'train' || mode === 'bike' || mode === 'hike') return true;
  const blob = textBlob(ledger);
  if (/\b(kein\s+flug|nicht\s+fliegen|umwelt|öko|oeko|bahn|flixbus)\b/i.test(blob)) {
    return true;
  }
  // DE inland city → Bahn zuerst
  if (
    /\b(münchen|muenchen|berlin|hamburg|köln|koeln|frankfurt|stuttgart|dresden)\b/i.test(
      blob,
    ) &&
    !/\b(flug|fliegen|mallorca|spanien|griechenland|italien)\b/i.test(blob)
  ) {
    return true;
  }
  return mode == null || mode === 'unknown' || mode === 'mix';
}

export type ConstraintHardness = 'hard' | 'nice';

/** Soft „wäre geil“ vs Hard Must — für Optimalfall→Kürzen. */
export function classifyConstraintText(text: string): ConstraintHardness {
  const t = text.toLowerCase();
  if (
    /\b(wäre\s+geil|waere\s+geil|nice\s+to\s+have|wenn\s+möglich|wenn\s+moeglich|muss\s+nicht|optional|gerne\s+auch)\b/i.test(
      t,
    )
  ) {
    return 'nice';
  }
  return 'hard';
}

/**
 * Kürzen: Nice zuerst; AI drin → Bier-in-Nähe schwächt.
 */
export function relaxConstraintsForBudget(opts: {
  hard: string[];
  nice: string[];
  hasAllInclusive: boolean;
}): { keepHard: string[]; dropNice: string[]; note: string | null } {
  const dropNice = [...opts.nice];
  let keepHard = [...opts.hard];
  let note: string | null = null;
  if (opts.hasAllInclusive) {
    const before = keepHard.length;
    keepHard = keepHard.filter(
      (h) => !/günstiges?\s*bier|guenstiges?\s*bier|cheap\s*beer|bier\s*in\s*der\s*nähe/i.test(h),
    );
    if (keepHard.length < before) {
      note = 'All Inclusive deckt Getränke — günstiges Bier in Nähe nachrangig.';
    }
  }
  return { keepHard, dropNice, note };
}

/** Stay-first: Apartment/Villa vor Hotel-Default. */
export function lodgingBiasForPath(
  path: ResearchPathKind,
  lodging: 'apartment' | 'hotel' | 'any',
): 'apartment' | 'hotel' | 'any' {
  if (path === 'stay_first' && lodging === 'any') return 'apartment';
  if (path === 'route_tour' && lodging === 'any') return 'any';
  return lodging;
}

/**
 * Pool-Reihenfolge nach Pfad:
 * stay_first → Amenity-/Villa-Tags vorne
 * route_tour → hike/bike/camping vorne
 * flight_first → unverändert
 */
export function orderPoolForResearchPath<
  T extends { tags: string[]; name?: string },
>(pool: T[], path: ResearchPathKind): T[] {
  if (path === 'flight_first' || !pool.length) return pool;
  const score = (p: T): number => {
    const tags = p.tags.map((t) => t.toLowerCase());
    const name = (p.name || '').toLowerCase();
    if (path === 'stay_first') {
      let s = 0;
      if (tags.some((t) => /spa|villa|ferien|apartment|pool|tennis|padel/.test(t))) s += 3;
      if (/villa|ferienhaus|finca|agroturismo/.test(name)) s += 2;
      if (tags.includes('party')) s -= 1;
      return s;
    }
    // route_tour
    let s = 0;
    if (tags.some((t) => /hike|bike|camping|trail|alpen|berge/.test(t))) s += 4;
    if (tags.includes('fly') && !tags.includes('bike')) s -= 1;
    return s;
  };
  return [...pool].sort((a, b) => score(b) - score(a));
}

/** Calendar/Flug-Fenster: stay_first und route_tour brauchen weniger Vorarbeit. */
export function calendarSlotBudget(
  path: ResearchPathKind,
  timedOut: boolean,
): number {
  if (timedOut) return 1;
  if (path === 'stay_first') return 2;
  if (path === 'route_tour') return 1;
  return 4;
}
