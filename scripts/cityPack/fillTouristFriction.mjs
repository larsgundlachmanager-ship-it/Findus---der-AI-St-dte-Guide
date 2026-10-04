#!/usr/bin/env node
/** Cheap friction fill: Gepäck, Waschsalon, Verleih, Wechselstube, Tourist-Info. */
import {
  arg,
  distM,
  loadEnvFile,
  loadPack,
  savePack,
} from './lib.mjs';
import { placesText, requireGoogleKey, setPackCityCostLabel } from './google.mjs';
import { suggestedDiscoveryRadius, citySizeHint } from './placeCategoryPolicy.mjs';

loadEnvFile();

function addDir(pack, hit, stats) {
  const name = String(hit.name || '').trim();
  if (!name) return;
  const lat = Number(hit.lat);
  const lng = Number(hit.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  const near = (pack.spots || []).some(
    (s) =>
      Number.isFinite(s.lat) &&
      Number.isFinite(s.lng) &&
      distM({ lat, lng }, { lat: s.lat, lng: s.lng }) < 45 &&
      String(s.name || '').toLowerCase() === name.toLowerCase(),
  );
  if (near) {
    stats.dup += 1;
    return;
  }
  const idBase = `${hit.category}_${name}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .slice(0, 48);
  let id = idBase;
  let n = 2;
  while ((pack.spots || []).some((s) => s.id === id)) {
    id = `${idBase}_${n++}`;
  }
  pack.spots.push({
    id,
    name,
    lat,
    lng,
    category: hit.category,
    pack_role: 'directory',
    place_tier: 4,
    address: hit.address || null,
    tags: ['directory', 'offline_lookup', 'tourist_friction', hit.category],
    google_place_id: hit.place_id || null,
  });
  stats.added += 1;
}

async function main() {
  requireGoogleKey();
  const cityId = String(arg('city') || '')
    .toLowerCase()
    .trim();
  if (!cityId) {
    console.error('Usage: node scripts/cityPack/fillTouristFriction.mjs --city danzig');
    process.exit(1);
  }
  setPackCityCostLabel(cityId);
  const pack = loadPack(cityId);
  if (!pack) throw new Error(`missing ${cityId}`);
  const center = { lat: pack.lat, lng: pack.lng };
  const radiusM = Number(arg('radius') || suggestedDiscoveryRadius(pack));
  const stats = { added: 0, dup: 0 };
  const queries = [
    { q: 'Gepäckaufbewahrung OR Luggage storage OR Schließfach OR Bounce', category: 'gepaeck', take: 12 },
    { q: 'Waschsalon OR Laundry OR Laundromat', category: 'waschsalon', take: 8 },
    { q: 'Fahrradverleih OR Bike rental OR Mietrad', category: 'fahrradverleih', take: 10 },
    { q: 'Autoverleih OR Car rental', category: 'autoverleih', take: 8 },
    { q: 'Wechselstube OR Currency exchange', category: 'wechselstube', take: 6 },
    { q: 'Tourist Information OR Touristeninformation', category: 'tourist_info', take: 4 },
  ];
  console.log(`[friction] ${cityId} size=${citySizeHint(pack)} r=${radiusM}`);
  for (const fq of queries) {
    console.log(`[friction] ${fq.category}`);
    const data = await placesText(`${fq.q} ${pack.name || cityId}`, {
      lat: center.lat,
      lng: center.lng,
      radiusM,
    });
    for (const r of (data.results || []).slice(0, fq.take)) {
      const loc = r.geometry?.location;
      if (!loc) continue;
      if (distM(center, loc) > radiusM + 1500) continue;
      addDir(
        pack,
        {
          name: r.name,
          lat: loc.lat,
          lng: loc.lng,
          address: r.formatted_address || r.vicinity,
          category: fq.category,
          place_id: r.place_id || null,
        },
        stats,
      );
    }
  }
  pack._pack_index = {
    ...(pack._pack_index || {}),
    total: pack.spots.length,
    story: pack.spots.filter((s) => s.pack_role !== 'directory').length,
    directory: pack.spots.filter((s) => s.pack_role === 'directory').length,
  };
  savePack(pack, { bumpVersion: true });
  console.log(
    `[friction] added=${stats.added} dup=${stats.dup} dir=${pack._pack_index.directory} v${pack.data_version}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
