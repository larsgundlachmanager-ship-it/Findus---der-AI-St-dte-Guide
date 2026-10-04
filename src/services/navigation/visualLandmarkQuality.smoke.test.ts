/**
 * Run: npx --yes tsx src/services/navigation/visualLandmarkQuality.smoke.test.ts
 */
import {
  isTrafficRelevantLandmark,
  isWeakVisualLandmark,
  looksLikeStreetLandmark,
  shouldSpeakLandmarkOnTurn,
} from './visualLandmarkQuality';
import { formatNavTurnHint } from './navTurnHint';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(isWeakVisualLandmark('Wartehäuschen'), 'wartehaeuschen weak');
assert(isWeakVisualLandmark('Briefkasten'), 'briefkasten weak');
assert(isWeakVisualLandmark('Broschürenplatz'), 'broschuere weak');
assert(
  isWeakVisualLandmark('Heimatverein Broschüre Straßen gestern und heute'),
  'heimatverein brochure weak',
);
assert(isWeakVisualLandmark('Laden (convenience)'), 'laden weak');
assert(!isWeakVisualLandmark('Ampel'), 'ampel ok');
assert(isTrafficRelevantLandmark('Ampel'), 'ampel traffic');
assert(isTrafficRelevantLandmark('Brücke'), 'bruecke traffic');
assert(isTrafficRelevantLandmark('Tunnel'), 'tunnel traffic');
assert(isTrafficRelevantLandmark('Treppe'), 'treppe traffic');
assert(!isTrafficRelevantLandmark('Kirche St. Nikolai'), 'kirche not traffic');
assert(looksLikeStreetLandmark('Bahnhofstraße'), 'street');
assert(looksLikeStreetLandmark('Lindenallee'), 'allee');

assert(
  !shouldSpeakLandmarkOnTurn({
    landmark: 'Kirche',
    isComplexTurn: false,
  }),
  'simple turn: no church',
);
assert(
  shouldSpeakLandmarkOnTurn({
    landmark: 'Ampel',
    isComplexTurn: false,
    distanceM: 3,
  }),
  'simple: Ampel ≤5 m ok',
);
assert(
  !shouldSpeakLandmarkOnTurn({
    landmark: 'Ampel',
    isComplexTurn: false,
    distanceM: 12,
  }),
  'simple: Ampel >5 m nein',
);
assert(
  !shouldSpeakLandmarkOnTurn({
    landmark: 'Bahnhofstraße',
    isComplexTurn: true,
  }),
  'Straße allein auch komplex nicht',
);
assert(
  !shouldSpeakLandmarkOnTurn({
    landmark: 'Wartehäuschen',
    isComplexTurn: true,
  }),
  'Wartehäuschen nie',
);

const simple = formatNavTurnHint({
  landmark: 'Heimatverein Broschüre Straßen gestern und heute',
  maneuver: 'turn-right',
  distanceM: 150,
  isComplex: false,
});
assert(
  simple === 'In 150 m rechts',
  `simple HUD ohne Broschüre, war: ${simple}`,
);

const now = formatNavTurnHint({
  maneuver: 'turn-right',
  distanceM: 8,
  isComplex: false,
});
assert(
  now === 'Gleich rechts',
  `gleich-Phrase, war: ${now}`,
);

const complex = formatNavTurnHint({
  maneuver: 'turn-right',
  distanceM: 150,
  isComplex: true,
  roadName: 'Bahnhofstraße',
});
assert(
  /rechts/i.test(complex || '') && /Bahnhofstraße/i.test(complex || ''),
  `complex mit Straße, war: ${complex}`,
);

console.log('visualLandmarkQuality.smoke.test.ts OK');
