/**
 * Sprint 3 — Unseen Places → Auto-Tour.
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/tour/unseenAutoTour.smoke.test.ts
 */

import assert from 'node:assert/strict';
import { shouldHandoffToTourModule } from './shouldHandoffTour';
import {
  wantsUnseenTour,
  parseEndAnchorKind,
  extractThemeFilters,
  extractAreaHint,
  parseDurationMin,
  needsDurationAsk,
  defaultUnseenTourDurationMin,
  detectTourMode,
} from './parentBrief';
import { buildTourRequestFromText } from './buildTourRequest';

const LQ =
  'Wir haben eine Stunde — was haben wir in Laboe noch nicht gesehen? Am Ende gerne am Hafen mit Parkplatz';

assert.equal(wantsUnseenTour(LQ), true, 'lq unseen');
assert.equal(wantsUnseenTour('Was habe ich in Laboe noch nicht gesehen?'), true);
assert.equal(wantsUnseenTour('Wie wird das Wetter?'), false);

assert.equal(parseEndAnchorKind(LQ), 'hafen', 'end hafen');
assert.equal(
  parseEndAnchorKind('Tour durch die Altstadt'),
  null,
  'no false end anchor',
);

assert.ok(
  !extractThemeFilters(LQ).includes('hafen'),
  `theme must not force hafen, got ${extractThemeFilters(LQ)}`,
);
assert.equal(
  extractAreaHint(LQ),
  null,
  'areaHint must not be hafen-only filter',
);

assert.equal(parseDurationMin(LQ), 60, 'eine Stunde');
assert.equal(
  needsDurationAsk({
    text: 'Was habe ich noch nicht gesehen?',
    durationMin: defaultUnseenTourDurationMin('Was habe ich noch nicht gesehen?'),
    distanceKm: null,
    hardArriveByMs: null,
  }),
  false,
  'unseen default → no ask',
);
assert.equal(defaultUnseenTourDurationMin('Was habe ich noch nicht gesehen?'), 60);

assert.equal(detectTourMode(LQ), 'stop_tour');
assert.equal(shouldHandoffToTourModule(LQ), true, 'handoff lq');
assert.equal(
  shouldHandoffToTourModule('Was habe ich in Laboe noch nicht gesehen?'),
  true,
  'handoff bare unseen',
);
assert.equal(
  shouldHandoffToTourModule('Eine Stunde Tour, was ich noch nicht gesehen habe'),
  true,
);

const built = buildTourRequestFromText({
  text: LQ,
  requestId: 'smoke_unseen',
  uiLayout: 'start_nav_now',
});
assert.equal(built.request.visitedExclude, true, 'visitedExclude');
assert.equal(built.request.timeBudgetMin, 60, 'budget 60');
assert.equal(built.request.needsDurationAsk, false, 'no ask');
assert.equal(built.request.uiLayout, 'start_nav_now', 'auto nav layout');
assert.ok(
  !(built.request.categoryMust || []).includes('hafen'),
  'categoryMust not hafen-only',
);
assert.equal(built.request.areaHint, null, 'areaHint cleared for end-only hafen');

console.log('unseenAutoTour.smoke.test.ts OK');
