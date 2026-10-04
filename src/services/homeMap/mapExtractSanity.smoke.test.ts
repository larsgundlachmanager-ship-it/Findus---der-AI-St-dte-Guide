import assert from 'node:assert/strict';
import { isMapExtractRoadsSane } from './mapExtractSanity';
import type { CityMapExtract } from './cityMapExtract';

const ok: CityMapExtract = {
  v: 1,
  cityId: 'x',
  bbox: { south: 0, west: 0, north: 1, east: 1 },
  roads: [{ k: 1, c: [[0, 0], [0.1, 0.1]] }],
  buildings: [],
  water: [],
  parks: [],
  woods: [],
  rails: [],
  housenumbers: [],
  graph: { nodes: [], edges: [] },
};

assert(isMapExtractRoadsSane(ok), 'roads ok');
assert(
  !isMapExtractRoadsSane({
    ...ok,
    roads: [],
    buildings: [[[0, 0], [0, 1], [1, 1], [0, 0]]],
  }),
  'buildings ohne straßen = corrupt',
);

console.log('mapExtractSanity.smoke.test.ts OK');
