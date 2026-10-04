/**
 * Run: npx --yes tsx src/services/homeMap/extractBuildingUnderPin.smoke.test.ts
 */

import {
  findExtractBuildingUnderPin,
  packRingNeedsTileSnap,
  resolvePlaceFillRing,
} from './extractBuildingUnderPin';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const house: Array<[number, number]> = [
  [53.6781, 9.7588],
  [53.6781, 9.7591],
  [53.67835, 9.7591],
  [53.67835, 9.7588],
  [53.6781, 9.7588],
];

const feuerwehr: Array<[number, number]> = [
  [53.6772, 9.7572],
  [53.6772, 9.7581],
  [53.6779, 9.7581],
  [53.6779, 9.7572],
  [53.6772, 9.7572],
];

const buildings = [house, feuerwehr];

const hit = findExtractBuildingUnderPin(53.6782, 9.75895, buildings);
assert(hit === house, 'Pin im Haus → Haus-Ring');

const near = findExtractBuildingUnderPin(53.67805, 9.75895, buildings);
assert(near === house, 'Pin knapp neben Haus → Haus');

const box: Array<[number, number]> = [
  [53.6780, 9.7587],
  [53.6780, 9.7592],
  [53.6784, 9.7592],
  [53.6784, 9.7587],
  [53.6780, 9.7587],
];

const fromBox = resolvePlaceFillRing(53.6782, 9.75895, box, buildings);
assert(fromBox === house, 'Achsen-Box → Extract-Haus');

const wrongShared = resolvePlaceFillRing(
  53.6782,
  9.75895,
  feuerwehr,
  buildings,
);
assert(wrongShared === house, 'Pin außerhalb Shared-Feuerwehr → Haus unter Pin');

const keep = resolvePlaceFillRing(53.6782, 9.75895, house, buildings);
assert(keep === house, 'Passender Pack-Ring bleibt');

const offsetPack: Array<[number, number]> = [
  [53.6780, 9.75865],
  [53.67808, 9.7592],
  [53.67822, 9.75928],
  [53.67842, 9.75915],
  [53.67838, 9.75872],
  [53.67818, 9.75858],
  [53.6780, 9.75865],
];
const preferTile = resolvePlaceFillRing(53.6782, 9.75895, offsetPack, buildings);
assert(preferTile === house, 'versetztes Pack-Viereck → Extract-Haus unter Pin');
assert(!packRingNeedsTileSnap(offsetPack), 'Offset-Pack hat genug Ecken (kein Box-Snap)');

const diamond: Array<[number, number]> = [
  [53.6782, 9.7587],
  [53.67805, 9.75895],
  [53.6782, 9.7592],
  [53.67835, 9.75895],
  [53.6782, 9.7587],
];
assert(packRingNeedsTileSnap(diamond), 'gedrehte Raute braucht Tile-Snap');
const fromDiamond = resolvePlaceFillRing(53.6782, 9.75895, diamond, buildings);
assert(fromDiamond === house, 'Raute → Extract-Haus unter Pin');

const forestPack: Array<[number, number]> = [
  [53.69, 9.75],
  [53.69, 9.752],
  [53.692, 9.752],
  [53.692, 9.75],
  [53.69, 9.75],
];
const forest = resolvePlaceFillRing(53.691, 9.751, forestPack, buildings, {
  name: 'Wald Naherholung Hauen',
  category: 'natur',
});
assert(forest === forestPack, 'Wald nicht auf Nachbarhaus snappen');

assert(packRingNeedsTileSnap(box), 'Achsen-Box braucht Tile-Snap');
assert(packRingNeedsTileSnap(null), 'fehlender Ring braucht Tile-Snap');
assert(
  packRingNeedsTileSnap([
    [53.6, 9.7],
    [53.6, 9.701],
    [53.601, 9.701],
  ]),
  'Dreieck (< 6 Ecken) braucht Tile-Snap',
);
const realFootprint: Array<[number, number]> = [
  [53.6781, 9.7588],
  [53.67815, 9.75905],
  [53.6783, 9.7591],
  [53.67835, 9.75895],
  [53.6783, 9.7588],
  [53.67822, 9.75875],
  [53.6781, 9.7588],
];
assert(
  !packRingNeedsTileSnap(realFootprint),
  'echte OSM-Hülle (≥ 6 Ecken, keine Box) braucht keinen Snap',
);

console.log('extractBuildingUnderPin.smoke.test.ts OK');
