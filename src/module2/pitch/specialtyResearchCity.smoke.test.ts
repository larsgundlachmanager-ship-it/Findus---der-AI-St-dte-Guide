/**
 * Specialty research city + cascade smoke.
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/pitch/specialtyResearchCity.smoke.test.ts
 */
import assert from 'node:assert/strict';
import {
  resolveSpecialtyResearchCity,
  wantsSpecialtyDiningResearch,
} from './specialtyResearchCity';
import { applyCriteriaCascade } from './criteriaCascade';
import type { PitchCandidate, PitchRequest } from './types';

assert.equal(
  wantsSpecialtyDiningResearch({
    text: 'Heute Abend Hamburger Pannfisch mit Elbblick, gerne draußen',
  }),
  true,
);

const promo = resolveSpecialtyResearchCity({
  text: 'Heute Abend Hamburger Pannfisch mit Elbblick draußen',
  lat: 53.68,
  lng: 9.76, // Prisdorf-ish
  explicitCity: null,
  call1DestCity: null,
  wishes: [
    { text: 'pannfisch', hardness: 'must', kind: 'dish' },
    { text: 'elbblick', hardness: 'must', kind: 'vibe' },
  ],
});
assert.ok(promo?.city, 'metro city promoted from specialty');
assert.equal(promo?.promoted, true);
assert.match(String(promo?.city), /hamburg/i);

const named = resolveSpecialtyResearchCity({
  text: 'Pannfisch in Lübeck',
  lat: 53.68,
  lng: 9.76,
  explicitCity: 'Lübeck',
  call1DestCity: null,
});
assert.equal(named?.city, 'Lübeck');
assert.equal(named?.promoted, false);

const pool: PitchCandidate[] = [
  {
    name: 'Fischhaus Elbblick',
    lat: 53.54,
    lng: 9.95,
    mapsUrl: '',
    source: 'places',
    softTags: ['pannfisch', 'terrasse', 'elbblick'],
    hardEvidence: ['Pannfisch', 'Elbblick'],
    rating: 4.6,
    openNow: true,
  },
  {
    name: 'Dorfkneipe',
    lat: 53.68,
    lng: 9.76,
    mapsUrl: '',
    source: 'pack',
    softTags: ['bier'],
    rating: 4.2,
    openNow: true,
  },
  {
    name: 'Hafen Terrasse Fisch',
    lat: 53.54,
    lng: 9.96,
    mapsUrl: '',
    source: 'places',
    softTags: ['pannfisch', 'terrasse'],
    hardEvidence: ['Pannfisch', 'Terrasse'],
    rating: 4.4,
    openNow: true,
  },
];

const req = {
  requestId: 't',
  title: 'Pannfisch Elbblick',
  context: 'Pannfisch mit Elbblick draußen',
  kind: 'food',
  searchMode: 'city_best',
  visitAtMs: Date.now(),
  wishes: [
    { text: 'pannfisch', hardness: 'must', kind: 'dish' },
    { text: 'elbblick', hardness: 'must', kind: 'vibe' },
    { text: 'terrasse', hardness: 'must', kind: 'vibe' },
  ],
  prefs: {},
  anchor: { lat: 53.54, lng: 9.95 },
  uiLayout: 'live_split',
} as PitchRequest;

const cascaded = applyCriteriaCascade(req, pool);
assert.ok(cascaded.pool.length >= 1, 'cascade keeps matches');
assert.ok(
  cascaded.checklist.some((s) => /pannfisch/i.test(s.label) && s.status === 'pass'),
  'dish pass',
);
assert.ok(
  !cascaded.pool.some((c) => /dorfkneipe/i.test(c.name)),
  'non-match filtered when dish hard',
);

// Soft-Miss Backtrack: Blick fehlt → Pool behalten + honesty
const pool2: PitchCandidate[] = [
  {
    name: 'Fischhaus',
    lat: 53.54,
    lng: 9.95,
    softTags: ['pannfisch', 'fisch'],
    hardEvidence: ['pannfisch'],
    distFromAnchorM: 4000,
    priceTotalEur: 15,
  } as PitchCandidate,
  {
    name: 'Bistro Zwei',
    lat: 53.55,
    lng: 9.96,
    softTags: ['pannfisch'],
    hardEvidence: ['pannfisch'],
    distFromAnchorM: 8000,
    priceTotalEur: 18,
  } as PitchCandidate,
];
const req2 = {
  ...req,
  wishes: [
    { text: 'pannfisch', hardness: 'must', kind: 'dish' },
    { text: 'elbblick', hardness: 'must', kind: 'vibe' },
  ],
  prefs: { budgetHint: '10 euro' },
} as PitchRequest;
const back = applyCriteriaCascade(req2, pool2);
assert.ok(back.pool.length >= 1, 'backtrack keeps dish matches');
assert.ok(
  back.checklist.some((s) => /elbblick/i.test(s.label) && s.status === 'soft_miss'),
  'view soft_miss',
);
assert.ok(back.honestyLine && /ehrlich|ok|weiter|Lücke|fehlt|nicht/i.test(back.honestyLine), 'honesty ask');
assert.ok(back.relaxedLabels.some((l) => /elbblick/i.test(l)), 'relaxed view');

console.log('[specialtyResearchCity] ok', promo?.city, cascaded.checklist.length, 'backtrack', back.relaxedLabels.join(','));
