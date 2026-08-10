#!/usr/bin/env node
/**
 * Audit / fix spot GPS to Google Maps navigation pin (main entrance).
 *
 * Usage:
 *   node scripts/cityPack/auditEntrances.mjs --city wangerooge
 *   node scripts/cityPack/auditEntrances.mjs --city prisdorf --apply
 *   node scripts/cityPack/auditEntrances.mjs --city pinneberg --apply --max-delta 120
 */

import path from 'node:path';
import {
  STAEDTE_DIR,
  arg,
  boxPolygon,
  centroid,
  distM,
  hasFlag,
  loadEnvFile,
  loadPack,
  offset,
  savePack,
  writeJson,
} from './lib.mjs';
import { requireGoogleKey, resolvePlace, streetViewMeta } from './google.mjs';

loadEnvFile();

function packCenter(spot, trigger) {
  const c = centroid(spot.polygonCoordinates || spot.polygon);
  if (c) return c;
  if (trigger && typeof trigger.lat === 'number') {
    return { lat: trigger.lat, lng: trigger.lng };
  }
  return null;
}

function rebuildApproaches(spot, lat, lng) {
  const existing = spot.approach_triggers || spot.approachTriggers || [];
  if (existing.length >= 1) {
    // Keep relative offsets from old center if possible
    const old = packCenter(spot, { lat: spot._oldLat, lng: spot._oldLng });
    if (old && typeof old.lat === 'number') {
      return existing.map((a) => {
        const dNorth =
          ((a.lat ?? a.latitude) - old.lat) * 111320;
        const dEast =
          ((a.lng ?? a.longitude) - old.lng) *
          (111320 * Math.cos((old.lat * Math.PI) / 180));
        const p = offset(lat, lng, dNorth, dEast);
        return { ...a, lat: p.lat, lng: p.lng };
      });
    }
  }
  const a = offset(lat, lng, 40, 0);
  const b = offset(lat, lng, -35, 12);
  return [
    {
      id: `${spot.id}_approach_n`,
      lat: a.lat,
      lng: a.lng,
      radius_m: 32,
      teaser_text:
        existing[0]?.teaser_text ||
        `Kurz vorher: ${spot.name} liegt voraus — Ziel ist der Haupteingang laut Google Maps.`,
      condition_rule: 'always',
    },
    {
      id: `${spot.id}_approach_s`,
      lat: b.lat,
      lng: b.lng,
      radius_m: 24,
      teaser_text:
        existing[1]?.teaser_text ||
        `Von dieser Seite: geh auf den Eingang von ${spot.name} zu.`,
      condition_rule: 'always',
    },
  ];
}

