#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (!m) continue;
  let v = m[2].trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  )
    v = v.slice(1, -1);
  if (!process.env[m[1]]) process.env[m[1]] = v;
}
const KEY = process.env.GOOGLE_MAPS_API_KEY;

async function places(q, loc) {
  const u = new URL('https://maps.googleapis.com/maps/api/place/textsearch/json');
  u.searchParams.set('query', q);
  u.searchParams.set('key', KEY);
  u.searchParams.set('language', 'de');
  if (loc) {
    u.searchParams.set('location', loc);
    u.searchParams.set('radius', '4000');
  }
  const r = await fetch(u);
  return r.json();
}

const qs = [
  ['Fähranleger Wangerooge Insel', '53.79,7.90'],
  ['Anleger Wangerooge Ost', '53.79,7.90'],
  ['Wangerooge Hafen', '53.783,7.94'],
  ['Alte Fähranleger Wangerooge', '53.783,7.94'],
  ['Weststrand Wangerooge', '53.785,7.86'],
  ['Strand Zum Westen Wangerooge', '53.785,7.86'],
];

for (const [q, loc] of qs) {
  const d = await places(q, loc);
  console.log(
    JSON.stringify({
      q,
      top: (d.results || []).slice(0, 3).map((r) => ({
        name: r.name,
        lat: r.geometry.location.lat,
        lng: r.geometry.location.lng,
        types: r.types.slice(0, 4),
        addr: r.formatted_address,
      })),
    }),
  );
}
