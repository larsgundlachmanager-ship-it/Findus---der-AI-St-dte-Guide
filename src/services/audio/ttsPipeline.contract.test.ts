/**
 * TTS Satz-Pipeline LOCK — Source-Vertrag.
 * Run: npm run test:tts-pipeline
 *
 * Fällt, sobald jemand Fast-Hook / Prefetch wieder zu Satz-für-Satz-Jobs
 * oder „erst LLM fertig, dann TTS“ zurückbaut.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');

function src(rel: string): string {
  return readFileSync(join(root, rel), 'utf8');
}

const LOCK = 'TTS_SENTENCE_PIPELINE_LOCK';

const queue = src('src/services/audio/streamingAudioQueueService.ts');
const voice = src('src/services/AudioVoiceService.ts');
const turn = src('src/module2/router/runConciergeTurn.ts');
const pump = src('src/services/audio/liveSentencePump.ts');
const chunker = src('src/services/audio/punctuationChunker.ts');
const fused = src('src/module2/speech/fusedTurnSpeech.ts');
const speechQ = src('src/module2/speech/speechQueue.ts');
const pipeline = src('src/runtime/audioPipeline.ts');

for (const [name, text] of [
  ['streamingAudioQueueService', queue],
  ['AudioVoiceService', voice],
  ['runConciergeTurn', turn],
  ['fusedTurnSpeech', fused],
  ['liveSentencePump', pump],
  ['punctuationChunker', chunker],
] as const) {
  assert.match(text, new RegExp(LOCK), `${name} must keep ${LOCK}`);
}

assert.match(queue, /const DEFAULT_LOOKAHEAD = 1;/);
assert.match(queue, /const DEFAULT_LOOKAHEAD_MAX = 6;/);
assert.match(queue, /const MAX_SYNTH_INFLIGHT = 2;/);
assert.match(
  queue,
  /while \(current && isActive\(\)\) \{\s*\/\/[^\n]*\s*growLookahead\(\);/s,
  'growLookahead must run at start of play loop (buffer grows while speaking)',
);
assert.doesNotMatch(
  queue,
  /waitUntilFinished[\s\S]{0,180}growLookahead\(\)/,
  'do not grow lookahead only after the sentence finished',
);
assert.match(
  queue,
  /pendingByIndex\.set\(index, item\);\s*emitReadyInOrder\(\);\s*void ensurePreload\(item\)/,
  'URI must enter the wait queue before preload finishes',
);
assert.match(
  queue,
  /holdPlayUntil/,
  'bridge gate keeps main clips in the wait queue',
);

assert.match(voice, /const AUDIO_QUEUE_LOOKAHEAD = 1;/);
assert.match(voice, /const AUDIO_QUEUE_LOOKAHEAD_MAX = 6;/);
assert.match(voice, /Immer live in den Job/);
assert.match(voice, /const materialize = Array\.isArray\(source\);/);
assert.doesNotMatch(voice, /\bshouldBuffer\b/);
assert.doesNotMatch(
  voice,
  /priority === 'explore' \|\| isSpeechJobQueueBusy/,
);
assert.doesNotMatch(
  voice,
  /priority === 'explore' \|\| Array\.isArray\(source\)/,
);
assert.match(
  voice,
  /await enqueueSpeechJob\(\s*async \(\) => \{[\s\S]*?speakChunkSource\(live/,
  'speakSentenceStream must enqueue the live iterator, not a fully buffered array',
);

assert.match(chunker, /export const FIRST_HOOK_MAX_CHARS = 100;/);

assert.match(fused, /warmStreamingPhrases/);
assert.match(fused, /speakRuntimeSentences/);
assert.match(turn, /beginFusedTurnSpeech/);
assert.match(turn, /getFusedTurnPump/);
assert.match(queue, /export function warmStreamingPhrases/);
assert.match(queue, /takeWarmedClip/);
assert.match(turn, /warmStreamingPhrases/);
assert.doesNotMatch(
  turn,
  /await waitForBridgingToFinish/,
  'do not wait for a second TTS session before the main answer',
);
assert.match(turn, /async function startLiveSpeechSession/);
assert.match(turn, /speakRuntimeSentences/);
assert.match(speechQ, /isFusedTurnLive/);
assert.doesNotMatch(
  turn,
  /onSpeechSentence: liveTurn/,
  'first-hook stream must not wait for live-chat flag',
);
assert.doesNotMatch(
  turn,
  /else \{\s*enqueueSpeech\(\{\s*kind: 'main',\s*text: t,\s*turnId\s*\}\);/s,
  'M1 follow-up must not enqueue each later sentence as its own job',
);

assert.match(speechQ, /playSentenceChunks\(\s*sentencesFromFullText\(next\.text\)/);
assert.match(pipeline, /speakSentenceStream/);

console.log('[ok] tts-pipeline lock: Fast-Hook + prefetch session intact');
