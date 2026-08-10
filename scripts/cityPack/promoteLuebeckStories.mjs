#!/usr/bin/env node
/**
 * Promote selected Lübeck spots to story + Travemünde Alter Leuchtturm.
 *   node scripts/cityPack/promoteLuebeckStories.mjs --apply
 */
import {
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
      pack_role: 'story',
      place_tier: cfg.tier,
      polygonCoordinates: [],
      approach_triggers: [],
    };
    pack.spots.push(s);
  }
  if (!t) {
    t = {
      id: s.id,
      name: cfg.name,
      lat: cfg.lat,
      lng: cfg.lng,
      radius_m: cfg.halfM || 24,
      general_info: '',
      deep_data_pool: [],
      early_teaser_hooks: [],
    };
    pack.trigger_points.push(t);
  }
  s.id = s.id || id;
  s.name = cfg.name;
  s.category = cfg.category;
  if (cfg.district) s.district = cfg.district;
  s.pack_role = cfg.role || 'story';
  s.place_tier = cfg.tier;
  s.tags = [
    ...new Set([
      ...(s.tags || []),
      ...interestTagsForCategory(cfg.category),
      'module1',
      `tier${cfg.tier}`,
      s.pack_role,
      'story_promote',
    ]),
  ];
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

async function main() {
  const apply = hasFlag('apply');
  const pack = loadPack('luebeck');
  const near = { lat: pack.lat, lng: pack.lng };

  // Dedup: keep enriched Lohmühle, demote stub twin
  {
    const stub = pack.spots.find((x) => x.id === 'luebeck_stadion_lohmuhle');
    if (stub) {
      stub.pack_role = 'directory';
      stub.place_tier = 4;
      stub.tags = [
        ...new Set([...(stub.tags || []), 'directory', 'alias', 'tier4']),
      ];
    }
  }

  {
    const g =
      (await resolve('Stadion an der Lohmühle VfB Lübeck', near)) ||
      { lat: 53.8815, lng: 10.6684 };
    ensure(pack, 'luebeck_lohmuehle', {
      match: /stadion an der lohmühle|lohmuehle$/i,
      name: 'Stadion an der Lohmühle',
      category: 'sport',
      lat: g.lat,
      lng: g.lng,
      tier: 2,
      halfM: 45,
      district: 'st_lorenz_nord',
      general:
        'Bei der Lohmühle 13: größtes Stadion Schleswig-Holsteins, Heimspielstätte VfB Lübeck (Grün-Weiß). Arbeitersport-Wurzeln 1924 (ATSV/BSV Vorwärts auf ehemaligem Lohmühlen-Gelände); 1933 konfisziert und umbenannt; 20.09.1945 Fusion zum VfB (Wappenjahr 1919). LIVE Spielplan, Kapazität und Zugang.',
      facts: {
        origin: 'Arbeitersport ab 1924; VfB-Fusion 1945.',
        now: 'VfB Lübeck — LIVE Spiele/Tickets.',
        tags: ['sport', 'vfb', 'geschichte'],
      },
      teasers: [
        {
          m: 100,
          text: 'An der Fackenburger Allee: Stadion-Block außerhalb der Altstadtmauern.',
        },
        {
          m: 30,
          text: 'Tribünen und Flutlicht — Arbeitersport-Tradition hinter dem heutigen Namen.',
        },
      ],
      faqs: [
        [
          'Woran erkenne ich diesen Ort',
          'Am Stadion Lohmühle bei St. Lorenz — nicht Altstadtinsel',
        ],
        [
          'Welcher Verein spielt hier',
          'VfB Lübeck — LIVE Ligastatus und Spielplan pruefen',
        ],
      ],
      deep: [
        [
          '1933: Verbot der Arbeitervereine; Areal der SV Polizei zugewiesen.',
          ['geschichte'],
        ],
        [
          'LIVE: Tickets, Kapazität und Namenssponsoring frisch pruefen.',
          ['live_hint', 'ephemeral'],
        ],
      ],
    });
  }

  {
    const g =
      (await resolve('Lunapark Hanseplatz Lübeck', near)) ||
      { lat: 53.86005, lng: 10.66345 };
    ensure(pack, 'luebeck_lunapark', {
      match: /lunapark/i,
      name: 'Lunapark (Hanseplatz)',
      category: 'freizeit',
      lat: g.lat,
      lng: g.lng,
      tier: 2,
      halfM: 35,
      district: 'st_lorenz_sued',
      general:
        'Hanseplatz 4–6, St. Lorenz Süd: öffentlicher Stadtpark/Spielplatz-Ensemble (kein kommerzieller Vergnügungspark). Sand, Klettern, Wasserpumpe im Sommer, offene Wiesen — LIVE Zustand und Events. Wochenmarkt-Nähe am Hanseplatz oft am Wochenende — LIVE.',
      facts: {
        now: 'Öffentliche Freifläche/Spiel — LIVE Nutzung.',
        tags: ['freizeit', 'familie', 'park'],
      },
      teasers: [
        {
          m: 50,
          text: 'Grüne Fläche am Hanseplatz — Spielgeräte und offene Wiesen.',
        },
        {
          m: 15,
          text: 'Sand und Kletterlandschaft; im Sommer oft Wasserpumpe.',
        },
      ],
      faqs: [
        [
          'Woran erkenne ich diesen Ort',
          'Am Lunapark/Hanseplatz in St. Lorenz Süd — nicht Hansa-Park Sierksdorf',
        ],
        [
          'Ist das ein Freizeitpark mit Fahrgeschäften',
          'Nein: städtischer Spiel-/Freizeitplatz; großer Erlebnispark ist woanders',
        ],
      ],
      deep: [
        [
          'Querverbindung: nicht verwechseln mit Hansa-Park (Sierksdorf) oder Altstadt-Spots.',
          ['orientierung'],
        ],
        [
          'LIVE: Sauberkeit, Öffnung der Geräte und Markttermine frisch pruefen.',
          ['live_hint', 'ephemeral'],
        ],
      ],
    });
  }

  {
    const g =
      (await resolve('Museumshafen Lübeck Untertrave', near)) ||
      { lat: 53.8728, lng: 10.6822 };
    ensure(pack, 'luebeck_museumshafen_lubeck', {
      match: /museumshafen/i,
      name: 'Museumshafen Lübeck',
      category: 'hafen',
      lat: g.lat,
      lng: g.lng,
      tier: 1,
      halfM: 40,
      district: 'innenstadt',
      general:
        'Holstenhafen / An der Untertrave (Wenditzufer): seit 1981 Verein Museumshafen — Traditionsschiffe (Schoner, Kutter, Arbeitsschiffe ca. 1870–1957) vor Altstadtkulisse. Verein u. a. Motorschlepper Titan (1910) und Eimerkettenbagger Wels (1936). Drehbrücke (1892) mit Peter-Rehder-Haus verbindet Altstadt und Wallhalbinsel. LIVE Belegung (Sommer oft äußere Liegeplätze) und Mitsegeln/Lisa von Lübeck.',
      facts: {
        origin: 'Verein 1981; lebendige Schifffahrtsgeschichte.',
        now: 'Frei zugängliche Liegeplätze — LIVE Schiffe vor Ort.',
        tags: ['hafen', 'museum', 'maritime'],
      },
      teasers: [
        {
          m: 50,
          text: 'Masten und Rümpfe vor der Altstadt — Traditionsschiffe am Holstenhafen.',
        },
        {
          m: 20,
          text: 'Drehbrücke und Uferpromenade — Übergang zur Wallhalbinsel.',
        },
        {
          m: 5,
          text: 'Stegkante: historische Arbeitsschiffe und Schlepper zum Ansehen.',
        },
      ],
      faqs: [
        [
          'Woran erkenne ich diesen Ort',
          'An den Traditionsschiffen an der Untertrave — nicht Passat am Priwall',
        ],
        [
          'Kann man an Bord',
          'Viele Schiffe privat; Mitsegeln/Ausfahrten LIVE (z. B. Lisa von Lübeck) pruefen',
        ],
      ],
      deep: [
        [
          'Querverbindung Passat: größtes Museumsschiff Lübecks liegt in Travemünde/Priwall.',
          ['querverbindung'],
        ],
        [
          'Querverbindung Salzspeicher/Holstentor: hier der lebendige Hafen, dort Speicher/Tor.',
          ['querverbindung'],
        ],
        [
          'LIVE: Welche Schiffe liegen innen/außen und Touren frisch pruefen.',
          ['live_hint', 'ephemeral'],
        ],
      ],
    });
  }

  {
    const g =
      (await resolve('Museumsquartier St. Annen Lübeck', near)) ||
      (await resolve('St. Annen-Museum Lübeck', near)) ||
      { lat: 53.8628, lng: 10.6888 };
    ensure(pack, 'luebeck_museumsquartier', {
      match: /museumsquartier|st\.?\s*annen/i,
      name: 'Museumsquartier St. Annen',
      category: 'museum',
      lat: g.lat,
      lng: g.lng,
      tier: 1,
      halfM: 32,
      district: 'innenstadt',
      general:
        'St. Annen-Straße: ehemaliges Augustinerinnen-Kloster (um 1502; Reformation bald geschlossen), Museum ab 1915. Seit 2013 Museumsquartier mit Kunsthalle auf Fundamenten der Klosterkirche. Größte Sammlung norddeutscher Schnitzaltäre; Highlight Passionsaltar Hans Memling (1491, Greverade/Dom). Kreuzgang, Höfe, bürgerliche Interieurs. Nachbarschaft St. Aegidien. LIVE Oeffnung/Tickets.',
      facts: {
        origin: 'Kloster → Museum 1915; Quartier seit 2013.',
        now: 'St. Annen-Museum + Kunsthalle — LIVE.',
        tags: ['museum', 'kunst', 'kloster'],
      },
      teasers: [
        {
          m: 40,
          text: 'Klosterfassade und moderne Kunsthalle — Ensemble St. Annen.',
        },
        {
          m: 15,
          text: 'Eingang Museumsquartier — Kreuzgang und Altäre hinter den Mauern.',
        },
      ],
      faqs: [
        [
          'Woran erkenne ich diesen Ort',
          'Am Museumsquartier St. Annen — Kloster + moderne Kunsthalle, Nähe Aegidien',
        ],
        [
          'Was ist das Highlight',
          'u. a. Memling-Passionsaltar — LIVE welche Schau gerade zugänglich ist',
        ],
      ],
      deep: [
        [
          'Querverbindung Dom: Memling-Altar ursprünglich Dom/Greverade-Kapelle.',
          ['querverbindung'],
        ],
        [
          'Querverbindung Aegidien: Kirche direkt neben dem Quartier.',
          ['querverbindung'],
        ],
        [
          'LIVE: Oeffnung, Kombi-Ticket Quartier und Sonderausstellungen pruefen.',
          ['live_hint', 'ephemeral'],
        ],
      ],
    });
  }

  {
    const g =
      (await resolve('Willy-Brandt-Haus Königstraße 21 Lübeck', near)) ||
      { lat: 53.8697, lng: 10.6895 };
    ensure(pack, 'luebeck_willy_brandt_haus_lubeck', {
      match: /willy.?brandt/i,
      name: 'Willy-Brandt-Haus Lübeck',
      category: 'museum',
      lat: g.lat,
      lng: g.lng,
      tier: 1,
      halfM: 22,
      district: 'innenstadt',
      general:
        'Königstraße 21: Museum/Gedenkstätte für Willy Brandt (geb. Lübeck als Herbert Frahm; Geburtshaus St. Lorenz, nicht dieses Haus). Eröffnung 18.12.2007; Anregung u. a. Günter Grass. Patrizierhaus: früher Zirkelgesellschaft (ab 1379), später Oberappellationsgericht der vier Freien Städte, Staatsarchiv, Bücherei. Multimediale Dauerausstellung zu Politik und 20. Jh. LIVE Oeffnung; Eintritt typisch frei — immer pruefen.',
      facts: {
        origin: 'Gedenkstätte 2007; Haus mit Hanse-/Gerichtsgeschichte.',
        now: 'Zeitgeschichts-Museum — LIVE.',
        tags: ['museum', 'politik', 'geschichte'],
      },
      teasers: [
        {
          m: 35,
          text: 'Königstraße: Rokokofassade des Willy-Brandt-Hauses zwischen den Museen.',
        },
        {
          m: 10,
          text: 'Eingang Königstraße 21 — Lernort Zeitgeschichte, nicht Geburtshaus.',
        },
      ],
      faqs: [
        [
          'Woran erkenne ich diesen Ort',
          'Am Willy-Brandt-Haus Königstraße 21 — nicht Meierstraße Geburtshaus',
        ],
        [
          'Ist der Eintritt frei',
          'LIVE: Stiftung nennt freien Eintritt — immer vor Ort/Web pruefen',
        ],
      ],
      deep: [
        [
          'Querverbindung Buddenbrookhaus/Grass: Lübecks Nobelpreis-Achse in der Altstadt.',
          ['querverbindung'],
        ],
        [
          'Gebäude: Zirkelgesellschaft → Oberappellationsgericht der vier Freien Städte.',
          ['geschichte'],
        ],
        [
          'LIVE: Oeffnung und Sonderausstellungen frisch pruefen.',
          ['live_hint', 'ephemeral'],
        ],
      ],
    });
  }

  {
    const g =
      (await resolve('St. Aegidien Kirche Lübeck', near)) ||
      { lat: 53.8639, lng: 10.6898 };
    ensure(pack, 'luebeck_st_aegidien_kirche_lubeck_ev_luth_kirchengemeinde_st_aegidien_zu_lubeck', {
      match: /aegidien/i,
      name: 'St. Aegidien zu Lübeck',
      category: 'kirche',
      lat: g.lat,
      lng: g.lng,
      tier: 1,
      halfM: 28,
      district: 'innenstadt',
      general:
        'Östlichste der großen Altstadtkirchen; urkundlich 1227; heutige Backsteinhallenkirche ab 1. Hälfte 14. Jh., Chor um 1440. Filiale des Doms, Sprengel der Handwerker/Ackerbürger. Ausgangspunkt der Reformation in Lübeck (1520er, u. a. Andreas Wilms). 1942 weitgehend unbeschädigt (wie St. Jakobi). Nachbarschaft Museumsquartier St. Annen. LIVE Oeffnung.',
      facts: {
        origin: '1227 erwähnt; gotische Halle 14./15. Jh.',
        now: 'Gemeindekirche — LIVE.',
        tags: ['kirche', 'reformation', 'backsteingotik'],
      },
      teasers: [
        {
          m: 40,
          text: 'Stämmiger Westturm über kleinstädtischem Gassennetz — St. Aegidien.',
        },
        {
          m: 15,
          text: 'Portal und Hallenschiff — Handwerkerkirche neben dem Museumsquartier.',
        },
      ],
      faqs: [
        [
          'Woran erkenne ich diesen Ort',
          'An St. Aegidien im Osten der Insel — nicht Marien am Markt',
        ],
        [
          'Was ist besonders',
          'Reformation startete hier; 1942 weitgehend verschont — LIVE Zugang',
        ],
      ],
      deep: [
        [
          'Querverbindung Jakobi: beide Kirchen überstanden 1942 weitgehend.',
          ['querverbindung'],
        ],
        [
          'Querverbindung Dom: frühe Filiale des bischöflichen Doms.',
          ['querverbindung'],
        ],
        [
          'LIVE: Oeffnung, Konzerte und Führungen frisch pruefen.',
          ['live_hint', 'ephemeral'],
        ],
      ],
    });
  }

  {
    const g =
      (await resolve('Alter Leuchtturm Travemünde', {
        lat: 53.958,
        lng: 10.875,
      })) ||
      (await resolve('Leuchtturm Travemünde Am Leuchtturm', near)) ||
      { lat: 53.9586, lng: 10.8725 };
    ensure(pack, 'luebeck_alter_leuchtturm_travemuende', {
      match: /alter leuchtturm travem|leuchtturm travemünde/i,
      name: 'Alter Leuchtturm Travemünde',
      category: 'aussicht',
      lat: g.lat,
      lng: g.lng,
      tier: 2,
      halfM: 28,
      district: 'travemuende',
      general:
        'Travemünde: ältester erhaltener Leuchtturm an der deutschen Ostseeküste (heutiger Bau 1539 durch holländische Maurer nach Zerstörung 1534 in der Grafenfehde; Überformung nach Blitz 1827). Hafenzeichen schon im Reichsfreiheitsbrief 1226 erwähnt; Leuchtfeuerwärter 1316. Seit 1972 außer Dienst (Sicht durch Maritim-Hotel verdeckt); höchstes Leuchtfeuer Europas seit 1974 auf dem Maritim. Turm heute Museum/Aussicht — LIVE Saison und Stufen.',
      facts: {
        origin: '1539 Bau; Seezeichen bis 1972.',
        now: 'Museum/Wahrzeichen — LIVE.',
        tags: ['aussicht', 'maritime', 'travemuende'],
      },
      teasers: [
        {
          m: 80,
          text: 'Am Trave-Ufer: schlanker Backstein-Leuchtturm vor der Seebad-Kulisse.',
        },
        {
          m: 25,
          text: 'Klassizistische Gesimse und Lotsenbalkon — Museumsturm, kein aktives Feuer mehr.',
        },
      ],
      faqs: [
        [
          'Woran erkenne ich diesen Ort',
          'Am Alten Leuchtturm Travemünde — nicht Passat am Priwall und nicht Altstadt',
        ],
        [
          'Leuchtet der Turm noch',
          'Nein als Seezeichen seit 1972; aktives Feuer LIVE auf dem Maritim pruefen',
        ],
      ],
      deep: [
        [
          'Querverbindung Passat: beide Travemünde-Wahrzeichen — Turm vs. Bark am Priwall.',
          ['querverbindung'],
        ],
        [
          '1226/1316: frühe Belege für Hafenzeichen und Leuchtfeuerwärter.',
          ['geschichte'],
        ],
        [
          'LIVE: Museumsoeffnung, 142 Stufen und Saison frisch pruefen.',
          ['live_hint', 'ephemeral'],
        ],
      ],
    });
  }

  // Keep wrong Altstadt "Leuchtturm Redner" as directory alias, not story
  {
    const redner = pack.spots.find((x) => /leuchtturm redner/i.test(x.name));
    if (redner) {
      redner.pack_role = 'directory';
      redner.place_tier = 4;
      redner.tags = [
        ...new Set([
          ...(redner.tags || []),
          'directory',
          'tier4',
          'alias_or_mislabel',
        ]),
      ];
    }
  }

  pack._pack_index = {
    total: pack.spots.length,
    story: pack.spots.filter((s) => s.pack_role !== 'directory').length,
    directory: pack.spots.filter((s) => s.pack_role === 'directory').length,
    offline_qa: (pack._offline_qa || []).length,
  };

  const gate = runQualityGate(pack, { strict: false });
  console.log(
    `[promote] story=${pack._pack_index.story} dir=${pack._pack_index.directory} ok=${gate.ok} thin=${(gate.gaps?.needsDeep || []).length}`,
  );
  if (gate.errors?.length) console.log('errors', gate.errors.slice(0, 10));
  if ((gate.gaps?.needsDeep || []).length) {
    console.log('needsDeep', gate.gaps.needsDeep);
  }

  if (apply) {
    savePack(pack, { bumpVersion: true });
    console.log('[promote] wrote pack');
  } else console.log('[promote] dry-run');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
