/**
 * Smokes: discovery doctrine + stay/route/package/adaptive/ayce seeds.
 */
import assert from 'node:assert/strict';
import {
  resolveResearchPath,
  preferEcoAccess,
  relaxConstraintsForBudget,
  classifyConstraintText,
  orderPoolForResearchPath,
  lodgingBiasForPath,
  calendarSlotBudget,
} from './research/researchPath';
import {
  extractStayMustSpecs,
  scoreAmenityAgainstStay,
  rankStaysByAmenityMusts,
  gapsFromAmenityHits,
  amenityHintFromSpecs,
  amenityHitsForStay,
} from './research/stayMustVerify';
import { scoreCountAmenity, parseSaunaCountFromText } from './research/amenityCountTolerance';
import { regionSeasonForQuery } from './research/regionalSeasonTables';
import {
  listInspirationSeeds,
  inspirationSeedsForLedgerTags,
  mergeInspirationHarvest,
  inspirationSeedsToPlaces,
  inspirationPackMeta,
  ALL_INSPIRATION_VIBES,
} from './research/inspirationCatalog';
import {
  buildInspirationResearchBrief,
  inspirationBriefSeedCount,
  ledgerTagsForInspiration,
} from './research/inspirationPoolBrief';
import { destinationsToInspirationSeeds } from './research/inspirationWriteBack';
import { preferAffiliateIfSameOffer } from '../services/affiliate/preferAffiliateIfSameOffer';
import { checkWishesMet } from './research/qualityGates';
import {
  buildRouteTourPlan,
  biasPoolForRouteTour,
  ROUTE_TOUR_CORRIDORS,
  routeTourRegionPool,
} from './research/routeTourInventory';
import {
  buildOmioBusSearchUrl,
  buildFlixBusSearchUrl,
  buildCheckMyBusSearchUrl,
  buildYescapaCamperUrl,
  expandCamperDayRateIfNeeded,
  formatFlixRideDate,
} from './research/surfaceLiveFares';
import { stayFirstRegionSeeds, inventoryHitsToSeeds, mergeStayRegions, WORLD_AMENITY_CORRIDORS, proDestToStayRegion } from './research/stayFirstInventory';
import { scoreTravelPackage, rankOptionsAsPackages } from './research/packageScore';
import {
  detectTripArchetype,
  buildAdaptiveBrief,
  resolveAiAgeBands,
} from './research/adaptiveBrief';
import { hamburgAyceSeedsForQuery } from '../module2/pitch/hamburgAyceSeeds';
import type { ReiseLedger, ReiseOption } from './types';

function ledger(partial: Partial<ReiseLedger>): ReiseLedger {
  return partial as ReiseLedger;
}

assert.equal(
  resolveResearchPath(
    ledger({
      mustHaves: {
        value: ['tennis', 'pool'],
        source: 'user',
        hardness: 'must',
      },
      highlightWant: { value: 'Villa mit Tennis und Pool', source: 'user', hardness: 'must' },
    }),
  ),
  'stay_first',
  'tennis+pool stay-first',
);

assert.equal(
  resolveResearchPath(
    ledger({
      mode: { value: 'hike', source: 'user', hardness: 'must' },
    }),
  ),
  'route_tour',
  'hike route-tour',
);

assert.ok(preferEcoAccess(ledger({ destinationHint: { value: 'München', source: 'user', hardness: 'wish' } })));
assert.equal(classifyConstraintText('All Inclusive wäre geil'), 'nice');
assert.equal(lodgingBiasForPath('stay_first', 'any'), 'apartment');
assert.equal(calendarSlotBudget('route_tour', false), 1);

const ordered = orderPoolForResearchPath(
  [
    { name: 'Magaluf', tags: ['party', 'fly'] },
    { name: 'Tennis Villa Alcudia', tags: ['pool', 'tennis', 'villa'] },
  ],
  'stay_first',
);
assert.equal(ordered[0]?.name, 'Tennis Villa Alcudia');

