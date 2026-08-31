#!/usr/bin/env node
/**
 * Generic Module-1 city pack skeleton builder.
 *
 * Usage:
 *   node scripts/cityPack/buildCitySkeleton.mjs --city "Sylt" --id sylt
 *   node scripts/cityPack/buildCitySkeleton.mjs --city Wangerooge --refresh
 *   node scripts/cityPack/buildCitySkeleton.mjs --city Prisdorf --radius 2500
 *
 * Creates/merges data/staedte/<id>.json with discovered places, polygons,
 * approach stubs, trigger stubs, and _live_research prompts.
 * Does NOT invent history — leaves gaps for Deep Research.
 */

import {
  ROOT,
  STAEDTE_DIR,
  arg,
  boxPolygon,
  defaultLiveResearch,
  distM,
  hasFlag,
  loadEnvFile,
  loadPack,
  mapGoogleTypeToCategory,
  offset,
  savePack,
  slugify,
  writeJson,
} from './lib.mjs';
import {
  DISCOVERY_QUERIES,
  requireGoogleKey,
  resolvePlace,
  placesTextAll,
  streetViewMeta,
} from './google.mjs';
import { STORY_DISCOVERY_QUERIES, suggestedDiscoveryRadius } from './placeCategoryPolicy.mjs';
import { runQualityGate } from './qualityGate.mjs';
import path from 'node:path';

loadEnvFile();

function syntheticApproaches(lat, lng, placeName, spotId) {
  const dirs = [
    { id: 'n', north: 42, east: 0, label: 'von Norden' },
    { id: 's', north: -40, east: 0, label: 'von Süden' },
    { id: 'e', north: 8, east: 38, label: 'von Osten' },
  ];
  return dirs.slice(0, 2).map((d, i) => {
    const p = offset(lat, lng, d.north, d.east);
    return {
      id: `${spotId}_approach_${d.id}`,
      lat: p.lat,
      lng: p.lng,
      radius_m: i === 0 ? 34 : 22,
      teaser_text: `Wenn du ${d.label} kommst: etwa ${Math.round(Math.hypot(d.north, d.east))} Meter weiter liegt ${placeName} — schau nach dem Eingang / der markanten Fassade.`,
      condition_rule: 'always',
      needs_visual_review: true,
    };
  });
}

function makeSpotTrigger(cityId, place, category) {
  const spotId =
    place.id ||
    `${slugify(cityId)}_${slugify(place.name)}`.slice(0, 80);
  const lat = place.lat;
  const lng = place.lng;
  const half = place.halfM || (category === 'bahnhof' ? 40 : 22);

  const spot = {
    id: spotId,
    name: place.name,
    district: place.district || category,
    category,
    tags: [
      category,
      'module1',
      place.optional ? 'optional_live' : 'must_have',
      'skeleton',
      'google_places',
    ].filter(Boolean),
    bullets: [
      place.address
        ? `Adresse (Google): ${place.address}.`
        : `Standort laut Google Maps Pin (Eingang/Navigation).`,
      place.maps_url ? `Google Maps: ${place.maps_url}` : null,
    ].filter(Boolean),
    facts: {
      origin: undefined,
      architecture: undefined,
      now: place.address ? `Adresse: ${place.address}` : undefined,
      tags: [category, 'needs_deep_research'],
    },
    polygonCoordinates: boxPolygon(lat, lng, half),
    approach_triggers: syntheticApproaches(lat, lng, place.name, spotId),
    sub_pois: [
      {
        id: `${spotId}_sub_eingang`,
        name: `${place.name} · Haupteingang`,
        lat,
        lng,
        radius_m: 10,
        fact_details:
          'Trigger am Google-Maps-Navigationspin / Haupteingang. Visuell prüfen.',
        tags: ['sub_poi', 'eingang', 'gps_entrance'],
      },
    ],
    nav_waypoints: [],
    _google: {
      place_id: place.place_id || null,
      rating: place.rating ?? null,
    },
  };

  const trigger = {
    id: spotId,
    name: place.name,
    lat,
    lng,
    radius_m: half,
    trigger_kind: 'area',
    trigger_type: 'polygon',
    polygon: spot.polygonCoordinates.map((p) => ({
      lat: p.latitude,
      lng: p.longitude,
    })),
    general_info: '',
    deep_data_pool: [
      {
        text: `GPS: Trigger-Zentrum = Google-Maps-Pin / Navigationseingang (${lat.toFixed(6)}, ${lng.toFixed(6)}).`,
        tags: ['gps_confirmed', 'orientierung', 'sourced_google'],
      },
    ],
  };

  return { spot, trigger };
}

