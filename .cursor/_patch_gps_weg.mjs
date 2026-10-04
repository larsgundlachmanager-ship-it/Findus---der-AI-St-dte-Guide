import fs from 'node:fs';
const p = 'scripts/cityPack/gpsWegweiserLoop.mjs';
let s = fs.readFileSync(p, 'utf8');
const old = `  runStep(
    'polishMapBullets.mjs',
    ['--city', cityId],
    { fatal: false },
  );
  runStep(
    'basemapGap.mjs',
    ['--city', cityId, '--apply', '--no-upload'],
    { fatal: false },
  );
  runStep(
    'snapOsmStoryFootprints.mjs',
    ['--city', cityId, '--no-upload', '--all-spots'],
    { fatal: false },
  );
  runStep(
    'mapPerfectGate.mjs',
    ['--city', cityId],
    { fatal: false },
  );`;
const neu = `  runStep(
    'polishMapBullets.mjs',
    ['--city', cityId],
    { fatal: false },
  );
  runStep(
    'forceFillMapBullets.mjs',
    ['--city', cityId],
    { fatal: false },
  );
  runStep(
    'mapPerfectGate.mjs',
    ['--city', cityId],
    { fatal: false },
  );`;
if (s.includes(old)) s = s.replace(old, neu);
else if (s.includes(old.replace(/\n/g, '\r\n'))) s = s.replace(old.replace(/\n/g, '\r\n'), neu.replace(/\n/g, '\r\n'));
else {
  console.error('block not found');
  process.exit(1);
}
try {
  fs.writeFileSync(p, s);
  console.log('gpsWegweiser patched');
} catch (e) {
  fs.writeFileSync('.cursor/_gpsWegweiserLoop_patched.mjs', s);
  console.log('wrote fallback copy', e.message);
}
