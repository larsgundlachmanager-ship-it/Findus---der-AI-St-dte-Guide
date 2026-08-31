/**
 * Run: npx --yes tsx src/module2/planning/planUtteranceSlots.smoke.test.ts
 */

import type { IngestedPlan, IngestOpenWish } from './planningTypes';
import { destinationCityFromUtterance, patchPlanForDestinationCity } from './planDestinationCity';
import {
  extractUtteranceSlots,
  mergeUtteranceSlotsIntoPlan,
} from './planUtteranceSlots';
import { humanizePlanTitle } from './planSpeechSanitize';
import { looksLikeSingleJustDoItRequest } from './planUtteranceGate';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function wish(partial: Partial<IngestOpenWish> & Pick<IngestOpenWish, 'title'>): IngestOpenWish {
  return {
    priority: 5,
    context: partial.context ?? partial.title,
    completeness: 2,
    ...partial,
  };
}

function emptyPlan(wishes: IngestOpenWish[]): IngestedPlan {
  return {
    targetDate: '2026-08-22',
    geoAnchor: {
      name: 'Start',
      type: 'CURRENT_GPS',
      needsClarification: false,
      lat: 53.68,
      lng: 9.76,
    },
    destinationCity: null,
    fixedNodes: [],
    openWishesQueue: wishes,
    tasks: [],
    lageMode: 'new',
    bridgeSpeech: '',
    openQuestions: [],
    initialVoiceConfirm: '',
  };
}

const fullUtt =
  'Morgen um 9:00 Uhr los, ich will den ganzen Hamburg-Plan machen: Elphi, Hafen, danach essen.';

const slots = extractUtteranceSlots(fullUtt);
assert(
  slots.some((s) => s.kind === 'travel'),
  `travel slot: ${slots.map((s) => s.kind).join(',')}`,
);
assert(
  slots.some((s) => s.kind === 'named' && /elphi/i.test(s.title)),
  `elphi named: ${slots.map((s) => s.title).join(',')}`,
);
assert(
  slots.some((s) => s.kind === 'named' && /hafen/i.test(s.title)),
  'hafen named',
);
assert(
  slots.some((s) => s.kind === 'meal'),
  'meal slot',
);

const collapsed = patchPlanForDestinationCity(
  emptyPlan([
    wish({
      title: 'Aktivität / Start gegen 09:00',
      context: 'Start in den Tag gegen 09:00 Uhr',
      estimatedTime: '09:00',
    }),
  ]),
  fullUtt,
  'Prisdorf',
);
const merged = mergeUtteranceSlotsIntoPlan(collapsed, fullUtt);
const titles = merged.openWishesQueue.map((w) => w.title).join(' | ');
assert(merged.openWishesQueue.length >= 4, `full queue, got ${titles}`);
assert(
  merged.openWishesQueue.some((w) => /elphi/i.test(`${w.title} ${w.context}`)),
  `elphi on timeline: ${titles}`,
);
assert(
  merged.openWishesQueue.some((w) => /hafen/i.test(`${w.title} ${w.context}`)),
  `hafen on timeline: ${titles}`,
);
assert(
  merged.openWishesQueue.some((w) => /essen/i.test(`${w.title} ${w.context}`)),
  `meal on timeline: ${titles}`,
);
assert(
  merged.openWishesQueue.some((w) =>
    /anreise|bahn/i.test(`${w.title} ${w.context}`),
  ),
  `travel on timeline: ${titles}`,
);

const again = mergeUtteranceSlotsIntoPlan(merged, fullUtt);
assert(
  again.openWishesQueue.length === merged.openWishesQueue.length,
  'merge is idempotent',
);

const compound =
  'Ich möchte gerne um 9 Uhr los, dann frühstücken, abends Pannfisch zum Sonnenuntergang und den Michel.';
const compoundSlots = extractUtteranceSlots(compound);
assert(
  compoundSlots.some((s) => s.kind === 'travel'),
  `compound travel: ${compoundSlots.map((s) => s.kind).join(',')}`,
);
assert(
  compoundSlots.some((s) => s.kind === 'breakfast'),
  'compound breakfast',
);
assert(
  compoundSlots.some((s) => s.kind === 'meal'),
  `compound meal: ${compoundSlots.map((s) => s.title).join(',')}`,
);
assert(
  compoundSlots.some((s) => s.kind === 'named' && /michel/i.test(s.title)),
  `compound michel: ${compoundSlots.map((s) => s.title).join(',')}`,
);

