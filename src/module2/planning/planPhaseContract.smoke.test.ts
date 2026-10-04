/**
 * Planphase SSOT-Vertrag — Detect → Ingest → Walk-Ranks → kein Early-M5.
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/planning/planPhaseContract.smoke.test.ts
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { shouldForceModul5Handoff } from './planHandoffGuard';
import {
  looksLikeChaoticDayPlanUtterance,
  looksLikeSequencedMultiStopPlan,
  looksLikeModul5PlanUtterance,
} from './planUtteranceGate';
import {
  shouldIngestCompoundPlan,
  buildCompoundPlanFromUtterance,
} from './compoundPlanIngestCore';
import { pitchWalkRank } from './planWalkOrder';
import { isBreakfastWish } from './planDestinationCity';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const HAMBURG =
  'Morgen 9 Uhr los nach Hamburg, frühstücken, abends Pannfisch mit Elbblick, Michel rauf — wie hoch, wie teuer, was ist das, zwischendurch eine Tour, Sonnenuntergang.';

const EVENING = 'Abendplanung erst essen, dann Theater';

assert(looksLikeChaoticDayPlanUtterance(HAMBURG), 'hamburg chaotic');
assert(shouldForceModul5Handoff(HAMBURG), 'hamburg force m5');
assert(shouldIngestCompoundPlan(HAMBURG), 'hamburg ingest');

assert(looksLikeSequencedMultiStopPlan(EVENING), 'evening sequenced');
assert(looksLikeModul5PlanUtterance(EVENING), 'evening modul5');
assert(shouldForceModul5Handoff(EVENING), 'evening force m5');
assert(shouldIngestCompoundPlan(EVENING), 'evening ingest');

const plan = buildCompoundPlanFromUtterance({
  userText: HAMBURG,
  dayKeyHint: '2026-09-17',
  gpsCity: 'Prisdorf',
  lat: 53.68,
  lng: 9.76,
});
assert(plan != null, 'skeleton built');

const breakfasts = plan!.openWishesQueue.filter((w) => isBreakfastWish(w));
assert(breakfasts.length === 1, `exactly one breakfast, got ${breakfasts.length}`);

const meal = plan!.openWishesQueue.find((w) =>
  /pann|fisch|essen|elbblick/i.test(`${w.title} ${w.context}`),
);
assert(Boolean(meal), 'meal wish present');
assert(
  /elbblick|sonnenuntergang|sunset/i.test(`${meal!.title} ${meal!.context}`),
  'view/sunset in meal context',
);
assert(
  !plan!.openWishesQueue.some(
    (w) =>
      w !== meal &&
      /^(sonnenuntergang|sunset|elbblick)\b/i.test(w.title.trim()),
  ),
  'no sibling sunset/elbblick stop',
);

const breakfast = { title: 'Frühstück', context: '', estimatedTime: '10:00' };
const michel = { title: 'Michel', context: 'Eintritt', estimatedTime: null };
const evening = {
  title: 'Pannfisch',
  context: 'Elbblick Sonnenuntergang',
  estimatedTime: '19:00',
};
const tour = { title: 'Tour', context: 'erkunden', estimatedTime: '11:30' };
assert(pitchWalkRank(breakfast) === 0, 'rank breakfast');
assert(pitchWalkRank(michel) === 1, 'rank landmark');
assert(pitchWalkRank(evening) === 2, 'rank evening');
assert(pitchWalkRank(tour) === 3, 'rank tour last');

{
  const turnSrc = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../router/runConciergeTurn.ts'),
    'utf8',
  );
  assert(
    !/tryEarlyM5Handoff\s*\(/.test(turnSrc),
    'no tryEarlyM5Handoff before Call-1',
  );
  assert(
    /compound ingest → auto step-loop/.test(turnSrc) &&
      /startPlanStepLoop/.test(turnSrc),
    'auto step-loop after compound ingest',
  );
  assert(
    /post-call1 force → runPlanningModule/.test(turnSrc),
    'post-call1 force M5',
  );
}

console.log('planPhaseContract.smoke.test.ts ok');
