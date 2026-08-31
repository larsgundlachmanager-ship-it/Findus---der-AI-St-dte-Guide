/**
 * Run: npx --yes tsx src/services/discovery/fogCoverage.smoke.test.ts
 */

import {
  FOG_MERGE_GAP_M,
  buildExploredPolygons,
  buildFogPolygons,
  fogBoundsCacheKey,
  fogTrackCacheKey,
  pointInFogPolygons,
  type FogTrackPt,
} from './fogCoverage';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

const origin = { lat: 53.68, lng: 9.76 };

function offset(lat: number, lng: number, northM: number, eastM: number): FogTrackPt {
  return {
    lat: lat + northM / 111320,
    lng: lng + eastM / (111320 * Math.cos((lat * Math.PI) / 180)),
    at: 1,
  };
}

function line(northM: number, east0: number, east1: number, step = 12): FogTrackPt[] {
  const pts: FogTrackPt[] = [];
  for (let e = east0; e <= east1; e += step) {
    pts.push(offset(origin.lat, origin.lng, northM, e));
  }
  return pts;
}

function boundsFor(pts: FogTrackPt[]) {
  const lats = pts.map((p) => p.lat);
  const lngs = pts.map((p) => p.lng);
  const pad = 0.004;
  return {
    west: Math.min(...lngs) - pad,
    east: Math.max(...lngs) + pad,
    south: Math.min(...lats) - pad,
    north: Math.max(...lats) + pad,
  };
}

function fogged(polygons: ReturnType<typeof buildFogPolygons>, northM: number, eastM: number): boolean {
  const p = offset(origin.lat, origin.lng, northM, eastM);
  return pointInFogPolygons(p.lng, p.lat, polygons);
}

assert(FOG_MERGE_GAP_M === 20, 'Merge-Lücke 20 m');

{
  const track = line(0, 0, 80);
  const polygons = buildFogPolygons(boundsFor(track), [track], 50, 20);
  assert(polygons.length >= 1, 'ein Punkt-Band erzeugt Fog');
  assert(!fogged(polygons, 0, 40), 'auf der Spur ist frei (50 m Reveal)');
  assert(!fogged(polygons, 40, 40), '40 m neben der Spur noch frei');
  assert(fogged(polygons, 70, 40), '70 m neben der Spur bleibt Fog');
}

{
  // 110 m Abstand: 50+50 lassen 10 m Mitte — Close 20 m muss mergen.
  const a = line(0, 0, 140);
  const b = line(110, 0, 140);
  const polygons = buildFogPolygons(boundsFor([...a, ...b]), [a, b], 50, 20);
  assert(!fogged(polygons, 0, 70), 'untere Straße frei');
  assert(!fogged(polygons, 110, 70), 'obere Straße frei');
  assert(!fogged(polygons, 55, 70), '10-m-Mittelstreifen wird mitgezogen');
}

{
  // 140 m Abstand: 40 m Lücke > 20 m — bleibt getrennt.
  const a = line(0, 0, 140);
  const b = line(140, 0, 140);
  const polygons = buildFogPolygons(boundsFor([...a, ...b]), [a, b], 50, 20);
  assert(!fogged(polygons, 0, 70), 'untere Straße frei');
  assert(!fogged(polygons, 140, 70), 'obere Straße frei');
  assert(fogged(polygons, 70, 70), '40-m-Lücke bleibt Fog');
}

{
  const empty = buildFogPolygons(
    { west: 9.75, east: 9.77, south: 53.67, north: 53.69 },
    [],
    50,
    20,
  );
  assert(empty.length >= 1, 'ohne Spur ist der Ausschnitt voller Fog');
  assert(
    pointInFogPolygons(9.76, 53.68, empty),
    'Mittelpunkt ohne Spur liegt im Fog',
  );
}

{
  // Stehender Punkt: Reveal-Loch muss rund sein, kein Pixel-Rechteck.
  const stand = [offset(origin.lat, origin.lng, 0, 0)];
  const tight = {
    west: origin.lng - 0.0018,
    east: origin.lng + 0.0018,
    south: origin.lat - 0.0012,
    north: origin.lat + 0.0012,
  };
  const polygons = buildFogPolygons(tight, [stand], 50, 20);
  const hole = polygons.find((p) => p.length > 1)?.[1];
  assert(hole && hole.length >= 16, 'Reveal-Loch hat genug Vertices für eine runde Kante');
  const mLng = 111320 * Math.cos((origin.lat * Math.PI) / 180);
  const radii: number[] = [];
  for (let i = 0; i < hole!.length - 1; i++) {
    const [lng, lat] = hole![i]!;
    radii.push(Math.hypot((lat - origin.lat) * 111320, (lng - origin.lng) * mLng));
  }
  const minR = Math.min(...radii);
  const maxR = Math.max(...radii);
  assert(minR > 35 && maxR < 70, 'Reveal-Radius bleibt ~50 m');
  assert(maxR / minR < 1.08, 'Reveal-Rand ist ein Kreis, kein Rechteck');
}

