#!/usr/bin/env node
/**
 * Add Aussicht/Freizeit/Kultur highlights + event live prompts to Hechingen.
 *   node scripts/cityPack/addHechingenHighlights.mjs --apply
 */
import {
  boxPolygon,
  hasFlag,
  loadEnvFile,
  loadPack,
  offset,
  savePack,
} from './lib.mjs';
import { runQualityGate } from './qualityGate.mjs';

loadEnvFile();

function pushDeep(trigger, text, tags) {
  const clean = String(text || '').trim();
  if (clean.length < 18) return;
  trigger.deep_data_pool = trigger.deep_data_pool || [];
  const key = clean.toLowerCase().slice(0, 90);
  if (
    trigger.deep_data_pool.some(
      (e) =>
        (typeof e === 'string' ? e : e?.text || '')
          .toLowerCase()
          .slice(0, 90) === key,
    )
  ) {
    return;
  }
  trigger.deep_data_pool.push({ text: clean, tags: tags || ['master_report'] });
}

function setGeo(spot, trigger, lat, lng, half = 26) {
  trigger.lat = lat;
  trigger.lng = lng;
  trigger.radius_m = half;
  spot.polygonCoordinates = boxPolygon(lat, lng, half);
  trigger.polygon = spot.polygonCoordinates.map((p) => ({
    lat: p.latitude,
    lng: p.longitude,
  }));
  trigger.trigger_kind = 'area';
  trigger.trigger_type = 'polygon';
}

function approaches(spot, lat, lng, teasers) {
  spot.approach_triggers = teasers.map((text, i) => {
    const m = [50, 20, 8][i] || 28;
    const p = offset(lat, lng, -m * 0.65, i * 5);
    return {
      id: `${spot.id}_approach_${i + 1}`,
      lat: p.lat,
      lng: p.lng,
      radius_m: Math.min(36, Math.max(10, Math.round(m * 0.4))),
      teaser_text: text,
      condition_rule: 'always',
    };
  });
}

function upsert(pack, id, cfg) {
  let spot = pack.spots.find((s) => s.id === id);
  let trigger = pack.trigger_points.find((t) => t.id === id);
  if (!spot) {
    spot = {
      id,
      name: cfg.name,
      category: cfg.category,
      district: cfg.category,
      tags: [],
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
      name: cfg.name,
      lat: cfg.lat,
      lng: cfg.lng,
      radius_m: 26,
      general_info: '',
      deep_data_pool: [],
    };
    pack.trigger_points.push(trigger);
  }
  spot.name = cfg.name;
  spot.category = cfg.category;
  spot.place_tier = cfg.tier;
  spot.relevance = cfg.relevance || [];
  spot.tags = [
    ...new Set([
      cfg.category,
      'module1',
      `tier${cfg.tier}`,
      ...(cfg.relevance || []),
      'master_report',
      'highlights_2026',
    ]),
  ];
  spot.facts = { ...(spot.facts || {}), ...cfg.facts, tags: spot.tags };
  spot.bullets = [...new Set([...(spot.bullets || []), ...(cfg.bullets || [])])];
  trigger.name = cfg.name;
  trigger.general_info = cfg.general;
  setGeo(spot, trigger, cfg.lat, cfg.lng, cfg.half || 26);
  for (const d of cfg.deep || []) {
    pushDeep(trigger, d.text, d.tags);
  }
  approaches(spot, cfg.lat, cfg.lng, cfg.teasers || []);
  spot.sub_pois = [
    {
      id: `${id}_sub_zugang`,
      name: `${cfg.name} · Zugang`,
      lat: cfg.lat,
      lng: cfg.lng,
      radius_m: 10,
      fact_details: cfg.bullets?.[0] || 'Zugang / Aussichtspunkt',
      tags: ['eingang', 'gps_entrance'],
    },
  ];
  console.log(`[add] T${cfg.tier}`, cfg.name, cfg.lat, cfg.lng);
  return { spot, trigger };
}

