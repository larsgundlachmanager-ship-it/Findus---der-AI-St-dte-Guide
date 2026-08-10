#!/usr/bin/env node
/**
 * Merge Tornesch Master-Datenarchitektur into pack.
 *   node scripts/cityPack/mergeTorneschMaster.mjs --apply
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
  trigger.lat = lat;
  trigger.lng = lng;
  trigger.radius_m = halfM || 24;
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

function demote(pack, rx) {
  for (const s of pack.spots) {
    if ((s.tags || []).includes('master_report') && s.pack_role === 'story') continue;
    if (rx.test(s.id + ' ' + s.name)) {
      s.pack_role = 'directory';
      s.place_tier = 4;
      s.tags = [
        ...new Set([...(s.tags || []), 'directory', 'tier4', 'amenity_skip']),
      ];
    }
  }
}

function main() {
  const apply = hasFlag('apply');
  const pack = loadPack('tornesch');
  if (!pack) throw new Error('tornesch missing');

  pack._city_history =
    'Tornesch (Kreis Pinneberg) wuchs nicht aus dem Urdorf Esingen (urkundlich 1285, Kloster Uetersen), sondern entlang der Altona-Kieler Eisenbahn (1844). Esinger wollten keinen Bahnhof im Kern; Landwirt Jürgen Siemsen stellte dem dänischen König Christian VIII. Land und erhielt Schankrecht für die Bahnhofsgastronomie — Keimzelle des heutigen Tornesch. Industrialisierung (Brennerei/Presshefe, Scholler-Tornesch-Holzverzuckerung) verschob die Gravitation; 1930 Umbenennung der Gemeinde von Esingen in Tornesch. Stadtrechte erst 2005. Dunkle Kapitel: Arisierung der Brennerei ab 1938, Zwangsarbeit/Flugbenzin-Additiv, Kriegsgefangenenlager am Tornescher Hof. Heute: HVV-Pendlerstadt (Ring C), Businesspark Oha, Naherholung Esinger Wohld/Himmelmoor.';

  {
    const t = pack.trigger_points.find((x) =>
      /stadtgeschichte|tornesch_tornesch/i.test(x.id),
    );
    const s = pack.spots.find((x) =>
      /stadtgeschichte|tornesch_tornesch/i.test(x.id),
    );
    if (t) t.general_info = pack._city_history;
    if (s) {
      s.pack_role = 'story';
      s.place_tier = 1;
      s.tags = [...new Set([...(s.tags || []), 'master_report', 'city_welcome'])];
    }
  }

  ensureSpot(pack, 'tornesch_bahnhof', {
    name: 'Bahnhof Tornesch & Bahnhofsplatz',
    category: 'bahnhof',
    lat: 53.697786,
    lng: 9.718433,
    tier: 1,
    halfM: 36,
    district: 'zentrum',
    general:
      'Nukleus der modernen Stadt: Bahnhof 1844 eröffnet / Gebäude 1845, Denkmalschutz, stark überformt (u. a. 1984). Historische Nutzungen substituiert: Gepäckannahme → Zeitschriftenhandel, Wartebereich → Imbiss, Bahnhofsgaststätte (Siemsens Schankrecht) → Shisha-Bar. Ehemaliger Güterschuppen 1845 teils noch erkennbar. Altenteilerhaus Tornescher Hof (1810) 2013 abgerissen. Fußgängerbrücke 2010. LIVE: RB61/RB71, HVV, Freitags-Wochenmarkt auf dem Platz.',
    facts: {
      origin:
        '1844/45 Altona-Kieler Bahn; Jürgen Siemsen stellte Land + Schankrecht; Adresse Bahnhofsplatz / Jürgen-Siemsen-Straße.',
      architecture:
        'Denkmalgeschütztes Empfangsgebäude, stark umgenutzt; Güterschuppen 1845; Brücke 2010.',
      now: 'Pendlerknoten RB61/RB71 — LIVE Fahrplan. Freitags Markt (u. a. Fisch) — LIVE Zeiten.',
      tags: ['bahnhof', 'geschichte', 'zentrum'],
    },
    bullets: [
      'Ohne Bahn keine Ortsverschiebung Esingen → Tornesch.',
      'Querverbindung: Brennerei Esinger Straße (Industrie folgt der Bahn).',
    ],
    teasers: [
      {
        m: 150,
        text: 'Schienen und Bahnhofsplatz voraus — die Lebensader, die Tornesch 1844 erst entstehen ließ.',
      },
      {
        m: 50,
        text: 'Am Platz: Blick auf Gleise und den historischen Güterschuppen von 1845.',
      },
      {
        m: 20,
        text: 'Denkmalgeschütztes Bahnhofsgebäude — heutige Läden überdecken die alte Wartesaal-Nutzung.',
      },
      {
        m: 5,
        text: 'Fußgängerbrücke von 2010 — Überblick über die Nord-Süd-Achse der alten Bahntrasse.',
      },
    ],
    faqs: [
      [
        'Woran erkenne ich diesen Ort',
        'Am Bahnhofsplatz mit Gleisen und Empfangsgebäude — Zentrum Tornesch, nicht Esingen-Dorfkern',
      ],
      [
        'Warum liegt der Bahnhof nicht in Esingen',
        'Esinger wollten ihn nicht im Kern; Jürgen Siemsen stellte Land und erhielt Schankrecht',
      ],
      [
        'Wann ist Wochenmarkt',
        'LIVE: typisch Freitag auf dem Bahnhofsplatz — aktuelle Zeiten prüfen',
      ],
    ],
    deep: [
      [
        'LIVE: RB61/RB71, Barrierefreiheit/Mobilitätsservice und Marktbeschicker nie aus dem Pack vorlesen.',
        ['live_hint', 'ephemeral', 'transit'],
      ],
      [
        'Tornescher Hof: Altenteilerhaus 1810, Abriss 2013 — Name bleibt als Ortsbezug am Gewerbe.',
        ['geschichte'],
      ],
    ],
  });

  ensureSpot(pack, 'tornesch_alte_brennerei', {
    name: 'Alte Brennerei & Zwangsarbeiter-Gedenkstätte',
    category: 'denkmal',
    lat: 53.6985,
    lng: 9.7165,
    tier: 1,
    halfM: 26,
    district: 'zentrum',
    general:
      'Esinger Straße 1: industrielles Epizentrum. Brennerei & Presshefefabrik 1914/15; in den 1920ern internationales Scholler-Tornesch-Verfahren (Holzverzuckerung → Bioethanol, Perkolatoren mit verdünnter Schwefelsäure). Ab 1938 Arisierung der jüdischen Hamburger Eigentümer; kriegswichtige Produktion u. a. Ethylenbromid (Antiklopfmittel für Flugbenzin) mit Zwangsarbeitern/Kriegsgefangenen (Okt. 1944: 36 Zwangsarbeiter ≈ ¼ der Belegschaft; u. a. Henryk Bejerski, 12-jährige Lydia Labunski). Heute vor allem das Laborgebäude erhalten; Gedenktafel seit 2002. LIVE: aktuelle Nutzung (Bäckerei/Stadtwerke/Gastro) und Gedenkrundgänge (Stadtarchiv, um den 8. Mai).',
    facts: {
      origin: 'Brennerei 1914/15; Scholler-Tornesch-Verfahren; Esinger Straße 1.',
      now: 'Laborgebäude + Gedenktafel; Mischnutzung — LIVE Öffnung/Gedenken.',
      tags: ['denkmal', 'industrie', 'gedenken', 'ns'],
    },
    bullets: [
      'Querverbindung Bahnhof: Industrie folgte der Eisenbahn.',
      'Gedenkkultur: Tafel 2002; Rundgänge Stadtarchiv.',
    ],
    teasers: [
      {
        m: 100,
        text: 'An der Esinger Straße: rotes Backstein-Laborgebäude — letzter Zeuge der großen Fabrik.',
      },
      {
        m: 30,
        text: 'Unscheinbarer Industriebau von 1915 — hier wurde Holz zu Treibstoff verzuckert.',
      },
      {
        m: 10,
        text: 'Gedenktafel voraus: Arisierung, Zwangsarbeit und giftige Kriegsproduktion.',
      },
      {
        m: 2,
        text: 'Tafel lesen: Namen und Schicksale der Zwangsarbeiter, u. a. Henryk Bejerski.',
      },
    ],
    faqs: [
      [
        'Woran erkenne ich diesen Ort',
        'Am Backstein-Laborgebäude Esinger Straße 1 mit Gedenktafel — nicht am Bahnhofsplatz',
      ],
      [
        'Was war das Scholler-Tornesch-Verfahren',
        'Holzverzuckerung zu Zucker/Bioethanol in Perkolatoren — in den 1920ern international beachtet',
      ],
      [
        'Was erinnert an Zwangsarbeit',
        'Gedenktafel am Gebäude; Stadtarchiv-Rundgänge LIVE prüfen',
      ],
    ],
    deep: [
      [
        'LIVE: Gastro/Bäckerei-Öffnung und Gedenktermine nie aus dem Pack vorlesen.',
        ['live_hint', 'ephemeral'],
      ],
    ],
  });

  ensureSpot(pack, 'tornesch_stolperstein_anna_billian', {
    name: 'Stolperstein Anna Billian',
    category: 'denkmal',
    lat: 53.6992,
    lng: 9.7175,
    tier: 2,
    halfM: 12,
    district: 'zentrum',
    general:
      'Norderstraße 61: Stolperstein (verlegt 19.04.2010) für Anna Billian (geb. Hamberg, *1885). Untermieterin bei Familie Kaatsch; nach Denunziation Haft 15.12.1942; Freitod 18.12.1942 im Polizeigefängnis Neumünster.',
    facts: {
      origin: 'Stolperstein 2010; Opfer NS-Verfolgung.',
      now: 'Messingstein im Gehweg — frei zugänglich.',
      tags: ['denkmal', 'stolperstein', 'gedenken'],
    },
    teasers: [
      {
        m: 5,
        text: 'Messingstein im Gehweg — letzter selbstgewählter Wohnort von Anna Billian.',
      },
    ],
    faqs: [
      [
        'Woran erkenne ich diesen Ort',
        'Am Stolperstein Norderstraße 61 vor dem Haus — Blick nach unten',
      ],
    ],
    deep: [
      [
        'Querverbindung: Brennerei-Gedenken und Tafel Kriegsgefangenenlager Lindenweg.',
        ['querverbindung', 'gedenken'],
      ],
    ],
  });

  ensureSpot(pack, 'tornesch_gedenktafel_kg_lager', {
    name: 'Gedenktafel sowjetisches Kriegsgefangenenlager',
    category: 'denkmal',
    lat: 53.6972,
    lng: 9.7158,
    tier: 2,
    halfM: 18,
    district: 'zentrum',
    general:
      'Lindenweg 2 (Fassade am heutigen REWE): Tafel enthüllt 27.01.2019. Ab Juni 1942 Umbau von Teilen des Tornescher Hofes zu einem Lager für über 100 sowjetische Kriegsgefangene (Auftrag Gemeinde unter Bürgermeister Johannes von Helms); Arbeit u. a. in der Konservenfabrik Habekost.',
    facts: {
      origin: 'Lager ab 1942 am Tornescher Hof; Tafel 2019.',
      now: 'Gedenktafel an moderner Supermarkt-Fassade — LIVE Einkaufszeiten getrennt.',
      tags: ['denkmal', 'gedenken', 'ns'],
    },
    teasers: [
      {
        m: 10,
        text: 'An der Supermarkt-Fassade: Gedenktafel zum sowjetischen Kriegsgefangenenlager von 1942.',
      },
    ],
    faqs: [
      [
        'Woran erkenne ich diesen Ort',
        'An der Gedenktafel Lindenweg 2 am REWE — nicht im Bahnhofsgebäude',
      ],
      [
        'Querverbindung Tornescher Hof',
        'Schankrecht/Bahnhof gründete den Ort — später Lagerstandort am Hofgelände',
      ],
    ],
    deep: [
      ['LIVE: REWE-Öffnung getrennt vom Gedenken — nicht vermischen.', ['live_hint', 'ephemeral']],
    ],
  });

  ensureSpot(pack, 'tornesch_heimathaus_tornesch', {
    name: 'Heimathaus Ostermannscher Hof & Stadtarchiv',
    category: 'museum',
    lat:
      pack.trigger_points.find((t) => t.id === 'tornesch_heimathaus_tornesch')?.lat ||
      53.705,
    lng:
      pack.trigger_points.find((t) => t.id === 'tornesch_heimathaus_tornesch')?.lng ||
      9.72,
    tier: 1,
    halfM: 28,
    district: 'esingen',
    general:
      'Riedweg 3, Tornesch-Esingen: Ostermannscher Hof (Hofstelle Nr. 4). Haupthaus 1738 — reetgedecktes Zweiständer-Fachhallenhaus (zwei Ständerreihen tragen das Dach); Kuhstall 1906; freistehende Dreiständerscheune mit Vollwalm 1800. Seit 1998 Kulturzentrum/Stadtarchiv: u. a. ~930 Bände, 431 Glasplatten Willi Seck, Firmenarchiv Chemische Werke Tornesch. Erhalt über Ernst-Martin-Groth-Stiftung (gegr. 1992). LIVE Archiv-Sprechzeiten und Vermietung.',
    facts: {
      origin: '1738 Fachhallenhaus; ältestes erhaltenes Gebäude der Stadt; Esingen 1285 urkundlich.',
      architecture: 'Zweiständer-Fachhallenhaus, Reetdach; Ensemble Stall/Scheune.',
      now: 'Stadtarchiv + Kulturzentrum — LIVE Öffnung/Anmeldung.',
      tags: ['museum', 'archiv', 'esingen', 'denkmal'],
    },
    bullets: [
      'Urdorf Esingen vs. Bahn-Zentrum Tornesch.',
      'Querverbindung: Archiv dokumentiert Brennerei/Chemische Werke.',
    ],
    teasers: [
      {
        m: 100,
        text: 'Weg von der Esinger Straße: Ruhe des Urdorfs Esingen (Erwähnung 1285).',
      },
      {
        m: 20,
        text: 'Reetdach und Fachhallenhaus von 1738 — Ostermannscher Hof.',
      },
      {
        m: 5,
        text: 'Eingang Heimathaus: hinter den Mauern liegt das Stadtarchiv.',
      },
    ],
    faqs: [
      [
        'Woran erkenne ich diesen Ort',
        'Am reetgedeckten Fachhallenhaus Riedweg 3 in Esingen — nicht am Bahnhof im Zentrum',
      ],
      [
        'Was kann man hier machen',
        'Stadtarchiv/Kulturzentrum — LIVE Sprechzeiten; Wochenendnutzung oft Vermietung',
      ],
    ],
    deep: [
      [
        'LIVE: Archiv typisch Di nachmittag / Do vormittag — immer frisch prüfen; Feiern-Vermietung getrennt.',
        ['live_hint', 'ephemeral'],
      ],
    ],
  });

  ensureSpot(pack, 'tornesch_ev_kirche_tornesch_ev_luth_kirchengemeinde_tornesch', {
    name: 'Tornescher Kirche',
    category: 'kirche',
    lat: pack.trigger_points.find(
      (t) => t.id === 'tornesch_ev_kirche_tornesch_ev_luth_kirchengemeinde_tornesch',
    )?.lat,
    lng: pack.trigger_points.find(
      (t) => t.id === 'tornesch_ev_kirche_tornesch_ev_luth_kirchengemeinde_tornesch',
    )?.lng,
    tier: 2,
    general:
      'Moderne Tornescher Kirche (1960), Jürgen-Siemsen-Straße 28 — zentraler sakraler Anker im bahnnahen Zentrum. Historischer Kirchensaal 1905/06 an der Esinger Schule (Esinger Str. 102), 2005 restauriert. LIVE Gottesdienste (oft sonntags).',
    facts: {
      origin: 'Kirche 1960 im Bahn-Zentrum; älterer Saal an Esinger Schule 1905/06.',
      now: 'Gemeindekirche — LIVE Öffnung/Gottesdienst.',
      tags: ['kirche'],
    },
    teasers: [
      {
        m: 30,
        text: 'Kirchenbau an der Jürgen-Siemsen-Straße — sakraler Anker nahe dem Bahnhofsnukleus.',
      },
    ],
    faqs: [
      [
        'Woran erkenne ich diesen Ort',
        'An der modernen Kirche Jürgen-Siemsen-Straße 28 — nicht am Heimathaus in Esingen',
      ],
    ],
    deep: [
      ['LIVE: Gottesdienstzeiten und Gospelchor-Proben prüfen.', ['live_hint', 'ephemeral']],
      [
        'Querverbindung: Friedenskapelle als weiterer sakraler Punkt — Katalog/Story je nach Stoff.',
        ['querverbindung'],
      ],
    ],
  });

  ensureSpot(pack, 'tornesch_esinger_wohld', {
    name: 'Esinger Wohld & Forst Rantzau',
    category: 'natur',
    lat: pack.trigger_points.find((t) => t.id === 'tornesch_esinger_wohld')?.lat,
    lng: pack.trigger_points.find((t) => t.id === 'tornesch_esinger_wohld')?.lng,
    tier: 2,
    halfM: 40,
    general:
      'Östlich: historischer Buchen-/Eichenwald auf Altmoräne (Staatsforst Rantzau / Esinger Wohld). Naherholung mit markierten Wegen — z. B. „Verwunschener Waldpfad“ ca. 5,3 km (LIVE Wegezustand). Querverbindung Himmelmoor (größtes zusammenhängendes Hochmoor SH, Natura 2000/FFH, Renaturierung nach Torfabbau; Radfahren auf feuchten Moorpfaden untersagt).',
    facts: {
      now: 'Wald-/Moor-Naherholung — LIVE Routen und Betretungsregeln.',
      tags: ['natur', 'wanderung', 'forst'],
    },
    teasers: [
      {
        m: 60,
        text: 'Buchen und Eichen des Esinger Wohlds — Wald auf der Altmoräne östlich der Stadt.',
      },
    ],
    faqs: [
      [
        'Woran erkenne ich diesen Ort',
        'Am Staatsforst/Esinger Wohld mit Waldwegen — nicht am Bahnhofsplatz',
      ],
      [
        'Darf man im Himmelmoor radfahren',
        'Auf feuchten Moorpfaden typisch nein — LIVE aktuelle Gebote prüfen',
      ],
    ],
    deep: [
      [
        'LIVE: lange Himmelmoor-Rundkurse und Torfbahn-Relikte — Wege/Sperrungen frisch prüfen.',
        ['live_hint', 'ephemeral', 'natur'],
      ],
    ],
  });

  ensureSpot(pack, 'tornesch_businesspark_oha', {
    name: 'Businesspark Tornesch-Oha',
    category: 'service',
    lat: 53.69,
    lng: 9.73,
    tier: 4,
    role: 'directory',
    halfM: 50,
    district: 'oha',
    general:
      'Lise-Meitner-Allee: ca. 324.000 m² Sondergebiet (B-Plan 47 ab 1998), ursprünglich Abfallwirtschaftsidee verworfen; WEP-Entwicklung für Logistik/Recycling (u. a. GAB, Otto Dörner, Medac), 24h-Betrieb möglich. Lage an A23 Ausfahrt 15 — LIVE ÖPNV/Zufahrt.',
    facts: {
      now: 'Gewerbe-/Logistikpark — kein Story-Trigger.',
      tags: ['gewerbe', 'oha'],
    },
    deep: [
      ['LIVE: Firmenzugang und Buslinien frisch prüfen.', ['live_hint', 'ephemeral']],
    ],
  });

  // Rathaus directory-ish but keep story light as admin anchor
  {
    const r = pack.spots.find((s) => s.id === 'tornesch_rathaus_tornesch');
    if (r) {
      const t = pack.trigger_points.find((x) => x.id === r.id);
      r.pack_role = 'story';
      r.place_tier = 2;
      r.tags = [...new Set([...(r.tags || []), 'master_report'])];
      if (t) {
        t.general_info =
          'Rathaus Wittstocker Straße 7 — zentrale Verwaltung, Fundbüro/Bürgerbelange, faktische Tourist-Auskunft (kein Bahnhofs-Infopoint). LIVE Öffnungszeiten.';
        pushDeep(
          t,
          faq(
            'Woran erkenne ich diesen Ort',
            'Am Rathaus Wittstocker Straße — nicht am Heimathaus in Esingen',
          ),
          ['faq', 'user_question'],
        );
        pushDeep(
          t,
          'LIVE: Mo/Di/Fr vormittags, Do zusätzlich nachmittags typisch — immer prüfen.',
          ['live_hint', 'ephemeral'],
        );
      }
    }
  }

  // NS Opfer denkmal keep + link
  {
    const d = pack.spots.find((s) =>
      /denkmal opfer|nationalsozialisten/i.test(s.id + s.name),
    );
    if (d) {
      const t = pack.trigger_points.find((x) => x.id === d.id);
      d.pack_role = 'story';
      d.place_tier = 2;
      d.tags = [...new Set([...(d.tags || []), 'master_report'])];
      if (t) {
        pushDeep(
          t,
          'Querverbindung: Brennerei-Tafel, Stolperstein Norderstraße 61, Lager-Tafel Lindenweg 2; Friedhof Friedensallee 14 Gedenkstein für 217 Gefallene WWII.',
          ['querverbindung', 'gedenken'],
        );
      }
    }
  }

  demote(pack, /denkmal uetersen|hotel esinger/i);

  pushQa(pack, [
    {
      q: 'Warum heißt Tornesch nicht Esingen?',
      a: 'Urdorf Esingen (1285); Bahnhof 1844 schuf neuen Schwerpunkt; 1930 Umbenennung der Gemeinde in Tornesch; Stadtrechte 2005.',
      tags: ['geschichte'],
    },
    {
      q: 'Wann ist Wochenmarkt in Tornesch?',
      a: 'LIVE: typisch Freitag auf dem Bahnhofsplatz — Zeiten und Beschicker prüfen.',
      tags: ['markt'],
    },
    {
      q: 'Wo ist die Notaufnahme für Tornesch?',
      a: 'Nächstes Klinikum u. a. Regio Kliniken Elmshorn/Pinneberg — LIVE; Notruf 112.',
      tags: ['gesundheit'],
    },
    {
      q: 'Liegt Tornesch im HVV?',
      a: 'Ja, typisch Tarifring C / Zone PI — LIVE Ticketpreise und Grenzen prüfen.',
      tags: ['transit'],
    },
    {
      q: 'Was war die Brennerei Tornesch?',
      a: 'Presshefe/Holzverzuckerung (Scholler-Tornesch); ab 1938 Arisierung und Zwangsarbeit — Gedenktafel Esinger Straße 1.',
      tags: ['geschichte'],
    },
    {
      q: 'Wo ist das Stadtarchiv?',
      a: 'Heimathaus Ostermannscher Hof, Riedweg 3 (Esingen) — LIVE Sprechzeiten.',
      tags: ['kultur'],
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
    `[tornesch] story=${pack._pack_index.story} dir=${pack._pack_index.directory} qa=${pack._offline_qa.length} ok=${gate.ok} err=${gate.errors.length} thin=${(gate.gaps?.needsDeep || []).length}`,
  );

  fs.writeFileSync(
    path.join(STAEDTE_DIR, 'tornesch.research.json'),
    JSON.stringify(
      {
        city_history: pack._city_history,
        master_merged_at: new Date().toISOString(),
        notes: [
          'Bahnhof/Siemsen 1844',
          'Brennerei/Scholler/Zwangsarbeit',
          'Heimathaus Esingen 1738',
          'Stolperstein + KG-Lager-Tafel',
        ],
      },
      null,
      2,
    ),
  );

  if (apply) {
    savePack(pack, { bumpVersion: true });
    console.log('[tornesch] wrote pack');
  } else console.log('[tornesch] dry-run — add --apply');
}

main();
