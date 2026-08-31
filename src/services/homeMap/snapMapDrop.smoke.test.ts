/**
 * Run: npx -p tsx@4.19.2 --yes tsx src/services/homeMap/snapMapDrop.smoke.test.ts
 */
import { snapMapLongPress } from './snapMapDrop';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const places = [
  {
    id: 12,
    name: 'Bahnhof Prisdorf',
    lat: 53.675,
    lng: 9.804,
    category: 'ÖPNV',
  },
];
const houses = [{ lat: 53.676, lng: 9.805, n: '12', s: 'Heisterhoop' }];

const toPlace = snapMapLongPress({
  lat: 53.6751,
  lng: 9.8041,
  places,
  houses,
});
assert(toPlace.kind === 'place' && toPlace.place.name.includes('Bahnhof'), 'Ort vor Adresse');

const toHouse = snapMapLongPress({
  lat: 53.67602,
  lng: 9.80502,
  places: [],
  houses,
});
assert(
  toHouse.kind === 'address' && toHouse.name.includes('Heisterhoop'),
  'Hausnummer mit Straße',
);

const far = snapMapLongPress({
  lat: 53.7,
  lng: 9.9,
  places,
  houses,
});
assert(far.kind === 'point', 'weit weg bleibt Punkt');

console.log('snapMapDrop.smoke.test.ts OK');
