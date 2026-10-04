/**
 * P2 Touristen-Lücken: generisches Oder, gibt's-hier, Fixtures, Safety.
 * Run: npx --yes tsx src/module2/router/call1P2TouristGaps.smoke.test.ts
 */
import assert from 'node:assert/strict';
import {
  detectMultiLanePlan,
  extractOrEitherTokens,
  multiLaneWorkItems,
} from './call1MultiLane';
import {
  inventPlayActivityFromText,
  classifyIntentForesight,
  inventIntentForesightWork,
} from './call1IntentForesight';
import {
  classifyTouristInvent,
  inventTouristFrictionWork,
} from './call1TouristInvent';
import { inventOutdoorActivityFromText } from './outdoorWeatherGate';
import { buildCall1TaskBrief } from './call1TaskBrief';
import { emptyTurnFrame } from './turnFrame';
import type { ManagerAnalysis } from './types';

function analysis(partial: Partial<ManagerAnalysis> = {}): ManagerAnalysis {
  return {
    intentSummary: 'test',
    route: 'blueprint',
    blueprintId: null,
    blueprintStage: null,
    session: 'new',
    threadMatchId: null,
    subject: null,
    bridge: null,
    lanePlan: 'fast_only',
    pace: 'standard',
    bridgeMaxWords: 36,
    fastDeadlineMs: 8000,
    latencyHintSec: null,
    tasks: [],
    openLoops: [],
    nameAllowed: false,
    jobHint: null,
    frame: emptyTurnFrame(),
    ...partial,
  };
}

// Generisches oder
const pair = extractOrEitherTokens('Museum oder Galerie in der Nähe?');
assert.ok(pair && pair.a === 'museum' && pair.b === 'galerie');
const museumGal = detectMultiLanePlan(
  'Lust auf Museum oder Galerie — was empfiehlst du?',
);
assert.ok(museumGal, 'museum|galerie plan');
assert.equal(museumGal!.kind, 'or_either');
assert.equal(museumGal!.lanes.length, 2);
assert.ok(museumGal!.lanes.some((l) => /museum/i.test(l.label)));
assert.ok(museumGal!.lanes.some((l) => /galerie/i.test(l.label)));
const beachPool = detectMultiLanePlan(
  'Strand oder Pool — egal was näher ist',
);
assert.ok(beachPool?.kind === 'or_either');
assert.ok(
  multiLaneWorkItems(beachPool!, 'here_now').length >= 2,
  'or_either workers',
);

// gibt's hier Padel
const padel = inventPlayActivityFromText('Gibt es hier Padel in der Nähe?');
assert.ok(padel && /padel/i.test(padel.token + padel.label), 'padel invent');
assert.equal(
  classifyIntentForesight('Gibt es hier Padel?'),
  'activity_weather',
);
const padelWork = inventIntentForesightWork('Gibt es hier Padel?', 'here_now');
assert.ok(padelWork.some((w) => w.worker === 'pitch'), 'padel pitch');
assert.ok(
  !padelWork.some((w) => w.worker === 'weather'),
  'padel ohne Wetter-Cue: kein Weather- Pflicht',
);
assert.ok(inventOutdoorActivityFromText('Gibt es hier Padel?'));

// Sport fixture
assert.equal(
  classifyTouristInvent('Wann spielt das Team als nächstes? Spielplan und Tickets'),
  'sports_fixture',
);
const fixWork = inventTouristFrictionWork(
  'Wann spielt Hamburg Towers? Ticket bitte',
  'here_now',
);
assert.ok(fixWork.some((w) => w.worker === 'events'));
assert.ok(
  fixWork.some((w) => w.worker === 'deep_web' && w.wantBookingLink),
  'fixture tickets',
);

// Safety lost
assert.equal(
  classifyTouristInvent('Reisepass ist weg, wo Konsulat?'),
  'safety_lost',
);
const safetyWork = inventTouristFrictionWork(
  'Portemonnaie geklaut — Polizei und Konsulat',
  'here_now',
);
assert.ok(safetyWork.some((w) => w.worker === 'pitch'));
assert.ok(safetyWork.some((w) => w.worker === 'deep_web'));
const safetyBrief = buildCall1TaskBrief({
  analysis: analysis({ bridgeComplete: true }),
  userText: 'Reisepass weg — Konsulat bitte',
});
assert.equal(safetyBrief.bridgeComplete, false);
assert.ok(
  safetyBrief.runnableWork.some((w) => w.worker === 'pitch' || w.worker === 'deep_web'),
);

console.log('call1P2TouristGaps.smoke: ok');
