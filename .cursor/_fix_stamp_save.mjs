import fs from 'node:fs';
import path from 'node:path';

const src = path.resolve('scripts/cityPack/stampMapPaint.mjs');
const tmp = path.resolve('.cursor/_stampMapPaint_fixed.mjs');
let s = fs.readFileSync(src, 'utf8');
const nl = s.includes('\r\n') ? '\r\n' : '\n';
s = s.replace('savePack(cityId, pack);', 'savePack(pack, { bumpVersion: true });');
fs.writeFileSync(tmp, s);
fs.renameSync(tmp, src);
console.log('fixed savePack');
