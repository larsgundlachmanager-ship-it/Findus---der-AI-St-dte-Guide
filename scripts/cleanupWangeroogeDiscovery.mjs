#!/usr/bin/env node
/**
 * Cleanup Wangerooge discovery noise + force-add Historische Uhr & Tennis.
 * Then ready for upload (v13 stays if already 13, else bump).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCityPack } from './geo/validatePack.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACK = path.join(ROOT, 'data/staedte/wangerooge.json');
const INDEX = path.join(ROOT, 'data/staedte/index.json');
const REPORT = path.join(
  ROOT,
  'data/staedte/wangerooge_places_discovery_report.json',
);

const pack = JSON.parse(fs.readFileSync(PACK, 'utf8'));
const discovery = JSON.parse(fs.readFileSync(REPORT, 'utf8'));
const prio = discovery.priorityHits || {};

const NOISE =
  /ferienhaus|ferienvilla|ferienwohnung|pension|gästehaus|gastehaus|haus oliver|haus warnecke|haus kapitän|haus am steingarten|beachhouse|harleriff|charlotte 48|jadedrache|zerhusen|anna düne|upstalsboom|wohnungen? |apartment|belegstelle für bienen|haustechnik|biomaris shop|ihna siemens|nordseeheil|privatzimmer/i;

const KEEP_ALWAYS = new Set(
  (discovery.addedList || [])
    .filter((a) => a.storyKey)
    .map((a) => a.id)
    .concat([
      'wangerooge_historische_uhr_pudding_uhr',
      'wangerooge_wangerooger_tennis_club_e_v',
    ]),
);

function offset(lat, lng, northM, eastM) {
  const dLat = northM / 111320;
  const dLng = eastM / (111320 * Math.cos((lat * Math.PI) / 180));
  return { lat: +(lat + dLat).toFixed(7), lng: +(lng + dLng).toFixed(7) };
}

function boxPolygon(lat, lng, halfM) {
  const a = offset(lat, lng, -halfM, -halfM);
  const b = offset(lat, lng, -halfM, halfM);
  const c = offset(lat, lng, halfM, halfM);
  const d = offset(lat, lng, halfM, -halfM);
  return [
    { latitude: a.lat, longitude: a.lng },
    { latitude: b.lat, longitude: b.lng },
    { latitude: c.lat, longitude: c.lng },
    { latitude: d.lat, longitude: d.lng },
    { latitude: a.lat, longitude: a.lng },
  ];
}

function faqs(name, hook, history, now) {
  const pairs = [
    [`Was ist die ${name}?`, hook],
    [`Welche Geschichte hat ${name}?`, history],
    [`Was ist hier heute wichtig?`, now],
    [`Warum kurz stehen bleiben?`, hook],
    [`Gibt es einen historischen Bezug?`, history],
    [`Ist das typisch Wangerooge?`, `Ja. ${hook}`],
    [`Worauf achten?`, 'Öffentliche Wege nutzen, Absperrungen und Naturschutz beachten.'],
    [`Lohnt ein Foto?`, 'Ja — guter Orientierungs- und Fotomoment.'],
    [`Wie weiter?`, 'GPS führt dich zu den nächsten Spots (Promenade, Strand, Dorf).'],
    [`Kann Findus mehr erzählen?`, `${history} ${now}`.slice(0, 320)],
  ];
  return pairs.map(([q, a]) => ({
    text: `User-Frage: ${q} Antwort: ${a}`,
    tags: ['faq', 'detail', 'user_question', 'rueckfrage'],
  }));
}

function makeSpot({ id, name, lat, lng, category, district, hook, history, now, tags }) {
  const approach1 = offset(lat, lng, -40, 0);
  const approach2 = offset(lat, lng, 0, -22);
  const spot = {
    id,
    name,
    district,
    category,
    tags: [...new Set([...(tags || []), category, 'google_places', 'faq', 'must_have'])],
    bullets: [hook, history.slice(0, 280), now.slice(0, 220)],
    facts: {
      origin: history,
      architecture: hook,
      now,
      tags: tags || [category],
    },
    polygonCoordinates: boxPolygon(lat, lng, category === 'natur' ? 36 : 18),
    approach_triggers: [
      {
        id: `${id}_approach_far`,
        lat: approach1.lat,
        lng: approach1.lng,
        radius_m: 26,
        teaser_text: hook,
        condition_rule: 'always',
      },
      {
        id: `${id}_approach_near`,
        lat: approach2.lat,
        lng: approach2.lng,
        radius_m: 12,
        teaser_text: now.slice(0, 200),
        condition_rule: 'always',
      },
    ],
    sub_pois: [],
  };
  const tp = {
    id,
    name,
    trigger_type: 'area',
    radius_m: 28,
    special_radius_m: 8,
    general_info: hook,
    deep_data_pool: [
      { text: `Fast Hook: ${hook}`, tags: ['hook', 'fast_hook', 'kurz'] },
      { text: `Geschichte: ${history}`, tags: ['geschichte', 'erzaehlung'] },
      { text: `Heute / Aktuell: ${now}`, tags: ['heute', 'live', 'aktuelles'] },
      ...faqs(name, hook, history, now),
    ],
    cascading_triggers: [],
    lat,
    lng,
    trigger_kind: 'area',
    polygon: spot.polygonCoordinates,
  };
  return { spot, tp };
}

// Remove noise spots (not in KEEP_ALWAYS)
const before = pack.spots.length;
const removeIds = new Set();
for (const s of pack.spots) {
  if (KEEP_ALWAYS.has(s.id)) continue;
  // only remove if looks like lodging/noise AND was likely from latest discovery
  if (NOISE.test(s.name) || NOISE.test(s.id)) {
    // protect known core if somehow matched
    if (
      /pudding|leuchtturm|westturm|bahnhof|rosenhaus|harlesiel|hauptstrand|nationalpark/i.test(
        s.id,
      )
    ) {
      continue;
    }
    removeIds.add(s.id);
  }
}

pack.spots = pack.spots.filter((s) => !removeIds.has(s.id));
pack.trigger_points = pack.trigger_points.filter((t) => !removeIds.has(t.id));

// Force Historische Uhr
if (!pack.spots.some((s) => /uhr/i.test(s.name))) {
  const hit = prio.historische_uhr;
  const lat = hit?.lat ?? 53.7934687;
  const lng = hit?.lng ?? 7.9000728;
  const { spot, tp } = makeSpot({
    id: 'wangerooge_historische_uhr_pudding_uhr',
    name: 'Historische Uhr / Pudding-Uhr',
    lat,
    lng,
    category: 'denkmal',
    district: 'Nord',
    hook: 'An der Promenade tickt die historische Pudding-Uhr — Treffpunkt, Orientierungsanker und Startpunkt für Strandbuggys.',
    history:
      'Die Uhr an der Strandpromenade beim Café Pudding ist ein klassischer Insel-Treffpunkt. Lokal gilt die „Pudding-Uhr“ als Orientierungs- und Wartemarkierung am Übergang Zedeliusstraße / Obere Strandpromenade.',
    now: 'Hier starten oft Spaziergänge und die kostenfreien Strandbuggys (Ballonreifen, solar) laut Kurverwaltung. Ideal zum Treffen, Warten und Fotografieren.',
    tags: ['denkmal', 'orientierung', 'promenade', 'must_have'],
  });
  pack.spots.push(spot);
  pack.trigger_points.push(tp);
  console.log('[force-add]', spot.name);
}

// Force Tennis
if (!pack.spots.some((s) => /tennis/i.test(s.name))) {
  const hit = prio.tennis;
  const lat = hit?.lat ?? 53.791911;
  const lng = hit?.lng ?? 7.893693;
  const { spot, tp } = makeSpot({
    id: 'wangerooge_wangerooger_tennis_club_e_v',
    name: 'Wangerooger Tennis Club e. V.',
    lat,
    lng,
    category: 'sport',
    district: 'Dorf',
    hook: 'Der Wangerooger Tennis Club bringt Sport auf die autofreie Insel — Plätze mit Inselklima.',
    history:
      'Lokaler Tennisverein als Teil der Sportinfrastruktur neben Golfplatz, Oase und Radfahren auf Wangerooge.',
    now: 'Platzbuchung und Öffnungszeiten vor Ort / beim Verein klären. Gäste oft willkommen — Rücksicht auf laufende Matches.',
    tags: ['sport', 'tennis'],
  });
  pack.spots.push(spot);
  pack.trigger_points.push(tp);
  console.log('[force-add]', spot.name);
}

// Enrich Neuer Leuchtturm coords from Google if drifted
{
  const spot = pack.spots.find((s) => s.id === 'wangerooge_neuer_leuchtturm_wangerooge');
  const tp = pack.trigger_points.find(
    (t) => t.id === 'wangerooge_neuer_leuchtturm_wangerooge',
  );
  const hit = prio.neuer_leuchtturm;
  if (spot && tp && hit) {
    tp.lat = hit.lat;
    tp.lng = hit.lng;
    spot.polygonCoordinates = boxPolygon(hit.lat, hit.lng, 24);
    tp.polygon = spot.polygonCoordinates;
  }
}

pack.data_version = 13;
pack.updated_at = new Date().toISOString().slice(0, 10);

const validation = validateCityPack(pack);
if (!validation.ok) {
  console.error(validation);
  process.exit(1);
}

fs.writeFileSync(PACK, JSON.stringify(pack, null, 2));
const index = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
const city = (index.available_cities || []).find((c) => c.id === 'wangerooge');
if (city) city.data_version = 13;
index.last_global_update = new Date().toISOString();
fs.writeFileSync(INDEX, JSON.stringify(index, null, 2));

const userChecks = [
  'Historische Uhr',
  'Aussichtsplatz',
  'Neuer Leuchtturm',
  'Deckwerk',
  'Westlagune',
  'Hafeneinfahrt',
  'Nationalpark',
  'Flugplatz',
  'Jade-Ost',
  'Jever',
  'Hauptstrand',
  'Tennis',
  'Tuunpad',
  'Dorfplatz',
  'Lokschuppen',
  'Wiegehäuschen',
];
const status = {};
for (const label of userChecks) {
  const re = new RegExp(
    label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/-/g, '[- ]?'),
    'i',
  );
  status[label] = pack.spots
    .filter((s) => re.test(s.name) || re.test(s.id))
    .map((s) => s.name);
}

console.log(
  JSON.stringify(
    {
      removed: [...removeIds],
      removedCount: removeIds.size,
      spotsBefore: before,
      spotsAfter: pack.spots.length,
      userListStatus: status,
      validation,
    },
    null,
    2,
  ),
);
