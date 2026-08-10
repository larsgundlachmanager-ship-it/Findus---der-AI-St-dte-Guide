#!/usr/bin/env node
/**
 * Apply Pinneberg precision refinements (Kirche, ILO entrance, park polygons,
 * taxi/parking/market service spots, Cap Polonio deep merge).
 *
 *   node scripts/cityPack/refinePinnebergPrecision.mjs --apply
 */

import {
  boxPolygon,
  hasFlag,
  loadEnvFile,
  loadPack,
  offset,
  savePack,
  slugify,
} from './lib.mjs';
import {
  geocode,
  requireGoogleKey,
  resolvePlace,
  placesText,
} from './google.mjs';
import { fetchOverpass, fetchNominatimPolygon, sleep } from '../geo/osm.mjs';
import { runQualityGate } from './qualityGate.mjs';

loadEnvFile();

function centroid(poly) {
  const lat = poly.reduce((s, p) => s + (p.latitude ?? p.lat), 0) / poly.length;
  const lng = poly.reduce((s, p) => s + (p.longitude ?? p.lng), 0) / poly.length;
  return { lat, lng };
}

function wayRing(el, nodesById) {
  if (!el.nodes) return null;
  const ring = [];
  for (const nid of el.nodes) {
    const n = nodesById.get(nid);
    if (n) ring.push({ latitude: n.lat, longitude: n.lon });
  }
  if (ring.length < 3) return null;
  const a = ring[0];
  const b = ring[ring.length - 1];
  if (a.latitude !== b.latitude || a.longitude !== b.longitude) ring.push({ ...a });
  return ring;
}

async function fetchNamedAreaPolygon(
  lat,
  lng,
  { nameHint, tags = [], radiusM = 900, nominatimQuery = null } = {},
) {
  // Named parks/forests: Nominatim first (Overpass mirrors often return nameless nearby ways).
  const nq =
    nominatimQuery ||
    (nameHint ? `${nameHint} Pinneberg` : null);
  if (nq) {
    try {
      const nom = await fetchNominatimPolygon(nq);
      if (nom?.polygon?.length >= 8) {
        console.log(`[osm] nominatim poly for "${nq}" n=${nom.polygon.length}`);
        return nom;
      }
    } catch (e) {
      console.warn(`[osm] nominatim poly fail: ${e.message}`);
    }
  }

  const tagFilters = tags.length
    ? tags.map((t) => `way(around:${radiusM},${lat},${lng})[${t}];`).join('\n')
    : `way(around:${radiusM},${lat},${lng})[leisure=park];
       way(around:${radiusM},${lat},${lng})[landuse=forest];
       way(around:${radiusM},${lat},${lng})[natural=wood];
       relation(around:${radiusM},${lat},${lng})[leisure=park];
       relation(around:${radiusM},${lat},${lng})[landuse=forest];`;
  const query = `
    [out:json][timeout:60];
    (
      ${tagFilters}
    );
    out body;
    >;
    out skel qt;
  `;
  try {
    const data = await fetchOverpass(query);
    const nodesById = new Map();
    for (const el of data.elements || []) {
      if (el.type === 'node') nodesById.set(el.id, el);
    }
    const hint = (nameHint || '').toLowerCase();
    let best = null;
    let bestScore = -1;
    for (const el of data.elements || []) {
      if (el.type !== 'way' || !el.tags) continue;
      const ring = wayRing(el, nodesById);
      if (!ring || ring.length < 4) continue;
      const c = centroid(ring);
      const dist = Math.hypot(
        (c.lat - lat) * 111320,
        (c.lng - lng) * 70000,
      );
      const name = String(el.tags.name || '').toLowerCase();
      const nameHit =
        hint &&
        (name.includes(hint) ||
          name.split(/\s+/).some((w) => hint.includes(w) && w.length > 3));
      // Without name match, only accept very close rings (avoid random parks).
      if (hint && !nameHit && dist > 180) continue;
      let score = Math.max(0, 800 - dist);
      if (nameHit) score += 2000;
      if (el.tags.leisure === 'park') score += 50;
      if (el.tags.landuse === 'forest' || el.tags.natural === 'wood') score += 40;
      if (score > bestScore) {
        bestScore = score;
        best = {
          polygon: ring,
          name: el.tags.name || null,
          osmId: el.id,
          source_url: `https://www.openstreetmap.org/way/${el.id}`,
          dist,
        };
      }
    }
    if (best) return best;
  } catch (e) {
    console.warn(`[osm] area overpass miss: ${e.message}`);
  }
  return null;
}

