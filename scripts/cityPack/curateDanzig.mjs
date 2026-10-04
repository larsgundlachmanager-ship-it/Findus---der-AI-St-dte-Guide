#!/usr/bin/env node
/** Danzig/Gdańsk: keep Hanseatic icons, demote noise. */
import fs from 'node:fs';
import path from 'node:path';
import { STAEDTE_DIR } from './lib.mjs';

const packPath = path.join(STAEDTE_DIR, 'danzig.json');
const p = JSON.parse(fs.readFileSync(packPath, 'utf8'));
p.name = 'Danzig';
p.symbol = p.symbol || '⚓';

const KEEP = [
  { re: /marienkirche|mariacka|st\.?\s*mary|bazylika\s*mariacka|frauenkirche/i, tier: 1, cat: 'kirche' },
  { re: /rathaus|ratusz/i, tier: 1, cat: 'denkmal' },
  { re: /langer\s*markt|d[łl]ugi\s*targ|dlugi\s*targ/i, tier: 1, cat: 'altstadt' },
  { re: /lange\s*gasse|d[łl]uga|ulica\s*dluga/i, tier: 1, cat: 'altstadt' },
  { re: /krantor|zuraw|żuraw|zuraw/i, tier: 1, cat: 'denkmal' },
  { re: /neptun/i, tier: 1, cat: 'denkmal' },
  { re: /goldene\s*tor|z[łl]ota\s*brama|zlota\s*brama/i, tier: 1, cat: 'denkmal' },
  { re: /hohes\s*tor|wy[sz]oka\s*brama|wysoka\s*brama/i, tier: 1, cat: 'denkmal' },
  { re: /gr[üu]nes\s*tor|zielona\s*brama/i, tier: 1, cat: 'denkmal' },
  { re: /mot[łl]awa|motlawa|dlugie\s*pobrzeze|d[łl]ugie\s*pobrze/i, tier: 1, cat: 'hafen' },
  { re: /rechtstadt|g[łl][óo]wne\s*miasto|altstadt|old\s*town/i, tier: 1, cat: 'altstadt' },
  { re: /europ[äa]isches?\s*solidarit|european\s*solidarity|ecs\b|solidarno/i, tier: 1, cat: 'museum' },
  { re: /ww2|ii\s*world|muzeum\s*ii|zweiten?\s*weltkrieg|world\s*war/i, tier: 1, cat: 'museum' },
  { re: /bernstein|amber|muzeum\s*bursztynu/i, tier: 1, cat: 'museum' },
  { re: /nationalmuseum|muzeum\s*narodowe/i, tier: 1, cat: 'museum' },
  { re: /hauptbahnhof|g[łl][óo]wny|gdansk\s*glowny|danzig\s*hbf/i, tier: 1, cat: 'bahnhof' },
  { re: /werft|shipyard|stocznia|lenin/i, tier: 1, cat: 'denkmal' },
  { re: /oliwa|oliva/i, tier: 1, cat: 'kirche' },
  { re: /westerplatte/i, tier: 1, cat: 'denkmal' },
  { re: /hevelianum|hevelius/i, tier: 2, cat: 'museum' },
  { re: /artus|artushof|dw[óo]r\s*artusa/i, tier: 1, cat: 'denkmal' },
  { re: /frauenkirche|st\.?\s*katharina|katarzyna/i, tier: 2, cat: 'kirche' },
  { re: /johannes|jan\s*kości|kosciol\s*sw/i, tier: 2, cat: 'kirche' },
  { re: /shakespeare|teatr\s*szekspir/i, tier: 2, cat: 'theater' },
  { re: /philharmon|filharmonia|opera/i, tier: 2, cat: 'theater' },
  { re: /leuchtturm|latarnia|nowy\s*port/i, tier: 2, cat: 'denkmal' },
  { re: /brze[źz]no|sopot|gdynia/i, tier: 3, cat: 'natur' }, // skip distant later
  { re: /granary|speicher|spichrz|wyspa\s*spichrz/i, tier: 2, cat: 'altstadt' },
  { re: /mariacka\s*street|ul\.\s*mariacka|frauengasse/i, tier: 1, cat: 'altstadt' },
  { re: /prison\s*tower|torturm|wie[zż]a\s*wi[eę]/i, tier: 2, cat: 'denkmal' },
  { re: /foregate|vortor|katownia/i, tier: 2, cat: 'denkmal' },
  { re: /great\s*mill|gro[sś]e\s*m[üu]hle|wielki\s*mlyn/i, tier: 2, cat: 'denkmal' },
  { re: /crane|zuraw/i, tier: 1, cat: 'denkmal' },
  { re: /solidarity\s*square|plac\s*solidarno/i, tier: 2, cat: 'denkmal' },
  { re: /park\s*oliwski|oliwa\s*park/i, tier: 2, cat: 'natur' },
  { re: /zoo|zoo\s*gdansk|oliwa\s*zoo/i, tier: 2, cat: 'freizeit' },
  { re: /beach|strand|plaza/i, tier: 2, cat: 'natur' },
];

const FORCE_DIR =
  /hotel|hostel|parking|parkplatz|mcdonald|starbucks|lidl|aldi|biedronka|zabka|fitness|gym|tattoo|apotheke|apteka|klinik|szpital|arzt|school|szko[łl]a|supermarkt|tankstelle|burger|kfc|subway|ikea|primark|friseur|bank\b|atm\b/i;

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
  // drop distant Sopot/Gdynia from core pack stories
  if (/sopot|gdynia|sopoty/i.test(name) && !/gdansk|danzig|gdańsk/i.test(name)) {
    s.pack_role = 'directory';
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
console.log(
  JSON.stringify(
    {
      v: p.data_version,
      kept: stories.length,
      demoted,
      names: stories.map((s) => `${s.place_tier} ${s.name}`).sort(),
    },
    null,
    2,
  ),
);