assert.ok(ROUTE_TOUR_CORRIDORS.length >= 8, 'route corridors');
assert.ok(
  routeTourRegionPool(ledger({ mode: { value: 'hike', source: 'user', hardness: 'must' } })).length >=
    2,
  'hike region pool',
);
assert.ok(
  routeTourRegionPool(ledger({ mode: { value: 'bike', source: 'user', hardness: 'must' } })).some(
    (p) => p.tags.includes('bike'),
  ),
  'bike region pool',
);
const tour = buildRouteTourPlan({
  ledger: ledger({ mode: { value: 'hike', source: 'user', hardness: 'must' } }),
  origin: { lat: 53.55, lng: 9.99, city: 'Hamburg' },
  nights: 3,
});
assert.ok(tour.stages.length >= 3, 'route stages');
assert.ok(tour.lodgingSeeds.length >= 1, 'route lodging');
assert.equal(tour.liveEnriched, false, 'seed plan not live');
const biased = biasPoolForRouteTour(
  [
    { id: 'x', name: 'Magaluf', lat: 0, lng: 0, tags: ['party'], wiki: 'x' },
    ...tour.lodgingSeeds,
  ],
  tour,
);
assert.ok(biased[0] && tour.lodgingSeeds.some((s) => s.id === biased[0]!.id), 'route bias');

const villaLed = ledger({
  mustHaves: { value: ['tennis', 'pool'], source: 'user', hardness: 'must' },
  highlightWant: { value: 'Villa Tennis Pool', source: 'user', hardness: 'must' },
});
assert.ok(stayFirstRegionSeeds(villaLed).length >= 1, 'stay regions');
assert.ok(inventoryHitsToSeeds([]).length === 0);
assert.ok(WORLD_AMENITY_CORRIDORS.length >= 8, 'world corridors');
const merged = mergeStayRegions(
  [
    {
      id: 'gnd-lagos',
      name: 'Lagos',
      lat: 37.1,
      lng: -8.6,
      tags: ['grounded', 'villa'],
      wiki: 'Lagos',
      iata: 'FAO',
    },
  ],
  stayFirstRegionSeeds(villaLed),
  6,
);
assert.ok(merged.some((p) => /lagos|alcud|palma|kreta/i.test(p.name)), 'merge grounded+seeds');
assert.ok(
  proDestToStayRegion({
    id: 'x',
    name: 'Test',
    lat: null,
    lng: null,
    iata: null,
    wiki: null,
    tags: [],
    whyFit: '',
  }) == null,
  'no coords → null',
);
assert.ok(
  proDestToStayRegion({
    id: 'y',
    name: 'Chania',
    lat: 35.5,
    lng: 24.0,
    iata: 'CHQ',
    wiki: 'Chania',
    tags: ['villa'],
    whyFit: 'pool villas',
  })?.tags.includes('grounded'),
  'pro dest grounded tag',
);

assert.equal(detectTripArchetype(villaLed), 'amenity_villa');
assert.equal(
  detectTripArchetype(
    ledger({
      mode: { value: 'hike', source: 'user', hardness: 'must' },
    }),
  ),
  'adventure_route',
);
const ages = resolveAiAgeBands(
  ledger({ travelerAges: { value: [8, 15], source: 'user', hardness: 'must' } }),
);
assert.ok(ages.includes(14) && ages.includes(16), 'ai age bands');
const brief = buildAdaptiveBrief(
  ledger({
    mustHaves: { value: ['kids_club'], source: 'user', hardness: 'must' },
    travelerAges: { value: [10], source: 'user', hardness: 'must' },
  }),
);
assert.equal(brief.archetype, 'family_kids');
assert.equal(brief.lodgingBias, 'apartment');

const fakeOpt = {
  id: '1',
  placeName: 'Alcúdia',
  title: 'Villa',
  matchScore: 70,
  gaps: [],
  facts: [{ id: 'tennis', emoji: '🎾', label: 'Tennis', met: true }],
  softFacts: [],
  stayName: 'Villa Ace',
  stayPriceEur: 400,
  stayBookUrl: 'https://example.com',
  flightPriceEur: 80,
  flightBookUrl: 'https://fly.example',
  buyInEur: 280,
  transports: [{ id: 't', kind: 'flight', label: 'flug', bookUrl: 'https://x', better: true }],
  stops: [],
  whyBlurb: '',
  whyMatch: ['ok'] as [string],
  fitLine: null,
  photoUrl: null,
  totalEur: 560,
  budgetDeltaEur: null,
  pricePerPerson: 280,
  priceIncludes: null,
  restBudgetEur: null,
  restBudgetHint: null,
  lat: 0,
  lng: 0,
} as unknown as ReiseOption;

