/**
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/transit/enrichJourneyPlatforms.smoke.test.ts
 */
import { pickBoardPlatform } from './enrichJourneyPlatforms';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const dep = Date.parse('2026-09-13T15:40:00+02:00');

assert(
  pickBoardPlatform({
    line: 'S6',
    depMs: dep,
    candidates: [
      { line: 'S60', whenMs: dep, platform: '1' },
      { line: 'S6', whenMs: dep + 60_000, platform: '2' },
    ],
  }) === '2',
  'S6 ≠ S60 — Gleis 2',
);

assert(
  pickBoardPlatform({
    line: 'Bus 745',
    depMs: dep,
    candidates: [{ line: 'S6', whenMs: dep, platform: '3' }],
  }) == null,
  'falsche Linie → kein Gleis',
);

assert(
  pickBoardPlatform({
    line: 'RB61',
    depMs: dep,
    candidates: [
      { line: 'RB61', whenMs: dep + 20 * 60_000, platform: '4' },
    ],
  }) == null,
  'außerhalb Fenster → kein Gleis',
);

assert(
  pickBoardPlatform({
    line: 'ICE 615',
    depMs: dep,
    candidates: [{ line: 'ICE 615', whenMs: dep, platform: null }],
  }) == null,
  'Tafel ohne Platform → null (nichts erfinden)',
);

console.log('enrichJourneyPlatforms.smoke.test.ts OK');
