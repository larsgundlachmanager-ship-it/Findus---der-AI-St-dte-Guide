/**
 * Call1 Bridge → TTS bevor Call2: Source-Vertrag.
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
const choice = readFileSync(
  join(process.cwd(), 'src/module2/router/choiceTurnContext.ts'),
  'utf8',
);

assert(turn.includes('fireEarlyFloskelBridge'), 'Early Floskel Helper');
assert(
  turn.includes('Call-1 Bridge SOFORT nach Rewrite'),
  'Bridge startet nach Rewrite, vor Pack/Hydrate/Analyze',
);
assert(turn.includes('force: true'), 'Early Bridge force gegen Dedup-Stille');
assert(
  turn.includes('Ack erst NACH echtem Enqueue'),
  'noteLatencyAck erst nach fusedEnqueue',
);
assert(
  turn.includes('Early Bridge: erst nach echtem TTS-Start'),
  'bridgeSpokenEarly erst nach Speak',
);
assert(
  turn.includes('Early-Flag ohne laufende Session'),
  'Safety: Flag ohne Pump → nochmal Bridge',
);
assert(turn.includes('peekChoiceFastPath'), 'Choice-Fast peek vor Early Bridge');
assert(choice.includes('export function peekChoiceFastPath'), 'peekChoiceFastPath export');

assert(fused.includes('return p.hasStarted() || starting'), 'fusedEnqueue meldet echten Start');
assert(
  !/bridgeSpokenDuringAnalyze = true;\s*\n\s*try \{\s*\n\s*const \{ markBridgeFirst \}/.test(
    turn,
  ),
  'kein optimistisches Flag vor speak (alt)',
);

console.log('call1BridgeImmediate.smoke.test.ts OK');
