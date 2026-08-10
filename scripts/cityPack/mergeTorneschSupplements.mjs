#!/usr/bin/env node
/**
 * Tornesch supplements: Mölln Hof, Danzenbarg, Mühle, Kapelle, Wohld, Schule, Villen, Torneum
 *   node scripts/cityPack/mergeTorneschSupplements.mjs --apply
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
  const key = text.slice(0, 88).toLowerCase();
  if (
    t.deep_data_pool.some(
      (d) => String(d.text || d).slice(0, 88).toLowerCase() === key,
    )
  ) {
    return;
  }
  t.deep_data_pool.push({ text, tags });
}

function faq(q, a) {
  return `User-Frage: ${q}? Antwort: ${a}`;
}

function setGeo(s, t, lat, lng, r = 22) {
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
  let s = pack.spots.find((x) => x.id === id);
  let t = pack.trigger_points.find((x) => x.id === id);
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
      id,
      name: cfg.name,
      lat: cfg.lat,
      lng: cfg.lng,
      radius_m: 22,
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
  setGeo(s, t, cfg.lat, cfg.lng, cfg.halfM || 22);
  if (cfg.general) t.general_info = cfg.general;
  if (cfg.facts) s.facts = { ...(s.facts || {}), ...cfg.facts };
  if (cfg.bullets) s.bullets = cfg.bullets;
  if (cfg.teasers) {
    s.approach_triggers = cfg.teasers.map((te, i) => {
      const m = te.m || 30;
      const p = offset(cfg.lat, cfg.lng, -m * 0.55, i * 3);
      return {
        id: `${id}_approach_${i + 1}`,
        lat: p.lat,
        lng: p.lng,
        radius_m: Math.min(36, Math.max(12, Math.round(m * 0.35))),
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
}

async function main() {
  const apply = hasFlag('apply');
  const pack = loadPack('tornesch');
  const near = { lat: pack.lat, lng: pack.lng };

  {
    const g =
      (await resolve('Mölln Hof Museum Tornesch', near)) ||
      (await resolve('Pinneberger Straße 70 Tornesch', near));
    ensure(pack, 'tornesch_molln_hof', {
      name: 'Mölln Hof · Volkskundliches Museum',
      category: 'museum',
      lat: g?.lat || 53.695,
      lng: g?.lng || 9.71,
      tier: 2,
      halfM: 26,
      general:
        'Volkskundliches Museum der Kulturgemeinschaft Tornesch (Pinneberger Str. 70 / Bezug Bockhorn 43): ca. 800 qm zu Land- und Hauswirtschaft, Torfabbau und historischen Werkstätten. Nach Abriss des Abschiedshauses (1810) des historischen Tornescher Hofs 2013 retteten Heimatpfleger Holzelemente (Alkovenwand, Tassenschrank, Kachelofen) und bauten sie im Museum als Kaffeestube originalgetreu wieder auf. LIVE Oeffnung.',
      facts: {
        origin:
          'Museum der Kulturgemeinschaft; gerettete Interieurs vom Abschiedshaus 1810 (Abriss 2013).',
        now: 'Pinneberger Strasse 70 — LIVE Oeffnungszeiten.',
        tags: ['museum', 'volkskunde'],
      },
      bullets: [
        'Kaffeestube aus geretteten Hof-Elementen.',
        'Querverbindung Bahnhof / Tornescher Hof.',
      ],
      teasers: [
        {
          m: 40,
          text: 'Hof- und Museumsgebaeude voraus — volkskundliche Sammlung der Kulturgemeinschaft.',
        },
        {
          m: 10,
          text: 'Im Inneren u. a. die wiederaufgebaute Kaffeestube aus dem alten Tornescher Hof.',
        },
      ],
      faqs: [
        [
          'Woran erkenne ich diesen Ort',
          'Am volkskundlichen Museum Moelln Hof / Pinneberger Strasse — nicht am Bahnhofsplatz',
        ],
        [
          'Was ist die Kaffeestube',
          'Gerettete Holzelemente vom 2013 abgerissenen Abschiedshaus (1810) des Tornescher Hofs',
        ],
      ],
      deep: [
        [
          'LIVE: Oeffnung und Fuehrungen der Kulturgemeinschaft frisch pruefen.',
          ['live_hint', 'ephemeral'],
        ],
      ],
    });
    console.log('moelln', g?.lat, g?.lng, g?.address || g?.name);
  }

  {
    const g =
      (await resolve('Danzenbarg Grabhuegel Moorrege', near)) ||
      (await resolve('De Danzenbarg Moorrege Appen', near));
    ensure(pack, 'tornesch_de_danzenbarg', {
      name: 'De Danzenbarg · Grabhuegel',
      category: 'denkmal',
      lat: g?.lat || 53.67,
      lng: g?.lng || 9.74,
      tier: 2,
      halfM: 28,
      district: 'moorrege',
      general:
        'Jungbronzezeitlicher Grabhuegel (um 1500 v. Chr.): ca. 25 m lang, 14 m breit, 2,5 m hoch, unberuehrt geschuetzt. Liegt noerdlich von Appen auf Gemeindegebiet Moorrege, auf einem Geestvorsprung an der Pinnau nahe Ahrenlohe/Esingen — Nachbarraum zu Tornesch, nicht Kernstadt. LIVE Zugang und Betretungsregeln.',
      facts: {
        origin: 'Jungbronzezeit um 1500 v. Chr.; archaeologisches Denkmal.',
        now: 'Gemeinde Moorrege / Naehe Appen–Ahrenlohe — LIVE Wege.',
        tags: ['denkmal', 'archaeologie', 'peripherie'],
      },
      teasers: [
        {
          m: 50,
          text: 'Auf dem Geestvorsprung an der Pinnau zeichnet sich der langgestreckte Grabhuegel ab.',
        },
        {
          m: 15,
          text: 'De Danzenbarg: rund 25 auf 14 Meter, etwa 2,5 Meter hoch — geschuetzte Bronzezeit.',
        },
      ],
      faqs: [
        [
          'Woran erkenne ich diesen Ort',
          'Am langgestreckten Huegel an der Pinnau — Gemeinde Moorrege, nicht Tornesch-Zentrum',
        ],
        [
          'Liegt das in Tornesch',
          'Nein, Moorrege/Appen-Naehe; geografisch nah an Ahrenlohe/Esingen',
        ],
      ],
      deep: [
        [
          'LIVE: Denkmalschutz — nicht betreten oder freischaufeln.',
          ['live_hint', 'ephemeral'],
        ],
      ],
    });
    console.log('danzenbarg', g?.lat, g?.lng, g?.address || g?.name);
  }

  {
    const g =
      (await resolve('Bi de Moehl 8 Tornesch Esingen', near)) ||
      (await resolve('Bi de Möhl 8 Tornesch', near));
    ensure(pack, 'tornesch_dampfmuhlen_ruine', {
      name: 'Bi de Moehl · ehemalige Windmuehle',
      category: 'denkmal',
      lat: g?.lat || 53.69,
      lng: g?.lng || 9.72,
      tier: 2,
      halfM: 22,
      district: 'esingen',
      general:
        'Esingen: An Bi de Moehl 8 steht noch das Vorderhaus einer ehemaligen Windmuehle aus dem spaeten 19. Jahrhundert. Aelterer Muehlenstandort am Wischmoehlenweg vor der Einmuendung des Ohrtbrookgrabens in die Pinnau (Muehlenteich) — vermutlich schon vor 1600 stillgelegt. LIVE: oft privat — nur von aussen.',
      facts: {
        origin:
          'Windmuehlen-Vorderhaus spaetes 19. Jh.; aelterer Standort Wischmoehlenweg vor 1600.',
        now: 'Esingen — Aussenansicht; LIVE Eigentum/Zugang.',
        tags: ['denkmal', 'muehle', 'esingen'],
      },
      teasers: [
        {
          m: 30,
          text: 'In Esingen: Vorderhaus der alten Windmuehle an Bi de Moehl.',
        },
      ],
      faqs: [
        [
          'Woran erkenne ich diesen Ort',
          'Am Vorderhaus Bi de Moehl 8 in Esingen — ehemalige Windmuehle',
        ],
        [
          'Gab es aeltere Muehlen',
          'Ja, am Wischmoehlenweg/Ohrtbrookgraben zur Pinnau — vermutlich vor 1600 aufgegeben',
        ],
      ],
      deep: [
        [
          'LIVE: Privatgrund — respektvoll von der Strasse aus betrachten.',
          ['live_hint', 'ephemeral'],
        ],
      ],
    });
    console.log('moehl', g?.lat, g?.lng, g?.address || g?.name);
  }

  {
    const g =
      (await resolve('Friedenskapelle Friedhof Tornesch', near)) ||
      (await resolve('Friedensallee 14 Tornesch', near));
    ensure(pack, 'tornesch_friedenskapelle', {
      name: 'Friedenskapelle & historischer Grabsteinwall',
      category: 'kirche',
      lat: g?.lat || 53.7,
      lng: g?.lng || 9.71,
      tier: 2,
      halfM: 24,
      general:
        'Auf dem Tornescher Friedhof nahe der alten Kapelle: Wall mit erhaltenen historischen Grabsteinen. Darunter u. a. Grabstein Familie Muenster/Glismann (1919) — Gemischtwarenladen seit der ersten Haelfte des 19. Jh. an der heutigen B5. LIVE Friedhofsruhe.',
      facts: {
        origin: 'Grabsteinwall an der Kapelle; Muenster/Glismann 1919.',
        now: 'Friedhof Tornesch — respektvoll zugaenglich.',
        tags: ['kirche', 'friedhof', 'gedenken'],
      },
      teasers: [
        {
          m: 40,
          text: 'Friedhof und Kapelle — am Wall stehen gerettete historische Grabsteine.',
        },
        {
          m: 8,
          text: 'Grabstein Muenster/Glismann: Erinnerung an den alten Gemischtwarenladen an der B5.',
        },
      ],
      faqs: [
        [
          'Woran erkenne ich diesen Ort',
          'An der Friedenskapelle mit Grabsteinwall auf dem Tornescher Friedhof',
        ],
        [
          'Wer waren Muenster/Glismann',
          'Ladenbesitzer an der heutigen B5; Stein von 1919 am Wall',
        ],
      ],
      deep: [
        [
          'LIVE: Bestattungen/Ruhezeiten beachten.',
          ['live_hint', 'ephemeral'],
        ],
      ],
    });
    console.log('kapelle', g?.lat, g?.lng, g?.address || g?.name);
  }

  {
    const t = pack.trigger_points.find((x) => x.id === 'tornesch_esinger_wohld');
    const s = pack.spots.find((x) => x.id === 'tornesch_esinger_wohld');
    if (t && s) {
      s.name = 'Esinger Wohld · Staatsforst Rantzau';
      s.place_tier = 2;
      s.pack_role = 'story';
      t.general_info =
        'Esinger Wohld = lokaler Name fuer den Staatsforst Rantzau oestlich Tornesch: ca. 113 ha geschlossener Buchen-/Eichenwald auf Altmoraene, FFH/Natura 2000. Kein getrennter Forst-Rantzau-West-Story-Spot — ueberlappende Gebietsbezeichnung. LIVE Wege; Querverbindung Himmelmoor.';
      s.facts = {
        ...(s.facts || {}),
        origin: 'Staatsforst Rantzau / lokaler Name Esinger Wohld; ca. 113 ha FFH.',
        now: 'Wald-Naherholung oestlich Tornesch — LIVE Wege.',
        tags: ['natur', 'ffh', 'forst'],
      };
      pushDeep(
        t,
        faq(
          'Woran erkenne ich diesen Ort',
          'Am Buchen-Eichen-Wald oestlich Tornesch — Esinger Wohld / Staatsforst Rantzau',
        ),
        ['faq', 'user_question'],
      );
      pushDeep(
        t,
        faq(
          'Unterschied Forst Rantzau und Esinger Wohld',
          'Praktisch dieselbe Gebietskulisse — Wohld ist der lokale Name',
        ),
        ['faq', 'user_question'],
      );
    }
    const west = pack.spots.find((x) =>
      /forst rantzau west/i.test(x.id + ' ' + x.name),
    );
    if (west) {
      west.pack_role = 'directory';
      west.place_tier = 4;
      west.tags = [
        ...new Set([
          ...(west.tags || []),
          'directory',
          'alias',
          'amenity_skip',
          'tier4',
        ]),
      ];
    }
  }

  {
    const g = await resolve('Esinger Strasse 102 Tornesch Schule', near);
    ensure(pack, 'tornesch_kirchensaal_esinger_schule', {
      name: 'Kirchensaal Esinger Schule',
      category: 'kirche',
      lat: g?.lat || 53.69,
      lng: g?.lng || 9.715,
      tier: 2,
      halfM: 22,
      district: 'esingen',
      general:
        'Esinger Str. 102: dreifluegeliger neugotischer Backsteinbau 1905/06 (alte Esinger Schule). Nordfluegel-Saal urspruenglich sakral; 2005 Innenraum mit Mitteln der Ernst-Martin-Groth-Stiftung restauriert. LIVE Zugang oft nur bei Veranstaltungen.',
      facts: {
        origin: 'Schule 1905/06 neugotisch; Kirchensaal Nordfluegel; Restaurierung 2005.',
        now: 'Esinger Strasse 102 — LIVE Zugang.',
        tags: ['kirche', 'esingen'],
      },
      teasers: [
        {
          m: 30,
          text: 'Dreifluegeliger Backsteinbau der alten Esinger Schule — im Nordfluegel der Kirchensaal.',
        },
      ],
      faqs: [
        [
          'Woran erkenne ich diesen Ort',
          'Am neugotischen Schulbau Esinger Strasse 102 — nicht an der Kirche Juergen-Siemsen-Strasse',
        ],
        [
          'Kann man rein',
          'LIVE: oft nur bei Gottesdienst/Veranstaltung — pruefen',
        ],
      ],
      deep: [
        [
          'Querverbindung: Heimathaus/Groth-Stiftung finanzierte die Saal-Restaurierung 2005.',
          ['querverbindung'],
        ],
        ['LIVE: Zugang und Termine frisch pruefen.', ['live_hint', 'ephemeral']],
      ],
    });
    console.log('schule', g?.lat, g?.lng, g?.address || g?.name);
  }

  {
    const g =
      (await resolve('Ahrenloher Strasse 32 Tornesch', near)) || {
        lat: 53.6975,
        lng: 9.7175,
      };
    ensure(pack, 'tornesch_villen_bahnhof', {
      name: 'Villen am Bahnhofsumfeld',
      category: 'denkmal',
      lat: g.lat,
      lng: g.lng,
      tier: 2,
      halfM: 45,
      general:
        'Nach dem Bahnanschluss entstanden an Juergen-Siemsen-, Ahrenloher und Friedrichstrasse Villen der wilhelminischen Epoche, des Historismus und Heimatstils. Beispiele: Villa Nolte (Ahrenloher Str. 21, ehem. Darlehenskasse) und Villa Moelln 1912 (Ahrenloher Str. 32) mit markantem Turm, ehem. Baumschulbesitzer. Primaer Aussenansicht — LIVE Privatnutzung.',
      facts: {
        origin: 'Bahnzeit-Villen; Villa Moelln 1912.',
        now: 'Strassenraum um den Bahnhof — von aussen erlebbar.',
        tags: ['denkmal', 'architektur'],
      },
      teasers: [
        {
          m: 60,
          text: 'Entlang Ahrenloher / Juergen-Siemsen: Villen der Bahnzeit mit Tuermen und Historismus-Fassaden.',
        },
        {
          m: 20,
          text: 'Villa Moelln mit Turm (1912) — einst Baumschulbesitzer.',
        },
      ],
      faqs: [
        [
          'Woran erkenne ich diesen Ort',
          'An den Villenstrassen rund um den Bahnhof — z. B. Ahrenloher Strasse mit Turmvilla',
        ],
        [
          'Kann man rein',
          'Meist privat/geschaeftlich — von aussen entlanggehen',
        ],
      ],
      deep: [
        [
          'Querverbindung: Bahnhof als Nukleus der Stadtentwicklung ab 1844.',
          ['querverbindung'],
        ],
      ],
    });
    console.log('villen', g.lat, g.lng);
  }

  {
    const g = await resolve('Torneum Grosser Moorweg 30 Tornesch', near);
    ensure(pack, 'tornesch_torneum', {
      name: 'Torneum · Sportpark FC Union',
      category: 'sport',
      lat: g?.lat || 53.7,
      lng: g?.lng || 9.72,
      tier: 4,
      role: 'directory',
      halfM: 40,
      general:
        'Grosser Moorweg 30: seit 2015 Heimat des FC Union Tornesch von 1921 e.V. — 3-Court-Soccerhalle, Kunstrasen, Naturrasen, Technikareal, ca. 670 m Laufstrecke, Boule. LIVE Training/Spiele — kein Story-Wegweiser.',
      facts: {
        now: 'Sportpark — LIVE Nutzung.',
        tags: ['sport', 'fc_union'],
      },
      deep: [
        [
          'LIVE: Hallenzeiten und Spiele frisch pruefen.',
          ['live_hint', 'ephemeral'],
        ],
      ],
    });
    console.log('torneum', g?.lat, g?.lng, g?.address || g?.name);
  }

  pack._pack_index = {
    total: pack.spots.length,
    story: pack.spots.filter((s) => s.pack_role !== 'directory').length,
    directory: pack.spots.filter((s) => s.pack_role === 'directory').length,
    offline_qa: (pack._offline_qa || []).length,
  };

  const gate = runQualityGate(pack, { strict: false });
  console.log(
    `[supp] story=${pack._pack_index.story} dir=${pack._pack_index.directory} ok=${gate.ok} thin=${(gate.gaps?.needsDeep || []).length}`,
  );

  if (apply) {
    savePack(pack, { bumpVersion: true });
    console.log('[supp] wrote tornesch');
  } else {
    console.log('[supp] dry-run — add --apply');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
