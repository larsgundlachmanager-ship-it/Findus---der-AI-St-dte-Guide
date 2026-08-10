#!/usr/bin/env node
/**
 * Rebuild Wangerooge pilot with Nominatim-verified coordinates only.
 * Places without a solid OSM hit are dropped or marked needs_field_check.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boxPolygon } from './geo/osm.mjs';
import { validateCityPack } from './geo/validatePack.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(__dirname, '..', 'data', 'staedte', 'wangerooge.json');

/** Verified via Nominatim 2026-07-23 (OSM). Google Maps blocked by consent wall (no API key). */
const PLACES = [
  {
    id: 'wangerooge_anleger',
    name: 'Fähranleger Wangerooge',
    category: 'transport',
    district: 'Hafen',
    lat: 53.783225,
    lng: 7.943805,
    half: 45,
    source: 'Nominatim way/171929493 Alte Fähranleger',
    bullets: [
      'Der (alte) Fähranleger an der Siedlerstraße ist die Ankunftsschwelle der Insel.',
      'Von hier aus geht es weiter mit der Inselbahn oder zu Fuß Richtung Dorf.',
    ],
    teaser:
      'Du stehst nahe am Anleger: Gleich voraus liegt die Ankunftszone Wangerooges.',
    general:
      'Am Anleger merkst du sofort: Autos bleiben draußen, der Takt der Insel beginnt.',
    approachOffsetM: 45,
    approachBearing: 'south',
  },
  {
    id: 'wangerooge_inselbahnhof',
    name: 'Bahnhof Wangerooge (Inselbahn)',
    category: 'bahnhof',
    district: 'Dorf',
    lat: 53.787822,
    lng: 7.899471,
    half: 35,
    source: 'Nominatim railway=station Wangerooge',
    bullets: [
      'Der Bahnhof Wangerooge ist der Inselbahn-Halt im Ort.',
      'Von hier aus sind Dorfplatz, Leuchtturm und Strandpromenade fußläufig.',
    ],
    teaser:
      'Richtung Bahnhofstraße: Der Inselbahn-Halt Wangerooge liegt direkt voraus.',
    general:
      'Am Bahnhof bist du im Ortskern-Takt: kurze Wege, kein Autolärm.',
    subs: [
      {
        id: 'wangerooge_inselbahnhof_steig',
        name: 'Bahnsteig Inselbahn',
        dLat: 0.00005,
        dLng: 0.00008,
        detail:
          'Siehst du die schmalen Gleise der Inselbahn? Hier fühlt sich Ankommen noch wie ein kleines Abenteuer an.',
      },
    ],
  },
  {
    id: 'wangerooge_leuchtturm',
    name: 'Alter Leuchtturm Wangerooge',
    category: 'architektur',
    district: 'Dorf',
    lat: 53.788797,
    lng: 7.899223,
    half: 22,
    source: 'Nominatim way/135321794 Inselmuseum Alter Leuchtturm, Zedeliusstraße 3',
    bullets: [
      'Der alte Leuchtturm an der Zedeliusstraße beherbergt das Inselmuseum.',
      'Er ist eines der zentralen Orientierungszeichen im Dorf.',
    ],
    teaser:
      'Schau nach dem Turm an der Zedeliusstraße: Der alte Leuchtturm steuert dich optisch durch den Ort.',
    general:
      'Der alte Leuchtturm ist mehr als Foto-Motiv — er ist der Kompass im Insel-Stadtbild.',
  },
  {
    id: 'wangerooge_westturm',
    name: 'Westturm Wangerooge',
    category: 'kirche',
    district: 'West',
    lat: 53.784679,
    lng: 7.857532,
    half: 28,
    source: 'Nominatim way/59869587 Westturm, Im Westen 46',
    tags: ['kirche', 'must_have', 'aussicht', 'promi'],
    famous:
      'Der Westturm diente lange als Seezeichen für Lotsen und Küstenwachen.',
    bullets: [
      'Der Westturm am Westende ist ein Must-have der Insel und diente lange als Seezeichen.',
      'Die Lage weit westlich vom Dorf macht den Weg dorthin selbst zur Geschichte.',
    ],
    teaser:
      'Wenn du Richtung Westen denkst: Der Westturm steht klar sichtbar — lohnt den Weg.',
    general:
      'Hier am Westturm spürst du die Weite der Nordsee.',
  },
  {
    id: 'wangerooge_nikolaikirche',
    name: 'Nikolai-Kirche Wangerooge',
    category: 'kirche',
    district: 'Dorf',
    lat: 53.788783,
    lng: 7.900322,
    half: 22,
    source: 'Nominatim way/30127198 Nikolai-Kirche, Dorfplatz 34',
    tags: ['kirche', 'must_have'],
    bullets: [
      'Die Nikolai-Kirche steht am Dorfplatz und ist die zentrale Kirche der Insel.',
      'Adresse laut OSM: Dorfplatz 34.',
    ],
    teaser:
      'Am Dorfplatz: Die Nikolai-Kirche ist der sakrale Anker — nur rein, wenn Kirchen dich interessieren.',
    general: 'Die Nikolai-Kirche hält den historischen Takt am Dorfplatz.',
  },
  {
    id: 'wangerooge_dorfplatz',
    name: 'Dorfplatz Wangerooge',
    category: 'platz',
    district: 'Dorf',
    lat: 53.7896,
    lng: 7.900096,
    half: 35,
    source: 'Nominatim leisure=park Dorfplatz Wangerooge',
    tags: ['platz', 'must_have'],
    bullets: [
      'Der Dorfplatz ist sozialer Mittelpunkt mit Kirche, Gassen und Orientierung im Ort.',
      'Von hier aus sind Bahnhof, Leuchtturm und Promenade kurze Fußwege.',
    ],
    teaser:
      'Du näherst dich dem Dorfplatz — Herzstück des Orts mit klaren Sichtachsen.',
    general:
      'Am Dorfplatz triffst du Inselalltag: Treffen, kurze Wege, zentrale Orientierung.',
    subs: [
      {
        id: 'wangerooge_dorfplatz_mitte',
        name: 'Dorfplatz-Mitte',
        dLat: 0,
        dLng: 0,
        detail:
          'Genau in der Mitte: Ein kurzer 360-Grad-Blick zeigt Kirche, Gassen und Wege zur Promenade.',
      },
    ],
  },
  {
    id: 'wangerooge_nationalparkhaus',
    name: 'Nationalpark-Haus Wangerooge (Rosenhaus)',
    category: 'museum',
    district: 'Dorf',
    lat: 53.790643,
    lng: 7.901587,
    half: 22,
    source: 'Nominatim way/42428558 Friedrich-August-Straße 18',
    bullets: [
      'Das Nationalpark-Haus (Rosenhaus) an der Friedrich-August-Straße erklärt Watt und Insel-Schutz.',
      'Adresse laut OSM: Friedrich-August-Straße 18.',
    ],
    teaser:
      'Im Ort Richtung Friedrich-August-Straße: Das Nationalpark-Haus lohnt für Watt und Vogelwelt.',
    general:
      'Hier wird aus Strandspaziergang Wissen — kompakt und für die Insel gemacht.',
  },
  {
    id: 'wangerooge_promenade',
    name: 'Obere Strandpromenade Wangerooge',
    category: 'promenade',
    district: 'Nord',
    lat: 53.793196,
    lng: 7.902312,
    half: 55,
    source: 'Nominatim highway=pedestrian Obere Strandpromenade',
    bullets: [
      'Die Obere Strandpromenade ist die Fußgängerachse zwischen Ort und Strandzugängen.',
      'Entlang der Promenade liegen Cafés und Imbisse mit Blickrichtung Meer.',
    ],
    teaser:
      'Richtung Norden: Die Obere Strandpromenade führt dich parallel zu Dünen und Strand.',
    general:
      'Auf der Oberen Strandpromenade wird Gehen zum Programm — Inseltempo inklusive.',
  },
  {
    id: 'wangerooge_hauptstrand',
    name: 'Strandbereich an der Oberen Strandpromenade',
    category: 'strand',
    district: 'Nord',
    lat: 53.7940,
    lng: 7.9015,
    half: 80,
    source:
      'Abgeleitet nördlich der Oberen Strandpromenade (OSM pedestrian axis); kein einzelner beach-Node mit stabilem Namen',
    tags: ['strand', 'natur', 'must_have', 'needs_field_check'],
    bullets: [
      'Nördlich der Oberen Strandpromenade öffnet sich der Hauptstrandbereich der Insel.',
      'Zugänge liegen entlang der Promenade; bleib auf den ausgewiesenen Dünenwegen.',
    ],
    teaser:
      'Hinter der Promenade Richtung Meer: Der Strandbereich öffnet sich hinter den Dünen.',
    general:
      'Sand, Wind, Horizont — am Strand wird klar, warum Wangerooge Inselurlaub heißt.',
  },
  {
    id: 'wangerooge_cafe_pudding',
    name: 'Cafe Pudding',
    category: 'cafe',
    district: 'Nord',
    lat: 53.793201,
    lng: 7.900057,
    half: 16,
    source: 'Nominatim Cafe Pudding, Zedeliusstraße 49',
    tags: ['cafe', 'kaffee', 'gastronomie'],
    bullets: [
      'Cafe Pudding liegt an der Zedeliusstraße 49 nahe der Strandpromenade.',
      'Typischer Pausenort zwischen Dorf und Strand.',
    ],
    teaser:
      'Kaffee-Pause an der Zedeliusstraße? Cafe Pudding liegt nahe der Promenade.',
    general: 'Hier riecht es nach Kaffee und Inselnachmittag.',
  },
  {
    id: 'wangerooge_bistro_am_strand',
    name: 'Bistro am Strand',
    category: 'streetfood',
    district: 'Nord',
    lat: 53.793152,
    lng: 7.899572,
    half: 16,
    source: 'Nominatim Bistro am Strand, Obere Strandpromenade 19',
    tags: ['streetfood', 'mittag', 'gastronomie'],
    bullets: [
      'Bistro am Strand an der Oberen Strandpromenade 19 bedient den schnellen Hunger.',
      'Ideal im Mittagsfenster nach dem Strandgang.',
    ],
    teaser:
      'Hunger nach dem Strand? Das Bistro am Strand liegt direkt an der Promenade.',
    general: 'Kurz, knackig, nah am Wasser — pragmatischer Mittags-Move.',
  },
  {
    id: 'wangerooge_weststrand',
    name: 'Weststrand / Westen Wangerooge',
    category: 'strand',
    district: 'West',
    lat: 53.7855,
    lng: 7.8555,
    half: 70,
    source:
      'Schätzung westlich des Westturms (Im Westen); kein stabiler beach-Name in Nominatim — needs_field_check',
    tags: ['strand', 'natur', 'needs_field_check'],
    bullets: [
      'Westlich vom Westturm öffnet sich der ruhigere Westbereich der Insel.',
      'Ideal für lange Spaziergänge Richtung Seezeichen.',
    ],
    teaser:
      'Weiter westlich: offenerer Strand- und Dünenbereich — weniger Trubel, mehr Weite.',
    general: 'Am Weststrand zieht der Wind anders — hier ist die Insel rauer und weiter.',
  },
];

