#!/usr/bin/env node
/**
 * Prisdorf: keep only Bahnhof Prisdorf + Historisches Bahnwartehäuschen as
 * railway map stories. Drop Güter-/duplicate Wartehäuschen pins and the
 * Pinneberg Kriegerdenkmal (wrong city).
 *
 *   node scripts/cityPack/fixPrisdorfBahnPins.mjs
 *   node scripts/cityPack/fixPrisdorfBahnPins.mjs --dry
 */
import { hasFlag, loadPack, savePack } from './lib.mjs';

/** OSM node 3640048207 railway=halt Prisdorf (Nominatim 2026-08-15). */
const HALT = { lat: 53.6752944, lng: 9.7602008 };

/** Keep OSM cabin centroid already in pack if present; else Kulturdenkmal. */
const HUT_FALLBACK = { lat: 53.675278, lng: 9.760278 };

const DROP_SPOT_IDS = new Set([
  'prisdorf_kriegerdenkmal_am_pinneberger_bahnhof',
]);

const DROP_SUB_RE = /wartehaeuschen_sub$|gueterbahnsteig_sub$/i;
const DROP_APPROACH_RE = /gueter_approach/i;

function main() {
  const dry = hasFlag('dry');
  const pack = loadPack('prisdorf');
  if (!pack) throw new Error('prisdorf pack missing');

  const actions = [];

  // --- Drop wrong-city / fake railway spots ---
  const beforeSpots = (pack.spots || []).length;
  pack.spots = (pack.spots || []).filter((s) => {
    if (DROP_SPOT_IDS.has(s.id)) {
      actions.push(`removed spot ${s.id}`);
      return false;
    }
    return true;
  });
  pack.trigger_points = (pack.trigger_points || []).filter((t) => {
    if (DROP_SPOT_IDS.has(t.id)) {
      actions.push(`removed trigger ${t.id}`);
      return false;
    }
    return true;
  });
  if (pack.spots.length !== beforeSpots) {
    actions.push(`spots ${beforeSpots} → ${pack.spots.length}`);
  }

  // --- Bahnhof Prisdorf ---
  const bahnhof = pack.spots.find((s) => s.id === 'prisdorf_bahnhof_wartehäuschen');
  const bahnhofTrig = pack.trigger_points.find(
    (t) => t.id === 'prisdorf_bahnhof_wartehäuschen',
  );
  if (!bahnhof || !bahnhofTrig) throw new Error('Bahnhof spot/trigger missing');

  bahnhof.name = 'Bahnhof Prisdorf';
  bahnhofTrig.name = 'Bahnhof Prisdorf';
  actions.push('renamed Haltepunkt → Bahnhof Prisdorf');

  const beforeSubs = (bahnhof.sub_pois || []).map((s) => s.id);
  bahnhof.sub_pois = (bahnhof.sub_pois || []).filter((s) => {
    const id = String(s.id || '');
    if (DROP_SUB_RE.test(id)) {
      actions.push(`removed bahnhof sub ${id}`);
      return false;
    }
    return true;
  });
  // Keep only entrance sub (nav target); never a second Wartehäuschen pin.
  const hasEntrance = bahnhof.sub_pois.some((s) =>
    /eingang|entrance|nav_target/i.test(
      `${s.id || ''} ${(s.tags || []).join(' ')} ${s.name || ''}`,
    ),
  );
  if (!hasEntrance) {
    bahnhof.sub_pois.push({
      id: 'prisdorf_bahnhof_wartehäuschen_sub_eingang',
      name: 'Bahnhof Prisdorf · Haupteingang',
      lat: HALT.lat,
      lng: HALT.lng,
      radius_m: 10,
      fact_details: 'GPS-Eingang (OSM railway=halt node 3640048207).',
      tags: ['sub_poi', 'eingang', 'gps_entrance', 'nav_target', 'sourced_osm'],
    });
    actions.push('added bahnhof entrance sub at OSM halt');
  } else {
    for (const s of bahnhof.sub_pois) {
      if (/eingang/i.test(String(s.id || '') + String(s.name || ''))) {
        s.name = 'Bahnhof Prisdorf · Haupteingang';
        s.lat = HALT.lat;
        s.lng = HALT.lng;
      }
    }
  }

  bahnhof.approach_triggers = (bahnhof.approach_triggers || []).filter((a) => {
    const id = String(a.id || '');
    if (DROP_APPROACH_RE.test(id)) {
      actions.push(`removed approach ${id}`);
      return false;
    }
    return true;
  });

  // Ensure entrance coords match OSM halt (nav target).
  for (const s of bahnhof.sub_pois) {
    const tags = (s.tags || []).map((t) => String(t).toLowerCase());
    if (tags.includes('gps_entrance') || tags.includes('nav_target')) {
      s.lat = HALT.lat;
      s.lng = HALT.lng;
    }
  }

  // Drop bullet that sells Wartehäuschen as "eigener Stopp" under Bahnhof
  // (standalone story covers it); keep factual mention optional.
  if (Array.isArray(bahnhof.bullets)) {
    bahnhof.bullets = bahnhof.bullets.map((b) =>
      String(b).replace(
        /steht direkt am Bahnsteig — eigener Blickfang, eigener Stopp\./i,
        'steht direkt am Bahnsteig (eigenes Denkmal nebenan).',
      ),
    );
  }
  if (bahnhof.facts?.architecture) {
    bahnhof.facts.architecture = String(bahnhof.facts.architecture).replace(
      /— eigener Sub-Stopp\.?/i,
      '— eigenes Denkmal nebenan.',
    );
  }

  actions.push(
    `bahnhof subs kept: ${(bahnhof.sub_pois || []).map((s) => s.id).join(', ') || '(none)'} (was ${beforeSubs.join(', ')})`,
  );

  // --- Historisches Bahnwartehäuschen (standalone only) ---
  const hut = pack.spots.find((s) => s.id === 'prisdorf_bahnwartehaeuschen');
  const hutTrig = pack.trigger_points.find(
    (t) => t.id === 'prisdorf_bahnwartehaeuschen',
  );
  if (!hut || !hutTrig) throw new Error('Wartehäuschen spot/trigger missing');

  hut.name = 'Historisches Bahnwartehäuschen';
  hutTrig.name = 'Historisches Bahnwartehäuschen';

  const hutEntrance = (hut.sub_pois || []).find((s) =>
    /eingang/i.test(`${s.id || ''} ${s.name || ''}`),
  );
  const hutLat =
    typeof hutEntrance?.lat === 'number' ? hutEntrance.lat : HUT_FALLBACK.lat;
  const hutLng =
    typeof hutEntrance?.lng === 'number' ? hutEntrance.lng : HUT_FALLBACK.lng;
  if (hutTrig) {
    hutTrig.lat = hutLat;
    hutTrig.lng = hutLng;
  }
  actions.push(
    `kept prisdorf_bahnwartehaeuschen @ ${hutLat.toFixed(6)},${hutLng.toFixed(6)}`,
  );

  // --- Transit stop + bike rack (were ~Bahnhofstraße mid, not OSM halt) ---
  const transitStops = pack._transit?.stops;
  if (Array.isArray(transitStops)) {
    for (const s of transitStops) {
      if (s.id === 'prisdorf_hp' || /^Prisdorf$/i.test(String(s.name || ''))) {
        s.lat = HALT.lat;
        s.lng = HALT.lng;
        actions.push('fixed _transit prisdorf_hp → OSM halt');
      }
    }
  }
  const parking = pack._mobility?.parking?.hint_spots;
  if (Array.isArray(parking)) {
    for (const h of parking) {
      if (/Fahrradständer Bahnhof/i.test(String(h.name || ''))) {
        h.lat = 53.67542;
        h.lng = 9.76035;
        actions.push('fixed Fahrradständer Bahnhof GPS near platform');
      }
    }
  }

  console.log(actions.map((a) => `• ${a}`).join('\n'));
  console.log(
    `OSM halt check: ${HALT.lat},${HALT.lng} (node 3640048207)`,
  );

  if (!dry) {
    savePack(pack);
    console.log('saved', pack.city_id, 'v' + pack.data_version);
  } else {
    console.log('dry-run, not saved');
  }
}

main();
