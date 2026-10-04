/**
 * Brief-Ampel 0–100 — Recherche-Reife für Yorros Reisebüro.
 *
 * Pflicht (muss für Grün): Gruppe · Zeitraum · Budget · Start · Unterkunft ·
 * Anreise · Wünsche/Art · Ziel/Richtung · bei Flug: Gepäck.
 * Nice (darf bei Grün offen): engeres Fenster · Essen · vor Ort · Komfort · Alter · Lage.
 *
 * Rot <50 · Gelb = Pflicht noch offen · Grün = Pflicht voll (Nice optional).
 */

import type { ReiseLedger } from './types';
import { hasUserBudget, hasWhen, needsNight } from './completeness';

export type BriefZone = 'red' | 'yellow' | 'green';

export type BriefMissing = {
  key: string;
  label: string;
  points: number;
  /** Pflicht für gute Recherche vs. optionaler Feinschliff. */
  kind: 'must' | 'nice';
};

export type BriefScoreResult = {
  score: number;
  zone: BriefZone;
  missing: BriefMissing[];
  missingMust: BriefMissing[];
  missingNice: BriefMissing[];
};

/** Pflicht-Bausteine für Grün / gute Recherche. */
export const RESEARCH_MUST_KEYS = new Set([
  'adults',
  'when',
  'budget',
  'origin',
  'lodging',
  'mode',
  'wishes',
  'dest',
  'bags',
]);

/** Optional — dürfen bei Grün noch offen sein. */
export const RESEARCH_NICE_KEYS = new Set([
  'whenTight',
  'meals',
  'localMove',
  'comfort',
  'ages',
  'geo',
]);

function hasLodging(ledger: ReiseLedger): boolean {
  // Verpflegung ≠ Unterkunft — meals allein füllt lodging nicht (wie bookingBriefGaps).
  return Boolean(
    ledger.lodgingKind ||
      ledger.lodgingOpen?.value ||
      ledger.bookedStay?.value === true,
  );
}

function hasOrigin(ledger: ReiseLedger): boolean {
  if (ledger.mode?.value === 'daytrip') return true;
  if (ledger.originCities?.value?.length) return true;
  return ledger.originCity?.source === 'user' || ledger.originCity?.source === 'profile';
}

function hasMode(ledger: ReiseLedger): boolean {
  return (
    Boolean(ledger.mode && ledger.mode.value !== 'unknown') ||
    ledger.bookedFlight?.value === true ||
    ledger.bookedRail?.value === true ||
    ledger.bookedBus?.value === true ||
    Boolean(ledger.maxDriveHours)
  );
}

/** Flug ohne gebuchten Flug: Gepäck muss bekannt sein (0/0 zählt). */
function hasBagsIfNeeded(ledger: ReiseLedger): boolean {
  if (ledger.mode?.value !== 'fly') return true;
  if (ledger.bookedFlight?.value === true) return true;
  return ledger.cabinBags != null || ledger.checkedBags != null;
}

function hasTightWhen(ledger: ReiseLedger): boolean {
  if (ledger.dateStart && ledger.dateEnd) return true;
  if (ledger.dateFlex?.value === 'exact' && ledger.dateStart) return true;
  if (ledger.dateWindow && (ledger.stayNights || ledger.stayNightsMax || ledger.stayDays)) {
    return true;
  }
  if (ledger.dateMonth && ledger.stayNights) return true;
  if (ledger.arrivalFlexDays != null && hasWhen(ledger)) return true;
  return false;
}

/** Zielrichtung: Stadt/Korridor/Open-Discover/Deal — nicht nur „irgendwas“. */
function hasResearchDirection(ledger: ReiseLedger): boolean {
  const dest = (ledger.destinationHint?.value || '').trim();
  if (dest && !/^(offen|egal)$/i.test(dest)) return true;
  if (ledger.corridor?.value || ledger.anchorPoi?.value) return true;
  if (ledger.discoverIntent?.value || ledger.dealHunt?.value === true) return true;
  if (/^(offen|egal)$/i.test(dest) && (ledger.dealHunt?.value || ledger.discoverIntent?.value)) {
    return true;
  }
  if (ledger.bookedStay?.value === true && dest) return true;
  return false;
}

function hasWishes(ledger: ReiseLedger): boolean {
  return Boolean(
    ledger.mustHaves?.value?.length ||
      ledger.wishHaves?.value?.length ||
      ledger.extraWishes ||
      ledger.purpose ||
      ledger.inspiration ||
      ledger.highlightWant,
  );
}

/**
 * Gewichteter Brief-Score. Grün nur wenn alle Pflicht-Bausteine stehen
 * (Nice darf offen bleiben). Summe = 100.
 * Fast-Scope: researchFocus schrumpft Pflicht-Keys.
 */
