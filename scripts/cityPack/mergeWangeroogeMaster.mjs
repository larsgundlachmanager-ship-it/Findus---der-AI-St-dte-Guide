#!/usr/bin/env node
/**
 * Merge Wangerooge raumanalytischer Masterbericht into pack.
 *   node scripts/cityPack/mergeWangeroogeMaster.mjs --apply
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
  const key = text.slice(0, 90).toLowerCase();
  if (
    trigger.deep_data_pool.some(
      (d) => String(d.text || d).slice(0, 90).toLowerCase() === key,
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
  if (typeof lat !== 'number' || typeof lng !== 'number') return;
  trigger.lat = lat;
  trigger.lng = lng;
  trigger.radius_m = halfM || trigger.radius_m || 24;
  trigger.trigger_kind = 'area';
  spot.polygonCoordinates = boxPolygon(lat, lng, trigger.radius_m);
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
  const lat = cfg.lat ?? trigger.lat;
  const lng = cfg.lng ?? trigger.lng;
  spot.name = cfg.name;
  spot.category = cfg.category;
  spot.pack_role = cfg.role || 'story';
  spot.place_tier = cfg.tier;
  spot.relevance = interestTagsForCategory(cfg.category);
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
        'amenity_skip',
        'offline_lookup',
      ]),
    ];
  }
  setGeo(spot, trigger, lat, lng, cfg.halfM || (cfg.tier === 1 ? 30 : 22));
  if (cfg.general) trigger.general_info = cfg.general;
  if (cfg.facts) spot.facts = { ...(spot.facts || {}), ...cfg.facts };
  if (cfg.bullets) spot.bullets = cfg.bullets;
  if (cfg.teasers?.length) {
    spot.approach_triggers = cfg.teasers.map((t, i) => {
      const m = t.m || [55, 28, 12][i] || 30;
      const p = offset(lat, lng, -m * 0.55, i * 3);
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

function demote(pack, rx) {
  for (const s of pack.spots) {
    if ((s.tags || []).includes('master_report') && s.pack_role === 'story') {
      continue;
    }
    if (rx.test(s.id + ' ' + s.name)) {
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

function main() {
  const apply = hasFlag('apply');
  const pack = loadPack('wangerooge');
  if (!pack) throw new Error('wangerooge missing');

  pack._city_history =
    'Wangerooge, östlichste bewohnte Ostfriesische Insel im Nationalpark Niedersächsisches Wattenmeer, driftet geomorphologisch ostwärts. Frühe Kirchtürme als Tageszeichen; West-/Ostkirchen gingen durch Fluten und Konflikte verloren. Navigationsbauten ab 1597/1602 (historischer Westturm mit Kapelle/Laterne), 1687 Kohlenfeuer-Turm; Sprengung des alten Westturms 1914. Wendepunkt: Neujahrssturmflut 1854/55 zerstörte das West-Dorf — Neugründung weiter östlich, Alter Leuchtturm 1856 im neuen Zentrum. Militarisierung WW1/WW2 (Bunker, Radar); Flächenbombardement 25.04.1945 (~480 Bomber, ~6000 Bomben, ~300 Tote). Nachkrieg: Tourismus und „Pazifizierung“ militärischer Relikte (Café Pudding auf Radar-Bunker). Autofreie Insel: Zugang über Harlesiel (SIW) + Schmalspur-Inselbahn zum Inselbahnhof; aktiver Neuer Leuchtturm 1969, Westturm 1932 als Jugendherberge.';

  ensureSpot(pack, 'wangerooge_inselmuseum_alter_leuchtturm', {
    name: 'Alter Leuchtturm · Inselmuseum & Standesamt',
    category: 'museum',
    lat:
      pack.trigger_points.find((t) => t.id === 'wangerooge_inselmuseum_alter_leuchtturm')
        ?.lat || 53.7888,
    lng:
      pack.trigger_points.find((t) => t.id === 'wangerooge_inselmuseum_alter_leuchtturm')
        ?.lng || 7.8993,
    tier: 1,
    halfM: 28,
    general:
      'Zedeliusstraße 3: Alter Leuchtturm von 1856 (ARLHS FED 252) im nach der Flut 1854/55 neu gegründeten Inseldorf; 1927 auf 39 m erhöht, Feuerhöhe ~36 m über Mittelwasser. Wappenstein mit Carl Wilhelm von Anhalt (Herrschaft Jever/Kniphausen). Optik historisch mit Pintsch-Laterne; 1896 elektrische Helios-Bogenlampe. Hauptfeuer gelöscht 07.11.1969, Nebenfeuer 09.12.1969. Gemeindekauf für 1 DM; ab 1972 Aussicht (161 Stufen), 1980 Inselmuseum (Badebetrieb, Seekarten, Bernstein, Bahn-/Westturm-Modelle), 1996 Trauzimmer in der Wachstube. Am Fuß: Tender-Dampflok der Inselbahn (Baujahr 1929, außer Dienst 1957), aufgestellt ab 1968. LIVE Öffnung/Tickets und Turmwächter-Betrieb.',
    facts: {
      origin: '1856 Leuchtturm nach Dorfverlagerung; außer Dienst 1969; Museum ab 1980.',
      architecture: '39 m Turm, Laterne, 161 Stufen zur Plattform; bei Klarheit Blick Richtung Helgoland (~43 km).',
      now: 'Inselmuseum, Aussicht, Standesamt-Trauungen — LIVE Zeiten/Preise.',
      tags: ['museum', 'leuchtturm', 'aussicht'],
    },
    bullets: [
      'Navigationsgeschichte → kulturelles Erbe.',
      'Querverbindung: Neuer Leuchtturm (aktiv) und Westturm (Jugendherberge).',
    ],
    teasers: [
      { m: 80, text: 'Über dem Dorf erhebt sich der Backstein-Leuchtturm an der Zedeliusstraße.' },
      { m: 25, text: 'Am Fuß die historische Tenderlok — Eingang zu Museum und Turmaufstieg.' },
      { m: 8, text: 'Portal und Laterne: ehemaliges Seezeichen, heute Aussicht und Inselgeschichte.' },
    ],
    faqs: [
      [
        'Woran erkenne ich diesen Ort',
        'Am hohen Leuchtturm Zedeliusstraße 3 mit Lok am Fuß — nicht am Westturm oder Neuen Leuchtturm',
      ],
      [
        'Kann man hoch',
        'Aussichtsplattform über viele Stufen — LIVE Öffnung und Tickets prüfen',
      ],
      [
        'Gibt es Trauungen',
        'Ja, Trauzimmer in der ehemaligen Wachstube — LIVE Standesamt/Termine',
      ],
    ],
    deep: [
      [
        'LIVE: Öffnung und Eintritt nie aus dem Pack vorlesen; Turmwächter/Saison frisch prüfen.',
        ['live_hint', 'ephemeral'],
      ],
      [
        'Technisch: Gürtellinsen, Pintsch-Laterne; 1896 Helios-Bogenlampe mit großer Tragweite — historische Kennungen nicht als aktuelle Navigationsinfo nutzen.',
        ['technik', 'geschichte'],
      ],
    ],
  });

  ensureSpot(pack, 'wangerooge_westturm', {
    name: 'Neuer Westturm',
    category: 'aussicht',
    lat: pack.trigger_points.find((t) => t.id === 'wangerooge_westturm')?.lat,
    lng: pack.trigger_points.find((t) => t.id === 'wangerooge_westturm')?.lng,
    tier: 1,
    halfM: 30,
    general:
      '56 m hoher Ziegelbau von 1932 etwa 0,9 km südlich der Position des 1914 gesprengten historischen Westturms (1597–1602). Primär Jugendherberge (nicht Navigationsfeuer); 2005 Anbau. Markiert den ruhigeren Westen Richtung Nationalpark — LIVE Übernachtung/Zugang.',
    facts: {
      origin: '1932 Ersatzbau nach Sprengung des alten Westturms 1914; JH-Nutzung.',
      now: 'Jugendherberge Westturm — LIVE Belegung und Besucherzugang.',
      tags: ['aussicht', 'jugendherberge', 'westen'],
    },
    teasers: [
      { m: 100, text: 'Im Westen zeichnet sich der hohe Ziegelturm der Jugendherberge ab.' },
      { m: 20, text: 'Westturm-Ensemble — Beherbergung statt Seezeichen.' },
    ],
    faqs: [
      [
        'Woran erkenne ich diesen Ort',
        'Am hohen Westturm im Inselwesten — nicht am Alten Leuchtturm im Dorfzentrum',
      ],
      [
        'Ist das ein aktiver Leuchtturm',
        'Nein — Jugendherberge; aktives Feuer ist der Neue Leuchtturm hinter den Dünen',
      ],
    ],
    deep: [
      [
        'Historischer Westturm 1597–1602: Kapelle oben, drei Spitzen/Meridian, Laterne — 1914 gesprengt. Fundamente ggf. bei Ebbe sichtbar (eigener Spot).',
        ['geschichte', 'querverbindung'],
      ],
      ['LIVE: DJH/Zugang und Baustellen am Westdeich prüfen.', ['live_hint', 'ephemeral']],
    ],
  });

  ensureSpot(pack, 'wangerooge_neuer_leuchtturm_wangerooge', {
    name: 'Neuer Leuchtturm Wangerooge',
    category: 'aussicht',
    lat: pack.trigger_points.find(
      (t) => t.id === 'wangerooge_neuer_leuchtturm_wangerooge',
    )?.lat,
    lng: pack.trigger_points.find(
      (t) => t.id === 'wangerooge_neuer_leuchtturm_wangerooge',
    )?.lng,
    tier: 1,
    halfM: 32,
    general:
      '1969 in Betrieb hinter den Dünen im Westen: aktives Navigationsfeuer, Höhe oft mit 64–67,2 m angegeben (als höchster Leuchtturm Deutschlands vermarktet). Ersatz für den außer Dienst gestellten Alten Leuchtturm. LIVE: Zugang/Besichtigung und Wegesperren durch Küstenschutz.',
    facts: {
      origin: '1969 aktives Seezeichen nach Außerdienststellung Alter Turm 1969.',
      now: 'Aktives Feuer hinter den Dünen — LIVE Besucherzugang prüfen.',
      tags: ['leuchtturm', 'navigation', 'westen'],
    },
    teasers: [
      { m: 120, text: 'Hinter den westlichen Dünen ragt der schlanke Neue Leuchtturm auf.' },
      { m: 30, text: 'Aktives Navigationsfeuer — modernes Gegenstück zum Alten Turm im Dorf.' },
    ],
    faqs: [
      [
        'Woran erkenne ich diesen Ort',
        'Am hohen modernen Leuchtturm hinter den Westdünen — nicht am Museumsturm im Ort',
      ],
      [
        'Unterschied Alter vs. Neuer Turm',
        'Alter = Museum/Aussicht im Zentrum; Neu = aktives Feuer im Westen',
      ],
    ],
    deep: [
      ['LIVE: Wege und ggf. eingeschränkten Zugang wegen Dünen-/Deichbau prüfen.', ['live_hint', 'ephemeral']],
    ],
  });

  // Café Pudding — landmark story despite cafe category
  ensureSpot(pack, 'wangerooge_cafe_pudding', {
    name: 'Café Pudding',
    category: 'denkmal',
    lat: pack.trigger_points.find((t) => t.id === 'wangerooge_cafe_pudding')?.lat,
    lng: pack.trigger_points.find((t) => t.id === 'wangerooge_cafe_pudding')?.lng,
    tier: 1,
    halfM: 26,
    general:
      'Zedeliusstraße 49 am Dünenkopf der Flanierachse: Wahrzeichen auf dem Beton-Radar-Bunker von 1944 (Horch-/Funkmessposten auf der zentralen Stranddüne, früher Standort der 1859er Dünenbake, 1914 abgebrochen). Name von der Redewendung „um den Pudding gehen“ = kurzer Rundgang; Badegäste umrundeten die Düne schon in den 1930ern. Nach 1945 pachtete Bäcker Heinrich Folkerts den Bunker (kanadische Besatzung), Eis-/Kuchenkiosk Sommer 1948, Umbau Winter 1948/49, Eröffnung Café Pudding 04.06.1949. 1971/72 Glaspavillon mit 360°-Blick; Terrassen später erweitert; seit 2006 Seehund-Bronzen von Judith von Eßen. Vier Generationen Folkerts. LIVE Speisen/Öffnung — nie Preise aus dem Pack.',
    facts: {
      origin: 'Radar-Bunker 1944 → Café ab 1949; Pazifizierung militärischer Architektur.',
      architecture: 'Kreisrunder Glaspavillon auf Betonsockel am Dünenende der Zedeliusstraße.',
      now: 'Ikonische Gastro/Aussicht — LIVE Karte und Ruhetag.',
      tags: ['denkmal', 'wahrzeichen', 'gastro', 'geschichte'],
    },
    bullets: [
      'Endpunkt der Zedeliusstraße vor dem Nordstrand.',
      'Querverbindung: Bombardement 25.04.1945 und Inselwiederaufbau.',
    ],
    teasers: [
      { m: 80, text: 'Die Zedeliusstraße steigt zur Düne — am Ende der Glaspavillon auf dem alten Bunker.' },
      { m: 25, text: 'Runder Glasbau und Seehund-Skulpturen: Café Pudding als Dünen-Wahrzeichen.' },
      { m: 8, text: 'Betonsockel unter Glas — hier stand der Radar-Bunker von 1944.' },
    ],
    faqs: [
      [
        'Woran erkenne ich diesen Ort',
        'Am runden Glaspavillon auf dem Dünenkopf Zedeliusstraße — Ende der Dorfachse zum Strand',
      ],
      [
        'Warum „Pudding“',
        'Von „um den Pudding gehen“ = kurzer Rundgang um die Düne/den Häuserblock',
      ],
      [
        'Was war das Gebäude',
        'Zuerst massiver Radar-/Horchbunker 1944, nach dem Krieg zur Café-Architektur umgebaut',
      ],
    ],
    deep: [
      [
        'LIVE: Öffnung, Ruhetag, Kuchenladen und Abendkarte nie aus dem Pack vorlesen.',
        ['live_hint', 'ephemeral', 'gastro'],
      ],
      [
        'Familie Folkerts über Generationen — Gründer Heinrich, später Rolf/Gerda, Jörn/Joyce, Thorn/Tanja.',
        ['geschichte'],
      ],
    ],
  });

  ensureSpot(pack, 'wangerooge_db_bahnhof_wangerooge', {
    name: 'Inselbahnhof Wangerooge',
    category: 'bahnhof',
    lat: pack.trigger_points.find((t) => t.id === 'wangerooge_db_bahnhof_wangerooge')
      ?.lat,
    lng: pack.trigger_points.find((t) => t.id === 'wangerooge_db_bahnhof_wangerooge')
      ?.lng,
    tier: 1,
    halfM: 28,
    role: 'story',
    general:
      'Bahnhofstraße 6: Endpunkt der Schmalspur-Inselbahn vom südwestlichen Fähranleger durch Salzwiesen ins Dorf. Autofreie Logik: Festland Harlesiel → SIW-Fähre (tidenabhängig) → Bahn. Ticket-/Gepäckschalter typisch erst kurz vor Abfahrt — LIVE Zeiten. Start der Zedeliusstraße Richtung Strand/Pudding/Alter Leuchtturm.',
    facts: {
      origin: 'Inselbahn als Pflichtglied der intermodalen Kette Schiff–Dorf.',
      now: 'Zentraler Ankunftsknoten — LIVE Fahrplan SIW/Bahn.',
      tags: ['bahnhof', 'inselbahn', 'logistik'],
    },
    teasers: [
      { m: 50, text: 'Gleise und Bahnhofsgebäude — Ankunft der Inselbahn mitten im Ort.' },
      { m: 12, text: 'Ausgang Richtung Zedeliusstraße: Achse zu Leuchtturm und Stranddüne.' },
    ],
    faqs: [
      [
        'Woran erkenne ich diesen Ort',
        'Am Inselbahnhof mit Schmalspurgleisen im Dorf — nicht am Fähranleger am Watt',
      ],
      [
        'Warum Bahn nach der Fähre',
        'Schiffe legen am Südwest-Anleger an; die Bahn führt durch Salzwiesen zum Ort',
      ],
    ],
    deep: [
      [
        'LIVE: SIW 04464 9494-0; Schalteröffnungen und Gezeitenfahrplan frisch prüfen.',
        ['live_hint', 'ephemeral', 'transit'],
      ],
    ],
  });

  ensureSpot(pack, 'wangerooge_fahranleger_wangerooge', {
    name: 'Fähranleger Wangerooge',
    category: 'transit',
    lat: pack.trigger_points.find((t) => t.id === 'wangerooge_fahranleger_wangerooge')
      ?.lat,
    lng: pack.trigger_points.find((t) => t.id === 'wangerooge_fahranleger_wangerooge')
      ?.lng,
    tier: 2,
    role: 'story',
    general:
      'Südwestlicher Fähranleger: Ankunft der Gezeitenfähre von Harlesiel, Umstieg auf die Inselbahn. Kein Autoverkehr auf die Insel. LIVE Abfahrten strikt tideabhängig; Ausflugsverkehr teils über andere Harlesiel-Kajen.',
    facts: {
      now: 'Schiff–Bahn-Knoten am Watt — LIVE SIW-Zeiten.',
      tags: ['transit', 'faehre'],
    },
    teasers: [
      { m: 60, text: 'Am Watt: Anleger und Umstieg zur Schmalspurbahn.' },
    ],
    faqs: [
      [
        'Woran erkenne ich diesen Ort',
        'Am Fähranleger mit Bahnanschluss am Watt — nicht am Inselbahnhof im Dorf',
      ],
    ],
    deep: [
      ['LIVE: Verspätungen durch Tide und Wetter — immer aktuelle SIW-Info.', ['live_hint', 'ephemeral']],
    ],
  });

  {
    const h = pack.spots.find((s) => s.id === 'harlesiel_faehrhafen');
    if (h) {
      const t = pack.trigger_points.find((x) => x.id === h.id);
      h.pack_role = 'story';
      h.place_tier = 2;
      h.tags = [...new Set([...(h.tags || []), 'master_report', 'transit'])];
      if (t) {
        t.general_info =
          'Festlandhafen Harlesiel: Ostseite Linienfähre SIW nach Wangerooge (tidenabhängig); Westseite u. a. Ausflugsverkehr. Gepäck- und Ticketlogistik vor Ort — LIVE Öffnung der Schalter (oft ca. 1 h vor Abfahrt).';
        pushDeep(
          t,
          'LIVE: Abfahrten und Parken/Gepäck in Harlesiel nie aus dem Pack vorlesen.',
          ['live_hint', 'ephemeral'],
        );
      }
    }
  }

  ensureSpot(pack, 'wangerooge_nationalpark_haus_wangerooge', {
    name: 'Nationalpark-Haus „Rosenhaus“',
    category: 'museum',
    lat: pack.trigger_points.find(
      (t) => t.id === 'wangerooge_nationalpark_haus_wangerooge',
    )?.lat,
    lng: pack.trigger_points.find(
      (t) => t.id === 'wangerooge_nationalpark_haus_wangerooge',
    )?.lng,
    tier: 1,
    general:
      'Informations- und Bildungszentrum zum Nationalpark Niedersächsisches Wattenmeer im Westen — Anker für ruhigere Wanderungen (z. B. Westturm–Nordstrand-Runden). LIVE Öffnung, Führungen und Wegezustand; Deichbau kann Erholung temporär beeinträchtigen.',
    facts: {
      now: 'Nationalpark-Besucherzentrum — LIVE Programm.',
      tags: ['museum', 'nationalpark', 'natur'],
    },
    teasers: [
      { m: 40, text: 'Im Westen: Rosenhaus als Tor zum Nationalpark-Themenangebot.' },
    ],
    faqs: [
      [
        'Woran erkenne ich diesen Ort',
        'Am Nationalpark-Haus Rosenhaus im Inselwesten — nicht am Alten Leuchtturm im Zentrum',
      ],
    ],
    deep: [
      ['LIVE: Wattführungen und Ausstellungen frisch prüfen.', ['live_hint', 'ephemeral']],
    ],
  });

  // Kirchen
  {
    const nik = pack.spots.find((s) =>
      /nikolai|kirche am meer|evangelisch/i.test(s.id + s.name),
    );
    if (nik) {
      const t = pack.trigger_points.find((x) => x.id === nik.id);
      nik.pack_role = 'story';
      nik.place_tier = 2;
      nik.category = 'kirche';
      nik.name = 'Kirche am Meer · Ev.-luth. Gemeinde';
      nik.tags = [...new Set([...(nik.tags || []), 'master_report', 'kirche'])];
      if (t) {
        t.general_info =
          'Evangelisch-lutherische Kirche am Dorfplatz (Konzept „Kirche am Meer“ / Urlauberseelsorge, Kirche Oldenburg). LIVE Gottesdienste und Angebote.';
        pushDeep(
          t,
          faq(
            'Woran erkenne ich diesen Ort',
            'An der ev.-luth. Kirche am Dorfplatz — nicht St. Willehad',
          ),
          ['faq', 'user_question'],
        );
        pushDeep(t, 'LIVE: Gottesdienstzeiten und Seelsorgeangebote prüfen.', [
          'live_hint',
          'ephemeral',
        ]);
      }
    }
  }

  ensureSpot(pack, 'wangerooge_st_willehad', {
    name: 'St. Willehad',
    category: 'kirche',
    lat: pack.trigger_points.find((t) => t.id === 'wangerooge_st_willehad')?.lat || 53.7922,
    lng: pack.trigger_points.find((t) => t.id === 'wangerooge_st_willehad')?.lng || 7.9038,
    tier: 2,
    role: 'story',
    general:
      'Katholische Kirche St. Willehad (Westingstraße) für Gemeinde und Gäste; pastorale Arbeit u. a. mit Haus Ansgar (Exerzitien/Inseltage am Damenpfad). LIVE Gottesdienste und Musikangebote. Mutter-Kind-/Kliniknutzungen ggf. separat — LIVE Gesundheitsangebote nicht mit Kirchenraum vermischen.',
    facts: {
      now: 'Katholischer Sakralraum / Urlauberseelsorge — LIVE Termine.',
      tags: ['kirche', 'seelsorge'],
    },
    teasers: [
      { m: 30, text: 'Kirchenbau St. Willehad — katholischer Anker abseits der rein protestantischen Küstenprägung.' },
    ],
    faqs: [
      [
        'Woran erkenne ich diesen Ort',
        'An der katholischen Kirche St. Willehad (Westingstraße) — nicht an der ev. Kirche am Dorfplatz',
      ],
    ],
    deep: [
      [
        'Haus Ansgar: Begegnungs-/Exerzitienhaus nahe Damenpfad — LIVE Buchung und Wege vom Bahnhof (Zedelius → Elisabeth-Anna → Damenpfad).',
        ['querverbindung', 'live_hint'],
      ],
    ],
  });

  // Dorfplatz story light
  {
    const d = pack.spots.find((s) => s.id === 'wangerooge_dorfplatz');
    if (d) {
      const t = pack.trigger_points.find((x) => x.id === d.id);
      d.pack_role = 'story';
      d.place_tier = 2;
      d.category = 'altstadt';
      d.tags = [...new Set([...(d.tags || []), 'master_report'])];
      if (t) {
        t.general_info =
          'Zentrum des nach 1854/55 im Osten neu gegründeten Inseldorfes — Orientierungsknoten zu Kirche, Zedeliusstraße und Alter Leuchtturm.';
        pushDeep(
          t,
          faq(
            'Woran erkenne ich diesen Ort',
            'Am Dorfplatz im Inselort — Keimzelle der Neugründung nach der Flut',
          ),
          ['faq', 'user_question'],
        );
      }
    }
  }

  // Strand promenade
  {
    const s = pack.spots.find((x) => x.id === 'wangerooge_obere_strandpromenade');
    if (s) {
      const t = pack.trigger_points.find((x) => x.id === s.id);
      s.pack_role = 'story';
      s.place_tier = 2;
      s.tags = [...new Set([...(s.tags || []), 'master_report'])];
      if (t) {
        t.general_info =
          'Obere Strandpromenade / Dünenübergang: Übergang vom Dorf zum Nordstrand; Verbindung zur Achse Zedeliusstraße–Café Pudding. LIVE Küstenschutz/Baustellen und Wege.';
        pushDeep(
          t,
          'Wanderideen (LIVE Wege): kürzere Nordstrand–Alter-Leuchtturm-Runden vs. längere Westturm–Nordstrand-Touren.',
          ['wanderung', 'live_hint'],
        );
      }
    }
  }

  // WWII / Fundamente
  {
    const f = pack.spots.find((s) => s.id === 'wangerooge_fundamente_alter_westturm');
    if (f) {
      const t = pack.trigger_points.find((x) => x.id === f.id);
      f.pack_role = 'story';
      f.place_tier = 2;
      f.tags = [...new Set([...(f.tags || []), 'master_report'])];
      if (t) {
        t.general_info =
          'Relikte des historischen Westturms (1597–1602, gesprengt 1914) — bei entsprechenden Tide-/Strandbedingungen sichtbar. LIVE Zugänglichkeit und Sicherheit am Watt/Strand.';
        pushDeep(
          t,
          '25.04.1945: alliiertes Flächenbombardement (~480 Bomber, ~6000 Bomben, ~300 Tote) — traumatische Zäsur vor der touristischen Neuausrichtung.',
          ['geschichte', 'krieg'],
        );
      }
    }
  }

  // Apotheke directory LIVE
  {
    const a = pack.spots.find((s) => s.id === 'wangerooge_insel_apotheke');
    if (a) {
      const t = pack.trigger_points.find((x) => x.id === a.id);
      a.pack_role = 'directory';
      a.place_tier = 4;
      if (t) {
        t.general_info =
          'Insel-Apotheke Zedeliusstraße 31 — oft einzige Pharmazie vor Ort inkl. Notdienstlogik. LIVE Öffnung; Arztpraxen und 116117/112 getrennt prüfen.';
        pushDeep(
          t,
          'LIVE: Notdienst und Praxiszeiten (u. a. Badearzt/Hausärzte) nie aus dem Pack vorlesen.',
          ['live_hint', 'ephemeral', 'gesundheit'],
        );
      }
    }
  }

  demote(
    pack,
    /haus am alten leuchtturm|helmer und christine|wattwurm|möwe|strandburg|delis strandreich|wohnug|wohnung |petra lösch/i,
  );

  // Keep Famoos/Neudeich directory but add thin deep
  for (const id of ['wangerooge_cafe_famoos', 'wangerooge_cafe_neudeich']) {
    const s = pack.spots.find((x) => x.id === id);
    const t = pack.trigger_points.find((x) => x.id === id);
    if (!s || !t) continue;
    s.pack_role = 'directory';
    s.place_tier = 4;
    pushDeep(
      t,
      id.includes('famoos')
        ? 'Robbenstraße (älteste Straße) — Café abseits der Zedelius-Achse. LIVE Öffnung.'
        : 'Café am Deich/Watt — LIVE Ruhetage und Wege (Deich vs. Strand).',
      ['live_hint', 'ephemeral'],
    );
  }

  pushQa(pack, [
    {
      q: 'Warum liegt das Dorf im Osten?',
      a: 'Nach der Neujahrssturmflut 1854/55 wurde das zerstörte West-Dorf aufgegeben und weiter östlich neu gegründet.',
      tags: ['geschichte'],
    },
    {
      q: 'Welcher Leuchtturm ist aktiv?',
      a: 'Der Neue Leuchtturm (ab 1969) im Westen; der Alte im Ort ist Museum/Aussicht/Standesamt.',
      tags: ['orientierung'],
    },
    {
      q: 'Wie kommt man ohne Auto auf die Insel?',
      a: 'Fähre SIW Harlesiel–Wangerooge (Gezeiten) plus Inselbahn zum Bahnhof im Ort. LIVE Fahrplan.',
      tags: ['transit'],
    },
    {
      q: 'Was ist Café Pudding?',
      a: 'Wahrzeichen auf einem ehemaligen Radar-Bunker von 1944 am Dünenende der Zedeliusstraße; Café seit 1949.',
      tags: ['geschichte'],
    },
    {
      q: 'Wo ist die Notapotheke?',
      a: 'Insel-Apotheke Zedeliusstraße — LIVE Notdienst. Bei Notfall 112; Bereitschaft 116117.',
      tags: ['gesundheit'],
    },
  ]);

  pack._pack_index = {
    total: pack.spots.length,
    story: pack.spots.filter((s) => s.pack_role !== 'directory').length,
    directory: pack.spots.filter((s) => s.pack_role === 'directory').length,
    offline_qa: (pack._offline_qa || []).length,
  };

  const gate = runQualityGate(pack, { strict: false });
  console.log(
    `[wangerooge] story=${pack._pack_index.story} dir=${pack._pack_index.directory} qa=${pack._offline_qa.length} ok=${gate.ok} err=${gate.errors.length} thin=${(gate.gaps?.needsDeep || []).length}`,
  );

  const researchPath = path.join(STAEDTE_DIR, 'wangerooge.research.json');
  fs.writeFileSync(
    researchPath,
    JSON.stringify(
      {
        city_history: pack._city_history,
        master_merged_at: new Date().toISOString(),
        notes: [
          'Alter/Neuer Leuchtturm, Westturm, Café Pudding, Bahn/Fähre',
          '1854/55 Flut, 1945 Bombardement',
          'Gastro-Preise/Öffnung LIVE',
        ],
      },
      null,
      2,
    ),
  );

  if (apply) {
    savePack(pack, { bumpVersion: true });
    console.log('[wangerooge] wrote pack');
  } else {
    console.log('[wangerooge] dry-run — add --apply');
  }
}

main();
