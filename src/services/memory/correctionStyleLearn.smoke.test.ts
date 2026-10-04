/**
 * Style-Feedback → LearnedRule wiring (kürzer / lockerer / weniger Also).
 * Source-smoke — kein RN-Import.
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/memory/correctionStyleLearn.smoke.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(
  join(process.cwd(), 'src/services/memory/correctionLearning.ts'),
  'utf8',
);
const types = readFileSync(
  join(process.cwd(), 'src/types/learnedRules.ts'),
  'utf8',
);
const gold = readFileSync(
  join(process.cwd(), 'src/module2/blueprints/ownerGold.pack.json'),
  'utf8',
);
const ownerTs = readFileSync(
  join(process.cwd(), 'src/module2/blueprints/ownerGold.ts'),
  'utf8',
);

assert.match(src, /looksLikeSpeechStyleCorrection/, 'style helper exported');
assert.match(src, /brief_speech', 'answer_first', 'complete_sentences'/, 'kürzer → brief+complete');
assert.match(src, /casual_tone', 'complete_sentences'/, 'lockerer → casual');
assert.match(src, /boilerplate_opener', 'vague_filler'/, 'weniger Also → boilerplate');
assert.match(src, /styleHit/, 'style skips concrete_place default');
assert.match(src, /weniger\\s\+also|weniger\s+also/, 'weniger Also hint');
assert.match(src, /lockerer/, 'lockerer in correction path');
assert.match(
  src,
  /Style-Korrekturen:.*brief_speech/,
  'LLM extract knows style map',
);
assert.match(types, /brief_speech/, 'type expect brief_speech');
assert.match(types, /complete_sentences/, 'type expect complete_sentences');
assert.match(types, /boilerplate_opener/, 'type avoid boilerplate');
assert.match(types, /essay/, 'type avoid essay');
assert.match(types, /kurz und verdichtet/, 'label brief_speech');
assert.match(types, /App-Opener/, 'label boilerplate');
assert.match(ownerTs, /brief_speech/, 'ownerGold filters brief_speech');
assert.match(ownerTs, /boilerplate_opener/, 'ownerGold filters boilerplate');
assert.match(
  gold,
  /general::device_style_feedback_v1/,
  'owner gold device style feedback',
);
assert.match(gold, /brief_speech/, 'loose summary gold expects brief_speech');
assert.match(
  gold,
  /Kernel\/TTS unangetastet/,
  'gold notes kernel/tts untouched',
);

console.log('correctionStyleLearn.smoke.test.ts OK');
