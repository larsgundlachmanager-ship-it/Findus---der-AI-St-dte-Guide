#!/usr/bin/env node
/**
 * Merge Pinneberg + Prisdorf hyperlocal master report into both packs.
 *   node scripts/cityPack/mergePinnebergMaster.mjs --apply
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  STAEDTE_DIR,
  boxPolygon,
  hasFlag,
  loadEnvFile,
  loadPack,
  offset,
  savePack,
} from './lib.mjs';
import { interestTagsForCategory } from './placeCategoryPolicy.mjs';
import { runQualityGate } from './qualityGate.mjs';

loadEnvFile();

function pushDeep(trigger, text, tags) {
  if (!text || text.length < 12) return;
  trigger.deep_data_pool = trigger.deep_data_pool || [];
  const key = text.slice(0, 88).toLowerCase();
  if (
    trigger.deep_data_pool.some(
      (d) => String(d.text || d).slice(0, 88).toLowerCase() === key,
    )
  ) {
    return;
  }
  trigger.deep_data_pool.push({ text, tags });
}

function faq(q, a) {
  return `User-Frage: ${q}? Antwort: ${a}`;
}

function setGeo(spot, trigger, lat, lng, halfM) {
  trigger.lat = lat;
  trigger.lng = lng;
  trigger.radius_m = halfM;
  trigger.trigger_kind = 'area';
  spot.polygonCoordinates = boxPolygon(lat, lng, halfM);
  trigger.polygon = spot.polygonCoordinates.map((p) => ({
    lat: p.latitude,
    lng: p.longitude,
  }));
}

function ensureSpot(pack, id, cfg) {
  let spot = pack.spots.find((s) => s.id === id);
  let trigger = pack.trigger_points.find((t) => t.id === id);
  if (!spot) {
    spot = {
      id,
      name: cfg.name,
      category: cfg.category,
      district: cfg.district || cfg.category,
      tags: [],
      bullets: [],
      facts: {},
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
      radius_m: 24,
      general_info: '',
      deep_data_pool: [],
    };
    pack.trigger_points.push(trigger);
  }
  spot.name = cfg.name;
  spot.category = cfg.category;
  spot.pack_role = cfg.role || 'story';
  spot.place_tier = cfg.tier;
  spot.relevance = cfg.relevance || interestTagsForCategory(cfg.category);
  spot.tags = [
    ...new Set([
      ...(spot.tags || []),
      ...interestTagsForCategory(cfg.category),
      'module1',
      `tier${cfg.tier}`,
      spot.pack_role,
      'master_report',
    ]),
  ];
  if (spot.pack_role === 'directory') {
    spot.tags = [
      ...new Set([
        ...spot.tags,
        'directory',
        'tier4',
        'offline_lookup',
        'amenity_skip',
      ]),
    ];
  }
  setGeo(spot, trigger, cfg.lat, cfg.lng, cfg.halfM || (cfg.tier === 1 ? 30 : 22));
  if (cfg.general) trigger.general_info = cfg.general;
  if (cfg.facts) spot.facts = { ...(spot.facts || {}), ...cfg.facts };
  if (cfg.bullets) spot.bullets = cfg.bullets;
  if (cfg.teasers?.length) {
    spot.approach_triggers = cfg.teasers.map((t, i) => {
      const m = t.m || [55, 28, 12][i] || 30;
      const p = offset(cfg.lat, cfg.lng, -m * 0.55, i * 3);
      return {
        id: `${id}_approach_${i + 1}`,
        lat: p.lat,
        lng: p.lng,
        radius_m: Math.min(38, Math.max(12, Math.round(m * 0.35))),
        teaser_text: t.text,
        condition_rule: 'always',
        cascade_distance_m: m,
      };
    });
  }
  for (const [q, a] of cfg.faqs || []) {
    pushDeep(trigger, faq(q, a), ['faq', 'user_question']);
  }
  for (const [text, tags] of cfg.deep || []) {
    pushDeep(trigger, text, tags);
  }
  return { spot, trigger };
}

function demoteByName(pack, rx) {
  for (const s of pack.spots) {
    if ((s.tags || []).includes('master_report') && s.pack_role === 'story') {
      continue;
    }
    if (rx.test(s.name) || rx.test(s.id)) {
      s.pack_role = 'directory';
      s.place_tier = 4;
      s.tags = [
        ...new Set([...(s.tags || []), 'directory', 'tier4', 'amenity_skip']),
      ];
    }
  }
}

function pushQa(pack, items) {
  pack._offline_qa = pack._offline_qa || [];
  const seen = new Set(pack._offline_qa.map((e) => String(e.q || '').toLowerCase()));
  for (const e of items) {
    if (seen.has(e.q.toLowerCase())) continue;
    pack._offline_qa.push({
      ...e,
      tags: ['offline_qa', 'master_report', ...(e.tags || [])],
    });
  }
}

function refreshIndex(pack) {
  pack._pack_index = {
    total: pack.spots.length,
    story: pack.spots.filter((s) => s.pack_role !== 'directory').length,
    directory: pack.spots.filter((s) => s.pack_role === 'directory').length,
    offline_qa: (pack._offline_qa || []).length,
    note: 'UI: Gesamtzahl; Trigger Story Tier 1–2 (+ Interesse).',
  };
}

function mergePinneberg(pack) {
  pack._city_history =
    'Pinnebergs urbane Genese reicht bis in die Eisenzeit — 2016 Langhaus-Fund am Ratsberg nahe einer Bestattungsstätte. Um 1200 romanische Burg an der Mühlenstraße; 1370 Eroberung durch Graf Adolf VIII. von Schauenburg. 1351 Ersterwähnung als „Pinnenberghe“. 1472 Renaissanceschloss als Sitz Holstein-Pinneberg; 1658 Brand durch schwedische Truppen, 1720 Abriss der Ruinen auf dänischen Befehl. An die Stelle trat die Drostei (1765–67) als Machtzentrum. Das 20. Jh. prägte die ILO-Motorenwerke (größter deutscher Zweitaktmotoren-Produzent 1913–1990); Thesdorf wurde 1928 eingemeindet und ab den 1960er/70er Jahren stark verdichtet (S-Bahn 1967). Heute: Pendlerstadt in der Metropolregion Hamburg (HVV/S3).';

  // Stadtgeschichte spot
  {
    const t = pack.trigger_points.find((x) => x.id === 'pinneberg_stadtgeschichte');
    if (t) {
      t.general_info = pack._city_history;
      pushDeep(
        t,
        'Sozialräumlich in den 1930ern: westlich der Bahn („Klein-Moskau“) kommunistisch geprägt; Pinneberg-Nord/Wupperman eher sozialdemokratisch; Waldenau mit Laubensiedlungen der Weltwirtschaftskrise.',
        ['geschichte', 'stadtteile'],
      );
      pushDeep(
        t,
        'Thesdorf: Eingemeindung 07.01.1928 (1148 ha); 1965–75 städtebauliche Transformation; Walter Sauermilch Hochhauskomplex (~400 Wohnungen, 17 Stockwerke — höchstes Gebäude der Stadt); S-Bahn-Station ab 23.09.1967.',
        ['thesdorf', 'geschichte'],
      );
    }
  }

  ensureSpot(pack, 'pinneberg_die_drostei', {
    name: 'Die Drostei',
    category: 'museum',
    lat: 53.6615,
    lng: 9.7968,
    tier: 1,
    halfM: 28,
    general:
      'Bedeutendstes profanes Barock-Baudenkmal im Kreis Pinneberg: 1765–1767 als Wohn- und Amtsgebäude des Landdrosten Hans von Ahlefeldt für die dänische Herrschaft Pinneberg errichtet (Zuschreibung oft Ernst Georg Sonnin; auch Cai Dose/Greggenhofer werden diskutiert). Bis 1933 preußische Landräte; Raumfolge mit hölzerner Treppe und Enfilade der Salons weitgehend erhalten. 1933 obere Räume von der SA als Standartenhaus genutzt, Erdgeschoss Katasteramt. 1984–1991 restauriert; heute Kreiskulturzentrum unter Denkmalschutz. Vorplatz = historische Thing-/Gerichtsstätte mit Schwursteinen; LIVE Kulturprogramm und Tickets.',
    facts: {
      origin:
        '1765–67 Bau für Hans von Ahlefeldt (1710–1780); dänischer König 1769 vor Ort; Dingstätte 23.',
      architecture:
        'Backstein-Barock, kühle Sonnin-Formensprache; Sterne am Portal eher dekorativ; Enfilade mit Stoffwandbespannungen nach historischen Vorbildern.',
      now: 'Kreiskulturzentrum / Ausstellungen; nicht barrierefrei. LIVE Öffnung und Eintritt prüfen.',
      tags: ['museum', 'barock', 'denkmal'],
    },
    bullets: [
      'Vorplatz: ehemalige Thingstätte mit Schwursteinen.',
      'Querverbindung: Stadtmuseum direkt nebenan (Altes Amtsgericht).',
    ],
    teasers: [
      { m: 100, text: 'Barockes Ziegelpalais an der Dingstätte — Kontrast zur modernen Bebauung.' },
      { m: 30, text: 'Vorplatz mit Schwursteinen: hier lag einst die Gerichtsstätte unter freiem Himmel.' },
      { m: 5, text: 'Am Eingangsportal: dekorative Sterne und der Zugang zum Kulturzentrum.' },
    ],
    faqs: [
      [
        'Woran erkenne ich diesen Ort',
        'Am barocken Backstein-Palais Dingstätte 23 mit Vorplatz — nicht am Wasserturm',
      ],
      [
        'Was war die Drostei',
        'Amts- und Wohnhaus des Landdrosten für die dänische Herrschaft Pinneberg, später Landratsitz',
      ],
      [
        'Querverbindung Stadtmuseum',
        'Unmittelbar nebenan Dingstätte 25 — ehemaliges Justiz-/Amtsgebäude von 1854/55',
      ],
    ],
    deep: [
      [
        'LIVE: Ausstellungen typisch Mi–So; Bürozeiten und Eintrittspreise nie aus dem Pack vorlesen.',
        ['live_hint', 'ephemeral'],
      ],
      [
        'LIVE: SummerJazz nutzt den Drostei-Vorplatz als Hauptbühne — Termine/Pins frisch prüfen.',
        ['live_hint', 'kultur', 'ephemeral'],
      ],
    ],
  });

  // Keep GPS if already better — only overwrite if missing-ish
  {
    const t = pack.trigger_points.find((x) => x.id === 'pinneberg_die_drostei');
    const s = pack.spots.find((x) => x.id === 'pinneberg_die_drostei');
    if (t && typeof t.lat === 'number' && t.lat > 53.65 && t.lat < 53.67) {
      /* keep existing pin */
      if (s) setGeo(s, t, t.lat, t.lng, t.radius_m || 28);
    }
  }

  ensureSpot(pack, 'pinneberg_stadtmuseum', {
    name: 'Stadtmuseum Pinneberg',
    category: 'museum',
    lat:
      pack.trigger_points.find((x) => x.id === 'pinneberg_stadtmuseum')?.lat ||
      53.6614,
    lng:
      pack.trigger_points.find((x) => x.id === 'pinneberg_stadtmuseum')?.lng ||
      9.797,
    tier: 1,
    halfM: 22,
    general:
      'Dingstätte 25: 1854/55 als „Geschäftslocal“ der Landdrostei gebaut, um Justiz und Verwaltung zu trennen — lokal bis heute „Altes Amtsgericht“. Sammlung zur Stadtentwicklung bis WWII; Besonderheiten: original erhaltenes Behandlungs-/Atelierzimmer des Zahnarztes und Malers Rudolph Grothkop (geb. 1908 in Pinneberg), Nachlass Günther Thiersch (~40 Ölgemälde), Mineralien-/Edelsteinsammlung Johannes Görbing (~4000 Exponate). Im Untergeschoss ILO-Motoren-Kollektion — Querverbindung zum Torhaus ILO-Park.',
    facts: {
      origin: '1854/55 Justiz-/Verwaltungsbau neben der Drostei; Adresse Dingstätte 25.',
      now: 'Stadtmuseum; LIVE Öffnung. Eintritt oft Spende — frisch prüfen. Teilweise barrierefrei.',
      tags: ['museum', 'ilo', 'industrie'],
    },
    bullets: [
      'Keller: historische ILO-Motoren.',
      'Lokalname: Altes Amtsgericht.',
    ],
    teasers: [
      { m: 20, text: 'Neben der Drostei: der Backsteinbau des Alten Amtsgerichts — heute Stadtmuseum.' },
      { m: 8, text: 'Eingangsbereich Museum — Stadtgeschichte und Justiz-Erbe unter einem Dach.' },
    ],
    faqs: [
      [
        'Woran erkenne ich diesen Ort',
        'Am Gebäude Dingstätte 25 direkt neben der Drostei — „Altes Amtsgericht“',
      ],
      [
        'Was sieht man im Keller',
        'ILO-Motoren-Sammlung — Bezug zur ehemaligen Motorenfabrik / heutigem ILO-Park',
      ],
      [
        'Kostet der Eintritt',
        'LIVE prüfen — oft kostenfrei / Spende; Öffnungszeiten nicht aus dem Pack vorlesen',
      ],
    ],
    deep: [
      [
        'LIVE: Öffnung typisch Mi/Fr/Sa/So nachmittags, Do vormittags — immer frisch verifizieren.',
        ['live_hint', 'ephemeral'],
      ],
    ],
  });

  ensureSpot(pack, 'pinneberg_samlandmuseum', {
    name: 'Samlandmuseum',
    category: 'museum',
    lat:
      pack.trigger_points.find((x) => x.id === 'pinneberg_samlandmuseum')?.lat ||
      53.66,
    lng:
      pack.trigger_points.find((x) => x.id === 'pinneberg_samlandmuseum')?.lng ||
      9.79,
    tier: 2,
    general:
      'Im Alten Bürgerhaus (Fahltskamp 30): Patenschaft des Kreises Pinneberg 1951 für den ostpreußischen Kreis Fischhausen (Samland). Initiiert u. a. durch Kreisheimatpfleger Hermann Sommer mit geretteten Artefakten. Themen: samländische Steilküste, Bernstein („Samlandgold“), Vogelwarte Rossitten; Bestände u. a. Burg Lochstädt, ostpreußisches Bildarchiv. Nach Brand 2009 Überarbeitung, Wiedereröffnung 2011. Besichtigung typisch nach Anmeldung — LIVE.',
    facts: {
      origin: 'Patenschaft 1951; Museum im Alten Bürgerhaus; Neustart nach Brand 2009/2011.',
      now: 'Fahltskamp 30 — LIVE Anmeldung/Öffnung und Preise prüfen.',
      tags: ['museum', 'vertriebene', 'samland'],
    },
    teasers: [
      { m: 25, text: 'Altes Bürgerhaus am Fahltskamp — hier liegt das Samlandmuseum.' },
    ],
    faqs: [
      [
        'Woran erkenne ich diesen Ort',
        'Am Alten Bürgerhaus Fahltskamp 30 mit Samland-/Ostpreußen-Bezug — nicht Drostei',
      ],
      [
        'Brauche ich eine Anmeldung',
        'Oft ja — LIVE aktuellen Zugang prüfen',
      ],
    ],
    deep: [
      ['LIVE: Termine und Eintritt nie aus dem Pack vorlesen.', ['live_hint', 'ephemeral']],
    ],
  });

  ensureSpot(pack, 'pinneberg_wasserturm_pinneberg', {
    name: 'Wasserturm Pinneberg',
    category: 'denkmal',
    lat:
      pack.trigger_points.find((x) => x.id === 'pinneberg_wasserturm_pinneberg')
        ?.lat || 53.665,
    lng:
      pack.trigger_points.find((x) => x.id === 'pinneberg_wasserturm_pinneberg')
        ?.lng || 9.79,
    tier: 1,
    halfM: 26,
    general:
      'Peiner Weg 43: 40,85 m hoher Wasserturm von 1912 (Union-Eisenwerke / später Herman Wupperman), Blaupause Husumer Turm 1902. Konischer Backstein-Schaft auf achteckigem Sockel, auskragendes Schieferdach, Intze-Behälter ~300 m³. Vertraglich mind. 600 m³ Wasser/Tag an die Stadt; ab 1952 Stadtwerke, Betrieb 1956 eingestellt. Seit den 1990ern Privatwohnungen (Zwischendecken, Aufzug) — Innenbesichtigung ausgeschlossen; Wahrzeichen von außen.',
    facts: {
      origin: '1912 Industriewasserturm; Intze-Behälter 300 m³; Peiner Weg 43.',
      architecture:
        'Massiv-Backstein, Kegelhelm/Schieferdach, achteckiger Sockel — Skyline-Marke.',
      now: 'Kulturdenkmal in Privatbesitz; nur Außenansicht.',
      tags: ['denkmal', 'industrie', 'wahrzeichen'],
    },
    teasers: [
      { m: 120, text: 'Über der Skyline zeichnet sich der markante Kegelhelm des Wasserturms ab.' },
      { m: 10, text: 'Am Schaft: 40 Meter Backstein — früher Wasser für die Industrie, heute Wohnraum.' },
    ],
    faqs: [
      [
        'Woran erkenne ich diesen Ort',
        'Am hohen Backstein-Wasserturm mit Schiefer-Kegelhelm am Peiner Weg — kein Schlossturm',
      ],
      [
        'Kann man rein',
        'Nein — Privatwohnungen, nur Außenansicht',
      ],
    ],
    deep: [
      [
        'Querverbindung ILO/Wupperman: Industriestadt-Kapitel neben Motorenwerken und Siedlungsbau.',
        ['querverbindung', 'industrie'],
      ],
    ],
  });

  ensureSpot(pack, 'pinneberg_torhaus_ilo_park', {
    name: 'Torhaus ILO Park',
    category: 'denkmal',
    lat:
      pack.trigger_points.find((x) => x.id === 'pinneberg_torhaus_ilo_park')?.lat ||
      53.66,
    lng:
      pack.trigger_points.find((x) => x.id === 'pinneberg_torhaus_ilo_park')?.lng ||
      9.8,
    tier: 1,
    halfM: 30,
    general:
      'Heinrich Christiansen verlagerte 1913 seine 1911 in Altona gegründete Maschinenfabrik nach Pinneberg. ILO (Esperanto „gutes Werkzeug“) war 1913–1990 größter deutscher Zweitaktmotoren-Produzent (u. a. Tempo, Goliath, Hercules, Zündapp). Nach Verkaufswellen (Rockwell, Tecumseh) Produktionsende 1990. Heute ILO-Park: Gewerbe/Wohnen; Torhaus verbindet achtgeschossigen Neubau mit denkmalgeschütztem Verwaltungsbau der ehemaligen Werke. Querverbindung: ILO-Motoren im Stadtmuseum-Keller.',
    facts: {
      origin: 'ILO ab 1913 in Pinneberg; Name aus Esperanto; Produktion bis 1990.',
      now: 'ILO-Park Quartier; Torhaus = architektonischer Anker am ehemaligen Werkszugang.',
      tags: ['denkmal', 'industrie', 'ilo'],
    },
    teasers: [
      { m: 60, text: 'Am Übergang zum ILO-Park: Neubau und altes Verwaltungsgebäude am Torhaus.' },
      { m: 15, text: 'Denkmalgeschützter Werksbau — hier lief einst die Motorenproduktion.' },
    ],
    faqs: [
      [
        'Woran erkenne ich diesen Ort',
        'Am Torhaus-Ensemble aus Neubau und altem ILO-Verwaltungsbau — nicht an der Drostei',
      ],
      [
        'Was war ILO',
        'Größter deutscher Zweitaktmotoren-Hersteller 1913–1990 mit Sitz in Pinneberg',
      ],
    ],
    deep: [
      [
        'LIVE: aktuelle Nutzungen im ILO-Park frisch prüfen — keine Werksführung aus dem Pack annehmen.',
        ['live_hint', 'ephemeral'],
      ],
    ],
  });

  // Thesdorf S-Bahn
  {
    const id = 'pinneberg_bahnhof_thesdorf';
    const t = pack.trigger_points.find((x) => x.id === id);
    const s = pack.spots.find((x) => x.id === id);
    if (t && s) {
      s.pack_role = 'story';
      s.place_tier = 2;
      s.tags = [...new Set([...(s.tags || []), 'master_report', 'thesdorf', 'story'])];
      t.general_info =
        'S-Bahn-Station Pinneberg-Thesdorf seit 23.09.1967 — Pendlerknoten nach Hamburg (HVV/S3). Thesdorf war Bauerndorf, Eingemeindung 1928; ab 1965–75 starke Verdichtung inkl. Sauermilch-Hochhaus (~17 Stockwerke). LIVE Abfahrten und Störungen.';
      pushDeep(
        t,
        faq(
          'Woran erkenne ich diesen Ort',
          'An der S-Bahn-Station Thesdorf — nicht am Pinneberger Hauptbahnhof',
        ),
        ['faq', 'user_question'],
      );
      pushDeep(
        t,
        'LIVE: Fahrplan/S3 und ATO-over-ETCS-Hinweise nie als Pack-Wahrheit vorlesen.',
        ['live_hint', 'ephemeral', 'transit'],
      );
    }
  }

  // Bahnhof Pinneberg
  {
    const id = 'pinneberg_bahnhof_pr';
    const t = pack.trigger_points.find((x) => x.id === id);
    const s = pack.spots.find((x) => x.id === id);
    if (t && s) {
      s.pack_role = 'story';
      s.place_tier = 2;
      s.tags = [...new Set([...(s.tags || []), 'master_report', 'story'])];
      t.general_info =
        'Bahnhof Pinneberg mit P+R — zentraler HVV-Knoten (S3 Richtung Hamburg). LIVE Abfahrten, Störungen, P+R-Belegung. Taxen und E-Scooter-Abstellzonen im Umfeld: LIVE Apps/Geofencing.';
      pushDeep(
        t,
        'LIVE: P+R Rockvillestr. oft gebührenfrei — aktuelle Regeln prüfen. Schließfächer/City-Cards: keine verifizierten Pack-Daten.',
        ['live_hint', 'ephemeral'],
      );
    }
  }

  // Wochenmarkt
  {
    const m =
      pack.spots.find((s) => s.id === 'pinneberg_wochenmarkt_rathausvorplatz') ||
      pack.spots.find((s) => /wochenmarkt|rathauspassage/i.test(s.id + s.name));
    if (m) {
      const t = pack.trigger_points.find((x) => x.id === m.id);
      m.pack_role = 'directory';
      m.place_tier = 4;
      m.category = 'markt';
      if (t) {
        t.general_info =
          'Wochenmarkt am Rathausvorplatz/Drostei-Umfeld: regionale Produkte (u. a. Haseldorfer Marsch, Hamburger Großmarkt). LIVE: Di/Do/Sa Zentrum, Mi Waldenau — Zeiten und Beschicker frisch prüfen.';
        pushDeep(
          t,
          'LIVE: Di & Sa Rathausvorplatz typisch vormittags; Do dichter; Mi Waldenauer Marktplatz kleiner Satellit.',
          ['live_hint', 'ephemeral', 'markt'],
        );
      }
    }
  }

  // Parks / Bäder / VfL → story light or directory
  for (const id of [
    'pinneberg_drosteipark',
    'pinneberg_rosengarten_pinneberg',
    'pinneberg_waldgebiet_fahrt',
    'pinneberg_pinneberg_pinnau_park',
  ]) {
    const s = pack.spots.find((x) => x.id === id);
    const t = pack.trigger_points.find((x) => x.id === id);
    if (!s || !t) continue;
    s.pack_role = 'story';
    s.place_tier = 2;
    s.tags = [...new Set([...(s.tags || []), 'master_report', 'natur'])];
    pushDeep(
      t,
      'Kostenfrei zugängliche Naherholung in Pinneberg — LIVE Wegezustand/Events prüfen.',
      ['natur', 'live_hint'],
    );
  }

  {
    const s = pack.spots.find((x) => /bäder|baeder|burmeister/i.test(x.id + x.name));
    if (s) {
      const t = pack.trigger_points.find((x) => x.id === s.id);
      s.pack_role = 'directory';
      s.place_tier = 4;
      if (t) {
        t.general_info =
          'Bäder Pinneberg (Burmeisterallee 6): Hallenbad 50 m + Freibadbereich. LIVE Öffnung, Kasse, Urban-Sports-App, Revisionspausen (oft bis Mitte Januar).';
        pushDeep(
          t,
          'LIVE: Wassertemperaturen, Sprungturm und Kassenzeiten nie aus dem Pack vorlesen.',
          ['live_hint', 'ephemeral'],
        );
      }
    }
  }

  demoteByName(
    pack,
    /parkhaus|parkplatz|taxi |taxen|klinikum|apotheke|hotel cap|edeka|marktkauf/i,
  );

  pushQa(pack, [
    {
      q: 'Wann ist Wochenmarkt in Pinneberg?',
      a: 'LIVE: typisch Di/Do/Sa Rathausvorplatz, Mi Waldenau — aktuelle Zeiten prüfen.',
      tags: ['markt'],
    },
    {
      q: 'Was ist SummerJazz?',
      a: 'Seit 1996 Jazz-Festival am 2. Augustwochenende, u. a. Bühne am Drostei-Vorplatz; Freiluft oft kostenfrei. LIVE Programm/Pin prüfen.',
      tags: ['kultur'],
    },
    {
      q: 'Wo ist die Notaufnahme in Pinneberg?',
      a: 'Regio Klinikum Pinneberg, Fahltskamp 74 — Zentrum für Notfall- und Akutmedizin. LIVE KV-Anlaufpraxis-Zeiten prüfen.',
      tags: ['gesundheit'],
    },
    {
      q: 'Wie funktioniert E-Scooter-Parken?',
      a: 'Geofencing: Miete endet nur in virtuellen Abstellzonen (Apps TIER/Bolt/Lime/Voi). LIVE Zonen in der App.',
      tags: ['mobility'],
    },
    {
      q: 'Was war ILO in Pinneberg?',
      a: 'ILO-Motorenwerke: 1913–1990 größter deutscher Zweitaktmotoren-Produzent; heute ILO-Park mit Torhaus.',
      tags: ['geschichte'],
    },
    {
      q: 'Wo ist das Fundbüro?',
      a: 'Bürgerbüro im Rathaus Bismarckstraße 8 — LIVE Öffnung prüfen.',
      tags: ['service'],
    },
  ]);

  refreshIndex(pack);
  return pack;
}