function approachFor(p) {
  const meters = p.approachOffsetM ?? 40;
  const dLat = -meters / 111320; // default south of place (street approach)
  return {
    id: `${p.id}_approach_1`,
    lat: +(p.lat + dLat).toFixed(7),
    lng: p.lng,
    radius_m: 30,
    teaser_text: p.teaser,
    condition_rule: 'always',
  };
}

function build() {
  const spots = [];
  const triggers = [];

  for (const p of PLACES) {
    const polygon = boxPolygon(p.lat, p.lng, p.half || 25);
    const tags = [p.category, ...(p.tags || [])];
    if (p.famous) {
      tags.push('promi', `famous:${p.famous.slice(0, 48)}`);
    }
    const subs = (p.subs || []).map((s) => ({
      id: s.id,
      name: s.name,
      lat: +(p.lat + (s.dLat || 0)).toFixed(7),
      lng: +(p.lng + (s.dLng || 0)).toFixed(7),
      radius_m: 12,
      fact_details: s.detail,
      tags: ['sub_poi'],
    }));

    spots.push({
      id: p.id,
      name: p.name,
      district: p.district,
      category: p.category,
      tags,
      bullets: p.bullets,
      facts: {
        origin: p.bullets[0],
        now: p.bullets[1],
        famousPersonConnected: p.famous,
        tags: [...tags, 'coord_source_nominatim'],
      },
      polygonCoordinates: polygon,
      approach_triggers: [approachFor(p)],
      sub_pois: subs,
      _coord_source: p.source,
    });

    triggers.push({
      id: p.id,
      name: p.name,
      lat: p.lat,
      lng: p.lng,
      radius_m: Math.max(22, Math.min(45, (p.half || 25) * 0.7)),
      trigger_kind: 'area',
      trigger_type: 'polygon',
      polygon: polygon.map((x) => ({ lat: x.latitude, lng: x.longitude })),
      general_info: p.general,
      deep_data_pool: [
        ...p.bullets.map((t) => ({ text: t, tags: ['sourced_nominatim'] })),
        {
          text: `Koordinatenquelle: ${p.source}`,
          tags: ['meta_source'],
        },
      ],
    });
  }

  const pack = {
    city_id: 'wangerooge',
    name: 'Wangerooge',
    data_version: 2,
    symbol: '🏝️',
    lat: 53.7902,
    lng: 7.8995,
    district_division: ['Hafen', 'Dorf', 'Nord', 'West'],
    spots,
    trigger_points: triggers,
    _audit: {
      verified_at: new Date().toISOString(),
      method:
        'Nominatim/OSM centroids; Google Maps/Earth/Street View blocked by consent wall (no GOOGLE_MAPS_API_KEY)',
      removed_unverified: [
        'generisches Café am Kurplatz',
        'generisches Fischrestaurant',
        'generische Bücherstube',
        'generisches Heimatmuseum',
        'Dünen-Platzhalter mit Juist-Falschtreffer',
      ],
    },
  };

  const v = validateCityPack(pack);
  if (!v.ok) {
    console.error(v.errors);
    process.exit(1);
  }

  const clean = structuredClone(pack);
  for (const s of clean.spots) delete s._coord_source;
  fs.writeFileSync(out, JSON.stringify(clean, null, 2));
  fs.writeFileSync(
    out.replace(/\.json$/, '.sources.json'),
    JSON.stringify(
      {
        audit: pack._audit,
        places: PLACES.map((p) => ({
          id: p.id,
          lat: p.lat,
          lng: p.lng,
          source: p.source,
        })),
      },
      null,
      2,
    ),
  );
  console.log(`[wangerooge] v2 spots=${spots.length} wrote ${out}`);
}

build();
