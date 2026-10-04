/**
 * Adaptiver Brief / Archetype-Matrix — Gewichte, kein Script-Wortlaut.
 */

import type { ReiseLedger } from '../types';

export type TripArchetype =
  | 'family_kids'
  | 'menstrip_party'
  | 'couple_date'
  | 'spa_wellness'
  | 'adventure_route'
  | 'ultra_budget'
  | 'amenity_villa'
  | 'event_compare'
  | 'default';

export type AdaptiveBrief = {
  archetype: TripArchetype;
  /** AI-Kinderalter-Slots die relevant sind */
  aiAgeBands: Array<14 | 16 | 18>;
  preferEco: boolean;
  softDropCheapBeerNearAi: boolean;
  lodgingBias: 'apartment' | 'hotel' | 'hostel' | 'any';
  /** Score-Gewichte relativ */
  weights: {
    must: number;
    budget: number;
    access: number;
    vibe: number;
  };
  briefHints: string[];
};

function blob(ledger: ReiseLedger): string {
  return [
    ledger.purpose?.value,
    ledger.highlightWant?.value,
    ledger.partyStyle?.value,
    ledger.spaStyle?.value,
    ledger.tripShape?.value,
    ledger.budgetVibe?.value,
    ...(ledger.mustHaves?.value ?? []),
    ...(ledger.wishHaves?.value ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function detectTripArchetype(ledger: ReiseLedger): TripArchetype {
  const t = blob(ledger);
  const must = new Set((ledger.mustHaves?.value ?? []).map(String));
  const ages = ledger.travelerAges?.value ?? [];
  const hasKids = ages.some((a) => a < 18) || must.has('kids_club') || /kind|familie|kids/.test(t);
  if (ledger.discoverIntent?.value === 'event_compare' || /grand\s*slam|wimbledon|roland\s*garros|turnierreise|Event-Hook:\s*(grand|wimbledon|roland)/.test(t)) {
    return 'event_compare';
  }
  if (hasKids) return 'family_kids';
  if (
    (must.has('tennis') || must.has('padel') || must.has('pool') || /villa|ferienhaus/.test(t)) &&
    (must.size >= 2 || /tennis|padel/.test(t))
  ) {
    return 'amenity_villa';
  }
  if (ledger.mode?.value === 'hike' || ledger.mode?.value === 'bike' || /wander|radtour/.test(t)) {
    return 'adventure_route';
  }
  if (must.has('spa') || must.has('sauna') || /spa|wellness|sauna/.test(t)) return 'spa_wellness';
  if (must.has('party') || /männer|maenner|jungs|party|club/.test(t)) return 'menstrip_party';
  if (/date|zu\s*zweit|pärchen|paerchen|romantik/.test(t)) return 'couple_date';
  if (ledger.budgetVibe?.value === 'cheap' || /billig|ultra\s*günstig|spar/.test(t)) {
    return 'ultra_budget';
  }
  return 'default';
}

/** Kinder → AI-Altersbänder aus travelerAges ableiten. */
export function resolveAiAgeBands(ledger: ReiseLedger): Array<14 | 16 | 18> {
  const ages = ledger.travelerAges?.value ?? [];
  const kids = ages.filter((a) => a < 18);
  if (!kids.length) return [];
  const bands = new Set<14 | 16 | 18>();
  for (const a of kids) {
    if (a < 14) bands.add(14);
    else if (a < 16) bands.add(16);
    else bands.add(18);
  }
  return [...bands].sort((a, b) => a - b) as Array<14 | 16 | 18>;
}

export function buildAdaptiveBrief(ledger: ReiseLedger): AdaptiveBrief {
  const archetype = detectTripArchetype(ledger);
  const aiAgeBands = resolveAiAgeBands(ledger);
  const preferEco =
    ledger.mode?.value === 'train' ||
    ledger.mode?.value === 'bike' ||
    ledger.mode?.value === 'hike' ||
    /öko|oeko|bahn|umwelt|kein\s+flug/.test(blob(ledger));
  const softDropCheapBeerNearAi =
    ledger.meals?.value === 'all' || archetype === 'family_kids';

  const base: AdaptiveBrief = {
    archetype,
    aiAgeBands,
    preferEco,
    softDropCheapBeerNearAi,
    lodgingBias: 'any',
    weights: { must: 1, budget: 1, access: 1, vibe: 1 },
    briefHints: [],
  };

  switch (archetype) {
    case 'family_kids':
      base.lodgingBias = 'apartment';
      base.weights = { must: 1.2, budget: 1.1, access: 0.9, vibe: 1 };
      base.briefHints = [
        'Kids-Fit vor Nightlife',
        aiAgeBands.length
          ? `AI-Alter prüfen: ${aiAgeBands.join('/')}+`
          : 'Kinderalter für AI klären',
      ];
      break;
    case 'amenity_villa':
      base.lodgingBias = 'apartment';
      base.weights = { must: 1.4, budget: 0.9, access: 0.85, vibe: 0.8 };
      base.briefHints = ['Amenities hard verify', 'Zugang nach Stay-Fit'];
      break;
    case 'adventure_route':
      base.lodgingBias = 'any';
      base.weights = { must: 1.1, budget: 1, access: 1.2, vibe: 1.1 };
      base.briefHints = ['Etappen + Lodging auf Route', preferEco ? 'Eco/Bahn' : 'Zugang flex'];
      break;
    case 'spa_wellness':
      base.lodgingBias = 'hotel';
      base.weights = { must: 1.3, budget: 1, access: 0.9, vibe: 1.1 };
      base.briefHints = ['Spa/Sauna-Zahl belegen'];
      break;
    case 'menstrip_party':
      base.lodgingBias = ledger.lodgingKind?.value === 'hostel' ? 'hostel' : 'any';
      base.weights = { must: 1, budget: 1.2, access: 1.1, vibe: 1.3 };
      base.briefHints = ['Party-Lage vs. Magaluf-Filter', 'AI Alkohol-Beleg'];
      break;
    case 'event_compare':
      base.lodgingBias = 'hotel';
      base.weights = { must: 1.2, budget: 1.25, access: 1.35, vibe: 1.05 };
      base.briefHints = [
        'Orte durch Event schon klar',
        'Flug+Stay je Ort parallel',
        'Gesamtpaket vergleichen, Extras danach',
      ];
      break;
    case 'couple_date':
      base.lodgingBias = 'hotel';
      base.weights = { must: 1.1, budget: 1, access: 1, vibe: 1.2 };
      base.briefHints = ['Ruhe/View vor Party'];
      break;
    case 'ultra_budget':
      base.lodgingBias = 'hostel';
      base.weights = { must: 0.9, budget: 1.5, access: 1.2, vibe: 0.8 };
      base.briefHints = ['Deal-Fenster', 'Affiliate nur same offer'];
      break;
    default:
      break;
  }
  if (preferEco) base.briefHints.push('Bahn/Bus vor Flug wenn DE/EU-nah');
  return base;
}

/** Score-Boost aus Archetype-Weights (kleine Korrektur). */
export function adaptiveScoreBoost(
  brief: AdaptiveBrief,
  parts: { mustRatio: number; budgetOk: boolean; hasEcoAccess: boolean },
): number {
  let b = 0;
  b += (parts.mustRatio - 0.5) * 8 * brief.weights.must;
  if (parts.budgetOk) b += 3 * brief.weights.budget;
  if (brief.preferEco && parts.hasEcoAccess) b += 4 * brief.weights.access;
  return Math.round(Math.max(-8, Math.min(10, b)));
}
