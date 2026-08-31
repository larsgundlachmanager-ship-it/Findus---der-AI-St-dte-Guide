#!/usr/bin/env node
/**
 * Amsterdam: keep iconic stories, demote Places noise → directory.
 * Quality via depth on fewer spots, not 300 thin stories.
 */
import fs from 'node:fs';
import path from 'node:path';
import { STAEDTE_DIR } from './lib.mjs';

const packPath = path.join(STAEDTE_DIR, 'amsterdam.json');
const p = JSON.parse(fs.readFileSync(packPath, 'utf8'));

const KEEP = [
  { re: /rijksmuseum/i, tier: 1, cat: 'museum' },
  { re: /van\s*gogh\s*museum/i, tier: 1, cat: 'museum' },
  { re: /stedelijk/i, tier: 1, cat: 'museum' },
  { re: /anne\s*frank/i, tier: 1, cat: 'museum' },
  { re: /dam\s*square|^dam$|nationale\s*monument/i, tier: 1, cat: 'altstadt' },
  { re: /koninklijk\s*paleis|royal\s*palace/i, tier: 1, cat: 'denkmal' },
  { re: /oude\s*kerk/i, tier: 1, cat: 'kirche' },
  { re: /nieuwe\s*kerk/i, tier: 1, cat: 'kirche' },
  { re: /westerkerk/i, tier: 1, cat: 'kirche' },
  { re: /centraal(?!.*hotel)|amsterdam\s*centraal/i, tier: 1, cat: 'bahnhof' },
  { re: /vondelpark/i, tier: 1, cat: 'natur' },
  { re: /jordaan/i, tier: 1, cat: 'altstadt' },
  { re: /grachtengordel|canal\s*ring|herengracht|keizersgracht|prinsengracht/i, tier: 1, cat: 'altstadt' },
  { re: /magere\s*brug/i, tier: 1, cat: 'denkmal' },
  { re: /nemo\s*science/i, tier: 1, cat: 'museum' },
  { re: /scheepvaartmuseum|maritime\s*museum/i, tier: 1, cat: 'museum' },
  { re: /het\s*scheepvaart/i, tier: 1, cat: 'museum' },
  { re: /rembrandt\s*huis|rembrandthuis/i, tier: 1, cat: 'museum' },
  { re: /begijnhof/i, tier: 1, cat: 'altstadt' },
  { re: /a'?dam\s*lookout|adam\s*lookout|overhoeks/i, tier: 2, cat: 'aussicht' },
  { re: /eye\s*filmmuseum|eye\s*film/i, tier: 2, cat: 'museum' },
  { re: /concertgebouw/i, tier: 2, cat: 'theater' },
  { re: /stopera|muziektheater|nationale\s*opera/i, tier: 2, cat: 'theater' },
  { re: /heimis?\s*museum|tropenmuseum|wereldmuseum/i, tier: 2, cat: 'museum' },
  { re: /foam|fotografie\s*museum/i, tier: 2, cat: 'museum' },
  { re: /hermitage\s*amsterdam|h'?art\s*museum/i, tier: 2, cat: 'museum' },
  { re: /museumplein/i, tier: 2, cat: 'altstadt' },
  { re: /leidseplein/i, tier: 2, cat: 'altstadt' },
  { re: /rembrandtplein/i, tier: 2, cat: 'altstadt' },
  { re: /waterlooplein/i, tier: 2, cat: 'markt' },
  { re: /albert\s*cuyp/i, tier: 2, cat: 'markt' },
  { re: /bloemenmarkt|flower\s*market/i, tier: 2, cat: 'markt' },
  { re: /red\s*light|de\s*wallen|oudezijds/i, tier: 2, cat: 'altstadt' },
  { re: /schreierstoren/i, tier: 2, cat: 'denkmal' },
  { re: /montelbaanstoren/i, tier: 2, cat: 'denkmal' },
  { re: /waag|nieuwe\s*markt/i, tier: 2, cat: 'denkmal' },
  { re: /zuiderkerk/i, tier: 2, cat: 'kirche' },
  { re: /noorderkerk/i, tier: 2, cat: 'kirche' },
  { re: /portuguese\s*synagogue|portugese\s*synagoge|esnoga/i, tier: 2, cat: 'kirche' },
  { re: /joods?\s*historisch|jewish\s*historical/i, tier: 2, cat: 'museum' },
  { re: /verzetmuseum|dutch\s*resistance/i, tier: 2, cat: 'museum' },
  { re: /hortus\s*botanicus/i, tier: 2, cat: 'natur' },
  { re: /artis|zoo\s*amsterdam/i, tier: 2, cat: 'freizeit' },
  { re: /olympic\s*stadium|olympisch\s*stadion/i, tier: 2, cat: 'sport' },
  { re: /ajax|johan\s*cruijff|arena/i, tier: 2, cat: 'sport' },
  { re: /ijhallen/i, tier: 2, cat: 'markt' },
  { re: /ndsm/i, tier: 2, cat: 'altstadt' },
  { re: /westergas|westerpark/i, tier: 2, cat: 'natur' },
  { re: /sarphatipark/i, tier: 2, cat: 'natur' },
  { re: /oosterpark/i, tier: 2, cat: 'natur' },
  { re: /museum\s*van\s*loon/i, tier: 2, cat: 'museum' },
  { re: /huis\s*marseille/i, tier: 2, cat: 'museum' },
  { re: /moco\s*museum/i, tier: 2, cat: 'museum' },
  { re: /diamond|coster|gassan/i, tier: 3, cat: 'einkaufen' }, // skip diamonds as story - demote
];

const FORCE_DIR =
  /hotel|hostel|airbnb|apartment|parking|parkplatz|garage|mcdonald|starbucks|albert\s*heijn|supermarket|lidl|aldi|action\b|primark|ikea|fitness|gym|sauna|tattoo|coffeeshop|smartshop|sex\s*shop|cannabis|weed|pharmacy|apotheek|ziekenhuis|hospital|kliniek|dentist|tandarts|school(?!museum)|universiteit|university|bibliotheek|library(?!.*museum)|bike\s*rental|fietsverhuur|scooter|uber|taxi|tram\s*halte|bus\s*stop|metro\s*station|ferry\s*terminal(?!.*centraal)|pier\b|wharf|cruise|tour\s*office|tourist\s*info|vvv|souvenir|gift\s*shop|restaurant|cafe|café|bar\b|pub\b|club\b|discotheek|nightclub|casino|bowling|escape|laser|minigolf|kart|trampoline|paintball|cinema(?!.*eye)|path[eé]|kinepolis|vue\b|diamond\s*museum|heineken\s*experience|madame\s*tussaud|ripp?ley|body\s*worlds|sexmuseum|hash\s*museum|torture|dungeon|cheese\s*museum|cats\s*museum|micropia|science\s*center\s*nemo/i;

const seen = new Set();
let kept = 0;
let demoted = 0;

for (const s of p.spots) {
  if (s.pack_role !== 'story' && !(s.tags || []).includes('curated_keep')) continue;
  const name = String(s.name || '');
  if (FORCE_DIR.test(name) && !/anne\s*frank|rijksmuseum|van\s*gogh|nemo\s*science|eye\s*film/i.test(name)) {
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
    if (rule.tier === 3) continue; // skip list
    if (rule.re.test(name)) {
      hit = rule;
      break;
    }
  }
  const key = hit
    ? `${hit.cat}:${name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '')
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
        .map((s) => `${s.place_tier} ${s.id} | ${s.name}`),
    },
    null,
    2,
  ),
);
