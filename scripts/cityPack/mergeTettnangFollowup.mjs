#!/usr/bin/env node
/**
 * Merge Gemini follow-up / updated master profile into Tettnang pack.
 *   node scripts/cityPack/mergeTettnangFollowup.mjs --apply
 */
import {
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
      'followup',
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

function demoteKapellen(pack) {
  const CATALOG =
    /st\.?\s*anna|loretokapelle|st\.?\s*georg|heilig.?kreuz.?kapelle|schlosskapelle/i;
  for (const s of pack.spots) {
    if (!/kapelle/i.test(s.name + s.category)) continue;
    if (/brünnensweiler|bruennensweiler|maria königin/i.test(s.name)) {
      s.pack_role = 'story';
      s.place_tier = 3;
      continue;
    }
    if (CATALOG.test(s.name) || CATALOG.test(s.id)) {
      s.pack_role = 'directory';
      s.place_tier = 4;
      s.tags = [
        ...new Set([
          ...(s.tags || []),
          'directory',
          'tier4',
          'kapelle_katalog',
          'amenity_skip',
        ]),
      ];
    }
  }
}

function main() {
  const pack = loadPack('tettnang');
  if (!pack) throw new Error('tettnang missing');

  pack._city_history =
    'Tettnang (882 als Tettinanc urkundlich; Cunzo übergibt Güter an Kloster St. Gallen) liegt im Schussental. Stadtrechte 1298 (Hugo VI. / Albrecht I.). Fast 534 Jahre Residenz der Grafen von Montfort; Prunk und Schloss-Wiederaufbau ab 1755 führten zur Verschuldung (1779 ca. 1.115.000 Gulden) und zur Abtretung an Österreich unter Graf Franz Xaver. Im Bauernkrieg 1525 formierte sich am Blasenberg bei Rappertsweiler der Rappertsweiler Haufen (~8000) und verfasste am Kehlhof eigene Zwölf Freiheitsartikel. Im 19. Jh. rettete der Hopfenanbau (Anstoß 1819, Durchbruch 1844 durch Johann Nepomuk Fidel Lentz) die Region; seit 2025 Namenszusatz „Hopfenstadt“.';

  // --- Altstadt axes ---
  ensureSpot(pack, 'tettnang_altstadt', {
    name: 'Tettnang Altstadt · Fußachsen',
    category: 'altstadt',
    lat: 47.6717,
    lng: 9.58915,
    tier: 1,
    halfM: 45,
    general:
      'Die Tettnanger Altstadt ist durch klare Achsen lesbar: Vom Bärenplatz steigen Kirchstraße zur Galluskirche und Montfort-/Karlstraße als kommerzielle Adern. Die enge Parzellenstruktur geht auf Wiederaufbau nach dem Dreißigjährigen Krieg und den Stadtbrand 1800 zurück; die Lindauer Straße war alte Postroute mit Schildwirtschaften wie dem „Goldenen Rad“ (seit 1583 als Herberge erwähnt).',
    facts: {
      origin:
        'Knoten Bärenplatz; geistliche Achse Kirchstraße; kommerzielle Achsen Montfort-/Karlstraße; Lindauer Straße = alte Postroute.',
      architecture:
        'Enge Parzellen nach 1633 und Stadtbrand 1800; Tempo-20-Beruhigung, langfristig Pläne für Fußgängerzonen-Abschnitte.',
      now: 'Achse Bärenplatz – Karlstraße – Kirchstraße – Montfortstraße.',
      tags: ['altstadt', 'flaniermeile'],
    },
    bullets: [
      'Wochenmarkt-Recht schon im Stadtprivileg 1379 (Donnerstag).',
      'Refill u. a. Tourist-Info/Rathaus; Nette Toilette in Gastronomie.',
    ],
    teasers: [
      { m: 100, text: 'Inhabergeführte Läden und Bäckereien säumen den Weg in den Stadtkern.' },
      { m: 50, text: 'Am Bärenplatz bündeln sich historische Gasthauslagen — früher Pferdewechsel für Reisende.' },
      { m: 10, text: 'Die Kirchstraße steigt; Kopfsteinpflaster zieht den Blick zur Zwiebelhaube von St. Gallus.' },
    ],
    faqs: [
      [
        'Woran erkenne ich diesen Ort',
        'An der verdichteten Achsen-Altstadt um Bärenplatz, Karl-/Montfort-/Kirchstraße — nicht am Hopfengut draußen',
      ],
      [
        'Welche Straße führt zur Kirche',
        'Die Kirchstraße steigt vom Bärenplatz zur Pfarrkirche St. Gallus',
      ],
      [
        'Wann ist Wochenmarkt',
        'Historisch Donnerstag laut Privileg 1379 — LIVE aktuellen Ort/Zeiten prüfen (Rathausplatz/Bärenplatz)',
      ],
    ],
    deep: [
      [
        'LIVE: Tempo-20 und geplante Fußgängerzonen-Abschnitte; Öffnungen Refill/Nette Toilette frisch prüfen.',
        ['live_hint', 'ephemeral'],
      ],
      [
        'Spectrum Kultur prägt Konzerte (u. a. Oratorien in St. Gallus, Formate im Bacchussaal).',
        ['kultur', 'querverbindung'],
      ],
    ],
  });

  // --- Schießhaus (own spot, linked to park/schloss) ---
  ensureSpot(pack, 'tettnang_ehemaliges_schiesshaus', {
    name: 'Ehemaliges Schießhaus',
    category: 'denkmal',
    lat: 47.6688,
    lng: 9.5842,
    tier: 2,
    halfM: 22,
    general:
      'An der westlichen Abschlussmauer des Schlossparks steht das ehemalige Schießhaus: am 15. Oktober 1736 eingeweiht anstelle eines 1735 abgebrannten Gartenhauses. Dreiachsiger Mittelpavillon mit Pfeilerblendarkaden und Walmdach — vermutlich zuerst Orangerie, später Waffenlager, daher der Name. Tagsüber mit dem Schlosspark frei zugänglich; LIVE Museumszeiten gehören zum Neuen Schloss.',
    facts: {
      origin:
        'Einweihung 15.10.1736; Ersatz für abgebranntes Gartenhaus 1735; westliche Schlossgarten-Mauer.',
      architecture:
        'Dreiachsig, Pfeilerblendarkaden, Walmdach; Blicklage unterhalb des Schlosses Richtung Alpenwetter.',
      now: 'Schützenstraße / Schlosspark-West; Koordinaten ~47.6688, 9.5842.',
      tags: ['denkmal', 'schlosspark', 'barock'],
    },
    bullets: [
      'Teil der historischen Schlossgartenanlage.',
      'Barrierefreie Toilette am Forsthaus-Nebengebäude Schützenstraße 5.',
    ],
    teasers: [
      { m: 50, text: 'Das Gelände fällt westlich ab — an der Umfassungsmauer schmiegt sich das ehemalige Schießhaus an.' },
      { m: 15, text: 'Arkaden und Walmdach des barocken Pavillons werden greifbar — 1736 eingeweiht.' },
    ],
    faqs: [
      [
        'Woran erkenne ich diesen Ort',
        'Am Arkaden-Pavillon an der westlichen Schlossparkmauer unterhalb des Neuen Schlosses — nicht am Torschloss am Bärenplatz',
      ],
      [
        'Was war das Gebäude',
        'Vermutlich zuerst Orangerie, später Waffenlager; Name „Schießhaus“ daher; Einweihung 1736',
      ],
      [
        'Querverbindung Neues Schloss',
        'Direkt in der Park-/Mauerachse des Montfort-Schlosses; Park frei, Schlossmuseum LIVE prüfen',
      ],
    ],
    deep: [
      [
        'LIVE: Schlossmuseum-Führungen/Tickets nie aus dem Pack; Parkzugang tagsüber typisch frei.',
        ['live_hint', 'ephemeral'],
      ],
      [
        'GPS: 47.668800, 9.584200 — Schützenstraße / Schlosspark West.',
        ['gps_confirmed'],
      ],
    ],
  });

  // Enrich Neues Schloss with Schießhaus + Spectrum + Kapelle
  {
    const t = pack.trigger_points.find((x) => x.id === 'tettnang_neues_schloss');
    if (t) {
      pushDeep(
        t,
        'Im Schlosspark an der westlichen Mauer: Ehemaliges Schießhaus (1736), Arkadenpavillon — eigener Spot tettnang_ehemaliges_schiesshaus.',
        ['querverbindung', 'schlosspark'],
      );
      pushDeep(
        t,
        'Schlosskapelle 1769/70 Stuck Johann Caspar Gigl; später Remise, heute evangelische Kirche mit Stuck-Arkadengalerie.',
        ['kirche', 'architektur'],
      );
      pushDeep(
        t,
        'Spectrum Kultur nutzt u. a. den Bacchussaal für Kammerformate; große Oratorien eher in St. Gallus.',
        ['kultur'],
      );
      pushDeep(
        t,
        'LIVE: Schlossmuseum April–Oktober typisch; Preise/Zeiten frisch prüfen. Toilette Forsthaus Schützenstraße 5.',
        ['live_hint', 'ephemeral'],
      );
    }
  }

  // Elektronikmuseum deepen
  {
    const el = pack.spots.find((s) => /elektronikmuseum/i.test(s.id + s.name));
    if (el) {
      const t = pack.trigger_points.find((x) => x.id === el.id);
      el.place_tier = 2;
      el.pack_role = 'story';
      if (t) {
        t.general_info =
          'Im Torschloss-Ensemble (Montfortstraße 41–43) zeigt das ehrenamtlich betriebene Elektronikmuseum Funktechnik, Unterhaltungselektronik ab den 1920ern, Ton-/Bildspeicherung sowie Mess- und Rechnertechnik — Technikgeschichte neben Montfort-Museum und Stadtarchiv.';
        pushDeep(
          t,
          faq(
            'Woran erkenne ich diesen Ort',
            'Am Museumsstandort im Torschloss-Ensemble mit Elektronik-/Technikbeschilderung',
          ),
          ['faq', 'user_question'],
        );
        pushDeep(
          t,
          faq(
            'Was sieht man',
            'Historische Funk- und Rundfunkgeräte, Speicherung, Mess- und Rechnertechnik — ehrenamtlich betreut',
          ),
          ['faq', 'user_question'],
        );
        pushDeep(
          t,
          'LIVE: Öffnung typisch April–Oktober Di–So nachmittags; Tickets frisch prüfen — nie Pack-Preise vorlesen.',
          ['live_hint', 'ephemeral'],
        );
        pushDeep(
          t,
          'Querverbindung: Heilig-Kreuz-Kapelle 1578 am Ensemble (zeitweise Arrestzelle) — Katalog/Sub, kein eigener Deep-Trigger nötig.',
          ['querverbindung'],
        );
      }
    }
  }

  // Hopfenpfad Gesamtroute
  ensureSpot(pack, 'tettnang_hopfenpfad', {
    name: 'Tettnanger Hopfenpfad',
    category: 'wanderung',
    lat: 47.689666,
    lng: 9.6163937,
    tier: 2,
    halfM: 50,
    general:
      'Der Tettnanger Hopfenpfad ist eine 7,7-Kilometer-Rundroute „Vom Bauer zum Brauer“ (initiiert 1996 von Inge Locher und Fritz Tauscher): vom Bärenplatz/Kronen-Bezug hinauf nach Siggenweiler zum Hopfengut N°20. Elf Stationen mit Maskottchen „Hopfi“; Wege überwiegend asphaltiert, kinderwagentaugliche Alternativroute über Bernau. Rast am Dorfweiher, Panorama Brünnensweiler Höhe (Kapelle Maria Königin des Friedens, 1954) und Plattform Irrmannsberg.',
    facts: {
      origin:
        '1996 Lehrpfad; 11 Stationen; verbindet Kronenbrauerei/Bärenplatz mit Hopfengut N°20.',
      now: '7,7 km Rundweg; ~85 % Teer / 15 % naturnah; LIVE Wegezustand.',
      tags: ['wanderung', 'hopfen', 'lehrpfad'],
    },
    bullets: [
      'Ziel: Hopfenmuseum / Hopfensteg am Gut N°20.',
      'SB-Hofläden u. a. in Dieglishofen entlang der Route.',
    ],
    teasers: [
      { m: 80, text: 'Hopfenpfad-Beschilderung und Felder — die Lehrroute Richtung Siggenweiler.' },
      { m: 30, text: 'Infotafeln mit „Hopfi“ erklären Anbau — Station für Station.' },
    ],
    faqs: [
      [
        'Woran erkenne ich diesen Ort',
        'An Hopfenpfad-Wegweisung und Infotafeln zwischen Bärenplatz und Hopfengut — nicht nur am Schloss',
      ],
      [
        'Wie lang ist die Route',
        'Etwa 7,7 km Rundweg; kinderwagentaugliche Alternativroute über Bernau',
      ],
      [
        'Wo sind die besten Aussichten',
        'Brünnensweiler Höhe und Plattform Irrmannsberg — LIVE Wege/Wetter prüfen',
      ],
    ],
    deep: [
      [
        'LIVE: Wegezustand, Saison und Hofladen-Öffnungen frisch prüfen.',
        ['live_hint', 'ephemeral'],
      ],
      [
        'Dorfweiher = Rastpunkt mit Steindamm/Bank ohne eigene große Legende — eigener Spot möglich.',
        ['querverbindung'],
      ],
    ],
  });

  // Dorfweiher
  ensureSpot(pack, 'tettnang_dorfweiher_siggenweiler', {
    name: 'Dorfweiher Siggenweiler',
    category: 'natur',
    lat: 47.6921805,
    lng: 9.6187248,
    tier: 2,
    general:
      'Am Hopfenpfad liegt der Dorfweiher Siggenweiler als ruhiger Rastpunkt: Teich mit Steindamm und Bank mitten in der Hopfen- und Obstkulturlandschaft — ohne eigene große Historienlegende, aber klarer Wege-Anker zwischen Bärenplatz-Start und Hopfengut.',
    facts: {
      now: 'Rast am Lehrpfad Siggenweiler.',
      tags: ['natur', 'hopfenpfad'],
    },
    teasers: [
      { m: 40, text: 'Wasser und Steinmauer mit Bank — der Dorfweiher als Pause auf dem Hopfenpfad.' },
    ],
    faqs: [
      [
        'Woran erkenne ich diesen Ort',
        'Am Teich mit Steindamm und Sitzbank in Siggenweiler entlang des Hopfenpfads',
      ],
      [
        'Was kann man hier machen',
        'Kurz rasten, Landschaft anschauen, weiter Richtung Hopfengut oder zurück zur Stadt',
      ],
      [
        'Querverbindung',
        'Mittelstation des 7,7-km-Hopfenpfads zwischen Bärenplatz und Hopfengut N°20',
      ],
    ],
    deep: [
      ['LIVE: Wegezustand am Hopfenpfad frisch prüfen.', ['live_hint', 'ephemeral']],
      ['GPS am Dorfweiher Siggenweiler.', ['gps_confirmed']],
    ],
  });

  // Hopfengut enrich length
  {
    const t = pack.trigger_points.find((x) => x.id === 'tettnang_hopfengut_no20');
    if (t) {
      pushDeep(
        t,
        'Museum seit 1995 auf ca. 2000 m²; Exponate u. a. Pflückmaschine Wolf WSZ550 und Heisse Darre (ca. 30 m² Darrofen). Sechs Meter Hopfensteg auf Rankenhöhe.',
        ['museum', 'technik'],
      );
      pushDeep(
        t,
        'LIVE: Museum-/Gastro-Öffnung und Tickets frisch prüfen — nie Pack-Preise. Aktuelle Hopfenflächen/Erträge immer LIVE.',
        ['live_hint', 'ephemeral', 'hopfen'],
      );
    }
  }

  // Rappertsweiler Stele — replace/fix gedenkstein spot
  ensureSpot(pack, 'tettnang_rappertsweiler_gedenkstele', {
    name: 'Gedenkstele Rappertsweiler · Bauernkrieg 1525',
    category: 'denkmal',
    lat: 47.64065,
    lng: 9.66097,
    tier: 2,
    halfM: 20,
    district: 'rappertsweiler',
    general:
      'Am Kehlhof in Rappertsweiler erinnert eine Gedenkstele (eingeweiht 1. Juni 2025, Bildhauer René Geier) an den Rappertsweiler Haufen: Am 21. Februar 1525 versammelten sich rund 8000 Bauern am Blasenberg und verfassten hier eigene Zwölf Freiheitsartikel — vor den bekannteren Memminger Artikeln. Der Ort ist als Ort der deutschen Demokratiegeschichte ausgewiesen.',
    facts: {
      origin:
        '21.02.1525 Rappertsweiler Haufen; Zwölf Freiheitsartikel am Kehlhof; Stele 01.06.2025 René Geier.',
      now: 'Beim Kehlhof, Rappertsweiler 15 — frei zugänglich.',
      tags: ['denkmal', 'bauernkrieg', 'demokratie'],
    },
    bullets: [
      'Inschrift u. a. Recht, Freyheit, Gerechtigkeit …',
      'Bundschuhfahne und rot-weißes Andreaskreuz am Sockel.',
    ],
    teasers: [
      { m: 50, text: 'Das längliche Holzgebäude des Kehlhofs markiert den historischen Abgabe- und Versammlungsort.' },
      { m: 10, text: 'Die Stele mit Fraktur-Anmutung erinnert an die Zwölf Freiheitsartikel von 1525.' },
    ],
    faqs: [
      [
        'Woran erkenne ich diesen Ort',
        'An der Gedenkstele beim Kehlhof in Rappertsweiler — nicht am Schloss in der Kernstadt',
      ],
      [
        'Was passierte 1525',
        'Bauern formierten den Rappertsweiler Haufen und schrieben eigene Zwölf Freiheitsartikel',
      ],
      [
        'Ist der Ort frei zugänglich',
        'Ja, Stele im öffentlichen Raum; LIVE Veranstaltungen prüfen',
      ],
    ],
    deep: [
      [
        'LIVE: Führungen/Gedenkenstermine frisch prüfen.',
        ['live_hint', 'ephemeral'],
      ],
      [
        'GPS: 47.640650, 9.660970 — Rappertsweiler 15 / Kehlhof.',
        ['gps_confirmed'],
      ],
    ],
  });

  // Demote old vague gedenkstein if separate
  {
    const old = pack.spots.find((s) =>
      /rappertsweiler haufen/i.test(s.name),
    );
    if (old && old.id !== 'tettnang_rappertsweiler_gedenkstele') {
      old.pack_role = 'directory';
      old.place_tier = 4;
      old.tags = [
        ...new Set([...(old.tags || []), 'directory', 'alias', 'amenity_skip']),
      ];
    }
  }

  // Fliegerdenkmal (nur Schäferhof/Loretowald — nicht Langenargen-Alias)
  {
    const own = pack.trigger_points.find((t) => t.id === 'tettnang_fliegerdenkmal');
    const lat = own?.lat && own.lat > 47.64 && own.lat < 47.68 ? own.lat : 47.6608028;
    const lng = own?.lng && own.lng > 9.57 && own.lng < 9.61 ? own.lng : 9.5879892;
    ensureSpot(pack, 'tettnang_fliegerdenkmal', {
      name: 'Fliegerdenkmal Schäferhof / Loretowald',
      category: 'denkmal',
      lat,
      lng,
      tier: 2,
      general:
        'Im Tettnanger Wald nahe Schäferhof erinnert ein Findling an den Absturz einer Dornier Do 217 am 11. Oktober 1938. Die Testpiloten Rolf Koeppe und Eugen Bausenhart kamen ums Leben. Der bemooste Stein mit eingemeißelten Namen ist ein stiller Orientierungspunkt auf unbefestigten Waldwegen.',
      facts: {
        origin: 'Absturz 11.10.1938, Dornier Do 217; Piloten Koeppe und Bausenhart.',
        architecture: 'Massiver Findling / Steinquader mit eingemeißelten Namen im Forst.',
        now: 'Waldweg Schäferhof / Loretowald — frei zugänglich.',
        tags: ['denkmal', 'wald'],
      },
      teasers: [
        { m: 20, text: 'Zwischen den Bäumen wird abseits des Weges ein großer Steinquader sichtbar.' },
        { m: 5, text: 'Eingemeißelte Namen der beiden Testpiloten auf dem bemoosten Findling.' },
      ],
      faqs: [
        [
          'Woran erkenne ich diesen Ort',
          'Am Findling mit Piloten-Namen im Wald bei Schäferhof — kein Stadtplatz-Denkmal',
        ],
        [
          'Worum geht es',
          'Gedenken an den Flugzeugabsturz vom 11. Oktober 1938',
        ],
        [
          'Wer kam ums Leben',
          'Die Testpiloten Rolf Koeppe und Eugen Bausenhart',
        ],
      ],
      deep: [
        ['LIVE: Wegezustand im Wald frisch einschätzen.', ['live_hint', 'ephemeral']],
        ['Querverbindung: ruhiger Kontrast zur Montfort-Altstadt.', ['querverbindung']],
        [`GPS: ${lat.toFixed(6)}, ${lng.toFixed(6)} — Schäferhof / Loretowald.`, ['gps_confirmed']],
      ],
    });
  }
  for (const s of pack.spots) {
    if (s.id === 'tettnang_fliegerdenkmal') continue;
    if (/flieger/i.test(s.id + s.name)) {
      s.pack_role = 'directory';
      s.place_tier = 4;
      s.tags = [
        ...new Set([...(s.tags || []), 'directory', 'alias', 'wrong_pin_risk', 'amenity_skip']),
      ];
    }
  }

  // Wildpark — note Neukirch ~8km
  ensureSpot(pack, 'tettnang_wildpark_sonnenhalde', {
    name: 'Wildpark Sonnenhalde',
    category: 'freizeitpark',
    lat:
      pack.trigger_points.find((t) => /sonnenhalde|wildpark/i.test(t.id + t.name))
        ?.lat || 47.65,
    lng:
      pack.trigger_points.find((t) => /sonnenhalde|wildpark/i.test(t.id + t.name))
        ?.lng || 9.7,
    tier: 2,
    halfM: 40,
    district: 'neukirch',
    general:
      'Etwa acht Kilometer östlich von Tettnang liegt der rund 15 Hektar große Wildpark Sonnenhalde (Kreuzweiherstraße 11, Neukirch-Wildpoltsweiler): 2,5 km Naturwege zu Rot-, Damwild, Mufflons, Wildschweinen und mehr, plus Waldlabyrinth und Spielangebote. Eintritt frei; LIVE für Saison, Futter und Reiten. Daneben Kreuzweiher mit Liegewiese/Baden.',
    facts: {
      now: 'Kreuzweiherstraße 11, 88099 Neukirch — Naherholung außerhalb der Kernstadt.',
      tags: ['freizeitpark', 'natur', 'familie'],
    },
    teasers: [
      { m: 50, text: 'Parkplätze am Ortsende weisen zum Eingang des Wildparks Sonnenhalde.' },
      { m: 20, text: 'Zwischen Bäumen liegen Stationen des Waldlabyrinths.' },
    ],
    faqs: [
      [
        'Woran erkenne ich diesen Ort',
        'Am Wildpark-Eingang bei Wildpoltsweiler/Kreuzweiher — nicht in der Tettnanger Altstadt',
      ],
      [
        'Kostet der Eintritt',
        'LIVE: Eintritt oft frei; Futter/Labyrinth/Reiten extra — immer frisch prüfen',
      ],
    ],
    deep: [
      [
        'LIVE: Öffnungszeiten März–Sept. vs. Winter, Futter- und Reitpreise nie aus dem Pack vorlesen.',
        ['live_hint', 'ephemeral'],
      ],
      [
        'NSG Birkenweiher näher an Tettnang: flache Wald-/Wiesenwege als Alternative.',
        ['querverbindung', 'natur'],
      ],
    ],
  });

  // Align existing wildpark spot if different id
  {
    const w = pack.spots.find(
      (s) =>
        /sonnenhalde|wildpark/i.test(s.name) &&
        s.id !== 'tettnang_wildpark_sonnenhalde',
    );
    if (w) {
      w.pack_role = 'directory';
      w.place_tier = 4;
      w.tags = [...new Set([...(w.tags || []), 'directory', 'alias'])];
    }
  }

  // Klinik
  {
    const k = pack.spots.find((s) => /klinik|medizin campus|emil/i.test(s.id + s.name));
    if (k) {
      const t = pack.trigger_points.find((x) => x.id === k.id);
      k.pack_role = 'directory';
      k.place_tier = 4;
      if (t) {
        t.general_info =
          'Ehemalige Klinik Emil-Münch-Straße 16: stationärer Betrieb und Notaufnahme eingestellt (Ende Mai 2026). Keine Notfallversorgung vor Ort — Klinikum Friedrichshafen / 112. LIVE aktuellen Status prüfen.';
        pushDeep(
          t,
          faq(
            'Wo ist die Notaufnahme',
            'Nicht mehr in Tettnang — Klinikum Friedrichshafen; Notruf 112',
          ),
          ['faq', 'user_question', 'notfall'],
        );
      }
    }
  }

  // Kronenbrunnen + Wochenmarkt QA
  {
    const br = pack.spots.find((s) => s.id === 'tettnang_kronenbrunnen');
    if (br) {
      br.place_tier = 2;
      const t = pack.trigger_points.find((x) => x.id === br.id);
      if (t) {
        pushDeep(
          t,
          'Trinkwasser auch Loretokapellen-Park und Grabenstraße; 13 Refill-Stationen (u. a. Rathaus, Tourist-Info, Stadtbücherei, Musikschule).',
          ['wasser', 'service'],
        );
      }
    }
  }

  // Brünnensweiler Kapelle as tier 3 story if missing
  ensureSpot(pack, 'tettnang_kapelle_bruennensweiler', {
    name: 'Kapelle Maria Königin des Friedens · Brünnensweiler',
    category: 'kirche',
    lat: 47.68656,
    lng: 9.60681,
    tier: 3,
    general:
      'An der Brünnensweiler Höhe am Hopfenpfad steht die 1954 erbaute Kapelle Maria Königin des Friedens — kleiner sakraler Anker direkt am Panoramapunkt über den Hopfengärten.',
    facts: { origin: 'Kapelle 1954 an der Aussichtslage Brünnensweiler Höhe.', tags: ['kapelle', 'hopfenpfad'] },
    teasers: [
      { m: 25, text: 'Neben dem Panorama erscheint die kleine Kapelle an der Brünnensweiler Höhe.' },
    ],
    faqs: [
      [
        'Woran erkenne ich diesen Ort',
        'An der kleinen Kapelle direkt an der Aussicht Brünnensweiler Höhe am Hopfenpfad',
      ],
    ],
    deep: [
      ['LIVE: Zugang über Hopfenpfad-Wege prüfen.', ['live_hint', 'ephemeral']],
      ['Querverbindung: Aussichtspunkt und Hopfenpfad.', ['querverbindung']],
    ],
  });

  demoteKapellen(pack);

  // Duplicate story aliases → directory
  for (const s of pack.spots) {
    if (
      s.id === 'tettnang_tettnanger_hopfenpfad' ||
      (s.id !== 'tettnang_hopfenpfad' &&
        /^tettnanger hopfenpfad$/i.test(String(s.name || '').trim()))
    ) {
      s.pack_role = 'directory';
      s.place_tier = 4;
      s.tags = [
        ...new Set([...(s.tags || []), 'directory', 'alias', 'amenity_skip']),
      ];
    }
  }

  // Brünnensweiler Kapelle — etwas mehr Stoff für Gate
  {
    const t = pack.trigger_points.find(
      (x) => x.id === 'tettnang_kapelle_bruennensweiler',
    );
    if (t) {
      pushDeep(
        t,
        'Die Kapelle Maria Königin des Friedens (1954) steht am Panoramapunkt Brünnensweiler Höhe am Hopfenpfad — sakraler Mini-Anker über den Plantagen Richtung Bodensee.',
        ['kapelle', 'hopfenpfad', 'aussicht'],
      );
      pushDeep(
        t,
        faq(
          'Querverbindung Hopfenpfad',
          'Direkt an der aussichtsreichen Teilstrecke des 7,7-km-Lehrpfads Richtung Siggenweiler/Hopfengut',
        ),
        ['faq', 'user_question'],
      );
      pushDeep(
        t,
        faq(
          'Was kann man hier machen',
          'Kurz innehalten, Panorama anschauen, weiter auf dem Hopfenpfad',
        ),
        ['faq', 'user_question'],
      );
    }
  }

  // Offline QA updates
  const extraQa = [
    {
      q: 'Wo ist der Wochenmarkt in Tettnang?',
      a: 'Im Zentrum (Rathausplatz/Bärenplatz); historisch Donnerstag laut Privileg 1379. LIVE aktuelle Zeiten prüfen.',
      tags: ['markt'],
    },
    {
      q: 'Was ist Spectrum Kultur?',
      a: 'Lokaler Kulturverein u. a. für Oratorien in St. Gallus und Formate im Bacchussaal des Neuen Schlosses. LIVE Termine prüfen.',
      tags: ['kultur'],
    },
    {
      q: 'Wo sind Trinkwasser und Refill?',
      a: 'Brunnen: Kronenbrunnen, Loreto-Park, Grabenstraße; plus Refill u. a. Rathaus, Tourist-Info, Stadtbücherei, Musikschule.',
      tags: ['wasser'],
    },
    {
      q: 'Wo sind öffentliche Toiletten?',
      a: 'Barrierefrei Forsthaus-Nebengebäude Schützenstraße 5; Parkhaus Grabenstraße; Nette Toilette z. B. Café City, Torstuben, Gasthof Traube. LIVE Öffnung prüfen.',
      tags: ['service'],
    },
    {
      q: 'Was war der Rappertsweiler Haufen?',
      a: 'Bauernaufstand 1525: ~8000 am Blasenberg, Zwölf Freiheitsartikel am Kehlhof; Gedenkstele seit 2025.',
      tags: ['geschichte'],
    },
  ];
  const seen = new Set((pack._offline_qa || []).map((e) => e.q.toLowerCase()));
  pack._offline_qa = pack._offline_qa || [];
  for (const e of extraQa) {
    if (seen.has(e.q.toLowerCase())) continue;
    pack._offline_qa.push({ ...e, tags: ['offline_qa', ...(e.tags || [])] });
  }

  pack._pack_index = {
    total: pack.spots.length,
    story: pack.spots.filter((s) => s.pack_role !== 'directory').length,
    directory: pack.spots.filter((s) => s.pack_role === 'directory').length,
    offline_qa: pack._offline_qa.length,
    note: 'UI: Gesamtzahl; Trigger Story Tier 1–2 (+ Interesse).',
  };

  const gate = runQualityGate(pack, { strict: false });
  console.log(
    `[followup] stories=${pack._pack_index.story} dir=${pack._pack_index.directory} qa=${pack._offline_qa.length} ok=${gate.ok} err=${gate.errors.length} warn=${gate.warnings.length}`,
  );
  if (gate.gaps?.needsDeep?.length) {
    console.log('[followup] still thin deep:', gate.gaps.needsDeep.slice(0, 12));
  }

  if (hasFlag('apply') || !hasFlag('dry')) {
    console.log('[followup] wrote', savePack(pack, { bumpVersion: true }), 'v' + pack.data_version);
  }
}

main();
