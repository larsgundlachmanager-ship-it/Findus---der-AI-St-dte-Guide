/**
 * Run: npx --yes tsx src/services/navigation/navHudEta.smoke.test.ts
 */
import { pickNavHudEta } from './navHudEta';
import { stationDisplayName } from '../transit/haltName';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const now = Date.parse('2026-08-19T02:12:00+02:00');
const arrive = Date.parse('2026-08-19T09:11:00+02:00');
const hud = pickNavHudEta({
  lastStopEndMs: arrive,
  navEtaMin: 4050,
  remainingM: 337_900,
  walkFallbackMin: 4050,
  nowMs: now,
});
assert(hud.arriveMs === arrive, 'Ankunft aus Timeline, nicht Fuß-67h');
assert(hud.etaMin != null && hud.etaMin < 12 * 60, 'Dauer nicht 67 Stunden');

const waitNow = Date.parse('2026-08-20T08:00:00+02:00');
const board = Date.parse('2026-08-20T10:42:00+02:00');
const rideEnd = Date.parse('2026-08-20T12:10:00+02:00');
const rideHud = pickNavHudEta({
  lastStopEndMs: rideEnd,
  rideStartMs: board,
  navEtaMin: 250,
  remainingM: 71_200,
  walkFallbackMin: 250,
  nowMs: waitNow,
});
assert(rideHud.arriveMs === rideEnd, 'Ankunft Ziel');
assert(
  rideHud.etaMin === 88,
  `reine Fahrtdauer 10:42→12:10 = 88 Min, got ${rideHud.etaMin}`,
);

assert(
  stationDisplayName('Prisdorf', 'RAIL') === 'Bahnhof Prisdorf',
  'Bahnhof Prisdorf',
);
assert(
  stationDisplayName('Hamburg Hbf', 'RAIL') === 'Hamburg Hbf',
  'Hbf bleibt',
);
assert(
  stationDisplayName('S Springpfuhl', 'SUBWAY') === 'S Springpfuhl',
  'S-Bahn bleibt',
);
assert(
  stationDisplayName('Alt-Marzahn', 'TRAM') === 'Alt-Marzahn',
  'Tram nicht Bahnhof',
);

console.log('navHudEta.smoke.test.ts OK');
