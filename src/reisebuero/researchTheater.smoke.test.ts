/**
 * Smoke: Akt-3 Screensaver Geo + Scene (leer + befüllt + Stages + Welt).
 */
import {
  approxPinForSpark,
  enrichSparkGeo,
  extractPriceLabel,
  parseFlightLabel,
  projectPinToPercent,
  resolveTheaterView,
} from './research/sparkGeo';
import { buildTheaterScene, deconflictPins, stageAmbientMotifs } from './research/theaterScene';
import { theaterChecklistFocus } from './research/stageMeta';
import type { ResearchSpark, ResearchStep } from './types';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(approxPinForSpark('Barcelona')?.lat === 41.3874, 'barcelona seed');
assert(approxPinForSpark('Mallorca')?.lat === 39.5696, 'mallorca alias → palma');
assert(approxPinForSpark('HAM') != null, 'HAM airport');
assert(approxPinForSpark('Bangkok') != null, 'bangkok landmark');
assert(approxPinForSpark('BKK') != null, 'BKK airport');
assert(approxPinForSpark('Kapstadt') != null, 'cape town');
assert(approxPinForSpark('Miami') != null, 'miami');
assert(approxPinForSpark('Unbekannte Insel XYZ123') == null, 'unknown → null');
assert(approxPinForSpark('Portugal Strandurlaub') == null, 'no fuzzy country substring');
assert(approxPinForSpark('Bud') == null, 'no short fuzzy bud');
assert(approxPinForSpark('BUD') != null, 'BUD all-caps iata ok');
assert(enrichSparkGeo({ label: 'Bud' }).lat == null, 'no invent geo for Bud');

assert(approxPinForSpark('Rügen') != null, 'ruegen');
assert(approxPinForSpark('Bukarest') != null, 'bukarest');
assert(approxPinForSpark('Lissabon') != null, 'lissabon');
assert(approxPinForSpark('Palma de Mallorca') != null, 'palma full');
assert(approxPinForSpark('OTP') != null, 'OTP');
assert(approxPinForSpark('Hamburg') != null, 'hamburg city');

const { geoNameMatchesLabel } = require('./research/sparkGeo') as typeof import('./research/sparkGeo');
assert(geoNameMatchesLabel('Budapest', 'Budapest, Hungary'), 'name match budapest');
assert(!geoNameMatchesLabel('Budapest', 'Buenos Aires, Argentina'), 'reject name mismatch');
assert(!geoNameMatchesLabel('Port', 'Portugal'), 'reject short head');
assert(!geoNameMatchesLabel('Bud', 'Budapest, Hungary'), 'short bud ≠ budapest');
const swapped = enrichSparkGeo({ label: 'Lissabon', lat: -9.14, lng: 38.72 });
assert(swapped.lat != null && swapped.lat > 30, 'swap/sane lisbon lat');
const wrongBud = enrichSparkGeo({ label: 'Budapest', lat: 10, lng: 10 });
assert(Math.abs((wrongBud.lat || 0) - 47.5) < 2, 'known wins over far coords');


const geo = enrichSparkGeo({ label: 'Antalya' });
assert(geo.lat != null && geo.lng != null, 'enrich antalya');
const forced = enrichSparkGeo({ label: 'ZzyxNowhere999', lat: 50, lng: 10 });
assert(forced.lat === 50 && forced.lng === 10, 'explicit lat/lng wins');

const pct = projectPinToPercent(41.3874, 2.1686);
assert(pct.xPct > 10 && pct.xPct < 90 && pct.yPct > 10 && pct.yPct < 90, 'project in frame');

assert(resolveTheaterView([]).mapKind === 'europe', 'empty → europe');
assert(resolveTheaterView([{ lat: 13.75, lng: 100.5 }]).region === 'asia', 'bangkok → asia');
assert(resolveTheaterView([{ lat: 25.76, lng: -80.19 }]).region === 'americas', 'miami → americas');
assert(resolveTheaterView([{ lat: -33.92, lng: 18.42 }]).region === 'africa', 'cape → africa');
assert(
  resolveTheaterView([
    { lat: 53.55, lng: 10.0 },
    { lat: 40.64, lng: -73.78 },
  ]).region === 'atlantic',
  'HAM-JFK → atlantic',
);

// Bayern: Start HAM + Garmisch — enger Zoom, nicht ganz Europa
const bayern = resolveTheaterView([
  { lat: 53.55, lng: 10.0 }, // Hamburg Start
  { lat: 47.49, lng: 11.1 }, // Garmisch
  { lat: 47.41, lng: 10.28 }, // Oberstdorf
]);
assert(bayern.mapKind === 'europe', 'bayern europe map');
assert(bayern.bounds.latMax - bayern.bounds.latMin < 20, `bayern zoom lat ${bayern.bounds.latMax - bayern.bounds.latMin}`);
assert(bayern.bounds.latMin < 48 && bayern.bounds.latMax > 52, 'bayern window covers start+alps');

