#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { STAEDTE_DIR } from './lib.mjs';

const packPath = path.join(STAEDTE_DIR, 'halle_saale.json');
const p = JSON.parse(fs.readFileSync(packPath, 'utf8'));

/** Explicit keep by name substring (case-insensitive). First match wins. */
const KEEP = [
  { re: /landesmuseum\s*f[üu]r\s*vorgeschichte/i, tier: 1, cat: 'museum' },
  { re: /kunstmuseum\s*moritzburg|moritzburg\s*halle/i, tier: 1, cat: 'museum' },
  { re: /h[äa]ndel[- ]?haus/i, tier: 1, cat: 'museum' },
  { re: /marktkirche|unser\s*lieben\s*frauen/i, tier: 1, cat: 'kirche' },
  { re: /roter\s*turm/i, tier: 1, cat: 'denkmal' },
  { re: /oberburg\s*giebichenstein|^burg\s*giebichenstein$/i, tier: 1, cat: 'denkmal' },
  { re: /franckesche\s*stiftungen|francke[- ]?stiftungen/i, tier: 1, cat: 'museum' },
  { re: /halloren\s*schokoladen/i, tier: 1, cat: 'museum' },
  { re: /zoologischer\s*garten|bergzoo/i, tier: 1, cat: 'freizeit' },
  { re: /^marktplatz|^markt\s*halle|hallmarkt/i, tier: 1, cat: 'altstadt' },
  { re: /^rathaus\b|rathaus\s*halle/i, tier: 1, cat: 'verwaltung' },
  { re: /neue\s*residenz/i, tier: 2, cat: 'denkmal' },
  { re: /dom\b.*halle|hallescher\s*dom|^dom\s*halle/i, tier: 2, cat: 'kirche' },
  { re: /^moritzkirche/i, tier: 2, cat: 'kirche' },
  { re: /^ulrichskirche|st\.?\s*ulrich/i, tier: 2, cat: 'kirche' },
  { re: /^pauluskirche/i, tier: 2, cat: 'kirche' },
  { re: /propsteikirche.*franziskus|st\.?\s*franziskus.*elisabeth/i, tier: 2, cat: 'kirche' },
  { re: /stadtgottesacker/i, tier: 2, cat: 'denkmal' },
  { re: /beatles\s*museum/i, tier: 2, cat: 'museum' },
  { re: /roter\s*ochse|gedenkst[äa]tte\s*roter/i, tier: 2, cat: 'museum' },
  { re: /christian[- ]wolff|stadtmuseum/i, tier: 2, cat: 'museum' },
  { re: /arch[äa]ologisches\s*museum/i, tier: 2, cat: 'museum' },
  { re: /technikzentrum\s*der\s*stadtwerke/i, tier: 2, cat: 'museum' },
  { re: /rechenwerk/i, tier: 2, cat: 'museum' },
  { re: /haustierkunde/i, tier: 2, cat: 'museum' },
  { re: /botanischer\s*garten/i, tier: 2, cat: 'natur' },
  { re: /^pei[ßss]nitz$|pei[ßss]nitzinsel|pei[ßss]nitzhaus/i, tier: 2, cat: 'natur' },
  { re: /d[öo]lauer\s*heide/i, tier: 2, cat: 'natur' },
  { re: /reichardts?\s*garten/i, tier: 2, cat: 'natur' },
  { re: /klausberge/i, tier: 2, cat: 'natur' },
  { re: /amtsgarten/i, tier: 2, cat: 'natur' },
  { re: /riveufer|saalepromenade/i, tier: 2, cat: 'natur' },
  { re: /giebichensteinbr[üu]cke/i, tier: 2, cat: 'denkmal' },
  { re: /h[äa]ndel[- ]denkmal|georg[- ]friedrich[- ]h[äa]ndel[- ]denkmal/i, tier: 2, cat: 'denkmal' },
  { re: /eselsbrunnen/i, tier: 2, cat: 'denkmal' },
  { re: /leipziger\s*turm/i, tier: 2, cat: 'aussicht' },
  { re: /wasserturm\s*s[üu]d/i, tier: 2, cat: 'aussicht' },
  { re: /neues\s*theater/i, tier: 2, cat: 'theater' },
  { re: /oper\s*halle|^oper$/i, tier: 2, cat: 'theater' },
  { re: /steintor\s*variet|steintorvariet/i, tier: 2, cat: 'theater' },
  { re: /freilichtb[üu]hne\s*pei[ßss]nitz/i, tier: 2, cat: 'theater' },
  { re: /^hauptbahnhof$|^halle\s*\(saale\)\s*hauptbahnhof$/i, tier: 2, cat: 'bahnhof' },
  { re: /park\s*an\s*der\s*saline|salinehalle|saline\s*halle/i, tier: 2, cat: 'natur' },
  { re: /^altstadt$/i, tier: 2, cat: 'altstadt' },
  { re: /hufeisensee/i, tier: 2, cat: 'natur' },
  { re: /passendorfer\s*schl/i, tier: 2, cat: 'denkmal' },
  { re: /db\s*museum\s*halle/i, tier: 2, cat: 'museum' },
  { re: /stra[ßs]enbahndepot/i, tier: 2, cat: 'museum' },
  { re: /goldsolebrunnen/i, tier: 2, cat: 'denkmal' },
  { re: /g[öo]belbrunnen/i, tier: 2, cat: 'denkmal' },
];

