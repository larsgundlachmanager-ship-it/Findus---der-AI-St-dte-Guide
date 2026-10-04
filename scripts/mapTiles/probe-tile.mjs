import { readFileSync } from 'node:fs';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';

function parseEnv(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 1) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

const key = parseEnv(readFileSync('.env', 'utf8')).EXPO_PUBLIC_PROTOMAPS_API_KEY;
if (!key) throw new Error('no EXPO_PUBLIC_PROTOMAPS_API_KEY');

const z = 14;
const x = 8723;
const y = 5432;
const url = `https://api.protomaps.com/tiles/v4/${z}/${x}/${y}.mvt?key=${encodeURIComponent(key)}`;
const res = await fetch(url);
console.log('status', res.status, res.headers.get('content-type'));
const buf = Buffer.from(await res.arrayBuffer());
const tile = new VectorTile(new Pbf(buf));
console.log('layers', Object.keys(tile.layers));

for (const name of ['roads', 'boundaries']) {
  const layer = tile.layers[name];
  if (!layer) {
    console.log(name, 'MISSING');
    continue;
  }
  console.log(name, 'features', layer.length);
  for (let i = 0; i < Math.min(layer.length, 4); i++) {
    console.log(' ', layer.feature(i).properties);
  }
}
