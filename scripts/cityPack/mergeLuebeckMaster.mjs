#!/usr/bin/env node
/**
 * Merge Hansestadt Lübeck master report into pack.
 *   node scripts/cityPack/mergeLuebeckMaster.mjs --apply
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
import { resolvePlace, geocode } from './google.mjs';
import { interestTagsForCategory } from './placeCategoryPolicy.mjs';
import { runQualityGate } from './qualityGate.mjs';

loadEnvFile();

function pushDeep(t, text, tags) {
  if (!text || text.length < 12) return;
  t.deep_data_pool = t.deep_data_pool || [];
  const key = text.slice(0, 90).toLowerCase();
  if (
    t.deep_data_pool.some(
      (d) => String(d.text || d).slice(0, 90).toLowerCase() === key,
    )
  ) {
    return;
  }
  t.deep_data_pool.push({ text, tags });
}

function faq(q, a) {
  return `User-Frage: ${q}? Antwort: ${a}`;
}

function setGeo(s, t, lat, lng, r = 24) {
  t.lat = lat;
  t.lng = lng;
  t.radius_m = r;
  t.trigger_kind = 'area';
  s.polygonCoordinates = boxPolygon(lat, lng, r);
  t.polygon = s.polygonCoordinates.map((p) => ({
    lat: p.latitude,
    lng: p.longitude,
  }));
}

async function resolve(q, near) {
  const g = await resolvePlace(q, { near });
  if (g) return g;
  const geo = await geocode(q);
  const r = geo.results?.[0];
  const loc = r?.geometry?.location;
  return loc
    ? { lat: loc.lat, lng: loc.lng, address: r.formatted_address, name: r.name }
    : null;
}

function ensure(pack, id, cfg) {
  let s =
    pack.spots.find((x) => x.id === id) ||
    pack.spots.find(
      (x) =>
        cfg.match &&
        (cfg.match.test(x.id) || cfg.match.test(x.name)),
    );
  let t = s && pack.trigger_points.find((x) => x.id === s.id);
  if (!s) {
    s = {
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
    pack.spots.push(s);
  }
  if (!t) {
    t = {
      id: s.id,
      name: cfg.name,
      lat: cfg.lat,
      lng: cfg.lng,
      radius_m: 24,
      general_info: '',
      deep_data_pool: [],
    };
    pack.trigger_points.push(t);
  }
  s.name = cfg.name;
  s.category = cfg.category;
  s.pack_role = cfg.role || 'story';
  s.place_tier = cfg.tier;
  s.tags = [
    ...new Set([
      ...(s.tags || []),
      ...interestTagsForCategory(cfg.category),
      'module1',
      `tier${cfg.tier}`,
      s.pack_role,
      'master_report',
    ]),
  ];
  if (s.pack_role === 'directory') {
    s.tags = [
      ...new Set([...s.tags, 'directory', 'tier4', 'amenity_skip']),
    ];
  }
  setGeo(s, t, cfg.lat, cfg.lng, cfg.halfM || (cfg.tier === 1 ? 30 : 22));
  if (cfg.general) t.general_info = cfg.general;
  if (cfg.facts) s.facts = { ...(s.facts || {}), ...cfg.facts };
  if (cfg.bullets) s.bullets = cfg.bullets;
  if (cfg.teasers) {
    s.approach_triggers = cfg.teasers.map((te, i) => {
      const m = te.m || 30;
      const p = offset(cfg.lat, cfg.lng, -m * 0.55, i * 3);
      return {
        id: `${s.id}_approach_${i + 1}`,
        lat: p.lat,
        lng: p.lng,
        radius_m: Math.min(38, Math.max(12, Math.round(m * 0.35))),
        teaser_text: te.text,
        condition_rule: 'always',
        cascade_distance_m: m,
      };
    });
  }
  for (const [q, a] of cfg.faqs || []) {
    pushDeep(t, faq(q, a), ['faq', 'user_question']);
  }
  for (const [text, tags] of cfg.deep || []) {
    pushDeep(t, text, tags);
  }
  return { s, t };
}

function pushQa(pack, items) {
  pack._offline_qa = pack._offline_qa || [];
  const seen = new Set(
    pack._offline_qa.map((e) => String(e.q || '').toLowerCase()),
  );
  for (const e of items) {
    if (seen.has(e.q.toLowerCase())) continue;
    pack._offline_qa.push({
      ...e,
      tags: ['offline_qa', 'master_report', ...(e.tags || [])],
    });
  }
}

async function main() {
  const apply = hasFlag('apply');
  const pack = loadPack('luebeck');
  const near = { lat: pack.lat, lng: pack.lng };

  pack._city_history =
    'Lübeck: slawische Besiedlung ab ca. 700; Alt-Lübeck/Liubice 819 an Trave/Schwartau (Adam von Bremen 1072), 1138 zerstört. 1143 Gründung durch Graf Adolf II. von Schauenburg auf dem Hügel Buku; nach Brand 1157 Neuaufbau 1159 unter Heinrich dem Löwen — bis heute prägender Grundriss. Lübisches Recht in über 100 Ostseestädten. 1226 Reichsfreiheitsprivileg Friedrichs II. (Freie Reichsstadt bis 1937); 1227 Bornhöved. Königin der Hanse, Höhepunkt Frieden von Stralsund 1370; Salz über Alte Salzstraße und Stecknitz-Kanal (1398) für Heringshandel. Niedergang ab 16. Jh.; 1937 Groß-Hamburg-Gesetz; Palmsonntag 1942 britischer Luftangriff (~1/5 Altstadt); 1987 UNESCO-Welterbe als erste komplette Altstadt Nordeuropas.';

  {
    const t = pack.trigger_points.find((x) =>
      /stadtgeschichte/i.test(x.id),
    );
    const s = pack.spots.find((x) => /stadtgeschichte/i.test(x.id));
    const lat = pack.lat || 53.865;
    const lng = pack.lng || 10.687;
    if (t) t.general_info = pack._city_history;
    if (s && t) {
      s.pack_role = 'story';
      s.place_tier = 1;
      s.tags = [
        ...new Set([...(s.tags || []), 'master_report', 'city_welcome']),
      ];
      setGeo(s, t, lat, lng, 55);
      s.approach_triggers = s.approach_triggers?.length
        ? s.approach_triggers
        : [
            {
              id: `${s.id}_approach_1`,
              lat: lat - 0.0004,
              lng,
              radius_m: 35,
              teaser_text:
                'Altstadtinsel zwischen Trave und Wakenitz — Hanse-Grundriss seit dem 12. Jahrhundert.',
              condition_rule: 'always',
              cascade_distance_m: 70,
            },
          ];
    }
  }

  // Holstentor enrich
  {
    const g =
      (await resolve('Holstentor Museum Lübeck', near)) ||
      { lat: 53.8663, lng: 10.6798 };
    ensure(pack, 'luebeck_museum_holstentor', {
      match: /holstentor/i,
      name: 'Holstentor',
      category: 'museum',
      lat: g.lat,
      lng: g.lng,
      tier: 1,
      halfM: 32,
      general:
        'Wahrzeichen der Hansestadt an der Obertrave: massive Backstein-Ziegeltürme mit Kegeldächern und Terrakottabändern; der Südturm steht schief (einsinkend). Museum „Die Macht des Handels“. LIVE Oeffnung/Tickets. Tourist-Info am Holstentorplatz 1.',
      facts: {
        origin: 'Stadttor / Hanse-Symbol; Museum im Tor.',
        architecture:
          'Backstein, Kegeldächer, schiefer Südturm — ikonische Silhouette.',
        now: 'Museum + Foto-Wahrzeichen — LIVE Zeiten.',
        tags: ['museum', 'wahrzeichen', 'unesco'],
      },
      teasers: [
        {
          m: 80,
          text: 'Zwei steile Kegeldächer und Backsteinmauern — das Holstentor vor der Trave.',
        },
        {
          m: 15,
          text: 'Nah am Tor: der leicht schiefe Südturm und die Terrakottabänder.',
        },
      ],
      faqs: [
        [
          'Woran erkenne ich diesen Ort',
          'Am doppelten Backstein-Stadttor mit Kegeldächern — nicht an den Salzspeichern daneben',
        ],
        [
          'Kann man rein',
          'Ja, Museum Macht des Handels — LIVE Tickets und Zeiten',
        ],
      ],
      deep: [
        [
          'Querverbindung: Salzspeicher direkt an der Holstentorbrücke — Salzhandel als Hanse-Rückgrat.',
          ['querverbindung'],
        ],
        [
          'LIVE: Museumsoeffnung und Tourist-Info Holstentorplatz frisch pruefen.',
          ['live_hint', 'ephemeral'],
        ],
      ],
    });
  }

  {
    const g =
      (await resolve('St. Marien zu Lübeck Marienkirchhof', near)) ||
      { lat: 53.8677, lng: 10.6857 };
    ensure(pack, 'luebeck_ev_luth_kirchengemeinde_st_marien_zu_lubeck', {
      match: /marienkirche|st\.?\s*marien/i,
      name: 'St. Marien zu Lübeck',
      category: 'kirche',
      lat: g.lat,
      lng: g.lng,
      tier: 1,
      halfM: 34,
      district: 'altstadt',
      general:
        'Mutterkirche der norddeutschen Backsteingotik; Baubeginn 1260er; Mittelschiff mit 38,5 m — höchstes Backsteingewölbe der Welt. Totentanz von Bernt Notke (1463, ca. 30x2 m) verbrannte 29.03.1942; heute Totentanzfenster Alfred Mahlau (1956/57). Im Südturm liegen die 1942 aus 55 m gestürzten Glockenreste im Steinboden. Astronomische Uhr von Paul Behrens (1960–67); Glockenspiel täglich mittags — LIVE. Querverbindung: Bombennacht 1942 = Gründungsviertel-Zerstörung.',
      facts: {
        origin: 'Bürgerkirche vs. bischöflicher Dom; Totentanz 1463/Notke.',
        architecture:
          'Backsteingotik, Doppeltürme ~125 m, Strebebögen, Südturm-Glockenreste.',
        now: 'Kirche + Kunst — LIVE Oeffnung/Ausstellungen.',
        tags: ['kirche', 'gotik', 'unesco'],
      },
      teasers: [
        {
          m: 50,
          text: 'Die hohen Doppeltürme von St. Marien durchbrechen die Markt-Horizontlinie.',
        },
        {
          m: 20,
          text: 'Massive Backsteinarchitektur mit Strebebögen — französische Hochgotik in Ziegel.',
        },
        {
          m: 5,
          text: 'Nordseite/Totentanzbereich — hier mahnte einst Notkes Reigen vor dem Tod.',
        },
      ],
      faqs: [
        [
          'Woran erkenne ich diesen Ort',
          'An den zwei riesigen Backsteintürmen am Marienkirchhof — nicht Dom oder Petri',
        ],
        [
          'Was ist mit den Glocken',
          '1942 stürzten sieben Glocken aus dem Südturm; Reste liegen noch im Boden',
        ],
        [
          'Was war der Totentanz',
          'Notke 1463; verbrannt 1942; heute Mahlau-Fenster als Neuinterpretation',
        ],
      ],
      deep: [
        [
          'LIVE: Astronomische Uhr, mittägliches Glockenspiel und Ausstellungen frisch pruefen — keine Pack-Zeiten vorlesen.',
          ['live_hint', 'ephemeral'],
        ],
        [
          'Querverbindung Dom: Marien = kaufmännisches Selbstbewusstsein gegenüber dem Bischofssitz.',
          ['querverbindung'],
        ],
      ],
    });
  }

  {
    const g =
      (await resolve('Europäisches Hansemuseum Lübeck Untertrave', near)) ||
      { lat: 53.873, lng: 10.689 };
    ensure(pack, 'luebeck_europaisches_hansemuseum', {
      match: /hansemuseum/i,
      name: 'Europäisches Hansemuseum & Burgkloster',
      category: 'museum',
      lat: g.lat,
      lng: g.lng,
      tier: 1,
      halfM: 36,
      general:
        'An der Untertrave 1: nach Bornhöved 1227 am Ort der königlichen Burg das Dominikaner-Burgkloster; heutiger Museumsneubau integriert Kloster inkl. Gerichts-/Gefängnisräume. Backsteinfassade zitiert Stadtmauer/Hangkante. LIVE Oeffnung/Tickets/Barrierefreiheit; Burgkloster ggf. separates Ticket.',
      facts: {
        origin: 'Burgkloster nach 1227; modernes Hansemuseum.',
        now: 'Dauerausstellung + Kloster — LIVE Zeiten/Preise.',
        tags: ['museum', 'hanse', 'kloster'],
      },
      teasers: [
        {
          m: 50,
          text: 'An der Untertrave: der Museumsbau an der nördlichen Uferpromenade.',
        },
        {
          m: 20,
          text: 'Freitreppe von der Untertrave hinauf zum höher gelegenen Burgkloster.',
        },
        {
          m: 5,
          text: 'Foyer mit Zugang zur Dauerausstellung — Startpunkt im Haupthaus.',
        },
      ],
      faqs: [
        [
          'Woran erkenne ich diesen Ort',
          'Am modernen Museumskomplex An der Untertrave mit Weg zum Burgkloster',
        ],
        [
          'Was war hier vorher',
          'Königliche Burg, dann Dominikanerkloster nach dem Sieg von Bornhöved 1227',
        ],
      ],
      deep: [
        [
          'LIVE: Taeglich typisch 10–18 Uhr außer 24.12. — Preise und Zeitfenster nie aus dem Pack vorlesen.',
          ['live_hint', 'ephemeral'],
        ],
        [
          'Querverbindung Salzspeicher: Reichtum der Hanse über Salz/Hering.',
          ['querverbindung'],
        ],
      ],
    });
  }

  {
    const g =
      (await resolve('Salzspeicher Lübeck Holstentor', near)) ||
      { lat: 53.866, lng: 10.6805 };
    ensure(pack, 'luebeck_salzspeicher', {
      match: /salzspeicher/i,
      name: 'Salzspeicher am Holstentor',
      category: 'denkmal',
      lat: g.lat,
      lng: g.lng,
      tier: 1,
      halfM: 28,
      general:
        'Sechs Backstein-Lagerhäuser (1579–1745) an Holstentorbrücke/Obertrave für Lüneburger und Oldesloer Salz (Alte Salzstraße, Stecknitz-Kanal ab 1398) — „weißes Gold“ für Heringsexport. Relief Saline Oldesloe am ersten Speicher. 1922 Filmkulisse für Murnaus „Nosferatu“ (Graf Orlok). Nach 1942 u. a. Modegeschäft Heick & Schmaltz — LIVE gewerbliche Nutzung/Besichtigung von innen.',
      facts: {
        origin: 'Speicher 1579–1745; Salzhandel der Hanse.',
        architecture: 'Steile Giebel, fensterarme Fassaden, Backsteinrenaissance/-barock.',
        now: 'Denkmal + gewerbliche Nutzung — LIVE Zugang.',
        tags: ['denkmal', 'hanse', 'salz'],
      },
      teasers: [
        {
          m: 50,
          text: 'Dunkle, steile Speichergiebel säumen die Trave neben dem Holstentor.',
        },
        {
          m: 10,
          text: 'Uferkante: einst Grenze Binnenhafen (Elbe-Anbindung) und Seehafen.',
        },
        {
          m: 5,
          text: 'Fassadenrelief der Saline Oldesloe — steinerner Handelsbeleg.',
        },
      ],
      faqs: [
        [
          'Woran erkenne ich diesen Ort',
          'An der Reihe von sechs Speichern an der Trave neben dem Holstentor',
        ],
        [
          'Was hat Nosferatu damit zu tun',
          '1922 dienten die Fassaden Murnau als Kulisse für das Haus Graf Orloks',
        ],
      ],
      deep: [
        [
          'LIVE: Innenräume oft nur über aktuelle Ladennutzung — frisch pruefen.',
          ['live_hint', 'ephemeral'],
        ],
      ],
    });
  }

  {
    const g =
      (await resolve('Niederegger Breite Straße 89 Lübeck', near)) ||
      { lat: 53.8672, lng: 10.685 };
    ensure(pack, 'luebeck_niederegger', {
      name: 'Café Niederegger Stammhaus',
      category: 'souvenir',
      lat: g.lat,
      lng: g.lng,
      tier: 2,
      halfM: 20,
      general:
        'Breite Straße 89 gegenüber dem Rathaus: Stammhaus; Lübecker Marzipan = EU g.g.A. Historisch Luxusware (Zucker wertvoll, Verkauf oft über Apotheken). Kostenfreies Marzipan-Museum im 2. OG — LIVE Oeffnung. Arkadencafé am Markt (Breite Str. 64) separat.',
      facts: {
        origin: 'Marzipan-Tradition / g.g.A. Lübecker Marzipan.',
        now: 'Stammhaus + Museum 2. Stock — LIVE Zeiten.',
        tags: ['souvenir', 'kulinarik', 'museum'],
      },
      teasers: [
        {
          m: 20,
          text: 'Gegenüber dem Rathaus: das Niederegger-Stammhaus in der Fußgängerzone.',
        },
        {
          m: 5,
          text: 'Eingang Erdgeschoss — darüber das Marzipan-Museum.',
        },
      ],
      faqs: [
        [
          'Woran erkenne ich diesen Ort',
          'Am Stammhaus Breite Straße gegenüber dem Rathaus — nicht am Holstentor',
        ],
        [
          'Ist das Museum kostenlos',
          'LIVE: typisch freier Eintritt im 2. Stock — immer pruefen',
        ],
      ],
      deep: [
        [
          'LIVE: Laden- und Museumsoeffnung nie aus dem Pack vorlesen.',
          ['live_hint', 'ephemeral'],
        ],
        [
          'Historzipan historisch oft über Apotheken verkauft — Zucker war Luxusgut.',
          ['geschichte', 'kulinarik'],
        ],
      ],
    });
  }

  {
    const g =
      (await resolve('Heiligen-Geist-Hospital Lübeck Koberg', near)) ||
      { lat: 53.8715, lng: 10.688 };
    ensure(pack, 'luebeck_heiligen_geist', {
      match: /heiligen.?geist/i,
      name: 'Heiligen-Geist-Hospital & Koberg',
      category: 'denkmal',
      lat: g.lat,
      lng: g.lng,
      tier: 1,
      halfM: 36,
      general:
        'Koberg: zweitgrößter Altstadtplatz, Kreuzung u. a. Burgstraßen/Königstraße. Ostseite Heiligen-Geist-Hospital (1276–1286) — eine der ältesten Sozialeinrichtungen Europas; Arme/Kranke in hölzernen „Kabäuschen“. St. Jakobi (~1300, Seefahrer) überstand 1942 unbeschadet — Kastengestühl, Renaissance-Orgeln; Pamir-Rettungsboot als Mahnmal. Burrecht-Replik (Gerichtslaube 1636, rekonstruiert 1990er). Ernestinenschule (gegr. 1804) an Kleiner Burgstraße. LIVE Hospital-Oeffnung.',
      facts: {
        origin: 'Hospital 1276–1286; Koberg als nördlicher Platzpol.',
        now: 'Hospital + Platzensemble — LIVE Zeiten (oft Di–So).',
        tags: ['denkmal', 'kirche', 'platz'],
      },
      teasers: [
        {
          m: 50,
          text: 'Weiter Platz: Hospitalfassade und Dachreiter von St. Jakobi.',
        },
        {
          m: 20,
          text: 'Platzmitte mit Burrecht — die Gerichtslaube strukturiert den Raum.',
        },
        {
          m: 5,
          text: 'Gotische Portale von St. Jakobi — 1942 hier verschont geblieben.',
        },
      ],
      faqs: [
        [
          'Woran erkenne ich diesen Ort',
          'Am Koberg mit Hospital-Langhaus und Jakobi — nicht am Markt/Rathaus',
        ],
        [
          'Was sind Kabäuschen',
          'Kleine Holzzellen im Hospital für Arme und Kranke',
        ],
      ],
      deep: [
        [
          'LIVE: Heiligen-Geist oft Di–So — Montage geschlossen; Preise nie aus dem Pack.',
          ['live_hint', 'ephemeral'],
        ],
        [
          'Querverbindung Marien 1942: Jakobi blieb stehen, Marien und Gründungsviertel litten schwer.',
          ['querverbindung'],
        ],
      ],
    });
  }

  // Jakobi upgrade if separate
  {
    const s = pack.spots.find((x) => /jakobi/i.test(x.id + x.name));
    if (s) {
      const t = pack.trigger_points.find((x) => x.id === s.id);
      s.pack_role = 'story';
      s.place_tier = 2;
      s.tags = [...new Set([...(s.tags || []), 'master_report'])];
      if (t) {
        t.general_info =
          'St. Jakobi (~1300): Kirche der Seefahrer/Fischer am Koberg; 1942 unbeschädigt — historisches Gestühl und Renaissance-Orgeln. Pamir-Rettungsboot (Untergang 1957) als Mahnmal. LIVE Oeffnung.';
        pushDeep(
          t,
          faq(
            'Woran erkenne ich diesen Ort',
            'An der Seefahrerkirche am Koberg mit schlankem Dachreiter',
          ),
          ['faq', 'user_question'],
        );
      }
    }
  }

  {
    const g =
      (await resolve('Buddenbrookhaus Mengstraße 4 Lübeck', near)) ||
      { lat: 53.8685, lng: 10.686 };
    ensure(pack, 'luebeck_buddenbrookhaus', {
      match: /buddenbrook/i,
      name: 'Buddenbrookhaus & Gründungsviertel',
      category: 'museum',
      lat: g.lat,
      lng: g.lng,
      tier: 1,
      halfM: 30,
      general:
        'Mengstraße 4: Literaturmuseum zur Familie Mann / Roman „Buddenbrooks“; weiße Barockfassade 1758. Standort voraussichtlich bis ca. 2027/2030 geschlossen wegen Erweiterung zum „Neuen Buddenbrookhaus“ (Mengstraße 6) inkl. komplexer Gewölbekeller. Interim LIVE: „Buddenbrooks am Markt“ (Am Markt 15) und Ausstellung im Behnhaus. Angrenzend Gründungsviertel (Meng-/Alfstraße): 1942 zerstört, Schulen ab 1955, Abriss 2009, Grabungen bis 2015 mit >40 Holzkellern um 1180; danach zeitgenössische Backsteingiebel im historischen Parzellenraster.',
      facts: {
        origin: 'Barockfassade 1758; Mann-Literaturort; Gründungsviertel 12. Jh.',
        now: 'Baustelle/Erweiterung — Interim-Standorte LIVE.',
        tags: ['museum', 'literatur', 'archaeologie'],
      },
      teasers: [
        {
          m: 30,
          text: 'In die Mengstraße: Neubauten des Gründungsviertels und die Fassade am Buddenbrookhaus.',
        },
        {
          m: 15,
          text: 'Mengstraße 4 — oft verhüllt/geschlossen wegen Großumbau zum neuen Museum.',
        },
        {
          m: 5,
          text: 'Blick in die engen Gassen: modernes Klinker trifft gotische Kubatur.',
        },
      ],
      faqs: [
        [
          'Woran erkenne ich diesen Ort',
          'An der Mengstraße nahe Breite Straße — Buddenbrook-Fassade / Gründungsviertel-Neubauten',
        ],
        [
          'Ist das Museum offen',
          'LIVE: Hauptstandort oft wegen Bau geschlossen — Interim am Markt/Behnhaus pruefen',
        ],
      ],
      deep: [
        [
          'LIVE: Bauzeiten und Interim-Ausstellungen nie aus dem Pack als fest vorlesen.',
          ['live_hint', 'ephemeral'],
        ],
        [
          'Querverbindung 1942: dieselbe Bombennacht wie Marien-Glocken und Totentanz.',
          ['querverbindung'],
        ],
      ],
    });
  }

  {
    const g =
      (await resolve('Theater Lübeck Beckergrube', near)) ||
      { lat: 53.869, lng: 10.684 };
    ensure(pack, 'luebeck_theater', {
      match: /^theater lübeck$/i,
      name: 'Theater Lübeck',
      category: 'theater',
      lat: g.lat,
      lng: g.lng,
      tier: 2,
      halfM: 26,
      general:
        'Beckergrube 16: Dreispartenhaus; Bau 1908 von Martin Dülfer — florale Sandsteinfassade, herausragender Jugendstil Norddeutschlands. Vorgänger ab 1753. Nördliche Straßenseite erhalten, gegenüber 1942 zerstört und 1950er-Wiederaufbau. LIVE: Sanierungsphase (Kostenrahmen hoch, oft bis ~2030 kommuniziert) — Spielbetrieb/Interim pruefen.',
      facts: {
        origin: '1908 Dülfer; Vorgängerbauten seit 1753.',
        architecture: 'Jugendstil-Sandsteinfassade vs. 1950er-Gegenseite.',
        now: 'Theater + Sanierung — LIVE Spielplan.',
        tags: ['theater', 'jugendstil'],
      },
      teasers: [
        {
          m: 50,
          text: 'Die Beckergrube führt optisch auf das Jugendstil-Theater zu.',
        },
        {
          m: 20,
          text: 'Links ornamentale Dülfer-Fassade, rechts schlichter Wiederaufbau — Spur von 1942.',
        },
      ],
      faqs: [
        [
          'Woran erkenne ich diesen Ort',
          'Am Jugendstilbau Beckergrube — florale Sandsteinfassade',
        ],
        [
          'Läuft der Betrieb',
          'LIVE Spielplan und Sanierungsstand pruefen',
        ],
      ],
      deep: [
        [
          'LIVE: Lübeck-Card-Ermäßigungen und Tickets frisch pruefen.',
          ['live_hint', 'ephemeral'],
        ],
      ],
    });
  }

  // Dom enrich
  {
    const s = pack.spots.find((x) => /lübecker dom|dom zu lübeck/i.test(x.name));
    if (s) {
      const t = pack.trigger_points.find((x) => x.id === s.id);
      s.pack_role = 'story';
      s.place_tier = 1;
      s.tags = [...new Set([...(s.tags || []), 'master_report'])];
      if (t) {
        t.general_info =
          'Lübecker Dom im Süden der Altstadtinsel: bischöflicher Gegenpol zur bürgerlichen Marienkirche am Markt. Backsteingotik; kunsthistorischer Anker u. a. Triumphkreuz. LIVE Oeffnung und Führungen nie aus dem Pack vorlesen.';
        s.approach_triggers = s.approach_triggers?.length
          ? s.approach_triggers
          : [
              {
                id: `${s.id}_approach_1`,
                lat: (t.lat || 53.8608) - 0.00025,
                lng: t.lng || 10.6855,
                radius_m: 22,
                teaser_text:
                  'Zwei Türme und lange Chorflucht: der Dom markiert den bischöflichen Süden der Insel.',
                condition_rule: 'always',
                cascade_distance_m: 40,
              },
            ];
        pushDeep(
          t,
          faq(
            'Woran erkenne ich diesen Ort',
            'Am Dom im Süden der Altstadtinsel — nicht an St. Marien am Markt',
          ),
          ['faq', 'user_question'],
        );
        pushDeep(
          t,
          'Querverbindung Marien: Dom = Bischof, Marien = Kaufmannsstolz der Hanse.',
          ['querverbindung'],
        );
        pushDeep(
          t,
          'Sakralbauten: Triumphkreuz im Dom als kunsthistorischer Anker — LIVE Zustand/Zugang.',
          ['geschichte', 'kunst'],
        );
        pushDeep(
          t,
          'LIVE: Dom-Oeffnung und Veranstaltungen frisch pruefen.',
          ['live_hint', 'ephemeral'],
        );
      }
    }
  }

  // Petri enrich
  {
    const s = pack.spots.find((x) => /petrikirche|st\.?\s*petri/i.test(x.name));
    if (s) {
      const t = pack.trigger_points.find((x) => x.id === s.id);
      s.pack_role = 'story';
      s.place_tier = 1;
      if (t) {
        t.general_info =
          'St. Petri: Aussichtsturm mit Lift — Panorama auf Holstentor, Rathaus, Backsteinkirchen und bei Klarheit Ostseeküste. Heute eher Ausstellungsort als klassische Gemeindekirche. LIVE Turm-Tickets und Oeffnung.';
        s.approach_triggers = s.approach_triggers?.length
          ? s.approach_triggers
          : [
              {
                id: `${s.id}_approach_1`,
                lat: (t.lat || 53.8655) - 0.0002,
                lng: t.lng || 10.682,
                radius_m: 18,
                teaser_text:
                  'Schlanker Turm über der Altstadt — oft der Panoramapunkt mit Lift.',
                condition_rule: 'always',
                cascade_distance_m: 35,
              },
            ];
        pushDeep(
          t,
          faq(
            'Woran erkenne ich diesen Ort',
            'An St. Petri mit Aussichtsturm — oft mit Lift zur Plattform',
          ),
          ['faq', 'user_question'],
        );
        pushDeep(
          t,
          faq(
            'Was sieht man von oben',
            'Holstentor, Rathaus, Kirchenkranz; bei gutem Wetter Richtung Ostsee',
          ),
          ['faq', 'user_question'],
        );
        pushDeep(
          t,
          'LIVE: Turmeinritt und Oeffnung nie aus dem Pack vorlesen.',
          ['live_hint', 'ephemeral'],
        );
        pushDeep(
          t,
          'Café/Infopunkt oft unten im Haus — nicht auf der Plattform erwarten.',
          ['orientierung'],
        );
      }
    }
  }

  // Rathaus
  {
    const s = pack.spots.find((x) => /rathaus lübeck/i.test(x.name));
    if (s) {
      const t = pack.trigger_points.find((x) => x.id === s.id);
      s.pack_role = 'story';
      s.place_tier = 1;
      if (t) {
        t.general_info =
          'Lübecker Rathaus am Markt — politisches und architektonisches Zentrum der Freien Reichsstadt, gegenüber Fußgängerzone und Niederegger-Stammhaus. LIVE Führungen und Zugang nie aus dem Pack vorlesen.';
        s.approach_triggers = s.approach_triggers?.length
          ? s.approach_triggers
          : [
              {
                id: `${s.id}_approach_1`,
                lat: (t.lat || 53.8669) - 0.00015,
                lng: t.lng || 10.685,
                radius_m: 18,
                teaser_text:
                  'Marktplatz mit Rathausfassade — gegenüber das Marzipan-Stammhaus.',
                condition_rule: 'always',
                cascade_distance_m: 30,
              },
            ];
        pushDeep(
          t,
          faq(
            'Woran erkenne ich diesen Ort',
            'Am Rathauskomplex am Markt — gegenüber Niederegger',
          ),
          ['faq', 'user_question'],
        );
        pushDeep(
          t,
          'Querverbindung: Arkadencafé/Niederegger Blickachse aufs Rathaus (Breite Straße).',
          ['querverbindung'],
        );
        pushDeep(
          t,
          'Hanse-Politik: Sitz der Stadt als Freie Reichsstadt ab 1226 — LIVE heutige Nutzung.',
          ['geschichte'],
        );
        pushDeep(
          t,
          'LIVE: Führungen, Zutritt und Veranstaltungen frisch pruefen.',
          ['live_hint', 'ephemeral'],
        );
      }
    }
  }

  // Jakobi (Seefahrer) — ergänzt Koberg/Hospital
  {
    const s = pack.spots.find((x) => /jakobi/i.test(x.name));
    if (s) {
      const t = pack.trigger_points.find((x) => x.id === s.id);
      s.pack_role = 'story';
      s.place_tier = 2;
      s.name = 'St. Jakobi zu Lübeck';
      if (t) {
        t.general_info =
          'St. Jakobi am Koberg: Kirche der Seefahrer und Fischer (um 1300). Überstand 1942 unbeschadet — historisches Kastengestühl und Renaissance-Orgeln im Original. Mahnmal: Rettungsboot der 1957 gesunkenen Pamir. LIVE Oeffnung.';
        s.approach_triggers = s.approach_triggers?.length
          ? s.approach_triggers
          : [
              {
                id: `${s.id}_approach_1`,
                lat: (t.lat || 53.871) - 0.0002,
                lng: t.lng || 10.689,
                radius_m: 16,
                teaser_text:
                  'Schlanker Dachreiter am Koberg — gotische Portale, die 1942 verschont blieben.',
                condition_rule: 'always',
                cascade_distance_m: 25,
              },
            ];
        pushDeep(
          t,
          faq(
            'Woran erkenne ich diesen Ort',
            'An St. Jakobi am Koberg — nicht Marien am Markt',
          ),
          ['faq', 'user_question'],
        );
        pushDeep(
          t,
          'Pamir-Rettungsboot als Mahnmal im Kirchenraum — LIVE Zugang.',
          ['geschichte', 'see'],
        );
        pushDeep(
          t,
          'Querverbindung 1942: Jakobi verschont, Marien/Gründungsviertel schwer getroffen.',
          ['querverbindung'],
        );
        pushDeep(
          t,
          'LIVE: Oeffnung und Konzerte frisch pruefen.',
          ['live_hint', 'ephemeral'],
        );
      }
    }
  }

  // Burgtor
  {
    const s = pack.spots.find((x) => /burgtor/i.test(x.name));
    if (s) {
      const t = pack.trigger_points.find((x) => x.id === s.id);
      s.pack_role = 'story';
      s.place_tier = 2;
      if (t) {
        t.general_info =
          'Burgtor: nördliches Stadttor der Altstadtinsel Richtung Burgkloster/Hansemuseum. Teil der mittelalterlichen Befestigung nach dem Sieg bei Bornhöved und dem Bau des Dominikaner-Burgklosters. LIVE Zugang/Umgebung.';
        s.approach_triggers = s.approach_triggers?.length
          ? s.approach_triggers
          : [
              {
                id: `${s.id}_approach_1`,
                lat: (t.lat || 53.875) - 0.0002,
                lng: t.lng || 10.691,
                radius_m: 18,
                teaser_text:
                  'Massives Backsteintor im Norden — Übergang zum Burgkloster-Hang.',
                condition_rule: 'always',
                cascade_distance_m: 30,
              },
            ];
        pushDeep(
          t,
          faq(
            'Woran erkenne ich diesen Ort',
            'Am Burgtor im Norden der Altstadt — nicht Holstentor im Westen',
          ),
          ['faq', 'user_question'],
        );
        pushDeep(
          t,
          'Querverbindung: Burgtor ↔ Burgkloster/Hansemuseum (Dominikaner nach Bornhöved 1227).',
          ['querverbindung'],
        );
        pushDeep(
          t,
          'Befestigung: nördlicher Abschluss der Inselstadt gegenüber Holstentor/Salzspeicher.',
          ['geschichte', 'stadtbau'],
        );
        pushDeep(
          t,
          'LIVE: Wege und Veranstaltungen am Tor frisch pruefen.',
          ['live_hint', 'ephemeral'],
        );
      }
    }
  }

  // Behnhaus — Interim Buddenbrooks
  {
    const s = pack.spots.find((x) => /behnhaus/i.test(x.name));
    if (s) {
      const t = pack.trigger_points.find((x) => x.id === s.id);
      s.pack_role = 'story';
      s.place_tier = 2;
      if (t) {
        t.general_info =
          'Museum Behnhaus Drägerhaus: Kunstmuseum; während Umbau des Buddenbrookhauses oft Interim-Standort der Ausstellung „Buddenbrooks im Behnhaus“. LIVE Oeffnung und welche Schau gerade läuft.';
        s.approach_triggers = s.approach_triggers?.length
          ? s.approach_triggers
          : [
              {
                id: `${s.id}_approach_1`,
                lat: (t.lat || 53.87) - 0.00015,
                lng: t.lng || 10.69,
                radius_m: 16,
                teaser_text:
                  'Klassizistische Fassade — oft Interim für Buddenbrooks während des Umbaus.',
                condition_rule: 'always',
                cascade_distance_m: 25,
              },
            ];
        pushDeep(
          t,
          faq(
            'Woran erkenne ich diesen Ort',
            'Am Behnhaus/Drägerhaus — nicht Mengstraße Buddenbrookhaus',
          ),
          ['faq', 'user_question'],
        );
        pushDeep(
          t,
          'Querverbindung: Buddenbrookhaus Umbau → Interim Behnhaus + Shop am Markt.',
          ['querverbindung'],
        );
        pushDeep(
          t,
          'LIVE: Ob Buddenbrooks-Schau hier läuft, frisch pruefen.',
          ['live_hint', 'ephemeral'],
        );
        pushDeep(
          t,
          'Kunstsammlung Behnhaus/Drägerhaus — LIVE aktuelle Ausstellung.',
          ['museum'],
        );
      }
    }
  }

  // Hauptbahnhof
  {
    const s = pack.spots.find(
      (x) =>
        /hauptbahnhof/i.test(x.name) &&
        !/travem|mogel|kücknitz/i.test(x.name),
    );
    if (s) {
      const t = pack.trigger_points.find((x) => x.id === s.id);
      s.pack_role = 'story';
      s.place_tier = 1;
      if (t) {
        t.general_info =
          'Lübeck Hbf: Ankunftsknoten westlich der Altstadt Richtung Holstentor. Offizielle Tourist-Information liegt typisch am Holstentorplatz 1 (nicht zwingend im Bahnhof). ÖPNV im SH-Tarif; Echtzeit/Tickets über NAH.SH-App. LIVE Gleise, Service und WLAN nie aus dem Pack vorlesen.';
        s.approach_triggers = s.approach_triggers?.length
          ? s.approach_triggers
          : [
              {
                id: `${s.id}_approach_1`,
                lat: (t.lat || 53.867) - 0.0002,
                lng: t.lng || 10.67,
                radius_m: 28,
                teaser_text:
                  'Großer Empfangsraum — von hier Richtung Holstentor in die Altstadtinsel.',
                condition_rule: 'always',
                cascade_distance_m: 50,
              },
            ];
        pushDeep(
          t,
          faq(
            'Wo ist die Tourist-Info',
            'Typisch Holstentorplatz 1 — LIVE Standort/Öffnung pruefen',
          ),
          ['faq', 'user_question'],
        );
        pushDeep(
          t,
          faq(
            'Welche App für Bus und Bahn',
            'NAH.SH-App; Stadt Lübeck oft Preisstufe 2 — LIVE Tarife',
          ),
          ['faq', 'user_question'],
        );
        pushDeep(
          t,
          'Nachtmobilität: On-Demand „lümo“ am Wochenende bis in die Nacht — LIVE Gebiet/Zeiten.',
          ['transit', 'live_hint'],
        );
        pushDeep(
          t,
          'LIVE: Schließfächer, WLAN, Taxistand und Bahnhofsservices frisch recherchieren.',
          ['live_hint', 'ephemeral'],
        );
      }
    }
  }

  // Stadtgeschichte deep auffüllen
  {
    const s = pack.spots.find((x) => /stadtgeschichte/i.test(x.id));
    const t = s && pack.trigger_points.find((x) => x.id === s.id);
    if (t) {
      pushDeep(
        t,
        faq(
          'Wann wurde Lübeck gegründet',
          '1143 Graf Adolf II.; Neuaufbau 1159 unter Heinrich dem Löwen',
        ),
        ['faq', 'user_question'],
      );
      pushDeep(
        t,
        faq(
          'Was bedeutet Freie Reichsstadt',
          '1226 Privilegium Friedrichs II.; Status bis 1937',
        ),
        ['faq', 'user_question'],
      );
      pushDeep(
        t,
        'Salz: Alte Salzstraße + Stecknitz-Kanal 1398 — Basis des Heringshandels.',
        ['geschichte', 'handel'],
      );
      pushDeep(
        t,
        '1987 UNESCO: erste komplette Altstadt Nordeuropas als Welterbe.',
        ['unesco'],
      );
    }
  }

  // Ohne Master-Beleg: Directory (kein erfundenes Story-Skript)
  for (const s of pack.spots) {
    const key = `${s.id} ${s.name}`;
    if (
      /wanderweg an der trave|museumshafen|aegidien/i.test(key) &&
      s.pack_role === 'story'
    ) {
      s.pack_role = 'directory';
      s.place_tier = 4;
      s.tags = [
        ...new Set([
          ...(s.tags || []),
          'directory',
          'tier4',
          'amenity_skip',
          'no_master_corpus',
        ]),
      ];
    }
  }

  {
    const g =
      (await resolve('Passat Travemünde Priwall', near)) ||
      { lat: 53.958, lng: 10.88 };
    ensure(pack, 'luebeck_passat', {
      name: 'Viermastbark Passat',
      category: 'museum',
      lat: g.lat,
      lng: g.lng,
      tier: 2,
      halfM: 40,
      district: 'travemuende',
      general:
        'Priwallpromenade 3a: 115 m Viermastbark, 1911 Blohm & Voss für F. Laeisz; Stahl, Masten bis 56 m; Kap-Hoorn-Route (Salpeter/Getreide). 1960 von Lübeck gekauft, Museumsschiff im Passathafen. Anreise über Trave-Fähre (Auto ganzjährig / Person saisonal). LIVE Saisonzeiten/Tickets; Trauungen/Übernachtungen möglich.',
      facts: {
        origin: '1911 Laeisz-Bark; Museumsschiff ab 1960.',
        now: 'Priwall Passathafen — LIVE Oeffnung.',
        tags: ['museum', 'schiff', 'travemuende'],
      },
      teasers: [
        {
          m: 100,
          text: 'Vom Fähranleger: immense Takelage der Passat im Hafenpanorama.',
        },
        {
          m: 20,
          text: 'Ankerplatz Priwallpromenade — Museumsschiff im ruhigen Passathafen.',
        },
      ],
      faqs: [
        [
          'Woran erkenne ich diesen Ort',
          'An der großen Viermastbark am Priwall — nicht in der Altstadt',
        ],
        [
          'Wie kommt man hin',
          'Fähre über die Trave nach Priwall — LIVE Fahrzeiten',
        ],
      ],
      deep: [
        [
          'LIVE: Saison Mai–Sept. vs. Vor-/Nachsaison und Card-Preise frisch pruefen.',
          ['live_hint', 'ephemeral'],
        ],
        [
          'Reederei F. Laeisz / „Flying P-Liner“ — Kap-Hoorn-Fracht vor Museumsnutzung.',
          ['geschichte', 'schiff'],
        ],
      ],
    });
  }

  {
    const g =
      (await resolve('Drägerpark Lübeck Wakenitz', near)) ||
      (await resolve('Bootshaus Marli Lübeck', near));
    ensure(pack, 'luebeck_draegerpark', {
      name: 'Drägerpark & Wakenitzufer',
      category: 'natur',
      lat: g?.lat || 53.875,
      lng: g?.lng || 10.71,
      tier: 2,
      halfM: 45,
      district: 'marli',
      general:
        'Naherholung entlang der Wakenitz (östlich der Altstadtinsel): Naturwiesen teils ungemäht für Biodiversität. Bootshaus Marli (Alexanderstraße) mit barrierefreiem Steg, Gastro und Floßen — LIVE. Blick auf die Sieben-Türme-Silhouette. Angrenzend Naturfreibad Marli.',
      facts: {
        now: 'Park + Ufer — LIVE Bad/Gastro/Wege.',
        tags: ['natur', 'park', 'wakenitz'],
      },
      teasers: [
        {
          m: 50,
          text: 'Abschüssiger Weg hinab ins grüne Wakenitz-Tal.',
        },
        {
          m: 20,
          text: 'Weite Wiesen — teils wild belassen für Insekten und Vögel.',
        },
        {
          m: 5,
          text: 'Am Bootshaus: Sichtachse auf die Kirchtürme der Altstadt.',
        },
      ],
      faqs: [
        [
          'Woran erkenne ich diesen Ort',
          'Am Wakenitzufer/Drägerpark mit Blick zur Altstadt — nicht Holstentor-Trave',
        ],
        [
          'Was macht den Ausblick besonders',
          'Sieben-Türme-Silhouette der Altstadt über der Wakenitz — oft bei Sonnenuntergang',
        ],
      ],
      deep: [
        [
          'LIVE: Bootshaus, Floße und Naturbad frisch pruefen.',
          ['live_hint', 'ephemeral'],
        ],
        [
          'Naturwiesen teils ungemäht — Lebensraum Wildbienen/Vögel; angrenzend Naturbad Marli.',
          ['natur'],
        ],
      ],
    });
  }

  {
    const g =
      (await resolve('Stadion Lohmühle VfB Lübeck', near)) ||
      { lat: 53.89, lng: 10.67 };
    ensure(pack, 'luebeck_lohmuehle', {
      name: 'Stadion an der Lohmühle',
      category: 'sport',
      lat: g.lat,
      lng: g.lng,
      tier: 4,
      role: 'directory',
      halfM: 45,
      general:
        'Bei der Lohmühle 13: Arbeitersport-Wurzeln 1924 (ATSV/BSV Vorwärts); 1933 konfisziert als Adolf-Hitler-Kampfbahn; 20.09.1945 Fusion zum VfB Lübeck (Wappen 1919). Größtes Stadion SH — LIVE Kapazität/Spiele. Kein Story-Wegweiser.',
      facts: {
        now: 'VfB Lübeck — LIVE Spielplan.',
        tags: ['sport', 'vfb'],
      },
      deep: [
        [
          'LIVE: Namenssponsoring und Tickets frisch pruefen.',
          ['live_hint', 'ephemeral'],
        ],
      ],
    });
  }

  // Altstadt UNESCO
  {
    const s = pack.spots.find((x) => /unesco|lübecker altstadt/i.test(x.name));
    if (s) {
      const t = pack.trigger_points.find((x) => x.id === s.id);
      s.pack_role = 'story';
      s.place_tier = 1;
      if (t) {
        t.general_info =
          'UNESCO-Welterbe seit 1987: erste komplette Altstadt Nordeuropas — Inselkern zwischen Trave und Wakenitz mit Kirchenkranz, Kaufmannshäusern und erhaltenem Grundriss seit dem Wiederaufbau Heinrichs des Löwen (1159). Palmsonntag 1942 zerstörte etwa ein Fünftel; behutsamer Wiederaufbau prägt das heutige Ensemble.';
        s.approach_triggers = s.approach_triggers?.length
          ? s.approach_triggers
          : [
              {
                id: `${s.id}_approach_1`,
                lat: (t.lat || 53.866) - 0.0003,
                lng: t.lng || 10.685,
                radius_m: 40,
                teaser_text:
                  'Sieben Türme über der Insel — Backsteingotik zwischen Trave und Wakenitz.',
                condition_rule: 'always',
                cascade_distance_m: 80,
              },
            ];
        pushDeep(
          t,
          faq(
            'Woran erkenne ich diesen Ort',
            'An der geschlossenen Altstadtinsel mit sieben Türmen und Backsteingotik',
          ),
          ['faq', 'user_question'],
        );
        pushDeep(
          t,
          '1159: Heinrich der Löwe — Grundriss bis heute prägend.',
          ['geschichte', 'stadtbau'],
        );
        pushDeep(
          t,
          '1942 Palmsonntag: ~1/5 Altstadt zerstört — Marien, Gründungsviertel, Glocken.',
          ['geschichte'],
        );
        pushDeep(
          t,
          'LIVE: Führungen und Welterbe-Infos über Tourist-Info Holstentorplatz pruefen.',
          ['live_hint', 'ephemeral'],
        );
      }
    }
  }

  pushQa(pack, [
    {
      q: 'Was ist das Holstentor?',
      a: 'Wahrzeichen Lübecks mit Museum Macht des Handels — LIVE Oeffnung. Tourist-Info Holstentorplatz 1.',
      tags: ['orientierung'],
    },
    {
      q: 'Wo ist die Notaufnahme in Lübeck?',
      a: 'UKSH Campus Lübeck, Ratzeburger Allee 160, Interdisziplinäre Notaufnahme Haus A 24/7. Notruf 112.',
      tags: ['gesundheit'],
    },
    {
      q: 'Was ist der Herrentunnel?',
      a: 'Mauttunnel unter der Trave Richtung Travemünde — LIVE Tarife/Quick-Box pruefen.',
      tags: ['mobility'],
    },
    {
      q: 'Welche App für ÖPNV?',
      a: 'NAH.SH-App für Echtzeit und Tickets; Stadt Lübeck typisch Preisstufe 2 im SH-Tarif. LIVE pruefen.',
      tags: ['transit'],
    },
    {
      q: 'Was war 1942 in Lübeck?',
      a: 'Palmsonntag-Luftangriff zerstörte u. a. Teile der Altstadt, Marien-Totentanz und Glocken, Gründungsviertel.',
      tags: ['geschichte'],
    },
    {
      q: 'Ist das Buddenbrookhaus offen?',
      a: 'Hauptstandort oft wegen Umbau geschlossen — LIVE Interim am Markt/Behnhaus.',
      tags: ['museum'],
    },
    {
      q: 'Was ist Lübecker Marzipan?',
      a: 'EU g.g.A.; Stammhaus Niederegger Breite Straße mit Museum — LIVE Oeffnung.',
      tags: ['kulinarik'],
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
    `[luebeck] story=${pack._pack_index.story} dir=${pack._pack_index.directory} qa=${pack._offline_qa.length} ok=${gate.ok} thin=${(gate.gaps?.needsDeep || []).length}`,
  );

  fs.writeFileSync(
    path.join(STAEDTE_DIR, 'luebeck.research.json'),
    JSON.stringify(
      {
        city_history: pack._city_history,
        master_merged_at: new Date().toISOString(),
        notes: [
          'Marien Totentanz/Glocken',
          'Hansemuseum Burgkloster',
          'Salzspeicher Nosferatu',
          'Buddenbrook Umbau',
          'Passat Priwall',
        ],
      },
      null,
      2,
    ),
  );

  if (apply) {
    savePack(pack, { bumpVersion: true });
    console.log('[luebeck] wrote pack');
  } else console.log('[luebeck] dry-run');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
