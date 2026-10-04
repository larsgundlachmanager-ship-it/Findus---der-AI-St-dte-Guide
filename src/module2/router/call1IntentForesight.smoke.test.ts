/**
 * Call-1 Intent-Foresight smokes — Tennis+Regen, Badetag, Slot-Temp, Quiz-STOP.
 * Run: npx --yes tsx src/module2/router/call1IntentForesight.smoke.test.ts
 */
import assert from 'node:assert/strict';
import {
  classifyIntentForesight,
  inventIntentForesightWork,
  inventPlayActivityFromText,
  intentForesightAuthorIntent,
  isClosedFactAsk,
  isSlotOnlyWeatherAsk,
} from './call1IntentForesight';
import { inventOpenResearchExtras } from './call1MultiLane';
import { inferAnswerSlot } from './call1OpenWorldContract';

assert.equal(
  classifyIntentForesight('Wie alt ist Thomas Müller?'),
  'closed_fact',
);
assert.ok(isClosedFactAsk('Wie groß ist die Alster?'));
assert.equal(
  inventOpenResearchExtras('Wie alt ist Thomas Müller?', 'here_now').length,
  0,
  'quiz: no invent extras',
);
assert.equal(inferAnswerSlot('Wie alt ist Thomas Müller?'), 'fact');

assert.ok(isSlotOnlyWeatherAsk('Wie warm ist es heute?'));
assert.equal(classifyIntentForesight('Wie warm ist es heute?'), 'slot_weather');
assert.equal(inferAnswerSlot('Wie warm ist es heute?'), 'temperature');
const slotWork = inventIntentForesightWork('Wie warm ist es heute?', 'here_now');
assert.ok(slotWork.some((w) => w.worker === 'weather'));
assert.ok(!slotWork.some((w) => w.worker === 'pitch'), 'temp-only: no pitch');

const tennisQ =
  'Soll es heute noch regnen? Habe Lust Tennis zu spielen.';
assert.equal(classifyIntentForesight(tennisQ), 'activity_weather');
const tennisAct = inventPlayActivityFromText(tennisQ);
assert.ok(tennisAct && /tennis/i.test(tennisAct.token + tennisAct.label));
assert.ok(tennisAct!.wantsIndoorFallback, 'tennis → hall fallback');
const tennisWork = inventOpenResearchExtras(tennisQ, 'here_now');
assert.ok(
  tennisWork.some((w) => w.worker === 'weather'),
  'tennis+rain: weather',
);
assert.ok(
  tennisWork.some((w) => w.worker === 'pitch'),
  'tennis+rain: pitch',
);
assert.ok(
  tennisWork.some((w) => /halle|indoor|fallback/i.test(w.brief + w.id)),
  'tennis+rain: indoor fallback work',
);
assert.equal(inferAnswerSlot(tennisQ), 'activity_weather');
assert.ok(
  /Doppel-Intent|Halle|Regenfenster/i.test(intentForesightAuthorIntent(tennisQ)),
);

const beachQ =
  'Wie soll heute das Wetter werden? Ich habe Lust zum Badesee zu fahren.';
assert.equal(classifyIntentForesight(beachQ), 'day_plan_outdoor');
const beachWork = inventOpenResearchExtras(beachQ, 'here_now');
assert.ok(beachWork.some((w) => w.worker === 'weather'));
assert.ok(beachWork.some((w) => w.worker === 'pitch'));
assert.ok(/Call 1|Badetag|Pitch/i.test(intentForesightAuthorIntent(beachQ)));

const eveningTennis = 'Heute Abend Tennis spielen — wo geht das?';
assert.equal(classifyIntentForesight(eveningTennis), 'activity_weather');
assert.ok(
  inventOpenResearchExtras(eveningTennis, 'here_now').some((w) =>
    /halle|indoor|fallback/i.test(w.brief + w.id),
  ),
  'evening tennis still invents hall foresight',
);

console.log('call1IntentForesight.smoke: ok');