function main() {
  const pack = loadPack('hechingen');

  // Zeller Horn = upgrade existing Hohenzollernblick (same summit)
  {
    const old =
      pack.spots.find((s) => /hohenzollernblick/i.test(s.id + s.name)) ||
      pack.spots.find((s) => /zeller/i.test(s.id + s.name));
    const id = old?.id || 'hechingen_zeller_horn';
    // Remove duplicate if we create new and old exists with different id - just reuse old
    upsert(pack, id, {
      name: 'Zeller Horn · Postkartenblick Burg',
      category: 'aussicht',
      lat: 48.3125146,
      lng: 8.9800896,
      tier: 1,
      half: 35,
      relevance: ['must_see', 'panorama', 'wanderung', 'fotomotiv'],
      facts: {
        origin:
          'Zeller Horn (ca. 913 m) oberhalb Maria Zell / Boll — weltberühmtes Postkartenmotiv der Burg Hohenzollern; Gemarkung Albstadt, Pflicht für Hechingen-Touristen.',
        architecture: 'Offener Albtrauf-Gipfel / Aussichtsplatte mit freiem Burgpanorama.',
        now: 'Wanderziel: Aufstieg oft von Maria Zell / Skihütte (Zickzack-Weg). Gutes Schuhwerk.',
      },
      bullets: [
        'GPS Gipfel: 48.312515, 8.980090',
        'Klassisches Postkartenmotiv der Burg Hohenzollern.',
        'Querverweis Wallfahrtskirche Maria Zell unterhalb.',
      ],
      general:
        'Das Zeller Horn liefert das weltberühmte Postkartenmotiv der Burg Hohenzollern — knapp Albstädter Gemarkung, aber das Muss für jeden Hechingen-Besuch mit Kamera und Wanderschuhen.',
      deep: [
        {
          text: 'User-Frage: Woran erkenne ich diesen Ort? Antwort: Offener Gipfel am Albtrauf, von dem die Burg Hohenzollern frontal und unverstellt im Bild liegt — das klassische Postkartenmotiv.',
          tags: ['faq', 'user_question', 'visual_anchor'],
        },
        {
          text: 'Querverbindung Maria Zell: Unterhalb liegt die Wallfahrtskirche — oft gemeinsamer Wanderbogen Skihütte → Horn.',
          tags: ['querverbindung', 'wanderung'],
        },
        {
          text: 'Relevanz Tier 1: Fotomotiv/Wander-Highlight — aktiv anbieten, wenn Panorama oder Burg im Fokus.',
          tags: ['place_tier', 'relevance'],
        },
      ],
      teasers: [
        'Der Aufstieg zum Zeller Horn — gleich kommt das Postkartenmotiv der Burg.',
        'Gleich da: freier Blick, Burg frontal — Zeller Horn.',
        'Gipfel Zeller Horn: das Motiv, das du von Postkarten kennst.',
      ],
    });
  }

  upsert(pack, 'hechingen_wallfahrtskirche_maria_zell', {
    name: 'Wallfahrtskirche Maria Zell',
    category: 'kirche',
    lat: 48.3175257,
    lng: 8.9803416,
    tier: 2,
    half: 28,
    relevance: ['geschichte', 'panorama', 'wanderung', 'kirche'],
    facts: {
      origin:
        'Wallfahrtskirche bei Hechingen-Boll unterhalb des Zeller Horns; Siedlung Zell/St. Gallen-Bezug; nach Brand 1633 wieder aufgebaut, 1655 geweiht, 1757 erweitert.',
      architecture: 'Kleine Kirche am Steilabfall der Alb mit Blick auf Burg und Vorland.',
      now: 'Ruhiger Aussichts- und Wallfahrtsort — oft mit Zeller-Horn-Wanderung kombinierbar.',
    },
    bullets: [
      'Lage: unterhalb Zeller Horn, Boll.',
      'Legende: Engel tragen die Kirche zurück; Gnadenbild im Krieg gerettet.',
      'GPS: 48.317526, 8.980342',
    ],
    general:
      'Unterhalb des Zeller Horns thront die Wallfahrtskirche Maria Zell — klein, ruhig und mit fantastischem Blick auf Burg Hohenzollern und das Vorland. Geschichte und Panorama in einem Abstecher.',
    deep: [
      {
        text: 'User-Frage: Woran erkenne ich diesen Ort? Antwort: Kleine Kirche am Steilhang unter dem Albtrauf, mit freiem Burgblick — nicht die große Stiftskirche in der Stadt.',
        tags: ['faq', 'user_question', 'visual_anchor'],
      },
      {
        text: 'Querverbindung Zeller Horn: Von hier startet oft der Aufstieg zum Postkarten-Gipfel.',
        tags: ['querverbindung', 'wanderung'],
      },
      {
        text: 'LIVE: Ob die Kirche innen geöffnet ist (saisonal oft So/Feiertag), frisch prüfen.',
        tags: ['live_hint', 'ephemeral'],
      },
    ],
    teasers: [
      'Am Hang unter dem Zeller Horn: Maria Zell mit Burgblick voraus.',
      'Wallfahrtskirche Maria Zell — ruhiger Punkt mit Panorama.',
      'Direkt an der Kirche Maria Zell.',
    ],
  });

  upsert(pack, 'hechingen_dreifuerstenstein', {
    name: 'Dreifürstenstein',
    category: 'aussicht',
    lat: 48.372874,
    lng: 9.0439823,
    tier: 2,
    half: 35,
    relevance: ['wanderung', 'panorama'],
    facts: {
      origin:
        'Markanter Berg/Aussichtspunkt am Albtrauf nahe Hechingen-Beuren — beliebtes Wanderziel mit Fernsicht.',
      now: 'Für Wanderer: Tier-2-Detour, wenn Beurener Heide / Albtrauf geplant ist.',
    },
    bullets: [
      'GPS Aussicht: 48.372874, 9.043982',
      'Nahe Beuren / Albtrauf — Fernsicht.',
    ],
    general:
      'Der Dreifürstenstein am Albtrauf bei Beuren ist ein klassisches Wanderziel mit grandioser Fernsicht — ideal, wenn du über die Beurener Heide hinaus die Albkante erleben willst.',
    deep: [
      {
        text: 'User-Frage: Woran erkenne ich diesen Ort? Antwort: Markierter Aussichtspunkt/Gipfelbereich am Albtrauf mit weiter Fernsicht — kein Kirchenbau, sondern Höhenpunkt.',
        tags: ['faq', 'user_question', 'visual_anchor'],
      },
      {
        text: 'Querverbindung Beurener Heide: oft in derselben Wanderlogik.',
        tags: ['querverbindung', 'wanderung'],
      },
      {
        text: 'LIVE: Wegezustand und Parkplätze am Einstieg frisch prüfen.',
        tags: ['live_hint', 'ephemeral'],
      },
    ],
    teasers: [
      'Du näherst dich dem Dreifürstenstein — Albtrauf und Fernsicht voraus.',
      'Aussichtspunkt Dreifürstenstein gleich da.',
    ],
  });

  upsert(pack, 'hechingen_panoramabad', {
    name: 'Panoramabad Hechingen (Hallen-/Freibad)',
    category: 'freizeit',
    lat: 48.3614106,
    lng: 8.9566912,
    tier: 2,
    half: 40,
    relevance: ['familie', 'freizeit', 'schlechtwetter'],
    facts: {
      origin:
        'Hallen- und Freibad Badstraße 14 — touristische Infrastruktur mit Burgblick im Außenbereich.',
      now: 'Wichtig bei längerem Aufenthalt / Familie / Schlechtwetter (Halle).',
    },
    bullets: [
      'Adresse: Badstraße 14, 72379 Hechingen.',
      'Halle + Freibad; Freibad-Blick Richtung Burg.',
    ],
    general:
      'Das Panoramabad an der Badstraße kombiniert Hallen- und Freibad — für Familien und Schlechtwettertage zentral, im Freien oft mit Blick zur Burg Hohenzollern.',
    deep: [
      {
        text: 'User-Frage: Woran erkenne ich diesen Ort? Antwort: Sport-/Badkomplex an der Badstraße mit Hallenbad-Gebäude und Außenbecken — klar Freizeitarchitektur, keine Altstadt.',
        tags: ['faq', 'user_question', 'visual_anchor'],
      },
      {
        text: 'LIVE: Öffnungszeiten Halle/Freibad, Eintritt und ob Außenbereich geöffnet ist, frisch prüfen.',
        tags: ['live_hint', 'ephemeral'],
      },
    ],
    teasers: [
      'Badstraße: Panoramabad voraus — Halle und Freibad.',
      'Eingang Hallen-/Freibad Hechingen.',
    ],
  });

  upsert(pack, 'hechingen_burgtheater_kino', {
    name: 'Burgtheater · Hechinger Kinos',
    category: 'freizeit',
    lat: 48.3498687,
    lng: 8.9634428,
    tier: 3,
    half: 18,
    relevance: ['freizeit', 'schlechtwetter', 'kultur'],
    facts: {
      origin: 'Kleines charmantes Kino im Zentrum (Heiligkreuzstraße 1) — Burgtheater / Zollernalb Kinos.',
      now: 'Tier-3: bei Regen oder Abendprogramm anbieten, nicht als Must-See aufdrängen.',
    },
    bullets: ['Adresse: Heiligkreuzstraße 1, 72379 Hechingen.'],
    general:
      'Mittem im Zentrum: das Burgtheater — kleines Stadt-Kino für Schlechtwetter und Abendprogramm, charmant statt Multiplex.',
    deep: [
      {
        text: 'User-Frage: Woran erkenne ich diesen Ort? Antwort: Kino-/Burgtheater-Beschilderung in der Heiligkreuzstraße im Zentrum — kompaktes Haus, kein Einkaufszentrum.',
        tags: ['faq', 'user_question', 'visual_anchor'],
      },
      {
        text: 'LIVE: Aktuelles Programm und Tickets frisch suchen.',
        tags: ['live_hint', 'ephemeral', 'events'],
      },
    ],
    teasers: [
      'Heiligkreuzstraße: Burgtheater/Kino voraus.',
      'Eingang Hechinger Kinos · Burgtheater.',
    ],
  });

  upsert(pack, 'hechingen_heiligkreuzkapelle_friedhof', {
    name: 'Heiligkreuzkapelle (Gottesackerkirche)',
    category: 'kirche',
    lat: 48.3394992,
    lng: 8.9719879,
    tier: 2,
    half: 30,
    relevance: ['geschichte', 'kirche'],
    facts: {
      origin:
        'Gotische Heiligkreuzkapelle (Stiftung 1403) namensgebend für den Hauptfriedhof Heiligkreuz (angelegt 1813/14) zwischen Kernstadt und Stetten.',
      architecture: 'Historische Kapelle auf dem Friedhofsgelände an der Zollerstraße.',
      now: 'Kulturgeschichtlich interessant; ruhiger Ort, oft mit Burgblick vom Friedhofsgelände.',
    },
    bullets: [
      'Friedhof Heiligkreuz, Zollerstraße.',
      'Kapelle 1403; Friedhof 1813/14 als Hauptfriedhof.',
    ],
    general:
      'Auf dem Hauptfriedhof Heiligkreuz steht die oft übersehene gotische Heiligkreuzkapelle — Gottesackerkirche mit tiefer Stadtgeschichte zwischen Kernstadt und Stetten.',
    deep: [
      {
        text: 'User-Frage: Woran erkenne ich diesen Ort? Antwort: Friedhofsgelände an der Zollerstraße mit historischer Kapelle — nicht die Stiftskirche am Kirchplatz.',
        tags: ['faq', 'user_question', 'visual_anchor'],
      },
      {
        text: 'Querverbindung Stetten/Stiftskirche: Der Friedhof entstand, als die Kirchhöfe an Stetten und St. Jakobus zu klein wurden.',
        tags: ['querverbindung', 'geschichte'],
      },
      {
        text: 'Respekt: ruhiges Verhalten auf dem Friedhof; keine lauten Teaser-Shows.',
        tags: ['meta', 'respekt'],
      },
    ],
    teasers: [
      'Zwischen Kernstadt und Stetten: Friedhof Heiligkreuz mit historischer Kapelle.',
      'Heiligkreuzkapelle auf dem Gottesacker voraus.',
    ],
  });

  upsert(pack, 'hechingen_buergergarde_gardeheim', {
    name: 'Historische Bürgergarde · Gardeheim',
    category: 'denkmal',
    lat: 48.3580371,
    lng: 8.9613663,
    tier: 2,
    half: 22,
    relevance: ['kultur', 'geschichte', 'events'],
    facts: {
      origin:
        'Historische Bürgergarde Hechingen e.V. — Tradition der alten Bürgerwehr (seit Mittelalter, neu konstituiert um 1951), zentral für Stadtfeste inkl. Irma-West.',
      now: 'Gardeheim / Vereinsadresse: Niederhechinger Straße 15/1 — Gebäude der Bürgergarde-Kultur (kein klassisches Schloss-Museum).',
    },
    bullets: [
      'Adresse: Niederhechinger Straße 15/1, 72379 Hechingen.',
      'Kulturrolle: Bürgergarde bei Irma-West und Hohenzollerntreffen.',
    ],
    general:
      'Die Historische Bürgergarde prägt Hechingens Festkultur — ihr Gardeheim an der Niederhechinger Straße ist der physische Anker der Bürgerwache. Weniger klassisches Sightseeing, mehr lebendige Stadtidentität.',
    deep: [
      {
        text: 'User-Frage: Woran erkenne ich diesen Ort? Antwort: Vereins-/Gardeheim-Gebäude an der Niederhechinger Straße mit Bürgergarde-Bezug — kein Burgturm und kein Landesmuseum.',
        tags: ['faq', 'user_question', 'visual_anchor'],
      },
      {
        text: 'Hinweis: „Schlössle“/Bürgerwache meint hier die Garde-Kultur; Innenbesichtigung nur bei Veranstaltungen/Verein — LIVE prüfen.',
        tags: ['orientierung', 'master_report'],
      },
      {
        text: 'Querverbindung Irma-West: Bürgergarde mit Fanfaren/Fahnenträgern ist Teil des großen Kinder- und Heimatfestes.',
        tags: ['querverbindung', 'events'],
      },
      {
        text: 'LIVE: Ob das Gardeheim öffentlich zugänglich ist oder nur bei Festen, anfragen.',
        tags: ['live_hint', 'ephemeral'],
      },
    ],
    teasers: [
      'Niederhechinger Straße: Gardeheim der Historischen Bürgergarde voraus.',
      'Zugang Historische Bürgergarde · Gardeheim.',
    ],
  });

  upsert(pack, 'hechingen_wasserturm_sickingen', {
    name: 'Wasserturm Sickingen',
    category: 'aussicht',
    lat: 48.379146,
    lng: 8.9731105,
    tier: 3,
    half: 22,
    relevance: ['architektur', 'orientierung'],
    facts: {
      origin: 'Markanter Wasserturm in Hechingen-Sickingen — weithin sichtbarer Vertikalanker.',
      now: 'Tier-3-Kurzabstecher / Orientierung, kein klassisches Must-See.',
    },
    bullets: ['Adressebereich: Achalmstraße, Hechingen-Sickingen.'],
    general:
      'In Sickingen ragt der Wasserturm als weithin sichtbares Bauwerk — eher kurzer Architektur-/Orientierungsabstecher als Hauptattraktion.',
    deep: [
      {
        text: 'User-Frage: Woran erkenne ich diesen Ort? Antwort: Hoher zylindrischer Wasserturm über den Dächern von Sickingen — klarer Vertikalpunkt.',
        tags: ['faq', 'user_question', 'visual_anchor'],
      },
      {
        text: 'Relevanz Tier 3: nur bei Interesse an Stadtteilen/Architektur anbieten.',
        tags: ['place_tier', 'relevance'],
      },
    ],
    teasers: [
      'Sickingen: der Wasserturm zeichnet sich als Vertikalpunkt ab.',
      'Wasserturm Sickingen voraus.',
    ],
  });

  // Events special category → _live_research + city history deep
  pack._live_research = pack._live_research || [];
  const events = [
    {
      id: 'hechingen_live_irma_west',
      label: 'Irma-West-Fest',
      prompt:
        'LIVE: Irma-West-Kinder- und Heimatfest in Hechingen — ob es in der aktuellen Saison/Termin stattfindet, Programm und Straßenperren frisch recherchieren (meist Sommer/Juli). Nie Pack-Jahr als Wahrheit vorlesen.',
      tags: ['live', 'events', 'irma_west'],
    },
    {
      id: 'hechingen_live_burg_events',
      label: 'Burg-Events',
      prompt:
        'LIVE: Sternschnuppen-Nächte, Königlicher Weihnachtsmarkt und sonstige Sonder-Events auf der Burg Hohenzollern — Termine und Tickets aktuell suchen.',
      tags: ['live', 'events', 'burg'],
    },
  ];
  const ids = new Set(pack._live_research.map((x) => x.id));
  for (const e of events) {
    if (!ids.has(e.id)) pack._live_research.push(e);
  }
  pack._events = {
    note: 'Ephemere Anreise-Gründe — nie als feste Pack-Termine hardcoden; immer LIVE prüfen.',
    items: [
      {
        id: 'irma_west',
        name: 'Irma-West-Kinder- und Heimatfest',
        typical: 'meist Juli',
        live_id: 'hechingen_live_irma_west',
      },
      {
        id: 'sternschnuppen',
        name: 'Sternschnuppen-Nächte Burg Hohenzollern',
        typical: 'saisonal',
        live_id: 'hechingen_live_burg_events',
      },
      {
        id: 'weihnachtsmarkt_burg',
        name: 'Königlicher Weihnachtsmarkt Burg Hohenzollern',
        typical: 'Advent',
        live_id: 'hechingen_live_burg_events',
      },
    ],
  };

  const hist = pack.trigger_points.find((t) => t.id === 'hechingen_stadtgeschichte');
  if (hist) {
    pushDeep(
      hist,
      'Sonder-Events (LIVE): Irma-West-Fest, Sternschnuppen-Nächte und Königlicher Weihnachtsmarkt auf der Burg — nur nach aktueller Recherche nennen.',
      ['events', 'live_hint', 'ephemeral'],
    );
  }

  const gate = runQualityGate(pack, { strict: false });
  const byTier = { 1: 0, 2: 0, 3: 0 };
  for (const s of pack.spots) byTier[s.place_tier || 2]++;
  console.log(
    `[highlights] spots=${pack.spots.length} tiers=${JSON.stringify(byTier)} ok=${gate.ok} err=${gate.errors.length} needsNarr=${gate.gaps.needsNarration.length}`,
  );

  if (hasFlag('apply') || !hasFlag('dry')) {
    const file = savePack(pack, { bumpVersion: true });
    console.log('[highlights] wrote', file, 'v' + pack.data_version);
  }
}

main();
