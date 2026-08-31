/**
 * Run: npx --yes tsx src/services/homeMap/homeMapCityTone.smoke.test.ts
 */

import {
  cityIdsForPlanStop,
  isFirmTimelineStop,
  isTimelineCityPlanStop,
  resolveHomeMapCityTone,
} from './homeMapCityTone';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(
  resolveHomeMapCityTone({ hereNow: true, dwellGreen: false, firmPlan: false }) ===
    'visited',
  'gerade in der Stadt → sofort grün',
);
assert(
  resolveHomeMapCityTone({ hereNow: false, dwellGreen: true, firmPlan: true }) ===
    'visited',
  '30 Min schlägt Timeline-Blau',
);
assert(
  resolveHomeMapCityTone({ hereNow: true, dwellGreen: false, firmPlan: true }) ===
    'visited',
  'Anwesenheit schlägt Timeline-Blau',
);
assert(
  resolveHomeMapCityTone({ hereNow: false, dwellGreen: true, firmPlan: false }) ===
    'visited',
  '≥30 Min → dauerhaft grün',
);
assert(
  resolveHomeMapCityTone({ hereNow: false, dwellGreen: false, firmPlan: true }) ===
    'planned',
  'Timeline in der Stadt → blau',
);
assert(
  resolveHomeMapCityTone({ hereNow: false, dwellGreen: false, firmPlan: false }) ===
    'catalog',
  'Pack-Stadt ohne Besuch → rot',
);

assert(
  isFirmTimelineStop({
    kind: 'stop',
    status: 'planned',
    lat: 53.67,
    lng: 9.76,
  }),
  'committed Stop zählt',
);
assert(
  !isFirmTimelineStop({
    kind: 'wish',
    status: 'planned',
    lat: 53.67,
    lng: 9.76,
  }),
  'Wish zählt nicht als firm',
);
assert(
  isTimelineCityPlanStop({
    kind: 'wish',
    status: 'planned',
    title: 'Kaffee',
  }),
  'Kaffee-Wish färbt Stadt blau',
);
assert(
  isTimelineCityPlanStop({
    kind: 'stop',
    status: 'planned',
    title: 'Kaffee trinken',
    lat: 53.677,
    lng: 9.764,
  }),
  'Kaffee-Stop zählt',
);
assert(
  !isTimelineCityPlanStop({
    kind: 'nav_leg',
    lat: 53.67,
    lng: 9.76,
  }),
  'Nav-Leg färbt nicht',
);
assert(
  !isFirmTimelineStop({
    id: 'choice_a',
    kind: 'stop',
    lat: 53.67,
    lng: 9.76,
  }),
  'Choice-Karte zählt nicht',
);
assert(
  !isFirmTimelineStop({
    kind: 'nav_leg',
    lat: 53.67,
    lng: 9.76,
  }),
  'Nav-Leg zählt nicht',
);
assert(
  !isFirmTimelineStop({
    kind: 'stop',
    status: 'done',
    lat: 53.67,
    lng: 9.76,
  }),
  'erledigter Stop zählt nicht',
);
assert(
  !isFirmTimelineStop({ kind: 'stop', title: 'Ohne GPS' }),
  'Stop ohne Koordinaten zählt nicht als firm',
);

const cities = [{ cityId: 'prisdorf', name: 'Prisdorf' }];
const locate = (lat: number, lng: number) =>
  lat > 53.6 && lat < 53.72 && lng > 9.7 && lng < 9.82 ? 'prisdorf' : null;

assert(
  cityIdsForPlanStop(
    { kind: 'stop', title: 'Kaffee', lat: 53.677, lng: 9.764 },
    { cities, locate },
  ).includes('prisdorf'),
  'Kaffee mit GPS in Prisdorf → blau',
);
assert(
  cityIdsForPlanStop(
    { kind: 'wish', title: 'Kaffee in Prisdorf' },
    { cities, locate },
  ).includes('prisdorf'),
  'Kaffee-Titel mit Stadtname → blau',
);
assert(
  !cityIdsForPlanStop(
    { kind: 'stop', title: 'Kaffee in Hamburg', lat: 53.55, lng: 10.0 },
    { cities, locate },
  ).includes('prisdorf'),
  'anderer Ort färbt Prisdorf nicht',
);

console.log('homeMapCityTone.smoke.test.ts OK');
