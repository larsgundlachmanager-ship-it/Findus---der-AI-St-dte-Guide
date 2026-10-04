import fs from 'node:fs';
import path from 'node:path';

function patch(rel, apply) {
  const src = path.resolve(rel);
  const tmp = path.resolve('.cursor/_patch_tmp_' + path.basename(rel));
  let s = fs.readFileSync(src, 'utf8');
  const nl = s.includes('\r\n') ? '\r\n' : '\n';
  const next = apply(s, nl);
  if (next === s) {
    console.log('no change', rel);
    return;
  }
  fs.writeFileSync(tmp, next);
  fs.renameSync(tmp, src);
  console.log('patched', rel);
}

patch('src/services/navigation/mapIdleStoryFill.ts', (s, nl) => {
  if (s.includes('map_story_fill')) return s;
  // Insert pack-tag short-circuit at start of isMapIdleStoryFillPoi
  s = s.replace(
    `export function isMapIdleStoryFillPoi(poi: IdleFillPoiLike): boolean {${nl}  const tags = parseTags(poi.tags_json);${nl}  const blob = poiBlob(poi);${nl}  if (OPEN_AREA_NO_FILL_RE.test(blob)) return false;${nl}  if (NO_IDLE_FILL_BLOB_RE.test(blob)) return false;`,
    `export function isMapIdleStoryFillPoi(poi: IdleFillPoiLike): boolean {${nl}  const tags = parseTags(poi.tags_json);${nl}  // Pack-SSOT (Datensatz-Erstellung): map_paint Tags schlagen Heuristik.${nl}  if (tags.includes('map_icon_only')) return false;${nl}  if (tags.includes('map_building_focus')) return false;${nl}  if (tags.includes('map_story_fill')) return true;${nl}  const blob = poiBlob(poi);${nl}  if (OPEN_AREA_NO_FILL_RE.test(blob)) return false;${nl}  if (NO_IDLE_FILL_BLOB_RE.test(blob)) return false;`,
  );
  s = s.replace(
    `export function isMapOpenAreaNoFillPoi(poi: IdleFillPoiLike): boolean {${nl}  return OPEN_AREA_NO_FILL_RE.test(poiBlob(poi));${nl}}`,
    `export function isMapOpenAreaNoFillPoi(poi: IdleFillPoiLike): boolean {${nl}  const tags = parseTags(poi.tags_json);${nl}  if (tags.includes('map_icon_only')) return true;${nl}  if (tags.includes('map_story_fill') || tags.includes('map_building_focus')) {${nl}    return OPEN_AREA_NO_FILL_RE.test(poiBlob(poi));${nl}  }${nl}  return OPEN_AREA_NO_FILL_RE.test(poiBlob(poi));${nl}}`,
  );
  s = s.replace(
    `export function isMapEverydayBuildingFocusPoi(poi: IdleFillPoiLike): boolean {${nl}  if (isMapOpenAreaNoFillPoi(poi)) return false;${nl}  if (isMapIdleStoryFillPoi(poi)) return false;${nl}  const tags = parseTags(poi.tags_json);`,
    `export function isMapEverydayBuildingFocusPoi(poi: IdleFillPoiLike): boolean {${nl}  const tags0 = parseTags(poi.tags_json);${nl}  if (tags0.includes('map_building_focus')) return true;${nl}  if (tags0.includes('map_icon_only') || tags0.includes('map_story_fill')) return false;${nl}  if (isMapOpenAreaNoFillPoi(poi)) return false;${nl}  if (isMapIdleStoryFillPoi(poi)) return false;${nl}  const tags = tags0;`,
  );
  return s;
});

patch('src/services/cityPack.ts', (s, nl) => {
  if (s.includes('map_paint')) return s;
  // Add map_paint to CitySpot type if present
  if (s.includes('place_tier?: number;') && !s.includes('map_paint?:')) {
    s = s.replace(
      'place_tier?: number;',
      "place_tier?: number;\n  /** Karten-Malerei: story_fill | building_focus | icon_only */\n  map_paint?: 'story_fill' | 'building_focus' | 'icon_only' | string;",
    );
  }
  if (!s.includes('map_story_fill')) {
    s = s.replace(
      `  if (spot.place_tier != null) tags.add(\`tier\${spot.place_tier}\`);${nl}  const isStory =`,
      `  if (spot.place_tier != null) tags.add(\`tier\${spot.place_tier}\`);${nl}  const paint = String(spot.map_paint || '').toLowerCase().trim();${nl}  if (paint === 'story_fill') tags.add('map_story_fill');${nl}  else if (paint === 'building_focus') tags.add('map_building_focus');${nl}  else if (paint === 'icon_only') tags.add('map_icon_only');${nl}  const isStory =`,
    );
  }
  return s;
});

console.log('app patch done');
