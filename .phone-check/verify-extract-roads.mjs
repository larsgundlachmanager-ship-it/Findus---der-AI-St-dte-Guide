import fs from 'node:fs';

const raw = JSON.parse(fs.readFileSync('data/staedte/prisdorf.map.json', 'utf8'));
const lat = 53.6835;
const lng = 9.7985;
const radiusM = 10000;
const dLat = radiusM / 111_320;
const cos = Math.cos((lat * Math.PI) / 180);
const dLng = radiusM / (111_320 * Math.max(0.2, cos));
const south = lat - dLat;
const north = lat + dLat;
const west = lng - dLng;
const east = lng + dLng;

function hit(c) {
  if (!c?.length) return false;
  for (const p of c) {
    if (p[0] >= south && p[0] <= north && p[1] >= west && p[1] <= east) return true;
  }
  return false;
}

const inBox = raw.roads.filter((r) => hit(r.c));
const majors = inBox.filter((r) => (r.k ?? 1) === 0);
const streets = inBox.filter((r) => (r.k ?? 1) === 1);
const bldg = raw.buildings.filter((b) => b.some((p) => p[0] >= south && p[0] <= north && p[1] >= west && p[1] <= east));

console.log('total roads in pack', raw.roads.length);
console.log('roads in 10km clip', inBox.length, 'major', majors.length, 'street', streets.length);
console.log('buildings in clip', bldg.length);
console.log('sane?', !(bldg.length >= 80 && inBox.length < 12));
