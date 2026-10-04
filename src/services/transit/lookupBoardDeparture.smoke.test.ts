/**
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/transit/lookupBoardDeparture.smoke.test.ts
 */
import { pickBoardDeparture, pickBoardPlatform } from './enrichJourneyPlatforms';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const dep = Date.parse('2026-09-13T15:40:00+02:00');

const hit = pickBoardDeparture({
  line: 'S6',
  depMs: dep,
  candidates: [
    {
      line: 'S60',
      whenMs: dep,
      plannedWhenMs: dep,
      delaySec: 0,
      platform: '1',
      cancelled: false,
      direction: null,
    },
    {
      line: 'S6',
      whenMs: dep + 120_000,
      plannedWhenMs: dep,
      delaySec: 300,
      platform: '2',
      cancelled: false,
      direction: 'Renningen',
    },
  ],
});
assert(hit != null && hit.platform === '2', 'S6 ≠ S60 → Gleis 2');
assert(hit!.delaySec === 300, 'Delay aus Tafel');

const cancelled = pickBoardDeparture({
  line: 'RB61',
  depMs: dep,
  candidates: [
    {
      line: 'RB61',
      whenMs: dep,
      plannedWhenMs: dep,
      delaySec: null,
      platform: '3',
      cancelled: true,
      direction: null,
    },
  ],
});
assert(cancelled?.cancelled === true, 'Cancel erkannt');

assert(
  pickBoardPlatform({
    line: 'S6',
    depMs: dep,
    candidates: [
      { line: 'S60', whenMs: dep, platform: '1' },
      { line: 'S6', whenMs: dep + 60_000, platform: '2' },
    ],
  }) === '2',
  'pickBoardPlatform weiter S6≠S60',
);


const thin = pickBoardDeparture({
  line: 'Bus 745',
  depMs: dep,
  candidates: [
    {
      line: 'Bus 745',
      whenMs: dep + 240_000,
      plannedWhenMs: dep,
      delaySec: 240,
      platform: null,
      cancelled: false,
      direction: null,
    },
  ],
});
assert(thin != null && thin.delaySec === 240, 'dünner Feed: Delay ohne Platform');
assert(thin!.platform == null, 'kein erfundenes Gleis');

const thinCancel = pickBoardDeparture({
  line: 'Bus 745',
  depMs: dep,
  candidates: [
    {
      line: 'Bus 745',
      whenMs: dep,
      plannedWhenMs: dep,
      delaySec: null,
      platform: null,
      cancelled: true,
      direction: null,
    },
  ],
});
assert(thinCancel?.cancelled === true, 'Cancel ohne Platform');

console.log('lookupBoardDeparture.smoke.test.ts OK');
