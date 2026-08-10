#!/usr/bin/env node
/**
 * Revert clearly wrong Google moves for Prisdorf (outside village bbox or absurd delta).
 * Uses previous trigger coords from a backup snapshot embedded via comparing report MOVED_FAR
 * against reasonable Prisdorf bounds.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACK = path.join(ROOT, 'data/staedte/prisdorf.json');
const REPORT = path.join(ROOT, 'data/staedte/prisdorf_google_full_report.json');

// Approximate Prisdorf municipality + immediate Peiner Hag fringe
const BOUNDS = {
  minLat: 53.665,
  maxLat: 53.695,
  minLng: 9.735,
  maxLng: 9.785,
};

function inBounds(lat, lng) {
  return (
    lat >= BOUNDS.minLat &&
    lat <= BOUNDS.maxLat &&
    lng >= BOUNDS.minLng &&
    lng <= BOUNDS.maxLng
  );
}

function offset(lat, lng, northM, eastM) {
  const dLat = northM / 111320;
  const dLng = eastM / (111320 * Math.cos((lat * Math.PI) / 180));
  return { lat: +(lat + dLat).toFixed(7), lng: +(lng + dLng).toFixed(7) };
}

function boxPolygon(lat, lng, halfM) {
  const a = offset(lat, lng, -halfM, -halfM);
  const b = offset(lat, lng, -halfM, halfM);
  const c = offset(lat, lng, halfM, halfM);
  const d = offset(lat, lng, halfM, -halfM);
  return [
    { latitude: a.lat, longitude: a.lng },
    { latitude: b.lat, longitude: b.lng },
    { latitude: c.lat, longitude: c.lng },
    { latitude: d.lat, longitude: d.lng },
    { latitude: a.lat, longitude: a.lng },
  ];
}

function elongateEW(lat, lng, halfLenM, halfWM) {
  const a = offset(lat, lng, -halfWM, -halfLenM);
  const b = offset(lat, lng, -halfWM, halfLenM);
  const c = offset(lat, lng, halfWM, halfLenM);
  const d = offset(lat, lng, halfWM, -halfLenM);
  return [
    { latitude: a.lat, longitude: a.lng },
    { latitude: b.lat, longitude: b.lng },
    { latitude: c.lat, longitude: c.lng },
    { latitude: d.lat, longitude: d.lng },
    { latitude: a.lat, longitude: a.lng },
  ];
}

// Original coords from cloud pack before full optimize (prisdorf v7/v9 triggers)
// Recovered from earlier downloaded pack via report deltas: new = old + vector... 
// Better: use git? pack may not be in git. Use report: we stored only NEW google coords.
// We'll fetch previous from supabase public v9? Or reconstruct from delta.

const report = JSON.parse(fs.readFileSync(REPORT, 'utf8'));
const pack = JSON.parse(fs.readFileSync(PACK, 'utf8'));

// Reconstruct previous lat/lng: we don't have old coords in report.
// Load backup if exists, else re-download last known good from storage before overwrite...
// Upload already hasn't happened for v11. Local file is v11. We need originals.
// Try to get from agent-tools dump or re-fetch isn't v11 yet on cloud - cloud still v10.
// Download cloud prisdorf (v10) as source of original trigger coords for non-bahnhof.

async function main() {
  const url =
    'https://evswmsydbmrzzjjfynvj.supabase.co/storage/v1/object/public/staedte/prisdorf.json';
  const prev = await (await fetch(url)).json();
  console.log('cloud version', prev.data_version);

  const prevTrig = new Map((prev.trigger_points || []).map((t) => [t.id, t]));
  const reverted = [];
  const keptGoogle = [];

  for (const spot of pack.spots) {
    const row = (report.report || []).find((r) => r.id === spot.id);
    const trigger = pack.trigger_points.find((t) => t.id === spot.id);
    const old = prevTrig.get(spot.id);
    if (!trigger || !old || old.lat == null) continue;

    const g = row?.google;
    const googleInside = g ? inBounds(g.lat, g.lng) : false;
    const oldInside = inBounds(old.lat, old.lng);
    const delta = row?.delta_m ?? 0;

    // Revert if Google moved far AND (out of bounds OR old was in bounds and delta>800)
    const shouldRevert =
      spot.id !== 'prisdorf_bahnhof_wartehäuschen' &&
      ((g && !googleInside && oldInside) ||
        (delta > 900 && oldInside) ||
        (g && !googleInside && delta > 400));

    if (!shouldRevert) {
      if (g && googleInside) keptGoogle.push(spot.id);
      continue;
    }

    const lat = old.lat;
    const lng = old.lng;
    const isLong =
      /bahnhof|brücke|unterführung|feld|pinnau|wald|teich/i.test(spot.name);
    const polygon = isLong
      ? elongateEW(lat, lng, 70, 20)
      : boxPolygon(lat, lng, 28);
    const ap1 = offset(lat, lng, -36, 0);
    const ap2 = offset(lat, lng, 30, 10);

    spot.polygonCoordinates = polygon;
    spot.approach_triggers = [
      {
        id: `${spot.id}_approach_1`,
        lat: ap1.lat,
        lng: ap1.lng,
        radius_m: 28,
        teaser_text: `Gleich voraus liegt ${spot.name.split(' mit ')[0].split(' und ')[0]}.`,
        condition_rule: 'always',
      },
      {
        id: `${spot.id}_approach_2`,
        lat: ap2.lat,
        lng: ap2.lng,
        radius_m: 26,
        teaser_text: `Von hier aus bist du nah an ${spot.name.split(' mit ')[0].split(' und ')[0]}.`,
        condition_rule: 'always',
      },
    ];
    // clear dubious auto-subs on revert
    if (spot.id !== 'prisdorf_bahnhof_wartehäuschen') spot.sub_pois = [];

    trigger.lat = lat;
    trigger.lng = lng;
    trigger.polygon = polygon.map((p) => ({ lat: p.latitude, lng: p.longitude }));
    trigger.trigger_kind = 'area';
    trigger.trigger_type = 'polygon';
    trigger.radius_m = isLong ? 45 : 32;

    reverted.push({
      id: spot.id,
      reason: !googleInside ? 'google_out_of_bounds' : `delta_${delta}`,
      restored: { lat, lng },
      rejected_google: g || null,
    });
  }

  pack.data_version = Math.max(Number(pack.data_version || 0) + 1, 12);
  fs.writeFileSync(PACK, JSON.stringify(pack, null, 2));

  const indexPath = path.join(ROOT, 'data/staedte/index.json');
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  for (const c of index.available_cities || []) {
    if (c.id === 'prisdorf') c.data_version = pack.data_version;
  }
  index.last_global_update = new Date().toISOString();
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));

  const out = {
    version: pack.data_version,
    reverted: reverted.length,
    details: reverted,
    keptGoogleInBounds: keptGoogle.length,
  };
  fs.writeFileSync(
    path.join(ROOT, 'data/staedte/prisdorf_revert_report.json'),
    JSON.stringify(out, null, 2),
  );
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