const pkg = scoreTravelPackage(fakeOpt, villaLed);
assert.ok(pkg.total >= 60, `package score ${pkg.total}`);
const ranked = rankOptionsAsPackages([fakeOpt], villaLed, 4);
assert.equal(ranked.length, 1);

assert.ok(
  /google\.com\/search/.test(
    buildOmioBusSearchUrl({
      originCity: 'Hamburg',
      destCity: 'Berlin',
      checkin: '2026-10-01',
    }),
  ),
  'omio deep link (google site prefill)',
);
const flixUrl = buildFlixBusSearchUrl({
  originCity: 'Hamburg',
  destCity: 'Berlin',
  checkin: '2026-10-01',
});
assert.ok(/shop\.flixbus\.de\/search/.test(flixUrl), `flix shop ${flixUrl}`);
assert.ok(/departureCity=Hamburg/.test(flixUrl), 'flix from');
assert.ok(/arrivalCity=Berlin/.test(flixUrl), 'flix to');
assert.ok(/rideDate=01\.10\.2026/.test(flixUrl), `flix date ${flixUrl}`);
assert.equal(formatFlixRideDate('2026-09-11'), '11.09.2026');
const cmb = buildCheckMyBusSearchUrl({
  originCity: 'Hamburg',
  destCity: 'Berlin',
  checkin: '2026-10-01',
});
assert.ok(/checkmybus\.de\/hamburg\/berlin/.test(cmb), `checkmybus ${cmb}`);
assert.ok(/date=2026-10-01/.test(cmb), 'checkmybus date');
assert.ok(
  /yescapa\.de/.test(
    buildYescapaCamperUrl({
      originCity: 'Hamburg',
      checkin: '2026-10-01',
      checkout: '2026-10-05',
    }),
  ),
  'yescapa deep link',
);
assert.equal(expandCamperDayRateIfNeeded(90, 4), 360, 'camper day→total');
assert.equal(expandCamperDayRateIfNeeded(800, 4), 800, 'camper already total');

const busPricedOpt = {
  ...fakeOpt,
  flightPriceEur: null,
  flightBookUrl: null,
  transports: [
    {
      id: 'bus-flix-x',
      kind: 'bus' as const,
      label: 'Fernbus',
      bookUrl: 'https://flixbus.de',
      better: true,
      priceEur: 29,
      departAt: null,
      arriveAt: null,
    },
  ],
} as unknown as ReiseOption;
const busPkg = scoreTravelPackage(busPricedOpt, villaLed);
assert.ok(busPkg.access >= 28, `bus live access ${busPkg.access}`);

const ayce = hamburgAyceSeedsForQuery({
  cityHint: 'Hamburg',
  query: 'Freitag AYCE kein asiatisch',
  avoidAsia: true,
});
assert.ok(ayce.every((s) => !s.asian), 'no asia seeds');
assert.ok(ayce.some((s) => /Panthera|Rodizio/i.test(s.name)), 'hamburg ayce rodizio soft');
assert.ok(ayce.some((s) => /Down Under/i.test(s.name)), 'hamburg ayce down under soft');
assert.ok(!ayce.some((s) => /Jam Jam|Kofookoo|Copper/i.test(s.name)), 'asia filtered');
assert.equal(ayce[0] && /Panthera/i.test(ayce[0].name), true, 'friday non-asia prefers panthera');

assert.ok(mergeInspirationHarvest([]).length >= 5, 'catalog harvest base');
assert.ok(inspirationSeedsForLedgerTags(['tennis', 'pool']).length >= 1);
assert.ok(listInspirationSeeds('adventure').length >= 1);
assert.equal(ALL_INSPIRATION_VIBES.length, 8, '8 vibes');
assert.ok(inspirationPackMeta().itemCount >= 0, 'pack meta');
assert.ok(
  inspirationSeedsToPlaces(
    listInspirationSeeds('menstrip').filter((s) => s.lat != null),
  ).length >= 1,
  'insp → places',
);
const harvested = mergeInspirationHarvest([
  {
    vibe: 'adventure',
    destLabel: 'Stubaital Test',
    region: 'Tirol',
    countryCode: 'AT',
    tags: ['hike', 'batch'],
    validUntilMs: Date.now() + 86_400_000,
    lat: 47.1,
    lng: 11.3,
    source: 'grounded',
  },
]);
assert.ok(
  harvested.some((s) => s.destLabel === 'Stubaital Test'),
  'merge harvest',
);
assert.ok(regionSeasonForQuery('Mallorca billig'));

