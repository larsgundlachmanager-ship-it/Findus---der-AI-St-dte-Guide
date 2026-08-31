/**
 * Run: npx --yes tsx src/services/navigation/tourOrder.smoke.test.ts
 */

import { isHotelTourEnd, orderStopsEfficiently, pathLengthM } from './tourOrder';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const origin = { lat: 53.68, lng: 9.76 };

const a = { id: 'near', lat: 53.681, lng: 9.761 };
const b = { id: 'mid', lat: 53.69, lng: 9.78 };
const c = { id: 'far', lat: 53.72, lng: 9.82 };

const naive = [c, a, b];
const ordered = orderStopsEfficiently(origin, naive);
assert(ordered[0]!.id === 'near', 'nächster Stopp zuerst');
assert(
  pathLengthM(origin, ordered) < pathLengthM(origin, naive) - 50,
  'optimierte Reihenfolge kürzer als naive',
);

const only = orderStopsEfficiently(origin, [b]);
assert(only.length === 1 && only[0]!.id === 'mid', 'ein Stopp bleibt');

assert(isHotelTourEnd({ name: 'Hotel am Markt' }), 'Hotel-Name ist Endziel');
assert(!isHotelTourEnd({ name: 'Heimathaus' }), 'Heimathaus ist kein Hotel-Anker');

const hotel = { id: 'hotel', name: 'Hotel Strand', lat: 53.681, lng: 9.761 };
const cafe = { id: 'cafe', name: 'Café', lat: 53.72, lng: 9.82 };
const pinned = orderStopsEfficiently(origin, [hotel, cafe], {
  pinLast: (s) => isHotelTourEnd(s),
});
assert(pinned[pinned.length - 1]!.id === 'hotel', 'Hotel bleibt letztes Ziel');
assert(pinned[0]!.id === 'cafe', 'freier Stopp davor');

console.log('tourOrder.smoke.test.ts OK');
