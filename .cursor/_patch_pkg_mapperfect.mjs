import fs from 'node:fs';
const p = 'package.json';
const j = JSON.parse(fs.readFileSync(p, 'utf8'));
const s = j.scripts;
const order = Object.keys(s);
const idx = order.indexOf('city:osm-footprints');
if (!s['city:map-perfect']) {
  const next = {};
  for (const k of order) {
    next[k] = s[k];
    if (k === 'city:osm-footprints') {
      next['city:basemap-gap'] = 'node scripts/cityPack/basemapGap.mjs';
      next['city:popup-bullets'] = 'node scripts/cityPack/polishMapBullets.mjs';
      next['city:map-perfect'] = 'node scripts/cityPack/mapPerfectCity.mjs';
      next['city:map-perfect-gate'] = 'node scripts/cityPack/mapPerfectGate.mjs';
    }
  }
  j.scripts = next;
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
  console.log('package.json scripts added');
} else {
  console.log('already present');
}
