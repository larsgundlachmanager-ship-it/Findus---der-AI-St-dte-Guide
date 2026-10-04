#!/usr/bin/env node
/**
 * Basemap-Gap Report: named OSM amenities vs Pack (ohne Google).
 * Optional --apply fügt fehlende als Directory-Stubs hinzu (nur Name/Lat/Lng/Cat).
 *
 *   node scripts/cityPack/basemapGap.mjs --city kiel
 *   node scripts/cityPack/basemapGap.mjs --city kiel --apply --no-upload
 */
import { arg, hasFlag, loadPack, savePack, slugify, distM } from './lib.mjs';
import { fetchOverpass, sleep } from '../geo/osm.mjs';

function packBbox(pack) {
  let south = Infinity;
  let north = -Infinity;
  let west = Infinity;
  let east = -Infinity;
  for (const s of pack.spots || []) {
    const pin =
      s.sub_pois?.[0] ||
      s.subPois?.[0] ||
      (Array.isArray(s.polygonCoordinates) && s.polygonCoordinates[0]) ||
      null;
    const lat = Number(
      pin?.lat ?? pin?.latitude ?? pack.lat,
    );
    const lng = Number(
      pin?.lng ?? pin?.longitude ?? pack.lng,
    );
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    south = Math.min(south, lat);
    north = Math.max(north, lat);
    west = Math.min(west, lng);
    east = Math.max(east, lng);
  }
  if (!Number.isFinite(south)) {
    const lat = Number(pack.lat);
    const lng = Number(pack.lng);
    const pad = 0.04;
    return { south: lat - pad, north: lat + pad, west: lng - pad, east: lng + pad };
  }
  const pad = 0.008;
  return {
    south: south - pad,
    north: north + pad,
    west: west - pad,
    east: east + pad,
  };
}

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9äöü]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function catFromTags(tags = {}) {
  const a = tags.amenity || '';
  const t = tags.tourism || '';
  const s = tags.shop || '';
  if (a === 'cafe' || a === 'ice_cream') return 'cafe';
  if (a === 'restaurant' || a === 'fast_food' || a === 'biergarten') return 'restaurant';
  if (a === 'bar' || a === 'pub' || a === 'nightclub') return 'bar';
  if (a === 'hotel' || t === 'hotel' || t === 'guest_house' || t === 'hostel') return 'hotel';
  if (t === 'museum') return 'museum';
  if (t === 'attraction' || t === 'viewpoint') return 'aussicht';
  if (a === 'theatre' || a === 'cinema') return a === 'cinema' ? 'kino' : 'theater';
  if (s) return 'einkaufen';
  return 'ort';
}

async function overpassNamed(bbox) {
  const q = `
[out:json][timeout:90];
(
  nwr["amenity"~"^(cafe|restaurant|bar|pub|biergarten|fast_food|nightclub|theatre|cinema)$"]["name"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  nwr["tourism"~"^(hotel|guest_house|hostel|museum|attraction|viewpoint)$"]["name"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
);
out center tags;
`;
  const data = await fetchOverpass(q, { timeoutMs: 100_000 });
  return Array.isArray(data?.elements) ? data.elements : [];
}

function elCenter(el) {
  if (el.center) return { lat: el.center.lat, lng: el.center.lon };
  if (typeof el.lat === 'number') return { lat: el.lat, lng: el.lon };
  return null;
}

