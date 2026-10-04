/**
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/homeMap/exclusiveCityPolygons.smoke.test.ts
 */
import {
  exclusiveCityRings,
  sealRingPairToSharedSeam,
} from './exclusiveCityPolygons';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function distM(a: [number, number], b: [number, number]): number {
  const dLat = (a[0] - b[0]) * 111_320;
  const mid = ((a[0] + b[0]) / 2) * (Math.PI / 180);
  const dLng = (a[1] - b[1]) * 111_320 * Math.cos(mid);
  return Math.hypot(dLat, dLng);
}

function nearest(
  p: [number, number],
  ring: Array<[number, number]>,
): number {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const A = ring[i]!;
    const B = ring[(i + 1) % ring.length]!;
    const abLat = B[0] - A[0];
    const abLng = B[1] - A[1];
    const apLat = p[0] - A[0];
    const apLng = p[1] - A[1];
    const ab2 = abLat * abLat + abLng * abLng;
    const t =
      ab2 < 1e-24
        ? 0
        : Math.max(0, Math.min(1, (apLat * abLat + apLng * abLng) / ab2));
    const Q: [number, number] = [A[0] + t * abLat, A[1] + t * abLng];
    best = Math.min(best, distM(p, Q));
  }
  return best;
}

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
assert(tornesch.holes.length >= 1, 'Enklave: große Stadt hat Loch');
assert(inside(prisdorf.ring, 53.68, 9.765), 'Prisdorf behält Kern');
assert(
  tornesch.holes.some((h) => inside(h, 53.68, 9.765)),
  'Kern liegt im Tornesch-Loch',
);

// Synthetische Lücke — kleinere wächst an größere Kante
const left: Array<[number, number]> = [
  [53.68, 9.74],
  [53.68, 9.748],
  [53.69, 9.748],
  [53.69, 9.74],
];
const right: Array<[number, number]> = [
  [53.68, 9.75],
  [53.68, 9.76],
  [53.69, 9.76],
  [53.69, 9.75],
];
assert(nearest([53.685, 9.748], right) > 50, 'setup gap');
const sealed = sealRingPairToSharedSeam(left, right, 280);
let openSynth = 0;
for (const p of sealed.a) {
  const d = nearest(p, sealed.b);
  if (d > 8 && d < 280) openSynth += 1;
}
assert(openSynth === 0, `synth gap closed, open=${openSynth}`);

// Echte Packs Prisdorf|Tornesch (Seite-an-Seite)
const packP = JSON.parse(
  readFileSync(join(process.cwd(), 'data/staedte/prisdorf.json'), 'utf8'),
);
const packT = JSON.parse(
  readFileSync(join(process.cwd(), 'data/staedte/tornesch.json'), 'utf8'),
);
const real = exclusiveCityRings([
  { id: 'prisdorf', ring: packP._coverage.polygon as Array<[number, number]> },
  { id: 'tornesch', ring: packT._coverage.polygon as Array<[number, number]> },
]);
const rp = real.find((c) => c.id === 'prisdorf')!;
const rt = real.find((c) => c.id === 'tornesch')!;

let openGap = 0;
let nearCount = 0;
for (const p of rp.ring) {
  const d = nearest(p, rt.ring);
  if (d < 280) {
    nearCount += 1;
    if (d > 8) openGap += 1;
  }
}
assert(nearCount > 20, `Naht-Vertices got ${nearCount}`);
assert(openGap === 0, `keine offenen Lücken-Vertices, got ${openGap}`);

let deepOverlap = 0;
for (const p of rt.ring) {
  if (inside(rp.ring, p[0], p[1]) && nearest(p, rp.ring) > 15) deepOverlap += 1;
}
assert(deepOverlap === 0, `kein tiefer Overlap, got ${deepOverlap}`);

console.log('exclusiveCityPolygons.smoke.test.ts OK');
