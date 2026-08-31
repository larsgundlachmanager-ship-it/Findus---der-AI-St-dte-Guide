/**
 * Run: npx --yes tsx src/services/concierge/bulletDigits.smoke.test.ts
 */
import assert from 'node:assert/strict';
import {
  compactBulletDigits,
  germanWordToNumber,
  speechHasBulletDigit,
} from './bulletDigits';

assert.equal(germanWordToNumber('siebenundzwanzigster'), 27);
assert.equal(germanWordToNumber('neunzehnhundertsechsundachtzig'), 1986);
assert.equal(
  compactBulletDigits('geboren am siebenundzwanzigsten März neunzehnhundertsechsundachtzig'),
  'geboren am 27. März 1986',
);
assert.equal(compactBulletDigits('neununddreißig Jahre alt'), '39 Jahre');
assert.ok(
  speechHasBulletDigit('siebenundzwanzigster März', '27'),
  'speech words match digit',
);

console.log('bulletDigits.smoke ok');
