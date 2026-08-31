/**
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/homeMap/exclusiveCityPolygons.smoke.test.ts
 */
import { exclusiveCityRings } from './exclusiveCityPolygons';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const small: Array<[number, number]> = [
  [53.67, 9.75],
  [53.67, 9.78],
  [53.69, 9.78],
  [53.69, 9.75],
];
const large: Array<[number, number]> = [
  [53.66, 9.72],
  [53.66, 9.80],
  [53.70, 9.80],
  [53.70, 9.72],
];

const out = exclusiveCityRings([
  { id: 'prisdorf', ring: small },
  { id: 'tornesch', ring: large },
]);

assert(out.length === 2, 'zwei Städte');
const tornesch = out.find((c) => c.id === 'tornesch')!;
const prisdorf = out.find((c) => c.id === 'prisdorf')!;
assert(!!tornesch && !!prisdorf, 'beide IDs');
assert(prisdorf.holes.length === 0, 'kleine Stadt ohne Loch');
assert(tornesch.holes.length >= 1, 'große Stadt hat Loch für kleine');

function inside(ring: Array<[number, number]>, lat: number, lng: number) {
  let odd = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i]!;
    const [yj, xj] = ring[j]!;
    if (
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-15) + xi
    ) {
      odd = !odd;
    }
  }
  return odd;
}

const coreLat = 53.68;
const coreLng = 9.765;
assert(inside(prisdorf.ring, coreLat, coreLng), 'Prisdorf behält Kern');
assert(inside(tornesch.ring, coreLat, coreLng), 'Tornesch-Außenring enthält Kern');
assert(
  tornesch.holes.some((h) => inside(h, coreLat, coreLng)),
  'Kern liegt im Tornesch-Loch (= kein Overlap-Fill)',
);

console.log('exclusiveCityPolygons.smoke.test.ts OK');
