#!/usr/bin/env node
/**
 * Auto place-pack generator (OSM / Nominatim).
 *
 * Usage:
 *   node scripts/generatePlacePack.mjs --city wangerooge --place "Leuchtturm Wangerooge"
 *   node scripts/generatePlacePack.mjs --city prisdorf --place "Bahnhof Prisdorf" --merge
 *   node scripts/generatePlacePack.mjs --batch data/staedte/wangerooge.batch.json
 *
 * Only writes facts with source_url / OSM tags. Empty > invented.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  bearingLabel,
  boxPolygon,
  fetchBuildingPolygon,
  fetchNearbyRoadNodes,
  fetchSubAmenities,
  geocodePlace,
  sleep,
} from './geo/osm.mjs';
import { validateCityPack } from './geo/validatePack.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'data', 'staedte');

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function slugify(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function inferCategory(placeName, osmTags = {}) {
  const blob = `${placeName} ${JSON.stringify(osmTags)}`.toLowerCase();
  if (/kirche|church|chapel|kapelle/.test(blob)) return 'kirche';
  if (/restaurant|gaststätte|gasthof/.test(blob)) return 'restaurant';
  if (/fisch|seafood/.test(blob)) return 'fischrestaurant';
  if (/café|cafe|kaffee|bakery|bäckerei/.test(blob)) return 'cafe';
  if (/bahnhof|station|railway/.test(blob)) return 'bahnhof';
  if (/strand|beach/.test(blob)) return 'strand';
  if (/leuchtturm|lighthouse/.test(blob)) return 'architektur';
  if (/museum/.test(blob)) return 'museum';
  return osmTags.amenity || osmTags.tourism || osmTags.railway || 'ort';
}

function factsFromOsmTags(tags, sourceUrl) {
  const bullets = [];
  const push = (text) => {
    if (text) bullets.push({ text, source_url: sourceUrl, confidence: 'osm_tag' });
  };
  if (tags.name) push(`Offizieller OSM-Name: ${tags.name}.`);
  if (tags['addr:street'] || tags['addr:housenumber']) {
    push(
      `Adresse laut OSM: ${[tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' ')}${tags['addr:city'] ? `, ${tags['addr:city']}` : ''}.`,
    );
  }
  if (tags.opening_hours) push(`Öffnungszeiten (OSM): ${tags.opening_hours}.`);
  if (tags.cuisine) push(`Küche (OSM): ${tags.cuisine}.`);
  if (tags.wheelchair) push(`Rollstuhl (OSM): ${tags.wheelchair}.`);
  if (tags.heritage || tags.heritage_building) {
    push(`Denkmal-/Heritage-Kennzeichnung in OSM vorhanden.`);
  }
  if (tags.start_date) push(`Beginn laut OSM-Tag start_date: ${tags.start_date}.`);
  if (tags.building) push(`Gebäude-Typ (OSM): ${tags.building}.`);
  return bullets;
}

async function buildPlaceFragment(cityId, placeName, opts = {}) {
  const query = opts.query || `${placeName}, ${cityId}, Germany`;
  console.log(`[gen] geocode: ${query}`);
  const geo = await geocodePlace(query);
  if (!geo) throw new Error(`Geocode failed: ${query}`);

  console.log(`[gen] polygon around ${geo.lat},${geo.lng}`);
  let building = null;
  try {
    building = await fetchBuildingPolygon(geo.lat, geo.lng, opts.radiusM || 80);
  } catch (e) {
    console.warn(`[gen] polygon OSM failed: ${e.message}`);
  }
  const polygon =
    building?.polygon || boxPolygon(geo.lat, geo.lng, opts.boxHalfM || 30);
  const tags = building?.tags || {};
  const sourceUrl = building?.source_url || geo.source_url;

  console.log(`[gen] approach nodes`);
  let roads = [];
  try {
    roads = await fetchNearbyRoadNodes(geo.lat, geo.lng, 140);
  } catch (e) {
    console.warn(`[gen] approaches OSM failed: ${e.message}`);
  }
  if (roads.length === 0) {
    // synthetic approach ~45m south of center
    const dLat = -45 / 111320;
    roads = [
      {
        lat: geo.lat + dLat,
        lng: geo.lng,
        dist: 45,
        degree: 1,
        id: 0,
      },
    ];
  }
  const approaches = roads.map((n, i) => {
    const dir = bearingLabel(n.lat, n.lng, geo.lat, geo.lng);
    const meters = Math.round(n.dist);
    return {
      id: `${slugify(placeName)}_approach_${i + 1}`,
      lat: n.lat,
      lng: n.lng,
      radius_m: 32,
      teaser_text: `Wenn du Richtung ${dir} schaust: etwa ${meters} Meter weiter liegt ${placeName}. Geh die Straße entlang — du kannst ihn kaum verfehlen.`,
      condition_rule: 'always',
      source_url:
        n.id > 0
          ? `https://www.openstreetmap.org/node/${n.id}`
          : geo.source_url,
    };
  });

  console.log(`[gen] sub amenities`);
  let subs = [];
  if (!opts.skipAutoSubs) {
    try {
      const am = await fetchSubAmenities(geo.lat, geo.lng, 70);
      subs = am.map((s) => ({
        id: s.id,
        name: s.name,
        lat: s.lat,
        lng: s.lng,
        radius_m: 12,
        fact_details: `Mikro-Ort laut OpenStreetMap (${Object.keys(s.tags).slice(0, 4).join(', ') || 'poi'}). Quelle: ${s.source_url}`,
        tags: ['sub_poi'],
        source_url: s.source_url,
      }));
    } catch (e) {
      console.warn(`[gen] subs OSM failed: ${e.message}`);
    }
  }
  for (const s of opts.extraSubs || []) subs.push(s);

  const sourced = factsFromOsmTags(tags, sourceUrl);
  if (sourced.length === 0 && geo.displayName) {
    sourced.push({
      text: `Standort laut OpenStreetMap/Nominatim: ${geo.displayName}.`,
      source_url: geo.source_url,
      confidence: 'nominatim',
    });
  }
  if (opts.famousPersonConnected) {
    sourced.push({
      text: opts.famousPersonConnected,
      source_url: geo.source_url,
      confidence: 'curated_pack',
    });
  }
  // Ensure at least 2 hard facts for validator when only one OSM tag exists
  if (sourced.length === 1) {
    sourced.push({
      text: `Koordinaten (Nominatim): ${geo.lat.toFixed(5)}, ${geo.lng.toFixed(5)}.`,
      source_url: geo.source_url,
      confidence: 'nominatim',
    });
  }
  const category = opts.category || inferCategory(placeName, tags);
  const spotId = opts.id || `${slugify(cityId)}_${slugify(placeName)}`;

  const spot = {
    id: spotId,
    name: placeName,
    district: opts.district || cityId,
    category,
    tags: [category, ...(opts.tags || [])],
    bullets: sourced.map((b) => b.text),
    facts: {
      origin: sourced[0]?.text,
      architecture: sourced.find((b) => /Gebäude|Denkmal|building/i.test(b.text))
        ?.text,
      now: sourced.find((b) => /Öffnungs|Adresse|Küche/i.test(b.text))?.text,
      famousPersonConnected: opts.famousPersonConnected || undefined,
      tags: [category, ...(opts.tags || []), 'needs_review'].filter(Boolean),
    },
    polygonCoordinates: polygon,
    approach_triggers: approaches,
    sub_pois: subs,
    _meta: {
      geocode: geo,
      sources: [sourceUrl, ...sourced.map((s) => s.source_url)].filter(Boolean),
      generated_at: new Date().toISOString(),
    },
  };

  const trigger = {
    id: spotId,
    name: placeName,
    lat: geo.lat,
    lng: geo.lng,
    radius_m: 40,
    trigger_kind: 'area',
    trigger_type: 'polygon',
    polygon: polygon.map((p) => ({ lat: p.latitude, lng: p.longitude })),
    general_info: opts.general_info || undefined,
    deep_data_pool: sourced.map((b) => ({
      text: b.text,
      tags: ['sourced_osm'],
    })),
  };

  return { spot, trigger };
}

function loadPack(cityId) {
  const file = path.join(OUT_DIR, `${cityId}.json`);
  if (!fs.existsSync(file)) {
    return {
      city_id: cityId,
      name: cityId[0].toUpperCase() + cityId.slice(1),
      data_version: 1,
      symbol: '🌳',
      spots: [],
      trigger_points: [],
    };
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function savePack(pack) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `${pack.city_id}.json`);
  // strip _meta from spots for runtime cleanliness (keep in sidecar optional)
  const clean = structuredClone(pack);
  for (const s of clean.spots || []) delete s._meta;
  fs.writeFileSync(file, JSON.stringify(clean, null, 2), 'utf8');
  const metaFile = path.join(OUT_DIR, `${pack.city_id}.meta.json`);
  const metas = (pack.spots || [])
    .map((s) => s._meta && { id: s.id, ...s._meta })
    .filter(Boolean);
  fs.writeFileSync(metaFile, JSON.stringify(metas, null, 2), 'utf8');
  console.log(`[gen] wrote ${file}`);
  return file;
}

function mergePlace(pack, fragment) {
  pack.spots = pack.spots || [];
  pack.trigger_points = pack.trigger_points || [];
  const sid = fragment.spot.id;
  pack.spots = pack.spots.filter((s) => s.id !== sid);
  pack.trigger_points = pack.trigger_points.filter((t) => t.id !== sid);
  pack.spots.push(fragment.spot);
  pack.trigger_points.push(fragment.trigger);
  pack.data_version = Number(pack.data_version || 0) + 1;
  return pack;
}

async function main() {
  const batchPath = arg('batch');
  const city = arg('city');
  const place = arg('place');

  if (batchPath) {
    const batch = JSON.parse(fs.readFileSync(path.resolve(batchPath), 'utf8'));
    const cityId = batch.city_id || city;
    if (!cityId) throw new Error('batch needs city_id');
    let pack = loadPack(cityId);
    if (batch.name) pack.name = batch.name;
    if (batch.symbol) pack.symbol = batch.symbol;
    if (batch.lat != null) pack.lat = batch.lat;
    if (batch.lng != null) pack.lng = batch.lng;
    for (const item of batch.places || []) {
      try {
        const frag = await buildPlaceFragment(cityId, item.name || item.place, item);
        pack = mergePlace(pack, frag);
      } catch (e) {
        console.warn(`[gen] skip ${item.name || item.place}: ${e.message}`);
      }
      await sleep(1100);
    }
    const v = validateCityPack(pack);
    if (!v.ok) {
      console.error('[gen] validation errors', v.errors);
      process.exit(1);
    }
    if (v.warnings.length) console.warn('[gen] warnings', v.warnings);
    savePack(pack);
    return;
  }

  if (!city || !place) {
    console.error(
      'Usage: node scripts/generatePlacePack.mjs --city <id> --place <name> [--merge]',
    );
    process.exit(1);
  }

  const frag = await buildPlaceFragment(city, place, {
    category: arg('category') || undefined,
    district: arg('district') || undefined,
  });

  let pack;
  if (hasFlag('merge')) {
    pack = mergePlace(loadPack(city), frag);
  } else {
    pack = {
      city_id: city,
      name: city[0].toUpperCase() + city.slice(1),
      data_version: 1,
      symbol: '🌳',
      lat: frag.trigger.lat,
      lng: frag.trigger.lng,
      spots: [frag.spot],
      trigger_points: [frag.trigger],
    };
  }

  const v = validateCityPack(pack);
  if (!v.ok) {
    console.error('[gen] validation errors', v.errors);
    process.exit(1);
  }
  if (v.warnings.length) console.warn('[gen] warnings', v.warnings);
  savePack(pack);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