async function main() {
  requireGoogleKey();
  const cityId = arg('city');
  if (!cityId) {
    console.error(
      'Usage: node scripts/cityPack/auditEntrances.mjs --city <id> [--apply] [--max-delta 80]',
    );
    process.exit(1);
  }
  const pack = loadPack(cityId);
  if (!pack) throw new Error(`Pack not found: ${cityId}`);
  const apply = hasFlag('apply');
  const maxDelta = Number(arg('max-delta') || 80);
  const near = { lat: pack.lat, lng: pack.lng };

  const rows = [];
  for (const spot of pack.spots || []) {
    const trigger = (pack.trigger_points || []).find((t) => t.id === spot.id);
    const before = packCenter(spot, trigger);
    const query = `${spot.name}, ${pack.name || cityId}, Germany`;
    let google = null;
    try {
      google = await resolvePlace(query, {
        near,
        preferTypes: spot.category === 'bahnhof'
          ? ['train_station', 'transit_station']
          : ['point_of_interest', 'establishment'],
      });
    } catch (e) {
      rows.push({ id: spot.id, name: spot.name, error: e.message });
      continue;
    }

    if (!google || !before) {
      rows.push({
        id: spot.id,
        name: spot.name,
        status: !google ? 'NO_GOOGLE' : 'NO_PACK_CENTER',
        google,
        before,
      });
      continue;
    }

    const delta = Math.round(distM(before, google));
    let sv = null;
    try {
      sv = await streetViewMeta(google.lat, google.lng);
    } catch {
      /* ignore */
    }

    const status =
      delta <= 25 ? 'OK' : delta <= maxDelta ? 'CHECK' : 'BAD';

    const row = {
      id: spot.id,
      name: spot.name,
      before,
      google: {
        lat: google.lat,
        lng: google.lng,
        place_id: google.place_id,
        address: google.address,
      },
      delta_m: delta,
      status,
      streetview: sv?.status || null,
    };
    rows.push(row);

    if (
      apply &&
      (hasFlag('force') ||
        (status === 'CHECK' && delta <= maxDelta) ||
        (status === 'BAD' && delta <= maxDelta * 1.5))
    ) {
      // Refuse absurd jumps (ambiguous Google hits)
      if (delta > Math.max(maxDelta * 1.5, 150) && !hasFlag('force')) {
        row.applied = false;
        row.skip_reason = 'delta_too_large_refusing_auto_apply';
      } else {
      spot._oldLat = before.lat;
      spot._oldLng = before.lng;
      const half =
        spot.category === 'bahnhof' || spot.category === 'hafen' ? 40 : 22;
      spot.polygonCoordinates = boxPolygon(google.lat, google.lng, half);
      spot.approach_triggers = rebuildApproaches(spot, google.lat, google.lng);
      delete spot._oldLat;
      delete spot._oldLng;

      // Ensure entrance sub
      const subs = spot.sub_pois || spot.subPois || [];
      const entrance = {
        id: `${spot.id}_sub_eingang`,
        name: `${spot.name} · Haupteingang`,
        lat: google.lat,
        lng: google.lng,
        radius_m: 10,
        fact_details:
          'Haupteingang / Google-Maps-Navigationspin — Area-Trigger-Zentrum.',
        tags: ['sub_poi', 'eingang', 'gps_entrance', 'sourced_google'],
      };
      spot.sub_pois = [
        entrance,
        ...subs.filter((s) => !String(s.id || '').includes('eingang')),
      ];

      if (trigger) {
        trigger.lat = google.lat;
        trigger.lng = google.lng;
        trigger.radius_m = half;
        trigger.polygon = spot.polygonCoordinates.map((p) => ({
          lat: p.latitude,
          lng: p.longitude,
        }));
        const pool = trigger.deep_data_pool || [];
        const gpsLine = {
          text: `GPS-Eingang (Google Maps Pin): ${google.lat.toFixed(6)}, ${google.lng.toFixed(6)}${google.address ? ` — ${google.address}` : ''}.`,
          tags: ['gps_confirmed', 'sourced_google', 'orientierung'],
        };
        trigger.deep_data_pool = [
          gpsLine,
          ...pool.filter(
            (e) =>
              !/GPS-Eingang|GPS: Trigger/i.test(
                typeof e === 'string' ? e : e?.text || '',
              ),
          ),
        ];
      }
      row.applied = true;
      }
    }
  }

  const reportPath = writeJson(
    path.join(STAEDTE_DIR, `${cityId}.entrance_audit.json`),
    {
      city_id: cityId,
      apply,
      maxDelta,
      summary: {
        ok: rows.filter((r) => r.status === 'OK').length,
        check: rows.filter((r) => r.status === 'CHECK').length,
        bad: rows.filter((r) => r.status === 'BAD').length,
        errors: rows.filter((r) => r.error).length,
        applied: rows.filter((r) => r.applied).length,
      },
      rows,
    },
  );

  if (apply) {
    const file = savePack(pack, { bumpVersion: true });
    console.log(`[audit] applied → ${file}`);
  }
  console.log(`[audit] report ${reportPath}`);
  const bad = rows.filter((r) => r.status === 'BAD' || r.status === 'CHECK');
  for (const r of bad.slice(0, 20)) {
    console.log(
      `  ${r.status} ${r.delta_m}m  ${r.id}  (${r.before?.lat?.toFixed?.(5)}→${r.google?.lat?.toFixed?.(5)})`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
