/**
 * Research-Strategie: offene Entdeckung vs. klarer Orts-Vergleich.
 * Struktur-Blaupause — keine Speech-Scripts, keine Orts-Wortwahl-Lehre.
 *
 * open_discover: erst wo geht’s überhaupt → Flüge → Stays → ~4 Pakete → Extras hart.
 * constrained_compare: Event/Anker legt Städte schon fest → Flug+Stay parallel → Gesamtpaket-Vergleich → Extras.
 */

import type { ReiseLedger } from '../types';
import type { SeedPlace } from './candidates';
import { SEED_PLACES } from './candidates';

export type ResearchStrategy = 'open_discover' | 'constrained_compare';

export type ConstrainedComparePlan = {
  strategy: ResearchStrategy;
  /** Event-/Anker-Familie (abstrakt). */
  family: string | null;
  /** Venue-Städte als Seed-Geografie (Inventar, kein Dialog). */
  seeds: SeedPlace[];
  /** Theater-/Log-Hints (Struktur). */
  briefHints: string[];
};

function blob(ledger: ReiseLedger): string {
  return [
    ledger.destinationHint?.value,
    ledger.corridor?.value,
    ledger.highlightWant?.value,
    ledger.purpose?.value,
    ledger.extraWishes?.value,
    ledger.inspiration?.value,
    ...(ledger.intentNotes?.value ?? []),
    ...(ledger.mustActivities?.value ?? []),
    ...(ledger.mustHaves?.value ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/**
 * Venue-Inventar je Event-Familie.
 * Fakten für Research-Seeds — nie als Pflicht-Wortlaut in Speech.
 */
const EVENT_VENUE_IDS: Record<string, string[]> = {
  // Europa-Grand-Slams: London + Paris. Madrid = großes Masters (häufige User-Verwechslung).
  grand_slam_europe: ['london', 'paris', 'madrid'],
  grand_slam: ['london', 'paris', 'madrid'],
  wimbledon: ['london'],
  roland_garros: ['paris'],
  madrid_open: ['madrid'],
  oktoberfest: ['muenchen'],
  // Fallback-IDs müssen in SEED_PLACES liegen oder unten ergänzt werden
};

/** Extra-Seeds für Event-Vergleiche (nicht in Basis-SEED_PLACES). */
export const EVENT_COMPARE_EXTRA_SEEDS: readonly SeedPlace[] = [
  {
    id: 'london',
    name: 'London',
    lat: 51.5074,
    lng: -0.1278,
    tags: ['city', 'fly', 'train', 'tennis', 'event', 'grand_slam'],
    wiki: 'London',
    iata: 'LHR',
  },
  {
    id: 'paris',
    name: 'Paris',
    lat: 48.8566,
    lng: 2.3522,
    tags: ['city', 'fly', 'train', 'tennis', 'event', 'grand_slam'],
    wiki: 'Paris',
    iata: 'CDG',
  },
  {
    id: 'madrid',
    name: 'Madrid',
    lat: 40.4168,
    lng: -3.7038,
    tags: ['city', 'fly', 'tennis', 'event', 'warm'],
    wiki: 'Madrid',
    iata: 'MAD',
  },
  {
    id: 'muenchen',
    name: 'München',
    lat: 48.1351,
    lng: 11.582,
    tags: ['city', 'fly', 'train', 'event', 'fest'],
    wiki: 'München',
    iata: 'MUC',
  },
];

function placeById(id: string): SeedPlace | null {
  return (
    EVENT_COMPARE_EXTRA_SEEDS.find((p) => p.id === id) ||
    SEED_PLACES.find((p) => p.id === id) ||
    null
  );
}

export function detectEventCompareFamily(ledger: ReiseLedger): string | null {
  const t = blob(ledger);
  const notes = (ledger.intentNotes?.value ?? []).join(' ').toLowerCase();
  if (/wimbledon/.test(t) || /wimbledon/.test(notes)) return 'wimbledon';
  if (/roland\s*garros|roland-garros/.test(t) || /roland/.test(notes)) return 'roland_garros';
  if (/madrid\s*open|mutua\s*madrid/.test(t)) return 'madrid_open';
  if (
    /grand\s*slam/.test(t) ||
    /grand\s*slam/.test(notes) ||
    (/tennis(?:turnier)?/.test(t) &&
      /\b(wo\s+(muss|kann)|zuschauen|tickets?|finale|grand\s*slam)\b/.test(t) &&
      /\b(europa|europe|england|frankreich|spanien|london|paris|madrid)\b/.test(t))
  ) {
    return /europa|europe|england|frankreich|spanien|london|paris|madrid/.test(t) ||
      /europa|europe/.test(notes) ||
      !/us\s*open|australian|melbourne|new\s*york/.test(t)
      ? 'grand_slam_europe'
      : 'grand_slam';
  }
  if (/oktoberfest|wiesn/.test(t)) return 'oktoberfest';
  if (/Event-Hook:/i.test(notes) && /tennis|slam|golf|festival|fest/.test(notes)) {
    if (/tennis|slam/.test(notes)) return 'grand_slam_europe';
  }
  return null;
}

export function looksLikeConstrainedCompare(ledger: ReiseLedger): boolean {
  if (ledger.discoverIntent?.value === 'event_compare') return true;
  if (detectEventCompareFamily(ledger)) return true;
  const dest = (ledger.destinationHint?.value || '').trim().toLowerCase();
  if (dest && dest !== 'offen' && /oder|,|\//.test(dest)) return true;
  const notes = ledger.intentNotes?.value ?? [];
  if (notes.some((n) => /Event-Hook:/i.test(n))) return true;
  return false;
}

export function seedsForEventFamily(family: string | null): SeedPlace[] {
  if (!family) return [];
  const ids = EVENT_VENUE_IDS[family] || [];
  const out: SeedPlace[] = [];
  for (const id of ids) {
    const p = placeById(id);
    if (p) out.push({ ...p, tags: [...new Set([...(p.tags || []), 'event', 'compare'])] });
  }
  return out;
}

export function resolveResearchStrategy(ledger: ReiseLedger): ConstrainedComparePlan {
  const family = detectEventCompareFamily(ledger);
  const constrained =
    looksLikeConstrainedCompare(ledger) || Boolean(family);
  if (!constrained) {
    return {
      strategy: 'open_discover',
      family: null,
      seeds: [],
      briefHints: [
        'Orte scannen die zum Brief passen',
        'Dann günstige Anreise + Stay',
        'Danach Extras hart belegen',
      ],
    };
  }
  const seeds = seedsForEventFamily(family);
  return {
    strategy: 'constrained_compare',
    family,
    seeds,
    briefHints: [
      'Orte schon durch Event/Anker klar',
      'Flug + Stay parallel je Ort',
      'Gesamtpaket vergleichen, dann Extras',
    ],
  };
}

/** Shortlist-Größe: bei Compare eher die Venue-Menge, sonst klassisch. */
export function shortlistTargetForStrategy(
  plan: ConstrainedComparePlan,
  researchPath: string,
  timedOut: boolean,
): number {
  if (timedOut) return 5;
  if (plan.strategy === 'constrained_compare') {
    const n = plan.seeds.length;
    if (n >= 2) return Math.min(4, Math.max(2, n));
    return 3;
  }
  return researchPath === 'stay_first' ? 8 : 10;
}
