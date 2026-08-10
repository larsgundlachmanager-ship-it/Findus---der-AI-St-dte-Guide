#!/usr/bin/env node
/**
 * Normalize legacy multi-trigger packs (e.g. Pinneberg _t1/_t2/_t3)
 * into Module-1 shape: one area trigger id == spot.id + polygon + approaches.
 *
 * Usage:
 *   node scripts/cityPack/normalizeLegacyPack.mjs --city pinneberg
 *   node scripts/cityPack/normalizeLegacyPack.mjs --city pinneberg --apply
 */

import path from 'node:path';
import {
  STAEDTE_DIR,
  arg,
  boxPolygon,
  defaultLiveResearch,
  hasFlag,
  loadEnvFile,
  loadPack,
  offset,
  relatedTriggers,
  savePack,
  writeJson,
} from './lib.mjs';
import { requireGoogleKey, resolvePlace } from './google.mjs';
import { runQualityGate } from './qualityGate.mjs';

loadEnvFile();

function mapDistrictToCategory(district) {
  const d = String(district || '').toLowerCase();
  if (/transport|bahn/.test(d)) return 'bahnhof';
  if (/culture|museum|denkmal/.test(d)) return 'museum';
  if (/food|gastro|hotel/.test(d)) return 'hotel';
  if (/shop|leisure/.test(d)) return 'einkaufen';
  if (/natur|park/.test(d)) return 'natur';
  if (/kirche/.test(d)) return 'kirche';
  return d || 'ort';
}

async function main() {
  const cityId = arg('city');
  if (!cityId) {
    console.error(
      'Usage: node scripts/cityPack/normalizeLegacyPack.mjs --city pinneberg [--apply]',
    );
    process.exit(1);
  }
  const apply = hasFlag('apply');
  const pack = loadPack(cityId);
  if (!pack) throw new Error(`Pack not found: ${cityId}`);

  let googleOk = false;
  try {
    requireGoogleKey();
    googleOk = true;
  } catch (e) {
    console.warn(`[normalize] ${e.message} — using existing trigger coords`);
  }

  const report = { city_id: cityId, spots: [] };
  const newTriggers = [];

  for (const spot of pack.spots || []) {
    const related = relatedTriggers(pack, spot);
    if (!related.length) {
      report.spots.push({ id: spot.id, status: 'NO_TRIGGERS' });
      continue;
    }

    // Prefer trigger with richest deep pool / general_info
    const best = [...related].sort((a, b) => {
      const da = (a.deep_data_pool || []).length + (a.general_info ? 5 : 0);
      const db = (b.deep_data_pool || []).length + (b.general_info ? 5 : 0);
      return db - da;
    })[0];

    let lat = best.lat;
    let lng = best.lng;
    let google = null;
    if (googleOk) {
      try {
        google = await resolvePlace(`${spot.name}, ${pack.name || cityId}`, {
          near: { lat: pack.lat, lng: pack.lng },
          preferTypes:
            /bahn|station/i.test(spot.name)
              ? ['train_station', 'transit_station']
              : ['point_of_interest', 'establishment'],
        });
        if (google) {
          lat = google.lat;
          lng = google.lng;
        }
      } catch (e) {
        report.spots.push({
          id: spot.id,
          status: 'GOOGLE_FAIL',
          error: e.message,
        });
      }
    }

    const half =
      /bahn|hafen|promenade|passage/i.test(`${spot.name} ${spot.category}`)
        ? 55
        : 28;

    // Merge deep pools from all related triggers
    const mergedDeep = [];
    const seen = new Set();
    let general = '';
    for (const t of related) {
      if ((t.general_info || '').length > general.length) {
        general = t.general_info;
      }
      for (const e of t.deep_data_pool || []) {
        const text = typeof e === 'string' ? e : e?.text;
        if (!text) continue;
        const key = text.toLowerCase().slice(0, 90);
        if (seen.has(key)) continue;
        seen.add(key);
        mergedDeep.push(
          typeof e === 'string'
            ? { text: e, tags: ['legacy_merged'] }
            : { text: e.text, tags: [...new Set([...(e.tags || []), 'legacy_merged'])] },
        );
      }
    }

    // Other legacy points → approaches
    const approaches = related
      .filter((t) => t !== best)
      .map((t, i) => ({
        id: `${spot.id}_approach_legacy_${i + 1}`,
        lat: t.lat,
        lng: t.lng,
        radius_m: t.radius_m || 28,
        teaser_text:
          (t.general_info && t.general_info.slice(0, 160)) ||
          `Du näherst dich ${spot.name} — der Haupteingang liegt voraus.`,
        condition_rule: 'always',
      }));

    // Always ensure at least one approach offset from entrance
    if (!approaches.length) {
      const a = offset(lat, lng, 38, 0);
      approaches.push({
        id: `${spot.id}_approach_n`,
        lat: a.lat,
        lng: a.lng,
        radius_m: 32,
        teaser_text: `Kurz vorher: ${spot.name} liegt voraus — Ziel ist der Haupteingang.`,
        condition_rule: 'always',
      });
    }

    const category =
      spot.category && !/culture|food_lifestyle|shopping_leisure|transport/i.test(spot.category)
        ? spot.category
        : mapDistrictToCategory(spot.district || spot.category);

    const row = {
      id: spot.id,
      status: 'NORMALIZED',
      fromTriggers: related.map((t) => t.id),
      lat,
      lng,
      google: google
        ? { place_id: google.place_id, address: google.address }
        : null,
      approaches: approaches.length,
      deep: mergedDeep.length,
    };
    report.spots.push(row);

    if (apply) {
      spot.category = category;
      spot.tags = [
        ...new Set([...(spot.tags || []), category, 'module1', 'normalized']),
      ];
      spot.polygonCoordinates = boxPolygon(lat, lng, half);
      spot.approach_triggers = approaches;
      spot.sub_pois = [
        {
          id: `${spot.id}_sub_eingang`,
          name: `${spot.name} · Haupteingang`,
          lat,
          lng,
          radius_m: 10,
          fact_details:
            'Haupteingang / Google-Maps-Navigationspin — Area-Trigger-Zentrum.',
          tags: ['sub_poi', 'eingang', 'gps_entrance'],
        },
        ...(spot.sub_pois || []).filter(
          (s) => !String(s.id || '').includes('eingang'),
        ),
      ];

      newTriggers.push({
        id: spot.id,
        name: spot.name,
        lat,
        lng,
        radius_m: half,
        trigger_kind: 'area',
        trigger_type: 'polygon',
        polygon: spot.polygonCoordinates.map((p) => ({
          lat: p.latitude,
          lng: p.longitude,
        })),
        general_info: general || '',
        deep_data_pool: mergedDeep,
      });
    }
  }

  if (apply) {
    pack.trigger_points = newTriggers;
    if (!pack._live_research?.length) {
      pack._live_research = defaultLiveResearch(pack.name || cityId);
    }
    const file = savePack(pack, { bumpVersion: true });
    console.log(`[normalize] wrote ${file}`);
  }

  const gate = runQualityGate(pack, { strict: false });
  const reportPath = writeJson(
    path.join(STAEDTE_DIR, `${cityId}.normalize_report.json`),
    { ...report, apply, gate },
  );
  console.log(`[normalize] report ${reportPath}`);
  console.log(
    `[normalize] ok=${gate.ok} errors=${gate.errors.length} warnings=${gate.warnings.length}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