const nightUtt =
  'Ich möchte gerne um 9:00 Uhr los, möchte dann irgendwie gerne frühstücken, abends Hamburger Pannfisch, Elbblick, zum Sonnenuntergang und dann diese Michel-Frage';
assert(
  destinationCityFromUtterance(nightUtt, 'Prisdorf') === 'Hamburg',
  `night dest from hamburger/michel, got ${destinationCityFromUtterance(nightUtt, 'Prisdorf')}`,
);
const nightPlan = patchPlanForDestinationCity(
  emptyPlan([
    wish({
      title: 'Aktivität / Start gegen 09:00',
      context: 'Start in den Tag gegen 09:00 Uhr',
      estimatedTime: '09:00',
    }),
  ]),
  nightUtt,
  'Prisdorf',
);
assert(nightPlan.destinationCity === 'Hamburg', `night dest city=${nightPlan.destinationCity}`);
assert(
  nightPlan.openWishesQueue.some((w) => /anreise|bahn|hamburg/i.test(`${w.title} ${w.context}`)),
  `night travel not local start: ${nightPlan.openWishesQueue.map((w) => w.title).join(' | ')}`,
);
assert(
  !nightPlan.openWishesQueue.some((w) => /aktivit/i.test(w.title)),
  'night: no prisdorf aktivität slot',
);
const nightMerged = mergeUtteranceSlotsIntoPlan(nightPlan, nightUtt);
assert(
  nightMerged.openWishesQueue.some((w) => /frühstück|fruehstueck/i.test(w.title)),
  'night breakfast slot',
);
assert(
  nightMerged.openWishesQueue.some((w) => /pannfisch|michel/i.test(`${w.title} ${w.context}`)),
  `night named hamburg spots: ${nightMerged.openWishesQueue.map((w) => w.title).join(' | ')}`,
);

{
  const walkUtt =
    'Um 9:00 Uhr los nach Hamburg, typisch hamburgerisch frühstücken, abends Pannfisch mit Elbblick zum Sonnenuntergang, den Michel rauf, in der Zwischenzeit Hamburg erkunden.';
  const walkSlots = extractUtteranceSlots(walkUtt);
  assert(
    walkSlots.some((s) => s.kind === 'explore'),
    `explore kept: ${walkSlots.map((s) => s.kind).join(',')}`,
  );
  const walkPlan = mergeUtteranceSlotsIntoPlan(
    emptyPlan([]),
    walkUtt,
  );
  const meal = walkPlan.openWishesQueue.find((w) =>
    /pannfisch|essen|elbblick/i.test(`${w.title} ${w.context}`),
  );
  assert(meal?.estimatedTime === '19:30', `sunset dinner ${meal?.estimatedTime}`);
  const michel = walkPlan.openWishesQueue.find((w) => /michel/i.test(w.title));
  assert(Boolean(michel), 'michel slot');
  assert(
    michel?.estimatedTime == null,
    `michel stays untimed, got ${michel?.estimatedTime}`,
  );
  const explore = walkPlan.openWishesQueue.find((w) => w.priority === 6);
  assert(Boolean(explore), 'explore on timeline with named stops');
  assert(
    explore?.estimatedTime &&
      explore.estimatedTime > '10:00' &&
      explore.estimatedTime < '19:30',
    `explore in the gap, got ${explore?.estimatedTime}`,
  );
  const sunsetOnly =
    'Abends Pannfisch zum Sonnenuntergang.';
  assert(
    !extractUtteranceSlots(sunsetOnly).some((s) => s.kind === 'explore'),
    'sunset meal does not invent a tour',
  );
}

assert(
  /tag in hamburg/i.test(humanizePlanTitle('Plane mir Tour durch in Hamburg')),
  'plan command title becomes dest day, not utterance dump',
);
assert(
  looksLikeSingleJustDoItRequest(
    'Restaurant in Hamburg mit Speisekarte, Pannfisch.',
  ),
  'restaurant+speisekarte is just-do-it even without suche/zeig',
);
assert(
  !looksLikeSingleJustDoItRequest(
    'Plane mir morgen eine Tour durch Hamburg: 9 Uhr los, Frühstück, Michel.',
  ),
  'day plan is not just-do-it',
);

console.log('planUtteranceSlots.smoke.test.ts ok');
