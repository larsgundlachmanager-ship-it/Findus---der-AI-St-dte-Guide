import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ui = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'ui-btn.xml'),
  'utf8',
);

function centers(labelRe) {
  const out = [];
  const re = new RegExp(
    `(?:text|content-desc)="(${labelRe.source})[^"]*"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`,
    'gi',
  );
  let m;
  while ((m = re.exec(ui))) {
    out.push({
      label: m[1],
      x: Math.round((+m[2] + +m[4]) / 2),
      y: Math.round((+m[3] + +m[5]) / 2),
    });
  }
  return out;
}

for (const pat of [
  /Timeline/i,
  /Orte/i,
  /Einst/i,
  /Schließen/i,
  /Planung/i,
  /Kalibrier/i,
  /Navigation/i,
  /Route/i,
  /Kompass/i,
  /Zentrier/i,
  /Standort/i,
  /Settings/i,
  /calendar/i,
]) {
  const hits = centers(pat);
  for (const h of hits) console.log(h.x, h.y, h.label);
}

// all clickable with short text
for (const m of ui.matchAll(
  /clickable="true"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"[^>]*(?:text|content-desc)="([^"]{2,40})"/g,
)) {
  console.log(
    'click',
    Math.round((+m[1] + +m[3]) / 2),
    Math.round((+m[2] + +m[4]) / 2),
    m[5],
  );
}
