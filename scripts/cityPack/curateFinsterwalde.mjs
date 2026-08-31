#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { STAEDTE_DIR } from './lib.mjs';

const packPath = path.join(STAEDTE_DIR, 'finsterwalde.json');
const p = JSON.parse(fs.readFileSync(packPath, 'utf8'));

const KEEP = new Map([
  ['finsterwalde_sanger_und_kaufmannsmuseum_finsterwalde', { tier: 1, cat: 'museum' }],
  ['finsterwalde_schloss_finsterwalde', { tier: 1, cat: 'denkmal' }],
  ['finsterwalde_stadtpfarrkirche_st_trinitatis', { tier: 1, cat: 'kirche' }],
  ['finsterwalde_rathaus', { tier: 1, cat: 'verwaltung' }],
  ['finsterwalde_marktplatz_finsterwalde', { tier: 1, cat: 'altstadt' }],
  ['finsterwalde_tierpark_finsterwalde', { tier: 1, cat: 'freizeit' }],
  ['finsterwalde_finsterwalde', { tier: 2, cat: 'bahnhof' }],
  ['finsterwalde_feuerwehrmuseum_finsterwalde', { tier: 2, cat: 'museum' }],
  ['finsterwalde_kulturweberei_finsterwalde', { tier: 2, cat: 'theater' }],
  ['finsterwalde_sangerdenkmal', { tier: 2, cat: 'denkmal' }],
  ['finsterwalde_glaserne_sanger', { tier: 2, cat: 'denkmal' }],
  ['finsterwalde_schloss_park_finsterwalde', { tier: 2, cat: 'natur' }],
  ['finsterwalde_burgerheide', { tier: 2, cat: 'natur' }],
  ['finsterwalde_stadtpark', { tier: 2, cat: 'natur' }],
  ['finsterwalde_wasserturm', { tier: 2, cat: 'aussicht' }],
  ['finsterwalde_katharinenkirche', { tier: 2, cat: 'kirche' }],
  ['finsterwalde_kath_pfarramt_st_maria_mater_dolorosa', { tier: 2, cat: 'kirche' }],
  ['finsterwalde_marchenhaus_finsterwalde', { tier: 2, cat: 'altstadt' }],
  ['finsterwalde_weltspiegel_kino', { tier: 2, cat: 'theater' }],
  ['finsterwalde_flugplatz_finsterwalde_heinrichsruh', { tier: 2, cat: 'tour' }],
  ['finsterwalde_ehrenmal_finsterwalde', { tier: 2, cat: 'denkmal' }],
  [
    'finsterwalde_freibad_schwimmstadion_der_freundschaft_finsterwalde',
    { tier: 2, cat: 'freizeit' },
  ],
  ['finsterwalde_ascheberg_finsterwalde', { tier: 2, cat: 'natur' }],
]);

let demoted = 0;
for (const s of p.spots) {
  if (s.pack_role !== 'story') continue;
  const keepMeta = KEEP.get(s.id);
  if (keepMeta) {
    s.pack_role = 'story';
    s.place_tier = keepMeta.tier;
    s.category = keepMeta.cat;
    s.tags = [...new Set([...(s.tags || []), 'story', 'curated_keep'])];
  } else {
    s.pack_role = 'directory';
    s.place_tier = Math.max(3, Number(s.place_tier) || 3);
    s.tags = [
      ...new Set([
        ...(s.tags || []).filter(
          (t) => !['story', 'must_have', 'module1', 'tier1', 'tier2'].includes(t),
        ),
        'directory',
        'demoted_noise',
      ]),
    ];
    demoted += 1;
  }
}

const BAD_WIKI =
  /Oppenheim|Stadion des Friedens \(Leipzig\)|Mäc-Geiz|Bund Evangelisch-Freikirchlicher Gemeinden/i;
let stripped = 0;
for (const t of p.trigger_points || []) {
  if (!Array.isArray(t.deep_data_pool)) continue;
  const before = t.deep_data_pool.length;
  t.deep_data_pool = t.deep_data_pool.filter((d) => !BAD_WIKI.test(String(d.text || d || '')));
  if (BAD_WIKI.test(t.general_info || '')) t.general_info = '';
  if (t.deep_data_pool.length !== before) stripped += 1;
}

p.data_version = (p.data_version || 0) + 1;
fs.writeFileSync(packPath, JSON.stringify(p, null, 2));
const stories = p.spots.filter((s) => s.pack_role === 'story');
console.log(
  JSON.stringify(
    {
      v: p.data_version,
      kept: stories.length,
      demoted,
      stripped,
      names: stories.map((s) => `${s.place_tier} ${s.name}`),
    },
    null,
    2,
  ),
);
