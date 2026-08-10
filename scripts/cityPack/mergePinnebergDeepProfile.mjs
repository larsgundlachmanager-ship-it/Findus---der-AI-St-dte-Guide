#!/usr/bin/env node
/**
 * Merge comprehensive Pinneberg Struktur-/Datenprofil (Drostei-Tiefe, Parks, Baumschule, Genese).
 *   node scripts/cityPack/mergePinnebergDeepProfile.mjs --apply
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  STAEDTE_DIR,
  hasFlag,
  loadEnvFile,
  loadPack,
  offset,
  savePack,
} from './lib.mjs';
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

function enrich(pack, id, cfg) {
  const spot = pack.spots.find((s) => s.id === id);
  const trigger = pack.trigger_points.find((t) => t.id === id);
  if (!spot || !trigger) {
    console.log('[skip missing]', id);
    return;
  }
  if (cfg.name) spot.name = cfg.name;
  if (cfg.category) spot.category = cfg.category;
  if (cfg.tier != null) spot.place_tier = cfg.tier;
  if (cfg.role) spot.pack_role = cfg.role;
  spot.tags = [
    ...new Set([
      ...(spot.tags || []),
      'master_report',
      'deep_profile',
      cfg.role || spot.pack_role || 'story',
      `tier${spot.place_tier || cfg.tier || 2}`,
    ]),
  ];
  if (cfg.general) trigger.general_info = cfg.general;
  if (cfg.facts) spot.facts = { ...(spot.facts || {}), ...cfg.facts };
  if (cfg.bullets) spot.bullets = cfg.bullets;
  if (cfg.teasers?.length) {
    spot.approach_triggers = cfg.teasers.map((t, i) => {
      const m = t.m || [55, 28, 12][i] || 30;
      const p = offset(trigger.lat, trigger.lng, -m * 0.55, i * 3);
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
}

function pushQa(pack, items) {
  pack._offline_qa = pack._offline_qa || [];
  const seen = new Set(pack._offline_qa.map((e) => String(e.q || '').toLowerCase()));
  for (const e of items) {
    if (seen.has(e.q.toLowerCase())) continue;
    pack._offline_qa.push({
      ...e,
      tags: ['offline_qa', 'deep_profile', ...(e.tags || [])],
    });
  }
}

function main() {
  const apply = hasFlag('apply');
  const pack = loadPack('pinneberg');
  if (!pack) throw new Error('pinneberg missing');

  pack._city_history =
    'Pinneberg (1351 „Pinnenberghe“) wuchs um Burg/Renaissanceschloss der Grafschaft Schauenburg-Pinneberg; Siedlungsschwerpunkte an Koppelstraße und Dingstätte. 1640 Aussterben der Schauenburger → dänische Herrschaft über Landdrosten. Schlosszerstörung im 17. Jh., Abriss der Ruine 1720. 1695 Poststation an der Dingstätte (Route Kopenhagen–Hamburg). Drostei 1765–67; Besuch König Christian VII. 1769. 1867 Kreis Pinneberg mit Kreissitz; Landratsamt später Rübekamp 2 (1893). Thesdorf-Eingemeindung 1928; Baumschul-/Rosenland, Holsteiner Rosenfest ab 1929; Kreiskrankenhaus Fahltskamp 1929. Weltwirtschaftskrise mit massiver Arbeitslosigkeit (~2400 Erwerbslose 1932) und politischer Radikalisierung. NS-Zeit: Rosengarten 1934, Freibad 1938, Stadion 1939, Garnisonsstadt 1939. WWII weitgehend ohne Flächenbombardement — historische Substanz (Drostei) blieb erhalten. Nach 1945 Wiederaufbau, Vertriebene, Gewerbe; 2002 saniertes Rathaus und Rathauspassage. Heute: Kreisstadt und Pendlerknoten in der Metropolregion Hamburg.';

  {
    const t = pack.trigger_points.find((x) => x.id === 'pinneberg_stadtgeschichte');
    if (t) {
      t.general_info = pack._city_history;
      pushDeep(
        t,
        'Post 1695 an der Dingstätte band Pinneberg an die Route Kopenhagen–Hamburg — proto-gewerbliche Erholung nach Schlossverlust.',
        ['geschichte', 'verkehr'],
      );
      pushDeep(
        t,
        '1867 Kreisgründung; Verwaltung erst in der Drostei, ab 1893 neues Landratsamt Rübekamp 2; 1935 Moltkestraße.',
        ['geschichte', 'verwaltung'],
      );
      pushDeep(
        t,
        '„Rosenstadt“: Holsteiner Rosenfest ab 1929 (bis 1955 elf weitere Feste) — Querverbindung Rosengarten und Baumschulmuseum.',
        ['geschichte', 'rosen', 'querverbindung'],
      );
    }
  }

  enrich(pack, 'pinneberg_die_drostei', {
    tier: 1,
    role: 'story',
    general:
      'Die Landdrostei (Dingstätte 23) ist das bedeutendste säkulare Baudenkmal des Kreises: 1765–1767 für den dänischen Landdrosten Hans von Ahlefeldt. Zuschreibung oft Ernst Georg Sonnin (Analogien zu Hamburger Michel/Kieler Schloss/Palais Doos); alternativ diskutiert: Georg Greggenhofer und Cai Dose. Zweigeschossiger Ziegelrohbau mit Mansarddach (schwarzglasierte Pfannen), Kreuzsprossenfenster in Stichbogenblenden, rustizierte Ecklisenen, neunachsige Breitfronten mit Sandsteinportalen und übergiebelten Mittelrisaliten; Ahlefeldt-/Grote-Wappen am Hauptportal. Innen: Marmorhalle, hölzernes Treppenhaus, drei Salons en filade zur Gartenseite, Beletage mit Festsaal und Rokoko-Stuck; Kellergewölbe mit historischem Küchenkamin (heute Gastro — LIVE). Nutzung: Landdroste/Landräte bis 1933; ab 1929/33 Kataster und SA-Standartenhaus; Kataster bis 1984. 1965 Denkmalschutz; 1984 Schenkung an den Kreis mit Auflage Kulturzentrum; Sanierung 1984–1991. Heute Stiftung Landdrostei „Barock und Moderne“: Ausstellungen, Kammermusik, Barocker Herbst, monatlich Trauungen. LIVE Öffnung und Eintritt.',
    facts: {
      origin:
        '1765–67 Ahlefeldt; Dingstätte 23; mögliche Architekten Sonnin / Greggenhofer / Dose.',
      architecture:
        'Backsteinbarock/Rokoko: Mansarddach, Portale, Enfilade, Festsaal-Stuck; Dachgeschoss-Türen aus Vorgängerbau vor 1765.',
      now: 'Kreiskulturzentrum / Stiftung; LIVE Programm, Tickets, Barrierefreiheit (nicht barrierefrei).',
      tags: ['museum', 'barock', 'denkmal', 'kultur'],
    },
    bullets: [
      'Leitmotiv: Haus des Barock und der Moderne.',
      'Vorplatz: historische Thing-/Gerichtsstätte; Drostei-Rosen (Kordes) in Dänemark-Farben.',
    ],
    teasers: [
      {
        m: 100,
        text: 'Barockes Ziegelpalais mit Mansarddach an der Dingstätte — Kontrast zur modernen Bebauung.',
      },
      {
        m: 30,
        text: 'Vorplatz und Freitreppe: Sandsteinportal mit Familienwappen Ahlefeldt/Grote.',
      },
      {
        m: 5,
        text: 'Eingangshalle mit schwarz-weißen Marmorfliesen — dahinter Treppenhaus und Salonflucht.',
      },
    ],
    faqs: [
      [
        'Woran erkenne ich diesen Ort',
        'Am zweigeschossigen Backsteinpalais mit Mansarddach und Sandsteinportal Dingstätte 23',
      ],
      [
        'Wer hat die Drostei gebaut',
        'Auftrag Hans von Ahlefeldt 1765–67; Architekt oft Sonnin zugeschrieben, nicht final belegt',
      ],
      [
        'Was kann man hier machen',
        'Ausstellungen, Konzerte, Lesungen; LIVE Programm. Keller-Gastro und Trauungen LIVE prüfen',
      ],
    ],
    deep: [
      [
        'LIVE: typisch Mi–So 11–17 Uhr Kultur; Eintritt/Ermäßigung nie aus dem Pack vorlesen.',
        ['live_hint', 'ephemeral'],
      ],
      [
        'LIVE: Festival „Barocker Herbst“ und SummerJazz-Bühne am Vorplatz — Termine frisch.',
        ['live_hint', 'kultur', 'ephemeral'],
      ],
      [
        'Dokumentation der Sanierung u. a. in Dieter Beig: Kultur – Ein langer Weg (Landdrostei).',
        ['quelle', 'geschichte'],
      ],
      [
        'Querverbindung: Stadtmuseum Dingstätte 25 (Altes Amtsgericht) und Drosteipark hinter dem Palais.',
        ['querverbindung'],
      ],
    ],
  });

  enrich(pack, 'pinneberg_drosteipark', {
    tier: 2,
    role: 'story',
    general:
      'Direkt hinter der Drostei: öffentlicher Park im Stil eines englischen Landschaftsgartens (um 1800), heute Durchwegung und Naherholung. Denkmalpflegerische/ökologische Evaluation zeigte Wildwuchs und unklare Wege — Sanierungsbedarf. Sommer 2023 mehrstufige Bürgerbeteiligung (u. a. 08.07.2023) statt rein historischer Rekonstruktion: Park sichtbarer und nutzbarer machen. Bürgerwünsche u. a. gegen Umzäunung und gegen starken Baumschnitt für Sichtachsen; für große Wiese, Fahrradstellplätze, Verkehrsberuhigung, modernen Spiel-/Bewegungsbereich (Klettern, Sand, Wasser/„Himmelsspiegel“), Verweilplätze. Workshops u. a. mit KJB Juli 2024. LIVE Baufortschritt und Sperrungen.',
    facts: {
      origin: 'Englischer Landschaftsgarten ~1800 hinter der Drostei.',
      now: 'Öffentlicher Park / Transitraum; Sanierung partizipativ — LIVE Zustand.',
      tags: ['natur', 'park', 'buergerbeteiligung'],
    },
    teasers: [
      { m: 40, text: 'Hinter der Drostei öffnet sich die Grünfläche des Drosteiparks.' },
      { m: 15, text: 'Wege, Wiese und Spielbereich — Stadtpark mit Sanierungsgeschichte.' },
    ],
    faqs: [
      [
        'Woran erkenne ich diesen Ort',
        'An der Grünanlage direkt hinter der Drostei — nicht am Rosengarten in der Fahlt',
      ],
      [
        'Wird der Park saniert',
        'Ja, mit Bürgerbeteiligung ab 2023 — LIVE aktuellen Zustand und Sperrungen prüfen',
      ],
    ],
    deep: [
      [
        'Nutzung laut Beteiligung: oft kurz (<30 Min), zu Fuß/Rad, Spazieren, Transit, Spielplatz.',
        ['nutzung', 'park'],
      ],
      ['LIVE: Bauphasen und Spielplatz-Öffnung frisch prüfen.', ['live_hint', 'ephemeral']],
    ],
  });

  enrich(pack, 'pinneberg_rosengarten_pinneberg', {
    tier: 1,
    role: 'story',
    general:
      'Im Stadtwald Fahlt: denkmalgeschützter Rosengarten, 1934 von Gartenbauinspektor Carl Bradfisch als Reformgarten/Art-Déco-Schaugarten für Holsteiner Rosen angelegt; später Ensemble mit Freibad (1938) und Stadion (1939). Ab 1941 Kriegs-Selbstversorgung als Kartoffelacker; Rekonstruktion als Stadtpark ab 1950. Einziger Park dieser Art in SH mit erhaltener 1930er-Grundstruktur — 2013 als Kulturdenkmal ins Denkmalbuch. Ca. 8000 Rosen in ~80 Sorten, plus Rhododendren, Magnolien, Frühjahrszwiebeln. „Drostei-Rose“ (Kordes) in Rot/Weiß zu 250 Jahren Drostei; Exemplare auch am Drosteivorplatz. Freundeskreis Rosengarten: Pflege, Pflanzenmärkte, Jazz im Rosengarten. Zugänge u. a. Fahltsweide / Burmeisterallee; ganzjährig frei — LIVE Veranstaltungen.',
    facts: {
      origin: '1934 Bradfisch; Reformgarten; Kulturdenkmal seit 2013.',
      architecture:
        'Geometrische Gartenräume, Pergolen, Stelen, Lauben im Stil der späten 1920er/30er.',
      now: 'Öffentlicher Schaugarten in der Fahlt; LIVE Blüte und Events.',
      tags: ['natur', 'garten', 'denkmal', 'rosen'],
    },
    teasers: [
      { m: 80, text: 'Im Stadtwald zeichnen sich Pergolen und geometrische Rosenräume ab.' },
      { m: 20, text: 'Art-Déco-Gartenräume mit Rosen — Schaugarten der Holsteiner Züchtungen.' },
    ],
    faqs: [
      [
        'Woran erkenne ich diesen Ort',
        'Am geometrischen Rosengarten mit Pergolen in der Fahlt — nicht am Drosteipark hinter dem Palais',
      ],
      [
        'Ist der Eintritt frei',
        'Park typisch ganzjährig frei zugänglich — LIVE Veranstaltungen/Märkte prüfen',
      ],
      [
        'Querverbindung Baumschulmuseum',
        'Beide tragen die Baumschul-/Rosen-Identität der Region — Museum eher Technik/Geschichte, Garten Schaufläche',
      ],
    ],
    deep: [
      [
        'LIVE: Jazz im Rosengarten, Pflanzenmärkte und Blütezeiten frisch prüfen.',
        ['live_hint', 'ephemeral', 'kultur'],
      ],
      [
        'Holsteiner Rosenfest ab 1929 prägte das Image „Rosenstadt“ — historische Folie zum Garten.',
        ['geschichte', 'rosen'],
      ],
    ],
  });

  enrich(pack, 'pinneberg_deutsches_baumschulmuseum', {
    tier: 2,
    role: 'story',
    general:
      'Halstenbeker Straße 29: Deutsches Baumschulmuseum (Förderverein; wissenschaftliche Leitung u. a. Dr. Heike Meyer-Schoppa). Dokumentiert Jahreszyklus der Baumschularbeit — Boden, Saat, Pflege, Versand — mit historischen Geräten, Büroeinrichtungen und Archiv. Region = eines der größten zusammenhängenden Baumschulgebiete. Umweltbildung u. a. 360°-Rundgang und Outreach-Formate. Zu Fuß ca. 900 m von Bahnhof Pinneberg bzw. Thesdorf (S3) über Lohstraße/Wilhelm-Schmitt-Straße. LIVE Saisonöffnung.',
    facts: {
      origin: 'Museum zur Baumschulkultur des Pinneberger Landes; Halstenbeker Str. 29.',
      now: 'Saisonales Museum — LIVE Zeiten (oft Mai–Okt., ausgewählte Tage).',
      tags: ['museum', 'baumschule', 'bildung'],
    },
    teasers: [
      { m: 40, text: 'Schilder und Hof des Baumschulmuseums — Technik und Geschichte der Gehölzkultur.' },
    ],
    faqs: [
      [
        'Woran erkenne ich diesen Ort',
        'Am Museumsstandort Halstenbeker Straße — nicht am Rosengarten in der Fahlt',
      ],
      [
        'Wie komme ich hin',
        'Zu Fuß von S3 Pinneberg oder Thesdorf (~900 m); LIVE Wege und Öffnung prüfen',
      ],
    ],
    deep: [
      [
        'LIVE: typisch Mai–Oktober Di/So nachmittags sowie nach Vereinbarung — nie Pack-Zeiten vorlesen.',
        ['live_hint', 'ephemeral'],
      ],
    ],
  });

  // Fahlt
  enrich(pack, 'pinneberg_waldgebiet_fahlt', {
    tier: 2,
    role: 'story',
    general:
      'Stadtwald Fahlt: zentrales Naherholungsgebiet; beherbergt den denkmalgeschützten Rosengarten und grenzt an die historische Freizeitachse Freibad/Stadion. Frei zugängliche Waldwege — LIVE Wegezustand.',
    teasers: [
      { m: 50, text: 'Waldwege der Fahlt — Stadtwald mit Übergang zum Rosengarten.' },
    ],
    faqs: [
      [
        'Woran erkenne ich diesen Ort',
        'Am Stadtwald Fahlt mit Wegen zum Rosengarten — kein reiner Stadtplatz',
      ],
    ],
    deep: [
      ['Querverbindung: Rosengarten und Bäder/Stadion als historisches Freizeitensemble.', ['querverbindung']],
    ],
  });

  // Klinik → directory
  {
    const k = pack.spots.find((s) => s.id === 'pinneberg_regio_klinikum_pinneberg');
    if (k) {
      const t = pack.trigger_points.find((x) => x.id === k.id);
      k.pack_role = 'directory';
      k.place_tier = 4;
      k.category = 'gesundheit';
      k.tags = [
        ...new Set([
          ...(k.tags || []),
          'directory',
          'tier4',
          'amenity_skip',
          'master_report',
        ]),
      ];
      if (t) {
        t.general_info =
          'Regio Klinikum Pinneberg (Sana / Regio Kliniken), Fahltskamp 74: Zentralversorger mit Zentrum für Notfall- und Akutmedizin (24/7). Campus mit MVZ und Rehazentrum. LIVE Kapazitäten, Fachrichtungen und KV-Anlaufpraxis-Zeiten — nie Fallzahlen/Preise aus dem Pack als aktuell vorlesen.';
        pushDeep(
          t,
          faq(
            'Wo ist die Notaufnahme',
            'Zentrum für Notfall- und Akutmedizin am Regio Klinikum, Fahltskamp 74 — bei Lebensgefahr 112',
          ),
          ['faq', 'user_question', 'notfall'],
        );
        pushDeep(
          t,
          'LIVE: KV-Anlaufpraxis am Standort für leichtere Fälle außerhalb der Hausarztzeiten — Öffnung frisch prüfen.',
          ['live_hint', 'ephemeral', 'gesundheit'],
        );
      }
    }
  }

  // Waldenau Markt
  {
    const w = pack.spots.find((s) => s.id === 'pinneberg_waldenauer_marktplatz');
    if (w) {
      const t = pack.trigger_points.find((x) => x.id === w.id);
      w.pack_role = 'directory';
      w.place_tier = 4;
      w.category = 'markt';
      if (t) {
        t.general_info =
          'Waldenauer Marktplatz: kleiner Quartiers-Wochenmarkt (Nahversorgung). LIVE typisch Mittwoch vormittags — Beschicker und Zeiten prüfen.';
        pushDeep(
          t,
          'LIVE: Mi-Markt Waldenau vs. Di/Do/Sa großer Innenstadtmarkt am Rathaus/Drostei/Bismarckstraße.',
          ['live_hint', 'ephemeral', 'markt'],
        );
      }
    }
  }

  {
    const m = pack.spots.find((s) => s.id === 'pinneberg_wochenmarkt_rathausvorplatz');
    if (m) {
      const t = pack.trigger_points.find((x) => x.id === m.id);
      if (t) {
        t.general_info =
          'Innenstadt-Wochenmarkt als Band entlang Fußgängerzone Bismarckstraße / Rathausvorplatz / Drosteivorplatz / Ebert-Passage. LIVE Di, Do, Sa vormittags; hohe Händlerdichte (Obst/Gemüse, Fisch/Fleisch, Bäcker/Feinkost, Pflanzen). Marktmeister der Stadt vor Ort. Nie Sortiment/Preise aus dem Pack vorlesen.';
        pushDeep(
          t,
          'LIVE: ca. 37–45 Beschicker typisch — aktuelle Belegung bei Wirtschaftsförderung/Stadt prüfen.',
          ['live_hint', 'ephemeral'],
        );
      }
    }
  }

  pushQa(pack, [
    {
      q: 'Was ist der Barocker Herbst?',
      a: 'Musikfestival an der Drostei mit Fokus auf Musik der Bau-Epoche. LIVE Termine prüfen.',
      tags: ['kultur'],
    },
    {
      q: 'Warum heißt Pinneberg Rosenstadt?',
      a: 'Historisches Baumschul-/Rosenland; Rosenfeste ab 1929; Rosengarten und Drostei-Rose als sichtbare Anker.',
      tags: ['geschichte'],
    },
    {
      q: 'Was wurde aus dem Drosteipark beschlossen?',
      a: 'Bürgerbeteiligung ab 2023: modern nutzbar ohne strenge Umzäunung; LIVE Sanierungsstand prüfen.',
      tags: ['park'],
    },
    {
      q: 'Wo ist das Deutsche Baumschulmuseum?',
      a: 'Halstenbeker Straße 29; zu Fuß von S3 Pinneberg/Thesdorf. LIVE Öffnung prüfen.',
      tags: ['museum'],
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
    `[deep] story=${pack._pack_index.story} dir=${pack._pack_index.directory} qa=${pack._offline_qa.length} ok=${gate.ok} err=${gate.errors.length}`,
  );

  const researchPath = path.join(STAEDTE_DIR, 'pinneberg.research.json');
  let research = {};
  try {
    research = JSON.parse(fs.readFileSync(researchPath, 'utf8'));
  } catch {
    /* */
  }
  research.deep_profile_merged_at = new Date().toISOString();
  research.city_history = pack._city_history;
  fs.writeFileSync(researchPath, JSON.stringify(research, null, 2));

  if (apply) {
    savePack(pack, { bumpVersion: true });
    console.log('[deep] wrote pinneberg');
  } else {
    console.log('[deep] dry-run — add --apply');
  }
}

main();
