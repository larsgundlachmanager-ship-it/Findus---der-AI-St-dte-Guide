import fs from 'node:fs';
import path from 'node:path';

const src = path.resolve('src/services/navigation/mapIdleStoryFill.smoke.test.ts');
const tmp = path.resolve('.cursor/_idle_fill_smoke_patched.ts');
let s = fs.readFileSync(src, 'utf8');
const nl = s.includes('\r\n') ? '\r\n' : '\n';
if (!s.includes('map_story_fill')) {
  s += `${nl}{${nl}  const packStory = {${nl}    name: 'Irgendwas',${nl}    category: 'cafe',${nl}    tags_json: JSON.stringify(['map_story_fill', 'directory']),${nl}  };${nl}  assert(isMapIdleStoryFillPoi(packStory), 'Pack map_story_fill schlägt Heuristik');${nl}  const packIcon = {${nl}    name: 'Badehaus',${nl}    category: 'freizeit',${nl}    tags_json: JSON.stringify(['map_icon_only', 'story', 'module1']),${nl}  };${nl}  assert(!isMapIdleStoryFillPoi(packIcon), 'Pack map_icon_only blockt Fill');${nl}  assert(isMapOpenAreaNoFillPoi(packIcon), 'map_icon_only = no fill');${nl}  const packBldg = {${nl}    name: 'Shop',${nl}    category: 'ort',${nl}    tags_json: JSON.stringify(['map_building_focus']),${nl}  };${nl}  assert(isMapEverydayBuildingFocusPoi(packBldg), 'map_building_focus Fokus');${nl}  assert(!isMapIdleStoryFillPoi(packBldg), 'building_focus kein Idle-Fill');${nl}}${nl}`;
  fs.writeFileSync(tmp, s);
  fs.renameSync(tmp, src);
  console.log('smoke extended');
} else console.log('already');
