#!/usr/bin/env node
/**
 * Kiel: keep harbor/city icons, demote noise → directory.
 */
import fs from 'node:fs';
import path from 'node:path';
import { STAEDTE_DIR } from './lib.mjs';

const packPath = path.join(STAEDTE_DIR, 'kiel.json');
const p = JSON.parse(fs.readFileSync(packPath, 'utf8'));

const KEEP = [
  { re: /kieler\s*f[öo]rde|f[öo]rde\s*kiel/i, tier: 1, cat: 'hafen' },
  { re: /kieler\s*woche|kiwo/i, tier: 1, cat: 'freizeit' },
  { re: /rathaus/i, tier: 1, cat: 'denkmal' },
  { re: /nikolai|st\.?\s*nikolai/i, tier: 1, cat: 'kirche' },
  { re: /schloss\s*kiel|kieler\s*schloss/i, tier: 1, cat: 'denkmal' },
  { re: /kunsthalle/i, tier: 1, cat: 'museum' },
  { re: /stadt.?museum|stadtmuseum/i, tier: 1, cat: 'museum' },
  { re: /schifffahrtsmuseum|schiffahrtsmuseum|museumshafen/i, tier: 1, cat: 'museum' },
  { re: /aquarium|geomar|ocean|Meeresmuseum/i, tier: 1, cat: 'museum' },
  { re: /zoologisches?\s*museum/i, tier: 1, cat: 'museum' },
  { re: /hauptbahnhof|kiel\s*hbf/i, tier: 1, cat: 'bahnhof' },
  { re: /holstenstra/i, tier: 1, cat: 'altstadt' },
  { re: /alter\s*markt/i, tier: 1, cat: 'altstadt' },
  { re: /bootshafen/i, tier: 1, cat: 'hafen' },
  { re: /schwedenkai|norwegenkai|ostseekai|germanykai|kiel\s*cruise/i, tier: 1, cat: 'hafen' },
  { re: /laboe|marine.?ehrenmal|u.?995/i, tier: 2, cat: 'denkmal' }, // may be far
  { re: /kiellinie/i, tier: 1, cat: 'hafen' },
  { re: /d[üu]sternbrooker|hindenburgufer/i, tier: 1, cat: 'aussicht' },
  { re: /schrevenpark/i, tier: 2, cat: 'natur' },
  { re: /forstbaumschule|moorteichwiese/i, tier: 2, cat: 'natur' },
  { re: /westufer|falckenstein|schilksee|strande/i, tier: 2, cat: 'natur' },
  { re: /olympiazentrum|schilksee/i, tier: 2, cat: 'sport' },
  { re: /holsten.?halle|sparkassen.?arena|wunderino/i, tier: 2, cat: 'theater' },
  { re: /oper|theater\s*kiel|schauspielhaus/i, tier: 2, cat: 'theater' },
  { re: /christianspries|friedrichsort|leuchtturm/i, tier: 2, cat: 'denkmal' },
  { re: /kriegerdenkmal|rathausturm|rathausplatz/i, tier: 2, cat: 'denkmal' },
  { re: /nikolaikirche/i, tier: 1, cat: 'kirche' },
  { re: /heiligengeist|klosterkirche/i, tier: 2, cat: 'kirche' },
  { re: /anfa.?nger|anf[äa]nger\s*hafen|seegarten/i, tier: 2, cat: 'hafen' },
  { re: /german\s*naval|marinearsenal|werft|hdw|thyssenkrupp\s*marine/i, tier: 2, cat: 'hafen' },
  { re: /uni\s*kiel|christian.?albrechts|cau/i, tier: 2, cat: 'denkmal' },
  { re: /botanischer\s*garten/i, tier: 2, cat: 'natur' },
  { re: /tierpark|zoo\s*kiel/i, tier: 2, cat: 'freizeit' },
  { re: /holtenau|schleuse|nord.?ostsee.?kanal|kiel.?canal/i, tier: 1, cat: 'hafen' },
  { re: /horsts.?ee|hornheimer|wellsee/i, tier: 3, cat: 'natur' },
  { re: /eli.?asch|elisabeth|viktoriapark|scharnhorst/i, tier: 3, cat: 'natur' },
  { re: /computermuseum|computer.?museum/i, tier: 2, cat: 'museum' },
  { re: /landesbibliothek|schlossgarten/i, tier: 2, cat: 'denkmal' },
  { re: /asemus|volkskunde/i, tier: 2, cat: 'museum' },
  { re: /fischhalle|fischmarkt/i, tier: 2, cat: 'markt' },
  { re: /sophienblatt|eggerstedt|dreiecksplatz/i, tier: 3, cat: 'altstadt' },
];

const FORCE_DIR =
  /hotel|hostel|pension|airbnb|parking|parkplatz|garage|mcdonald|starbucks|lidl|aldi|rewe|edeka|penny|fitness|gym|tattoo|apotheke|klinik|krankenhaus|arzt|zahn|schule|gymnasium|universit[aä]tsklinik|supermarkt|discounter|tankstelle|shell|aral|burger\s*king|kfc|subway|dm\b|rossmann|ikea|media\s*markt|saturn|primark|h&m|c&a|douglas|b[äa]cker(?!.*museum)|friseur|waschsalon|postbank|sparkasse(?!.*arena)|volksbank|autohaus|werkstatt|carwash/i;

const seen = new Set();
let kept = 0;
let demoted = 0;

for (const s of p.spots) {
  if (s.pack_role !== 'story') continue;
  const name = String(s.name || '');
  if (FORCE_DIR.test(name)) {
    s.pack_role = 'directory';
    s.place_tier = 4;
    s.tags = [
      ...new Set([
        ...(s.tags || []).filter((t) => !['story', 'must_have', 'module1', 'tier1', 'tier2'].includes(t)),
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
        .replace(/[^a-z0-9äöüß]+/gi, '')
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
        'curated_keep',
      ]),
    ];
    kept += 1;
  } else {
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