export function computeBriefScore(ledger: ReiseLedger): BriefScoreResult {
  let score = 0;
  const missing: BriefMissing[] = [];

  let focus: import('./gapInventory').ResearchFocus = 'full';
  try {
    const { effectiveResearchFocus } = require('./gapInventory') as typeof import('./gapInventory');
    focus = effectiveResearchFocus(ledger);
  } catch {
    /* soft */
  }

  const mustForFocus = (key: string): boolean => {
    if (focus === 'full') return RESEARCH_MUST_KEYS.has(key);
    if (focus === 'flight') {
      return key === 'adults' || key === 'when' || key === 'origin' || key === 'dest' || key === 'bags';
    }
    if (focus === 'stay') {
      return key === 'adults' || key === 'when' || key === 'dest' || key === 'lodging';
    }
    if (focus === 'activity') {
      return key === 'adults' || key === 'when' || key === 'dest' || key === 'wishes';
    }
    return RESEARCH_MUST_KEYS.has(key);
  };

  const add = (ok: boolean, points: number, key: string, label: string, kind: 'must' | 'nice') => {
    const effectiveKind: 'must' | 'nice' =
      kind === 'must' && !mustForFocus(key) ? 'nice' : kind;
    // Skip scoring must-keys that are out of focus as blocking musts — still count points if filled
    if (ok) score += points;
    else if (effectiveKind === 'must' || (kind === 'nice' && RESEARCH_NICE_KEYS.has(key))) {
      missing.push({ key, label, points, kind: effectiveKind });
    } else if (kind === 'must' && !mustForFocus(key)) {
      // demoted — don't block green
    } else {
      missing.push({ key, label, points, kind: effectiveKind });
    }
  };

  add(
    ledger.adults?.source === 'user' || ledger.adults?.source === 'profile',
    12,
    'adults',
    'Gruppe',
    'must',
  );
  add(hasWhen(ledger), 10, 'when', 'Zeitraum', 'must');
  add(hasTightWhen(ledger), 6, 'whenTight', 'engeres Datum / Fenster', 'nice');
  add(hasUserBudget(ledger) || Boolean(ledger.budgetVibe), 12, 'budget', 'Budget', 'must');
  add(hasOrigin(ledger), 10, 'origin', 'Start', 'must');
  add(hasLodging(ledger) || !needsNight(ledger), 10, 'lodging', 'Unterkunft', 'must');
  add(hasMode(ledger), 8, 'mode', 'Anreise-Art', 'must');
  add(hasBagsIfNeeded(ledger), 4, 'bags', 'Gepäck', 'must');
  add(hasWishes(ledger), 8, 'wishes', 'Wünsche / Reiseart', 'must');
  add(Boolean(ledger.meals), 4, 'meals', 'Verpflegung', 'nice');
  add(
    Boolean(ledger.localMovePref || ledger.transferPref || ledger.rentalCar != null),
    4,
    'localMove',
    'Fortbewegung vor Ort',
    'nice',
  );
  add(hasResearchDirection(ledger), 6, 'dest', 'Ziel oder Suchrichtung', 'must');
  add(
    Boolean(
      ledger.flightComfort ||
        ledger.maxLayoverHours != null ||
        ledger.directFlight != null ||
        ledger.railFlex ||
        ledger.arriveBeforeHour != null,
    ),
    4,
    'comfort',
    'Komfort (Flug/Bahn)',
    'nice',
  );
  add(Boolean(ledger.travelerAges?.value?.length || ledger.bahncard), 2, 'ages', 'Alter / Bahncard', 'nice');
  add(Boolean(ledger.anchorPoi || ledger.radiusM || ledger.locationBias), 2, 'geo', 'Lage-Anker', 'nice');

  score = Math.max(0, Math.min(100, Math.round(score)));
  missing.sort((a, b) => b.points - a.points);
  const missingMust = missing.filter((m) => m.kind === 'must');
  const missingNice = missing.filter((m) => m.kind === 'nice');

  // Grün = Pflicht voll — Nice darf offen bleiben.
  let zone: BriefZone;
  if (missingMust.length === 0) zone = 'green';
  else if (score >= 50) zone = 'yellow';
  else zone = 'red';

  return { score, zone, missing, missingMust, missingNice };
}

/** Soft-Fragen die den Score heben — Nice zuerst nach Punkten, Pflicht wenn noch offen. */
export function scoreSharpenGaps(
  ledger: ReiseLedger,
  asked: string[] = [],
): Array<{ key: string; label: string; tier: 'yellow' }> {
  const { missing } = computeBriefScore(ledger);
  const askable = new Set([
    'adults',
    'mode',
    'meals',
    'localMove',
    'dest',
    'comfort',
    'ages',
    'geo',
    'whenTight',
    'bags',
  ]);
  const out: Array<{ key: string; label: string; tier: 'yellow' }> = [];
  const ordered = [
    ...missing.filter((m) => m.kind === 'must'),
    ...missing.filter((m) => m.kind === 'nice'),
  ];
  for (const m of ordered) {
    if (!askable.has(m.key)) continue;
    if (asked.includes(m.key)) continue;
    out.push({ key: m.key, label: m.label, tier: 'yellow' });
  }
  return out;
}

export function briefScoreHint(result: BriefScoreResult): string {
  const topMust = result.missingMust.slice(0, 3).map((m) => `+${m.points} ${m.label}`);
  const topNice = result.missingNice.slice(0, 2).map((m) => `+${m.points} ${m.label}`);
  if (result.zone === 'green') {
    if (!result.missingNice.length) {
      return `Brief ${result.score}% — Pflicht voll. Suche kann los.`;
    }
    return `Brief ${result.score}% — grün, Pflicht steht. Optional noch: ${topNice.join(' / ')}.`;
  }
  if (result.zone === 'yellow') {
    return `Brief ${result.score}% (gelb) — Pflicht offen: ${topMust.join(', ') || 'Rest-Pack'}.`;
  }
  return `Brief ${result.score}% (rot) — zu dünn${topMust.length ? `: ${topMust.join(', ')}` : ''}.`;
}

/** Kurzlabels für Confirm-Popup. */
export function briefMissingLines(
  result: BriefScoreResult,
  kind: 'must' | 'nice',
  max = 4,
): string[] {
  const list = kind === 'must' ? result.missingMust : result.missingNice;
  return list.slice(0, max).map((m) => m.label);
}