function mergePrisdorf(pack) {
  pack._city_history =
    'Prisdorf (~2350 Einwohner) liegt nordwestlich von Pinneberg an L 107 und der Bahnlinie Hamburg–Kiel (historisch Altona-Kieler Eisenbahn / König Christian VIII. Ostseebahn, eröffnet 18.09.1844). 1990 wurde der frühere Bahnhof durch Weichenrückbau zum Haltepunkt; das Bahnhofsgebäude war schon früher abgerissen. Lokale Anker: Alte Schule von 1912 (seit 1974 Kindergarten), SAV-Angelteich am Strümploh mit Vereinsgeschichte ab 1924, Pinnau-/Bilsbek-Niederung und dörfliches Vereinsleben im Speckgürtel Hamburgs.';

  ensureSpot(pack, 'prisdorf_alte_schule_lütte_prisdörper', {
    name: 'Alte Schule & Kindergarten Lütte Prisdörper',
    category: 'geschichte',
    lat: 53.678838,
    lng: 9.756587,
    tier: 2,
    halfM: 24,
    district: 'zentrum',
    general:
      'Hauptstraße Ecke Schulstraße: 1912 als Volksschule gegründet (einst eine Klasse für alle Jahrgänge), 1974 Umbau zum Kindergarten. Ort auch als Treffpunkt der TSV-Fußballjugend im lokalen Gedächtnis; Bezug zu lokalen Jazz-Ablegern. Aktuell pädagogischer Betrieb — LIVE Öffnung. Keine öffentlichen Toiletten direkt am Gebäude.',
    facts: {
      origin: 'Volksschule 1912; Kindergarten ab 1974; Koordinaten ~53.678838, 9.756587.',
      now: 'Frühpädagogik / Kindergartenbetrieb. LIVE Zeiten prüfen.',
      tags: ['geschichte', 'bildung', 'dorfmitte'],
    },
    bullets: [
      'Zentrumsanker an Haupt-/Schulstraße.',
      'Transformationsgeschichte Schule → Kita.',
    ],
    teasers: [
      { m: 150, text: 'Von der Bahnhofsseite: hinter der Kurve an der Hauptstraße wird der Schul-/Kita-Bau sichtbar.' },
      { m: 50, text: 'Fassade des Baus von 1912 — einst die Dorfschule mit einer Klasse für alle.' },
      { m: 10, text: 'Eingangsbereich: seit 1974 Kindergarten statt Volksschule.' },
    ],
    faqs: [
      [
        'Woran erkenne ich diesen Ort',
        'Am Gebäude Hauptstraße/Schulstraße — ehemalige Volksschule, heute Kindergarten',
      ],
      [
        'Was war hier früher',
        'Ab 1912 Volksschule mit einer Klasse für alle Jahrgänge; 1974 Umbau zur Kita',
      ],
    ],
    deep: [
      [
        'LIVE: Kita-Betrieb — keine Besichtigungstour annehmen; Öffnung nur nach aktueller Quelle.',
        ['live_hint', 'ephemeral'],
      ],
    ],
  });

  ensureSpot(pack, 'prisdorf_sav_angelteich', {
    name: 'SAV Angelteich Prisdorf',
    category: 'natur',
    lat:
      pack.trigger_points.find((x) => x.id === 'prisdorf_sav_angelteich')?.lat ||
      53.68,
    lng:
      pack.trigger_points.find((x) => x.id === 'prisdorf_sav_angelteich')?.lng ||
      9.75,
    tier: 2,
    halfM: 35,
    general:
      'Am Feldweg Strümploh (Strümploh 2a): Vereinssee der Sportangler-Vereinigung Hamburg e.V. (SAV), gegründet 15.09.1924. 2024 Jahrhundertfeier. Historisch: nach 1933 versorgte die Vereinsführung ausgeschlossene jüdische Mitglieder heimlich mit kostenlosen Jahreskarten — passiver Widerstand. Teil eines Netzes von neun Vereinsseen (~300 ha). Zielfische u. a. Karpfen, Hecht, Graskarpfen; Vereinsboote für Mitglieder. LIVE: Zugang/Mitgliedschaft/Sperren bei Jugendlagern.',
    facts: {
      origin: 'SAV gegründet 15.09.1924; See in Prisdorf Teil von neun Vereinsseen.',
      now: 'Strümploh 2a — Angelbetrieb für Berechtigte; LIVE Zugang prüfen.',
      tags: ['natur', 'angeln', 'geschichte'],
    },
    teasers: [
      { m: 100, text: 'Von der Peiner Hauptstraße zweigt der unbefestigte Feldweg zum Vereinssee ab.' },
      { m: 30, text: 'Uferzone: stilles Wasser — Vereinsgewässer mit tiefer Vereinsgeschichte.' },
    ],
    faqs: [
      [
        'Woran erkenne ich diesen Ort',
        'Am Vereinssee am Feldweg Strümploh — kein öffentlicher Stadtparkteich',
      ],
      [
        'Darf jeder angeln',
        'LIVE: typisch Vereinsgewässer — Berechtigung/Regeln bei SAV prüfen',
      ],
      [
        'Was ist historisch besonders',
        '1933: heimliche Jahreskarten für ausgeschlossene jüdische Mitglieder als Akt des Widerstands',
      ],
    ],
    deep: [
      [
        'LIVE: Zeltlager/Jugendtermine können den Angelbetrieb sperren — frisch prüfen.',
        ['live_hint', 'ephemeral'],
      ],
    ],
  });

  {
    const id = 'prisdorf_bahnhof_wartehäuschen';
    const t = pack.trigger_points.find((x) => x.id === id);
    const s = pack.spots.find((x) => x.id === id);
    if (t && s) {
      s.pack_role = 'story';
      s.place_tier = 2;
      s.name = 'Haltepunkt Prisdorf';
      s.tags = [...new Set([...(s.tags || []), 'master_report', 'story', 'bahn'])];
      t.general_info =
        'Haltepunkt an der historischen Altona-Kieler Eisenbahn (König Christian VIII. Ostseebahn), eröffnet 18.09.1844 — erste Eisenbahnstrecke Schleswig-Holsteins. 1990 durch Weichenrückbau vom Bahnhof zum reinen Haltepunkt; Bahnhofsgebäude schon früher abgerissen. LIVE Abfahrten Richtung Hamburg/Elmshorn/Kiel.';
      pushDeep(
        t,
        faq(
          'Woran erkenne ich diesen Ort',
          'Am Bahnsteig-Haltepunkt Prisdorf ohne klassisches Empfangsgebäude',
        ),
        ['faq', 'user_question'],
      );
      pushDeep(
        t,
        'LIVE: Fahrplan und Störungen frisch prüfen — kein Pack-Fahrplan.',
        ['live_hint', 'ephemeral', 'transit'],
      );
      if (!(s.approach_triggers || []).length) {
        s.approach_triggers = [
          {
            id: `${id}_approach_1`,
            ...offset(t.lat, t.lng, -40, 0),
            radius_m: 22,
            teaser_text: 'Gleise und Bahnsteig — der historische Haltepunkt Prisdorf.',
            condition_rule: 'always',
            cascade_distance_m: 40,
          },
        ];
      }
    }
  }

  {
    const t = pack.trigger_points.find((x) => x.id === 'prisdorf_stadtgeschichte_gesamt');
    if (t) {
      t.general_info = pack._city_history;
      pushDeep(
        t,
        'Querverbindung Pinneberg: Pendler- und Kulturraum (Drostei, ILO, S3) — Prisdorf als nordwestlicher Satellitenknoten.',
        ['querverbindung', 'pinneberg'],
      );
    }
  }

  demoteByName(
    pack,
    /parkplatz|klinik|taxi|theater aus elmshorn|forum theater|bühnen|musical|drosteiplatz|gospelchor|wundertüte|rotes kreuz|arboretum|uetersen|mölln|nick.knives|feines leben|wolnysee|stolperstein|canondale|herman-wupperman|kriegerdenkmal am pinneberger|rosengarten$|küstengarten|ruheforst|hallenbad pinneberg|naturbad/i,
  );

  pushQa(pack, [
    {
      q: 'Was ist der SAV-Angelteich in Prisdorf?',
      a: 'Vereinssee der SAV Hamburg am Strümploh; Verein von 1924 mit bemerkenswerter Geschichte 1933. LIVE Zugang/Regeln prüfen.',
      tags: ['natur'],
    },
    {
      q: 'Wo ist die alte Schule in Prisdorf?',
      a: 'Hauptstraße/Schulstraße — 1912 Schule, seit 1974 Kindergarten Lütte Prisdörper.',
      tags: ['geschichte'],
    },
    {
      q: 'Ist Prisdorf ein Bahnhof oder Haltepunkt?',
      a: 'Seit 1990 Haltepunkt (Weichenrückbau); Gebäude früher abgerissen. LIVE Fahrplan prüfen.',
      tags: ['transit'],
    },
  ]);

  refreshIndex(pack);
  return pack;
}

