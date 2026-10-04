import fs from 'node:fs';
import path from 'node:path';

const src = path.resolve('scripts/cityPack/snapOsmStoryFootprints.mjs');
const tmp = path.resolve('.cursor/_snapOsm_patched.mjs');
let s = fs.readFileSync(src, 'utf8');
const nl = s.includes('\r\n') ? '\r\n' : '\n';

if (!s.includes("from './mapPaintPolicy.mjs'")) {
  s = s.replace(
    `} from './lib.mjs';${nl}import { fetchJson, sleep, fetchNominatimPolygon } from '../geo/osm.mjs';`,
    `} from './lib.mjs';${nl}import { isIconOnlyPaint, needsBuildingFootprint, stampMapPaintOnPack } from './mapPaintPolicy.mjs';${nl}import { fetchJson, sleep, fetchNominatimPolygon } from '../geo/osm.mjs';`,
  );
}

if (!s.includes('isIconOnlyPaint(spot)')) {
  s = s.replace(
    `function needsSnap(spot, pack, { force = false, allSpots = false } = {}) {${nl}  if (isMapPointAmenity(spot)) return false;${nl}  const blob = \`\${spot.id || ''} \${spot.name || ''}\`;`,
    `function needsSnap(spot, pack, { force = false, allSpots = false } = {}) {${nl}  if (isMapPointAmenity(spot) || isIconOnlyPaint(spot)) return false;${nl}  if (!needsBuildingFootprint(spot)) return false;${nl}  const blob = \`\${spot.id || ''} \${spot.name || ''}\`;`,
  );
}

if (!s.includes('stampMapPaintOnPack(pack)')) {
  s = s.replace(
    `  if (!pack) {${nl}    console.warn(\`[osm-foot] skip missing \${cityId}\`);${nl}    return { cityId, saved: false, rows: [] };${nl}  }${nl}  const spots = pack.spots || [];`,
    `  if (!pack) {${nl}    console.warn(\`[osm-foot] skip missing \${cityId}\`);${nl}    return { cityId, saved: false, rows: [] };${nl}  }${nl}  const paintStats = stampMapPaintOnPack(pack);${nl}  console.log(${nl}    \`[osm-foot] map_paint story_fill=\${paintStats.storyFill} building_focus=\${paintStats.buildingFocus} icon_only=\${paintStats.iconOnly} cleared=\${paintStats.polysCleared}\`,${nl}  );${nl}  const spots = pack.spots || [];`,
  );
}

fs.writeFileSync(tmp, s);
fs.renameSync(tmp, src);
console.log(
  'ok',
  s.includes('mapPaintPolicy'),
  s.includes('isIconOnlyPaint'),
  s.includes('stampMapPaintOnPack(pack)'),
);
