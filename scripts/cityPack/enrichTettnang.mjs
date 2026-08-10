#!/usr/bin/env node
/**
 * Enrich Tettnang skeleton: must-sees, tiers, narration, prune false bus "bahnhöfe".
 *
 *   node scripts/cityPack/enrichTettnang.mjs --apply
 */
import {
  arg,
  boxPolygon,
  hasFlag,
  loadEnvFile,
  loadPack,
  offset,
  savePack,
  slugify,
} from './lib.mjs';
import { requireGoogleKey, resolvePlace } from './google.mjs';
import { runQualityGate } from './qualityGate.mjs';

loadEnvFile();

function pushDeep(trigger, text, tags) {
  if (!text || text.length < 12) return;
  trigger.deep_data_pool = trigger.deep_data_pool || [];
  const key = text.slice(0, 72).toLowerCase();
  if (
    trigger.deep_data_pool.some(
      (d) => String(d.text || d).slice(0, 72).toLowerCase() === key,
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

function ensureSpot(pack, id, { name, category, lat, lng, tier, relevance }) {
  let spot = pack.spots.find((s) => s.id === id);
  let trigger = pack.trigger_points.find((t) => t.id === id);
  if (!spot) {
    spot = {
      id,
      name,
      category,
      district: category,
      tags: [category, 'module1'],
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
      name,
      lat,
      lng,
      radius_m: 26,
      general_info: '',
      deep_data_pool: [],
    };
    pack.trigger_points.push(trigger);
  }
  spot.name = name;
  spot.category = category;
  spot.pack_role = 'story';
  spot.place_tier = tier;
  spot.relevance = relevance || [];
  spot.tags = [
    ...new Set([
      ...(spot.tags || []),
      category,
      'module1',
      `tier${tier}`,
      'story',
      ...(relevance || []),
    ]),
  ];
  setGeo(spot, trigger, lat, lng, tier === 1 ? 30 : 22);
  return { spot, trigger };
}

function approaches(spot, lat, lng, teasers) {
  spot.approach_triggers = teasers.map((text, i) => {
    const m = [52, 24, 10][i] || 30;
    const p = offset(lat, lng, -m * 0.7, i * 4);
    return {
      id: `${spot.id}_approach_${i + 1}`,
      lat: p.lat,
      lng: p.lng,
      radius_m: Math.min(36, Math.max(12, Math.round(m * 0.42))),
      teaser_text: text,
      condition_rule: 'always',
    };
  });
}

async function resolveOrThrow(query, near) {
  const g = await resolvePlace(query, { near });
  if (!g) throw new Error(`resolve failed: ${query}`);
  return g;
}

async function main() {
  requireGoogleKey();
  const pack = loadPack('tettnang');
  if (!pack) throw new Error('tettnang pack missing — run city:skeleton first');
  pack.name = 'Tettnang';
  pack.symbol = pack.symbol || '🌿';
  const center = { lat: pack.lat, lng: pack.lng };

  // Drop false "bahnhof" bus stops / thin parking noise
  const DROP =
    /bärenplatz$|st\.?\s*anna,?\s*tettnang$|bahnhofstraße$|tettnang kirche$|seestraße$|kreiskrankenhaus$|hochhaus$|^parkplatz$/i;
  const before = pack.spots.length;
  pack.spots = pack.spots.filter(
    (s) => !DROP.test(s.name) && !(s.category === 'bahnhof' && /tettnang/i.test(s.name) && !/bahnhof\b/i.test(s.name)),
  );
  // Drop generic parkplatz-only
  pack.spots = pack.spots.filter((s) => !/^parkplatz$/i.test(s.name));
  const keep = new Set(pack.spots.map((s) => s.id));
  pack.trigger_points = (pack.trigger_points || []).filter((t) => keep.has(t.id));
  console.log(`[prune] ${before} → ${pack.spots.length}`);

  // --- Must-sees via Google pin ---
  const neuschloss = await resolveOrThrow('Neues Schloss Tettnang Montfortplatz', center);
  const altschloss = await resolveOrThrow('Altes Schloss Rathaus Tettnang', center);
  const torschloss = await resolveOrThrow('Torschloss Tettnang', center);
  const hopfen = await resolveOrThrow('Hopfenmuseum Tettnang', center);
  let hopfengut = null;
  try {
    hopfengut = await resolvePlace('Hopfengut No20 Tettnang', { near: center });
  } catch {
    /* optional */
  }
  let bahnhof = null;
  try {
    bahnhof = await resolvePlace('Bahnhof Tettnang', { near: center });
  } catch {
    /* bus-only town possible */
  }

  // City history blob (stable)
  pack._city_history =
    'Tettnang (erste Nennung 882 als Tetinanc) liegt auf einem Höhenrücken knapp nördlich des Bodensees. Über sechs Jahrhunderte prägte das Grafenhaus Montfort die Stadt: Marktrechte, Stadtbefestigung und drei Schlossorte — Torschloss, Altes Schloss und das barocke Neue Schloss. Nach Brand und Wiederaufbau im 18. Jahrhundert endete die Montfort-Herrschaft 1780 zugunsten Österreichs; später kam Tettnang an Württemberg. Heute prägen Hopfenanbau (Tettnanger Aroma-Hopfen), Museen und die Nähe zu Friedrichshafen/Bodensee das Profil.';

  pack._links = [
    {
      id: 'neues_schloss',
      title: 'Neues Schloss Tettnang',
      url: 'https://www.schloss-tettnang.de/',
      tags: ['museum', 'schloss'],
    },
    {
      id: 'stadt_sehen',
      title: 'Sehenswürdigkeiten Stadt Tettnang',
      url: 'https://www.tettnang.de/de/besuchen/sehenswuerdigkeiten/',
      tags: ['orientierung'],
    },
    {
      id: 'tourist_info',
      title: 'Tourist Information Tettnang',
      url: 'https://www.tettnang.de/de/besuchen/',
      tags: ['service'],
    },
  ];

  // 1) Neues Schloss
  {
    const { spot, trigger } = ensureSpot(pack, 'tettnang_neues_schloss', {
      name: 'Neues Schloss Tettnang',
      category: 'museum',
      lat: neuschloss.lat,
      lng: neuschloss.lng,
      tier: 1,
      relevance: ['geschichte', 'architektur', 'museum'],
    });
    spot.facts = {
      origin:
        'Ab 1712 als Residenz der Grafen von Montfort geplant (Baumeister Christoph Gessinger); nach Brand 1753 Innenausstattung mit u.a. Feuchtmayer und Porträts der Familie Kauffmann.',
      architecture:
        'Barocke/rokoko Vierflügelanlage am Montfortplatz — Prunkräume, Schlosskapelle, Treppenhäuser; heute Schlossmuseum der Staatlichen Schlösser und Gärten BW.',
      now: neuschloss.address
        ? `Adresse/Eingang: ${neuschloss.address}`
        : 'Montfortplatz 1 — Museumskasse Südflügel.',
      tags: ['museum', 'schloss', 'montfort'],
    };
    spot.bullets = [
      'Residenz der Grafen von Montfort; Höhepunkt oberschwäbischen Barocks.',
      'Besuch typischerweise mit Führung durch Appartements und Prunkräume.',
      'Tourist-Info am Montfortplatz nebenan.',
    ];
    trigger.general_info =
      'Am Montfortplatz steht die barocke Vierflügelanlage des Neuen Schlosses — ehemalige Residenz der Grafen von Montfort und heute Schlossmuseum. Hell gefasste Fassaden, Eckpavillons und der Platz davor machen den Ort sofort als Herrschaftssitz lesbar. Innen führen bemalte Treppenhäuser zu den Appartements; LIVE: Führungszeiten und Tickets immer frisch prüfen.';
    approaches(spot, neuschloss.lat, neuschloss.lng, [
      'Voraus öffnet sich ein weiter Platz mit einer hellen Schlossfassade — das Neue Schloss der Montforter.',
      'Die Vierflügelanlage mit Eckpavillons rückt näher: Eingang und Museumskasse liegen am Südflügel.',
    ]);
    for (const [q, a] of [
      [
        'Woran erkenne ich diesen Ort',
        'An der großen hellen Vierflügelanlage am Montfortplatz mit Eckpavillons — nicht am kleineren Torschloss am Markt',
      ],
      [
        'Was kann man hier machen',
        'Schlossmuseum / geführte Rundgänge durch Prunkräume und Kapelle; Inforäume teilweise ohne Ticket — LIVE Öffnung prüfen',
      ],
      [
        'Wer hat das Schloss gebaut',
        'Auftrag unter Graf Anton III.; Entwurf Christoph Gessinger ab 1712; nach Brand Mitte des 18. Jh. prachtvolle Innenausstattung',
      ],
      [
        'Wo ist die Tourist-Info',
        'Direkt am Montfortplatz (Nr. 2), neben dem Schloss',
      ],
      [
        'Querverbindung',
        'Vom Neuen Schloss sind Altes Schloss (Rathaus) und Torschloss nur kurze Schritte in der Altstadt — drei Montfort-Adressen in einer Stadt',
      ],
    ]) {
      pushDeep(trigger, faq(q, a), ['faq', 'user_question']);
    }
    pushDeep(
      trigger,
      'LIVE: Führungen, Tickets und Öffnungszeiten des Schlossmuseums frisch prüfen — nie feste Preise aus dem Pack vorlesen.',
      ['live_hint', 'ephemeral'],
    );
    pushDeep(
      trigger,
      `GPS: ${neuschloss.lat.toFixed(6)}, ${neuschloss.lng.toFixed(6)}.`,
      ['gps_confirmed', 'sourced_google'],
    );
  }

  // 2) Altes Schloss / Rathaus
  {
    const { spot, trigger } = ensureSpot(pack, 'tettnang_altes_schloss', {
      name: 'Altes Schloss · Rathaus',
      category: 'verwaltung',
      lat: altschloss.lat,
      lng: altschloss.lng,
      tier: 1,
      relevance: ['geschichte', 'orientierung'],
    });
    spot.facts = {
      origin:
        'Nach Zerstörung der mittelalterlichen Burg im Dreißigjährigen Krieg ab 1667 als Residenz neu errichtet; später Forst/Speicher, seit 1904 Rathaus.',
      architecture:
        'Schlossartiger Bau in der Altstadt — Verwaltungsadresse der Stadt, kein Barockmuseum wie das Neue Schloss.',
      now: altschloss.address || 'Rathaus / Altes Schloss Tettnang',
      tags: ['rathaus', 'montfort'],
    };
    spot.bullets = [
      'Ehemalige Montfort-Residenz, heute Rathaus.',
      'Orientierungsanker zwischen Markt und Neuem Schloss.',
    ];
    trigger.general_info =
      'Das Alte Schloss dient heute als Rathaus: nach dem Brand der mittelalterlichen Burg entstand hier die Residenz der Montforter im 17. Jahrhundert — kompakter und älter im Stadtbild als das barocke Neue Schloss am Platz.';
    approaches(spot, altschloss.lat, altschloss.lng, [
      'Ein schlossartiger Verwaltungsbau mit klarer Fassade — das Alte Schloss, heute Rathaus.',
    ]);
    for (const [q, a] of [
      [
        'Woran erkenne ich diesen Ort',
        'Am Rathaus-/Schlossbau in der Altstadt — kleiner und „städtischer“ als die große Vierflügelanlage am Montfortplatz',
      ],
      [
        'Ist das dasselbe wie das Neue Schloss',
        'Nein: Altes Schloss = frühere Residenz/heute Rathaus; Neues Schloss = barockes Museum am Montfortplatz',
      ],
      [
        'Was macht man hier',
        'Stadtverwaltung / Orientierung in der Altstadt; Museumsführungen gehören zum Neuen Schloss',
      ],
    ]) {
      pushDeep(trigger, faq(q, a), ['faq', 'user_question']);
    }
    pushDeep(
      trigger,
      `GPS: ${altschloss.lat.toFixed(6)}, ${altschloss.lng.toFixed(6)}.`,
      ['gps_confirmed', 'sourced_google'],
    );
  }

  // 3) Torschloss
  {
    const { spot, trigger } = ensureSpot(pack, 'tettnang_torschloss', {
      name: 'Torschloss',
      category: 'denkmal',
      lat: torschloss.lat,
      lng: torschloss.lng,
      tier: 1,
      relevance: ['geschichte', 'architektur'],
    });
    spot.facts = {
      origin:
        'Teil der Stadtbefestigung ab 14. Jh.; Renaissance-Ensemble aus Torturm, Wohnbau und Kapelle; zeitweise Montfort-Residenz, später Schule; heute u.a. Stadtarchiv / Museumsstandort.',
      architecture:
        'Staffelgiebel, Torturm mit Wappentafel, Kapellenanbau — Tor zur Altstadt zwischen Markt und Bärenplatz.',
      now: torschloss.address || 'Torschloss am Markt / Bärenplatz',
      tags: ['denkmal', 'stadtbefestigung'],
    };
    spot.bullets = [
      'Renaissance-Toranlage der Stadtbefestigung.',
      'Torturm + Wohnschloss + Kapelle — Übergang Marktplatz / Bärenplatz.',
    ];
    trigger.general_info =
      'Am Übergang zwischen Markt und Bärenplatz steht das Torschloss: Staffelgiebel, Torturm und Kapellenanbau erzählen Stadtbefestigung und Montfort-Residenz in einem Ensemble — kompakter und „städtischer“ als das Neue Schloss.';
    approaches(spot, torschloss.lat, torschloss.lng, [
      'Voraus ein Torturm mit Staffelgiebel — das Torschloss der alten Stadtbefestigung.',
      'Markt und Bärenplatz treffen sich hier: Durchfahrt und Schlossflügel liegen dicht beieinander.',
    ]);
    for (const [q, a] of [
      [
        'Woran erkenne ich diesen Ort',
        'Am Torturm mit Staffelgiebel zwischen Markt und Bärenplatz — nicht an der großen Vierflügelanlage am Montfortplatz',
      ],
      [
        'Was steckt historisch dahinter',
        'Stadtbefestigung, Renaissance-Ausbau, zeitweise Residenz der Grafen von Montfort, später Schule/Archiv/Museumsnutzung',
      ],
      [
        'Querverbindung',
        'Vom Torschloss sind Neues Schloss und St. Gallus kurze Altstadt-Wege — Montfort-Stadt auf kleinem Radius',
      ],
    ]) {
      pushDeep(trigger, faq(q, a), ['faq', 'user_question']);
    }
    pushDeep(
      trigger,
      `GPS: ${torschloss.lat.toFixed(6)}, ${torschloss.lng.toFixed(6)}.`,
      ['gps_confirmed', 'sourced_google'],
    );
  }

  // 4) Hopfenmuseum (merge existing if near)
  {
    const existing = pack.spots.find((s) => /hopfenmuseum/i.test(s.name));
    const id = existing?.id || 'tettnang_hopfenmuseum';
    const { spot, trigger } = ensureSpot(pack, id, {
      name: 'Hopfenmuseum Tettnang',
      category: 'museum',
      lat: hopfen.lat,
      lng: hopfen.lng,
      tier: 1,
      relevance: ['hopfen', 'museum', 'region'],
    });
    spot.facts = {
      origin:
        'Museum zur über 150-jährigen Geschichte des Tettnanger Hopfenanbaus — Geräte, Szenen aus dem Hopfengarten, Bezug zur Brauerei-Region.',
      architecture:
        'Ausstellungsort mit Bezug zu Hopfengärten und Hopfenpfad in die Landschaft.',
      now: hopfen.address || 'Hopfenmuseum Tettnang',
      tags: ['museum', 'hopfen'],
    };
    spot.bullets = [
      'Tettnanger Aroma-Hopfen — regionale Identität.',
      'Anschluss an den Tettnanger Hopfenpfad (Wander-/Radweg mit Infotafeln).',
    ];
    trigger.general_info =
      'Hier wird greifbar, warum Tettnang nach Hopfen riecht: Das Hopfenmuseum erzählt Anbau, Geräte und Alltag im Hopfengarten — und leitet hinaus auf den Hopfenpfad Richtung Landschaft und Brauerei-Bezug.';
    approaches(spot, hopfen.lat, hopfen.lng, [
      'Ein Museumsstandort mit Hopfen-Thema — Tettnangs grüne Spezialität wird hier erzählt.',
    ]);
    for (const [q, a] of [
      [
        'Woran erkenne ich diesen Ort',
        'Am Hopfenmuseum / Laden-Ensemble mit klarer Museumsbeschilderung — oft mit Hopfenmotiv, nicht am barocken Schloss',
      ],
      [
        'Was ist der Hopfenpfad',
        'Mehrere Kilometer Wander-/Radweg mit Infotafeln vom Museum in die Hopfenlandschaft — LIVE Streckenstatus prüfen',
      ],
      [
        'Warum ist Hopfen hier wichtig',
        'Tettnang ist bekannt für Aroma-Hopfen; Anbau und Region prägen Landschaft und Image',
      ],
    ]) {
      pushDeep(trigger, faq(q, a), ['faq', 'user_question']);
    }
    pushDeep(
      trigger,
      'LIVE: Öffnungszeiten Museum/Laden und aktuelle Führungen frisch prüfen.',
      ['live_hint', 'ephemeral'],
    );
    pushDeep(
      trigger,
      `GPS: ${hopfen.lat.toFixed(6)}, ${hopfen.lng.toFixed(6)}.`,
      ['gps_confirmed', 'sourced_google'],
    );
  }

  // 5) Hopfengut No20 (directory/story hybrid — story tier 2)
  if (hopfengut) {
    const { spot, trigger } = ensureSpot(pack, 'tettnang_hopfengut_no20', {
      name: 'Hopfengut No20',
      category: 'freizeit',
      lat: hopfengut.lat,
      lng: hopfengut.lng,
      tier: 2,
      relevance: ['hopfen', 'gastro', 'erlebnis'],
    });
    spot.facts = {
      origin:
        'Erlebnisort rund um Hopfenanbau mit Museum, Laden und gastronomischem Angebot — Ergänzung zum klassischen Hopfenmuseum.',
      now: hopfengut.address || 'Hopfengut No20 Tettnang',
      tags: ['hopfen', 'erlebnis'],
    };
    trigger.general_info =
      'Hopfengut No20 bündelt Hopfen-Erlebnis mit Laden und Gastlichkeit — ein praktischer Ort, wenn du Anbau und Region nicht nur im Museum, sondern als Hof-/Gut-Atmosphäre spüren willst. LIVE: Öffnung und Angebote frisch prüfen.';
    approaches(spot, hopfengut.lat, hopfengut.lng, [
      'Ein Hopfen-Gut mit Erlebnischarakter — mehr Hof und Genuss als reines Stadtmuseum.',
    ]);
    pushDeep(
      trigger,
      faq(
        'Woran erkenne ich diesen Ort',
        'Am Gut-/Hof-Ensemble mit Hopfenbezug außerhalb der reinen Altstadt-Schlossachse',
      ),
      ['faq', 'user_question'],
    );
    pushDeep(
      trigger,
      'LIVE: Speisekarte, Preise und Öffnungszeiten nie aus dem Pack — frisch suchen.',
      ['live_hint', 'ephemeral', 'gastro'],
    );
  }

  // 6) St. Gallus (existing)
  {
    const gallus = pack.spots.find((s) => /st\.?\s*gallus/i.test(s.name));
    if (gallus) {
      const t = pack.trigger_points.find((x) => x.id === gallus.id);
      gallus.pack_role = 'story';
      gallus.place_tier = 1;
      gallus.relevance = ['kirche', 'geschichte'];
      gallus.tags = [
        ...new Set([...(gallus.tags || []), 'tier1', 'story', 'module1']),
      ];
      gallus.facts = {
        ...(gallus.facts || {}),
        origin:
          'Gallus-Patrozinium schon in frühen Urkunden; gotischer Turm aus dem Bau des 15. Jh.; heutiges Schiff von 1860 nach Abriss des barocken Vorgängers; Renovierungen nach Kriegsschäden.',
        architecture:
          'Stadtpfarrkirche mit gotischem Turm und neuem Kirchenschiff — markante Vertikale im Stadtbild.',
        tags: ['kirche'],
      };
      if (t) {
        t.general_info =
          'Die Stadtpfarrkirche St. Gallus trägt den Turm aus dem späten Mittelalter und ein Kirchenschiff des 19. Jahrhunderts — spiritueller und visueller Anker der Altstadt neben den Montfort-Schlössern.';
        for (const [q, a] of [
          [
            'Woran erkenne ich diesen Ort',
            'Am hohen Kirchturm der Stadtpfarrkirche — nicht am Schloss-Torturm',
          ],
          [
            'Was ist besonders',
            'Gotischer Turm bleibt vom älteren Bau; Schiff von 1860; Name Gallus verbindet mit früher St.-Gallen-Geschichte der Region',
          ],
        ]) {
          pushDeep(t, faq(q, a), ['faq', 'user_question']);
        }
      }
    }
  }

  // 7) Elektronikmuseum
  {
    const el = pack.spots.find((s) => /elektronikmuseum/i.test(s.name));
    if (el) {
      const t = pack.trigger_points.find((x) => x.id === el.id);
      el.pack_role = 'story';
      el.place_tier = 2;
      el.relevance = ['museum', 'technik'];
      el.tags = [...new Set([...(el.tags || []), 'tier2', 'story'])];
      if (t) {
        t.general_info =
          t.general_info ||
          'Das Elektronikmuseum zeigt Entwicklung der Elektronik von frühen Geräten bis in die Moderne — Tettnangs Technikseite neben Hopfen und Barock.';
        pushDeep(
          t,
          faq(
            'Woran erkenne ich diesen Ort',
            'Am Museumsstandort mit Elektronik-/Technikbeschilderung — oft im historischen Gebäudeensemble der Innenstadt',
          ),
          ['faq', 'user_question'],
        );
        pushDeep(
          t,
          'LIVE: Öffnungszeiten und Sonderausstellungen frisch prüfen.',
          ['live_hint', 'ephemeral'],
        );
      }
    }
  }

  // 8) Schlosspark
  {
    const park = pack.spots.find((s) => /schlosspark/i.test(s.name));
    if (park) {
      const t = pack.trigger_points.find((x) => x.id === park.id);
      park.pack_role = 'story';
      park.place_tier = 2;
      park.relevance = ['natur', 'schloss'];
      if (t) {
        t.general_info =
          t.general_info ||
          'Der Schlosspark rahmt das Neue Schloss mit Grün — Spazieren und Orientieren zwischen Residenzfassade und Stadt.';
        pushDeep(
          t,
          faq(
            'Woran erkenne ich diesen Ort',
            'Am Grün direkt am Neuen Schloss / Schlossanlage — nicht am Hopfenfeld draußen',
          ),
          ['faq', 'user_question'],
        );
      }
    }
  }

  // 9) Kronenbrunnen
  {
    const br = pack.spots.find((s) => /kronenbrunnen/i.test(s.name));
    if (br) {
      br.pack_role = 'story';
      br.place_tier = 2;
      const t = pack.trigger_points.find((x) => x.id === br.id);
      if (t && !(t.general_info || '').length) {
        t.general_info =
          'Der Kronenbrunnen ist ein Altstadt-Orientierungspunkt — Wasser und Platzmarke mitten in Tettnangs historischem Kern.';
      }
    }
  }

  // 10) Bahnhof if real
  if (bahnhof && /bahnhof/i.test(bahnhof.name || 'Bahnhof')) {
    const { spot, trigger } = ensureSpot(pack, 'tettnang_bahnhof', {
      name: bahnhof.name || 'Bahnhof Tettnang',
      category: 'bahnhof',
      lat: bahnhof.lat,
      lng: bahnhof.lng,
      tier: 2,
      relevance: ['transport'],
    });
    trigger.general_info =
      'ÖPNV-Anker von Tettnang — Umstieg in die Region Bodensee/Oberschwaben. LIVE: Abfahrten und Linien frisch prüfen.';
    pushDeep(
      trigger,
      faq(
        'Woran erkenne ich diesen Ort',
        'Am Bahn-/Bus-Haltepunkt mit Stationsbeschilderung — nicht am Montfortplatz',
      ),
      ['faq', 'user_question'],
    );
    pushDeep(
      trigger,
      'LIVE: Fahrpläne und Störungen nie aus dem Pack vorlesen.',
      ['live_hint', 'ephemeral', 'transit'],
    );
    void spot;
  }

  // Tier defaults for remaining story candidates
  for (const s of pack.spots) {
    if (s.pack_role === 'directory') continue;
    if (/^(restaurant|cafe|hotel|gesundheit)$/i.test(s.category || '')) {
      s.pack_role = 'directory';
      s.place_tier = 4;
      s.tags = [
        ...new Set([
          ...(s.tags || []),
          'directory',
          'tier4',
          'offline_lookup',
          'amenity_skip',
        ]),
      ];
      continue;
    }
    if (!s.pack_role) s.pack_role = 'story';
    if (s.place_tier == null) {
      s.place_tier = /kapelle|brunnen|spielplatz|freibad|stadion|halle/i.test(
        s.name + s.category,
      )
        ? 3
        : 2;
    }
  }

  // Offline seed QA city-specific
  pack._offline_qa = [
    {
      q: 'Wo ist die Tourist-Info?',
      a: 'Tourist Information am Montfortplatz 2, neben dem Neuen Schloss. LIVE: Öffnungszeiten prüfen.',
      tags: ['offline_qa', 'service'],
    },
    {
      q: 'Was ist Tettnang bekannt für?',
      a: 'Montfort-Schlösser (Neues Schloss, Altes Schloss, Torschloss), Tettnanger Aroma-Hopfen / Hopfenmuseum und Nähe zum Bodensee.',
      tags: ['offline_qa', 'orientierung'],
    },
    {
      q: 'Wo ist das Neue Schloss?',
      a: 'Montfortplatz 1 — barocke Vierflügelanlage, Schlossmuseum. LIVE: Führungen/Tickets prüfen.',
      tags: ['offline_qa', 'museum'],
    },
    {
      q: 'Was ist der Notruf?',
      a: 'Polizei 110, Feuerwehr/Rettung 112.',
      tags: ['offline_qa', 'notfall'],
    },
  ];

  pack._live_research = pack._live_research?.length
    ? pack._live_research
    : [
        {
          id: 'schloss_tickets',
          topic: 'Neues Schloss',
          prompt:
            'Aktuelle Führungszeiten und Tickets Neues Schloss Tettnang (schloss-tettnang.de) frisch suchen.',
          tags: ['live', 'museum'],
        },
        {
          id: 'hopfen_open',
          topic: 'Hopfenmuseum',
          prompt: 'Öffnungszeiten Hopfenmuseum / Hopfengut No20 Tettnang frisch prüfen.',
          tags: ['live', 'museum'],
        },
      ];

  const gate = runQualityGate(pack, { strict: false });
  console.log(
    `[enrich] spots=${pack.spots.length} ok=${gate.ok} err=${gate.errors.length} warn=${gate.warnings.length}`,
  );
  if (gate.errors.length) console.log(gate.errors.slice(0, 15));

  if (hasFlag('apply') || !hasFlag('dry')) {
    const file = savePack(pack, { bumpVersion: true });
    console.log('[enrich] wrote', file, 'v' + pack.data_version);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
