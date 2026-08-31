/**
 * Run: npx --yes tsx src/module2/planning/planClockGuard.smoke.test.ts
 */
import { isWakeAlarmIntent } from '../../services/alarms/wakeIntentDetect';
import { clockIntentYieldsToDayPlan } from './planClockGuard';
import { looksLikeModul5PlanUtterance } from './planUtteranceGate';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const day =
  'Ich möchte gerne um 9 Uhr los, dann frühstücken, abends Pannfisch mit Elbblick zum Sonnenuntergang und den Michel.';

assert(!isWakeAlarmIntent(day), 'day plan is not wake');
assert(looksLikeModul5PlanUtterance(day), 'day plan is modul 5');
assert(clockIntentYieldsToDayPlan(day), 'clock yields to day plan');
assert(isWakeAlarmIntent('Weck mich um 7'), 'pure wake still matches');
assert(!clockIntentYieldsToDayPlan('Weck mich um 7'), 'pure wake not a day plan');
assert(!isWakeAlarmIntent('um 9 Uhr los nach Hamburg'), 'los is leave-by');
assert(
  looksLikeModul5PlanUtterance(
    'ich möchte gerne am Montag nach Hamburg so gegen 9 Uhr los und frühstücken',
  ),
  'gegen 9 uhr monday dest is modul 5',
);

console.log('planClockGuard.smoke.test.ts ok');
