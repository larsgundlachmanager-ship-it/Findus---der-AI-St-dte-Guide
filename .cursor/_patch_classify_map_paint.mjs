import fs from 'node:fs';
import path from 'node:path';

const src = path.resolve('scripts/cityPack/classifyPackCategories.mjs');
const tmp = path.resolve('.cursor/_classifyPackCategories.patched.mjs');
let s = fs.readFileSync(src, 'utf8');

if (!s.includes('mapPaintPolicy')) {
  s = s.replace(
    "from './placeCategoryPolicy.mjs';\nimport { runQualityGate } from './qualityGate.mjs';",
    "from './placeCategoryPolicy.mjs';\nimport { stampMapPaintOnPack } from './mapPaintPolicy.mjs';\nimport { runQualityGate } from './qualityGate.mjs';",
  );
}

if (!s.includes('stampMapPaintOnPack(pack)')) {
  s = s.replace(
    '  const recl = reclassifyExisting(pack);\n  refreshIndex(pack);',
    `  const recl = reclassifyExisting(pack);
  const paint = stampMapPaintOnPack(pack);
  console.log(
    \`[classify] map_paint story_fill=\${paint.storyFill} building_focus=\${paint.buildingFocus} icon_only=\${paint.iconOnly}\`,
  );
  refreshIndex(pack);`,
  );
}

fs.writeFileSync(tmp, s);
fs.renameSync(tmp, src);
console.log('patched', src);
