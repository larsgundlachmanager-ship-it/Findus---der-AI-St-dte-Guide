import fs from 'node:fs';
import path from 'node:path';

function patch(rel, apply) {
  const src = path.resolve(rel);
  const tmp = path.resolve('.cursor/_patch_tmp_' + path.basename(rel));
  let s = fs.readFileSync(src, 'utf8');
  const next = apply(s);
  if (next === s) {
    console.log('no change', rel);
    return;
  }
  fs.writeFileSync(tmp, next);
  fs.renameSync(tmp, src);
  console.log('patched', rel);
}

patch('scripts/cityPack/snapOsmStoryFootprints.mjs', (s) => {
  if (!s.includes("from './mapPaintPolicy.mjs'")) {
    s = s.replace(
      "from './lib.mjs';\nimport { fetchJson, sleep, fetchNominatimPolygon } from '../geo/osm.mjs';",
      "from './lib.mjs';\nimport { isIconOnlyPaint, needsBuildingFootprint, stampMapPaintOnPack } from './mapPaintPolicy.mjs';\nimport { fetchJson, sleep, fetchNominatimPolygon } from '../geo/osm.mjs';",
    );
  }
  if (!s.includes('isIconOnlyPaint(spot)')) {
    s = s.replace(
      'function needsSnap(spot, pack, { force = false, allSpots = false } = {}) {\n  if (isMapPointAmenity(spot)) return false;',
      'function needsSnap(spot, pack, { force = false, allSpots = false } = {}) {\n  if (isMapPointAmenity(spot) || isIconOnlyPaint(spot)) return false;\n  if (!needsBuildingFootprint(spot)) return false;',
    );
  }
  if (!s.includes('stampMapPaintOnPack(pack)')) {
    s = s.replace(
      `async function processCity(cityId, { dry, skipUpload, force, allSpots }) {
  const pack = loadPack(cityId);
  if (!pack) {
    console.warn(\`[osm-foot] skip missing \${cityId}\`);
    return { cityId, saved: false, rows: [] };
  }
  const spots = pack.spots || [];`,
      `async function processCity(cityId, { dry, skipUpload, force, allSpots }) {
  const pack = loadPack(cityId);
  if (!pack) {
    console.warn(\`[osm-foot] skip missing \${cityId}\`);
    return { cityId, saved: false, rows: [] };
  }
  const paintStats = stampMapPaintOnPack(pack);
  console.log(
    \`[osm-foot] map_paint story_fill=\${paintStats.storyFill} building_focus=\${paintStats.buildingFocus} icon_only=\${paintStats.iconOnly} cleared=\${paintStats.polysCleared}\`,
  );
  const spots = pack.spots || [];`,
    );
  }
  return s;
});

patch('scripts/cityPack/mapPerfectGate.mjs', (s) => {
  if (!s.includes("from './mapPaintPolicy.mjs'")) {
    s = s.replace(
      "import { arg, hasFlag, loadPack } from './lib.mjs';",
      "import { arg, hasFlag, loadPack } from './lib.mjs';\nimport { needsBuildingFootprint, resolveMapPaint, stampMapPaintOnPack } from './mapPaintPolicy.mjs';",
    );
  }
  if (!s.includes('stampMapPaintOnPack(pack)')) {
    s = s.replace(
      '  const pack = loadPack(cityId);\n  if (!pack) throw new Error(`pack missing: ${cityId}`);\n  const spots = (pack.spots || []).filter(',
      '  const pack = loadPack(cityId);\n  if (!pack) throw new Error(`pack missing: ${cityId}`);\n  stampMapPaintOnPack(pack);\n  const spots = (pack.spots || []).filter(',
    );
  }
  if (!s.includes("reason: 'icon_only'")) {
    s = s.replace(
      "function footprintOk(spot) {\n  if (isMapPoint(spot)) return { ok: true, reason: 'map_point' };",
      "function footprintOk(spot) {\n  if (isMapPoint(spot) || resolveMapPaint(spot) === 'icon_only') {\n    return { ok: true, reason: 'icon_only' };\n  }\n  if (!needsBuildingFootprint(spot)) return { ok: true, reason: 'no_building' };",
    );
  }
  return s;
});

patch('scripts/cityPack/mapPerfectCity.mjs', (s) => {
  if (!s.includes('stampMapPaint.mjs')) {
    s = s.replace(
      "  run('polishMapBullets.mjs', ['--city', cityId], { fatal: false });\n  run('forceFillMapBullets.mjs', ['--city', cityId], { fatal: false });",
      "  run('stampMapPaint.mjs', ['--city', cityId, '--no-upload'], { fatal: true });\n  run('polishMapBullets.mjs', ['--city', cityId], { fatal: false });\n  run('forceFillMapBullets.mjs', ['--city', cityId], { fatal: false });",
    );
  }
  return s;
});

patch('scripts/cityPack/gpsWegweiserLoop.mjs', (s) => {
  if (!s.includes('stampMapPaint.mjs')) {
    s = s.replace(
      "  console.log(`\\n[gps-wegweiser] ▶ ${cityId}`);\n  runStep(",
      "  console.log(`\\n[gps-wegweiser] ▶ ${cityId}`);\n  runStep(\n    'stampMapPaint.mjs',\n    ['--city', cityId, '--no-upload'],\n    { fatal: false },\n  );\n  runStep(",
    );
  }
  return s;
});

console.log('wire done');