function main() {
  const apply = hasFlag('apply');
  const researchPath = path.join(STAEDTE_DIR, 'pinneberg.research.json');
  let research = {};
  try {
    research = JSON.parse(fs.readFileSync(researchPath, 'utf8'));
  } catch {
    /* new */
  }
  research.master_hyperlocal_merged_at = new Date().toISOString();
  research.city_history =
    'Pinneberg: Eisenzeit-Fund Ratsberg 2016; Burg ~1200; 1351 Pinnenberghe; Schloss 1472; Brand 1658; Abriss 1720; Drostei 1765–67; ILO 1913–1990; Thesdorf 1928. Pendlerstadt HVV/S3.';
  research.master_notes = [
    'Drostei, Stadtmuseum, Samlandmuseum, Wasserturm, ILO-Park',
    'Prisdorf: Alte Schule, SAV-Angelteich, Haltepunkt 1844/1990',
    'SummerJazz / Wochenmarkt / Taxi / Klinik = LIVE/QA',
  ];
  fs.writeFileSync(researchPath, JSON.stringify(research, null, 2));

  const pin = mergePinneberg(loadPack('pinneberg'));
  const pri = mergePrisdorf(loadPack('prisdorf'));

  const g1 = runQualityGate(pin, { strict: false });
  const g2 = runQualityGate(pri, { strict: false });
  console.log(
    `[pinneberg] story=${pin._pack_index.story} dir=${pin._pack_index.directory} qa=${pin._offline_qa.length} ok=${g1.ok} err=${g1.errors.length}`,
  );
  console.log(
    `[prisdorf] story=${pri._pack_index.story} dir=${pri._pack_index.directory} qa=${pri._offline_qa.length} ok=${g2.ok} err=${g2.errors.length}`,
  );
  if (g1.gaps?.needsDeep?.length) {
    console.log('[pinneberg] thin', g1.gaps.needsDeep.slice(0, 8));
  }
  if (g2.gaps?.needsDeep?.length) {
    console.log('[prisdorf] thin', g2.gaps.needsDeep.slice(0, 8));
  }

  if (apply) {
    savePack(pin, { bumpVersion: true });
    savePack(pri, { bumpVersion: true });
    console.log('[merge] wrote pinneberg + prisdorf');
  } else {
    console.log('[merge] dry-run — add --apply');
  }
}

main();