{
  const stand = [offset(origin.lat, origin.lng, 0, 0)];
  const a = buildExploredPolygons([stand], 50, 20);
  const b = buildExploredPolygons([stand], 50, 20);
  assert(JSON.stringify(a) === JSON.stringify(b), 'erkundete Fläche ist weltfest');
  const tiny = {
    west: origin.lng - 0.00015,
    east: origin.lng + 0.00015,
    south: origin.lat - 0.0001,
    north: origin.lat + 0.0001,
  };
  const zoomed = buildFogPolygons(tiny, [stand], 50, 20);
  const hole = zoomed.find((p) => p.length > 1)?.[1];
  assert(hole && hole.length >= 16, 'Nahzoom behält das Reveal-Loch (Mint bleibt)');
  assert(!fogged(zoomed, 0, 0), 'Standort im Nahzoom bleibt frei');
  const shifted = {
    west: tiny.west + 0.00004,
    east: tiny.east + 0.00004,
    south: tiny.south + 0.00003,
    north: tiny.north + 0.00003,
  };
  const panned = buildFogPolygons(shifted, [stand], 50, 20);
  assert(
    JSON.stringify(zoomed.find((p) => p.length > 1)?.[1]) ===
      JSON.stringify(panned.find((p) => p.length > 1)?.[1]),
    'Pan verschiebt das Reveal-Loch nicht',
  );
}

{
  const stand = [offset(origin.lat, origin.lng, 0, 0)];
  const ghost = [offset(origin.lat, origin.lng, 18_000, 0)];
  const a = buildExploredPolygons([stand, ghost], 50, 20);
  assert(a.length >= 2, 'Teleport-Insel bleibt eigene Reveal-Fläche');
  const mLng = 111320 * Math.cos((origin.lat * Math.PI) / 180);
  const local = a
    .map((poly) => poly[0])
    .find((ring) => {
      if (!ring || ring.length < 16) return false;
      const [lng, lat] = ring[0]!;
      const d = Math.hypot((lat - origin.lat) * 111320, (lng - origin.lng) * mLng);
      return d < 80;
    });
  assert(local && local.length >= 16, 'lokale Blase bleibt ein Kreis');
  const radii: number[] = [];
  for (let i = 0; i < local!.length - 1; i++) {
    const [lng, lat] = local![i]!;
    radii.push(Math.hypot((lat - origin.lat) * 111320, (lng - origin.lng) * mLng));
  }
  const minR = Math.min(...radii);
  const maxR = Math.max(...radii);
  assert(maxR / minR < 1.08, 'lokale Blase wird durch Fern-GPS nicht pixelig');
}

{
  // Lange Laufspur (halbe Stadt): entlang der Route frei, Kante bleibt weich.
  const long = line(0, 0, 900, 12);
  const polygons = buildFogPolygons(boundsFor(long), [long], 50, 20);
  assert(!fogged(polygons, 0, 40), 'Anfang der Spur frei');
  assert(!fogged(polygons, 0, 450), 'Mitte der Spur frei (nicht nur 50-m-Blase am GPS)');
  assert(!fogged(polygons, 0, 860), 'Ende der Spur frei');
  assert(fogged(polygons, 70, 450), '70 m neben der langen Spur bleibt Fog');
  const hole = polygons.find((p) => p.length > 1)?.[1];
  assert(hole && hole.length >= 16, 'lange Spur hat geglätteten Rand, kein Rechteck');
}

{
  // Schleife durchs Viertel darf kein Riesenkreis über die Mitte werden.
  const loop: FogTrackPt[] = [];
  for (let e = 0; e <= 180; e += 12) loop.push(offset(origin.lat, origin.lng, 0, e));
  for (let n = 12; n <= 180; n += 12) loop.push(offset(origin.lat, origin.lng, n, 180));
  for (let e = 168; e >= 0; e -= 12) loop.push(offset(origin.lat, origin.lng, 180, e));
  for (let n = 168; n >= 0; n -= 12) loop.push(offset(origin.lat, origin.lng, n, 0));
  const polygons = buildFogPolygons(boundsFor(loop), [loop], 50, 20);
  assert(!fogged(polygons, 0, 90), 'untere Kante der Schleife frei');
  assert(fogged(polygons, 90, 90), 'Mitte der Schleife bleibt Fog, kein Riesenkreis');
}

{
  const a = [offset(origin.lat, origin.lng, 0, 0)];
  const b = [offset(origin.lat, origin.lng, 1.5, 0)];
  const c = [offset(origin.lat, origin.lng, 4, 0)];
  assert(fogTrackCacheKey(a) === fogTrackCacheKey(b), 'GPS-Jitter unter 3 m gleicher Fog-Key');
  assert(fogTrackCacheKey(a) !== fogTrackCacheKey(c), '4 m weiter neuer Fog-Key');
  const view = boundsFor(a);
  const viewShift = {
    ...view,
    south: view.south + 1.5 / 111320,
    north: view.north + 1.5 / 111320,
  };
  assert(fogBoundsCacheKey(view) === fogBoundsCacheKey(viewShift), 'Kamera-Ruckeln unter 40 m gleicher View-Key');
}

console.log('fogCoverage.smoke.test.ts OK');
