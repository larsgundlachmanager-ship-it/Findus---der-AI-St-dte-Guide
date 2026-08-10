#!/usr/bin/env node
/**
 * Remove any Berlin-Zentrum spots from berlin-umland (strict split).
 * Usage: node scripts/cityPack/pruneBerlinUmlandStrict.mjs
 */
import {
  BERLIN_REGION_PACKS,
  BERLIN_ZENTRUM_BBOX,
  isBerlinZentrumSpot,
} from './berlinRegionPolicy.mjs';
import { loadPack, savePack } from './lib.mjs';

const pack = loadPack('berlin-umland');
const meta = BERLIN_REGION_PACKS['berlin-umland'];
pack.city_id = meta.city_id;
pack.name = meta.name;
pack._product = {
  family: 'berlin_region',
  tier: meta.product_tier,
  paywall: meta.paywall,
  notes: meta.notes,
};
pack._region_policy = {
  exclude_bbox: BERLIN_ZENTRUM_BBOX,
  sister_pack: 'berlin-zentral',
  strict_split: true,
};

const before = pack.spots.length;
const drop = new Set();
for (const s of pack.spots || []) {
  const t = (pack.trigger_points || []).find((x) => x.id === s.id);
  if (isBerlinZentrumSpot(s, t)) drop.add(s.id);
}
pack.spots = (pack.spots || []).filter((s) => !drop.has(s.id));
pack.trigger_points = (pack.trigger_points || []).filter((t) => !drop.has(t.id));

// Normalize ids prefix optional — keep google-derived ids
pack._pack_index = {
  total: pack.spots.length,
  story: pack.spots.filter((s) => s.pack_role !== 'directory').length,
  directory: pack.spots.filter((s) => s.pack_role === 'directory').length,
  offline_qa: (pack._offline_qa || []).length,
};

savePack(pack, { bumpVersion: true });
console.log(
  JSON.stringify(
    {
      v: pack.data_version,
      before,
      after: pack.spots.length,
      dropped: drop.size,
      sampleDropped: [...drop].slice(0, 15),
      story: pack._pack_index.story,
    },
    null,
    2,
  ),
);
