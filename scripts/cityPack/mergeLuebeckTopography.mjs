#!/usr/bin/env node
/**
 * Merge Lübeck topography research (Top-13) + Travemünde stories + Denkmal tiers.
 *   node scripts/cityPack/mergeLuebeckTopography.mjs --apply
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
import { resolvePlace, geocode, placesTextAll } from './google.mjs';
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
  )
    return;
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
  const geo = await geocode(q, near);
  const r = geo.results?.[0];
  const loc = r?.geometry?.location;
  return loc
    ? { lat: loc.lat, lng: loc.lng, address: r.formatted_address, name: r.name }
    : null;
}

function findSpot(pack, ...rxs) {
  for (const rx of rxs) {
    const s = pack.spots.find((x) => rx.test(x.id) || rx.test(x.name));
    if (s) return s;
  }
  return null;
}

function applyStory(pack, s, cfg) {
  let t = pack.trigger_points.find((x) => x.id === s.id);
  if (!t) {
    t = {
      id: s.id,
      name: s.name,
      lat: cfg.lat ?? pack.lat,
      lng: cfg.lng ?? pack.lng,
      radius_m: 24,
      general_info: '',
      deep_data_pool: [],
    };
    pack.trigger_points.push(t);
  }
  if (cfg.name) s.name = cfg.name;
  if (cfg.category) s.category = cfg.category;
  s.pack_role = 'story';
  s.place_tier = cfg.tier ?? 1;
  const tags = [
    ...(s.tags || []),
    ...interestTagsForCategory(s.category),
    'module1',
    `tier${s.place_tier}`,
    'story',
    'master_report',
    'deep_research_merged',
    'culture_story',
    ...(cfg.mustHave ? ['must_have', 'landmark'] : []),
    ...(cfg.smallDenkmal
      ? ['denkmaeler_klein', 'interest:denkmaeler', 'denkmal']
      : []),
    ...(cfg.extraTags || []),
  ];
  if (cfg.mustHave) {
    s.tags = [...new Set(tags.filter((x) => x !== 'denkmaeler_klein'))];
  } else if (cfg.smallDenkmal) {
    s.tags = [
      ...new Set(tags.filter((x) => x !== 'must_have' && x !== 'landmark')),
    ];
  } else {
    s.tags = [...new Set(tags)];
  }
  if (typeof cfg.lat === 'number' && typeof cfg.lng === 'number') {
    setGeo(s, t, cfg.lat, cfg.lng, cfg.halfM || 28);
  }
  if (cfg.general) t.general_info = cfg.general;
  if (cfg.facts) s.facts = { ...(s.facts || {}), ...cfg.facts };
  if (cfg.teasers?.length) {
    s.approach_triggers = cfg.teasers.map((te, i) => {
      const m = te.m || 35;
      const p = offset(t.lat, t.lng, -m * 0.55, i * 4);
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
  } else if (!s.approach_triggers?.length) {
    const p = offset(t.lat, t.lng, -32, 2);
    s.approach_triggers = [
      {
        id: `${s.id}_approach_1`,
        lat: p.lat,
        lng: p.lng,
        radius_m: 22,
        teaser_text: `${s.name} liegt voraus.`,
        condition_rule: 'always',
        cascade_distance_m: 35,
      },
    ];
  }
  for (const [q, a] of cfg.faqs || []) pushDeep(t, faq(q, a), ['faq', 'user_question']);
  for (const [text, tags] of cfg.deep || []) pushDeep(t, text, tags);
  pushDeep(
    t,
    'LIVE: Oeffnung, Tickets und aktuelle Angebote frisch pruefen.',
    ['live_hint', 'ephemeral'],
  );
}

function ensureNew(pack, id, cfg) {
  let s = pack.spots.find((x) => x.id === id);
  if (!s && cfg.match) {
    s = pack.spots.find((x) => cfg.match.test(x.id) || cfg.match.test(x.name));
  }
  if (!s) {
    s = {
      id,
      name: cfg.name,
      category: cfg.category,
      district: cfg.district || cfg.category,
      tags: [],
      bullets: [],
      facts: {},
      pack_role: 'story',
      place_tier: cfg.tier || 2,
      polygonCoordinates: [],
      approach_triggers: [],
    };
    pack.spots.push(s);
  }
  applyStory(pack, s, cfg);
  return s;
}

/** Distilled from user topography report — facts only, no prices. */
const TOP = {
  grass: {
    match: /grass/i,
    name: 'Günter-Grass-Haus',
    category: 'museum',
    tier: 1,
    mustHave: true,
    general:
      'Glockengießerstraße: Forum für Literatur und bildende Kunst zu Günter Grass (Nobelpreis; auch Grafiker/Maler/Bildhauer). Kaufmannshaus-Typologie; Museum seit 2002. Sammlung Manuskripte, Skulpturen, Aquarelle, Radierungen; Sonderausstellungen zu Doppelbegabungen. Skulpturenhof mit Bronzen (u. a. Butt) im Dialog mit Backsteinfassaden. LIVE Oeffnung.',
    teasers: [
      {
        m: 40,
        text: 'Glockengießerstraße: geschlossene Backsteinfront — dahinter öffnet sich der Skulpturenhof.',
      },
      {
        m: 12,
        text: 'Portal: Straßenlärm fällt ab; Hof mit Vegetation und Plastiken.',
      },
    ],
    faqs: [
      [
        'Woran erkenne ich diesen Ort',
        'Am Günter-Grass-Haus Glockengießerstraße — nicht Willy-Brandt-Haus Königstraße',
      ],
    ],
    deep: [
      [
        'Querverbindung Willy-Brandt-Haus: Grass unterstützte Brandt; intellektuell-politische Achse.',
        ['querverbindung'],
      ],
      [
        'Kaufmannshaus-Diele einst merkantil — heute Rezeption literarisch-künstlerischen Schaffens.',
        ['geschichte'],
      ],
    ],
  },
  kolk: {
    match: /kolk\s*17|figurentheater/i,
    name: 'KOLK 17 Figurentheater & Museum',
    category: 'theater',
    tier: 1,
    mustHave: true,
    general:
      'Gasse Kolk nahe St. Petri: älteste Siedlungsstrukturen; Archäologie datiert Backsteinmauern auf ca. 1170 (parallel frühe Petrikirche). Fritz Fey sen. Marionettentheater 1977; TheaterFigurenMuseum ab 1982 (Sammlung >20.000 Objekte). Heute KOLK 17: Sanierung Museum+Theater, Haus-im-Haus, Sichtbeton vs. Ziegel; Bernhard Remmers Award. LIVE Spielplan/Oeffnung.',
    teasers: [
      {
        m: 45,
        text: 'Abstieg von St. Petri in die enge Kopfstein-Gasse Kolk — Horizont verschwindet.',
      },
      {
        m: 15,
        text: 'Unterschiedliche historische Backsteinformate — Foyer als Gelenk zur modernen Weite.',
      },
    ],
    faqs: [
      [
        'Woran erkenne ich diesen Ort',
        'Am Kolk bei Petri — Figurentheater/Museum, nicht Theater Beckergrube',
      ],
    ],
    deep: [
      [
        'Querverbindung Petri: gemeinsame frühe Backstein-Bauphase um 1170.',
        ['querverbindung'],
      ],
      [
        'Querverbindung St. Annen: historische Artefakte in moderner Ausstellungsarchitektur.',
        ['querverbindung'],
      ],
    ],
  },
  annen: {
    match: /museumsquartier|st\.?\s*annen/i,
    name: 'Museumsquartier St. Annen',
    category: 'museum',
    tier: 1,
    mustHave: true,
    general:
      'Augustinerinnenkloster für Kaufmannstöchter; Klosterkirche um 1515 Backsteingotik — letztes erhaltenes spätgotisches Kloster Lübecks. Reformation 1531 beendet Kloster; später Armen-/Zuchthaus; Brand 1843. Museum Kunst-/Kulturgeschichte; 2003 Kunsthalle auf Fundamenten der abgebrannten Kirche. Sammlung Schnitzaltäre; Highlight Memling-Passionsaltar 1491 (Greverade). LIVE.',
    teasers: [
      {
        m: 40,
        text: 'Aegidienviertel: wehrhafte Backsteinfassade St. Annen-Straße.',
      },
      {
        m: 12,
        text: 'Portal → Kreuzgang: Akustik dämpft, Licht durch Maßwerk — Klosterstille.',
      },
    ],
    faqs: [
      [
        'Woran erkenne ich diesen Ort',
        'Am Museumsquartier St. Annen — Kloster + Kunsthalle, Nähe Aegidien',
      ],
    ],
    deep: [
      [
        'Querverbindung Marien/Petri: gerettete Sakralkunst vs. Verluste 1942.',
        ['querverbindung'],
      ],
      [
        'Querverbindung Aegidien: Handwerker-/Stifterviertel um die Kirche.',
        ['querverbindung'],
      ],
    ],
  },
  hafen: {
    match: /museumshafen/i,
    name: 'Museumshafen Lübeck',
    category: 'hafen',
    tier: 1,
    mustHave: true,
    general:
      'Untertrave: historische Pulsader des Hansehandels (Pelze Nowgorod, Tuche Flandern, Hering Schonen). Innerer Hafen verlor mit Stahl-/Dampfschiffen an Gewicht. Heute aktiver Liegeplatz für Traditionsschiffe, Ewer, Frachtsegler — oft privat restauriert, Flaniermeile. LIVE Belegung und Ausfahrten.',
    teasers: [
      {
        m: 50,
        text: 'Wind und brackige Trave-Luft — Fallen schlagen am Mast, Möwen über dem Wasser.',
      },
      {
        m: 20,
        text: 'Takelagen vor der Altstadtkulisse — Übergang von Gasse zu offener Wasserfläche.',
      },
    ],
    faqs: [
      [
        'Woran erkenne ich diesen Ort',
        'An den Traditionsschiffen an der Untertrave — nicht Passat am Priwall',
      ],
    ],
    deep: [
      [
        'Querverbindung Salzspeicher: Salz für Heringsexport — Verladung hier.',
        ['querverbindung'],
      ],
      [
        'Querverbindung Schiffergesellschaft + Leuchtturm Travemünde: Kapitäne / Einfahrt.',
        ['querverbindung'],
      ],
    ],
  },
  schiffer: {
    match: /schiffergesellschaft/i,
    name: 'Schiffergesellschaft',
    category: 'denkmal',
    tier: 1,
    mustHave: true,
    general:
      'Breite Straße: St.-Nikolaus-Bruderschaft ab 1401 (soziale Absicherung, Interessen der Seefahrer). Bau 1535 Backsteinrenaissance mit Treppengiebel nach Brand. Innen: Gelage-Bänke nach Fahrtgebiet, Holzschnitzereien, Schiffsmodelle — einmaliger Erhaltungszustand. Heute historisches Restaurant in originaler Raumstruktur. LIVE Gastro/Zugang.',
    teasers: [
      {
        m: 35,
        text: 'Treppengiebel am Rand zum Koberg — schweres Eichenportal.',
      },
      {
        m: 8,
        text: 'Innen: Zwielicht durch Bleiglas, Geruch von Eichenholz und Traditionsküche.',
      },
    ],
    faqs: [
      [
        'Woran erkenne ich diesen Ort',
        'An der Schiffergesellschaft Breite Straße — Blickrichtung Koberg/Jakobi',
      ],
    ],
    deep: [
      [
        'Querverbindung St. Jakobi: Seefahrerkirche; Pamir-Boot als Mahnmal.',
        ['querverbindung'],
      ],
      [
        'Querverbindung Museumshafen: Netzwerke und Ladungen der Kapitäne.',
        ['querverbindung'],
      ],
    ],
  },
  katharinen: {
    match: /katharinen/i,
    name: 'St. Katharinen zu Lübeck',
    category: 'kirche',
    tier: 1,
    mustHave: true,
    general:
      'Franziskanerkirche ab ca. 1300: turmlos (Bettelorden), nur Dachreiter; innen Hochgotik mit Umgangschor. 1942 weitgehend unbeschadet. Heute Museumskirche (Ausstellungen/Konzerte). Westfassade: expressionistische Klinker „Gemeinschaft der Heiligen“ (Ernst Barlach / Gerhard Marcks, 1930er–40er). LIVE.',
    teasers: [
      {
        m: 40,
        text: 'Königstraße: turmlose Westfassade verdichtet den Straßenraum.',
      },
      {
        m: 12,
        text: 'Barlach/Marcks-Figuren in den Nischen — innen hoher heller Chor.',
      },
    ],
    faqs: [
      [
        'Woran erkenne ich diesen Ort',
        'An St. Katharinen ohne Turm — nicht Marien, nicht Aegidien',
      ],
    ],
    deep: [
      [
        'Querverbindung Burgkloster/Hansemuseum: Franziskaner vs. Dominikaner.',
        ['querverbindung'],
      ],
      [
        'Querverbindung St. Annen: Sakralraum vs. Altäre/Andachtskunst im Museum.',
        ['querverbindung'],
      ],
    ],
  },
  aegidien: {
    match: /aegidien/i,
    name: 'St. Aegidien zu Lübeck',
    category: 'kirche',
    tier: 1,
    mustHave: true,
    general:
      'Kleinste der fünf Hauptkirchen; urkundlich 12. Jh.; Hallenkirche 14. Jh. im Handwerkerviertel. 1942 unversehrt — dichte Ausstattung Gotik/Renaissance/Barock; Singechor 1586/87 von Tönnies Evers d. Ä. Aktive Gemeindekirche, starke Akustik für Musik. Kontrast zu ausgebrannten Großkirchen. LIVE.',
    teasers: [
      {
        m: 40,
        text: 'Weber-/Annen-Straße: dörfliches Gassenlabyrinth öffnet zum begrünten Kirchhof.',
      },
      {
        m: 12,
        text: 'Gedrungene Hallenkirche — Geruch von altem Holz und Stein im Vorraum.',
      },
    ],
    faqs: [
      [
        'Woran erkenne ich diesen Ort',
        'An St. Aegidien im Osten — 1942 verschont wie Jakobi',
      ],
    ],
    deep: [
      [
        'Querverbindung Petri: Aegidien intakt vs. Petri als leere Halle nach 1942.',
        ['querverbindung'],
      ],
      [
        'Soziologie: Handwerkerpatronat vs. Fernkaufleute an Marien/Rathaus.',
        ['geschichte'],
      ],
    ],
  },
  brandt: {
    match: /willy.?brandt/i,
    name: 'Willy-Brandt-Haus Lübeck',
    category: 'museum',
    tier: 1,
    mustHave: true,
    general:
      'Königstraße 21: Patrizierbau auf gotischen Fundamenten, klassizistische Fassade. Willy Brandt (Herbert Frahm, geb. 1913 Lübeck) — Jugend, Julius Leber, Widerstand, Exil 1933. Museum/Stiftung: Dauerausstellung Zeitgeschichte, Ostpolitik, Kniefall Warschau; Bildungsort Demokratie. Nicht das Geburtshaus (St. Lorenz). LIVE; Eintritt typisch frei — pruefen.',
    teasers: [
      {
        m: 35,
        text: 'Königstraße: unauffällige klassizistische Fassade in der Kaufmannsreihe.',
      },
      {
        m: 10,
        text: 'Innen Multimedia — Kontrast zur stillen Backsteinstraße.',
      },
    ],
    faqs: [
      [
        'Woran erkenne ich diesen Ort',
        'Königstraße 21 Willy-Brandt-Haus — Geburtshaus lag in St. Lorenz',
      ],
    ],
    deep: [
      [
        'Querverbindung Grass-Haus: Wahlkampf/politische Weggefährten.',
        ['querverbindung'],
      ],
      [
        'Exil über Ostsee — metaphorischer Bogen zu Hafen und Travemünde.',
        ['querverbindung'],
      ],
    ],
  },
  rathaus: {
    match: /^rathaus lübeck$|luebeck_rathaus$/i,
    name: 'Rathaus Lübeck',
    category: 'geschichte',
    tier: 1,
    mustHave: true,
    general:
      'Ab frühem 13. Jh. gewachsenes Rathaus — eines der ältesten/komplexesten DE. Schildwände mit Windlöchern, schwarz glasierte Ziegel; 1594 Renaissance-Freitreppe (niederländischer Sandstein). Nach Reichsfreiheit 1226 Machtzentrum; Lübisches Recht in >100 Ostseestädten. Heute Bürgerschaft/Bürgermeister; Führungen u. a. Audienzsaal. LIVE.',
    teasers: [
      {
        m: 40,
        text: 'Von der Breiten Straße: dunkle Zinnensilhouette gegen den Himmel.',
      },
      {
        m: 15,
        text: 'Markt: schwarze Glasurziegel vs. helle Renaissance-Freitreppe.',
      },
    ],
    faqs: [
      [
        'Woran erkenne ich diesen Ort',
        'Am Rathaus am Markt — gegenüber Niederegger',
      ],
    ],
    deep: [
      [
        'Querverbindung St. Marien: duales Machtzentrum Rat + Kirche.',
        ['querverbindung'],
      ],
      [
        'Querverbindung Schiffergesellschaft/Salzspeicher: Handel und Zölle.',
        ['querverbindung'],
      ],
    ],
  },
  treppe: {
    match: /rathaustreppe/i,
    name: 'Rathaustreppe am Markt',
    category: 'denkmal',
    tier: 1,
    mustHave: true,
    general:
      'Renaissance-Freitreppe 1594 am Markt: helles Sandstein-Statement vor gotischer Wehrfassade — Wandel von Wehrgedanke zu Repräsentation. Schwelle zwischen Rat und Platz; LIVE Zugang/Führungen am Rathausensemble.',
    teasers: [
      {
        m: 25,
        text: 'Helle Sandsteinstufen vor der dunklen Rathauswand am Markt.',
      },
    ],
    faqs: [
      [
        'Woran erkenne ich diesen Ort',
        'An der Freitreppe des Rathauses am Markt',
      ],
    ],
    deep: [
      [
        'Querverbindung Rathaus + Niederegger: Marktplatz-Ensemble.',
        ['querverbindung'],
      ],
    ],
  },
  petri: {
    match: /petrikirche|st\.?\s*petri/i,
    name: 'Petrikirche Lübeck',
    category: 'kirche',
    tier: 1,
    mustHave: true,
    general:
      'Höchster Punkt südliche Altstadtinsel; romanische Anfänge 12. Jh., später fünfschiffige gotische Halle. Palmsonntag 1942 Ausbrand; Wiederaufbau bis ca. 1987 bewusst ohne historische Innenausstattung — weiße leere Halle. Heute Kunst-/Veranstaltungsraum; Turm mit Lift zur Aussicht (~50 m) über Altstadteiform, Trave/Wakenitz, bei Klarheit Ostsee. LIVE Turm/Tickets.',
    teasers: [
      {
        m: 40,
        text: 'Ansteigender Petrikirchhof — massiver Turm erdrückt optisch.',
      },
      {
        m: 10,
        text: 'Lift durch den Turmschaft — Plattform: Oval der Insel zwischen den Flüssen.',
      },
    ],
    faqs: [
      [
        'Woran erkenne ich diesen Ort',
        'An St. Petri mit Aussichtsturm — Blick auf Holstentor und Kirchenkranz',
      ],
    ],
    deep: [
      [
        'Querverbindung Marien-Totentanz 1942 / Mahlau-Fenster: Kriegserinnerung.',
        ['querverbindung'],
      ],
      [
        'Querverbindung Kolk 17: Blick vom Turm auf die Gasse Kolk.',
        ['querverbindung'],
      ],
    ],
  },
  burgtor: {
    match: /burgtor/i,
    name: 'Burgtor Lübeck',
    category: 'denkmal',
    tier: 1,
    mustHave: true,
    general:
      'Nördliches Stadttor 1444 spätgotisch an der Landbrücke (größtes militärisches Risiko der Inselstadt). Untere Geschosse romanisch-trutzig; Turm mit Spitzbogenblenden. Neben Holstentor eines von zwei erhaltenen Toren; eingewachsen in Burgkloster/Hansemuseum-Komplex. Tunnelartige Durchfahrt zur Großen Burgstraße/Koberg. LIVE.',
    teasers: [
      {
        m: 50,
        text: 'Von Norden: Verengung auf ein Bollwerk aus rotem und schwarzem Stein.',
      },
      {
        m: 15,
        text: 'Unter dem Kreuzgewölbe: Hall und Dunkel — danach Lichtexplosion zur Burgstraße.',
      },
    ],
    faqs: [
      [
        'Woran erkenne ich diesen Ort',
        'Am Burgtor im Norden — nicht Holstentor im Westen',
      ],
    ],
    deep: [
      [
        'Querverbindung Hansemuseum/Burgkloster: untrennbare Einheit.',
        ['querverbindung'],
      ],
      [
        'Landhandel Holstein/Dänemark vs. Seehandel am Museumshafen.',
        ['geschichte'],
      ],
    ],
  },
  leuchtturm: {
    match: /alter leuchtturm travem/i,
    name: 'Alter Leuchtturm Travemünde',
    category: 'aussicht',
    tier: 1,
    mustHave: true,
    general:
      'Ältestes erhaltenes Leuchtfeuer DE-Ostseeküste: Wärter 1316 belegt; Neubau 1539 nach Grafenfehde; Überformung nach Blitz 1827; 31 m. Technik von Holzfeuer über Öl/Petroleum zu Elektrik 1903/Glühlampen 1937. Feuer 1972 gelöscht (Maritim verdeckt Sicht); höchstes Feuer Europas seit 1974 auf Maritim. Museum acht Geschosse, 142 Stufen, Lotsenausguck; Hochwassermarke 1872. LIVE Saison.',
    teasers: [
      {
        m: 80,
        text: 'Promenade: gedrungener Backsteinturm im Schlagschatten des Maritim-Hochhauses.',
      },
      {
        m: 20,
        text: 'Dicke Mauern, steile Treppen — Möwen, Eisen, Wind an den oberen Fenstern.',
      },
    ],
    faqs: [
      [
        'Woran erkenne ich diesen Ort',
        'Alter Leuchtturm Travemünde — nicht Passat am Priwall',
      ],
    ],
    deep: [
      [
        'Querverbindung Passat/Priwall + Museumshafen + Schiffergesellschaft.',
        ['querverbindung'],
      ],
      [
        'LIVE: Museum und Stufen frisch pruefen.',
        ['live_hint', 'ephemeral'],
      ],
    ],
  },
};

