/**
 * Run: npx --yes tsx src/services/homeMap/exclusiveHomeMapPlaces.smoke.test.ts
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  exclusiveHomeMapPlaces,
  winningStatusColor,
} from './exclusiveHomeMapPlaces';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const colorsSrc = readFileSync(
  join(process.cwd(), 'src/services/navigation/stampMapModul1.ts'),
  'utf8',
);
assert(colorsSrc.includes("liked: '#7A4FBF'"), 'Lila SSOT');
assert(colorsSrc.includes("neutral: '#C45B5B'"), 'Rot SSOT');

const purple = '#7A4FBF';
const red = '#C45B5B';
const green = '#5FA88A';

assert(winningStatusColor(purple, red) === purple, 'Auslösen schlägt Story-Rot');
assert(winningStatusColor(green, purple) === green, 'Besucht schlägt Auslösen');

const ring: Array<[number, number]> = [
  [53.675, 9.76],
  [53.675, 9.761],
  [53.6754, 9.761],
  [53.6754, 9.76],
  [53.675, 9.76],
];

const merged = exclusiveHomeMapPlaces([
  {
    id: 1,
    lat: 53.6752,
    lng: 9.7605,
    color: purple,
    ring,
  },
  {
    id: 2,
    lat: 53.6752,
    lng: 9.7605,
    color: red,
    ring: null,
    keepDot: true,
    pointOnly: true,
  },
]);

assert(merged.length === 1, 'lila Gebäude + roter Punkt = ein Ort');
assert(merged[0].color === purple, 'steht dort → würde auslösen → lila');
assert(merged[0].ring != null && merged[0].ring.length >= 3, 'Gebäude bleibt Fläche');
assert(!merged[0].keepDot && !merged[0].pointOnly, 'kein Extra-Punkt auf der Fläche');

const halt = exclusiveHomeMapPlaces([
  {
    id: 10,
    lat: 53.6752944,
    lng: 9.7602008,
    color: red,
    ring: null,
    keepDot: true,
    pointOnly: true,
    icon: 'rail',
  },
  {
    id: 11,
    lat: 53.676,
    lng: 9.762,
    color: purple,
    ring: [
      [53.6758, 9.7618],
      [53.6758, 9.7622],
      [53.6762, 9.7622],
      [53.6762, 9.7618],
      [53.6758, 9.7618],
    ],
  },
]);
assert(halt.length === 2, 'Halt auf den Gleisen bleibt getrennt vom Nachbar-Gebäude');

console.log('exclusiveHomeMapPlaces.smoke.test.ts OK');
