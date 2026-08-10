#!/usr/bin/env node
/**
 * Discover Wangerooge places from Google + user Maps list,
 * merge missing spots into pack with hook/history/now/approaches,
 * bump version and optionally upload.
 *
 * Usage:
 *   node scripts/discoverAndMergeWangeroogePlaces.mjs
 *   node scripts/discoverAndMergeWangeroogePlaces.mjs --upload
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCityPack } from './geo/validatePack.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACK_PATH = path.join(ROOT, 'data/staedte/wangerooge.json');
const INDEX_PATH = path.join(ROOT, 'data/staedte/index.json');
const REPORT_PATH = path.join(
  ROOT,
  'data/staedte/wangerooge_places_discovery_report.json',
);
const VERSION = 13;
const DO_UPLOAD = process.argv.includes('--upload');

function loadEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnv();
const KEY = process.env.GOOGLE_MAPS_API_KEY || '';
if (!KEY || KEY.includes('your-')) {
  console.error('Missing GOOGLE_MAPS_API_KEY');
  process.exit(1);
}

const ISLAND = { lat: 53.7902, lng: 7.8995 };
const BOUNDS = {
  minLat: 53.768,
  maxLat: 53.805,
  minLng: 7.84,
  maxLng: 7.98,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function inBounds(lat, lng) {
  return (
    lat >= BOUNDS.minLat &&
    lat <= BOUNDS.maxLat &&
    lng >= BOUNDS.minLng &&
    lng <= BOUNDS.maxLng
  );
}

function distM(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

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

function slugify(s) {
  return (
    'wangerooge_' +
    String(s)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 52)
  );
}

async function gjson(url) {
  const res = await fetch(url);
  const data = await res.json();
  if (data.status && !['OK', 'ZERO_RESULTS'].includes(data.status)) {
    throw new Error(`${data.status}: ${data.error_message || ''}`);
  }
  return data;
}

async function textSearch(query, location = ISLAND, radius = 5500) {
  const u = new URL('https://maps.googleapis.com/maps/api/place/textsearch/json');
  u.searchParams.set('query', query);
  u.searchParams.set('location', `${location.lat},${location.lng}`);
  u.searchParams.set('radius', String(radius));
  u.searchParams.set('language', 'de');
  u.searchParams.set('region', 'de');
  u.searchParams.set('key', KEY);
  await sleep(180);
  return gjson(u.toString());
}

async function nearby(type, location = ISLAND, radius = 5000) {
  const u = new URL('https://maps.googleapis.com/maps/api/place/nearbysearch/json');
  u.searchParams.set('location', `${location.lat},${location.lng}`);
  u.searchParams.set('radius', String(radius));
  u.searchParams.set('type', type);
  u.searchParams.set('language', 'de');
  u.searchParams.set('key', KEY);
  await sleep(180);
  return gjson(u.toString());
}

async function placeDetails(placeId) {
  const u = new URL('https://maps.googleapis.com/maps/api/place/details/json');
  u.searchParams.set('place_id', placeId);
  u.searchParams.set(
    'fields',
    'name,formatted_address,geometry,types,rating,user_ratings_total,opening_hours,website,editorial_summary,url',
  );
  u.searchParams.set('language', 'de');
  u.searchParams.set('key', KEY);
  await sleep(140);
  return gjson(u.toString());
}

/** User-priority named places (from Maps links + labels). */
const PRIORITY_QUERIES = [
  { key: 'historische_uhr', queries: ['Historische Uhr Wangerooge', 'Pudding-Uhr Wangerooge', 'Uhr Café Pudding Wangerooge'] },
  { key: 'aussichtsplatz', queries: ['Aussichtsplatz Wangerooge', 'Aussichtspunkt Wangerooge'] },
  { key: 'neuer_leuchtturm', queries: ['Neuer Leuchtturm Wangerooge'] },
  { key: 'deckwerk', queries: ['Deckwerk Wangerooge'] },
  { key: 'westlagune', queries: ['Westlagune Wangerooge'] },
  { key: 'hafeneinfahrt_backboard', queries: ['Hafeneinfahrt Backboard Wangerooge', 'Hafeneinfahrt Wangerooge'] },
  { key: 'nationalpark_haus', queries: ['Nationalpark-Haus Wangerooge', 'Rosenhaus Wangerooge'] },
  { key: 'flugplatz', queries: ['Flugplatz Wangerooge EDWG', 'Flugplatz Wangerooge'] },
  { key: 'bunker_jade_ost', queries: ['Bunkerreste Geschützstellung Jade Ost Batterie Wangerooge', 'Jade Ost Batterie Wangerooge', 'Bunker Jade Ost Wangerooge'] },
  { key: 'jever_aussicht', queries: ['Jever-Aussichtsplattform Wangerooge', 'Jever Aussichtsplattform Wangerooge'] },
  { key: 'strand', queries: ['Strand Wangerooge', 'Hauptstrand Wangerooge'] },
  { key: 'tennis', queries: ['Wangerooger Tennis Club', 'Tennis Club Wangerooge'] },
  { key: 'tuunpad', queries: ['Tuunpad Wangerooge'] },
  { key: 'dorfplatz', queries: ['Dorfplatz Wangerooge'] },
  { key: 'lokschuppen', queries: ['Lokschuppen Wangerooge'] },
  { key: 'wiegehaeuschen', queries: ['Altes Wiegehäuschen Wangerooge', 'Wiegehäuschen Wangerooge'] },
];