function ensureSpot(pack, id, base) {
  let spot = pack.spots.find((s) => s.id === id);
  let trigger = pack.trigger_points.find((t) => t.id === id);
  if (!spot) {
    spot = {
      id,
      name: base.name,
      category: base.category,
      district: base.category,
      tags: [base.category, 'module1'],
      bullets: [],
      facts: { tags: [] },
      polygonCoordinates: [],
      approach_triggers: [],
      sub_pois: [],
    };
    pack.spots.push(spot);
  }
  if (!trigger) {
    trigger = {
      id,
      name: base.name,
      lat: base.lat,
      lng: base.lng,
      radius_m: 30,
      general_info: '',
      deep_data_pool: [],
    };
    pack.trigger_points.push(trigger);
  }
  return { spot, trigger };
}

function pushDeep(trigger, text, tags) {
  trigger.deep_data_pool = trigger.deep_data_pool || [];
  const key = String(text).toLowerCase().slice(0, 70);
  if (
    trigger.deep_data_pool.some(
      (e) => String(e.text || e).toLowerCase().slice(0, 70) === key,
    )
  ) {
    return;
  }
  trigger.deep_data_pool.push({ text, tags });
}

function setGeo(spot, trigger, lat, lng, { half = 24, poly = null } = {}) {
  trigger.lat = lat;
  trigger.lng = lng;
  spot.polygonCoordinates = poly?.length >= 3 ? poly : boxPolygon(lat, lng, half);
  trigger.polygon = spot.polygonCoordinates.map((p) => ({
    lat: p.latitude ?? p.lat,
    lng: p.longitude ?? p.lng,
  }));
  trigger.trigger_kind = 'area';
  trigger.trigger_type = 'polygon';
  trigger.radius_m = half;
}