function main() {
  const cityId = arg('city');
  if (!cityId) {
    console.error('Usage: node scripts/cityPack/basemapGap.mjs --city <id> [--apply] [--no-upload]');
    process.exit(1);
  }
  const apply = hasFlag('apply');
  const pack = loadPack(cityId);
  if (!pack) throw new Error(`pack missing ${cityId}`);

  const existing = [];
  for (const s of pack.spots || []) {
    existing.push({
      id: s.id,
      name: s.name,
      n: norm(s.name),
      lat: Number(pack.trigger_points?.find((t) => t.id === s.id)?.lat ?? pack.lat),
      lng: Number(pack.trigger_points?.find((t) => t.id === s.id)?.lng ?? pack.lng),
    });
  }

  console.log(`[basemap-gap] ${cityId} querying Overpass…`);
  const elsPromise = overpassNamed(packBbox(pack));
  const timeout = new Promise((_, rej) =>
    setTimeout(() => rej(new Error('overpass timeout 60s')), 60_000),
  );
  return Promise.race([elsPromise, timeout]).then((els) => {
    const missing = [];
    for (const el of els) {
      const name = el.tags?.name;
      if (!name || name.length < 2) continue;
      const c = elCenter(el);
      if (!c) continue;
      const n = norm(name);
      const hit = existing.find(
        (e) =>
          (e.n && (e.n === n || e.n.includes(n) || n.includes(e.n))) ||
          (Number.isFinite(e.lat) && distM(e, c) < 45 && n.split(' ')[0] === e.n.split(' ')[0]),
      );
      if (hit) continue;
      missing.push({
        name,
        lat: c.lat,
        lng: c.lng,
        category: catFromTags(el.tags),
        osm: `${el.type}/${el.id}`,
      });
    }
    // Dedupe by name+~50m
    const uniq = [];
    for (const m of missing) {
      if (uniq.some((u) => norm(u.name) === norm(m.name) && distM(u, m) < 60)) continue;
      uniq.push(m);
    }
    console.log(
      `[basemap-gap] ${cityId}: OSM named=${els.length} · missing≈${uniq.length}`,
    );
    for (const m of uniq.slice(0, 40)) {
      console.log(`  + ${m.name} (${m.category}) ${m.osm}`);
    }
    if (uniq.length > 40) console.log(`  … +${uniq.length - 40} more`);

    if (!apply || !uniq.length) {
      return;
    }

    let added = 0;
    for (const m of uniq.slice(0, 120)) {
      const id = `${cityId}_${slugify(m.name)}`.slice(0, 80);
      if ((pack.spots || []).some((s) => s.id === id)) continue;
      const spot = {
        id,
        name: m.name,
        district: pack.name || cityId,
        category: m.category,
        tags: [
          m.category,
          'directory',
          'tier4',
          'offline_lookup',
          'basemap_gap',
          'sourced_osm',
          'map_outline',
        ],
        bullets: [
          m.category === 'cafe'
            ? 'Café'
            : m.category === 'bar'
              ? 'Bar / Pub'
              : m.category === 'hotel'
                ? 'Hotel'
                : m.category === 'restaurant'
                  ? 'Restaurant'
                  : String(m.category),
          'Öffnungszeiten und mehr über die Buttons',
        ],
        facts: { now: `${m.name} — aus OSM Basemap-Gap.`, tags: [] },
        polygonCoordinates: [
          { latitude: m.lat - 0.00005, longitude: m.lng - 0.00007 },
          { latitude: m.lat - 0.00005, longitude: m.lng + 0.00007 },
          { latitude: m.lat + 0.00005, longitude: m.lng + 0.00007 },
          { latitude: m.lat + 0.00005, longitude: m.lng - 0.00007 },
          { latitude: m.lat - 0.00005, longitude: m.lng - 0.00007 },
        ],
        approach_triggers: [],
        sub_pois: [
          {
            id: `${id}_sub_eingang`,
            name: `${m.name} · Eingang`,
            lat: m.lat,
            lng: m.lng,
            radius_m: 12,
            fact_details: `OSM ${m.osm}`,
            tags: ['sub_poi', 'eingang', 'gps_entrance', 'nav_target', 'sourced_osm'],
          },
        ],
        nav_waypoints: [],
        pack_role: 'directory',
        place_tier: 4,
      };
      pack.spots.push(spot);
      pack.trigger_points = pack.trigger_points || [];
      pack.trigger_points.push({
        id,
        lat: m.lat,
        lng: m.lng,
        radius_m: 35,
      });
      added += 1;
    }
    pack.updated_at = new Date().toISOString();
    savePack(pack, { bumpVersion: true });
    console.log(`[basemap-gap] added ${added} stubs → ${cityId} v${pack.data_version}`);
  });
}

main().catch((e) => {
  console.warn(`[basemap-gap] soft-fail: ${e.message || e}`);
  process.exit(0);
});