const DISCOVERY_QUERIES = [
  'Sehenswürdigkeiten Wangerooge',
  'Aussichtspunkt Wangerooge',
  'Museum Wangerooge',
  'Denkmal Wangerooge',
  'Wanderweg Wangerooge',
  'Strand Wangerooge',
  'Touristenattraktion Wangerooge',
  'Park Wangerooge',
  'Kirche Wangerooge',
  'Leuchtturm Wangerooge',
  'Bunker Wangerooge',
  'Sportplatz Wangerooge',
  'Spielplatz Wangerooge',
  'Hafen Wangerooge',
  'Düne Wangerooge',
  'Promenade Wangerooge',
  'Watt Wangerooge',
  'Aussichtsplattform Wangerooge',
];

const NEARBY_TYPES = [
  'tourist_attraction',
  'museum',
  'park',
  'church',
  'point_of_interest',
  'natural_feature',
  'airport',
  'stadium',
];

/** Curated story overrides for known missing landmarks. */
const STORY = {
  historische_uhr: {
    name: 'Historische Uhr / Pudding-Uhr',
    category: 'denkmal',
    hook: 'An der Promenade tickt die historische Pudding-Uhr — Treffpunkt, Orientierungsanker und Startpunkt für Strandbuggys.',
    history:
      'Die Uhr an der Strandpromenade bei Café Pudding ist ein klassischer Insel-Treffpunkt. Lokal gilt die „Pudding-Uhr“ als Treffpunkt und Orientierungspunkt am Übergang Zedeliusstraße / Obere Strandpromenade.',
    now: 'Hier starten oft Spaziergänge und die kostenfreien Strandbuggys (Ballonreifen, solar) laut Kurverwaltung. Ideal zum Warten, Orientieren und Fotografieren.',
    tags: ['denkmal', 'must_have', 'orientierung', 'promenade', 'google_places'],
  },
  deckwerk: {
    name: 'Deckwerk Wangerooge',
    category: 'natur',
    hook: 'Das Deckwerk ist die steinerne Panzerung der Insel gegen die Nordsee — Küstenschutz zum Anfassen.',
    history:
      'Deckwerke und Steindeiche schützen Wangerooge vor Sturmfluten und Uferabbruch. Sie gehören zur modernen Antwort auf die gleiche Gefahr, die 1854/55 das Westdorf zerstörte.',
    now: 'Entlang des Küstenwegs sichtbar: massive Steinpackungen und Uferbefestigung. Fußwege beachten, nicht auf ungesicherte Bereiche steigen.',
    tags: ['natur', 'kuestenschutz', 'geschichte', 'google_places', 'must_have'],
  },
  westlagune: {
    name: 'Westlagune Wangerooge',
    category: 'natur',
    hook: 'Im Westen öffnet sich die Westlagune — Watt, Wasserflächen und Vogelwelt hinter den Dünen.',
    history:
      'Die Westlagune ist Teil der dynamischen Inselmorphologie: Dünen, Priel und Watt verändern sich mit Tide und Sturm. Naturschutz hat Vorrang vor freiem Betreten.',
    now: 'Beobachtung vom Weg aus — Dünen abseits der Pfade nicht betreten (Erosion). Ideal für Vogelbeobachtung und ruhige Westspaziergänge.',
    tags: ['natur', 'watt', 'unesco', 'google_places', 'must_have'],
  },
  hafeneinfahrt_backboard: {
    name: 'Hafeneinfahrt Backbord Wangerooge',
    category: 'hafen',
    hook: 'An der Hafeneinfahrt Backbord siehst du, wo Schiffe und Inselbahn die Insel anbinden — Logistik im Blick.',
    history:
      'Der Inselhafen und die Einfahrt sind das maritime Nadelöhr neben dem autofreien Binnenverkehr. Gezeiten und Fahrwasser bestimmen Ankunft und Abfahrt.',
    now: 'Gute Sichtachse auf Hafeneinfahrt und Anlegerbereich. Sicherheit: Absperrungen und Betriebsflächen beachten.',
    tags: ['hafen', 'transport', 'aussicht', 'google_places'],
  },
  flugplatz: {
    name: 'Flugplatz Wangerooge (EDWG)',
    category: 'transport',
    hook: 'Flugplatz Wangerooge EDWG — kleines Flugfeld, das sich mit dem Golfplatz die Inselwestlage teilt.',
    history:
      'Der Inselflugplatz ist eng mit dem Golfclub-Gelände verknüpft: 9-Loch-Golf und Flugbetrieb teilen sich räumlich ein Konzept, das in Deutschland als einzigartig gilt.',
    now: 'Jadehörn / Flugplatzbereich: Flugbetrieb und Golf beachten. Kein freier Zutritt zu Betriebsflächen; Zuschauen nur von öffentlichen Wegen.',
    tags: ['transport', 'flugplatz', 'sport', 'google_places', 'must_have'],
  },
  bunker_jade_ost: {
    name: 'Bunkerreste Jade-Ost-Batterie',
    category: 'denkmal',
    hook: 'In den Dünen im Osten liegen Bunkerreste der ehemaligen Geschützstellung Jade Ost — Kriegsgeschichte im Sand.',
    history:
      'Die Jade-Ost-Batterie gehörte zur Küstenverteidigung im Zweiten Weltkrieg. Reste von Geschützstellungen und Bunkern prägen noch heute Abschnitte der Ostdünen — getrennt vom Café-Pudding-Bunker und vom Hartmannsstand-Mahnmal.',
    now: 'Lost-Place-Charakter: vorsichtig bleiben, Naturschutz und Dünenschutz beachten, nichts betreten was abgesperrt ist. Stilles Gedenken statt Kletterei.',
    tags: ['denkmal', 'geschichte', 'krieg', 'lost_place', 'google_places'],
  },
  jever_aussicht: {
    name: 'Jever-Aussichtsplattform',
    category: 'aussicht',
    hook: 'Die Jever-Aussichtsplattform liefert Höhe über Dünen und Meer — klassischer Foto-Stopp.',
    history:
      'Aussichtsplattformen an der Promenade/Düne sind Teil der touristischen Erschließung des Nordstrandes und ergänzen die Blickachsen von Café Pudding und Promenade.',
    now: 'Kurzer Aufstieg, Rundumblick auf Strand und Meer. Bei Wind vorsichtig; Barrierefreiheit je nach Bauzustand prüfen.',
    tags: ['aussicht', 'must_have', 'promenade', 'google_places'],
  },
  tennis: {
    name: 'Wangerooger Tennis Club e. V.',
    category: 'sport',
    hook: 'Der Wangerooger Tennis Club bringt Sport auf die autofreie Insel — Plätze mit Inselklima.',
    history:
      'Lokaler Tennisverein als Teil der Sportinfrastruktur neben Golf, Schwimmen (Oase) und Radfahren.',
    now: 'Platzbuchung und Öffnungszeiten vor Ort / Verein klären. Gäste oft willkommen — Rücksicht auf laufende Matches.',
    tags: ['sport', 'tennis', 'google_places'],
  },
  tuunpad: {
    name: 'Tuunpad',
    category: 'natur',
    hook: 'Das Tuunpad ist ein typischer Inselweg durch Dünen und Vegetation — Wandern im Kleinen.',
    history:
      '„Tuun“ verweist auf Zäune/Gehege in friesischer Sprache; Pfade wie das Tuunpad erschließen die Insel abseits der Zedeliusstraße.',
    now: 'Wander-/Spazierweg: auf markierten Pfaden bleiben, Dünen nicht abkürzen. Gut für ruhige Runden zwischen Dorf und Natur.',
    tags: ['natur', 'wandern', 'google_places'],
  },
  lokschuppen: {
    name: 'Lokschuppen Wangerooge',
    category: 'bahnhof',
    hook: 'Am Lokschuppen steckt die Technikgeschichte der Inselbahn — Werkstatt und Remise der Schmalspur.',
    history:
      'Die Inselbahn braucht Betriebshof und Lokschuppen für Wartung der Schmalspurfahrzeuge. Zusammen mit dem Dampflok-Denkmal am Alten Leuchtturm erzählt er die Bahn-Geschichte der Insel.',
    now: 'Betriebsgelände — von außen betrachten, nicht betreten. Fotos vom öffentlichen Bereich; Anschluss an Bahnhof/Anleger-Logistik.',
    tags: ['bahnhof', 'transport', 'geschichte', 'google_places'],
  },
  wiegehaeuschen: {
    name: 'Altes Wiegehäuschen',
    category: 'denkmal',
    hook: 'Das alte Wiegehäuschen erinnert an Zeiten, in denen Fracht und Ernte auf der Insel gewogen und abgefertigt wurden.',
    history:
      'Wiegehäuschen gehörten zur Güter- und Marktinfrastruktur kleiner Häfen und Bahnknoten. Auf Wangerooge ist das Relikt ein stiller Zeuge der Inselwirtschaft vor dem heutigen Tourismus.',
    now: 'Kleines historisches Gebäude — von außen betrachten, Infotafel falls vorhanden lesen. Ideal als kurzer Story-Stopp zwischen Bahnhof und Dorf.',
    tags: ['denkmal', 'geschichte', 'google_places'],
  },
  aussichtsplatz: {
    name: 'Aussichtsplatz Wangerooge',
    category: 'aussicht',
    hook: 'Ein ausgewiesener Aussichtsplatz — hier lohnt der Stopp für Meer, Dünen und Dorfpanorama.',
    history:
      'Aussichtspunkte sind Teil der touristischen und landschaftlichen Erschließung der Insel seit dem Aufschwung als Nordseeheilbad.',
    now: 'Kurzer Stopp, Foto, Orientierung. Wind und Geländer beachten.',
    tags: ['aussicht', 'google_places', 'must_have'],
  },
};

