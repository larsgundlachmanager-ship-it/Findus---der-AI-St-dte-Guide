/**
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/navigation/handsFreeNav/cueTiming.smoke.test.ts
 */
import {
  speakStartDistanceM,
  warmDistanceM,
  estimateSpeechSec,
  FINISH_BEFORE_TURN_SEC,
} from '../speakStartDistance';
import {
  isHandsFreeSpeakTurn,
  isAlleyRoadName,
} from '../navSpeakTurn';
import {
  buildChainedTurnCue,
  findChainedNextTurn,
  CHAIN_TURN_MERGE_MAX_M,
} from '../chainedTurnCue';
import { buildFinalCueText } from './cueScheduler';
import type { NavWaypoint } from '../navigationTypes';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(FINISH_BEFORE_TURN_SEC === 5, 'Ziel: ~5 s vor Kurve fertig');

const walk4s = speakStartDistanceM({
  speechSec: 4,
  speedMps: 10,
  transportMode: 'walk',
});
assert(walk4s === 90, `4s speech @ 10 m/s → 90 m, war ${walk4s}`);

const walk5s = speakStartDistanceM({
  speechSec: 5,
  speedMps: 1.25,
  transportMode: 'walk',
});
assert(walk5s === 18, `5s speech @ 1.25 m/s → 18 m floor, war ${walk5s}`);

const floor = speakStartDistanceM({
  speechSec: 1.8,
  speedMps: 1.25,
  transportMode: 'walk',
});
assert(floor === 18, `floor 18 m, war ${floor}`);

const warm = warmDistanceM({
  speechSec: 4,
  speedMps: 10,
  transportMode: 'walk',
});
assert(warm > walk4s, `prefetch vor Speak-Start (${warm} > ${walk4s})`);

const bike4s = speakStartDistanceM({
  speechSec: 4,
  speedMps: 5.56,
  transportMode: 'bicycle',
});
assert(
  bike4s >= 45 && bike4s <= 55,
  `4s speech @ 20 km/h bike → ~50 m, war ${bike4s}`,
);

const sec = estimateSpeechSec(
  'Gleich durch die schmale Gasse links, an der Kirche.',
);
assert(sec >= 3 && sec <= 9, `echte Cue-Länge, war ${sec}`);

const chain = buildChainedTurnCue({
  firstManeuver: 'turn-right',
  secondManeuver: 'turn-left',
  gapM: 30,
});
assert(/rechts/i.test(chain) && /links/i.test(chain), `Doppel-Cue: ${chain}`);
assert(/danach/i.test(chain), `webt zweite Kurve: ${chain}`);
assert(!/\d+\s*Meter/i.test(chain), `kein Meter-Telegramm: ${chain}`);
assert(!/\bnimm\b/i.test(chain), `kein nimm-Jargon: ${chain}`);

const wps: NavWaypoint[] = [
  { lat: 48.76, lng: 8.93, maneuver: 'straight', roadName: null, splineAlongM: 0 },
  {
    lat: 48.7602,
    lng: 8.9302,
    maneuver: 'turn-right',
    roadName: null,
    splineAlongM: 40,
  },
  {
    lat: 48.7604,
    lng: 8.9304,
    maneuver: 'turn-left',
    roadName: null,
    splineAlongM: 70,
  },
];
const chained = findChainedNextTurn(wps, 1);
assert(chained != null && chained.gapM === 30, `chain gap 30, war ${chained?.gapM}`);
assert(chained!.gapM <= CHAIN_TURN_MERGE_MAX_M, 'unter Merge-Limit');

const merged = buildFinalCueText({
  maneuver: 'turn-right',
  landmark: null,
  roadName: null,
  distanceM: 15,
  chainNext: { maneuver: 'turn-left', gapM: 30 },
});
assert(/rechts/i.test(merged) && /links/i.test(merged), `final merged: ${merged}`);
assert(/danach/i.test(merged), `merged webt: ${merged}`);

{
  const { buildPredictiveTurnCue, weaveComplexNavCue } = require('../spatialOrientation') as typeof import('../spatialOrientation');
  const fork = weaveComplexNavCue({ kind: 'fork', turn: 'links an der Gabelung' });
  assert(/teilt sich/i.test(fork) && /links/i.test(fork), `fork weave ${fork}`);
  assert(!/\bnimm\b/i.test(fork) && !/Gabelung/i.test(fork), `fork no jargon ${fork}`);
  const simple = buildPredictiveTurnCue({
    turn: 'links',
    distanceM: 20,
    visualKind: null,
  });
  assert(!/teilt sich/i.test(simple), `simple stays cache ${simple}`);
  const complexCue = buildFinalCueText({
    maneuver: 'fork-left',
    landmark: 'Kirche',
    roadName: null,
    distanceM: 18,
    isComplexTurn: true,
  });
  assert(/Kirche/i.test(complexCue) && /teilt sich|halt dich/i.test(complexCue), `complex fork ${complexCue}`);
  const easyFork = buildFinalCueText({
    maneuver: 'fork-left',
    landmark: null,
    roadName: null,
    distanceM: 18,
    isComplexTurn: false,
  });
  assert(!/teilt sich/i.test(easyFork), `simple fork cache ${easyFork}`);
}

{
  const { readFileSync } = require('fs') as typeof import('fs');
  const { join } = require('path') as typeof import('path');
  const tickSrc = readFileSync(
    join(process.cwd(), 'src/services/navigation/handsFreeNav/tickCoach.ts'),
    'utf8',
  );
  assert(
    !/lastSpokenTurnIdx\s*=\s*chain/m.test(tickSrc) &&
      tickSrc.includes('session.lastSpokenTurnIdx = turnIdx'),
    'jede Speak-Abbiegung einzeln — kein Skip der Folgekurbel',
  );
  const schedSrc = readFileSync(
    join(process.cwd(), 'src/services/navigation/handsFreeNav/cueScheduler.ts'),
    'utf8',
  );
  assert(
    schedSrc.includes("phaseKey('final', turnIdx)"),
    'Early-Warn nur bei Final derselben Abbiegung blocken',
  );
  assert(
    !schedSrc.includes("!lastSpokenPhaseKey?.startsWith('final:')"),
    'kein globales Final-Prefix-Block über alle Abbiegungen',
  );
  assert(
    schedSrc.includes('COMPLEX_WARN_LEAD_SEC = 30') ||
      schedSrc.includes('COMPLEX_WARN_LEAD_SEC=30'),
    '30 s Vorwarnung nur komplex',
  );
}

assert(isHandsFreeSpeakTurn({ maneuver: 'slight-left' }), 'leichte Kurve');
assert(isHandsFreeSpeakTurn({ maneuver: 'fork-left' }), 'Gabelung');
assert(isHandsFreeSpeakTurn({ maneuver: 'turn-left' }), 'Abbiegung');
assert(isAlleyRoadName('Kleine Gasse'), 'Gasse');

console.log('cueTiming.smoke.test.ts OK');
