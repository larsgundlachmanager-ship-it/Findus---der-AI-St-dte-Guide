/**
 * Run: npx -p tsx@4.19.2 --yes tsx src/services/homeMap/cityMapExtractGeojson.smoke.test.ts
 */

import { cityMapExtractToGeojson } from './cityMapExtractGeojson';
import type { CityMapExtract } from './cityMapExtract';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const extract: CityMapExtract = {
  v: 1,
  cityId: 'prisdorf',
  bbox: { south: 53.6, west: 9.7, north: 53.7, east: 9.8 },
  roads: [{ k: 0, c: [[53.68, 9.76], [53.681, 9.761]] }],
  buildings: [
    [
      [53.68, 9.76],
      [53.6801, 9.76],
      [53.6801, 9.761],
      [53.68, 9.761],
    ],
  ],
  water: [],
  parks: [],
  woods: [],
  rails: [],
  housenumbers: [{ lat: 53.68, lng: 9.76, n: '23', s: 'Öl Mühle' }],
  graph: { nodes: [], edges: [] },
};

const g = cityMapExtractToGeojson(extract);
assert(g.hasRoads, 'Straßen-Flag');
assert(g.roads.features[0]?.geometry.type === 'LineString', 'Straße als Line');
const b = g.buildings.features[0]?.geometry;
assert(b?.type === 'Polygon', 'Gebäude-Polygon');
if (b?.type === 'Polygon') {
  assert(b.coordinates[0]![0]![0] === 9.76, 'lng zuerst');
}
assert(g.housenumbers.features[0]?.properties?.s === 'Öl Mühle', 'Straße am Punkt');
assert(g.streets.features.some((f) => f.properties?.n === 'Öl Mühle'), 'Straßenname Fallback');

{
  const core = cityMapExtractToGeojson(extract, 'core');
  assert(core.hasRoads, 'Core hat Straßen');
  assert(core.buildings.features.length === 0, 'Core ohne Gebäude');
  assert(core.housenumbers.features.length === 0, 'Core ohne Hausnummern');
}

{
  const named: CityMapExtract = {
    ...extract,
    roads: [
      { k: 1, n: 'Testweg', c: [[53.68, 9.76], [53.6802, 9.7602]] },
      { k: 1, n: 'Testweg', c: [[53.6802, 9.7602], [53.6805, 9.7605]] },
    ],
    housenumbers: [],
  };
  const m = cityMapExtractToGeojson(named);
  const tw = m.roads.features.filter((f) => f.properties?.n === 'Testweg');
  assert(tw.length === 1, `gleichnamige Segmente gemerged (${tw.length})`);
  assert(
    tw[0]?.geometry.type === 'LineString' &&
      tw[0].geometry.coordinates.length >= 3,
    'gemergte Linie länger',
  );
}

const empty = cityMapExtractToGeojson(null);
assert(!empty.hasRoads, 'ohne Extract keine Straßen');

console.log('cityMapExtractGeojson.smoke.test.ts OK');
