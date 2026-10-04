#!/usr/bin/env node
/** Surgical polish for Rønne: fix Leipzig wiki leak, demote noise, seed research depth. */
import fs from 'node:fs';
import path from 'node:path';
import { STAEDTE_DIR } from './lib.mjs';

const packPath = path.join(STAEDTE_DIR, 'roenne.json');
const researchPath = path.join(STAEDTE_DIR, 'roenne.research.json');
const p = JSON.parse(fs.readFileSync(packPath, 'utf8'));
const research = JSON.parse(fs.readFileSync(researchPath, 'utf8'));

const DEMOTE =
  /ferienhaus|camping|haustiere|grill\s*\|/i;

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
  tp.general_info = r.general_info;
  tp.deep_data_pool = (r.deep_data_pool || []).map((text) =>
    typeof text === 'string' ? { text, tags: ['research', 'sourced'] } : text,
  );
  spot.pack_role = 'story';
  spot.place_tier = r.place_tier || spot.place_tier || 2;
  spot.category = r.category || spot.category;
  spot.tags = [
    ...new Set([
      ...(spot.tags || []).filter((t) => t !== 'directory' && t !== 'demoted_noise'),
      'story',
      r.must_have ? 'must_have' : 'tourist',
      `tier${spot.place_tier}`,
    ]),
  ];
}

// Demote holiday/camping noise
for (const s of p.spots) {
  if (DEMOTE.test(s.name || '')) {
    s.pack_role = 'directory';
    s.place_tier = 4;
    s.category = /camping/i.test(s.name) ? 'camping' : 'directory';
    s.tags = [...new Set([...(s.tags || []), 'directory', 'demoted_noise'])];
  }
}

// Collapse duplicate harbor stories → keep best named one as T1
const harborStories = p.spots.filter(
  (s) =>
    s.pack_role !== 'directory' &&
    (/havn|hafen|bornholmslinjen|bornholmerf/i.test(s.name) || s.category === 'hafen'),
);
harborStories.sort((a, b) => {
  const score = (x) =>
    (/^r[øo]nne\s*havn$/i.test(x.name) ? 10 : 0) +
    (/hafen\s*r[øo]nne/i.test(x.name) ? 8 : 0) +
    (/bornholmslinjen/i.test(x.name) ? 6 : 0) +
    (String(x.name).length < 40 ? 2 : 0);
  return score(b) - score(a);
});
const keepHarbor = harborStories[0];
for (const s of harborStories.slice(1)) {
  // Keep lighthouse / fyr as aussicht
  if (/fyr|lighthouse|bagfyr/i.test(s.name)) {
    s.category = 'aussicht';
    s.place_tier = 1;
    continue;
  }
  s.pack_role = 'directory';
  s.place_tier = 4;
  s.tags = [...new Set([...(s.tags || []), 'directory', 'harbor_dup'])];
}
if (keepHarbor) {
  keepHarbor.name = 'Rønne Havn';
  keepHarbor.category = 'hafen';
  keepHarbor.place_tier = 1;
}

// Match research spots onto pack
function findSpot(r) {
  const names = [r.name, ...(r.aliases || [])].map((n) =>
    String(n).toLowerCase(),
  );
  for (const s of p.spots) {
    const n = String(s.name || '').toLowerCase();
    if (names.some((x) => n.includes(x.slice(0, 12)) || x.includes(n.slice(0, 12)))) {
      return s;
    }
  }
  return null;
}

for (const r of research.spots || []) {
  let s = findSpot(r);
  if (!s) {
    // create stub near center if missing
    s = {
      id: `roenne_${String(r.name)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .slice(0, 40)}`,
      name: r.name,
      lat: p.lat,
      lng: p.lng,
      category: r.category,
      pack_role: 'story',
      place_tier: r.place_tier || 2,
      tags: ['story', 'research_seed'],
    };
    // avoid id clash
    let id = s.id;
    let n = 2;
    while (p.spots.some((x) => x.id === id)) id = `${s.id}_${n++}`;
    s.id = id;
    p.spots.push(s);
  }
  applyResearch(s, r);
}

// Explicit fix Nikolaikirche — wipe Leipzig wiki
const nik = p.spots.find((s) => /nikolai|nicolai/i.test(s.name));
const nikR = research.spots.find((r) => /nicolai/i.test(r.name));
if (nik && nikR) {
  nik.name = 'Sankt Nicolai Kirke';
  applyResearch(nik, nikR);
}

p._pack_index = {
  ...(p._pack_index || {}),
  total: p.spots.length,
  story: p.spots.filter((s) => s.pack_role !== 'directory').length,
  directory: p.spots.filter((s) => s.pack_role === 'directory').length,
};
p.data_version = (Number(p.data_version) || 0) + 1;
p.country = 'DK';
p.region = 'Bornholm';
fs.writeFileSync(packPath, JSON.stringify(p, null, 2), 'utf8');
console.log(
  `[polish] roenne story=${p._pack_index.story} dir=${p._pack_index.directory} v${p.data_version}`,
);
for (const s of p.spots.filter((x) => x.pack_role !== 'directory')) {
  const tp = (p.trigger_points || []).find((t) => t.id === s.id);
  console.log(
    `  T${s.place_tier} ${s.category} ${s.name} gi=${(tp?.general_info || '').length} deep=${(tp?.deep_data_pool || []).length}`,
  );
}
