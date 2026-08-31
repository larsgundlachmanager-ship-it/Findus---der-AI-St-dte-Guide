import {
  buildExploredPolygons,
  buildFogPolygons,
  pointInFogPolygons,
} from './src/services/discovery/fogCoverage';

const origin = { lat: 53.68, lng: 9.76 };
function offset(lat: number, lng: number, northM: number, eastM: number) {
  return {
    lat: lat + northM / 111320,
    lng: lng + eastM / (111320 * Math.cos((lat * Math.PI) / 180)),
    at: 1,
  };
}
function line(northM: number, east0: number, east1: number, step = 12) {
  const pts = [];
  for (let e = east0; e <= east1; e += step) pts.push(offset(origin.lat, origin.lng, northM, e));
  return pts;
}
const track = line(0, 0, 80);
const explored = buildExploredPolygons([track], 50, 20);
console.log('explored polys', explored.length, 'rings', explored[0]?.length, 'verts', explored[0]?.[0]?.length);
const c = explored[0]![0]!;
let cx = 0;
let cy = 0;
for (const p of c.slice(0, -1)) {
  cx += p[0];
  cy += p[1];
}
cx /= c.length - 1;
cy /= c.length - 1;
const mLng = 111320 * Math.cos((origin.lat * Math.PI) / 180);
const radii = c.slice(0, -1).map((p) => Math.hypot((p[1] - cy) * 111320, (p[0] - cx) * mLng));
console.log(
  'centroid radii min/max/mean',
  Math.min(...radii).toFixed(1),
  Math.max(...radii).toFixed(1),
  (radii.reduce((a, b) => a + b, 0) / radii.length).toFixed(1),
);
const p70 = offset(origin.lat, origin.lng, 70, 40);
const p40 = offset(origin.lat, origin.lng, 40, 40);
function inRing(lng: number, lat: number, ring: [number, number][]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]![0];
    const yi = ring[i]![1];
    const xj = ring[j]![0];
    const yj = ring[j]![1];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi || 1e-12) + xi) inside = !inside;
  }
  return inside;
}
console.log('70m in explored outer', inRing(p70.lng, p70.lat, explored[0]![0]!));
console.log('40m in explored outer', inRing(p40.lng, p40.lat, explored[0]![0]!));
const bounds = {
  west: Math.min(...track.map((p) => p.lng)) - 0.004,
  east: Math.max(...track.map((p) => p.lng)) + 0.004,
  south: Math.min(...track.map((p) => p.lat)) - 0.004,
  north: Math.max(...track.map((p) => p.lat)) + 0.004,
};
const fog = buildFogPolygons(bounds, [track], 50, 20);
console.log('fog polys', fog.length, 'rings0', fog[0]!.length);
console.log('70m fogged', pointInFogPolygons(p70.lng, p70.lat, fog));
console.log('40m fogged', pointInFogPolygons(p40.lng, p40.lat, fog));
console.log('on-track fogged', pointInFogPolygons(offset(origin.lat, origin.lng, 0, 40).lng, offset(origin.lat, origin.lng, 0, 40).lat, fog));
