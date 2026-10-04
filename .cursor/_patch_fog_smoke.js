const fs = require('fs');
const p = 'src/services/homeMap/mapIdleGate.smoke.test.ts';
let s = fs.readFileSync(p, 'utf8');
const old = `assert(fog.includes('fogShouldYield') || fog.includes('isVoiceLaneBusy'), 'Fog weicht Voice');`;
const neu = `${old}
assert(fog.includes('navFogActive'), 'Fog: Nav erkennt Live-Nav');
assert(fog.includes('if (navFogActive()) return'), 'Fog: Full-Merge während Nav aus');`;
if (!s.includes(old)) {
  console.error('smoke needle missing');
  process.exit(1);
}
if (!s.includes("Fog: Nav erkennt Live-Nav")) {
  s = s.replace(old, neu);
  fs.writeFileSync(p + '.new', s);
  fs.renameSync(p + '.new', p);
}
console.log('smoke ok');