// Ostsee: HAM + Laboe + Timmendorf
const ostsee = resolveTheaterView([
  { lat: 53.55, lng: 9.99 },
  { lat: 54.41, lng: 10.23 },
  { lat: 54.0, lng: 10.78 },
]);
assert(ostsee.mapKind === 'europe', 'ostsee europe');
assert(ostsee.bounds.latMax - ostsee.bounds.latMin < 12, 'ostsee tight zoom');
assert(ostsee.bounds.lngMax - ostsee.bounds.lngMin < 14, 'ostsee tight lng');

const { computeMapCrop, mapExtentForKind } = require('./research/sparkGeo') as typeof import('./research/sparkGeo');
const cropBayern = computeMapCrop(bayern.bounds, mapExtentForKind('europe'));
assert(cropBayern.scale > 1.3, `bayern crop scale ${cropBayern.scale}`);

const empty = buildTheaterScene([]);
assert(
  empty.pins.length === 0 && empty.flights.length === 0 && empty.pills.length === 0,
  'empty scene',
);
assert(empty.view.mapKind === 'europe', 'empty view europe');

const parsed = parseFlightLabel('HAM → BCN');
assert(parsed.origins[0] === 'HAM' && parsed.dest === 'BCN', 'parse flight');
assert(extractPriceLabel('89€ p.P.') === '89€', 'price extract');

const sample: ResearchSpark[] = [
  {
    id: '1',
    kind: 'place',
    emoji: '📍',
    label: 'Barcelona',
    sub: 'Party + Strand',
    atMs: 1,
    lat: 41.3874,
    lng: 2.1686,
  },
  {
    id: '2',
    kind: 'flight',
    emoji: '✈️',
    label: 'HAM → BCN',
    sub: '89€ p.P.',
    atMs: 2,
    lat: 41.3874,
    lng: 2.1686,
  },
  {
    id: '3',
    kind: 'vibe',
    emoji: '✨',
    label: 'Pool',
    sub: 'Wunsch',
    atMs: 3,
  },
  {
    id: '4',
    kind: 'stay',
    emoji: '🏡',
    label: 'Villa Alcudia',
    sub: 'Pool am Haus',
    atMs: 4,
    lat: 39.8532,
    lng: 3.124,
  },
  {
    id: '5',
    kind: 'compare',
    emoji: '⭐',
    label: 'Palma',
    sub: 'Club + Strand',
    atMs: 5,
    lat: 39.5696,
    lng: 2.6502,
  },
];

const flightScene = buildTheaterScene(sample, { stage: 'flights' });
assert(flightScene.view.mapKind === 'europe', 'eu trip → europe map');
assert(flightScene.flights.length === 1, 'flight arc');
assert(flightScene.flights[0]!.from.xPct !== flightScene.flights[0]!.to.xPct, 'from≠to');
assert(/Hamburg/i.test(flightScene.flights[0]!.from.label), 'origin hamburg');
assert(flightScene.flights[0]!.price === '89€', 'flight price');

// Palma muss im Mittelmeer-Band der Europa-Karte sitzen — nicht über Maghreb/Afrika
{
  const palmaScene = buildTheaterScene(
    [
      {
        id: 'h',
        kind: 'place',
        emoji: '🏠',
        label: 'Hamburg',
        atMs: 1,
        lat: 53.55,
        lng: 9.99,
      },
      {
        id: 'p',
        kind: 'place',
        emoji: '📍',
        label: 'Palma',
        atMs: 2,
        lat: 39.5696,
        lng: 2.6502,
      },
      {
        id: 'f',
        kind: 'flight',
        emoji: '✈️',
        label: 'HAM → PMI',
        sub: '99€',
        atMs: 3,
      },
    ],
    { stage: 'discover' },
  );
  assert(palmaScene.view.mapKind === 'europe', 'palma trip europe map');
  const pin = palmaScene.pins.find((p) => /palma/i.test(p.label));
  assert(pin, 'palma pin');
  assert(pin!.hasGeo, 'palma has geo');
  // Europa-Bounds: Palma ~x29 y80 vor Deconflict; danach y ≤ 74
  assert(pin!.xPct > 22 && pin!.xPct < 42, `palma x in med west ${pin!.xPct}`);
  assert(pin!.yPct > 52 && pin!.yPct < 78, `palma y over med not africa ${pin!.yPct}`);
}
assert(
  flightScene.pills.every((p) => p.tone === 'flight'),
  'flights pills are flight-tone',
);
assert(
  flightScene.pills.some((p) => /Direkt/i.test(p.label)),
  'direktflug pill',
);
assert(!flightScene.pills.some((p) => /Pool/i.test(p.label)), 'no pool on flights');

