/**
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/alarms/wakeConfirmSpeech.smoke.test.ts
 */
import assert from 'node:assert/strict';
import {
  buildWakeChoiceSpeech,
  buildWakeConfirmSpeech,
  formatWakeClockDe,
  formatWakeClockSpoken,
  parseWakeVoiceStyle,
  shouldAddNightFarewell,
  wakeVoiceSpeakOptions,
} from './wakeConfirmSpeech';

const eight = new Date();
eight.setHours(8, 0, 0, 0);
const eightThirty = new Date();
eightThirty.setHours(8, 30, 0, 0);

const speech = buildWakeConfirmSpeech({
  wakeAtMs: eight.getTime(),
  nowMs: new Date('2026-09-01T23:30:00+02:00').getTime(),
});
assert.equal(
  speech,
  'Alles klar, ich habe den Wecker auf 8 Uhr morgens gestellt. Gute Nacht.',
);
assert.equal(
  buildWakeConfirmSpeech({
    wakeAtMs: eight.getTime(),
    nowMs: new Date('2026-09-01T14:00:00+02:00').getTime(),
  }),
  'Alles klar, ich habe den Wecker auf 8 Uhr morgens gestellt.',
);
const sevenFortyFive = new Date();
sevenFortyFive.setHours(7, 45, 0, 0);
assert.equal(
  buildWakeConfirmSpeech({
    wakeAtMs: sevenFortyFive.getTime(),
    nowMs: new Date('2026-09-01T22:00:00+02:00').getTime(),
  }),
  'Alles klar, ich habe den Wecker auf 7:45 Uhr gestellt. Gute Nacht.',
);
assert.equal(
  buildWakeConfirmSpeech({
    wakeAtMs: sevenFortyFive.getTime(),
    nowMs: new Date('2026-09-01T14:00:00+02:00').getTime(),
    replaced: true,
  }),
  'Alles klar, ich habe den Wecker auf 7:45 Uhr umgestellt.',
);
assert.equal(
  buildWakeChoiceSpeech({
    existingWakeAtMs: eight.getTime(),
    newWakeAtMs: eightThirty.getTime(),
  }),
  'Du hast schon einen Wecker auf 8 Uhr morgens gestellt. Willst du die Zeit aktualisieren oder einen zweiten Wecker auf 8:30 Uhr stellen?',
);
assert.equal(formatWakeClockDe(eight.getTime()), '8 Uhr');
assert.equal(formatWakeClockSpoken(eight.getTime()), '8 Uhr morgens');
assert.equal(formatWakeClockDe(sevenFortyFive.getTime()), '7:45 Uhr');
assert.equal(parseWakeVoiceStyle('Wecker um 8 mit sanfter Stimme'), 'gentle');
assert.equal(parseWakeVoiceStyle('Wecker um 8'), 'normal');
assert(wakeVoiceSpeakOptions('gentle').generationConfig?.volume === 0.82);
assert(shouldAddNightFarewell(new Date('2026-09-01T22:00:00+02:00').getTime()));
assert(!shouldAddNightFarewell(new Date('2026-09-01T14:00:00+02:00').getTime()));

console.log('wakeConfirmSpeech.smoke.test.ts ok');