async function main() {
  requireGoogleKey();
  const pack = loadPack('pinneberg');
  if (!pack) throw new Error('pinneberg missing');
  const near = { lat: pack.lat || 53.661, lng: pack.lng || 9.797 };

  // 1) Christuskirche detailed
  {
    let g = await resolvePlace('Christuskirche Bahnhofstraße 2 Pinneberg', {
      near,
      preferTypes: ['church', 'place_of_worship'],
    });
    if (!g) {
      const geo = await geocode('Bahnhofstraße 2, 25421 Pinneberg');
      const loc = geo.results?.[0]?.geometry?.location;
      if (!loc) throw new Error('Christuskirche geocode failed');
      g = {
        lat: loc.lat,
        lng: loc.lng,
        address: geo.results[0].formatted_address,
      };
    }

    const { spot, trigger } = ensureSpot(pack, 'pinneberg_christuskirche_pinneberg', {
      name: 'Christuskirche Pinneberg',
      category: 'kirche',
      lat: g.lat,
      lng: g.lng,
    });
    spot.name = 'Christuskirche Pinneberg';
    spot.category = 'kirche';
    spot.tags = ['kirche', 'neogotik', 'architecture', 'must_have', 'master_report'];
    spot.facts = {
      origin:
        '1894/95 nach Plänen des Hamburger Architekten Hugo Groothoff im neugotischen Stil erbaut.',
      architecture:
        'Neugotik; markanter Kirchturm ca. 46 m — städtebaulicher Vertikalanker an der Bahnhofstraße.',
      now: 'Adresse: Bahnhofstraße 2, 25421 Pinneberg. Evangelische Stadtkirche und Orientierungspunkt zwischen Bahnhof und Zentrum.',
      tags: ['kirche', 'neogotik', 'architecture', 'master_report'],
    };
    spot.bullets = [
      'Adresse: Bahnhofstraße 2, 25421 Pinneberg.',
      'Erbaut 1894/95, Architekt: Hugo Groothoff (Hamburg).',
      'Stil: Neugotik; Turmhöhe ca. 46 Meter.',
      'Städtebaulicher Anker zwischen Bahnhofsquartier und Innenstadt.',
    ];
    trigger.general_info =
      'An der Bahnhofstraße 2 erhebt sich die Christuskirche: 1894/95 von Hugo Groothoff neugotisch erbaut, mit rund 46 Meter hohem Turm — Pinnebergs sakraler Vertikalpunkt auf dem Weg vom Bahnhof ins Zentrum.';
    trigger.deep_data_pool = [];
    pushDeep(
      trigger,
      'Die Christuskirche entstand 1894/95 nach Plänen des Hamburger Architekten Hugo Groothoff im neugotischen Stil.',
      ['geschichte', 'architecture', 'master_report'],
    );
    pushDeep(
      trigger,
      'Der Turm misst etwa 46 Meter und dominiert die Sichtachsen der Bahnhofstraße.',
      ['architecture', 'aussicht', 'master_report'],
    );
    pushDeep(
      trigger,
      'User-Frage: Wer hat die Christuskirche gebaut? Antwort: Der Hamburger Architekt Hugo Groothoff; Weihe-/Bauzeit 1894/95, neugotisch.',
      ['faq', 'user_question', 'architecture'],
    );
    pushDeep(
      trigger,
      'User-Frage: Wo genau steht sie? Antwort: Bahnhofstraße 2 — zwischen Bahnhofsquartier und Weg Richtung Dingstätte/Drostei.',
      ['faq', 'user_question', 'orientierung'],
    );
    pushDeep(
      trigger,
      `GPS-Eingang (Google/Geocode): ${g.lat.toFixed(6)}, ${g.lng.toFixed(6)} — Bahnhofstraße 2.`,
      ['gps_confirmed', 'sourced_google'],
    );
    pushDeep(
      trigger,
      'LIVE: Gottesdienste und Konzerte an der Christuskirche frisch recherchieren.',
      ['live_hint', 'events', 'ephemeral'],
    );
    setGeo(spot, trigger, g.lat, g.lng, { half: 28 });
    const a1 = offset(g.lat, g.lng, 55, -8);
    const a2 = offset(g.lat, g.lng, -18, 12);
    spot.approach_triggers = [
      {
        id: 'pinneberg_christuskirche_approach_far',
        lat: a1.lat,
        lng: a1.lng,
        radius_m: 36,
        teaser_text:
          'In der Bahnhofstraße zeichnet sich der neugotische Turm der Christuskirche ab — rund 46 Meter Backstein und Spitze.',
        condition_rule: 'always',
      },
      {
        id: 'pinneberg_christuskirche_approach_near',
        lat: a2.lat,
        lng: a2.lng,
        radius_m: 14,
        teaser_text:
          'Bahnhofstraße 2: Hugo Groothoffs Christuskirche von 1894/95 — Portal und Fassade direkt voraus.',
        condition_rule: 'always',
      },
    ];
    spot.sub_pois = [
      {
        id: 'pinneberg_christuskirche_sub_eingang',
        name: 'Christuskirche · Haupteingang',
        lat: g.lat,
        lng: g.lng,
        radius_m: 10,
        fact_details: 'Haupteingang Bahnhofstraße 2.',
        tags: ['eingang', 'gps_entrance'],
      },
    ];
    console.log('[1] Christuskirche', g.lat, g.lng);
  }

  // 2) ILO Torhaus Mühlenau 16
  {
    const gRes = await geocode('Mühlenau 16, 25421 Pinneberg');
    const loc = gRes.results?.[0]?.geometry?.location;
    if (!loc) throw new Error('Mühlenau 16 geocode failed');
    const { spot, trigger } = ensureSpot(pack, 'pinneberg_torhaus_ilo_park', {
      name: 'Torhaus ILO Park',
      category: 'denkmal',
      lat: loc.lat,
      lng: loc.lng,
    });
    spot.name = 'Torhaus ILO Park';
    spot.category = 'denkmal';
    spot.tags = ['denkmal', 'ilo', 'architecture', 'must_have', 'master_report'];
    spot.facts = {
      origin:
        'ILO-Motorenwerke: Heinrich Christiansen verlagerte 1913 die Fabrik nach Pinneberg; Name aus Esperanto „gutes Werkzeug“.',
      architecture:
        'Torhaus als Entree des ILO-Parks: Verbindung denkmalgeschütztes Verwaltungsgebäude und Neubau — Fußweg-Eingang Mühlenau 16.',
      now: 'Adresse/Eingang: Mühlenau 16, ca. 50 m vom Bahnhof Pinneberg. Quartier für Gewerbe und Wohnen nach Produktionsende 1990.',
      tags: ['ilo', 'denkmal', 'master_report'],
    };
    spot.bullets = [
      'Fußweg-Eingang / Navigationspin: Mühlenau 16, 25421 Pinneberg.',
      'Nur ~50 Meter vom Bahnhof Pinneberg — idealer Wegweiser-Start ins Quartier.',
      '1913–1990 größter deutscher Zweitaktmotoren-Produzent; Querverweis Stadtmuseum-Keller.',
    ];
    trigger.general_info =
      'Am Fußweg-Eingang Mühlenau 16 öffnet das Torhaus den ILO Park — das Entree des Quartiers nur einen Steinwurf vom Bahnhof, wo einst Deutschlands größter Zweitaktmotoren-Produzent arbeitete.';
    trigger.deep_data_pool = [];
    pushDeep(
      trigger,
      'Pin exakt am Fußweg-Eingang Torhaus, Mühlenau 16 — logistischer Anker ~50 m vom Bahnhof Pinneberg.',
      ['orientierung', 'gps_confirmed', 'master_report'],
    );
    pushDeep(
      trigger,
      'Querverbindung Bahnhof: Vom Bahnsteig Richtung Mühlenau erreichst du in knapp einer Minute das Torhaus-Entree.',
      ['orientierung', 'transport', 'master_report'],
    );
    pushDeep(
      trigger,
      'Querverbindung Stadtmuseum: ILO-Motoren im Museumskeller — hier am Torhaus stand der Produktionsgrund.',
      ['ilo', 'geschichte', 'master_report'],
    );
    pushDeep(
      trigger,
      'User-Frage: Wo ist der richtige Eingang zum ILO Park? Antwort: Fußweg-Eingang am Torhaus, Adresse Mühlenau 16 — nicht irgendein Parkplatz weiter hinten.',
      ['faq', 'user_question', 'orientierung'],
    );
    pushDeep(
      trigger,
      `GPS-Eingang (Geocode Mühlenau 16): ${loc.lat.toFixed(6)}, ${loc.lng.toFixed(6)}.`,
      ['gps_confirmed', 'sourced_google'],
    );
    setGeo(spot, trigger, loc.lat, loc.lng, { half: 22 });
    const bahn = pack.trigger_points.find((t) => t.id === 'pinneberg_bahnhof_pr');
    const aFar = bahn
      ? { lat: (bahn.lat + loc.lat) / 2, lng: (bahn.lng + loc.lng) / 2 }
      : offset(loc.lat, loc.lng, 40, 10);
    const aNear = offset(loc.lat, loc.lng, -8, 6);
    spot.approach_triggers = [
      {
        id: 'pinneberg_torhaus_approach_bahnhof',
        lat: aFar.lat,
        lng: aFar.lng,
        radius_m: 28,
        teaser_text:
          'Vom Bahnhof Richtung Mühlenau: in etwa 50 Metern öffnet das Torhaus den ILO Park — das Entree des Quartiers.',
        condition_rule: 'always',
      },
      {
        id: 'pinneberg_torhaus_approach_tor',
        lat: aNear.lat,
        lng: aNear.lng,
        radius_m: 12,
        teaser_text:
          'Mühlenau 16: Fußweg-Eingang Torhaus — hier beginnt der ILO Park zwischen Denkmal und Neubau.',
        condition_rule: 'always',
      },
    ];
    spot.sub_pois = [
      {
        id: 'pinneberg_torhaus_sub_eingang',
        name: 'Torhaus · Fußweg-Eingang',
        lat: loc.lat,
        lng: loc.lng,
        radius_m: 8,
        fact_details: 'Fußweg-Eingang Mühlenau 16 — Navigationsziel.',
        tags: ['eingang', 'gps_entrance'],
      },
    ];
    console.log('[2] Torhaus Mühlenau 16', loc.lat, loc.lng);
  }

  // 3) Rosengarten + Fahlt precise polygons
  for (const cfg of [
    {
      id: 'pinneberg_rosengarten_pinneberg',
      name: 'Rosengarten Pinneberg',
      hint: 'rosen',
      query: 'Rosengarten Pinneberg',
      nominatim: 'Rosengarten Pinneberg',
      tags: ['leisure=park'],
    },
    {
      id: 'pinneberg_waldgebiet_fahlt',
      name: 'Waldgebiet Fahlt',
      hint: 'fahlt',
      query: 'Fahlt Pinneberg Wald',
      nominatim: 'Fahlt Pinneberg',
      tags: ['landuse=forest', 'natural=wood', 'leisure=park'],
    },
  ]) {
    let seed = pack.trigger_points.find((t) => t.id === cfg.id);
    const resolved = await resolvePlace(cfg.query, {
      near,
      preferTypes: ['park', 'natural_feature'],
    });
    const lat = resolved?.lat ?? seed?.lat;
    const lng = resolved?.lng ?? seed?.lng;
    if (typeof lat !== 'number') {
      console.warn('[3] skip', cfg.id);
      continue;
    }
    await sleep(300);
    let area = await fetchNamedAreaPolygon(lat, lng, {
      nameHint: cfg.hint,
      tags: cfg.tags,
      radiusM: cfg.id.includes('fahlt') ? 1200 : 700,
      nominatimQuery: cfg.nominatim,
    });
    // Fahlt name variants
    if (!area && cfg.id.includes('fahlt')) {
      area = await fetchNamedAreaPolygon(lat, lng, {
        nameHint: 'fahlt',
        tags: ['landuse=forest', 'natural=wood'],
        radiusM: 1500,
        nominatimQuery: 'Gehölz Fahlt Pinneberg',
      });
    }
    const { spot, trigger } = ensureSpot(pack, cfg.id, {
      name: cfg.name,
      category: 'natur',
      lat,
      lng,
    });
    const poly = area?.polygon || null;
    const c = poly ? centroid(poly) : { lat, lng };
    setGeo(spot, trigger, c.lat, c.lng, {
      half: cfg.id.includes('fahlt') ? 80 : 35,
      poly,
    });
    if (poly) {
      trigger.special_radius_m = null;
      spot.tags = [
        ...new Set([
          ...(spot.tags || []),
          'natur',
          'polygon_precise',
          'osm',
          'master_report',
        ]),
      ];
      pushDeep(
        trigger,
        `Flächenpolygon aus OSM (${area.source_url}) — Trigger folgt Park-/Waldgrenze, keine grobe Box.`,
        ['orientierung', 'sourced_osm', 'gps_confirmed'],
      );
      console.log(
        `[3] ${cfg.id} OSM poly n=${poly.length} name=${area.name} dist=${Math.round(area.dist)}`,
      );
    } else {
      console.warn(`[3] ${cfg.id} OSM polygon miss — kept refined center box`);
      pushDeep(
        trigger,
        'Hinweis: OSM-Flächenpolygon nicht eindeutig — Zentrum verifiziert, Polygon ggf. nachziehen.',
        ['orientierung', 'needs_review'],
      );
    }
    // Approaches just outside polygon centroid
    const a1 = offset(c.lat, c.lng, 60, 0);
    const a2 = offset(c.lat, c.lng, -35, 25);
    spot.approach_triggers = [
      {
        id: `${cfg.id}_approach_edge`,
        lat: a1.lat,
        lng: a1.lng,
        radius_m: 28,
        teaser_text: cfg.id.includes('fahlt')
          ? 'Du erreichst den Stadtwald Fahlt — sobald du die Waldgrenze überschreitest, wechselt die Stadt in grüne Ruhe.'
          : 'Du näherst dich dem Rosengarten — an der Parkgrenze beginnt die Blüten- und Wegezone.',
        condition_rule: 'always',
      },
      {
        id: `${cfg.id}_approach_in`,
        lat: a2.lat,
        lng: a2.lng,
        radius_m: 16,
        teaser_text: cfg.id.includes('fahlt')
          ? 'Mitten in der Fahlt: Wege unter Bäumen, kostenfreie Naherholung.'
          : 'Im Rosengarten: Wege zwischen Beeten — historische Grüninsel Pinnebergs.',
        condition_rule: 'always',
      },
    ];
    if (cfg.id.includes('fahlt')) {
      trigger.general_info =
        'Die Fahlt ist Pinnebergs Stadtwald: unregelmäßig geschnittene Wanderfläche — die App triggert an der echten Waldgrenze, nicht an einer groben Box.';
      spot.category = 'natur';
      spot.facts = {
        origin: 'Stadtwald Fahlt als historische Naherholungsfläche.',
        now: 'Weitläufige, kostenfrei zugängliche Waldwege.',
        tags: ['natur', 'wald', 'polygon_precise', 'master_report'],
      };
    } else {
      trigger.general_info =
        'Der Rosengarten ist eine unregelmäßig geformte Parkinsel — Polygon-Trigger folgen der Parkgrenze für präzise Annäherung.';
      spot.facts = {
        origin: 'Historischer Rosengarten Pinneberg.',
        now: 'Naherholung und saisonale Blüte; Veranstaltungen live prüfen.',
        tags: ['natur', 'park', 'polygon_precise', 'master_report'],
      };
    }
    pushDeep(
      trigger,
      'LIVE: Veranstaltungen/Blütezeit bzw. Wegesperrungen frisch prüfen.',
      ['live_hint', 'ephemeral'],
    );
  }

  // 4) Taxi / Parking / Market service spots
  const services = [
    {
      id: 'pinneberg_taxi_gb_r',
      name: 'Taxi Pinneberg GbR',
      query: 'Taxi Pinneberg GbR Rübekamp 5',
      address: 'Rübekamp 5, 25421 Pinneberg',
      category: 'service',
      general:
        'Am Rübekamp 5 sitzt die Taxi Pinneberg GbR — fester Ruf-/Standortanker für Fahrten in Stadt und Region.',
      live: 'LIVE-INFOS: Aktuelle Tarife, Zuschläge, Flughafentransfer-Preise und Wartezeiten frisch suchen — nie aus dem Pack vorlesen.',
      bullets: [
        'Adresse: Rübekamp 5, 25421 Pinneberg.',
        'Kontakt laut Bericht: 04101-772300 (LIVE verifizieren).',
        'Service-Spot: Geometrie stabil, Preise volatil.',
      ],
    },
    {
      id: 'pinneberg_taxi_union',
      name: 'Pinneberger Taxen Union',
      query: 'Pinneberger Taxen Union Dingstätte 42',
      address: 'Dingstätte 42, 25421 Pinneberg',
      category: 'service',
      general:
        'An der Dingstätte 42 ist die Pinneberger Taxen Union verortet — Innenstadt-Zentrale mit 24/7-Anspruch.',
      live: 'LIVE-INFOS: Rufnummer, Verfügbarkeit und Festpreise (z. B. Flughafen) aktuell recherchieren.',
      bullets: [
        'Adresse: Dingstätte 42.',
        'Bericht: 04101-222222 (LIVE verifizieren).',
      ],
    },
    {
      id: 'pinneberg_parkhaus_rathauspassage',
      name: 'Parkhaus Rathauspassage',
      query: 'Parkhaus Rathauspassage Pinneberg',
      category: 'service',
      general:
        'Einfahrt Parkhaus Rathauspassage — fester Parkraum-Anker an der Innenstadt mit rund 190 Stellplätzen.',
      live: 'LIVE-INFOS: Öffnungszeiten, Stunden-/Tagestarife und Zahlungsmittel (EC?) frisch prüfen — Pack speichert nur den Standort.',
      bullets: [
        'Kapazität laut Bericht ~190 Stellplätze.',
        'Teil des Innenstadt-Parksystems nahe Fußgängerzone.',
      ],
    },
    {
      id: 'pinneberg_parkhaus_volksbank',
      name: 'Parkhaus Volksbank Pinneberg',
      query: 'Parkhaus Volksbank Pinneberg',
      category: 'service',
      general:
        'Parkhaus Volksbank — weiterer zentraler Parkraum-Knoten in der Innenstadt mit Kundenpark-Logik und Einfahrt als festem Navigationspin.',
      live: 'LIVE-INFOS: Aktuelle Tarife und Freistunden-Regeln frisch suchen.',
      bullets: ['Kapazität laut Bericht ~200 Stellplätze.'],
    },
    {
      id: 'pinneberg_parkplatz_marktplatz',
      name: 'Parkplatz Marktplatz Pinneberg',
      query: 'Marktplatz Pinneberg Parkplatz',
      address: 'Marktplatz, 25421 Pinneberg',
      category: 'service',
      general:
        'Großer Parkplatz am Marktplatz — Frequenzanker für Wochenmarkt und Innenstadtbesuch.',
      live: 'LIVE-INFOS: Gebührenfenster und Gratiszeiten (Abend/Samstag) frisch verifizieren.',
      bullets: ['Kapazität laut Bericht ~380–400 Stellplätze.'],
    },
    {
      id: 'pinneberg_pr_bahnhof_rockville',
      name: 'P+R Bahnhof Rockvillestraße',
      query: 'P+R Rockvillestraße Pinneberg',
      category: 'transport',
      general:
        'P+R an der Rockvillestraße beim Bahnhof — Pendler-Parkanker direkt am S-Bahn-Zugang.',
      live: 'LIVE-INFOS: Ob weiterhin gebührenfrei und aktuelle Regeln frisch prüfen.',
      bullets: ['Ca. 150 Stellplätze laut Bericht; Querverweis Bahnhof Pinneberg.'],
    },
    {
      id: 'pinneberg_wochenmarkt_rathausvorplatz',
      name: 'Wochenmarkt Rathausvorplatz',
      query: 'Rathausvorplatz Pinneberg Wochenmarkt',
      category: 'einkaufen',
      general:
        'Auf dem Rathausvorplatz findet der Wochenmarkt statt — frische regionale Produkte mitten in der Fußgängerzone.',
      live: 'LIVE-INFOS: Markttage, Uhrzeiten und Beschickerzahl frisch suchen (Bericht: typisch Di/Do/Sa vormittags; Waldenau mittwochs Satellit).',
      bullets: [
        'Standort: Rathausvorplatz / Zentrum.',
        'Spezifika laut Bericht: Äpfel Haseldorfer Marsch, Import vom Hamburger Großmarkt.',
        'Querverweis Rathaus Bismarckstraße 8 (Bürgerbüro/Fundbüro).',
      ],
    },
  ];

  for (const svc of services) {
    let g = await resolvePlace(svc.query, {
      near,
      preferTypes: ['parking', 'point_of_interest', 'establishment'],
    });
    if (!g && svc.address) {
      const geo = await geocode(svc.address);
      const loc = geo.results?.[0]?.geometry?.location;
      if (loc) g = { ...loc, address: svc.address };
    }
    if (!g) {
      console.warn('[4] fail', svc.id);
      continue;
    }
    const { spot, trigger } = ensureSpot(pack, svc.id, {
      name: svc.name,
      category: svc.category,
      lat: g.lat,
      lng: g.lng,
    });
    spot.name = svc.name;
    spot.category = svc.category;
    spot.tags = [
      svc.category,
      'service_spot',
      'live_infos',
      'master_report',
      'stable_geometry',
    ];
    spot.facts = {
      origin: svc.address || svc.name,
      now: 'Fester Standort; volatile Preise/Zeiten nur über LIVE-INFOS.',
      tags: spot.tags,
    };
    spot.bullets = svc.bullets || [];
    trigger.general_info = svc.general;
    trigger.deep_data_pool = [];
    pushDeep(trigger, svc.live, ['live_hint', 'ephemeral', 'live_infos']);
    pushDeep(
      trigger,
      `GPS-Standort: ${g.lat.toFixed(6)}, ${g.lng.toFixed(6)}${g.address ? ` — ${g.address}` : ''}.`,
      ['gps_confirmed', 'sourced_google'],
    );
    pushDeep(
      trigger,
      'Architekturregel: Geometrie/Adresse stabil im Pack; Tarife, Gebühren, Marktzeiten = LIVE.',
      ['meta', 'master_report'],
    );
    if (svc.bullets?.[0]) pushDeep(trigger, svc.bullets[0], ['kurz']);
    setGeo(spot, trigger, g.lat, g.lng, {
      half: /parkhaus|parkplatz|p\+r/i.test(svc.name) ? 35 : 18,
    });
    const a = offset(g.lat, g.lng, 30, 0);
    spot.approach_triggers = [
      {
        id: `${svc.id}_approach`,
        lat: a.lat,
        lng: a.lng,
        radius_m: 22,
        teaser_text: `${svc.name} liegt voraus — fester Standortanker.`,
        condition_rule: 'always',
      },
    ];
    spot.sub_pois = [
      {
        id: `${svc.id}_sub_eingang`,
        name: `${svc.name} · Zugang`,
        lat: g.lat,
        lng: g.lng,
        radius_m: 8,
        fact_details: 'Zugang / Einfahrt / Eingang.',
        tags: ['eingang', 'gps_entrance'],
      },
    ];
    console.log('[4]', svc.id, g.lat, g.lng);
    await sleep(150);
  }

  // 5) Cap Polonio deep merge + cross links
  {
    const { spot, trigger } = ensureSpot(pack, 'pinneberg_hotel_cap_polonio', {
      name: 'Hotel Cap Polonio',
      category: 'hotel',
      lat: 53.65796,
      lng: 9.80675,
    });
    spot.category = 'hotel';
    spot.tags = [
      ...new Set([
        ...(spot.tags || []),
        'hotel',
        'geschichte',
        'legendäres_gebäude',
        'historische_läden',
        'must_have',
        'master_report',
      ]),
    ];
    spot.facts = {
      ...(spot.facts || {}),
      origin:
        'Prachtvoller Speisesaal der 1. Klasse des 1914 gebauten Ozeandampfers „Cap Polonio“ — vor der Verschrottung gerettet und in Pinneberg verbaut.',
      architecture:
        'Holzgetäfelter Speisesaal als lebendige Gastronomie-/Hotellocation; andere Schiffsteile landeten steril im Deutschen Schifffahrtsmuseum Bremerhaven.',
      now: 'Hotel Cap Polonio mit historischem Speisesaal — Hochzeiten und festliche Dinner; Querverbindungen zur Innenstadt-Kulturachse.',
      tags: ['hotel', 'geschichte', 'master_report'],
    };
    spot.bullets = [
      ...new Set([
        ...(spot.bullets || []),
        'Historische Entität: geretteter 1.-Klasse-Speisesaal des Dampfers Cap Polonio (1914).',
        'Kategorie: Historische Läden & Legendäre Gebäude.',
        'Querverweis Drostei/Dingstätte: Kulturachse Innenstadt für festliche Abende.',
        'Querverweis Bahnhof: Anreise S3, dann kurze Distanz zum Cap Polonio.',
      ]),
    ];
    trigger.general_info =
      'Im Cap Polonio speist du im geretteten 1.-Klasse-Saal des Ozeandampfers von 1914 — ein legendäres Gebäude, das Pinnebergs Geschichten mit Hochsee-Glanz und Innenstadt-Kultur verknüpft.';
    pushDeep(
      trigger,
      'Historische Läden & Legendäre Gebäude: Cap Polonio verbindet Schifffahrtsgeschichte mit gelebter Gastronomie — kein Museumsstück hinter Glas.',
      ['geschichte', 'master_report'],
    );
    pushDeep(
      trigger,
      'Querverbindung Drostei: Nach Barock und Thingplatz an der Dingstätte führt der Abend oft hierher — vom Herrschaftssitz zum Schiffssalon.',
      ['orientierung', 'geschichte', 'master_report'],
    );
    pushDeep(
      trigger,
      'Querverbindung Stadtmuseum: Während das Museum ILO-Motoren und Stadtchronik zeigt, erzählt Cap Polonio die maritime Rettungsgeschichte in Echtbetrieb.',
      ['geschichte', 'master_report'],
    );
    pushDeep(
      trigger,
      'Querverbindung Bahnhof: Vom S-Bahn-Halt Pinneberg ist das Cap Polonio ein kurzer Stadtgang — typische Pendler-/Gästeachse.',
      ['transport', 'orientierung'],
    );
    pushDeep(
      trigger,
      'User-Frage: Was ist am Cap Polonio so besonders? Antwort: Der holzgetäfelte Speisesaal stammt vom Luxusdampfer Cap Polonio (1914) und wurde vor der Verschrottung hierher gerettet.',
      ['faq', 'user_question', 'geschichte'],
    );
    pushDeep(
      trigger,
      'LIVE: Speisekarte, Zimmerpreise und Reservierung frisch suchen — keine Pack-Preise.',
      ['live_hint', 'ephemeral', 'gastro', 'hotels'],
    );
    // keep existing GPS if present
    if (typeof trigger.lat === 'number') {
      setGeo(spot, trigger, trigger.lat, trigger.lng, { half: 22 });
    }
    console.log('[5] Cap Polonio deep-merge ok');
  }

  // mobility parking hints from new spots
  pack._mobility = pack._mobility || {
    bike_share: { providers: ['nextbike'], nextbike_city_id: null },
    parking: { parkopedia_enabled: false, hint_spots: [] },
  };
  const parkIds = [
    'pinneberg_parkhaus_rathauspassage',
    'pinneberg_parkhaus_volksbank',
    'pinneberg_parkplatz_marktplatz',
    'pinneberg_pr_bahnhof_rockville',
  ];
  pack._mobility.parking.hint_spots = parkIds
    .map((id) => {
      const t = pack.trigger_points.find((x) => x.id === id);
      const s = pack.spots.find((x) => x.id === id);
      if (!t) return null;
      return {
        name: s.name,
        lat: t.lat,
        lng: t.lng,
        type: /p\+r|pr_/i.test(id) ? 'car' : 'car',
        pricing: 'unknown',
      };
    })
    .filter(Boolean);

  const gate = runQualityGate(pack, { strict: false });
  console.log(
    `[refine] spots=${pack.spots.length} ok=${gate.ok} err=${gate.errors.length} warn=${gate.warnings.length}`,
  );
  if (gate.warnings.length) console.log(gate.warnings.slice(0, 20));

  if (hasFlag('apply') || !hasFlag('dry')) {
    const file = savePack(pack, { bumpVersion: true });
    console.log('[refine] wrote', file, 'v' + pack.data_version);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
