/**
 * Touristen-Unterpfade (~30 Personas) — SSOT für Branch-when.
 * Doktrin: Branch nur öffnen, wenn Signal im Brief (kein Abfrage-Vollkatalog).
 * Wortlaut der Fragen bleibt dynamisch; hier nur Typ + Signals + CatalogBranch.
 *
 * Dok: `.cursor/REISEBUERO_TOURIST_SUBPATHS.md`
 */

import type { CatalogBranch } from './questionCatalog';
import type { ReiseLedger } from './types';
import { detectTripVibes } from './vibeProbes';

export type TouristPersonaId =
  | 'party_weekend'
  | 'romantic_couple'
  | 'spa_detox'
  | 'all_inclusive'
  | 'city_culture'
  | 'city_food'
  | 'festival'
  | 'football_fan'
  | 'grand_slam'
  | 'cruise_first'
  | 'cruise_northern_lights'
  | 'river_cruise'
  | 'family_kids_club'
  | 'family_quiet'
  | 'senior_70'
  | 'senior_80'
  | 'budget_spar'
  | 'business_comfort'
  | 'roadtrip'
  | 'multi_city'
  | 'hike_trek'
  | 'bike_ebike'
  | 'beach_party'
  | 'workation'
  | 'ski_winter'
  | 'wedding_guest'
  | 'surf_water'
  | 'lgbtq_nightlife'
  | 'photo_architecture'
  | 'open_discover';

export type TouristPersonaDef = {
  id: TouristPersonaId;
  /** Kurzlabel (Dok / Debug) — kein Vorlese-Skript. */
  label: string;
  /** Primärer Katalog-Branch; secondary optional. */
  branches: CatalogBranch[];
  /** Erwartete Depth-1-Frage(n) wenn Branch aktiv + Core gefüllt. */
  depthQuestionIds: string[];
  /** Signal-Test gegen Brief-Blob + aktuelle User-Zeile. */
  match: (ctx: { blob: string; ledger: ReiseLedger; line: string }) => boolean;
};

function amenity(ledger: ReiseLedger, id: string): boolean {
  return (
    (ledger.mustHaves?.value ?? []).includes(id as never) ||
    (ledger.wishHaves?.value ?? []).includes(id as never) ||
    (ledger.niceHaves?.value ?? []).includes(id as never)
  );
}

