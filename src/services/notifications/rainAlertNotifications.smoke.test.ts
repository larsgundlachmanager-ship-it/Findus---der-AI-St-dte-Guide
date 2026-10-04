/**
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/notifications/rainAlertNotifications.smoke.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rainPushFireTimes, RAIN_PUSH_LEAD_MS } from './rainAlertLead';

assert.equal(RAIN_PUSH_LEAD_MS.thirty, 30 * 60_000);
assert.equal(RAIN_PUSH_LEAD_MS.five, 5 * 60_000);

const now = 1_700_000_000_000;
const rainIn2h = now + 2 * 60 * 60_000;
const far = rainPushFireTimes(rainIn2h, now);
assert.equal(far.t30, rainIn2h - 30 * 60_000, '30-min fire');
assert.equal(far.t5, rainIn2h - 5 * 60_000, '5-min fire');

const rainIn20 = now + 20 * 60_000;
const mid = rainPushFireTimes(rainIn20, now);
assert.equal(mid.t30, null, 'kein 30-Catch-up wenn Fenster vorbei');
assert.equal(mid.t5, rainIn20 - 5 * 60_000, '5-min noch planbar');

const rainIn3 = now + 3 * 60_000;
const late = rainPushFireTimes(rainIn3, now);
assert.equal(late.t30, null, 'kein 30 wenn <5 Min');
assert.equal(late.t5, null, 'kein 5-Catch-up wenn Fenster vorbei');

const src = readFileSync(
  join(process.cwd(), 'src/services/notifications/rainAlertNotifications.ts'),
  'utf8',
);
assert(src.includes('rainPushFireTimes'), 'uses helper');
assert(src.includes("from './rainAlertLead'"), 'lead module wired');
assert(!/\bnow \+ 3_000\b/.test(src), 'no catch-up fire30');

console.log('rainAlertNotifications.smoke.test.ts OK');
