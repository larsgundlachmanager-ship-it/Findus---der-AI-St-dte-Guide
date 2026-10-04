import fs from 'node:fs';
const p = 'scripts/cityPack/snapOsmStoryFootprints.mjs';
let s = fs.readFileSync(p, 'utf8');
s = s.replace(
  'async function processCity(cityId, { dry, skipUpload, force }) {',
  'async function processCity(cityId, { dry, skipUpload, force, allSpots }) {',
);
s = s.replace(
  'if (!needsSnap(spot, pack, { force })) continue;',
  'if (!needsSnap(spot, pack, { force, allSpots })) continue;',
);
s = s.replace(
  "Ziele${force ? ' (--force)' : ''}`",
  "Ziele${force ? ' (--force)' : ''}${allSpots ? ' (--all-spots)' : ''}`",
);
s = s.replace(
  "const force = hasFlag('force');\n  let cities = [];",
  "const force = hasFlag('force');\n  const allSpots = hasFlag('all-spots');\n  let cities = [];",
);
s = s.replace(
  '[--force]',
  '[--force] [--all-spots]',
);
s = s.replace(
  'const r = await processCity(id, { dry, skipUpload, force });',
  'const r = await processCity(id, { dry, skipUpload, force, allSpots });',
);
fs.writeFileSync(p, s);
console.log('ok', s.includes('allSpots'));
