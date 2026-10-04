/**
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/mission/verifyMissionPass.smoke.test.ts
 */
import assert from 'node:assert/strict';
import { verifyMissionPass, formatWhyChosenForPrompt } from './verifyMissionPass';
import type { PitchCandidate, PitchRequest } from '../pitch/types';

function req(partial: Partial<PitchRequest> & Pick<PitchRequest, 'kind' | 'title'>): PitchRequest {
  return {
    requestId: 'v1',
    context: partial.context ?? partial.title,
    searchMode: 'city_best',
    visitAtMs: Date.now(),
    wishes: partial.wishes ?? [],
    prefs: partial.prefs ?? {},
    anchor: { lat: 52.37, lng: 4.89 },
    uiLayout: 'live_split',
    cityHint: partial.cityHint ?? 'Amsterdam',
    forbidSoftFill: partial.forbidSoftFill ?? true,
    ...partial,
  };
}

const hotelPool: PitchCandidate = {
  name: 'Canal Pool Hotel',
  lat: 52.37,
  lng: 4.89,
  mapsUrl: 'https://maps.example/canal',
  rating: 4.6,
  softTags: ['hotel', 'pool', 'amsterdam'],
  hardEvidence: ['pool', 'swimming pool'],
  source: 'stay22',
  priceTotalEur: 180,
  pricePerNightEur: 90,
  nights: 2,
  address: 'Amsterdam Centrum',
};

const expensiveNoPool: PitchCandidate = {
  name: 'Luxury No Pool',
  lat: 52.37,
  lng: 4.89,
  mapsUrl: 'https://maps.example/lux',
  rating: 4.9,
  softTags: ['hotel', 'amsterdam'],
  hardEvidence: [],
  source: 'stay22',
  priceTotalEur: 520,
  pricePerNightEur: 260,
  nights: 2,
  address: 'Amsterdam',
};

{
  const r = verifyMissionPass({
    req: req({
      kind: 'hotel',
      title: 'Hotel Amsterdam Nähe Hauptbahnhof unter 200 € mit Pool',
      wishes: [
        { text: 'pool', hardness: 'must', kind: 'amenity', weight: 30 },
        { text: 'unter 200€', hardness: 'must', kind: 'generic', weight: 20 },
      ],
      prefs: {},
      forbidSoftFill: true,
      cityHint: 'Amsterdam',
    }),
    candidates: [hotelPool, expensiveNoPool],
  });
  assert.ok(
    r.survivors.some((c) => /Canal Pool/i.test(c.name)),
    'pool+budget survives',
  );
  assert.ok(
    !r.survivors.some((c) => /Luxury No Pool/i.test(c.name)),
    'no-pool expensive wiped',
  );
  const why = r.whyByName['Canal Pool Hotel'];
  assert.ok(why?.some((w) => w.id === 'amenity_pool'), 'why pool');
  assert.ok(why?.some((w) => w.id === 'budget_max'), 'why budget');
  assert.ok(formatWhyChosenForPrompt(why).includes('Pool'), 'prompt why');
}

{
  // Soft-Fill AYCE: asiatisch gegen avoid
  const asian: PitchCandidate = {
    name: 'Tokyo Buffet',
    lat: 53.55,
    lng: 9.99,
    mapsUrl: 'https://maps.example/tokyo',
    rating: 4.2,
    softTags: ['all you can eat', 'sushi', 'asiatisch'],
    hardEvidence: ['ayce', 'sushi'],
    source: 'places',
  };
  const greek: PitchCandidate = {
    name: 'Athena Buffet',
    lat: 53.55,
    lng: 9.99,
    mapsUrl: 'https://maps.example/athena',
    rating: 4.4,
    softTags: ['all you can eat', 'griechisch', 'buffet'],
    hardEvidence: ['all you can eat', 'buffet'],
    source: 'places',
  };
  const r = verifyMissionPass({
    req: req({
      kind: 'food',
      title: 'All you can eat kein Asiatisch',
      cityHint: 'Hamburg',
      wishes: [
        { text: 'all_you_can_eat', hardness: 'must', kind: 'amenity', weight: 40 },
      ],
      prefs: { avoidCategories: ['avoid_cuisine_asian'] },
      forbidSoftFill: true,
    }),
    candidates: [asian, greek],
  });
  assert.ok(r.survivors.some((c) => /Athena/i.test(c.name)), 'greek ok');
  assert.ok(!r.survivors.some((c) => /Tokyo/i.test(c.name)), 'asian wiped');
}

{
  // Alle fail → softFail empty
  const r = verifyMissionPass({
    req: req({
      kind: 'hotel',
      title: 'Hotel mit Pool unter 100€',
      wishes: [{ text: 'pool', hardness: 'must', kind: 'amenity', weight: 30 }],
      forbidSoftFill: true,
      cityHint: 'Amsterdam',
    }),
    candidates: [expensiveNoPool],
  });
  assert.equal(r.survivors.length, 0, 'empty when musts fail');
  assert.equal(r.softFail, true, 'softFail');
  assert.ok(r.reason, 'reason set');
}

{
  // Basketball why
  const court: PitchCandidate = {
    name: 'Streetball Platz',
    lat: 53.55,
    lng: 9.99,
    mapsUrl: 'https://maps.example/bball',
    rating: 4.1,
    softTags: ['basketball', 'pitch', 'sport'],
    source: 'osm',
    distFromAnchorM: 650,
  };
  const r = verifyMissionPass({
    req: req({
      kind: 'generic',
      title: 'Basketball spielen',
      searchMode: 'here_now',
      cityHint: null,
      wishes: [
        { text: 'basketballplatz', hardness: 'must', kind: 'amenity', weight: 40 },
      ],
      forbidSoftFill: true,
    }),
    candidates: [court],
  });
  assert.equal(r.survivors.length, 1, 'court survives');
  assert.ok(
    r.whyByName['Streetball Platz']?.some((w) => /basketball|sport/i.test(w.evidence)),
    'why basketball',
  );
}

console.log('verifyMissionPass.smoke.test.ts ok');