function ledgerBlob(ledger: ReiseLedger): string {
  return [
    ledger.purpose?.value,
    ledger.energy?.value,
    ledger.extraWishes?.value,
    ledger.highlightWant?.value,
    ledger.inspiration?.value,
    ledger.ideaHook?.value,
    ledger.destinationHint?.value,
    ledger.partyStyle?.value,
    ledger.spaStyle?.value,
    ledger.kidsStyle?.value,
    ledger.tripShape?.value,
    ...(ledger.mustHaves?.value ?? []),
    ...(ledger.wishHaves?.value ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/** Alle 30 Personas — Reihenfolge = Priorität bei Mehrfach-Match (früher gewinnt für Label). */
export const TOURIST_PERSONAS: TouristPersonaDef[] = [
  {
    id: 'cruise_northern_lights',
    label: 'Polarlicht-Kreuzfahrt',
    branches: ['cruise'],
    depthQuestionIds: ['cruiseCore', 'cruiseShipVibe', 'cruiseShipPick'],
    match: ({ blob }) => /polarlicht|northern\s*lights|nordlicht/.test(blob),
  },
  {
    id: 'river_cruise',
    label: 'Flusskreuzfahrt',
    branches: ['cruise'],
    depthQuestionIds: ['cruiseCore', 'cruiseShipVibe'],
    match: ({ blob, ledger }) =>
      /flusskreuzfahrt|rhein|donau|fluss\s*schiff/.test(blob) || amenity(ledger, 'river_cruise'),
  },
  {
    id: 'cruise_first',
    label: 'Kreuzfahrt',
    branches: ['cruise'],
    depthQuestionIds: ['cruiseCore', 'cruiseShipVibe', 'cruiseShipPick'],
    match: ({ blob, ledger }) =>
      /kreuzfahrt|cruise|einschiff|kabine|mein\s*schiff|aida/.test(blob) ||
      ledger.tripShape?.value === 'cruise' ||
      amenity(ledger, 'cruise'),
  },
  {
    id: 'grand_slam',
    label: 'Grand Slam / Tennis',
    branches: ['tournament'],
    depthQuestionIds: ['tournamentCore'],
    match: ({ blob }) => /grand\s*slam|wimbledon|roland\s*garros|us\s*open|australian\s*open|tennis\s*turnier/.test(blob),
  },
  {
    id: 'football_fan',
    label: 'Fußball / Sport-Fan',
    branches: ['tournament'],
    depthQuestionIds: ['tournamentCore'],
    match: ({ blob, ledger }) =>
      /fu[sß]ball|bundesliga|champions|spieltag|stadion|match\b|wm\b|em\b|meisterschaft/.test(blob) ||
      amenity(ledger, 'stadium'),
  },
  {
    id: 'wedding_guest',
    label: 'Hochzeit / Event-Gast',
    branches: ['event'],
    depthQuestionIds: ['eventCore'],
    match: ({ blob }) => /hochzeit|trauung|standesamt|bräutigam|braut\b/.test(blob),
  },
  {
    id: 'festival',
    label: 'Festival',
    branches: ['event'],
    depthQuestionIds: ['eventCore'],
    match: ({ blob, ledger }) =>
      /festival|open\s*air|konzert|messe|veranstaltung/.test(blob) || amenity(ledger, 'concert'),
  },
  {
    id: 'party_weekend',
    label: 'Party-Weekend',
    branches: ['party'],
    depthQuestionIds: ['partyGrain'],
    match: ({ blob, ledger }) => {
      if (/kids.?club|kinderclub/i.test(blob)) return false;
      const v = detectTripVibes(ledger);
      return (
        v.party ||
        /party|feier|nightlife|männerwochenende|maennerwochenende|\bjungs\b|\bjga\b|\bclubs?\b/.test(
          blob,
        )
      );
    },
  },
  {
    id: 'beach_party',
    label: 'Strand + Party',
    branches: ['party', 'active'],
    depthQuestionIds: ['partyGrain', 'beachPartyMix'],
    match: ({ blob }) =>
      /(strand|beach).{0,24}(party|club|feier)|(party|club|feier).{0,24}(strand|beach)/.test(blob),
  },
  {
    id: 'lgbtq_nightlife',
    label: 'LGBTQ+ Nightlife',
    branches: ['party'],
    depthQuestionIds: ['partyGrain', 'lgbtqScene'],
    match: ({ blob }) => /lgbtq|queer|pride|gay\s*bar|schwulen|lesbisch/.test(blob),
  },
  {
    id: 'romantic_couple',
    label: 'Paar romantisch',
    branches: ['romantic'],
    depthQuestionIds: ['romanticCore'],
    match: ({ blob, ledger }) =>
      /romant|honeymoon|flitter|paarurlaub|zu\s*zweit.{0,20}(ruhe|dinner|candle)/.test(blob) ||
      ((ledger.adults?.value ?? 0) === 2 &&
        (ledger.children?.value ?? 0) === 0 &&
        /ruhe|dinner|candle|anniversary|jahrestag/.test(blob)),
  },
  {
    id: 'spa_detox',
    label: 'Spa / Detox',
    branches: ['spa'],
    depthQuestionIds: ['spaStyle', 'spaIntent'],
    match: ({ blob, ledger }) => {
      const v = detectTripVibes(ledger);
      return v.spa || /spa|wellness|sauna|massage|therme|detox/.test(blob);
    },
  },
  {
    id: 'all_inclusive',
    label: 'All-Inclusive Sonne',
    branches: ['allInclusive'],
    depthQuestionIds: ['aiHardness'],
    match: ({ blob, ledger }) =>
      /all.?inclusive|\bai\b|uai|resort.{0,12}(pool|sonne)|sonne.{0,12}all.?incl/.test(blob) ||
      ledger.meals?.value === 'all',
  },
  {
    id: 'city_food',
    label: 'Städtetrip Food',
    branches: ['city'],
    depthQuestionIds: ['cityExplore', 'cityFood'],
    match: ({ blob }) =>
      /food.?trip|street.?food|m[äa]rkte|kulinar|gastro.?stadt|essensreise|foodie/.test(blob),
  },
  {
    id: 'city_culture',
    label: 'Städtetrip Kultur',
    branches: ['city'],
    depthQuestionIds: ['cityExplore'],
    match: ({ blob }) =>
      /st[äa]dtetrip|city.?break|museum|kirchen?|geschichte|kulturreise|sightseeing/.test(blob),
  },
  {
    id: 'photo_architecture',
    label: 'Foto / Architecture',
    branches: ['city'],
    depthQuestionIds: ['cityExplore', 'photoSpots'],
    match: ({ blob }) => /foto|photogra|skyline|architektur|aussichtspunkt|goldene\s*stunde/.test(blob),
  },
  {
    id: 'workation',
    label: 'Workation',
    branches: ['city'],
    depthQuestionIds: ['workationStay'],
    match: ({ blob }) => /workation|remote.?work|home.?office.{0,12}urlaub|wlan.{0,12}arbeit/.test(blob),
  },
  {
    id: 'family_kids_club',
    label: 'Familie Kids-Club',
    branches: ['family'],
    depthQuestionIds: ['kidsStyle'],
    match: ({ blob, ledger }) => {
      const kids =
        (ledger.children?.value ?? 0) > 0 ||
        detectTripVibes(ledger).kids ||
        /kind|familie|kids|baby|kinderwagen/.test(blob);
      return kids && /kids.?club|kinderclub|animation|abschieben|betreuung/.test(blob);
    },
  },
  {
    id: 'family_quiet',
    label: 'Familie ruhig',
    branches: ['family'],
    depthQuestionIds: ['kidsStyle', 'familyQuietPace'],
    match: ({ blob, ledger }) => {
      const kids =
        (ledger.children?.value ?? 0) > 0 ||
        detectTripVibes(ledger).kids ||
        /kind|familie|kids|baby|kinderwagen/.test(blob);
      return (
        kids &&
        /ruhig|nickerchen|kinderwagen|langsam|tempo|strand.{0,12}familie|familie.{0,12}strand/.test(
          blob,
        ) &&
        !/kids.?club|animation/.test(blob)
      );
    },
  },
  {
    id: 'senior_80',
    label: 'Senioren 80+ / Hilfe',
    branches: ['senior', 'mode_deep'],
    depthQuestionIds: ['accessNeeds', 'seniorPace'],
    match: ({ blob, ledger }) => {
      const ages = ledger.travelerAges?.value ?? [];
      return ages.some((a) => a >= 80) || /80\+|rollstuhl|pflege|barrierefrei|hilfe\s*beim/.test(blob);
    },
  },
  {
    id: 'senior_70',
    label: 'Senioren 70+',
    branches: ['senior', 'mode_deep'],
    depthQuestionIds: ['accessNeeds'],
    match: ({ blob, ledger }) => {
      const ages = ledger.travelerAges?.value ?? [];
      return (
        ages.some((a) => a >= 70) ||
        /senior|70\+|rentner|gehhilfe|kurze\s*wege/.test(blob)
      );
    },
  },
  {
    id: 'budget_spar',
    label: 'Budget-Sparfüchse',
    branches: ['mode_deep', 'open_discover'],
    depthQuestionIds: ['openDealLead', 'surfacePref'],
    match: ({ blob, ledger }) =>
      ledger.budgetVibe?.value === 'cheap' ||
      ledger.dealHunt?.value === true ||
      /sparfuchs|günstig|billig|hostel|flix|spar.?reise|budget/.test(blob),
  },
  {
    id: 'business_comfort',
    label: 'Komfort-Business',
    branches: ['mode_deep'],
    depthQuestionIds: ['directFlight', 'businessHours'],
    match: ({ blob }) =>
      /business|dienstreise|konferenz|meeting|direktflug|kein\s*nachtflug|lounge/.test(blob),
  },
  {
    id: 'roadtrip',
    label: 'Roadtrip / Camper',
    branches: ['mode_deep'],
    depthQuestionIds: ['driveTime', 'roadtripStages'],
    match: ({ blob, ledger }) =>
      ledger.tripShape?.value === 'roadtrip' ||
      /roadtrip|camper|wohnmobil|stellplatz|etappen/.test(blob),
  },
  {
    id: 'multi_city',
    label: 'Multi-City Hop',
    branches: ['mode_deep'],
    depthQuestionIds: ['hopStops'],
    match: ({ blob, ledger }) =>
      ledger.tripShape?.value === 'hop' ||
      ledger.tripShape?.value === 'tour' ||
      /multi.?city|st[äa]dte.?hop|mehrere\s+st[äa]dt|mailand.{0,20}venedig|rundreise/.test(blob),
  },
  {
    id: 'hike_trek',
    label: 'Wander / Trek',
    branches: ['active'],
    depthQuestionIds: ['hikeFitness'],
    match: ({ blob }) => /wander|trek|hütte|trail|bergtour|alpin/.test(blob),
  },
  {
    id: 'bike_ebike',
    label: 'Rad / E-Bike',
    branches: ['active'],
    depthQuestionIds: ['bikeStyle'],
    match: ({ blob }) => /e.?bike|radtour|fahrrad.?reise|eurovelo|cycling/.test(blob),
  },
  {
    id: 'surf_water',
    label: 'Surfen / Wassersport',
    branches: ['active'],
    depthQuestionIds: ['surfSpot'],
    match: ({ blob, ledger }) =>
      /surf|wellen|wassersport|kite|windsurf|paddle/.test(blob) || amenity(ledger, 'paddle'),
  },
  {
    id: 'ski_winter',
    label: 'Ski / Winter',
    branches: ['seasonal'],
    depthQuestionIds: ['skiLevel'],
    match: ({ blob }) => /ski|skipass|schnee|wintersport|piste|liftnähe|liftnahe/.test(blob),
  },
  {
    id: 'open_discover',
    label: 'Open Discover warm+günstig',
    branches: ['open_discover'],
    depthQuestionIds: ['openClimate', 'openDealLead'],
    match: ({ blob, ledger }) =>
      ledger.dealHunt?.value === true ||
      /egal\s*wohin|irgendwo\s*warm|offen\s*entdecken|surprise|deal.?hunt|warm.{0,12}günstig|günstig.{0,12}warm/.test(
        blob,
      ) ||
      (/warm|sonne|beach/.test(blob) &&
        (/egal|offen|irgendwo|surprise/.test(blob) || ledger.destinationHint?.value === 'offen')),
  },
];

export function detectTouristPersonas(
  ledger: ReiseLedger,
  userLine = '',
): TouristPersonaId[] {
  const line = (userLine || '').toLowerCase();
  const blob = `${ledgerBlob(ledger)} ${line}`.toLowerCase();
  const ctx = { blob, ledger, line };
  const hit: TouristPersonaId[] = [];
  for (const p of TOURIST_PERSONAS) {
    try {
      if (p.match(ctx)) hit.push(p.id);
    } catch {
      /* ignore bad matcher */
    }
  }
  return hit;
}

/** Branches aus Personas — für Catalog-Gate. */
export function branchesFromPersonas(personas: TouristPersonaId[]): CatalogBranch[] {
  const out: CatalogBranch[] = [];
  for (const id of personas) {
    const def = TOURIST_PERSONAS.find((p) => p.id === id);
    if (!def) continue;
    for (const b of def.branches) {
      if (!out.includes(b)) out.push(b);
    }
  }
  return out;
}

export function primaryPersonaLabel(ledger: ReiseLedger, userLine = ''): string | null {
  const ids = detectTouristPersonas(ledger, userLine);
  if (!ids.length) return null;
  const def = TOURIST_PERSONAS.find((p) => p.id === ids[0]);
  return def?.label ?? null;
}

/** Smoke/QA: alle Persona-IDs einmalig. */
export function allTouristPersonaIds(): TouristPersonaId[] {
  return TOURIST_PERSONAS.map((p) => p.id);
}