// Katalog-Brief (Assist) + Write-Back wachsen
const spaLed = ledger({
  mustHaves: { value: ['Spa', 'Thermal'], source: 'user', hardness: 'must' },
  mode: { value: 'spa', source: 'user', hardness: 'must' },
});
assert.ok(ledgerTagsForInspiration(spaLed).some((t) => /spa/i.test(t)), 'spa tags');
const catalogBrief = buildInspirationResearchBrief(spaLed);
assert.ok(/KATALOG-SEEDS/i.test(catalogBrief), 'brief header');
assert.ok(inspirationBriefSeedCount(spaLed) >= 1, 'brief has seeds');
assert.ok(catalogBrief.length <= 560, 'brief capped');

const wbSeeds = destinationsToInspirationSeeds(spaLed, [
  {
    id: 'writeback-test-spa',
    name: 'WriteBack Test Spa',
    lat: 47.5,
    lng: 19.0,
    iata: null,
    wiki: 'Budapest',
    tags: ['spa', 'thermal'],
    whyFit: 'Live-Recherche Spa-Hit',
  },
]);
assert.equal(wbSeeds.length, 1);
assert.equal(wbSeeds[0]?.vibe, 'spa_value');
assert.ok(wbSeeds[0]?.tags.includes('live_research'));

const relaxed = relaxConstraintsForBudget({
  hard: ['günstiges Bier in der Nähe', 'Padel'],
  nice: ['All Inclusive'],
  hasAllInclusive: true,
});
assert.ok(!relaxed.keepHard.some((h) => /Bier/i.test(h)));

assert.equal(
  preferAffiliateIfSameOffer({
    affiliateUrl: 'https://partner.example/hotel',
    directUrl: 'https://hotel.example',
    sameOffer: false,
  }),
  'https://hotel.example',
);

const specs = extractStayMustSpecs(villaLed);
assert.ok(amenityHintFromSpecs(specs) === 'tennis' || amenityHintFromSpecs(specs) === 'pool');
const rankedStays = rankStaysByAmenityMusts(
  [
    { name: 'Hostel', amenities: ['wifi'] },
    { name: 'Villa', amenities: ['tennis', 'pool'] },
  ],
  specs.filter((s): s is Extract<typeof s, { kind: 'amenity' }> => s.kind === 'amenity'),
);
assert.equal(rankedStays[0]?.name, 'Villa');
assert.equal(parseSaunaCountFromText('8 Saunen'), 8);
assert.equal(scoreCountAmenity({ wanted: 8, found: 7 }), 'near');
assert.equal(
  scoreAmenityAgainstStay(
    {
      kind: 'amenity',
      id: 'sauna',
      label: '8× Sauna',
      patterns: [/sauna/],
      hardness: 'hard',
      wantedCount: 8,
    },
    'Spa',
    ['7 saunen'],
  ).status,
  'near',
);
const failHits = amenityHitsForStay('X', [], [
  { kind: 'amenity', id: 'tennis', label: 'Tennis', patterns: [/tennis/], hardness: 'hard' },
]);
assert.ok(gapsFromAmenityHits(failHits).some((g) => /Must-Fail/i.test(g)));

const wishes = checkWishesMet(
  { id: 'x', placeName: 'T', title: 'T', gaps: ['Must-Fail: Tennis — fehlt'], facts: [], softFacts: [] } as unknown as ReiseOption,
  villaLed,
);
assert.ok(wishes.issues.some((i) => i.code === 'must_fail'));

