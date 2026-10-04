/**
 * Mic Call-1→Call-2 Farben: gelb → blau → gelb → grün.
 * Run: npx -p tsx@4.19.2 --yes tsx src/utils/phinnosMood.smoke.test.ts
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { derivePhinnosMood } from './phinnosMood';
import { resolveMicVisualState } from './micVisualState';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(
  resolveMicVisualState({
    isListening: false,
    isMicLocked: false,
    isSpeaking: true,
    isGenerating: true,
    isFinalizing: false,
  }) === 'speaking',
  'Mic: speaking > thinking',
);

assert(
  resolveMicVisualState({
    isListening: false,
    isMicLocked: false,
    isSpeaking: false,
    isGenerating: true,
    isFinalizing: false,
  }) === 'thinking',
  'Mic: generating = blau',
);

assert(
  resolveMicVisualState({
    isListening: false,
    isMicLocked: false,
    isSpeaking: false,
    isGenerating: false,
    isFinalizing: false,
  }) === 'idle',
  'Mic: idle = grün',
);

assert(
  derivePhinnosMood({
    isListening: false,
    isFinalizing: false,
    isGenerating: true,
    isPlayingAudio: false,
    isAudiblySpeaking: true,
  }) === 'speaking',
  'Mood: audible > generating',
);

assert(
  derivePhinnosMood({
    isListening: false,
    isFinalizing: false,
    isGenerating: false,
    isPlayingAudio: true,
    isAudiblySpeaking: false,
  }) === 'idle',
  'Mood: isPlayingAudio allein = idle (kein Dauerblau)',
);

const moodSrc = readFileSync(
  join(process.cwd(), 'src/utils/phinnosMood.ts'),
  'utf8',
);
assert(
  !moodSrc.includes('isStreamingAudioQueueBusy') ||
    moodSrc.includes('isLiveSpeechTransportBusy'),
  'Mood nutzt kein klebendes Streaming für Dauerblau',
);
assert(
  /if \(opts\.isFinalizing \|\| opts\.isGenerating/.test(moodSrc),
  'Mood: thinking nur über Generating/Finalizing',
);

const present = readFileSync(
  join(process.cwd(), 'src/services/concierge/presentConcierge.ts'),
  'utf8',
);
assert(
  present.includes('if (!fusedTurnLive)') &&
    present.includes('waitUntilVoicePlaying'),
  'Present: fused zeigt Card ohne Voice-Wait',
);
assert(present.includes('tries < 40'), 'Present: settle Cap ~6s');

const voice = readFileSync(
  join(process.cwd(), 'src/hooks/useVoiceInput.ts'),
  'utf8',
);
assert(
  voice.includes('tries < 40') && voice.includes('isLiveSpeechTransportBusy'),
  'Voice: Generating-Clear mit Cap',
);

console.log('phinnosMood.smoke.test.ts OK');
