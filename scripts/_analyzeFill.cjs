const fs = require('node:fs');
const t = fs.readFileSync('C:/Users/larsf/Findus 2.0/scripts/generatePronunciationMap.mjs', 'utf8');
const words = (s) => [...new Set(s.split(/[\s,]+/).map((x) => x.trim().toLowerCase()).filter((x) => x.length > 1))];
const re = /const (fill\w+) = words\(`([\s\S]*?)`\);/g;
const fills = {};
let m;
while ((m = re.exec(t))) fills[m[1]] = words(m[2]);
for (const [k, v] of Object.entries(fills)) console.log(k, v.length);
const seen = new Map();
for (const [cat, list] of Object.entries(fills)) for (const w of list) {
  if (!seen.has(w)) seen.set(w, [cat]); else seen.get(w).push(cat);
}
const dups = [...seen.entries()].filter(([, c]) => c.length > 1);
console.log('overlap tokens', dups.length);
