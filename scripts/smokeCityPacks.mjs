#!/usr/bin/env node
/** Smoke-test: map prisdorf/wangerooge packs without TS compile. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

// Dynamic import of compiled logic via duplicated minimal assert:
// We import the TypeScript via tsx if available; else validate structure only.
const prisdorf = JSON.parse(
  fs.readFileSync(path.join(root, 'data/staedte/prisdorf.json'), 'utf8'),
);
const wangerooge = JSON.parse(
  fs.readFileSync(path.join(root, 'data/staedte/wangerooge.json'), 'utf8'),
);

function assertPack(pack, label) {
  if (!pack.city_id) throw new Error(`${label}: no city_id`);
  if (!pack.spots?.length) throw new Error(`${label}: no spots`);
  const geoSpots = pack.spots.filter(
    (s) =>
      (s.polygonCoordinates && s.polygonCoordinates.length >= 3) ||
      (s.approach_triggers && s.approach_triggers.length) ||
      (s.sub_pois && s.sub_pois.length),
  );
  console.log(
    `[ok] ${label} v${pack.data_version} spots=${pack.spots.length} geoEnhanced=${geoSpots.length}`,
  );
}

assertPack(prisdorf, 'prisdorf');
assertPack(wangerooge, 'wangerooge');

function assertNarrationCoverage(pack, label) {
  const triggers = pack.trigger_points || [];
  const withInfo = triggers.filter(
    (t) =>
      String(t.general_info || '').trim().length >= 20 &&
      t.trigger_kind !== 'approach' &&
      t.trigger_kind !== 'sub',
  );
  const areas = triggers.filter(
    (t) => t.trigger_kind !== 'approach' && t.trigger_kind !== 'sub',
  );
  const missing = areas.filter(
    (t) => String(t.general_info || '').trim().length < 20,
  );
  console.log(
    `[ok] ${label} narration coverage areaTriggers=${areas.length} withErzählung=${withInfo.length} missing=${missing.length}`,
  );
  if (missing.length > areas.length * 0.4) {
    throw new Error(
      `${label}: too many area triggers without general_info (${missing.length}/${areas.length})`,
    );
  }
  for (const m of missing.slice(0, 8)) {
    console.warn(
      `  [warn] ${label} missing Erzählung: ${m.id || m.name || '?'}`,
    );
  }
}

assertNarrationCoverage(prisdorf, 'prisdorf');
assertNarrationCoverage(wangerooge, 'wangerooge');

const bahnhof = prisdorf.spots.find((s) =>
  String(s.id).includes('bahnhof'),
);
if (!bahnhof?.polygonCoordinates) throw new Error('bahnhof missing polygon');
if (!bahnhof.sub_pois || bahnhof.sub_pois.length < 2) {
  throw new Error('bahnhof missing subs');
}
console.log('[ok] prisdorf bahnhof polygon+subs');
