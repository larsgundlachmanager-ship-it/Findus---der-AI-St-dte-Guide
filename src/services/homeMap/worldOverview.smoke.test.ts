/**
 * Run: npx -p tsx@4.19.2 --yes tsx src/services/homeMap/worldOverview.smoke.test.ts
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getWorldLabels, getWorldOverview } from './worldOverviewGeojson';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function pointInRing(lng: number, lat: number, ring: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]![0]!;
    const yi = ring[i]![1]!;
    const xj = ring[j]![0]!;
    const yj = ring[j]![1]!;
    const hit =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

const w = getWorldOverview();
assert(w.land.features.length > 80, 'Landflächen');
assert(w.borders.features.length > 80, 'Ländergrenzen');
assert(w.urban.features.length > 80, 'Stadtflächen');
assert(w.lakes.features.length > 20, 'Seen');

let halle = false;
for (const f of w.urban.features) {
  const g = f.geometry;
  if (g.type !== 'Polygon') continue;
  if (pointInRing(11.97, 51.48, g.coordinates[0]!)) {
    halle = true;
    break;
  }
}
assert(halle, 'Halle hat grobe Stadtfläche (ohne Pack)');

const view = readFileSync(
  join(process.cwd(), 'src/components/homeMap/NativeHomeMapView.tsx'),
  'utf8',
);
assert(view.includes('id="world-land"'), 'Welt-Land in NativeHomeMapView');
assert(view.includes('id="world-admin1"'), 'Bundesländer-Grenzen');
assert(view.includes('id="world-cities"'), 'Städtenamen im NativeHomeMapView');
assert(view.includes('HOME_MAP_OVERVIEW_LOD'), 'Zoom-Treppe');
assert(view.includes('HOME_MAP_WORLD_STRUCTURE_LOD'), 'Weltstruktur-LOD');
assert(view.includes('id="world-rivers-major"'), 'große Flüsse weit sichtbar');
assert(view.includes('id="world-rivers-detail"'), 'dichtere Flüsse ab DE-Zoom');
assert(view.includes('id="world-roads-near"'), 'Fernstraßen bis Extract-Übergang');
assert(view.includes('id="world-roads-mid"'), 'dichteres Straßennetz bis Extract');
assert(view.includes('id="cities-line-dash"'), 'gestrichelte Pack-Grenze nur wenn dashed');
assert(view.includes('id="cities-label"'), 'Pack-Stadtname auf Rubbelfläche');
assert(view.includes('id="world-regions-label"'), 'Gebirgs-/Landschaftsnamen');
assert(w.admin1.features.length > 80, 'Europa-Regionen / Bundesländer');
assert(w.admin1De.features.length >= 16, '16 deutsche Bundesländer');
let sh = false;
for (const f of w.admin1De.features) {
  const g = f.geometry;
  if (g.type !== 'Polygon') continue;
  if (pointInRing(10.14, 54.32, g.coordinates[0]!)) {
    sh = true;
    break;
  }
}
assert(sh, 'Schleswig-Holstein als Bundesland (Kiel)');
for (const [name, lng, lat] of [
  ['Juist', 7.05, 53.68],
  ['Helgoland', 7.89, 54.18],
  ['London', -0.12, 51.5],
  ['Manchester', -2.24, 53.48],
  ['Dublin', -6.26, 53.35],
] as const) {
  let hit: Array<[number, number]> | null = null;
  for (const f of w.land.features) {
    const g = f.geometry;
    if (g.type !== 'Polygon') continue;
    const ring = g.coordinates[0]!;
    if (pointInRing(lng, lat, ring)) {
      hit = ring;
      break;
    }
  }
  assert(hit, `Land ${name} im Land-Paket`);
  if (name === 'Juist' || name === 'Helgoland') {
    const xs = new Set(hit!.map((p) => p[0]));
    const ys = new Set(hit!.map((p) => p[1]));
    assert(
      hit!.length >= 8 && !(xs.size <= 2 && ys.size <= 2),
      `Insel ${name} kein Rechteck (pts=${hit!.length})`,
    );
  }
}
assert(!view.includes('openfreemap') && !view.includes('tile.openstreetmap'), 'kein Tile-CDN');

const labels = getWorldLabels();
assert(labels.roads.features.length > 80, 'Fernstraßen im Welt-Paket');
assert(labels.rivers.features.length > 80, 'Flüsse im Welt-Paket');
let deRoads = 0;
let deRivers = 0;
const touchesDe = (line: Array<[number, number] | number[]>) => {
  for (const p of line) {
    const lng = Number(p[0]);
    const lat = Number(p[1]);
    if (lng > 5.5 && lng < 15.4 && lat > 47.2 && lat < 55.2) return true;
  }
  return false;
};
for (const f of labels.roads.features) {
  const g = f.geometry;
  const line =
    g.type === 'LineString'
      ? g.coordinates
      : g.type === 'MultiLineString'
        ? g.coordinates[0]
        : null;
  if (!line?.length) continue;
  if (touchesDe(line)) deRoads += 1;
}
for (const f of labels.rivers.features) {
  const g = f.geometry;
  const lines =
    g.type === 'LineString'
      ? [g.coordinates]
      : g.type === 'MultiLineString'
        ? g.coordinates
        : [];
  for (const line of lines) {
    if (line?.length && touchesDe(line)) {
      deRivers += 1;
      break;
    }
  }
}
assert(deRoads >= 200, `Deutschland-Hauptstraßen im Welt-Paket (${deRoads})`);
assert(deRivers >= 10, `Deutschland-Flüsse sparsam im Welt-Paket (${deRivers})`);
assert(deRivers < 120, `kein DE-Fluss-Spaghetti mehr (${deRivers})`);
assert(view.includes('lastExtractHoldAt'), 'Extract-Hold-Fenster gegen GPS-Snap');
assert(view.includes('veralteter GPS-Anker'), 'Live-Kamera statt GPS-Anker');
{
  const lod = readFileSync(
    join(process.cwd(), 'src/services/homeMap/homeMapStyle.ts'),
    'utf8',
  );
  assert(lod.includes('riversDetailFrom: 6.8'), 'Detail-Flüsse erst nah');
  assert(lod.includes('roadsFarFrom: 3.2'), 'Straßen erst ab Europa-Zoom');
}
assert(
  (labels.regions?.features.length ?? 0) >= 10,
  'Gebirge/Landschaften im Welt-Paket',
);
assert(w.lakes.features.length >= 700, `Seen dichter (${w.lakes.features.length})`);

console.log('worldOverview.smoke.test.ts OK');
