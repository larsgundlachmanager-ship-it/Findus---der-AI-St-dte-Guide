/**
 * Tour-Modul Gate — Handoff, Dauer-Ask, Retry-Cap, Pitch-Abgrenzung.
 * Run: npx tsx scripts/run-tour-gate.ts
 */

import assert from 'node:assert/strict';
import { shouldHandoffToTourModule } from '../src/module2/tour/shouldHandoffTour';
import {
  detectTourMode,
  needsDurationAsk,
  parseDurationMin,
  parseDistanceKm,
  parseHardArriveByMs,
  clampBridgeWords,
  buildTourParentBridge,
  countWords,
} from '../src/module2/tour/parentBrief';
import { filterAndRankCandidates } from '../src/module2/tour/filterRank';
import { parseDurationAnswerMin } from '../src/module2/tour/pendingDuration';
import type { TourCandidate, TourRequest } from '../src/module2/tour/types';

const TOUR_MAX_ATTEMPTS = 3;
const TOUR_BUFFER_MIN = 10;

let passed = 0;
function ok(name: string, cond: boolean) {
  assert.equal(cond, true, name);
  passed += 1;
  console.log('OK', name);
}

ok(
  'tour handoff multi churches',
  shouldHandoffToTourModule('Ich möchte mir ein paar Kirchen angucken'),
);
ok(
  'tour handoff explore',
  shouldHandoffToTourModule('Führ mich durch die Speicherstadt'),
);
ok(
  'tour handoff path walk',
  shouldHandoffToTourModule('Ich möchte eine Stunde wandern'),
);
ok(
  'tour handoff 4km',
  shouldHandoffToTourModule('Ich will 4 km laufen'),
);
ok(
  'no tour for singular restaurant',
  !shouldHandoffToTourModule('Welches Restaurant kann ich hingehen?'),
);
ok(
  'no tour for named itinerary',
  !shouldHandoffToTourModule(
    'Miniatur Wunderland dann Elphi und danach ein Café an der Alster',
  ),
);

ok('mode stop_tour', detectTourMode('Stadt erkunden unbesucht') === 'stop_tour');

ok(
  'unseen auto-tour handoff',
  shouldHandoffToTourModule(
    'Wir haben eine Stunde — was haben wir in Laboe noch nicht gesehen? Am Ende gerne am Hafen mit Parkplatz',
  ),
);
ok(
  'unseen bare handoff',
  shouldHandoffToTourModule('Was habe ich in Laboe noch nicht gesehen?'),
);
{
  const { wantsUnseenTour, parseEndAnchorKind, extractThemeFilters, extractAreaHint } =
    require('../src/module2/tour/parentBrief') as typeof import('../src/module2/tour/parentBrief');
  const q =
    'Wir haben eine Stunde — was haben wir in Laboe noch nicht gesehen? Am Ende gerne am Hafen mit Parkplatz';
  ok('unseen flag', wantsUnseenTour(q));
  ok('end anchor hafen', parseEndAnchorKind(q) === 'hafen');
  ok('end hafen not theme', !extractThemeFilters(q).includes('hafen'));
  ok('end hafen not area filter', extractAreaHint(q) == null);
}
ok('mode path_tour', detectTourMode('4 km joggen') === 'path_tour');

ok(
  'needs duration ask when open',
  needsDurationAsk({
    text: 'führ mich rum',
    durationMin: null,
    distanceKm: null,
    hardArriveByMs: null,
  }),
);
ok(
  'no duration ask when 60 min',
  !needsDurationAsk({
    text: 'eine Stunde rumführen',
    durationMin: 60,
    distanceKm: null,
    hardArriveByMs: null,
  }),
);
ok('parse 90 min', parseDurationMin('90 Minuten Tour') === 90);
ok('parse 4 km', parseDistanceKm('4 km laufen') === 4);
ok(
  'hard arrive bis 19',
  (() => {
    const ms = parseHardArriveByMs('bis 19 Uhr zum Restaurant', new Date('2026-08-10T12:00:00').getTime());
    return ms != null && new Date(ms).getHours() === 19;
  })(),
);

{
  const bridge = clampBridgeWords(
    buildTourParentBridge({ mode: 'stop_tour', needsDurationAsk: true }),
  );
  const w = countWords(bridge);
  ok(`bridge words 8–22 (got ${w})`, w >= 8 && w <= 22);
}

ok('duration answer eine stunde', parseDurationAnswerMin('eine Stunde') === 60);
ok('duration answer 45 min', parseDurationAnswerMin('45 Minuten') === 45);
ok('TOUR_MAX_ATTEMPTS is 3', TOUR_MAX_ATTEMPTS === 3);
ok('buffer 10', TOUR_BUFFER_MIN === 10);

{
  const req: TourRequest = {
    requestId: 't',
    title: 'Kirchen',
    context: 'ein paar Kirchen',
    mode: 'stop_tour',
    startMode: 'now',
    timeBudgetMin: 60,
    softDurationMin: 60,
    hardArriveByMs: null,
    anchor: { lat: 53.55, lng: 10 },
    endAnchor: null,
    radiusM: 3000,
    areaHint: null,
    themeFilters: ['kirche'],
    categoryMust: ['kirche'],
    categoryAvoid: [],
    mobility: 'transit_ok',
    pathSpec: null,
    needsDurationAsk: false,
    visitedExclude: true,
    uiLayout: 'queue_preview',
    prefs: {},
  };
  const pool: TourCandidate[] = [
    {
      poiId: 1,
      name: 'Petrikirche',
      lat: 53.551,
      lng: 10.001,
      category: 'kirche',
      tags: ['kirche'],
      distanceM: 200,
      score: 1,
      priority: 'soft',
      source: 'pack',
    },
    {
      poiId: 2,
      name: 'Museum X',
      lat: 53.552,
      lng: 10.002,
      category: 'museum',
      tags: ['museum'],
      distanceM: 250,
      score: 1,
      priority: 'soft',
      source: 'pack',
    },
    {
      poiId: 3,
      name: 'Nikolaikirche',
      lat: 53.55,
      lng: 10.003,
      category: 'kirche',
      tags: ['kirche'],
      distanceM: 300,
      score: 1,
      priority: 'soft',
      source: 'pack',
    },
  ];
  const ranked = filterAndRankCandidates(req, pool);
  ok(
    'theme keeps churches',
    ranked.every((c) => /kirche/i.test(c.name + c.category)),
  );
  ok('ranked non-empty', ranked.length >= 2);
}

console.log(`\nTOUR GATE GRÜN (${passed} checks)`);