const seen = new Set();
let kept = 0;
let demoted = 0;

for (const s of p.spots) {
  // Reset previous curated flags; decide fresh for all former stories + curated
  const wasStoryish =
    s.pack_role === 'story' ||
    (s.tags || []).includes('curated_keep') ||
    (s.tags || []).includes('demoted_noise');

  if (!wasStoryish && s.pack_role === 'directory' && !(s.tags || []).includes('demoted_noise')) {
    continue;
  }

  let hit = null;
  for (const rule of KEEP) {
    if (rule.re.test(s.name || '')) {
      hit = rule;
      break;
    }
  }

  // Deduplicate near-identical keeps (e.g. multiple Hbf)
  const key = hit
    ? `${hit.cat}:${String(s.name)
        .toLowerCase()
        .replace(/[^a-z0-9äöüß]+/gi, '')
        .slice(0, 24)}`
    : null;

  if (hit && key && !seen.has(key)) {
    seen.add(key);
    s.pack_role = 'story';
    s.place_tier = hit.tier;
    s.category = hit.cat;
    s.tags = [
      ...new Set([
        ...(s.tags || []).filter((t) => t !== 'directory' && t !== 'demoted_noise'),
        'story',
        'curated_keep',
      ]),
    ];
    kept += 1;
  } else if (wasStoryish || s.pack_role === 'story') {
    s.pack_role = 'directory';
    s.place_tier = Math.max(3, Number(s.place_tier) || 3);
    s.tags = [
      ...new Set([
        ...(s.tags || []).filter(
          (t) => !['story', 'must_have', 'module1', 'tier1', 'tier2', 'curated_keep'].includes(t),
        ),
        'directory',
        'demoted_noise',
      ]),
    ];
    demoted += 1;
  }
}

const BAD = /Ludwigsburg|Oppenheim|Leipzig\)/i;
for (const t of p.trigger_points || []) {
  if (!Array.isArray(t.deep_data_pool)) continue;
  t.deep_data_pool = t.deep_data_pool.filter((d) => !BAD.test(String(d.text || d || '')));
  if (BAD.test(t.general_info || '')) t.general_info = '';
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
      names: stories
        .sort((a, b) => a.place_tier - b.place_tier || a.name.localeCompare(b.name))
        .map((s) => `${s.place_tier} ${s.name}`),
    },
    null,
    2,
  ),
);
