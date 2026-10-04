import fs from 'node:fs';
import path from 'node:path';

const src = path.resolve('package.json');
const tmp = path.resolve('.cursor/_package_patched.json');
let s = fs.readFileSync(src, 'utf8');
if (!s.includes('city:map-paint')) {
  s = s.replace(
    '"city:osm-footprints":',
    '"city:map-paint": "node scripts/cityPack/stampMapPaint.mjs",\n    "city:osm-footprints":',
  );
  fs.writeFileSync(tmp, s);
  fs.renameSync(tmp, src);
  console.log('package.json +city:map-paint');
} else {
  console.log('already');
}
