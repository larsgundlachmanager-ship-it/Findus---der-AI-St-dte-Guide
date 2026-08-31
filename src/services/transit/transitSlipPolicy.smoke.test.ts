/**
 * Run: npx --yes tsx src/services/transit/transitSlipPolicy.smoke.test.ts
 */
import assert from 'node:assert/strict';
import { classifyTransitSlip } from './transitSlipPolicy';

const armed = Date.parse('2026-08-19T21:46:00+02:00');
const next55 = Date.parse('2026-08-19T21:55:00+02:00');
const nowAfter = Date.parse('2026-08-19T21:47:00+02:00');
const nowBefore = Date.parse('2026-08-19T21:40:00+02:00');

assert.equal(
  classifyTransitSlip({
    nowMs: nowAfter,
    armedDepMs: armed,
    nextDepMs: next55,
    delaySec: null,
    scheduledStartMs: next55,
  }),
  'missed_next',
  'nach Abfahrt: andere Folgefahrt, keine Verspätung der verpassten',
);

assert.equal(
  classifyTransitSlip({
    nowMs: nowBefore,
    armedDepMs: armed,
    nextDepMs: next55,
    delaySec: 9 * 60,
    scheduledStartMs: armed,
  }),
  'live_delay',
  'vor Abfahrt + delaySec auf derselben geplanten Fahrt = Live-Verspätung',
);

assert.equal(
  classifyTransitSlip({
    nowMs: nowBefore,
    armedDepMs: armed,
    nextDepMs: next55,
    delaySec: null,
    scheduledStartMs: next55,
  }),
  'unchanged',
  'vor Abfahrt: Folgefahrt im Planer ist kein Miss',
);

assert.equal(
  classifyTransitSlip({
    nowMs: nowAfter,
    armedDepMs: armed,
    nextDepMs: armed + 3 * 60_000,
  }),
  'missed_next',
  'gleiche Linie +3 Min nach Abfahrt ist nicht die nächste echte Fahrt im Classifier — Caller holt ≥10 Min später',
);

console.log('transitSlipPolicy.smoke.test.ts OK');
