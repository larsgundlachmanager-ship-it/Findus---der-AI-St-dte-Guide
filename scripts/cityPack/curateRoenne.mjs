#!/usr/bin/env node
/** Rønne: keep harbor/museum/church icons, demote bus/fuel/noise → directory. */
import fs from 'node:fs';
import path from 'node:path';
import { STAEDTE_DIR } from './lib.mjs';

const packPath = path.join(STAEDTE_DIR, 'roenne.json');
const p = JSON.parse(fs.readFileSync(packPath, 'utf8'));

const KEEP = [
  { re: /nikolai|nicolai|sankt\s*nicolai|st\.?\s*nicolas/i, tier: 1, cat: 'kirche' },
  { re: /hafen\s*r[øo]nne|r[øo]nne\s*havn|bornholmslinjen|bornholmerf[æa]rgen|f[æa]rge/i, tier: 1, cat: 'hafen' },
  { re: /bornholms?\s*museum/i, tier: 1, cat: 'museum' },
  { re: /hjorth|hjort.?s?\s*(fabrik|stent|keramik)/i, tier: 1, cat: 'museum' },
  { re: /erichsen.?s?\s*g[åa]rd|erichsen/i, tier: 2, cat: 'museum' },
  { re: /forsvar|defence|verteidigung|kastel/i, tier: 2, cat: 'museum' },
  { re: /bagfyr|lighthouse|leuchtturm|ronne\s*lighthouse|r[øo]nne\s*fyr/i, tier: 1, cat: 'aussicht' },
  { re: /store\s*torv|lille\s*torv|laksegade/i, tier: 2, cat: 'altstadt' },
  { re: /havnesmedje|harbour\s*smithy|smithy/i, tier: 2, cat: 'denkmal' },
  { re: /n[øo]rrekaas|strand|beach/i, tier: 2, cat: 'strand' },
  { re: /[øo]sters[øo]br[øo]nden|anden|skulptur/i, tier: 3, cat: 'denkmal' },
  { re: /st\.?\s*knud|knuds\s*kirche/i, tier: 2, cat: 'kirche' },
  { re: /rundkirke|rundkirche/i, tier: 2, cat: 'kirche' },
  { re: /r[åa]dhus|rådhus|town\s*hall/i, tier: 2, cat: 'denkmal' },
  { re: /sv[øo]mmehal|schwimm|badeland/i, tier: 3, cat: 'freizeit' },
  { re: /galleri|galerie|kunst/i, tier: 3, cat: 'museum' },
];

const FORCE_DIR =
  /hotel|hostel|pension|airbnb|parking|parkplatz|garage|mcdonald|starbucks|lidl|aldi|netto|f[øo]tex|kvickly|circle\s*k|shell\b|charging|ladestation|norlys|e\.?on|bowling|brandv[æa]sen|idr[æa]tshal|ovf\.|v\.\s*nr|centrum\s*v\.|almindingsvej|[åa]kirkebyvej|borgmester|rescue\s*station|baptist|metodist|missionskirke|pinsekirke|mormon|sidste\s*dages|chin\s*church|wein.?hof|provsti|cemetery|kirkeg[åa]rd|schule|school|apotek|klinik|hospital|fitness|gym|tattoo|waschsalon|supermarket|tankstelle|bus\s*stop|halte/i;

const seen = new Set();
let kept = 0;
let demoted = 0;

for (const s of p.spots) {
  if (s.pack_role === 'directory') continue;
  const name = String(s.name || '');
  if (FORCE_DIR.test(name) || /^bahnhof$/i.test(s.category || '') && !/havn|f[æa]rge|bornholm/i.test(name)) {
    // keep real harbor ferry names even if category bahnhof
  }
  if (FORCE_DIR.test(name)) {
    s.pack_role = 'directory';
    s.place_tier = 4;
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
    continue;
  }

  let hit = null;
  for (const rule of KEEP) {
    if (rule.re.test(name)) {
      hit = rule;
      break;
    }
  }
  const key = hit
    ? `${hit.cat}:${name
        .toLowerCase()
        .replace(/[^a-z0-9äöüßøåæ]+/gi, '')
        .slice(0, 28)}`
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
        hit.tier === 1 ? 'must_have' : 'tourist',
        `tier${hit.tier}`,
      ]),
    ];
    kept += 1;
  } else {
    s.pack_role = 'directory';
    s.place_tier = 4;
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

p._pack_index = {
  ...(p._pack_index || {}),
  total: p.spots.length,
  story: p.spots.filter((s) => s.pack_role !== 'directory').length,
  directory: p.spots.filter((s) => s.pack_role === 'directory').length,
};
p.data_version = (Number(p.data_version) || 0) + 1;
fs.writeFileSync(packPath, JSON.stringify(p, null, 2), 'utf8');
console.log(
  `[curate] roenne kept=${kept} demoted=${demoted} story=${p._pack_index.story} dir=${p._pack_index.directory} v${p.data_version}`,
);
for (const s of p.spots.filter((x) => x.pack_role !== 'directory')) {
  console.log(`  T${s.place_tier} ${s.category} ${s.name}`);
}
