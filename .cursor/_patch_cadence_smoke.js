const fs = require('fs');
const p = 'src/runtime/gpsCadence.smoke.test.ts';
let s = fs.readFileSync(p, 'utf8');
const next = `// Nav: Stillstand nicht 15 s; Fuß dichter; Rad nicht dauerhaft 0,5 s
assert(gpsIntervalMsWhileNavigating(0) === GPS_CADENCE.briskMs, 'nav still → 2 s');
assert(gpsIntervalMsWhileNavigating(1.1) === 1_000, 'nav walk ~4 km/h → 1 s');
assert(
  gpsIntervalMsWhileNavigating(2.78) === 1_000,
  'nav ~10 km/h walk → 1 s',
);
assert(
  gpsIntervalMsWhileNavigating(5.5, { preferBike: true }) === 1_000,
  'nav bike fast → 1 s floor (not 0.5)',
);
assert(
  gpsIntervalMsWhileNavigating(2.78, { preferBike: true }) === 1_000,
  'nav bike ~10 km/h → 1 s floor',
);
assert(
  gpsIntervalMsWhileNavigating(0, { preferBike: true }) === GPS_CADENCE.walkMs,
  'nav bike still/boarding → 4 s',
);

console.log('gpsCadence.smoke.test.ts OK');`;
const re =
  /\/\/ Nav: Stillstand nicht 15 s;[\s\S]*?console\.log\('gpsCadence\.smoke\.test\.ts OK'\);/;
if (!re.test(s)) {
  console.error('pattern not found');
  process.exit(1);
}
s = s.replace(re, next);
fs.writeFileSync(p, s);
console.log('ok');
