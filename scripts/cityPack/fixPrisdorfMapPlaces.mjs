#!/usr/bin/env node
/**
 * Prisdorf: TCP-Tennisplatz vs. TSV-Sportgelände, Kita/Feuerwehr sichtbar.
 *
 *   node scripts/cityPack/fixPrisdorfMapPlaces.mjs
 */
import {
  centroid,
  hasFlag,
  loadPack,
  offset,
  savePack,
} from './lib.mjs';

/** OSM way 25307201 leisure=pitch sport=tennis (Ahrenloher Weg 5). */
const TCP_TENNIS = [
  { lat: 53.6838525, lng: 9.751064 },
  { lat: 53.683206, lng: 9.750842 },
  { lat: 53.6831217, lng: 9.7515417 },
  { lat: 53.6831057, lng: 9.7516748 },
  { lat: 53.6837522, lng: 9.7518968 },
  { lat: 53.6838525, lng: 9.751064 },
];

/** OSM way 120302495 leisure=sports_centre — TSV-Gelände, nicht TCP. */
const TSV_GROUNDS = [
  { lat: 53.6846842, lng: 9.7515008 },
  { lat: 53.6842185, lng: 9.7496562 },
  { lat: 53.6846339, lng: 9.7491831 },
  { lat: 53.6853844, lng: 9.7481088 },
  { lat: 53.6854699, lng: 9.7479646 },
  { lat: 53.6856714, lng: 9.7506103 },
  { lat: 53.6853147, lng: 9.7507352 },
  { lat: 53.6852045, lng: 9.7508308 },
  { lat: 53.6851229, lng: 9.7509017 },
  { lat: 53.6846842, lng: 9.7515008 },
];

/** OSM way 80253965 Feuerwache Hudenbarg. */
const FEUERWEHR = [
  { lat: 53.6775556, lng: 9.7565995 },
  { lat: 53.6774922, lng: 9.7575952 },
  { lat: 53.6775374, lng: 9.7576033 },
  { lat: 53.6775219, lng: 9.757804 },
  { lat: 53.6775219, lng: 9.7578388 },
  { lat: 53.6776692, lng: 9.7578766 },
  { lat: 53.6776969, lng: 9.757442 },
  { lat: 53.6776653, lng: 9.7574363 },
  { lat: 53.6776894, lng: 9.7570582 },
  { lat: 53.6776379, lng: 9.7570489 },
  { lat: 53.677648, lng: 9.7568888 },
  { lat: 53.6776901, lng: 9.7568965 },
  { lat: 53.6777073, lng: 9.756627 },
  { lat: 53.6775556, lng: 9.7565995 },
];

const DROP_DIR = new Set([
  'directory',
  'amenity_skip',
  'offline_lookup',
  'tier4',
  'touristic',
]);

const LOCAL_STORY_NO_TOURISTIC = [
  'prisdorf_alte_schule_lütte_prisdörper',
  'prisdorf_heimatverein',
  'prisdorf_stadtgeschichte_gesamt',
  'prisdorf_strassen_gestern_heute',
  'prisdorf_strassenverzeichnis',
  'prisdorf_kriegerehrenmal_bilsbek',
  'prisdorf_zur_schwalbe_geschichte',
];

function pinHex(lat, lng, rM = 12) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    pts.push(offset(lat, lng, Math.cos(a) * rM, Math.sin(a) * rM));
  }
  pts.push({ ...pts[0] });
  return pts;
}

function toSpot(pts) {
  return pts.map((p) => ({
    latitude: p.lat ?? p.latitude,
    longitude: p.lng ?? p.longitude,
  }));
}

function toTrig(pts) {
  return pts.map((p) => ({
    lat: p.lat ?? p.latitude,
    lng: p.lng ?? p.longitude,
  }));
}

function promoteStory(entity) {
  if (!entity) return;
  entity.pack_role = 'story';
  const tier = Number(entity.place_tier);
  entity.place_tier = !Number.isFinite(tier) || tier > 2 ? 2 : tier;
  const tags = (entity.tags || []).filter((t) => !DROP_DIR.has(String(t)));
  if (!tags.includes('story')) tags.push('story');
  if (!tags.includes('tier2')) tags.push('tier2');
  if (!tags.includes('module1')) tags.push('module1');
  entity.tags = tags;
}

