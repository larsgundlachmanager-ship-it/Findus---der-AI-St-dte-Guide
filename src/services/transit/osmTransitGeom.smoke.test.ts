/**
 * Run: npx --yes tsx src/services/transit/osmTransitGeom.smoke.test.ts
 */
import {
  normalizePlatformRef,
  platformTagsMatch,
  shortestRailPath,
  tidyStationNeedle,
} from './osmTransitGeom';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

assert(normalizePlatformRef('Gleis 2') === '2', 'Gleis-Präfix weg');
assert(platformTagsMatch({ ref: '1;2' }, '2'), 'ref-Liste matcht Gleis');
assert(!platformTagsMatch({ ref: '1' }, '2'), 'falsches Gleis');
assert(tidyStationNeedle('Bahnhof Pinneberg') === 'Pinneberg', 'Bahnhof-Wort weg');

const ways = [
  [
    { lat: 53.677, lng: 9.763 },
    { lat: 53.67, lng: 9.77 },
    { lat: 53.66, lng: 9.78 },
  ],
  [
    { lat: 53.66, lng: 9.78 },
    { lat: 53.65, lng: 9.79 },
    { lat: 53.639, lng: 9.799 },
  ],
];
const path = shortestRailPath(
  ways,
  { lat: 53.677, lng: 9.763 },
  { lat: 53.639, lng: 9.799 },
);
assert(path.length >= 4, `Gleiskette entlang der Ways, war ${path.length}`);
assert(path[0]!.lat > 53.67, 'Start nahe Prisdorf');
assert(path[path.length - 1]!.lat < 53.65, 'Ende nahe Pinneberg');

const air = shortestRailPath(
  [
    [
      { lat: 53.0, lng: 9.0 },
      { lat: 53.0, lng: 9.01 },
    ],
  ],
  { lat: 54.0, lng: 10.0 },
  { lat: 54.1, lng: 10.1 },
);
assert(air.length === 0, 'kein Gleis in der Nähe → keine Fake-Route');

console.log('osmTransitGeom.smoke.test.ts OK');
