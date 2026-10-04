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
assert(
  !/pickFloskelForUserText/.test(turn),
  'kein Floskel-Fallback in Concierge-Turn (nie)',
);
assert(
  turn.includes('onBridge:') &&
    (turn.includes('Bridge push') || turn.includes('speakBridgeFromAnalysis')),
  'Beat-1 = Call-1 Bridge (Stream), dann Call 2',
);
assert(
  !/fireEarlyFloskelBridge\s*\(/.test(turn) && !/pickFloskelForUserText/.test(turn),
  'kein Floskel vor Call 1',
);
assert(
  /peekAnswerLeadBridgeOrCommit/.test(turn) &&
    /Call-1 Speech immer sofort/.test(turn),
  'Call-1 Peek TTS am Turn-Start, nicht hinter Follow-Through',
);
assert(
  /call1LeadEarly/.test(turn) && turn.includes('peekAnswerLeadBridge'),
  'Instant-Lead: Call-1 Peek sofort TTS (nicht hinter Stream)',
);
assert(
  /Call-2\/Fanout starten parallel|fire-and-forget|TTS fire-and-forget/i.test(turn) ||
    /bridgeSpokenEarly: true;\s*\n\s*bridgeSpokenDuringAnalyze = true;\s*\n\s*void speakBridgeFromAnalysis/m.test(
      turn,
    ),
  'Bridge TTS nicht await vor Call-2/Backend',
);
assert(
  turn.includes('JSON-Stream') || turn.includes('onBridge'),
  'Bridge aus Call-1 Stream (Default)',
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
assert(
  turn.includes('Call-1 Prep parallel') ||
    turn.includes('threadsP = loadConversationThreads'),
  'Threads parallel vor Call-1',
);
assert(
  turn.includes('peekBulletUiBudget') ||
    turn.includes('Soft-Budget') ||
    turn.includes('Soft-Wait'),
  'Call-1 nicht hinter Bullet/Threads-FS serial',
);
assert(
  turn.includes('parallel zu Call-1') ||
    turn.includes('Explore-Hold / Travel-Mode'),
  'Explore/Travel nicht vor Call-1 blocken',
);

assert(fused.includes('return p.hasStarted() || starting'), 'fusedEnqueue meldet echten Start');
assert(
  !/bridgeSpokenDuringAnalyze = true;\s*\n\s*try \{\s*\n\s*const \{ markBridgeFirst \}/.test(
    turn,
  ),
  'kein optimistisches Flag vor speak (alt)',
);

const warm = readFileSync(
  join(process.cwd(), 'src/module2/router/managerWarmup.ts'),
  'utf8',
);
assert(
  warm.includes('loadConversationThreads'),
  'Mic-Partial wärmt Threads vor Call-1',
);
assert(
  warm.includes('kickManagerWarmupForFinal') && warm.includes('lastReady'),
  'Warmup: Turn-Kick + lastReady für höhere Hit-Rate',
);

const budget = readFileSync(
  join(process.cwd(), 'src/module2/reboot/pipeline/bulletUiBudget.ts'),
  'utf8',
);
assert(budget.includes('peekBulletUiBudget'), 'Bullet-Budget Sync-Peek');

console.log('call1BridgeImmediate.smoke.test.ts OK');
