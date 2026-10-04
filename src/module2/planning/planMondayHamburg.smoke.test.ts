/**
 * Run: npx --yes tsx src/module2/planning/planMondayHamburg.smoke.test.ts
 *
 * Live-STT Montag-Hamburg-Tag: Plan-Blaupause, keine Live-Nav.
 */
import { joinSttSegments } from '../../services/sttJoin';
import { isExplicitNavIntent } from '../../services/intent/poiInfoVsNav';
import { heuristicTurnFrame, mergeTurnFrame, parseTurnFrameFromLlm, frameOwnsDayPlan, frameHasWorker } from '../router/turnFrame';
import { resolveHandoff } from '../router/handoffs';
import { shouldForceModul5Handoff } from './planHandoffGuard';
import {
  looksLikeChaoticDayPlanUtterance,
  looksLikeModul5PlanUtterance,
} from './planUtteranceGate';
import { userWantsDestinationDay, destinationCityFromUtterance } from './planDestinationCity';
import {
  extractUtteranceSlots,
  mergeUtteranceSlotsIntoPlan,
  buildSkeletonPlanFromUtterance,
} from './planUtteranceSlots';
import type { IngestedPlan, IngestOpenWish } from './planningTypes';
import type { ManagerAnalysis } from '../router/types';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const SEG1 =
  'ich möchte gerne am Montag nach Hamburg so gegen 9 Uhr los und möchte da irgendwie ganz entspannt typisch hamburgerisch frühstücken abends habe ich mir überlegt mal Hamburger';
const SEG2 =
  'musst du die beste Ort wo man Hamburger pannenfisch essen kann vielleicht sogar mit mehr Blick vielleicht sogar Sonnenuntergang kann man dann am Montag einen guten Sonnenuntergang rechnen';
const SEG3 =
  'Michel draufgehen dass ich ziemlich cool ja wie teuer ist das was ist der Michel überhaupt genau ansonsten wäre einfach ein bisschen Hamburger must have ne was da muss man so gesehen haben warum Hamburg Kennenlernen';

const FULL = joinSttSegments(joinSttSegments(SEG1, SEG2), SEG3);

assert(
  /frühstücken/i.test(FULL) && /pannenfisch/i.test(FULL) && /Michel/i.test(FULL),
  'stt join keeps all three segments',
);
assert(
  !joinSttSegments(SEG1, SEG2).startsWith(SEG2),
  'longer second segment must not replace the first',
);

assert(userWantsDestinationDay(FULL), 'full utterance is dest day');
assert(userWantsDestinationDay(SEG1), 'even truncated first segment is dest day');
assert(looksLikeModul5PlanUtterance(FULL), 'full is modul 5');
assert(looksLikeModul5PlanUtterance(SEG1), 'truncated first segment is still modul 5');
assert(looksLikeChaoticDayPlanUtterance(FULL), 'full is chaotic day');
assert(shouldForceModul5Handoff(FULL), 'force m5 handoff');
assert(shouldForceModul5Handoff(SEG1), 'truncated still force m5');
assert(
  shouldForceModul5Handoff(
    'Morgen nach Hamburg, frühstücken, abends Pannfisch, Michel rauf',
  ),
  'spoken 4 points without plan-verb still m5',
);
assert(!isExplicitNavIntent(FULL), 'day plan is not live nav');
assert(!isExplicitNavIntent(SEG1), 'monday los is not live nav');
assert(
  destinationCityFromUtterance(FULL, 'Prisdorf') === 'Hamburg',
  `dest=${destinationCityFromUtterance(FULL, 'Prisdorf')}`,
);

const slots = extractUtteranceSlots(FULL);
assert(
  slots.filter((s) => s.kind === 'breakfast').length === 1,
  `exactly one breakfast: ${slots.filter((s) => s.kind === 'breakfast').map((s) => s.title).join('|')}`,
);
assert(
  slots.some((s) => s.kind === 'travel'),
  `travel: ${slots.map((s) => `${s.kind}:${s.title}`).join(',')}`,
);
assert(
  slots.some((s) => s.kind === 'breakfast'),
  `breakfast: ${slots.map((s) => `${s.kind}:${s.title}`).join(',')}`,
);
assert(
  slots.some((s) => s.kind === 'meal' || /pannenfisch|fisch/i.test(s.context)),
  `meal/pannfisch: ${slots.map((s) => `${s.kind}:${s.title}`).join(',')}`,
);
assert(
  slots.some((s) => /michel/i.test(s.title) || /michel/i.test(s.context)),
  `michel: ${slots.map((s) => `${s.kind}:${s.title}`).join(',')}`,
);
{
  const meal = slots.find((s) => s.kind === 'meal');
  if (meal) {
    assert(
      /sonnenuntergang|sunset|elbblick|blick/i.test(meal.context) ||
        !/\b(sonnenuntergang|sunset)\b/i.test(FULL),
      `meal carries view/sunset criteria: ${meal.context}`,
    );
  }
  assert(
    !slots.some((s) => /sonnenuntergang|sunset/i.test(s.title)) ||
      !slots.some((s) => s.kind === 'meal'),
    'no separate sunset sibling when meal present',
  );
}

