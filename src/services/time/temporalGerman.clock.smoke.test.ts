import assert from 'node:assert/strict';
import { parseGermanClockHm, resolveDateTimeMs } from './temporalGerman';

assert.deepEqual(parseGermanClockHm('Wecker auf 7:30'), { hour: 7, minute: 30 });
assert.deepEqual(parseGermanClockHm('stell den Wecker auf 7 Uhr 30'), {
  hour: 7,
  minute: 30,
});
assert.deepEqual(parseGermanClockHm('Wecker um sieben Uhr dreißig'), {
  hour: 7,
  minute: 30,
});
assert.deepEqual(parseGermanClockHm('halb acht Wecker'), { hour: 7, minute: 30 });
assert.deepEqual(parseGermanClockHm('Wecker um 7 Uhr'), { hour: 7, minute: 0 });

const now = new Date('2026-09-15T00:20:00+02:00');
const ms = resolveDateTimeMs({
  text: 'stell den Wecker auf 7 Uhr 30',
  now,
});
assert.ok(ms != null);
const d = new Date(ms!);
assert.equal(d.getHours(), 7);
assert.equal(d.getMinutes(), 30);

console.log('temporalGerman.clock.smoke.test.ts: ok');
