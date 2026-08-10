#!/usr/bin/env node
/**
 * Fix Fahlt/Rosengarten polygons + Marktplatz parking pin (Nominatim).
 *   node scripts/cityPack/fixPinnebergPolygons.mjs --apply
 */
import {
  hasFlag,
  loadEnvFile,
  loadPack,
  offset,
  savePack,
  boxPolygon,
} from './lib.mjs';
import { fetchNominatimPolygon, geocodePlace } from '../geo/osm.mjs';
import { runQualityGate } from './qualityGate.mjs';

loadEnvFile();

function centroid(poly) {
  const lat = poly.reduce((s, p) => s + (p.latitude ?? p.lat), 0) / poly.length;
  const lng = poly.reduce((s, p) => s + (p.longitude ?? p.lng), 0) / poly.length;
  return { lat, lng };
}

async function main() {
  const pack = loadPack('pinneberg');

  for (const cfg of [
    {
      id: 'pinneberg_rosengarten_pinneberg',
      q: 'Rosengarten Pinneberg',
      general:
        'Der Rosengarten ist eine unregelmäßig geformte Parkinsel — Polygon-Trigger folgen der Parkgrenze für präzise Annäherung.',
    },
    {
      id: 'pinneberg_waldgebiet_fahlt',
      q: 'Fahlt Pinneberg',
      general:
        'Die Fahlt ist Pinnebergs Stadtwald: unregelmäßig geschnittene Wanderfläche — die App triggert an der echten Waldgrenze, nicht an einer groben Box.',
    },
  ]) {
    const area = await fetchNominatimPolygon(cfg.q);
    if (!area?.polygon?.length) throw new Error(`No polygon for ${cfg.q}`);
    const spot = pack.spots.find((s) => s.id === cfg.id);
    const trigger = pack.trigger_points.find((t) => t.id === cfg.id);
    if (!spot || !trigger) throw new Error(`Missing ${cfg.id}`);
    const c = centroid(area.polygon);
    spot.polygonCoordinates = area.polygon;
    trigger.lat = c.lat;
    trigger.lng = c.lng;
    trigger.special_radius_m = null;
    trigger.general_info = cfg.general;
    const a1 = offset(c.lat, c.lng, 60, 0);
    const a2 = offset(c.lat, c.lng, -35, 25);
    spot.approach_triggers = [
      {
        id: `${cfg.id}_approach_edge`,
        lat: a1.lat,
        lng: a1.lng,
        radius_m: 28,
        teaser_text: cfg.id.includes('fahlt')
          ? 'Du erreichst den Stadtwald Fahlt — sobald du die Waldgrenze überschreitest, wechselt die Stadt in grüne Ruhe.'
          : 'Du näherst dich dem Rosengarten — an der Parkgrenze beginnt die Blüten- und Wegezone.',
        condition_rule: 'always',
      },
      {
        id: `${cfg.id}_approach_in`,
        lat: a2.lat,
        lng: a2.lng,
        radius_m: 16,
        teaser_text: cfg.id.includes('fahlt')
          ? 'Mitten in der Fahlt: Wege unter Bäumen, kostenfreie Naherholung.'
          : 'Im Rosengarten: Wege zwischen Beeten — historische Grüninsel Pinnebergs.',
        condition_rule: 'always',
      },
    ];
    spot.sub_pois = [
      {
        id: `${cfg.id}_sub_eingang`,
        name: `${spot.name} · Zugang`,
        lat: c.lat,
        lng: c.lng,
        radius_m: 12,
        fact_details: `Flächenzentrum / Zugang (${area.source_url}).`,
        tags: ['eingang', 'gps_entrance', 'polygon_precise'],
      },
    ];
    const pool = trigger.deep_data_pool || (trigger.deep_data_pool = []);
    pool.push({
      text: `Flächenpolygon aus OSM/Nominatim (${area.source_url}, ${area.polygon.length} Punkte) — Trigger folgt Park-/Waldgrenze.`,
      tags: ['orientierung', 'sourced_osm', 'gps_confirmed', 'polygon_precise'],
    });
    console.log(`[fix] ${cfg.id} n=${area.polygon.length} @ ${c.lat},${c.lng}`);
  }

  // Marktplatz parking — Google had drifted outside Pinneberg
  {
    const g = await geocodePlace('Marktplatz Pinneberg');
    if (!g) throw new Error('Marktplatz geocode fail');
    const id = 'pinneberg_parkplatz_marktplatz';
    const spot = pack.spots.find((s) => s.id === id);
    const trigger = pack.trigger_points.find((t) => t.id === id);
    spot.polygonCoordinates = boxPolygon(g.lat, g.lng, 40);
    trigger.lat = g.lat;
    trigger.lng = g.lng;
    const a = offset(g.lat, g.lng, 30, 0);
    spot.approach_triggers = [
      {
        id: `${id}_approach`,
        lat: a.lat,
        lng: a.lng,
        radius_m: 22,
        teaser_text: 'Parkplatz Marktplatz liegt voraus — fester Standortanker.',
        condition_rule: 'always',
      },
    ];
    spot.sub_pois = [
      {
        id: `${id}_sub_eingang`,
        name: 'Parkplatz Marktplatz · Zugang',
        lat: g.lat,
        lng: g.lng,
        radius_m: 8,
        fact_details: g.displayName || 'Marktplatz Pinneberg',
        tags: ['eingang', 'gps_entrance'],
      },
    ];
    console.log('[fix] marktplatz parking', g.lat, g.lng);
  }

  const gate = runQualityGate(pack, { strict: false });
  console.log(
    `[fix] spots=${pack.spots.length} ok=${gate.ok} err=${gate.errors.length} warn=${gate.warnings.length}`,
  );
  if (gate.warnings.length) console.log(gate.warnings.slice(0, 15));
  if (hasFlag('apply') || !hasFlag('dry')) {
    const file = savePack(pack, { bumpVersion: true });
    console.log('[fix] wrote', file, 'v' + pack.data_version);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
