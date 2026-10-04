import fs from 'node:fs';
const p = 'scripts/cityPack/snapOsmStoryFootprints.mjs';
let s = fs.readFileSync(p, 'utf8');
if (s.includes("const allSpots = hasFlag('all-spots')")) {
  console.log('already ok');
  process.exit(0);
}
const needle = "const force = hasFlag('force');";
const idx = s.indexOf(needle);
if (idx < 0) {
  console.error('needle not found');
  process.exit(1);
}
// Only patch inside main() — second occurrence after processCity signature already has allSpots param
const mainIdx = s.indexOf('async function main');
const forceInMain = s.indexOf(needle, mainIdx);
if (forceInMain < 0) {
  console.error('force in main not found');
  process.exit(1);
}
s =
  s.slice(0, forceInMain + needle.length) +
  "\r\n  const allSpots = hasFlag('all-spots');" +
  s.slice(forceInMain + needle.length);
fs.writeFileSync(p, s);
console.log('patched main allSpots');
