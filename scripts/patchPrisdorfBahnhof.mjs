#!/usr/bin/env node
/**
 * Patch Prisdorf Bahnhof → area polygon + approach + Wartehäuschen/Güterbahnsteig subs.
 * Uses OSM when available; falls back to surveyed coords around known station point.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  boxPolygon,
  fetchBuildingPolygon,
  fetchNearbyRoadNodes,
  bearingLabel,
} from './geo/osm.mjs';
import { validateCityPack } from './geo/validatePack.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packPath = path.join(__dirname, '..', 'data', 'staedte', 'prisdorf.json');

const STATION = { lat: 53.6768527, lng: 9.7608239 };
const WARTEHAUS = { lat: 53.67678, lng: 9.76095 };
const GUETER = { lat: 53.67695, lng: 9.76055 };

async function main() {
  const pack = JSON.parse(fs.readFileSync(packPath, 'utf8'));

  let building = null;
  try {
    building = await fetchBuildingPolygon(STATION.lat, STATION.lng, 90);
  } catch (e) {
    console.warn('[patch] OSM polygon failed, using box:', e.message);
  }

  // Elongated platform-ish polygon if OSM too small / missing
  let polygon = building?.polygon;
  if (!polygon || polygon.length < 4) {
    // ~120m along tracks (roughly E-W), ~25m wide
    const halfLen = 60 / 111320;
    const halfW = 14 / (111320 * Math.cos((STATION.lat * Math.PI) / 180));
    polygon = [
      { latitude: STATION.lat - halfW, longitude: STATION.lng - halfLen },
      { latitude: STATION.lat - halfW, longitude: STATION.lng + halfLen },
      { latitude: STATION.lat + halfW, longitude: STATION.lng + halfLen },
      { latitude: STATION.lat + halfW, longitude: STATION.lng - halfLen },
      { latitude: STATION.lat - halfW, longitude: STATION.lng - halfLen },
    ];
  }

  let approaches = [];
  try {
    const nodes = await fetchNearbyRoadNodes(STATION.lat, STATION.lng, 150);
    approaches = nodes.slice(0, 2).map((n, i) => {
      const dir = bearingLabel(n.lat, n.lng, STATION.lat, STATION.lng);
      return {
        id: `prisdorf_bahnhof_approach_${i + 1}`,
        lat: n.lat,
        lng: n.lng,
        radius_m: 30,
        teaser_text: `Wenn du Richtung ${dir} zur Bahn schaust: Der Haltepunkt Prisdorf liegt nur etwa ${Math.round(n.dist)} Meter weiter. Am Übergang erkennst du das Fachwerk-Wartehäuschen — geh ruhig näher ran.`,
        condition_rule: 'always',
      };
    });
  } catch (e) {
    console.warn('[patch] approach OSM failed:', e.message);
  }

  if (approaches.length === 0) {
    approaches = [
      {
        id: 'prisdorf_bahnhof_approach_1',
        lat: 53.67655,
        lng: 9.7604,
        radius_m: 30,
        teaser_text:
          'Von der Bahnhofstraße aus: Geh Richtung Gleise. Du siehst gleich das kleine Fachwerk-Wartehäuschen — das ist dein Anker am Haltepunkt Prisdorf.',
        condition_rule: 'always',
      },
    ];
  }

  const spotId = 'prisdorf_bahnhof_wartehäuschen';
  const spot = pack.spots.find((s) => s.id === spotId);
  const trigger = pack.trigger_points.find((t) => t.id === spotId);
  if (!spot || !trigger) throw new Error('Bahnhof spot/trigger missing');

  spot.category = 'bahnhof';
  spot.tags = ['bahnhof', 'transport', 'denkmal', 'wartehaeuschen'];
  spot.facts = {
    origin:
      'Prisdorf ist seit 1844 an die Strecke Hamburg–Kiel bzw. Hamburg-Altona–Westerland angeschlossen.',
    architecture:
      'Das denkmalgeschützte Fachwerk-Wartehäuschen von 1911 ist das letzte erhaltene Stück der alten Bahnhofsanlage.',
    now: 'Heute halten RB61 und RB71; die Gemeinde hat keinen eigenen Busanschluss.',
    tags: ['bahnhof', 'historical_core', 'transport'],
  };
  spot.polygonCoordinates = polygon;
  spot.approach_triggers = approaches;
  spot.sub_pois = [
    {
      id: 'prisdorf_bahnhof_wartehaeuschen_sub',
      name: 'Historisches Bahnwartehäuschen',
      lat: WARTEHAUS.lat,
      lng: WARTEHAUS.lng,
      radius_m: 12,
      fact_details:
        'Siehst du das Fachwerk mit dem Walmdach? 1911 von Bürgern mitfinanziert, später vom Verein Wartehäuschen Prisdorf vor dem Abriss gerettet und saniert. Hier endet die sichtbare Geschichte des alten Bahnhofs.',
      tags: ['denkmal', 'architecture'],
    },
    {
      id: 'prisdorf_bahnhof_gueterbahnsteig_sub',
      name: 'Alter Güterbahnsteig mit Schienen',
      lat: GUETER.lat,
      lng: GUETER.lng,
      radius_m: 14,
      fact_details:
        'Am Gleisende erinnern noch Spuren des Güterverkehrs daran, dass hier nicht nur Pendler, sondern auch Waren den Ort angebunden haben. Schau auf die Schienenführung — das ist der ruhigere, längliche Teil des Haltepunkts.',
      tags: ['transport', 'historical_core'],
    },
  ];

  // Clean personal "Thorsten" from general_info
  if (typeof trigger.general_info === 'string') {
    trigger.general_info = trigger.general_info.replace(/,\s*Thorsten/gi, '');
  }
  trigger.trigger_kind = 'area';
  trigger.trigger_type = 'polygon';
  trigger.radius_m = 35;
  trigger.polygon = polygon.map((p) => ({
    lat: p.latitude,
    lng: p.longitude,
  }));
  trigger.lat = STATION.lat;
  trigger.lng = STATION.lng;

  // Soften cascading personal speech if present
  if (Array.isArray(trigger.cascading_triggers)) {
    for (const c of trigger.cascading_triggers) {
      if (c.speech_text) {
        c.speech_text = String(c.speech_text).replace(/,\s*Thorsten/gi, '');
      }
    }
  }

  pack.data_version = Math.max(Number(pack.data_version || 0) + 1, 8);
  pack.name = pack.name || 'Prisdorf';

  const v = validateCityPack(pack);
  if (!v.ok) {
    console.error(v.errors);
    process.exit(1);
  }
  if (v.warnings.length) console.warn(v.warnings);

  fs.writeFileSync(packPath, JSON.stringify(pack, null, 2));
  console.log(
    `[patch] prisdorf Bahnhof updated → data_version=${pack.data_version} approaches=${approaches.length} poly=${polygon.length}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
