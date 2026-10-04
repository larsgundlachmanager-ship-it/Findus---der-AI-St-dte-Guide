/**
 * Nav-Cue darf Call-1→Call-2 fused Session nicht töten.
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/audio/navCueCall2Abort.smoke.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = process.cwd();
const queue = readFileSync(
  join(root, 'src/services/audio/streamingAudioQueueService.ts'),
  'utf8',
);
const voice = readFileSync(join(root, 'src/services/AudioVoiceService.ts'), 'utf8');
const discovery = readFileSync(
  join(root, 'src/services/navigation/contextualDiscovery.ts'),
  'utf8',
);
const present = readFileSync(
  join(root, 'src/services/concierge/presentConcierge.ts'),
  'utf8',
);

assert.match(
  queue,
  /Call-1 fertig, Call-2 noch nicht im Puffer/,
  'stream queue defers nav when Call-2 pending',
);
assert.match(
  queue,
  /navWantsGap && !next && !session\.producerDone/,
  'producer-live guard before nav gap',
);
assert.match(
  queue,
  /navWantsGap && \(next \|\| session\.producerDone\)/,
  'nav gap only with next or producer done',
);
assert.match(
  voice,
  /isFusedTurnLive/,
  'questions-busy includes fused turn',
);
assert.match(
  discovery,
  /Call-1\/Call-2 nicht hart killen/,
  'interruptAndNavigate preserves live Q&A',
);
assert.match(
  discovery,
  /if \(!questionsLive\) \{\s*await stopSpeaking\(\);/s,
  'stopSpeaking only when idle',
);
assert.match(
  present,
  /Kein stopSpeaking hier/,
  'presentConcierge never hard-stops Call speech',
);
assert.equal(
  /await stopSpeaking\(\);/.test(
    present.slice(
      present.indexOf('Bridge/Call-2'),
      present.indexOf('Context Action Policy'),
    ),
  ),
  false,
  'no stopSpeaking in present wait block',
);

console.log('navCueCall2Abort.smoke: ok');
