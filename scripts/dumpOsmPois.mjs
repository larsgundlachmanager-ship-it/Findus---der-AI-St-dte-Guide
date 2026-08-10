#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function overpass(q) {
  const endpoints = [
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass-api.de/api/interpreter',
  ];
  let last;
  for (const ep of endpoints) {
    try {
      const r = await fetch(ep, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(q)}`,
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      last = e;
      console.warn('overpass fail', ep, e.message);
      await sleep(800);
    }
  }
  throw last;
}

function el(e) {
  return {
    lat: e.lat ?? e.center?.lat,
    lng: e.lon ?? e.center?.lon,
    name: e.tags?.name,
    tags: e.tags,
  };
}

const prisdorfQ = `
[out:json][timeout:60];
(
  node(around:150,53.67685,9.76082)[name];
  way(around:150,53.67685,9.76082)[name];
  node(around:150,53.67685,9.76082)[railway];
  way(around:150,53.67685,9.76082)[railway=station];
  way(around:150,53.67685,9.76082)[public_transport=station];
  node(around:150,53.67685,9.76082)[amenity=shelter];
  way(around:150,53.67685,9.76082)[amenity=shelter];
  node(around:150,53.67685,9.76082)[historic];
  way(around:150,53.67685,9.76082)[historic];
  way(around:150,53.67685,9.76082)[building];
);
out center tags;
`;

const wangQ = `
[out:json][timeout:90];
(
  node(around:3000,53.7902,7.8995)[name][tourism];
  way(around:3000,53.7902,7.8995)[name][tourism];
  node(around:3000,53.7902,7.8995)[name][amenity];
  way(around:3000,53.7902,7.8995)[name][amenity];
  node(around:3000,53.7902,7.8995)[shop];
  way(around:3000,53.7902,7.8995)[shop];
  node(around:3000,53.7902,7.8995)[railway=station];
  way(around:3000,53.7902,7.8995)[railway=station];
  way(around:3000,53.7902,7.8995)[natural=beach];
  node(around:3000,53.7902,7.8995)[leisure=park];
  way(around:3000,53.7902,7.8995)[leisure=park];
);
out center tags;
`;

const p = await overpass(prisdorfQ);
const prisdorf = (p.elements || [])
  .map(el)
  .filter((x) => x.lat && x.tags)
  .map((x) => ({
    lat: x.lat,
    lng: x.lng,
    name: x.name,
    railway: x.tags.railway,
    amenity: x.tags.amenity,
    historic: x.tags.historic,
    building: x.tags.building,
    public_transport: x.tags.public_transport,
  }));

await sleep(1000);
const w = await overpass(wangQ);
const wangerooge = (w.elements || [])
  .map(el)
  .filter((x) => x.lat && (x.name || x.tags?.natural || x.tags?.railway))
  .map((x) => ({
    lat: +(+x.lat).toFixed(6),
    lng: +(+x.lng).toFixed(6),
    name: x.name || null,
    amenity: x.tags.amenity || null,
    tourism: x.tags.tourism || null,
    shop: x.tags.shop || null,
    natural: x.tags.natural || null,
    railway: x.tags.railway || null,
    cuisine: x.tags.cuisine || null,
  }));

const out = { prisdorf, wangerooge };
const dest = path.join(__dirname, '..', 'data', 'staedte', 'osm_poi_dump.json');
fs.writeFileSync(dest, JSON.stringify(out, null, 2));
console.log('prisdorf named:', prisdorf.filter((x) => x.name).slice(0, 30));
console.log('wangerooge count', wangerooge.length);
console.log(
  'wangerooge sample',
  wangerooge.filter((x) => x.name).slice(0, 40),
);
console.log('wrote', dest);