const stayScene = buildTheaterScene(sample, { stage: 'stay' });
assert(stayScene.pills.some((p) => /Pool/i.test(p.label) && p.tone === 'stay'), 'pool on stay');

const discoverScene = buildTheaterScene(sample, { stage: 'discover' });
assert(discoverScene.pins.some((p) => p.reason && /Party|Strand/i.test(p.reason)), 'discover reason');
assert(
  discoverScene.pins.filter((p) => p.reason).length <= 1,
  'only one reason float',
);

const stacked = deconflictPins([
  { id: 'a', label: 'A', emoji: '📍', kind: 'place', xPct: 50, yPct: 50, hasGeo: true },
  { id: 'b', label: 'B', emoji: '📍', kind: 'place', xPct: 51, yPct: 50, hasGeo: true },
  { id: 'c', label: 'C', emoji: '📍', kind: 'place', xPct: 50, yPct: 51, hasGeo: true },
]);
const dAB = Math.hypot(stacked[0]!.xPct - stacked[1]!.xPct, stacked[0]!.yPct - stacked[1]!.yPct);
const dAC = Math.hypot(stacked[0]!.xPct - stacked[2]!.xPct, stacked[0]!.yPct - stacked[2]!.yPct);
assert(dAB >= 10 && dAC >= 10, `deconflict spread ${dAB} ${dAC}`);
assert(new Set(stacked.map((p) => p.labelSide)).size >= 2, 'label sides vary');

const compareScene = buildTheaterScene(sample, { stage: 'compare' });
assert(compareScene.compareNodes.length >= 2, 'compare nodes');
assert(compareScene.compareNodes.some((n) => n.status === 'in'), 'has in');
assert(compareScene.compareNodes.every((n) => !/€|Buy-in/i.test(n.hint || '')), 'no price in compare');
assert(compareScene.pills.length === 0, 'no wishlist pills on compare');

const soft = stageAmbientMotifs('soft');
assert(soft.some((m) => /Club|Padel|Strand/.test(m.label || '')), 'soft = activities');
assert(!soft.some((m) => /Pool/.test(m.label || '') && soft.length === 1), 'soft not pool-only wishlist');

const asia: ResearchSpark[] = [
  {
    id: 'a1',
    kind: 'place',
    emoji: '📍',
    label: 'Bangkok',
    atMs: 1,
    lat: 13.7563,
    lng: 100.5018,
  },
  {
    id: 'a2',
    kind: 'flight',
    emoji: '✈️',
    label: 'FRA → BKK',
    sub: '520€',
    atMs: 2,
    lat: 13.69,
    lng: 100.75,
  },
];
const asiaScene = buildTheaterScene(asia, { stage: 'climate', weatherHint: 'warm' });
assert(asiaScene.view.mapKind === 'world', 'asia uses world map');
assert(
  asiaScene.motifs.some((m) => /Südostasien|Indien|Ostasien|Monsun/.test(m.label || '')),
  'asia weather',
);

{
  const steps: ResearchStep[] = [
    {
      id: 'rs_stay',
      stage: 'stay',
      title: 'Unterkünfte',
      detail: 'Jetzt die Unterkünfte vor Ort…',
      status: 'active',
      emoji: '🏡',
    },
    {
      id: 'rs_compare',
      stage: 'compare',
      title: 'Vergleich',
      detail: 'Pakete',
      status: 'pending',
      emoji: '⚖️',
    },
  ];
  const focus = theaterChecklistFocus(steps);
  assert(focus.stepTitle === 'Unterkünfte' || /Unterkunft/i.test(focus.stepTitle), focus.stepTitle);
  assert(/Unterkunft|vor Ort/i.test(focus.statusLine), focus.statusLine);
  assert(focus.showComparePalette === false, 'no palette during stay');
  const cmp = theaterChecklistFocus([
    { ...steps[0]!, status: 'done' },
    { ...steps[1]!, status: 'active' },
  ]);
  assert(cmp.showComparePalette === true, 'palette only on compare');
}

{
  const flightNew = buildTheaterScene(sample, { stage: 'flight_matrix' });
  assert(flightNew.pills.every((p) => p.tone === 'flight'), 'flight_matrix pills');
  const stayNew = buildTheaterScene(sample, { stage: 'stay_tracks' });
  assert(stayNew.pills.some((p) => /Pool/i.test(p.label)), 'stay_tracks pool');
  const openNew = buildTheaterScene(sample, { stage: 'open_space' });
  assert(openNew.pins.some((p) => p.reason), 'open_space reason');
}

console.log('researchTheater.smoke: ok');
