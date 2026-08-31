/**
 * Run: npx --yes tsx src/module2/planning/planDestinationCity.smoke.test.ts
 */

import type { IngestedPlan, IngestOpenWish } from './planningTypes';
import {
  arrivalBreakfastHmFromUtterance,
  departureHmFromUtterance,
  destinationCityFromUtterance,
  isBreakfastWish,
  isGenericDayStartWish,
  isTravelToDestWish,
  patchPlanForDestinationCity,
  sameFoldedCity,
  userWantsDestinationDay,
} from './planDestinationCity';

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
      name: 'Start (Prisdorf)',
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

assert(sameFoldedCity('Hamburg', 'hamburg'), 'fold hamburg');
assert(!sameFoldedCity('Hamburg', 'Prisdorf'), 'hamburg ≠ prisdorf');
assert(
  destinationCityFromUtterance(
    'morgen um 9:00 Uhr los, Hamburg-Plan mit Elbphilharmonie',
    'Prisdorf',
  ) === 'Hamburg',
  'dest from utterance',
);
assert(
  destinationCityFromUtterance('um 9:00 Uhr los in Prisdorf', 'Prisdorf') == null,
  'same city is not dest',
);
assert(
  destinationCityFromUtterance(
    'abends Hamburger Pannfisch und den Michel',
    'Prisdorf',
  ) === 'Hamburg',
  'hamburger/michel imply hamburg dest',
);
assert(
  destinationCityFromUtterance('Hotel in Athen für zwei Nächte', 'Hamburg') ===
    'Athen',
  'athen dest not hamburg pack',
);

assert(
  isGenericDayStartWish({
    title: 'Aktivität / Start gegen 09:00',
    context: 'Start in den Tag gegen 09:00 Uhr',
  }),
  'generic start wish',
);
assert(
  !isGenericDayStartWish({
    title: 'Pannfisch Hamburg',
    context: 'Essen in Hamburg mit Elbblick',
  }),
  'named city is not generic start',
);

const utterance =
  'Morgen um 9:00 Uhr los, ich will den ganzen Hamburg-Plan machen: Elphi, Hafen, danach essen.';
assert(userWantsDestinationDay(utterance), 'hamburg day plan');

const patched = patchPlanForDestinationCity(
  emptyPlan([
    wish({
      title: 'Aktivität / Start gegen 09:00',
      context: 'Start in den Tag gegen 09:00 Uhr',
      estimatedTime: '09:00',
    }),
  ]),
  utterance,
  'Prisdorf',
);

assert(patched.destinationCity === 'Hamburg', `dest=${patched.destinationCity}`);
assert(
  patched.openWishesQueue.some((w) => isTravelToDestWish(w)),
  'generic start becomes anreise',
);
assert(
  patched.openWishesQueue.some((w) => /hamburg/i.test(`${w.title} ${w.context}`)),
  'wishes mention hamburg',
);
assert(
  patched.openWishesQueue.some((w) => w.priority === 6 || /erkunden/i.test(w.title)),
  'explore wish for dest city',
);
assert(
  !patched.openWishesQueue.some((w) => /aktivit/i.test(w.title)),
  'no leftover local activity slot',
);

const travelUtt =
  'Ich will erst um 9 Uhr los, also Bahn ab 9 Uhr, Frühstück dann bei Ankunft, voraussichtlich ab 10 Uhr, Hamburg erkunden.';
assert(departureHmFromUtterance(travelUtt) === '09:00', 'depart 09:00 from los/bahn');
assert(
  arrivalBreakfastHmFromUtterance(travelUtt, '09:00') === '10:00',
  'breakfast 10:00 at arrival',
);

const travelPatched = patchPlanForDestinationCity(
  emptyPlan([
    wish({
      title: 'Frühstück',
      context: 'Frühstück in Prisdorf',
      estimatedTime: '09:00',
    }),
    wish({
      title: 'Aktivität / Start gegen 09:00',
      context: 'Start in den Tag gegen 09:00 Uhr',
      estimatedTime: '09:00',
    }),
  ]),
  travelUtt,
  'Prisdorf',
);

const travelWish = travelPatched.openWishesQueue.find((w) => isTravelToDestWish(w));
const breakfastWish = travelPatched.openWishesQueue.find((w) => isBreakfastWish(w));
assert(travelWish?.estimatedTime === '09:00', `travel at 09:00, got ${travelWish?.estimatedTime}`);
assert(/bahn/i.test(travelWish?.title ?? ''), `travel is train, got ${travelWish?.title}`);
assert(breakfastWish?.estimatedTime === '10:00', `breakfast at 10:00, got ${breakfastWish?.estimatedTime}`);
assert(
  /hamburg/i.test(`${breakfastWish?.title} ${breakfastWish?.context}`),
  'breakfast in dest city',
);
assert(
  !travelPatched.openWishesQueue.some(
    (w) => isBreakfastWish(w) && w.estimatedTime === '09:00',
  ),
  'no breakfast at depart time',
);

const correctionUtt =
  'Ich will erst um 9 Uhr los, also Bahn ab 9 Uhr, Frühstück dann bei Ankunft, voraussichtlich ab 10 Uhr.';
const correctionPlan = emptyPlan([
  wish({
    title: 'Frühstück',
    context: 'Frühstück',
    estimatedTime: '09:00',
  }),
]);
correctionPlan.destinationCity = 'Hamburg';
const corrected = patchPlanForDestinationCity(correctionPlan, correctionUtt, 'Prisdorf');
assert(corrected.destinationCity === 'Hamburg', 'keep dest on time correction');
assert(
  corrected.openWishesQueue.find((w) => isTravelToDestWish(w))?.estimatedTime ===
    '09:00',
  'correction: train 09:00',
);
assert(
  corrected.openWishesQueue.find((w) => isBreakfastWish(w))?.estimatedTime ===
    '10:00',
  'correction: breakfast 10:00',
);

assert(
  userWantsDestinationDay(
    'Morgen nach Hamburg, frühstücken, abends Pannfisch, Michel rauf',
  ),
  'spoken 4-point hamburg day without plan-verb',
);
assert(
  userWantsDestinationDay(
    'ich will morgen nach hamburg, typisch hamburgerisch frühstücken, pann fisch, den michel',
  ),
  'spoken hamburg day with split pann fisch',
);
assert(
  !userWantsDestinationDay('wo gibt es in Hamburg das beste Steak'),
  'single restaurant in hamburg is not a day plan',
);
assert(
  !userWantsDestinationDay(
    'ja morgen in Hamburg was zu essen wäre eine richtig gute Idee',
  ),
  'solo dining wish tomorrow is pitch not day plan',
);
assert(
  !userWantsDestinationDay('morgen in Hamburg was zu essen'),
  'short solo dining not day plan',
);
