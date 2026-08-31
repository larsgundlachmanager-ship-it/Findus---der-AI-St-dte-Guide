#!/usr/bin/env node
/** Bremen: keep icons, demote noise. */
import fs from 'node:fs';
import path from 'node:path';
import { STAEDTE_DIR } from './lib.mjs';

const packPath = path.join(STAEDTE_DIR, 'bremen.json');
const p = JSON.parse(fs.readFileSync(packPath, 'utf8'));

const KEEP = [
  { re: /roland/i, tier: 1, cat: 'denkmal' },
  { re: /rathaus/i, tier: 1, cat: 'denkmal' },
  { re: /dom|st\.?\s*petri|petridom/i, tier: 1, cat: 'kirche' },
  { re: /b[öo]ttcherstra/i, tier: 1, cat: 'altstadt' },
  { re: /schnoor/i, tier: 1, cat: 'altstadt' },
  { re: /marktplatz|markt\s*bremen/i, tier: 1, cat: 'altstadt' },
  { re: /stadtmusikanten|musicians/i, tier: 1, cat: 'denkmal' },
  { re: /kunsthalle/i, tier: 1, cat: 'museum' },
  { re: /[üu]bersee.?museum|uebersee/i, tier: 1, cat: 'museum' },
  { re: /focke.?museum/i, tier: 1, cat: 'museum' },
  { re: /universum/i, tier: 1, cat: 'museum' },
  { re: /weserburg/i, tier: 2, cat: 'museum' },
  { re: /hauptbahnhof/i, tier: 1, cat: 'bahnhof' },
  { re: /schlachte/i, tier: 1, cat: 'hafen' },
  { re: /weser(?!burg)|weserpromenade/i, tier: 1, cat: 'natur' },
  { re: /b[üu]rgerpark/i, tier: 1, cat: 'natur' },
  { re: /rhododendron/i, tier: 2, cat: 'natur' },
  { re: /wallanlagen|wallpark/i, tier: 2, cat: 'natur' },
  { re: /theater|oper|konzerthaus|die\s*glocke/i, tier: 2, cat: 'theater' },
  { re: /st\.?\s*stephani|liebfrauen|unser\s*lieben/i, tier: 2, cat: 'kirche' },
  { re: /sch[üu]tting|stadtwaage|gewürz|gewuerz/i, tier: 2, cat: 'denkmal' },
  { re: /paulskirche|st\.?\s*pauli/i, tier: 2, cat: 'kirche' },
  { re: /werder|weserstadion|sv\s*werder/i, tier: 2, cat: 'sport' },
  { re: /airport|flughafen/i, tier: 3, cat: 'bahnhof' },
  { re: /vahr|universit[aä]t\s*bremen/i, tier: 2, cat: 'denkmal' },
  { re: /botanika|botanischer/i, tier: 2, cat: 'natur' },
  { re: /heimatmuseum|dommuseum|bleikeller/i, tier: 2, cat: 'museum' },
  { re: /hafenmuseum|speicher|ueberseehafen|überseehafen/i, tier: 2, cat: 'hafen' },
  { re: /sielwall|viertel/i, tier: 2, cat: 'altstadt' },
  { re: /ostertor|kunstverein/i, tier: 2, cat: 'altstadt' },
];

const FORCE_DIR =
  /hotel|hostel|pension|parking|parkplatz|garage|mcdonald|starbucks|lidl|aldi|rewe|edeka|penny|fitness|gym|tattoo|apotheke|klinik|krankenhaus|arzt|schule|gymnasium|supermarkt|tankstelle|burger|kfc|subway|dm\b|rossmann|ikea|media\s*markt|primark|friseur|sparkasse(?!.*arena)|volksbank|autohaus/i;

const seen = new Set();
let demoted = 0;
for (const s of p.spots) {
  if (s.pack_role !== 'story') continue;
  const name = String(s.name || '');
  if (FORCE_DIR.test(name)) {
    s.pack_role = 'directory';
    s.place_tier = 4;
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
    ? `${hit.cat}:${name.toLowerCase().replace(/[^a-z0-9äöüß]+/gi, '').slice(0, 28)}`
    : null;
  if (hit && key && !seen.has(key)) {
    seen.add(key);
    s.pack_role = 'story';
    s.place_tier = hit.tier;
    s.category = hit.cat;
    s.tags = [...new Set([...(s.tags || []).filter((t) => t !== 'directory'), 'story', 'curated_keep'])];
  } else {
    s.pack_role = 'directory';
    s.place_tier = Math.max(3, Number(s.place_tier) || 3);
    demoted += 1;
  }
}
p.data_version = (p.data_version || 0) + 1;
fs.writeFileSync(packPath, JSON.stringify(p, null, 2));
const stories = p.spots.filter((s) => s.pack_role === 'story');
console.log(JSON.stringify({ v: p.data_version, kept: stories.length, demoted, names: stories.map((s) => `${s.place_tier} ${s.name}`).sort() }, null, 2));
