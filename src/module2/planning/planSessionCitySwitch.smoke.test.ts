/**
 * Run: npx --yes tsx src/module2/planning/planSessionCitySwitch.smoke.test.ts
 */

import type { IngestedPlan } from './planningTypes';
import {
  parkPlanSessionOnCitySwitch,
  tagPlanSessionCity,
  usePlanSessionStore,
} from './planSessionState';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function plan(dest: string | null): IngestedPlan {
  return {
    targetDate: '2026-08-22',
    geoAnchor: {
      name: 'Start (Prisdorf)',
      type: 'CURRENT_GPS',
      needsClarification: false,
      lat: 53.68,
      lng: 9.76,
    },
    destinationCity: dest,
    fixedNodes: [],
    openWishesQueue: [],
    tasks: [],
    lageMode: 'new',
    bridgeSpeech: '',
    openQuestions: [],
    initialVoiceConfirm: '',
  };
}

const s = usePlanSessionStore.getState();
s.reset();
s.setActive(true);
s.setPlan(plan('Hamburg'));
tagPlanSessionCity({ cityKey: 'prisdorf', cityHint: 'Prisdorf' });
s.setPhase('await_confirm');
parkPlanSessionOnCitySwitch('Hamburg');
assert(usePlanSessionStore.getState().active, 'keep session when switching to dest');
assert(
  usePlanSessionStore.getState().phase !== 'idle',
  'dest switch must not idle the plan',
);

s.reset();
s.setActive(true);
s.setPlan(plan('Hamburg'));
tagPlanSessionCity({ cityKey: 'prisdorf', cityHint: 'Prisdorf' });
parkPlanSessionOnCitySwitch('Berlin');
assert(!usePlanSessionStore.getState().active, 'unrelated city still resets');

s.reset();
s.setActive(true);
s.setPlan(plan('Hamburg'));
tagPlanSessionCity({ cityKey: 'hamburg', cityHint: 'Hamburg' });
usePlanSessionStore
  .getState()
  .beginWaitConfirm(8_000, false, 'pack_switch')
  .then((ok) => {
    assert(ok === true, 'pack-switch wait resolves on dest switch');
    assert(usePlanSessionStore.getState().active, 'still active after pack resolve');
    usePlanSessionStore.getState().reset();
    console.log('planSessionCitySwitch.smoke.test.ts ok');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
parkPlanSessionOnCitySwitch('Hamburg');
