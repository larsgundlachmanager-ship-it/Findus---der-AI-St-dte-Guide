#!/usr/bin/env node
/** Add missing island landmarks + GPS + Denmark meta for Bornholm pack. */
import fs from 'node:fs';
import path from 'node:path';
import { STAEDTE_DIR, distM } from './lib.mjs';
import { resolvePlace, setPackCityCostLabel } from './google.mjs';

const packPath = path.join(STAEDTE_DIR, 'bornholm.json');
const research = JSON.parse(
  fs.readFileSync(path.join(STAEDTE_DIR, 'bornholm.research.json'), 'utf8'),
);
const p = JSON.parse(fs.readFileSync(packPath, 'utf8'));
setPackCityCostLabel('bornholm');

p.country = 'DK';
p.region = 'Bornholm';
p.name = 'Bornholm';

function ensureTp(spot) {
  if (!p.trigger_points) p.trigger_points = [];
  let tp = p.trigger_points.find((t) => t.id === spot.id);
  if (!tp) {
    tp = { id: spot.id, name: spot.name, lat: spot.lat, lng: spot.lng };
    p.trigger_points.push(tp);
  }
  return tp;
}

function applyResearch(spot, r) {
  const tp = ensureTp(spot);
  tp.name = spot.name;
  if (r.general_info) tp.general_info = r.general_info;
  if (r.deep_data_pool?.length) {
    tp.deep_data_pool = r.deep_data_pool.map((text) =>
      typeof text === 'string' ? { text, tags: ['research', 'sourced'] } : text,
    );
  }
  spot.pack_role = 'story';
  spot.place_tier = r.place_tier || spot.place_tier || 2;
  spot.category = r.category || spot.category;
  spot.tags = [
    ...new Set([
      ...(spot.tags || []).filter((t) => t !== 'directory' && t !== 'demoted_noise'),
      'story',
      r.must_have ? 'must_have' : 'tourist',
      `tier${spot.place_tier}`,
      'island',
    ]),
  ];
}

function findSpot(r) {
  const names = [r.name, ...(r.aliases || [])].map((n) => String(n).toLowerCase());
  for (const s of p.spots) {
    const n = String(s.name || '').toLowerCase();
    if (names.some((x) => n.includes(x.slice(0, 10)) || x.includes(n.slice(0, 10)))) {
      return s;
    }
  }
  return null;
}

const center = { lat: p.lat, lng: p.lng };

for (const r of research.spots || []) {
  let s = findSpot(r);
  if (!s) {
    let id = `bornholm_${String(r.name)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .slice(0, 40)}`;
    let n = 2;
    const base = id;
    while (p.spots.some((x) => x.id === id)) id = `${base}_${n++}`;
    s = {
      id,
      name: r.name,
      lat: center.lat,
      lng: center.lng,
      category: r.category,
      pack_role: 'story',
      place_tier: r.place_tier || 2,
      tags: ['story', 'research_seed', 'island'],
    };
    p.spots.push(s);
    console.log('[add]', s.name);
  }
  applyResearch(s, r);
}

// Geocode all stories missing coords or still on pack center
const stories = p.spots.filter((s) => s.pack_role !== 'directory');
for (const s of stories) {
  const onCenter =
    Number.isFinite(s.lat) &&
    Number.isFinite(s.lng) &&
    distM({ lat: s.lat, lng: s.lng }, center) < 80;
  const missing = !Number.isFinite(s.lat) || !Number.isFinite(s.lng);
  if (!missing && !onCenter) continue;
  const q = `${s.name} Bornholm Denmark`;
  try {
    const hit = await resolvePlace(q, center);
    if (hit?.lat != null) {
      s.lat = hit.lat;
      s.lng = hit.lng;
      const tp = ensureTp(s);
      tp.lat = hit.lat;
      tp.lng = hit.lng;
      console.log('[gps]', s.name, '→', hit.lat.toFixed(5), hit.lng.toFixed(5));
    } else {
      console.log('[gps miss]', s.name);
    }
  } catch (e) {
    console.log('[gps err]', s.name, e.message);
  }
}

// Demote generic "Geschichte von Bornholm" if present — not a place
for (const s of p.spots) {
  if (/geschichte\s*von\s*bornholm/i.test(s.name || '')) {
    s.pack_role = 'directory';
    s.place_tier = 4;
    s.tags = [...new Set([...(s.tags || []), 'directory', 'meta_not_place'])];
  }
}

p._pack_index = {
  ...(p._pack_index || {}),
  total: p.spots.length,
  story: p.spots.filter((s) => s.pack_role !== 'directory').length,
  directory: p.spots.filter((s) => s.pack_role === 'directory').length,
};
p.data_version = (Number(p.data_version) || 0) + 1;
fs.writeFileSync(packPath, JSON.stringify(p, null, 2), 'utf8');
console.log(
  `[polish] story=${p._pack_index.story} dir=${p._pack_index.directory} v${p.data_version}`,
);
