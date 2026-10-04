/**
 * Alle ~30 Touristen-Personas: Detect → Branch → Depth-Frage erreichbar.
 */
import assert from 'node:assert/strict';
import {
  buildCatalogCtx,
  detectCatalogBranches,
  isQuestionOpen,
  nextCatalogQuestion,
  QUESTION_CATALOG,
} from './questionCatalog';
import { cloneEmptyLedger, entry, mergeLedger } from './slotLedger';
import {
  allTouristPersonaIds,
  detectTouristPersonas,
  TOURIST_PERSONAS,
  type TouristPersonaId,
} from './touristPersonas';

const SIGNAL: Record<TouristPersonaId, string> = {
  party_weekend: 'Männerwochenende Party Clubs feiern',
  romantic_couple: 'romantischer Paarurlaub Dinner Ruhe zu zweit',
  spa_detox: 'Spa Wellness Detox Massage Therme',
  all_inclusive: 'All Inclusive Sonne Pool Resort',
  city_culture: 'Städtetrip Museen Kirchen Geschichte Kulturreise',
  city_food: 'Foodtrip Märkte Streetfood kulinarisch foodie',
  festival: 'Festival Open Air Tickets Konzert',
  football_fan: 'Bundesliga Spieltag Stadion Match',
  grand_slam: 'Grand Slam Tennis Turnier Wimbledon',
  cruise_first: 'Kreuzfahrt erste Mal Schiff Kabine',
  cruise_northern_lights: 'Polarlicht Kreuzfahrt Nordlicht',
  river_cruise: 'Flusskreuzfahrt Rhein Donau',
  family_kids_club: 'Familie mit Kindern Kids Club Animation',
  family_quiet: 'Familie ruhig Strand Nickerchen Kinderwagen',
  senior_70: 'Senioren 70+ kurze Wege Rentner',
  senior_80: '80+ Rollstuhl barrierefrei Hilfe',
  budget_spar: 'Sparfuchs günstig Hostel FlixTrain Budget',
  business_comfort: 'Business Dienstreise Direktflug kein Nachtflug',
  roadtrip: 'Roadtrip Camper Stellplätze Etappen',
  multi_city: 'Multi-City Hop Mailand Verona Venedig Rundreise',
  hike_trek: 'Wandern Trek Hütte Trail Bergtour',
  bike_ebike: 'E-Bike Radtour Eurovelo Etappen',
  beach_party: 'Strand Party Mix Beach Clubs feiern',
  workation: 'Workation Remote Work WLAN Apartment',
  ski_winter: 'Ski Skipass Schnee Piste Liftnähe',
  wedding_guest: 'Hochzeit Trauung als Gast Anzug',
  surf_water: 'Surfen Wellen Spot Kurs Wassersport',
  lgbtq_nightlife: 'LGBTQ Queer Pride Nightlife Szene',
  photo_architecture: 'Fotografie Skyline Architektur goldene Stunde',
  open_discover: 'egal wohin warm günstig Surprise Deal',
};

assert.equal(allTouristPersonaIds().length, 30, 'exactly 30 personas');
assert.equal(TOURIST_PERSONAS.length, 30, 'TOURIST_PERSONAS length');

/** Core-Slots gefüllt → Master-Hart übersprungen, Branches greifen. */
function coreLedger(signal: string) {
  const kids =
    /familie|kids|kinder|nickerchen|kinderwagen/i.test(signal) && !/paarurlaub/i.test(signal);
  return mergeLedger(cloneEmptyLedger(), {
    purpose: entry('Urlaub planen', 'user'),
    inspiration: entry(signal, 'user'),
    adults: entry(2, 'user'),
    children: entry(kids ? 1 : 0, 'user'),
    dateStart: entry('2026-09-11', 'user'),
    dateEnd: entry('2026-09-14', 'user'),
    budgetEur: entry(800, 'user'),
    originCity: entry('Hamburg', 'user'),
    lodgingOpen: entry(true, 'user'),
    mode: entry('fly', 'user'),
    cabinBags: entry(1, 'user'),
    meals: entry(/all inclusive/i.test(signal) ? 'breakfast' : 'breakfast', 'user'),
    localMovePref: entry('walk', 'user'),
    locationBias: entry('central', 'user'),
    destinationHint: entry('offen', 'user'),
    travelerAges: entry(
      /80\+|rollstuhl/i.test(signal)
        ? [82, 78]
        : /70\+|senior|rentner/i.test(signal)
          ? [72, 68]
          : [30, 28],
      'user',
    ),
  });
}

function canReachDepthQuestion(personaId: TouristPersonaId, depthIds: string[]): boolean {
  const signal = SIGNAL[personaId]!;
  const led = coreLedger(signal);
  const branches = new Set(detectCatalogBranches(led, signal));
  const ctx = buildCatalogCtx(led, []);

  // Master-Soft (hopStops) oder Branch-Frage: when+filled-Gate offen und Branch aktiv
  for (const qid of depthIds) {
    const q = QUESTION_CATALOG.find((x) => x.id === qid);
    if (!q) continue;
    if (q.branch !== 'master' && !branches.has(q.branch)) continue;
    if (isQuestionOpen(q, ctx)) return true;
  }

  const asked: string[] = [];
  for (let i = 0; i < 16; i++) {
    const next = nextCatalogQuestion(led, asked, [], signal);
    if (!next) break;
    if (depthIds.includes(next.id)) return true;
    asked.push(next.id);
  }
  return false;
}

for (const def of TOURIST_PERSONAS) {
  const signal = SIGNAL[def.id]!;
  const detected = detectTouristPersonas(cloneEmptyLedger(), signal);
  assert(
    detected.includes(def.id),
    `${def.id}: detect missed (got ${detected.join(',') || '∅'}) for "${signal}"`,
  );

  const branches = detectCatalogBranches(cloneEmptyLedger(), signal);
  for (const b of def.branches) {
    assert(
      branches.includes(b),
      `${def.id}: branch ${b} missing (got ${branches.join(',')})`,
    );
  }

  for (const qid of def.depthQuestionIds) {
    assert(
      QUESTION_CATALOG.some((q) => q.id === qid),
      `${def.id}: catalog missing question ${qid}`,
    );
  }

  assert(
    canReachDepthQuestion(def.id, def.depthQuestionIds),
    `${def.id}: depth question not reached (${def.depthQuestionIds.join(',')})`,
  );
}

// Kein False-Positive: neutrales Brief → keine Party/Ski-Branch
const neutral = detectTouristPersonas(
  cloneEmptyLedger(),
  'Wochenende zu zweit irgendwo in Deutschland',
);
assert(!neutral.includes('ski_winter'), 'neutral ≠ ski');
assert(!neutral.includes('cruise_first'), 'neutral ≠ cruise');

console.log(`touristPersonas.smoke.test.ts ok (${TOURIST_PERSONAS.length} personas)`);
