/**
 * Run: npx --yes tsx src/services/concierge/zeroFakeActions.button-claim.test.ts
 */
import { stripOrphanButtonClaims } from './zeroFakeActions';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`ok: ${msg}`);
}

const speech =
  'Klingt nach Wunschflug Hamburg → Lissabon. Buchung mit Datum liegt als Button bereit.';

assert(
  stripOrphanButtonClaims(speech, []) ===
    'Klingt nach Wunschflug Hamburg → Lissabon.',
  'orphan button claim stripped',
);

assert(
  stripOrphanButtonClaims(speech, [
    {
      type: 'OPEN_URL',
      label: 'Flug buchen',
      payload: { url: 'https://www.kiwi.com/de/search/results/ham/lis/2026-08-20/' },
    },
  ]) === speech,
  'claim kept when button exists',
);

console.log('zeroFakeActions.button-claim.test.ts OK');