async function discoverPlaces(cityName, center, radiusM, includeOptional) {
  const found = [];
  const seen = new Set();
  const queries = [
    ...DISCOVERY_QUERIES,
    ...STORY_DISCOVERY_QUERIES.map((q) => ({
      q: q.q,
      categoryHint: q.categoryHint,
      optional: q.tier === 4,
    })),
  ];

  for (const dq of queries) {
    if (dq.optional && !includeOptional) continue;
    const query = `${dq.q} ${cityName}`;
    console.log(`[discover] ${query}`);
    let results = [];
    try {
      const data = await placesTextAll(
        query,
        { lat: center.lat, lng: center.lng, radiusM },
        { maxPages: 1 },
      );
      results = data.results || [];
    } catch (e) {
      console.warn(`[discover] fail ${query}: ${e.message}`);
      continue;
    }

    for (const r of results.slice(0, 20)) {
      const loc = r.geometry?.location;
      if (!loc) continue;
      if (distM(center, { lat: loc.lat, lng: loc.lng }) > radiusM + 800) continue;
      const key = (r.place_id || `${r.name}_${loc.lat}`).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      const category =
        dq.categoryHint || mapGoogleTypeToCategory(r.types || []);
      found.push({
        name: r.name,
        lat: loc.lat,
        lng: loc.lng,
        place_id: r.place_id,
        address: r.formatted_address || r.vicinity || null,
        types: r.types || [],
        rating: r.rating ?? null,
        category,
        optional: !!dq.optional,
        maps_url: r.place_id
          ? `https://www.google.com/maps/place/?q=place_id:${r.place_id}`
          : null,
      });
    }
  }

  return found;
}

function mergeIntoPack(pack, fragment) {
  pack.spots = pack.spots || [];
  pack.trigger_points = pack.trigger_points || [];
  const sid = fragment.spot.id;
  const existing = pack.spots.find((s) => s.id === sid);
  if (existing && !hasFlag('refresh')) {
    // keep curated content; only fill missing geo
    if (!existing.polygonCoordinates?.length) {
      existing.polygonCoordinates = fragment.spot.polygonCoordinates;
    }
    if (!(existing.approach_triggers || []).length) {
      existing.approach_triggers = fragment.spot.approach_triggers;
    }
    return pack;
  }
  pack.spots = pack.spots.filter((s) => s.id !== sid);
  pack.trigger_points = pack.trigger_points.filter((t) => t.id !== sid);
  // strip internal
  delete fragment.spot._google;
  pack.spots.push(fragment.spot);
  pack.trigger_points.push(fragment.trigger);
  return pack;
}

