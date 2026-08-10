#!/usr/bin/env node
/**
 * Prune bloated offline_qa (generic spot_faq templates) and optionally
 * demote thin story spots in large cities so depth scales with city size.
 *
 *   node scripts/cityPack/prunePackDepthBalance.mjs --city wangerooge --apply
 *   node scripts/cityPack/prunePackDepthBalance.mjs --cities wangerooge,prisdorf,hamburg --apply
 *   node scripts/cityPack/prunePackDepthBalance.mjs --city hamburg --demote-thin --apply
 */
import {
  arg,
  hasFlag,
  loadPack,
  savePack,
} from './lib.mjs';
import { runQualityGate } from './qualityGate.mjs';

const GENERIC_Q = [
  /^warum sollte ich hier kurz stehen bleiben/i,
  /^gibt es etwas historisches zu diesem ort/i,
  /^ist das ein typischer .+ort/i,
  /^wie hängt das mit der .+geschichte zusammen/i,
  /^was kann ich hier heute machen$/i,
  /^lohnt sich ein foto/i,
  /^wie sind die bewertungen/i,
  /^was sagen gäste/i,
  /^welche restaurants sind im pack/i,
  /^welche cafés? \/ bäckereien sind im pack/i,
  /^welche hotels \/ pensionen sind im pack/i,
  /^welche sport-\/freizeitstätten sind im pack/i,
  /^welche parks \/ naturziele sind im pack/i,
  /^was kann ich hier machen \/ wo finde ich orte offline/i,
];

function isGenericQa(e) {
  const q = String(e.q || '').trim();
  if (GENERIC_Q.some((re) => re.test(q))) return true;
  const tags = e.tags || [];
  // Template dumps often only have offline_qa + spot_faq + PlaceName
  if (tags.includes('spot_faq') && tags.includes('offline_qa') && tags.length <= 3) {
    // keep if question looks specific (contains year, person, named building detail)
    if (!/\d{3,4}|warum heißt|seit wann|wer |wo genau|welcher|welche rolle/i.test(q)) {
      return true;
    }
  }
  return false;
}

function pruneQa(pack, { maxSpotFaqPerPlace = 3 } = {}) {
  const before = (pack._offline_qa || []).length;
  const kept = [];
  const perPlace = new Map();

  for (const e of pack._offline_qa || []) {
    if (isGenericQa(e)) continue;
    const placeTag = (e.tags || []).find(
      (t) => t !== 'offline_qa' && t !== 'spot_faq' && t !== 'deep_research_merged' && t !== 'directory',
    );
    if ((e.tags || []).includes('spot_faq') && placeTag) {
      const n = perPlace.get(placeTag) || 0;
      if (n >= maxSpotFaqPerPlace) continue;
      perPlace.set(placeTag, n + 1);
    }
    kept.push(e);
  }

  // Dedup by question text
  const seen = new Set();
  pack._offline_qa = kept.filter((e) => {
    const k = String(e.q || '')
      .toLowerCase()
      .replace(/[?؟]/g, '')
      .trim();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return { before, after: pack._offline_qa.length, removed: before - pack._offline_qa.length };
}

function demoteThinStories(pack, { minDeep = 2 } = {}) {
  let demoted = 0;
  // Only demote clear catalog/commercial noise — cultural thin spots stay for deepening.
  const demoteCat = /tourist_info|freizeitpark|markt|hotel|restaurant|cafe|einkaufen|supermarkt|apotheke|tankstelle|toilette|parkplatz/i;
  const demoteName =
    /illusion|paradox|interaktiv|rundfahrt|käpt.?n|blue port|sightseeing|hop.?on|souvenir|mini golf|minigolf|bowling|escape.?room|laser.?tag|aussichtspunkt|panorama|sporthafen|anleger |food lovers/i;
  // Landmark names only — do NOT keep whole categories (denkmal/park/…),
  // otherwise every thin memorial blocks demote and dilutes metro deepAvg.
  const alwaysKeep =
    /speicherstadt|elbphilharmonie|michel|rathaus(?!markt)|landungsbrücken|miniatur|binnenalster|außenalster|alsterfontäne|hafencity|reeperbahn|planten|jungfernstieg|fischbeker|boberger|loki.?schmidt|dammtor|hauptbahnhof|grün.?bunker|hamburg bunker|flakturm|chilehaus|kontorhaus|övelgönne|blankenese|hagenbeck|planten un blomen|nikolaikirche|st\.? michaelis|rathausmarkt|alsterarkaden|königstraße|nordertor|marineschule/i;

  for (const s of pack.spots || []) {
    if (s.pack_role === 'directory') continue;
    if (s.place_tier === 1 && !/tourist_info|parkplatz|freizeit|hotel|restaurant|cafe/i.test(s.category || '')) {
      continue;
    }
    const label = `${s.id} ${s.name}`;
    const t = (pack.trigger_points || []).find((x) => x.id === s.id);
    const deep = (t?.deep_data_pool || []).length;
    const gi = (t?.general_info || '').length;
    const noise =
      demoteCat.test(s.category || '') ||
      demoteName.test(s.name || '') ||
      /parkplatz|tourist information|icf |bäderland|schwimmhalle/i.test(s.name || '');
    // Landmark whitelist applies to name/id only — not category tokens.
    if (alwaysKeep.test(label) && !noise) continue;
    if ((noise && deep < 5) || (deep < minDeep && gi < 80 && !alwaysKeep.test(label))) {
      s.pack_role = 'directory';
      s.place_tier = 4;
      s.tags = [
        ...new Set([
          ...(s.tags || []).filter((x) => !['story', 'tier1', 'tier2', 'must_have'].includes(x)),
          'directory',
          'tier4',
          'demoted_thin',
        ]),
      ];
      demoted += 1;
    }
  }
  return demoted;
}

function refreshIndex(pack) {
  pack._pack_index = {
    total: pack.spots.length,
    story: pack.spots.filter((s) => s.pack_role !== 'directory').length,
    directory: pack.spots.filter((s) => s.pack_role === 'directory').length,
    offline_qa: (pack._offline_qa || []).length,
    note: 'UI: Gesamtzahl; Trigger Story Tier 1–2 (+ Interesse).',
  };
}

function main() {
  const one = arg('city');
  const many = arg('cities');
  const ids = one
    ? [one]
    : (many || 'wangerooge,prisdorf,pinneberg,hamburg,flensburg,luebeck,laboe,tornesch,hechingen,tettnang')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
  const apply = hasFlag('apply');
  const doDemote = hasFlag('demote-thin');
  const report = [];

  for (const id of ids) {
    const pack = loadPack(id);
    if (!pack) {
      report.push({ id, error: 'missing' });
      continue;
    }
    const qa = pruneQa(pack);
    let demoted = 0;
    if (doDemote) demoted = demoteThinStories(pack);
    refreshIndex(pack);
    if (apply) savePack(pack, { bumpVersion: true });
    const gate = runQualityGate(pack, { strict: false });
    const stories = pack.spots.filter((s) => s.pack_role !== 'directory');
    let deepSum = 0;
    for (const s of stories) {
      const t = pack.trigger_points.find((x) => x.id === s.id);
      deepSum += (t?.deep_data_pool || []).length;
    }
    report.push({
      id,
      v: pack.data_version,
      qa,
      demoted,
      story: stories.length,
      deepAvg: stories.length ? +(deepSum / stories.length).toFixed(1) : 0,
      thin: gate.stats?.thinDeep,
      apply,
    });
  }

  console.log(JSON.stringify(report, null, 2));
}

main();
