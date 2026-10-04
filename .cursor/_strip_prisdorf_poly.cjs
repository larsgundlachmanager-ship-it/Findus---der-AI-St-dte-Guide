const fs = require('fs');
const path = require('path');
const src = path.join('data', 'staedte', 'prisdorf.json');
const tmp = path.join('data', 'staedte', 'prisdorf.json.tmp_strip');
const p = JSON.parse(fs.readFileSync(src, 'utf8'));
let n = 0;
for (const s of p.spots || []) {
  const blob = (
    (s.name || '') +
    ' ' +
    (s.category || '') +
    ' ' +
    ((s.tags || []).join(' '))
  ).toLowerCase();
  const open =
    /spielplatz|playground|gewerbegebiet|feldmark|zonenweg|straßenverzeichnis|strassenverzeichnis|dorfgeschichte/.test(
      blob,
    );
  const dir =
    s.pack_role === 'directory' || (s.tags || []).includes('directory');
  const everyday =
    dir &&
    /marktkauf|tankstelle|praxis|karosserie|supermarket|gesundheit|frischecenter/.test(
      blob,
    );
  if (!open && !everyday) continue;
  if (s.polygonCoordinates) {
    delete s.polygonCoordinates;
    n++;
  }
  if (s.polygon) {
    delete s.polygon;
    n++;
  }
  if (Array.isArray(s.tags)) {
    s.tags = s.tags.filter((t) => t !== 'map_outline');
  }
}
p.data_version = (Number(p.data_version) || 0) + 1;
p.updated_at = new Date().toISOString();
fs.writeFileSync(tmp, JSON.stringify(p, null, 2) + '\n');
try {
  fs.unlinkSync(src);
} catch (_) {}
fs.renameSync(tmp, src);
console.log({ strippedPoly: n, version: p.data_version });
