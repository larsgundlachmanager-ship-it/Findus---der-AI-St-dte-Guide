/**
 * Run: npx --yes --package tsx@4.19.4 tsx src/services/discovery/cityCoverageBounds.boundary.smoke.test.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const src = readFileSync(
  join(process.cwd(), 'src/services/discovery/cityCoverageBounds.ts'),
  'utf8',
);
assert(src.includes('polygon_threshold=0'), 'Nominatim volle OSM-Detailgrenze');
assert(src.includes('dedupeBoundaryRing'), 'kein Chaikin — nur Dedup');
assert(src.includes('MIN_BOUNDARY_DETAIL_POINTS'), 'dünne Pack-Polygone nachziehen');
assert(src.includes('hasDetailedCityBoundaryPolygon'), 'Detail-Check');
assert(!/smoothCityBoundaryRing\(rawPoly/.test(src), 'Chaikin nicht auf Admin-Grenze');

const catalogSrc = readFileSync(
  join(process.cwd(), 'src/services/cityCatalogService.ts'),
  'utf8',
);
assert(
  catalogSrc.includes('registerCoverageFromLocalPacks'),
  'Offline-Packs registrieren Coverage ohne Modul-1-Switch',
);
const homeMapSrc = readFileSync(
  join(process.cwd(), 'src/components/homeMap/HomePresenceMap.tsx'),
  'utf8',
);
assert(
  homeMapSrc.includes('registerCoverageFromLocalPacks'),
  'Homemap bootet Coverage aus lokalen Packs',
);
assert(
  homeMapSrc.includes('localOfflineCityIdsRef'),
  'Offline-Städte immer in City-Fills',
);

for (const id of ['prisdorf', 'tornesch', 'pinneberg'] as const) {
  const pack = JSON.parse(
    readFileSync(join(process.cwd(), `data/staedte/${id}.json`), 'utf8'),
  );
  const n = pack._coverage?.polygon?.length ?? 0;
  assert(n >= 80, `${id} OSM-Detailgrenze (≥80 pts, got ${n})`);
  assert(
    pack._coverage?.source === 'nominatim_osm_admin',
    `${id} source nominatim_osm_admin`,
  );
}

console.log('cityCoverageBounds.boundary.smoke.test.ts OK');
