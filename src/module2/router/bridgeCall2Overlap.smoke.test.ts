/**
 * Bridge → Call-2 ohne Luftloch — Orchestrierung (kein TTS-Umbau).
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/router/bridgeCall2Overlap.smoke.test.ts
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import {
  beginPaceTurn,
  notePaceBridgeStarted,
  getPaceTurn,
  flushPaceTurnSample,
} from '../reboot/pipeline/paceTurnSession';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const turn = readFileSync(
  join(process.cwd(), 'src/module2/router/runConciergeTurn.ts'),
  'utf8',
);
const pace = readFileSync(
  join(process.cwd(), 'src/module2/reboot/pipeline/paceTurnSession.ts'),
  'utf8',
);

assert(turn.includes('earlyFanoutPromise'), 'early fanout promise');
assert(turn.includes('prefetchFanout'), 'prefetch gate');
assert(
  turn.includes('earlyFanoutPromise ??'),
  'fanout reuses early promise',
);
assert(
  turn.includes('researchP') && turn.includes('Promise.all([eventWaitP, researchP])'),
  'events research parallel to bridge intro',
);
assert(
  turn.includes('speechMs') && turn.includes('notePaceBridgeStarted(Date.now(), speechMs)'),
  'bridge pace uses word duration',
);
assert(
  pace.includes('speechDurationMs') && pace.includes('Math.min(4500'),
  'pace caps research-budget misuse',
);

// Runtime: 10-Wort-Bridge ~3.8s Ende — nicht 10s Research-Budget
void flushPaceTurnSample();
beginPaceTurn({
  turnId: 't_gap',
  userText: 'wo essen',
  execution: 'task_fanout',
  bridgeBudgetSec: 12,
});
const t0 = Date.now();
notePaceBridgeStarted(t0, 10 * 380);
const pt = getPaceTurn();
assert(pt?.bridgeEndedAtMs != null, 'ended estimate set');
const est = (pt!.bridgeEndedAtMs as number) - t0;
assert(est >= 3000 && est <= 4500, `word estimate ~3.8s got ${est}`);
assert(est < 8000, 'must not use 12s research budget');
void flushPaceTurnSample();

console.log('bridgeCall2Overlap.smoke.test.ts OK');
