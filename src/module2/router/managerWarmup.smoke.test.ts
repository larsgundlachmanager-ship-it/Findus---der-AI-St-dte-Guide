/**
 * Manager Warmup Match — Hit-Rate ohne Mid-Satz-Leak.
 * Run: npx --yes --package tsx@4.19.4 tsx src/module2/router/managerWarmup.smoke.test.ts
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import {
  normalizeWarmupText,
  warmupMatchesFinalUtterance,
  WARMUP_MAX_DELTA,
} from './managerWarmupMatch';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(
  normalizeWarmupText('Wie spät ist es?') === 'wie spät ist es',
  'punct normalize',
);
assert(
  normalizeWarmupText('Äh, wo essen?') === 'wo essen',
  'filler strip',
);

assert(
  warmupMatchesFinalUtterance(
    'gibt es in der nähe ein gutes restaurant',
    'gibt es in der nähe ein gutes restaurant?',
  ),
  'punct-only final still hits',
);
assert(
  warmupMatchesFinalUtterance(
    'wo kann ich hier gut essen gehen',
    'wo kann ich hier gut essen gehen bitte',
  ),
  'small trailing delta hits',
);
assert(
  warmupMatchesFinalUtterance(
    'wie spät ist es eigentlich',
    'wie spät ist es',
  ),
  'near-final shorten hits when delta small',
);

const hamburgPartial = 'Morgen 9 Uhr los nach Hamburg, frühstücken';
const hamburgFull =
  'Morgen 9 Uhr los nach Hamburg, frühstücken, dann Speicherstadt und abends Sonnenuntergang';
assert(
  Math.abs(
    normalizeWarmupText(hamburgPartial).length -
      normalizeWarmupText(hamburgFull).length,
  ) > WARMUP_MAX_DELTA,
  'hamburg length delta exceeds max',
);
assert(
  !warmupMatchesFinalUtterance(hamburgPartial, hamburgFull),
  'long compound mid-partial must NOT replace Call-1',
);

assert(
  !warmupMatchesFinalUtterance('hi', 'wie spät ist es'),
  'too short partial rejected',
);

const warmSrc = readFileSync(
  join(process.cwd(), 'src/module2/router/managerWarmup.ts'),
  'utf8',
);
assert(warmSrc.includes('kickManagerWarmupForFinal'), 'kick on turn start');
assert(warmSrc.includes('lastReady'), 'retain last ready analysis');
assert(/STABLE_MS\s*=\s*280/.test(warmSrc), 'earlier stable debounce');
assert(/MIN_CHARS\s*=\s*10/.test(warmSrc), 'lower min chars');

const turnSrc = readFileSync(
  join(process.cwd(), 'src/module2/router/runConciergeTurn.ts'),
  'utf8',
);
assert(
  turnSrc.includes('kickManagerWarmupForFinal'),
  'runConciergeTurn kicks warmup parallel to prep',
);

const voiceSrc = readFileSync(
  join(process.cwd(), 'src/hooks/useVoiceInput.ts'),
  'utf8',
);
assert(
  voiceSrc.includes('notePartialForManagerWarmup(partial, { cityHint'),
  'hold-mic passes city/nav ctx like liveChat',
);

console.log('managerWarmup.smoke.test.ts OK');
