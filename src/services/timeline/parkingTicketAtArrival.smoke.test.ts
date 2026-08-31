/**
 * Parkticket: Restzeit jetzt vs. bei Ankunft (nach Wegzeit).
 */
import { parkingTicketAtArrival } from './parkingTicketMath';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const now = Date.parse('2026-08-29T12:00:00+02:00');
const parked = now - 60 * 60_000; // seit 1 Std

const stillOk = parkingTicketAtArrival({
  nowMs: now,
  parkedAtMs: parked,
  maxDurationMin: 180,
  travelMin: 12,
});
assert(stillOk.elapsedMin === 60, 'elapsed 60');
assert(stillOk.remNowMin === 120, 'rem now 120');
assert(stillOk.remAtArrivalMin === 108, 'rem at arrival 108');

const tight = parkingTicketAtArrival({
  nowMs: now,
  parkedAtMs: parked,
  maxDurationMin: 70,
  travelMin: 15,
});
assert(tight.remNowMin === 10, 'rem now 10');
assert(tight.remAtArrivalMin === -5, '5 min over at arrival');

const noMax = parkingTicketAtArrival({
  nowMs: now,
  parkedAtMs: parked,
  maxDurationMin: null,
  travelMin: 8,
});
assert(noMax.remNowMin == null && noMax.remAtArrivalMin == null, 'no max');

console.log('parkingTicketAtArrival.smoke: ok');
