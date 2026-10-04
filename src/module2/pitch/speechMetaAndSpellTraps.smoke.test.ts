/**
 * Speech: kein Such-Prozess-Meta.
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/pitch/speechMetaAndSpellTraps.smoke.test.ts
 */
import assert from 'node:assert/strict';
import { stripSearchProcessFromSpeech } from './searchProcessSpeechStrip';

const cleaned = stripSearchProcessFromSpeech(
  'In 10 km nichts Passendes. Online erweitert (~20 km) gibt es Sushi House. Soll ich weiter suchen?',
);
assert.ok(!/10\s*km|erweitert|weiter suchen/i.test(cleaned), cleaned);
assert.ok(/Sushi House/i.test(cleaned), cleaned);

const keepDist = stripSearchProcessFromSpeech(
  'Sushi House liegt etwas weiter raus, ca. 20 Minuten.',
);
assert.ok(/Sushi House/i.test(keepDist), keepDist);
assert.ok(/20 Minuten/i.test(keepDist), keepDist);

console.log('speechMetaAndSpellTraps.smoke: ok');
