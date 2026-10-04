import fs from 'node:fs';
import path from 'node:path';

const src = path.resolve('src/components/homeMap/nativeHomeMap.smoke.test.ts');
const tmp = path.resolve('.cursor/_native_smoke_sticky.ts');
let s = fs.readFileSync(src, 'utf8');
const nl = s.includes('\r\n') ? '\r\n' : '\n';
if (!s.includes('sessionPaintedPlaceIdsRef')) {
  s = s.replace(
    "assert(host.includes('placeFillRingCacheRef'), 'Session-Fill-Cache gegen Pan-Reload');",
    "assert(host.includes('placeFillRingCacheRef'), 'Session-Fill-Cache gegen Pan-Reload');\nassert(host.includes('sessionPaintedPlaceIdsRef'), 'Session-Orte/Icons bleiben nach Pan');",
  );
  fs.writeFileSync(tmp, s);
  fs.renameSync(tmp, src);
  console.log('smoke ok');
} else console.log('already');