{
  const {
    resolveResearchStrategy,
    shortlistTargetForStrategy,
    looksLikeConstrainedCompare,
  } = require('./research/researchStrategy') as typeof import('./research/researchStrategy');
  const {
    resolveResearchLead,
    budgetValueScore,
    stayLooksDump,
  } = require('./research/researchLead') as typeof import('./research/researchLead');
  const { parseBriefSlots } = require('./parseBriefSlots') as typeof import('./parseBriefSlots');
  const { mergeLedger, cloneEmptyLedger } = require('./slotLedger') as typeof import('./slotLedger');
  const { scoreTravelPackage } = require('./research/packageScore') as typeof import('./research/packageScore');

  const slam = mergeLedger(
    cloneEmptyLedger(),
    parseBriefSlots('Ich will zum Grand Slam in Europa — wo kann ich hin, wie teuer?'),
  );
  assert.equal(slam.discoverIntent?.value, 'event_compare', 'grand slam → event_compare');
  assert.ok(
    (slam.intentNotes?.value ?? []).some((n) => /Event-Hook/i.test(n)),
    'event hook note',
  );
  const plan = resolveResearchStrategy(slam);
  assert.equal(plan.strategy, 'constrained_compare', 'constrained strategy');
  assert.ok(plan.seeds.length >= 2, `venue seeds ${plan.seeds.map((s) => s.name)}`);
  assert.ok(
    plan.seeds.some((s) => /london|paris/i.test(s.name)),
    'europe slam hosts',
  );
  assert.equal(shortlistTargetForStrategy(plan, 'flight_first', false), Math.min(4, Math.max(2, plan.seeds.length)));
  assert.equal(resolveResearchLead(slam).kind, 'event');

  const villaPlain = mergeLedger(
    cloneEmptyLedger(),
    parseBriefSlots('Villa mit Tennis und Pool für uns zwei'),
  );
  assert.notEqual(villaPlain.discoverIntent?.value, 'event_compare', 'villa tennis is stay-first not event');
  assert.equal(resolveResearchStrategy(villaPlain).strategy, 'open_discover');
  assert.equal(looksLikeConstrainedCompare(villaPlain), false);
  assert.equal(resolveResearchLead(villaPlain).kind, 'stay');

  assert.equal(detectTripArchetype(slam), 'event_compare');
  assert.ok(buildAdaptiveBrief(slam).briefHints.some((h) => /Flug|Gesamtpaket|Orte/i.test(h)));

  const cruise = mergeLedger(
    cloneEmptyLedger(),
    parseBriefSlots('wir wollen eine Kreuzfahrt ab Palma machen'),
  );
  assert.equal(resolveResearchLead(cruise).kind, 'cruise', 'cruise lead');
  assert.equal(resolveResearchPath(cruise), 'flight_first');

  const villa = mergeLedger(
    cloneEmptyLedger(),
    parseBriefSlots('richtig geile Villa mit Tennisplatz und Pool'),
  );
  assert.equal(resolveResearchLead(villa).kind, 'stay', 'villa stay lead');
  assert.equal(resolveResearchPath(villa), 'stay_first');

  const named = mergeLedger(
    cloneEmptyLedger(),
    parseBriefSlots('wir fliegen nach Palma für ein Wochenende'),
  );
  assert.equal(resolveResearchLead(named).kind, 'place', 'named/corridor place lead');

  const warm = mergeLedger(
    cloneEmptyLedger(),
    parseBriefSlots('irgendwohin wo es warm ist, egal wohin'),
  );
  assert.ok(
    resolveResearchLead(warm).kind === 'climate' || resolveResearchLead(warm).kind === 'access',
    `warm open ${resolveResearchLead(warm).kind}`,
  );

  const budget = parseBriefSlots('1500 Euro pro Person');
  assert.equal(budget.lodgingQuality?.value, 'nicer_base', 'budget implies value floor');
  assert.equal(
    budgetValueScore({ buyInEur: 1400, budgetEur: 1500 }),
    15,
    'sweet spot',
  );
  assert.ok(
    budgetValueScore({
      buyInEur: 400,
      budgetEur: 1500,
      stayLooksDump: true,
      allowCheapBox: false,
    }) < 10,
    'dump under budget penalized',
  );
  assert.ok(stayLooksDump({ stayName: null }));

  const sweet = scoreTravelPackage(
    {
      id: 'a',
      placeName: 'X',
      title: 'X',
      matchScore: 70,
      gaps: [],
      facts: [{ id: '1', label: 'ok', met: true }],
      softFacts: [],
      whyBlurb: '',
      stayName: 'Hotel Test',
      stayPriceEur: 600,
      buyInEur: 1400,
      flightPriceEur: 200,
      flightBookUrl: 'https://x',
      stops: [],
    } as any,
    mergeLedger(cloneEmptyLedger(), {
      budgetEur: { value: 1500, source: 'user', hardness: 'must' },
      lodgingQuality: { value: 'nicer_base', source: 'inferred', hardness: 'wish' },
    } as any),
  );
  assert.ok(sweet.budget >= 13, `sweet budget score ${sweet.budget}`);
}

console.log('reisebuero.discoveryDoctrine.smoke: ok');
