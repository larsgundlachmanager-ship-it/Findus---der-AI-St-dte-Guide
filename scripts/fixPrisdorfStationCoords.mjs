#!/usr/bin/env node
/**
 * Fix Prisdorf Bahnhof to DB/zugradar coordinates (~53.67529, 9.76022).
 * Previous pack center was ~175m too far north (Bahnhofstraße mid-village).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCityPack } from './geo/validatePack.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packPath = path.join(__dirname, '..', 'data', 'staedte', 'prisdorf.json');

/** Authoritative: onatrain / zugradar Haltepunkt Prisdorf */
const STATION = { lat: 53.675291, lng: 9.760216 };

/** Platform is elongated roughly E–W along the Hamburg–Elmshorn line. */
function platformPolygon(c) {
  const halfLen = 90 / 111320; // ~180m platform corridor
  const halfW = 18 / (111320 * Math.cos((c.lat * Math.PI) / 180));
  return [
    { latitude: c.lat - halfW, longitude: c.lng - halfLen },
    { latitude: c.lat - halfW, longitude: c.lng + halfLen },
    { latitude: c.lat + halfW, longitude: c.lng + halfLen },
    { latitude: c.lat + halfW, longitude: c.lng - halfLen },
    { latitude: c.lat - halfW, longitude: c.lng - halfLen },
  ];
}

const pack = JSON.parse(fs.readFileSync(packPath, 'utf8'));
const spotId = 'prisdorf_bahnhof_wartehäuschen';
const spot = pack.spots.find((s) => s.id === spotId);
const trigger = pack.trigger_points.find((t) => t.id === spotId);
if (!spot || !trigger) throw new Error('bahnhof missing');

const polygon = platformPolygon(STATION);

spot.category = 'bahnhof';
spot.tags = ['bahnhof', 'transport', 'denkmal', 'wartehaeuschen'];
spot.facts = {
  origin:
    'Prisdorf ist seit 1844 an die Strecke Hamburg–Kiel bzw. Hamburg-Altona–Westerland angeschlossen.',
  architecture:
    'Das denkmalgeschützte Fachwerk-Wartehäuschen von 1911 ist das letzte erhaltene Stück der alten Bahnhofsanlage.',
  now: 'Heute Haltepunkt (kein Bahnhof mit Weichen): RB61/RB71; Koordinaten aus DB/zugradar.',
  tags: ['bahnhof', 'historical_core', 'transport'],
};
spot.polygonCoordinates = polygon;

// Approaches: Bahnhofstraße north of tracks + south/village side
spot.approach_triggers = [
  {
    id: 'prisdorf_bahnhof_approach_bahnhofstrasse_nord',
    lat: 53.67555,
    lng: 9.76025,
    radius_m: 28,
    teaser_text:
      'Du bist auf der Bahnhofstraße kurz vor den Gleisen. Gleich voraus liegt der Haltepunkt Prisdorf — schau nach dem Fachwerk-Wartehäuschen am Bahnsteig.',
    condition_rule: 'always',
  },
  {
    id: 'prisdorf_bahnhof_approach_hudenfeld',
    lat: 53.67505,
    lng: 9.76005,
    radius_m: 28,
    teaser_text:
      'Von der Südseite der Gleise: Der Haltepunkt Prisdorf liegt direkt an der Bahn — über den Übergang zum Bahnsteig und zum Wartehäuschen.',
    condition_rule: 'always',
  },
];

spot.sub_pois = [
  {
    id: 'prisdorf_bahnhof_wartehaeuschen_sub',
    name: 'Historisches Bahnwartehäuschen',
    // Slightly north of track center toward Bahnhofstraße side
    lat: 53.67535,
    lng: 9.76035,
    radius_m: 12,
    fact_details:
      'Siehst du das Fachwerk mit dem Walmdach? 1911 von Bürgern mitfinanziert, später vom Verein Wartehäuschen Prisdorf vor dem Abriss gerettet und saniert.',
    tags: ['denkmal', 'architecture'],
  },
  {
    id: 'prisdorf_bahnhof_gueterbahnsteig_sub',
    name: 'Alter Güterbahnsteig / abgetrenntes Gleis',
    // Offset along platform (historically west/side remnant)
    lat: 53.67528,
    lng: 9.75985,
    radius_m: 14,
    fact_details:
      'Am Gleisende erinnern Spuren des Güterverkehrs und abgetrennter Gleise daran, dass hier früher mehr Bahnhof war als nur ein Haltepunkt.',
    tags: ['transport', 'historical_core'],
  },
];

trigger.lat = STATION.lat;
trigger.lng = STATION.lng;
trigger.trigger_kind = 'area';
trigger.trigger_type = 'polygon';
trigger.radius_m = 35;
trigger.polygon = polygon.map((p) => ({ lat: p.latitude, lng: p.longitude }));
if (typeof trigger.general_info === 'string') {
  trigger.general_info = trigger.general_info.replace(/,\s*Thorsten/gi, '');
}
if (Array.isArray(trigger.cascading_triggers)) {
  for (const c of trigger.cascading_triggers) {
    if (c.speech_text) {
      c.speech_text = String(c.speech_text).replace(/,\s*Thorsten/gi, '');
    }
  }
}

pack.data_version = Math.max(Number(pack.data_version || 0) + 1, 9);

const v = validateCityPack(pack);
if (!v.ok) {
  console.error(v.errors);
  process.exit(1);
}

fs.writeFileSync(packPath, JSON.stringify(pack, null, 2));
console.log(
  `[fix] prisdorf Bahnhof → ${STATION.lat},${STATION.lng} data_version=${pack.data_version}`,
);