const skeleton = buildSkeletonPlanFromUtterance({
  utterance: FULL,
  dayKey: '2026-08-24',
  gpsCity: 'Prisdorf',
  destCity: 'Hamburg',
  geoAnchor: {
    name: 'Start (Prisdorf)',
    type: 'CURRENT_GPS',
    needsClarification: false,
    lat: 53.68,
    lng: 9.76,
  },
});
assert(skeleton.destinationCity === 'Hamburg', `skel dest=${skeleton.destinationCity}`);
assert(
  skeleton.openWishesQueue.some((w) => /anreise|hamburg/i.test(`${w.title} ${w.context}`)),
  `skel travel: ${skeleton.openWishesQueue.map((w) => w.title).join(' | ')}`,
);
assert(
  skeleton.openWishesQueue.filter((w) => /frühstück|fruehstueck/i.test(w.title))
    .length === 1,
  'skel exactly one breakfast',
);
assert(
  skeleton.openWishesQueue.some((w) => /frühstück|fruehstueck/i.test(w.title)),
  'skel breakfast',
);
assert(
  skeleton.openWishesQueue.some((w) =>
    /pannenfisch|michel|essen/i.test(`${w.title} ${w.context}`),
  ),
  `skel named: ${skeleton.openWishesQueue.map((w) => w.title).join(' | ')}`,
);
{
  const meal = skeleton.openWishesQueue.find((w) =>
    /pann(?:en)?fisch|abendessen|^essen\b/i.test(w.title) ||
      (/\bpann(?:en)?fisch\b/i.test(w.context) &&
        !/frühstück|fruehstueck/i.test(w.title)),
  );
  assert(Boolean(meal), `skel meal: ${skeleton.openWishesQueue.map((w) => w.title).join('|')}`);
  assert(
    /sonnenuntergang|sunset|blick|elbblick/i.test(meal!.context) ||
      /sonnenuntergang|sunset|blick|elbblick/i.test(meal!.title),
    `skel meal has view/sunset in context: ${meal!.context}`,
  );
  assert(
    !skeleton.openWishesQueue.some((w) => /sonnenuntergang/i.test(w.title)),
    'skel: no separate sunset wish',
  );
  assert(
    skeleton.openWishesQueue.some((w) => /michel/i.test(w.title)),
    'skel michel landmark slot',
  );
}

const frame = heuristicTurnFrame(FULL, 'Prisdorf');
assert(frame.destCity === 'Hamburg', `frame dest=${frame.destCity}`);
assert(frameOwnsDayPlan(frame), 'heuristic owns day plan');
assert(!frameHasWorker(frame, 'flight'), 'not a leftover flight');

const stolenBack = mergeTurnFrame(
  parseTurnFrameFromLlm(
    {
      destCity: 'Athen',
      work: [{ id: 'flight', worker: 'flight', brief: 'Athen Leave-by' }],
    },
    'Prisdorf',
  ),
  frame,
);
assert(frameOwnsDayPlan(stolenBack), 'heuristic plan wins over leftover flight LLM');
assert(!frameHasWorker(stolenBack, 'flight'), 'dead flight thread does not own the day');

const analysis = {
  route: 'm5_plan',
  chatLane: 'plan',
  frame: stolenBack,
} as ManagerAnalysis;
assert(
  resolveHandoff(analysis) === 'm5_plan',
  `compound day opens planning module, got ${resolveHandoff(analysis)}`,
);

const empty: IngestedPlan = {
  targetDate: '2026-08-24',
  geoAnchor: skeleton.geoAnchor,
  destinationCity: 'Hamburg',
  fixedNodes: [],
  openWishesQueue: [] as IngestOpenWish[],
  tasks: [],
  lageMode: 'new',
  bridgeSpeech: '',
  openQuestions: [],
  initialVoiceConfirm: '',
};
const merged = mergeUtteranceSlotsIntoPlan(empty, FULL);
assert(
  merged.openWishesQueue.length >= 3,
  `merged slots ${merged.openWishesQueue.length}: ${merged.openWishesQueue.map((w) => w.title).join(' | ')}`,
);

assert(
  isExplicitNavIntent('Bring mich zum Rathaus'),
  'real nav still matches',
);

{
  const { shouldHandoffToTourModule } = require('../tour/shouldHandoffTour') as {
    shouldHandoffToTourModule: (s: string) => boolean;
  };
  const withTour =
    'Morgen 9 Uhr los nach Hamburg, frühstücken, abends Pannfisch mit Elbblick, Michel rauf, zwischendurch eine Tour.';
  assert(
    !shouldHandoffToTourModule(withTour),
    'compound Hamburg day must not dump a GPS pack tour',
  );
  assert(
    shouldForceModul5Handoff(withTour),
    'compound Hamburg day with Tour-word stays M5',
  );
}

// Live-PTT 2026-09-02: langer Hamburg-Tag — Plan, keine Nav / kein Theater-Only
{
  const ptt =
    'Ich habe mir überlegt, morgen nach Hamburg reinzufahren. Irgendwie um 9 Uhr los und dann in Hamburg typisch hamburgerisch frühstücken. Abends Hamburger Pannenfisch mit Elbblick zum Sonnenuntergang. Was sind die Must-Haves? Man kann auf den Michel rauf — was ist der Michel, wie teuer? Stell mir einen tollen Tag zusammen.';
  assert(shouldForceModul5Handoff(ptt), 'ptt day plan → M5');
  assert(!isExplicitNavIntent(ptt), 'ptt day plan ≠ live nav');
  assert(looksLikeModul5PlanUtterance(ptt), 'ptt looks like modul 5');
  assert(
    destinationCityFromUtterance(ptt, 'Prisdorf') === 'Hamburg',
    'ptt dest Hamburg',
  );
}

console.log('planMondayHamburg.smoke.test.ts ok');
