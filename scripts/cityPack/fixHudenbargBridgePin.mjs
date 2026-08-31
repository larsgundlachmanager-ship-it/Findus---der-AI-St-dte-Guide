#!/usr/bin/env node
/**
 * Eisenbahnbrücke Hudenbarg: Pin auf OSM-Tunnel way 79560130
 * (Straße unter den Gleisen), kein GPS-Kasten → kein Kita/Feuerwehr-Snap.
 *
 *   node scripts/cityPack/fixHudenbargBridgePin.mjs
 */
import { centroid, hasFlag, loadPack, offset, savePack } from './lib.mjs';

/** OSM way 79560130 Hudenbarg tunnel=yes (14,5 m unter den Gleisen). */
const TUNNEL = [
  { lat: 53.6771104, lng: 9.7562846 },
  { lat: 53.6770189, lng: 9.7561279 },
];
/** User GPS 2026-08-28. */
const BRIDGE_PIN = { lat: 53.677073, lng: 9.75617 };

function bufferLine(pts, halfM) {
  const left = [];
  const right = [];
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    const north = (next.lat - prev.lat) * 111320;
    const east =
      (next.lng - prev.lng) * 111320 * Math.cos((pts[i].lat * Math.PI) / 180);
    const len = Math.hypot(north, east) || 1;
    const uN = north / len;
    const uE = east / len;
    left.push(offset(pts[i].lat, pts[i].lng, -uE * halfM, uN * halfM));
    right.push(offset(pts[i].lat, pts[i].lng, uE * halfM, -uN * halfM));
  }
  const ring = [...left, ...right.reverse()];
  ring.push({ ...ring[0] });
  return ring;
}

function toSpot(pts) {
  return pts.map((p) => ({
    latitude: p.lat ?? p.latitude,
    longitude: p.lng ?? p.longitude,
  }));
}

function toTrig(pts) {
  return pts.map((p) => ({
    lat: p.lat ?? p.latitude,
    lng: p.lng ?? p.longitude,
  }));
}

function main() {
  const dry = hasFlag('dry');
  const pack = loadPack('prisdorf');
  if (!pack) throw new Error('prisdorf pack missing');
  const id = 'prisdorf_eisenbahnbrücke_hudenbarg';
  const spot = pack.spots.find((s) => s.id === id);
  const trigger = pack.trigger_points.find((t) => t.id === id);
  if (!spot || !trigger) throw new Error('bridge spot/trigger missing');

  const ring = bufferLine(TUNNEL, 8);
  const pin = { ...BRIDGE_PIN };
  const before = centroid(spot.polygonCoordinates);

  spot.polygonCoordinates = toSpot(ring);
  delete spot.polygonRings;
  const tags = new Set(spot.tags || []);
  tags.delete('google_refined');
  tags.add('sourced_osm');
  tags.add('map_outline');
  tags.add('gps_manual_fix');
  spot.tags = [...tags];

  const entrance = {
    id: `${id}_sub_eingang`,
    name: `${spot.name} · Haupteingang`,
    lat: pin.lat,
    lng: pin.lng,
    radius_m: 10,
    fact_details:
      'Haupteingang / User GPS 53.677073, 9.756170 — Unterführung Hudenbarg unter den Gleisen.',
    tags: ['sub_poi', 'eingang', 'gps_entrance', 'nav_target', 'sourced_osm'],
  };
  spot.sub_pois = [
    entrance,
    ...(spot.sub_pois || []).filter((s) => !String(s.id || '').includes('eingang')),
  ];

  trigger.lat = pin.lat;
  trigger.lng = pin.lng;
  trigger.radius_m = 16;
  trigger.polygon = toTrig(ring);
  const pool = trigger.deep_data_pool || [];
  trigger.deep_data_pool = [
    {
      text: `GPS-Eingang (OSM): ${pin.lat.toFixed(6)}, ${pin.lng.toFixed(6)} — Hudenbarg-Unterführung (way 79560130) unter der Strecke Hamburg-Altona–Kiel.`,
      tags: ['gps_confirmed', 'sourced_osm', 'orientierung'],
    },
    ...pool.filter((x) => !/GPS-Eingang|Koordinaten\s*~/i.test(String(x.text || ''))),
  ];

  const d = before ? Math.round(
    111320 *
      Math.hypot(
        pin.lat - before.lat,
        (pin.lng - before.lng) * Math.cos((pin.lat * Math.PI) / 180),
      ),
  ) : '?';
  console.log(
    `${id} Δ=${d}m ${before?.lat?.toFixed(6)},${before?.lng?.toFixed(6)} → ${pin.lat},${pin.lng}`,
  );
  console.log('  OSM tunnel way 79560130 — nicht Kita/Feuerwehr');

  if (!dry) {
    savePack(pack);
    console.log('saved', pack.city_id, 'v' + pack.data_version);
  } else {
    console.log('dry-run');
  }
}

main();
