/**
 * Call1 Bridge → TTS: Manager-Verfassung = nur Call-1 JSON-Stream (onBridge).
 * Run: npx --yes tsx src/module2/router/call1BridgeImmediate.smoke.test.ts
 */

import { readFileSync } from 'fs';
import { join } from 'path';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const turn = readFileSync(
  join(process.cwd(), 'src/module2/router/runConciergeTurn.ts'),
  'utf8',
);
const fused = readFileSync(
  join(process.cwd(), 'src/module2/speech/fusedTurnSpeech.ts'),
  'utf8',
);

assert(
  !/fireEarlyFloskelBridge\s*\(/.test(turn),
  'keine Early-Floskel vor Call 1',
);
assert(turn.includes('onBridge:'), 'Call-1 Stream-Bridge onBridge');
assert(
  turn.includes('JSON-Stream') || turn.includes('onBridge'),
  'Bridge aus Call-1 Stream',
);
assert(
  turn.includes('speakBridgeFromAnalysis'),
  'speakBridgeFromAnalysis für Stream',
);
assert(
  turn.includes('Early Bridge: erst nach echtem TTS-Start') ||
    turn.includes('bridgeSpokenEarly'),
  'bridgeSpokenEarly Markierung',
);

assert(fused.includes('return p.hasStarted() || starting'), 'fusedEnqueue meldet echten Start');
assert(
  !/bridgeSpokenDuringAnalyze = true;\s*\n\s*try \{\s*\n\s*const \{ markBridgeFirst \}/.test(
    turn,
  ),
  'kein optimistisches Flag vor speak (alt)',
);

console.log('call1BridgeImmediate.smoke.test.ts OK');
