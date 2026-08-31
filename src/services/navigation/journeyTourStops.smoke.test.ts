/**
 * Run: npx --yes tsx src/services/navigation/journeyTourStops.smoke.test.ts
 */
import { collapseJourneyTourStops, foldTinyTransfers } from './journeyTourStops';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const prisdorf = {
  poiId: -1,
  name: 'Prisdorf',
  lat: 53.6769,
  lng: 9.7633,
  done: false,
  role: 'walk' as const,
  line: 'RB61',
};
const pinnebergAlight = {
  poiId: -1,
  name: 'Pinneberg',
  lat: 53.654,
  lng: 9.796,
  done: false,
  role: 'alight' as const,
  line: 'RB61',
};
const lastWalkPath = [
  { lat: 53.639, lng: 9.799 },
  { lat: 53.641, lng: 9.802 },
  { lat: 53.65, lng: 9.81 },
];
const pinnebergWalk = {
  poiId: -1,
  name: 'Pinneberg',
  lat: 53.655,
  lng: 9.798,
  done: false,
  role: 'transfer' as const,
  distanceM: 559,
  path: lastWalkPath,
};
const dhl = {
  poiId: -1,
  name: 'DHL Packstation 183',
  lat: 53.65,
  lng: 9.81,
  done: false,
  role: 'dest' as const,
};

const out = collapseJourneyTourStops(
  [prisdorf, pinnebergAlight, pinnebergWalk, dhl],
  { lat: dhl.lat, lng: dhl.lng, name: dhl.name },
);

assert(out.length === 3, `3 Stopps (Halt, Ausstieg, Ziel), war ${out.length}`);
assert(out[0]!.name === 'Prisdorf', 'erster Halt Prisdorf');
assert(out[1]!.role === 'alight' && out[1]!.name === 'Pinneberg', 'ein Pinneberg = Ausstieg');
assert(out[2]!.role === 'dest' && out[2]!.name.includes('DHL'), 'dann nur Ziel');
assert(
  Array.isArray(out[2]!.path) && (out[2]!.path as unknown[]).length >= 3,
  'letzter Fußweg bleibt als Route am Ziel',
);
assert(
  !out.some((s) => s.role === 'transfer'),
  'kein Fake-Umstieg nach derselben Bahn',
);

const springAlight = {
  poiId: -1,
  name: 'S Springpfuhl (Berlin)',
  lat: 52.5264,
  lng: 13.5364,
  done: false,
  role: 'alight' as const,
};
const springTransfer = {
  poiId: -1,
  name: 'S Springpfuhl (Berlin)',
  lat: 52.5265,
  lng: 13.5365,
  done: false,
  role: 'transfer' as const,
  distanceM: 386,
  notes: 'Umsteigen • zu Fuß',
};
const foldedSpring = foldTinyTransfers([springAlight, springTransfer]);
assert(foldedSpring.length === 1, 'gleicher Halt nicht doppelt');
assert(foldedSpring[0]!.role === 'alight', 'Ausstieg bleibt, Mini-Umstieg falten');

console.log('journeyTourStops.smoke.test.ts OK');