function stripTouristic(entity) {
  if (!entity?.tags) return;
  entity.tags = entity.tags.filter((t) => t !== 'touristic');
}

function setEntrance(spot, lat, lng, source) {
  const subs = spot.sub_pois || spot.subPois || [];
  const entrance = {
    id: `${spot.id}_sub_eingang`,
    name: `${spot.name} · Haupteingang`,
    lat,
    lng,
    radius_m: 10,
    fact_details: `GPS-Eingang (${source}).`,
    tags: ['sub_poi', 'eingang', 'gps_entrance', 'nav_target', 'sourced_osm'],
  };
  spot.sub_pois = [
    entrance,
    ...subs.filter((s) => !String(s.id || '').includes('eingang')),
  ];
}

function applyRing(pack, id, ring, source, radiusM) {
  const spot = pack.spots.find((s) => s.id === id);
  const trigger = pack.trigger_points.find((t) => t.id === id);
  if (!spot) {
    console.log('MISSING', id);
    return;
  }
  const pts = toSpot(ring);
  const c = centroid(pts);
  spot.polygonCoordinates = pts;
  delete spot.polygonRings;
  setEntrance(spot, c.lat, c.lng, source);
  if (trigger) {
    trigger.lat = c.lat;
    trigger.lng = c.lng;
    trigger.radius_m = radiusM;
    trigger.polygon = toTrig(ring);
  }
  console.log(
    'OK',
    id,
    spot.name,
    `@${c.lat.toFixed(6)},${c.lng.toFixed(6)}`,
    source,
  );
}

function main() {
  const dry = hasFlag('dry');
  const pack = loadPack('prisdorf');
  if (!pack) throw new Error('prisdorf pack missing');

  promoteStory(pack.spots.find((s) => s.id === 'prisdorf_tsv_sportgelände'));
  promoteStory(
    pack.trigger_points.find((t) => t.id === 'prisdorf_tsv_sportgelände'),
  );
  promoteStory(pack.spots.find((s) => s.id === 'prisdorf_freiwillige_feuerwehr'));
  promoteStory(
    pack.trigger_points.find((t) => t.id === 'prisdorf_freiwillige_feuerwehr'),
  );
  promoteStory(
    pack.spots.find((s) => s.id === 'prisdorf_zur_schwalbe_geschichte'),
  );
  promoteStory(
    pack.trigger_points.find((t) => t.id === 'prisdorf_zur_schwalbe_geschichte'),
  );

  for (const id of LOCAL_STORY_NO_TOURISTIC) {
    stripTouristic(pack.spots.find((s) => s.id === id));
    stripTouristic(pack.trigger_points.find((t) => t.id === id));
  }

  const kita = pack.spots.find(
    (s) => s.id === 'prisdorf_alte_schule_lütte_prisdörper',
  );
  if (kita) {
    kita.name = 'Kindergarten Lütte Prisdörper';
    promoteStory(kita);
  }
  const kitaT = pack.trigger_points.find(
    (t) => t.id === 'prisdorf_alte_schule_lütte_prisdörper',
  );
  if (kitaT) {
    kitaT.name = 'Kindergarten Lütte Prisdörper';
    promoteStory(kitaT);
  }

  applyRing(
    pack,
    'prisdorf_tcp_tennis',
    TCP_TENNIS,
    'OSM way 25307201 pitch sport=tennis',
    18,
  );
  applyRing(
    pack,
    'prisdorf_tsv_sportgelände',
    TSV_GROUNDS,
    'OSM way 120302495 sports_centre TSV',
    28,
  );
  applyRing(
    pack,
    'prisdorf_freiwillige_feuerwehr',
    FEUERWEHR,
    'OSM way 80253965 Feuerwache',
    22,
  );

  const trail = pack.spots.find((s) => s.id === 'prisdorf_naturlehrpfad_liether_moor');
  if (trail) {
    const c =
      centroid(trail.polygonCoordinates) || { lat: 53.72257, lng: 9.69656 };
    applyRing(
      pack,
      'prisdorf_naturlehrpfad_liether_moor',
      pinHex(c.lat, c.lng, 14),
      'Pfad-Pin (kein Gebäudeumriss)',
      16,
    );
  }

  if (!dry) {
    savePack(pack);
    console.log('saved', pack.city_id, 'v' + pack.data_version);
  } else {
    console.log('dry-run');
  }
}

main();