function classify(types = [], name = '') {
  const t = new Set(types);
  const n = name.toLowerCase();
  if (/uhr|wiegeh|denkmal|bunker|batterie/.test(n)) return 'denkmal';
  if (/aussicht|plattform|leuchtturm|westturm/.test(n)) return 'aussicht';
  if (/strand|lagune|deckwerk|düne|tuun|watt|promenade/.test(n)) return 'natur';
  if (/flugplatz|airport|edwg/.test(n) || t.has('airport')) return 'transport';
  if (/tennis|golf|sport/.test(n)) return 'sport';
  if (/museum|nationalpark|rosenhaus/.test(n) || t.has('museum')) return 'museum';
  if (/kirche/.test(n) || t.has('church')) return 'kirche';
  if (/bahnhof|lokschuppen|hafen|anleger/.test(n)) return 'bahnhof';
  if (t.has('tourist_attraction')) return 'aussicht';
  if (t.has('park') || t.has('natural_feature')) return 'natur';
  return 'ort';
}

function districtOf(lat, lng) {
  if (lng < 7.87) return 'West';
  if (lat > 53.792) return 'Nord';
  if (lng > 7.93) return 'Ost';
  if (lat < 53.78) return 'Hafen';
  return 'Dorf';
}

function normalizeName(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function findExisting(pack, name, lat, lng) {
  const n = normalizeName(name);
  for (const spot of pack.spots) {
    const sn = normalizeName(spot.name);
    if (sn === n || sn.includes(n) || n.includes(sn)) return spot;
    // fuzzy key tokens
    const tokens = n.split(' ').filter((t) => t.length > 3);
    if (tokens.length && tokens.every((t) => sn.includes(t))) return spot;
  }
  // by distance to trigger
  for (const tp of pack.trigger_points || []) {
    if (tp.lat == null || tp.lng == null) continue;
    if (distM({ lat, lng }, { lat: tp.lat, lng: tp.lng }) < 35) {
      const spot = pack.spots.find((s) => s.id === tp.id);
      if (spot) return spot;
    }
  }
  return null;
}

function makeFaqs(name, story) {
  const qs = [
    {
      q: `Was ist hier besonders — ${name}?`,
      a: story.hook,
    },
    {
      q: `Welche Geschichte steckt hinter ${name}?`,
      a: story.history,
    },
    {
      q: `Was kann ich hier heute machen?`,
      a: story.now,
    },
    {
      q: `Warum sollte ich hier kurz stehen bleiben?`,
      a: `${story.hook} ${story.now}`.slice(0, 320),
    },
    {
      q: `Gibt es etwas Historisches zu diesem Ort?`,
      a: story.history,
    },
    {
      q: `Ist das ein typischer Wangerooge-Ort?`,
      a: `Ja — ${name} gehört zu den hyperlokalen Ankern der Insel. ${story.hook}`,
    },
    {
      q: `Worauf muss ich achten?`,
      a: /düne|bunker|flug|hafen|lokschuppen/i.test(name)
        ? 'Absperrungen, Naturschutz und Betriebsflächen beachten — fotografieren vom öffentlichen Weg.'
        : 'Auf markierten Wegen bleiben, Rücksicht auf andere Gäste und Insulaner.',
    },
    {
      q: `Wie hängt das mit der Inselgeschichte zusammen?`,
      a: story.history,
    },
    {
      q: `Lohnt sich ein Foto?`,
      a: /aussicht|leuchtturm|uhr|plattform|strand|lagune|deckwerk/i.test(name)
        ? 'Ja — die Lage ist fotogen. Kurz anhalten, Motiv sichern, weiterlaufen.'
        : 'Wenn die Architektur oder der Kontext dich anspricht — ja, sonst lieber die Story mitnehmen.',
    },
    {
      q: `Wohin weiter von hier?`,
      a: 'Orientier dich an Zedeliusstraße, Promenade, Bahnhof oder West-/Ostachsen — Findus triggert die nächsten Spots automatisch per GPS.',
    },
  ];
  return qs.map(({ q, a }) => ({
    text: `User-Frage: ${q} Antwort: ${a}`,
    tags: ['faq', 'detail', 'user_question', 'rueckfrage', 'tiefenwissen'],
  }));
}

function buildSpotFromPlace(place, storyKey, details) {
  const name = storyKey && STORY[storyKey] ? STORY[storyKey].name : place.name;
  const story =
    (storyKey && STORY[storyKey]) ||
    {
      name,
      category: classify(place.types || details?.types || [], name),
      hook: `${name} ist ein Google-Places-Punkt auf Wangerooge — kurz stehen bleiben lohnt sich.`,
      history:
        details?.editorial_summary?.overview ||
        `${name} ist in der lokalen Topographie der Insel verankert.`,
      now:
        details?.formatted_address
          ? `Adresse: ${details.formatted_address}.`
          : 'Vor Ort Orientierung und aktuelle Hinweise beachten.',
      tags: ['google_places'],
    };

  const lat = details?.geometry?.location?.lat ?? place.lat;
  const lng = details?.geometry?.location?.lng ?? place.lng;
  const category = story.category || classify(place.types || [], name);
  const half =
    category === 'natur' || category === 'aussicht'
      ? 40
      : category === 'denkmal'
        ? 18
        : 22;
  const id = slugify(name);
  const bullets = [
    story.hook,
    story.history.slice(0, 280),
    story.now.slice(0, 220),
  ];
  if (details?.formatted_address) {
    bullets.unshift(`Adresse: ${details.formatted_address}.`);
  }
  if (details?.rating != null) {
    bullets.push(
      `Google-Bewertung: ${details.rating}/5` +
        (details.user_ratings_total
          ? ` (${details.user_ratings_total} Stimmen)`
          : '') +
        '.',
    );
  }

  const approach1 = offset(lat, lng, -45, 0);
  const approach2 = offset(lat, lng, 0, -28);

  const spot = {
    id,
    name,
    district: districtOf(lat, lng),
    category,
    tags: [...new Set([...(story.tags || []), category, 'google_places', 'faq'])],
    bullets: bullets.slice(0, 6),
    facts: {
      origin: story.history,
      architecture: story.hook,
      now: story.now,
      tags: story.tags || [category],
    },
    polygonCoordinates: boxPolygon(lat, lng, half),
    approach_triggers: [
      {
        id: `${id}_approach_far`,
        lat: approach1.lat,
        lng: approach1.lng,
        radius_m: 28,
        teaser_text: story.hook,
        condition_rule: 'always',
      },
      {
        id: `${id}_approach_near`,
        lat: approach2.lat,
        lng: approach2.lng,
        radius_m: 12,
        teaser_text: story.now.slice(0, 220),
        condition_rule: 'always',
      },
    ],
    sub_pois: [],
  };

  const deepPool = [
    {
      text: `Fast Hook: ${story.hook}`,
      tags: ['hook', 'fast_hook', 'kurz'],
    },
    {
      text: `Geschichte: ${story.history}`,
      tags: ['geschichte', 'erzaehlung', 'master_report'],
    },
    {
      text: `Heute / Aktuell: ${story.now}`,
      tags: ['heute', 'live', 'aktuelles'],
    },
    ...makeFaqs(name, story),
  ];
  if (details?.editorial_summary?.overview) {
    deepPool.push({
      text: `Google-Editorial: ${details.editorial_summary.overview}`,
      tags: ['sourced_google', 'detail'],
    });
  }

  const tp = {
    id,
    name,
    trigger_type: 'area',
    radius_m: half + 10,
    special_radius_m: 8,
    general_info: story.hook,
    deep_data_pool: deepPool,
    cascading_triggers: [],
    lat,
    lng,
    trigger_kind: 'area',
    polygon: spot.polygonCoordinates,
  };

  return { spot, tp };
}

function collectResults(data) {
  return (data.results || []).map((r) => ({
    name: r.name,
    lat: r.geometry.location.lat,
    lng: r.geometry.location.lng,
    place_id: r.place_id,
    types: r.types || [],
    addr: r.formatted_address,
    rating: r.rating,
  }));
}

async function main() {
  const pack = JSON.parse(fs.readFileSync(PACK_PATH, 'utf8'));
  const found = new Map(); // place_id -> {place, storyKey?}
  const priorityHits = {};

  // 1) Priority named queries
  for (const item of PRIORITY_QUERIES) {
    let best = null;
    for (const q of item.queries) {
      const data = await textSearch(q);
      const list = collectResults(data).filter((p) => inBounds(p.lat, p.lng));
      if (list.length) {
        best = list[0];
        break;
      }
    }
    priorityHits[item.key] = best
      ? { name: best.name, lat: best.lat, lng: best.lng, place_id: best.place_id }
      : null;
    if (best) {
      found.set(best.place_id, { place: best, storyKey: item.key });
    }
    console.log(
      `[prio] ${item.key}:`,
      best ? `${best.name} (${best.lat},${best.lng})` : 'NOT FOUND',
    );
  }

  // 2) Broad discovery
  for (const q of DISCOVERY_QUERIES) {
    try {
      const data = await textSearch(q);
      for (const p of collectResults(data)) {
        if (!inBounds(p.lat, p.lng)) continue;
        if (!found.has(p.place_id)) found.set(p.place_id, { place: p, storyKey: null });
      }
    } catch (e) {
      console.warn('[discover]', q, e.message);
    }
  }

  for (const type of NEARBY_TYPES) {
    try {
      const data = await nearby(type);
      for (const p of collectResults(data)) {
        if (!inBounds(p.lat, p.lng)) continue;
        if (!found.has(p.place_id)) found.set(p.place_id, { place: p, storyKey: null });
      }
      // pagination
      let token = data.next_page_token;
      if (token) {
        await sleep(2000);
        const u = new URL(
          'https://maps.googleapis.com/maps/api/place/nearbysearch/json',
        );
        u.searchParams.set('pagetoken', token);
        u.searchParams.set('key', KEY);
        const page2 = await gjson(u.toString());
        for (const p of collectResults(page2)) {
          if (!inBounds(p.lat, p.lng)) continue;
          if (!found.has(p.place_id))
            found.set(p.place_id, { place: p, storyKey: null });
        }
      }
    } catch (e) {
      console.warn('[nearby]', type, e.message);
    }
  }

  // Filter noise: lodging/food already dense — still allow tourist_attraction etc.
  const SKIP_NAME =
    /apartment|ferienwohnung|privatzimmer|airbnb|booking|spar|edeka|rewe|tankstelle/i;

  const candidates = [...found.values()].filter(
    ({ place }) => !SKIP_NAME.test(place.name),
  );

  const already = [];
  const added = [];
  const enrichedExisting = [];

  for (const { place, storyKey } of candidates) {
    const existing = findExisting(pack, place.name, place.lat, place.lng);
    if (existing) {
      already.push({ name: place.name, matched: existing.id, storyKey });
      // If priority story exists and spot is thin, enrich facts
      if (storyKey && STORY[storyKey]) {
        const tp = pack.trigger_points.find((t) => t.id === existing.id);
        const story = STORY[storyKey];
        if (tp) {
          const hasHook = (tp.deep_data_pool || []).some((e) =>
            /Fast Hook|Geschichte:/i.test(e.text || ''),
          );
          if (!hasHook) {
            tp.deep_data_pool = [
              {
                text: `Fast Hook: ${story.hook}`,
                tags: ['hook', 'fast_hook', 'kurz'],
              },
              {
                text: `Geschichte: ${story.history}`,
                tags: ['geschichte', 'erzaehlung'],
              },
              {
                text: `Heute / Aktuell: ${story.now}`,
                tags: ['heute', 'live', 'aktuelles'],
              },
              ...makeFaqs(existing.name, story),
              ...(tp.deep_data_pool || []),
            ];
            enrichedExisting.push(existing.id);
          }
        }
        // rename historique uhr if matched wrong
        if (storyKey === 'historische_uhr' && !/uhr/i.test(existing.name)) {
          // don't rename major spots; only add new
        }
      }
      continue;
    }

    let details = null;
    try {
      const d = await placeDetails(place.place_id);
      details = d.result || null;
    } catch (e) {
      console.warn('[details]', place.name, e.message);
    }

    const { spot, tp } = buildSpotFromPlace(place, storyKey, details);
    // ensure unique id
    let id = spot.id;
    let n = 2;
    while (pack.spots.some((s) => s.id === id)) {
      id = `${spot.id}_${n++}`;
    }
    spot.id = id;
    tp.id = id;
    for (const a of spot.approach_triggers || []) {
      a.id = a.id.replace(spot.id.replace(/_\d+$/, ''), id);
      if (!a.id.startsWith(id)) a.id = `${id}_approach_${a.radius_m}`;
    }

    pack.spots.push(spot);
    pack.trigger_points.push(tp);
    added.push({ id, name: spot.name, storyKey, lat: tp.lat, lng: tp.lng });
    console.log('[add]', spot.name);
  }

  // Force-add curated priority stories that Google didn't resolve
  for (const [key, story] of Object.entries(STORY)) {
    const hit = priorityHits[key];
    const existsByName = pack.spots.some(
      (s) => normalizeName(s.name) === normalizeName(story.name),
    );
    if (existsByName) continue;
    if (hit) continue; // should have been added via place_id path
    // If Google failed entirely, skip unless we have known coords from nearby similar
    console.log('[skip-no-coords]', key, story.name);
  }

  // Special: if historische_uhr not found as own spot, attach to pudding OR create near pudding
  if (
    !pack.spots.some((s) => /uhr/i.test(s.name)) &&
    priorityHits.historische_uhr == null
  ) {
    const pudding = pack.spots.find((s) => s.id === 'wangerooge_cafe_pudding');
    const puddingTp = pack.trigger_points.find(
      (t) => t.id === 'wangerooge_cafe_pudding',
    );
    if (pudding && puddingTp) {
      const story = STORY.historische_uhr;
      // create dedicated spot offset slightly from pudding
      const poly = pudding.polygonCoordinates;
      const lat =
        poly.reduce((s, p) => s + p.latitude, 0) / poly.length + 0.00012;
      const lng =
        poly.reduce((s, p) => s + p.longitude, 0) / poly.length - 0.00008;
      const { spot, tp } = buildSpotFromPlace(
        {
          name: story.name,
          lat,
          lng,
          types: ['tourist_attraction', 'point_of_interest'],
        },
        'historische_uhr',
        {
          geometry: { location: { lat, lng } },
          formatted_address:
            'Obere Strandpromenade / Zedeliusstraße, 26486 Wangerooge',
        },
      );
      pack.spots.push(spot);
      pack.trigger_points.push(tp);
      added.push({
        id: spot.id,
        name: spot.name,
        storyKey: 'historische_uhr',
        lat,
        lng,
        note: 'synthetic near Café Pudding (Google name miss)',
      });
      // also link from pudding
      puddingTp.deep_data_pool = puddingTp.deep_data_pool || [];
      puddingTp.deep_data_pool.unshift({
        text: `Nebenan: Historische Pudding-Uhr — Treffpunkt und Start der Strandbuggys. Eigener Spot: ${spot.name}.`,
        tags: ['orientierung', 'hook', 'uhr'],
      });
      console.log('[add-synthetic]', spot.name);
    }
  }

  pack.data_version = VERSION;
  pack.updated_at = new Date().toISOString().slice(0, 10);

  const validation = validateCityPack(pack);
  if (!validation.ok) {
    console.error(validation);
    process.exit(1);
  }

  fs.writeFileSync(PACK_PATH, JSON.stringify(pack, null, 2));

  const index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
  const city = (index.available_cities || []).find((c) => c.id === 'wangerooge');
  if (city) city.data_version = VERSION;
  index.last_global_update = new Date().toISOString();
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2));

  const report = {
    data_version: VERSION,
    priorityHits,
    discovered: candidates.length,
    alreadyMatched: already.length,
    added: added.length,
    enrichedExisting,
    addedList: added,
    alreadySample: already.slice(0, 40),
    validation,
  };
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  if (DO_UPLOAD) {
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync(
      process.execPath,
      [
        path.join(ROOT, 'scripts/uploadCityPack.mjs'),
        'data/staedte/wangerooge.json',
        '--index',
      ],
      { cwd: ROOT, encoding: 'utf8' },
    );
    console.log(r.stdout || '');
    console.error(r.stderr || '');
    if (r.status !== 0) process.exit(r.status || 1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
