#!/usr/bin/env node
/**
 * Split data/staedte/berlin.json → Berlin Zentrum (+ seed berlin-umland from leftovers).
 *
 * Usage:
 *   node scripts/cityPack/splitBerlinZentrumUmland.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  BERLIN_FULL_BBOX,
  BERLIN_REGION_PACKS,
  BERLIN_ZENTRUM_BBOX,
  isBerlinUmlandSpot,
  isBerlinZentrumSpot,
} from './berlinRegionPolicy.mjs';
import { ROOT, STAEDTE_DIR, loadPack, savePack, writeJson } from './lib.mjs';

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function filterPack(src, predicate, meta) {
  const pack = clone(src);
  pack.city_id = meta.city_id;
  pack.name = meta.name;
  pack.data_version = 1;
  pack._product = {
    family: 'berlin_region',
    tier: meta.product_tier,
    paywall: meta.paywall,
    notes: meta.notes,
  };

  const keepIds = new Set();
  for (const s of pack.spots || []) {
    const t = (pack.trigger_points || []).find((x) => x.id === s.id);
    if (predicate(s, t)) keepIds.add(s.id);
  }

  pack.spots = (pack.spots || []).filter((s) => keepIds.has(s.id));
  pack.trigger_points = (pack.trigger_points || []).filter((t) => keepIds.has(t.id));

  // Drop orphan approaches / sub refs already embedded in spots
  pack._pack_index = {
    total: pack.spots.length,
    story: pack.spots.filter((s) => s.pack_role !== 'directory').length,
    directory: pack.spots.filter((s) => s.pack_role === 'directory').length,
    offline_qa: (pack._offline_qa || []).length,
    note: meta.notes,
  };

  return { pack, keepIds };
}

function main() {
  const src = loadPack('berlin');
  const zMeta = BERLIN_REGION_PACKS['berlin-zentral'];
  const uMeta = BERLIN_REGION_PACKS['berlin-umland'];

  const { pack: zentrum, keepIds: zIds } = filterPack(src, isBerlinZentrumSpot, zMeta);
  zentrum.lat = 52.52;
  zentrum.lng = 13.405;
  zentrum._coverage = { ...BERLIN_ZENTRUM_BBOX };
  zentrum._region_policy = {
    bbox: BERLIN_ZENTRUM_BBOX,
    sister_pack: 'berlin-umland',
    strict_split: true,
  };

  // Umland seed from same file leftovers (full discovery later via city:auto)
  const { pack: umlandSeed, keepIds: uIds } = filterPack(src, isBerlinUmlandSpot, uMeta);
  umlandSeed.lat = 52.52;
  umlandSeed.lng = 13.405;
  umlandSeed._coverage = { ...BERLIN_FULL_BBOX };
  umlandSeed._region_policy = {
    bbox_full: BERLIN_FULL_BBOX,
    exclude_bbox: BERLIN_ZENTRUM_BBOX,
    sister_pack: 'berlin-zentral',
    strict_split: true,
  };

  // Re-id umland spots that still use berlin_ prefix stay; city_id is berlin-umland
  // Ensure no ID overlap
  const overlap = [...zIds].filter((id) => uIds.has(id));
  if (overlap.length) {
    console.error('[split] overlap IDs (bug):', overlap.slice(0, 20));
    process.exit(1);
  }

  // Write zentral as berlin-zentral.json (Base product id)
  const zPath = path.join(STAEDTE_DIR, 'berlin-zentral.json');
  writeJson(zPath, zentrum);

  // Write umland seed
  const uPath = path.join(STAEDTE_DIR, 'berlin-umland.json');
  writeJson(uPath, umlandSeed);

  const report = {
    source_spots: (src.spots || []).length,
    zentrum_spots: zentrum.spots.length,
    zentrum_story: zentrum._pack_index.story,
    umland_seed_spots: umlandSeed.spots.length,
    umland_seed_story: umlandSeed._pack_index.story,
    overlap: overlap.length,
    zentrum_bbox: BERLIN_ZENTRUM_BBOX,
    next: [
      'npm run city:auto -- --city "Berlin" --id berlin-umland --skip-wiki  (then prune zentrum)',
      'or: expand umland with radius 28000 and strip BERLIN_ZENTRUM_BBOX',
    ],
  };
  writeJson(path.join(STAEDTE_DIR, 'berlin.split_report.json'), report);
  console.log(JSON.stringify(report, null, 2));
  console.log(`[split] wrote ${zPath}`);
  console.log(`[split] wrote ${uPath}`);
}

main();
