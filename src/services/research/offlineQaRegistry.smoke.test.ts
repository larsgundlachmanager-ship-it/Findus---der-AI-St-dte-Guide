/**
 * Run: npx --yes tsx src/services/research/offlineQaRegistry.smoke.test.ts
 */

import {
  lookupOfflineQa,
  setOfflineQaPackConfig,
  clearOfflineQaPackConfig,
} from './offlineQaRegistry';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

clearOfflineQaPackConfig();
setOfflineQaPackConfig([
  { q: 'Seit wann gibt es das DRK in Prisdorf?', a: 'Die Ortsgruppe gibt es seit 1968.' },
  { q: 'Was bedeutet der Ortsname?', a: 'Der Name kommt von einer Furt.' },
]);

assert(
  lookupOfflineQa('Wie alt ist der Papst?').length === 0,
  'Papst nicht über Stopwörter an Stadt-Q&A kleben',
);
assert(
  lookupOfflineQa('DRK Prisdorf seit wann').length >= 1,
  'echter Pack-Treffer bleibt',
);

clearOfflineQaPackConfig();
console.log('offlineQaRegistry.smoke.test.ts OK');
