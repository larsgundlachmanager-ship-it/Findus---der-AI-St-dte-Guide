#!/usr/bin/env node
import { loadPack, savePack, centroid } from './lib.mjs';
import { fetchNominatimPolygon, sleep } from '../geo/osm.mjs';

const FIX = [
  { id: 'london_somerset_house', q: 'Somerset House Strand London United Kingdom' },
];

const pack = loadPack('london');
for (const f of FIX) {
  const got = await fetchNominatimPolygon(f.q, { countrycodes: 'gb' });
  const spot = pack.spots.find((s) => s.id === f.id);
  const trig = pack.trigger_points.find((t) => t.id === f.id);
  if (!got?.polygon?.length || !spot) {
    console.log('MISS', f.id);
    continue;
  }
  const c = centroid(got.polygon);
  spot.polygonCoordinates = got.polygon;
  spot.tags = [
    ...new Set([
      ...(spot.tags || []).filter((t) => t !== 'map_point'),
      'map_outline',
      'sourced_osm',
    ]),
  ];
  if (trig && c) {
    trig.lat = c.lat;
    trig.lng = c.lng;
    trig.polygon = got.polygon.map((p) => ({
      lat: p.latitude ?? p.lat,
      lng: p.longitude ?? p.lng,
    }));
  }
  const ent = (spot.sub_pois || []).find((s) =>
    String(s.id || '').includes('eingang'),
  );
  if (ent && c) {
    ent.lat = c.lat;
    ent.lng = c.lng;
    ent.fact_details = `GPS-Eingang (OSM/Nominatim ${got.name}).`;
  }
  console.log(
    'OK',
    f.id,
    `n=${got.polygon.length}`,
    c.lat.toFixed(5),
    c.lng.toFixed(5),
  );
  await sleep(1100);
}
savePack(pack, { bumpVersion: true });
console.log('saved v', pack.data_version);
