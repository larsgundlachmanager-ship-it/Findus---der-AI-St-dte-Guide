/**
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/speech/lastReplayableSpeech.smoke.test.ts
 */
import assert from 'node:assert/strict';
import {
  isRepeatLastSpeechIntent,
  noteLastReplayableSpeech,
  buildRepeatLastSpeechResult,
  clearLastReplayableSpeech,
  getLastReplayableSpeech,
} from './lastReplayableSpeech';

assert.equal(isRepeatLastSpeechIntent('noch mal wiederholen'), true);
assert.equal(isRepeatLastSpeechIntent('noch mal wieder holen'), true);
assert.equal(isRepeatLastSpeechIntent('Wiederholen'), true);
assert.equal(isRepeatLastSpeechIntent('sag das nochmal'), true);
assert.equal(isRepeatLastSpeechIntent('was hast du gesagt'), true);
assert.equal(isRepeatLastSpeechIntent('nochmal andere Restaurants'), false);
assert.equal(isRepeatLastSpeechIntent('nochmal suchen'), false);

clearLastReplayableSpeech();
assert.ok(buildRepeatLastSpeechResult().speech.includes('nichts'));

noteLastReplayableSpeech({
  speech: 'Papst Leo der Vierzehnte ist 70 Jahre alt.',
  bullets: ['70 Jahre'],
  cardTitle: 'Papst',
});
assert.equal(
  getLastReplayableSpeech()?.speech,
  'Papst Leo der Vierzehnte ist 70 Jahre alt.',
);
const rep = buildRepeatLastSpeechResult();
assert.equal(rep.speech, 'Papst Leo der Vierzehnte ist 70 Jahre alt.');
assert.deepEqual(rep.bullets, ['70 Jahre']);

noteLastReplayableSpeech({
  speech: 'Papst Leo der Vierzehnte ist 70 Jahre alt.',
  isReplay: true,
});
assert.equal(
  getLastReplayableSpeech()?.speech,
  'Papst Leo der Vierzehnte ist 70 Jahre alt.',
);

console.log('lastReplayableSpeech.smoke.test.ts ok');
