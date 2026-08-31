/**
 * Run: npx --yes tsx src/services/navigation/handsFreeNav/cueTiming.smoke.test.ts
 */
import {
  speakStartDistanceM,
  warmDistanceM,
  estimateSpeechSec,
} from '../speakStartDistance';
import {
  isHandsFreeSpeakTurn,
  isAlleyRoadName,
} from '../navSpeakTurn';
import type { NavWaypoint } from '../navigationTypes';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const walk4s = speakStartDistanceM({
  speechSec: 4,
  speedMps: 10,
  transportMode: 'walk',
});
assert(walk4s === 60, `4s speech @ 10 m/s → 60 m, war ${walk4s}`);

const walk5s = speakStartDistanceM({
  speechSec: 5,
  speedMps: 1.25,
  transportMode: 'walk',
});
assert(walk5s === 9, `5s speech @ 1.25 m/s → 9 m, war ${walk5s}`);

const floor = speakStartDistanceM({
  speechSec: 1.8,
  speedMps: 1.25,
  transportMode: 'walk',
});
assert(floor === 8, `floor 8 m, war ${floor}`);

const warm = warmDistanceM({
  speechSec: 4,
  speedMps: 10,
  transportMode: 'walk',
});
assert(warm > walk4s, `prefetch vor Speak-Start (${warm} > ${walk4s})`);

const sec = estimateSpeechSec(
  'Gleich durch die schmale Gasse links, an der Kirche.',
);
assert(sec >= 3 && sec <= 8, `echte Cue-Länge, war ${sec}`);

assert(
  !isHandsFreeSpeakTurn({ maneuver: 'slight-left' }),
  'leichte Kurve ohne Gabelung bleibt still',
);
assert(
  isHandsFreeSpeakTurn({ maneuver: 'fork-left' }),
  'Gabelung links wird gesagt',
);
assert(
  isHandsFreeSpeakTurn({ maneuver: 'turn-left' }),
  'echte Abbiegung wird gesagt',
);
assert(
  isHandsFreeSpeakTurn({
    maneuver: 'slight-left',
    turnComplexity: 'complex',
  }),
  'komplexe Kreuzung auch bei slight',
);
assert(isAlleyRoadName('Kleine Gasse'), 'Gasse erkannt');
assert(
  isHandsFreeSpeakTurn({
    maneuver: 'slight-right',
    roadName: 'Twiete',
  }),
  'Gasse auch bei slight',
);

const wps: NavWaypoint[] = [
  { lat: 1, lng: 1, maneuver: 'straight', roadName: null },
  { lat: 1, lng: 1, maneuver: 'slight-left', roadName: null },
  { lat: 1, lng: 1, maneuver: 'fork-right', roadName: 'Kirchgasse' },
];
const nextIdx = wps.findIndex((wp) =>
  isHandsFreeSpeakTurn({
    maneuver: wp.maneuver,
    roadName: wp.roadName,
    turnComplexity: wp.turnComplexity,
  }),
);
assert(nextIdx === 2, `nächste Gabelung Index 2, war ${nextIdx}`);

console.log('cueTiming.smoke.test.ts OK');