const SMALL_DENKMAL =
  /brahms|kaiser.?wilhelm|thomas.?mann.?stein|fritz reuter|850 jahre|brunnen sod|kleverschuss|lübecker löwen|lubecker lowen|wasserkunst|thorweg|holstentorplatz|gedenkstein/i;

const LARGE_DENKMAL =
  /holstentor$|burgtor|salzspeicher|rathaustreppe|schiffergesellschaft|heiligen.?geist|heinrich.?der.?löwe|heinrich.?der.?lowe/i;

async function main() {
  const apply = hasFlag('apply');
  const pack = loadPack('luebeck');
  const near = { lat: pack.lat, lng: pack.lng };

  for (const cfg of Object.values(TOP)) {
    const s = findSpot(pack, cfg.match);
    if (!s) {
      console.warn('[skip missing]', cfg.name);
      continue;
    }
    const t = pack.trigger_points.find((x) => x.id === s.id);
    applyStory(pack, s, {
      ...cfg,
      lat: t?.lat,
      lng: t?.lng,
    });
    console.log('[top]', s.name);
  }

  // Cluster: Natur und Umwelt, Herrenwyk, Ganghaus
  {
    const s = findSpot(pack, /natur und umwelt/i);
    if (s) {
      applyStory(pack, s, {
        name: 'Museum für Natur und Umwelt',
        category: 'museum',
        tier: 1,
        mustHave: true,
        general:
          'Beim Dom: Geologie/Paläontologie des Raums; bekannt für eiszeitliche Walskelette aus SH. Bildet mit Herrenwyk und den Gängen die Trias jenseits von Patrizierglanz. LIVE Oeffnung.',
        teasers: [
          {
            m: 30,
            text: 'Neben dem Dom: Museum für die Naturgeschichte der Region.',
          },
        ],
        faqs: [
          [
            'Woran erkenne ich diesen Ort',
            'Am Museum für Natur und Umwelt beim Dom',
          ],
        ],
        deep: [
          [
            'Querverbindung Dom + Ganghäuser + Industriemuseum Herrenwyk.',
            ['querverbindung'],
          ],
        ],
      });
    }
  }
  {
    const existing = findSpot(pack, /herrenwyk/i);
    const g = await resolve(
      'Industriemuseum Geschichtswerkstatt Herrenwyk Lübeck',
      near,
    );
    if (existing || g) {
      const s =
        existing ||
        ensureNew(pack, 'luebeck_industriemuseum_herrenwyk', {
          name: 'Industriemuseum Herrenwyk',
          category: 'museum',
          lat: g.lat,
          lng: g.lng,
          tier: 2,
          mustHave: true,
          district: 'herrenwyk',
          general: 'placeholder',
        });
      applyStory(pack, s, {
        name: 'Industriemuseum Herrenwyk',
        category: 'museum',
        tier: 2,
        mustHave: true,
        lat: g?.lat ?? pack.trigger_points.find((x) => x.id === s.id)?.lat,
        lng: g?.lng ?? pack.trigger_points.find((x) => x.id === s.id)?.lng,
        general:
          'Vorort Herrenwyk: Industrialisierung ab frühem 20. Jh. — Hochofenwerk 1905, später Flender-Werft; proletarisches Leben vs. Hanse-Romantik. LIVE.',
        teasers: [
          {
            m: 40,
            text: 'Industriequartier Herrenwyk — Stahl und Arbeitersiedlung statt Altstadtgiebel.',
          },
        ],
        faqs: [
          [
            'Woran erkenne ich diesen Ort',
            'Am Industriemuseum Herrenwyk — nicht Altstadtinsel',
          ],
        ],
        deep: [
          [
            'Querverbindung Ganghäuser/Hafen: Arbeitergeschichte fortgeschrieben.',
            ['querverbindung'],
          ],
        ],
      });
    }
  }
  {
    const g =
      (await resolve('Glandorps Gang Lübeck', near)) ||
      (await resolve('Lübecker Gänge und Höfe', near));
    if (g) {
      ensureNew(pack, 'luebeck_ganghaeuser', {
        name: 'Lübecker Gänge & Höfe',
        category: 'denkmal',
        lat: g.lat,
        lng: g.lng,
        tier: 1,
        mustHave: true,
        general:
          'Ab 14. Jh. Reaktion auf Wohnungsnot in der Inselstadt: enge Gänge unter Vorderhäusern zu Kabäuschen im Hof (Tagelöhner/Hafenarbeiter). Sanierung ab 1970ern; heute begehrte Mikro-Idylle (z. B. Glandorps Gang) — Gentrifizierung. Trigger: Kopf einziehen durch dunklen Tunnel → sonniger Hof. LIVE Respekt Privatwohnen.',
        teasers: [
          {
            m: 25,
            text: 'Dunkler niedriger Durchgang unter dem Vorderhaus — Schultern schmal.',
          },
          {
            m: 5,
            text: 'Hof: plötzlich Stille und Licht — Stockrosen zwischen Kabäuschen.',
          },
        ],
        faqs: [
          [
            'Woran erkenne ich diesen Ort',
            'An den Gängen/Höfen (z. B. Glandorp) — Durchschlupf unter dem Vorderhaus',
          ],
        ],
        deep: [
          [
            'Querverbindung Rathaus/Patrizierhäuser: Reichtum brauchte Tagelöhner ohne Bauplatz.',
            ['querverbindung'],
          ],
          [
            'Querverbindung Museumshafen + Herrenwyk: Arbeiterschaft damals und industriell.',
            ['querverbindung'],
          ],
        ],
      });
    }
  }

  // Travemünde B1: alles Story
  const travQueries = [
    ['Travemünde Strand', 'Travemünde Strand', 'natur', 1],
    ['Travemünde Strandpromenade', 'Travemünde Strandpromenade', 'wanderung', 1],
    ['Nordermole Travemünde', 'Nordermole Travemünde', 'aussicht', 2],
    ['Casino Travemünde', 'Casino Travemünde', 'denkmal', 2],
    ['Seebrücke Travemünde OR Promenadensteg Travemünde', 'Promenadensteg Travemünde', 'aussicht', 2],
    ['Priwall Travemünde Strand', 'Priwall Strand', 'natur', 2],
  ];
  for (const [q, name, cat, tier] of travQueries) {
    const g = await resolve(q, { lat: 53.96, lng: 10.87 });
    if (!g) continue;
    ensureNew(pack, `luebeck_${slugify(name)}`, {
      name,
      category: cat,
      lat: g.lat,
      lng: g.lng,
      tier,
      mustHave: tier === 1,
      district: 'travemuende',
      general: `${name}: Seebad-Travemünde — maritimes Kapitel neben Passat und Altem Leuchtturm. LIVE Saison/Zugang.`,
      teasers: [
        {
          m: 50,
          text: `${name} voraus — Ostseeküste statt Altstadtinsel.`,
        },
      ],
      faqs: [
        [
          'Woran erkenne ich diesen Ort',
          `An ${name} in Travemünde — nicht Altstadt Lübeck`,
        ],
      ],
      deep: [
        [
          'Querverbindung Alter Leuchtturm + Passat: Travemünde-Wahrzeichen-Trio.',
          ['querverbindung'],
        ],
      ],
    });
    console.log('[trav]', name);
  }
  // Passat already story — ensure must_have T1
  {
    const s = findSpot(pack, /passat/i);
    if (s) {
      applyStory(pack, s, {
        name: 'Viermastbark Passat',
        category: 'museum',
        tier: 1,
        mustHave: true,
        general:
          (pack.trigger_points.find((x) => x.id === s.id)?.general_info?.length || 0) > 200
            ? pack.trigger_points.find((x) => x.id === s.id).general_info
            : 'Priwall: Viermastbark Passat (Flying P-Liner), Museumsschiff — LIVE.',
        teasers: [
          {
            m: 80,
            text: 'Vom Fähranleger: Takelage der Passat im Passathafen.',
          },
        ],
        faqs: [
          [
            'Woran erkenne ich diesen Ort',
            'An der Passat am Priwall — Fähre über die Trave',
          ],
        ],
        deep: [
          [
            'Querverbindung Alter Leuchtturm gegenüber / Museumshafen flussaufwärts.',
            ['querverbindung'],
          ],
        ],
      });
    }
  }

  // B2: small vs large denkmals
  for (const s of pack.spots) {
    if (s.pack_role === 'directory') continue;
    const blob = `${s.id} ${s.name} ${s.category}`;
    if (!/denkmal|statue|brunnen|gedenk|stein|löwe|lowe/i.test(blob) && s.category !== 'denkmal')
      continue;
    if (LARGE_DENKMAL.test(blob) || /schiffer|rathaustreppe|heiligen|salzspeicher|holstentor|burgtor|gang/i.test(blob)) {
      s.tags = [
        ...new Set([
          ...(s.tags || []).filter((t) => t !== 'denkmaeler_klein'),
          'must_have',
          'landmark',
          'interest:denkmaeler',
        ]),
      ];
      if ((s.place_tier || 9) > 2) s.place_tier = 1;
      continue;
    }
    if (SMALL_DENKMAL.test(blob) || (s.category === 'denkmal' && (s.place_tier || 2) >= 2)) {
      if (/schiffer|rathaus|heiligen|salz|holstentor|burgtor|gang/i.test(blob)) continue;
      s.tags = [
        ...new Set([
          ...(s.tags || []).filter((t) => t !== 'must_have' && t !== 'landmark'),
          'denkmaeler_klein',
          'interest:denkmaeler',
          'denkmal',
          'story',
        ]),
      ];
      s.place_tier = Math.max(s.place_tier || 2, 2);
      s.pack_role = 'story';
    }
  }

  // B3: culture kinos keep story + must_have-ish culture
  for (const s of pack.spots) {
    if (/filmhaus|kommunales kino|kolosseum/i.test(s.name)) {
      s.pack_role = 'story';
      s.place_tier = 2;
      s.category = /kolosseum/i.test(s.name) ? 'konzert' : 'kino';
      s.tags = [
        ...new Set([
          ...(s.tags || []),
          'story',
          'culture_story',
          'interest:theater_kultur',
          'theater_kultur',
          'must_have',
        ]),
      ];
      const t = pack.trigger_points.find((x) => x.id === s.id);
      if (t && (t.general_info || '').length < 80) {
        t.general_info = `${s.name}: Kulturort in Lübeck — LIVE Spielplan und Oeffnung.`;
      }
    }
  }

  // B4: quick Google pass for extra tourist attractions
  try {
    const data = await placesTextAll(
      'Sehenswürdigkeit Lübeck',
      { lat: pack.lat, lng: pack.lng, radiusM: 12000 },
      { maxPages: 1 },
    );
    let added = 0;
    for (const r of (data.results || []).slice(0, 25)) {
      const loc = r.geometry?.location;
      if (!loc || !r.name) continue;
      if (
        /hotel|restaurant|café|cafe|apartment|parkplatz|tankstelle/i.test(r.name)
      )
        continue;
      const exists = pack.spots.some(
        (s) =>
          s.name.toLowerCase().includes(r.name.slice(0, 12).toLowerCase()) ||
          pack.trigger_points.some(
            (t) =>
              t.id === s.id &&
              typeof t.lat === 'number' &&
              Math.abs(t.lat - loc.lat) < 0.00045 &&
              Math.abs(t.lng - loc.lng) < 0.00045,
          ),
      );
      if (exists) continue;
      ensureNew(pack, `luebeck_${slugify(r.name)}`.slice(0, 80), {
        name: r.name,
        category: 'denkmal',
        lat: loc.lat,
        lng: loc.lng,
        tier: 2,
        smallDenkmal: true,
        general: `${r.name}: Sehenswürdigkeit in Lübeck laut Maps — LIVE Details und Geschichte nachziehen.`,
        teasers: [
          { m: 30, text: `${r.name} liegt voraus.` },
        ],
        faqs: [
          [
            'Woran erkenne ich diesen Ort',
            `An ${r.name} in Lübeck`,
          ],
        ],
        deep: [
          [
            'Research-Nachzug: stabile Historie noch dünn — LIVE nicht erfinden.',
            ['meta'],
          ],
        ],
      });
      added += 1;
      console.log('[b4 +]', r.name);
    }
    console.log('[b4] added', added);
  } catch (e) {
    console.warn('[b4]', e.message || e);
  }

  pack._pack_index = {
    total: pack.spots.length,
    story: pack.spots.filter((s) => s.pack_role !== 'directory').length,
    directory: pack.spots.filter((s) => s.pack_role === 'directory').length,
    offline_qa: (pack._offline_qa || []).length,
  };
  const gate = runQualityGate(pack, { strict: false });
  console.log(
    `[topo] story=${pack._pack_index.story} dir=${pack._pack_index.directory} ok=${gate.ok} thin=${(gate.gaps?.needsDeep || []).length}`,
  );
  if (gate.errors?.length) console.log(gate.errors.slice(0, 8));

  if (apply) {
    savePack(pack, { bumpVersion: true });
    console.log('[topo] wrote');
  } else console.log('[topo] dry-run');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