async function main() {
  requireGoogleKey();
  const cityName = arg('city');
  if (!cityName) {
    console.error(
      'Usage: node scripts/cityPack/buildCitySkeleton.mjs --city "Name" [--id slug] [--radius 3500] [--optional] [--refresh]',
    );
    process.exit(1);
  }
  const cityId = slugify(arg('id') || cityName);
  const includeOptional = hasFlag('optional');
  const symbol = arg('symbol') || '🌳';

  console.log(`[build] geocode ${cityName}`);
  const centerHit = await resolvePlace(cityName, {
    preferTypes: ['locality', 'political'],
  });
  if (!centerHit) throw new Error(`Could not geocode city: ${cityName}`);
  const center = { lat: centerHit.lat, lng: centerHit.lng };
  const radiusM = Number(
    arg('radius') || suggestedDiscoveryRadius({ name: cityName, city_id: cityId }),
  );
  console.log(`[build] center ${center.lat}, ${center.lng} radius=${radiusM}`);

  let pack = loadPack(cityId) || {
    city_id: cityId,
    name: cityName,
    data_version: 0,
    symbol,
    lat: center.lat,
    lng: center.lng,
    district_division: [],
    spots: [],
    trigger_points: [],
  };

  pack.name = pack.name || cityName;
  pack.symbol = pack.symbol || symbol;
  pack.lat = pack.lat ?? center.lat;
  pack.lng = pack.lng ?? center.lng;
  pack._live_research = pack._live_research?.length
    ? pack._live_research
    : defaultLiveResearch(cityName);
  if (!pack._links) pack._links = [];
  if (!pack._coverage) {
    // ~3.5 km half-span estimate; refine via Nominatim / manual later
    const half = 0.032;
    const cos = Math.max(0.2, Math.cos((center.lat * Math.PI) / 180));
    pack._coverage = {
      latMin: +(center.lat - half).toFixed(5),
      latMax: +(center.lat + half).toFixed(5),
      lngMin: +(center.lng - half / cos).toFixed(5),
      lngMax: +(center.lng + half / cos).toFixed(5),
    };
  }

  const places = await discoverPlaces(
    cityName,
    center,
    radiusM,
    includeOptional,
  );
  console.log(`[build] discovered ${places.length} places`);

  const report = { city_id: cityId, center, added: [], skipped: [] };

  for (const place of places) {
    // Dedup by proximity to existing spots
    const nearExisting = (pack.spots || []).find((s) => {
      const t = (pack.trigger_points || []).find((x) => x.id === s.id);
      if (!t) return false;
      return distM({ lat: t.lat, lng: t.lng }, place) < 55;
    });
    if (nearExisting && !hasFlag('refresh')) {
      report.skipped.push({ name: place.name, near: nearExisting.id });
      continue;
    }

    const frag = makeSpotTrigger(cityId, place, place.category);
    // Street View check on approaches (metadata only)
    for (const a of frag.spot.approach_triggers) {
      try {
        const sv = await streetViewMeta(a.lat, a.lng);
        a.streetview_ok = sv.status === 'OK';
      } catch {
        a.streetview_ok = false;
      }
    }
    pack = mergeIntoPack(pack, frag);
    report.added.push(frag.spot.id);
  }

  // Clean streetview flags from approaches before save? Keep as soft signal for agent
  const file = savePack(pack, { bumpVersion: true });
  const gate = runQualityGate(pack, { strict: false });
  const reportPath = writeJson(
    path.join(STAEDTE_DIR, `${cityId}.build_report.json`),
    { ...report, gate, file },
  );

  console.log(`[build] wrote ${file}`);
  console.log(`[build] report ${reportPath}`);
  console.log(
    `[build] spots=${pack.spots.length} added=${report.added.length} warnings=${gate.warnings.length} errors=${gate.errors.length}`,
  );
  if (gate.errors.length) {
    console.log('[build] gate errors (non-fatal for skeleton):', gate.errors.slice(0, 12));
  }
  console.log(
    '[build] Next: paste Deep Research → mergeDeepResearch → gpsWegweiserLoop → qualityGate --strict → upload',
  );

  // Cover für Stadtauswahl (Wikipedia) — nicht fatal
  if (!pack.cover_url) {
    try {
      const { spawnSync } = await import('node:child_process');
      const r = spawnSync(
        process.execPath,
        [
          path.join(ROOT, 'scripts/cityPack/fetchCityCover.mjs'),
          '--id',
          cityId,
          '--city',
          cityName,
        ],
        { stdio: 'inherit' },
      );
      if (r.status !== 0) {
        console.warn('[build] cover fetch soft-failed — set cover_url manually later');
      }
    } catch (err) {
      console.warn('[build] cover fetch skipped:', err?.message || err);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
