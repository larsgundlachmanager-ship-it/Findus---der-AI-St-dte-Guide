/**
 * Smoke: Wake-Intent-Erkennung — viele Formulierungen, kein Fake-only.
 * Run: npx --yes tsx src/services/alarms/wakeIntentDetect.smoke.ts
 */

import { hasClockHint, isWakeAlarmIntent } from './wakeIntentDetect';

const SHOULD_MATCH = [
  'Wecke mich um 8 Uhr morgens',
  'weck mich um 7',
  'ich möchte gerne um 8 Uhr morgens geweckt werden',
  'ey ich muss um 8 Uhr morgens aufstehen',
  'Ich muss um 8 aufstehen',
  'Wecker um 7',
  'stell mir einen Wecker auf 6:30',
  'Erinner mich morgen früh um 8',
  'mach dass ich um 7 wach bin',
  'wann muss ich aufstehen',
  'Alarm um 6 Uhr',
  'aufstehen um 5:45',
  'morgen früh um 8 raus',
];

const SHOULD_NOT = [
  'Was geht heute Abend?',
  'Erzähl mir was über den Dom',
  'Wie spät ist es?',
  'Bring mich zum Bahnhof',
  'Erinner mich um 10 anzurufen',
  'ich möchte gerne um 9 Uhr los, dann frühstücken',
  'um 9:00 Uhr los, Bahn nehmen, abends essen',
  'Ich will um 9 Uhr los nach Hamburg',
  'wann muss ich los',
];

let failed = 0;
for (const s of SHOULD_MATCH) {
  if (!isWakeAlarmIntent(s)) {
    console.error('FAIL expect wake:', s);
    failed++;
  }
}
for (const s of SHOULD_NOT) {
  if (isWakeAlarmIntent(s)) {
    console.error('FAIL expect no wake:', s);
    failed++;
  }
}

if (!hasClockHint('um 8 Uhr')) {
  console.error('FAIL hasClockHint');
  failed++;
}

if (failed) {
  console.error(`wakeIntentDetect smoke: ${failed} failed`);
  process.exit(1);
}
console.log('wakeIntentDetect smoke: ok', SHOULD_MATCH.length, 'positives');
