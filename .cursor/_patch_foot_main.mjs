import fs from 'node:fs';
const p = 'scripts/cityPack/snapOsmStoryFootprints.mjs';
let s = fs.readFileSync(p, 'utf8');
if (!s.includes("const allSpots = hasFlag('all-spots')")) {
  s = s.replace(
    "const force = hasFlag('force');\n  let cities = [];",
    "const force = hasFlag('force');\n  const allSpots = hasFlag('all-spots');\n  let cities = [];",
  );
  fs.writeFileSync(p, s);
}
console.log('has allSpots decl', s.includes("const allSpots = hasFlag('all-spots')"));
