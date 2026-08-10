#!/usr/bin/env node
/**
 * Merge Master-Datenprofil Tettnang into city pack.
 * Stable facts → narration/FAQ; prices/hours/yields → LIVE.
 *
 *   node scripts/cityPack/mergeTettnangMaster.mjs --apply
 */
import {
  boxPolygon,
  hasFlag,
  loadEnvFile,
  loadPack,
  offset,
  savePack,
} from './lib.mjs';
import { requireGoogleKey, resolvePlace } from './google.mjs';
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
      radius_m: 26,
      general_info: '',
      deep_data_pool: [],
    };
    pack.trigger_points.push(trigger);
  }
  spot.name = cfg.name;
  spot.category = cfg.category;
  spot.pack_role = cfg.role || 'story';
  spot.place_tier = cfg.tier;
  spot.relevance = cfg.relevance || [];
  spot.tags = [
    ...new Set([
      ...(spot.tags || []),
      cfg.category,
      'module1',
      `tier${cfg.tier}`,
      spot.pack_role,
      ...(cfg.relevance || []),
      'master_report',
    ]),
  ];
  setGeo(spot, trigger, cfg.lat, cfg.lng, cfg.halfM || (cfg.tier === 1 ? 30 : 22));
  return { spot, trigger };
}

function cascadeApproaches(spot, lat, lng, steps) {
  spot.approach_triggers = steps.map((s, i) => {
    const p = offset(lat, lng, -(s.m || 40) * 0.55, i * 3);
    return {
      id: `${spot.id}_approach_${i + 1}`,
      lat: p.lat,
      lng: p.lng,
      radius_m: Math.min(40, Math.max(12, Math.round((s.m || 40) * 0.35))),
      teaser_text: s.text,
      condition_rule: 'always',
      cascade_distance_m: s.m,
    };
  });
}

async function main() {
  requireGoogleKey();
  const pack = loadPack('tettnang');
  if (!pack) throw new Error('tettnang pack missing');
  pack.name = 'Tettnang';
  pack.symbol = '🌿';
  const center = { lat: pack.lat, lng: pack.lng };

  let hopfenPin = await resolvePlace('Hopfengut No20 Tettnang Siggenweiler', {
    near: center,
  });
  if (!hopfenPin) {
    hopfenPin = await resolvePlace('Hopfenmuseum Tettnang', { near: center });
  }
  let klinikPin = await resolvePlace(
    'Emil-Münch-Straße 16 Tettnang Krankenhaus',
    { near: center },
  );

  pack._city_history =
    'Tettnang (882 als Tettinanc / Tetinanc erstmals urkundlich, Übergabe von Ländereien durch den Großbauern Cunzo an das Kloster St. Gallen) liegt im Schussental nahe dem Bodensee. Fast 534 Jahre Residenz der Grafen von Montfort; Stadtrechte unter Hugo VI., 1298 durch König Albrecht I. bestätigt. Der prunkvolle Wiederaufbau des Neuen Schlosses nach dem Brand 1753 trieb die Verschuldung — 1779 Konkurs, 1780 Abtretung an Österreich; danach Bayern (1805–1810) und ab 1810 Württemberg. Im 19. Jahrhundert rettete der Hopfenanbau (Anstoß König Wilhelm I. 1819; Durchbruch 1844 durch Unteramtsarzt Johann Nepomuk Fidel Lentz) die Region und verdrängte den Weinbau. Seit 2025 führt die Stadt den Zusatz „Hopfenstadt“. Geologie: sandig-kalkreicher Niederterrassenschotter der Würmeiszeit; Bodensee als Klimapuffer.';

  pack._links = [
    {
      id: 'neues_schloss',
      title: 'Neues Schloss Tettnang',
      url: 'https://www.schloss-tettnang.de/',
      tags: ['museum', 'schloss'],
    },
    {
      id: 'tourist_info',
      title: 'Tourist Information Tettnang',
      url: 'https://www.tettnang.de/de/besuchen/',
      tags: ['service'],
    },
    {
      id: 'sehen',
      title: 'Sehenswürdigkeiten Tettnang',
      url: 'https://www.tettnang.de/de/besuchen/sehenswuerdigkeiten/',
      tags: ['orientierung'],
    },
  ];

  // --- Neues Schloss ---
  {
    const lat = 47.669997;
    const lng = 9.585193;
    const { spot, trigger } = ensureSpot(pack, 'tettnang_neues_schloss', {
      name: 'Neues Schloss Tettnang',
      category: 'museum',
      lat,
      lng,
      tier: 1,
      relevance: ['geschichte', 'architektur', 'museum', 'montfort'],
      halfM: 32,
    });
    spot.facts = {
      origin:
        'An Stelle einer 1633 zerstörten Vorläuferburg; Initialbau 1712 unter Graf Anton III. von Montfort (Baumeister Christoph Gessinger). Nach Brand 1753 Wiederaufbau ab 1755 unter Jakob Emele. Künstler u.a. Joseph Anton Feuchtmayer, Johann Georg Dirr (Stuck/Glanzarbeit), Andreas Brugger (Fresken), Andreas Moosbrugger.',
      architecture:
        'Quadratische Vierflügelanlage mit vier Innenhof-Treppenhäusern und diagonal gestellten Außentürmen; Beletage mit Grünem Kabinett, Vagantenkabinett, Holländischem Kabinett, Bacchussaal; evangelische Schlosskirche mit Stuck-Arkadengalerie. Schlossgarten 1977 neu angelegt.',
      now: 'Montfortplatz 1 — Staatliche Schlösser und Gärten BW; Teile Amtsgericht. Museumskasse Südflügel 1. OG.',
      famousPersonConnected: 'Grafen von Montfort / Franz Xaver / Anton IV.',
      tags: ['schloss', 'barock', 'montfort'],
    };
    spot.bullets = [
      'Oberschwäbische Barockstraße — Residenz der Montforter.',
      'Besuch der Beletage typischerweise mit Führung über historische Treppen.',
      'Tourist-Info: Montfortplatz 2.',
    ];
    trigger.general_info =
      'Auf dem Höhenrücken über der Schussenniederung steht die kolossale Barockfassade des Neuen Schlosses — Vierflügelanlage mit über Eck gestellten Türmen. Nach dem Brand 1753 ließ die Montfort-Familie die Beletage mit Feuchtmayer-Stuck und Brugger-Fresken neu ausstatten; der Prunk trieb die Verschuldung und endete mit der Abtretung an Österreich 1780. Heute Schlossmuseum; LIVE Führungen und Tickets frisch prüfen.';
    cascadeApproaches(spot, lat, lng, [
      {
        m: 100,
        text: 'Voraus die dreigeschossige Barockfassade mit Pilastern und über Eck gestellten Türmen — das Neue Schloss über dem Schussental.',
      },
      {
        m: 50,
        text: 'Zwischen den Wachthäusern öffnet sich der streng quadratische Innenhof der Residenz.',
      },
      {
        m: 20,
        text: 'An den Hofecken sitzen die massiven Treppenhäuser — Stuck von Feuchtmayer bzw. Moosbrugger.',
      },
    ]);
    const faqs = [
      [
        'Woran erkenne ich diesen Ort',
        'An der großen hellen Vierflügelanlage mit vier Ecktürmen am Montfortplatz — nicht am kleineren Torschloss am Bärenplatz',
      ],
      [
        'Wer hat das Schloss gebaut',
        '1712 Christoph Gessinger für Anton III.; nach Brand 1753 Wiederaufbau Jakob Emele; Stuck u.a. Feuchtmayer/Dirr, Fresken Brugger',
      ],
      [
        'Was kann man hier machen',
        'Schlossmuseum / geführte Beletage; Inforäume im Erdgeschoss teilweise frei — LIVE Zeiten und Tickets prüfen',
      ],
      [
        'Ist das barrierefrei',
        'Führungen über historische Treppenhäuser — Rollstuhlzugang stark eingeschränkt; barrierefreie WCs im Umfeld (z. B. Forsthaus-Nebengebäude)',
      ],
      [
        'Querverbindung zum Torschloss',
        'Während hier der Prunk die Verschuldung antrieb, lebte der letzte Graf Anton IV. zeitweise bescheiden am Torschloss/Bärenplatz',
      ],
    ];
    for (const [q, a] of faqs) {
      pushDeep(trigger, faq(q, a), ['faq', 'user_question']);
    }
    pushDeep(
      trigger,
      'LIVE: Führungszeiten, Tickets und Themenführungen Neues Schloss immer frisch prüfen — nie Pack-Preise vorlesen. Bodensee Card PLUS ggf. relevant.',
      ['live_hint', 'ephemeral', 'museum'],
    );
    pushDeep(
      trigger,
      'Bacchussaal: Stuckplastik des Weingotts; Deckenfresko Brugger (1772) mit Herkules als Herrschaftssymbol. Grünes Kabinett = Stuck-Gartenillusion; Vagantenkabinett mit Spielleuten.',
      ['architektur', 'innenraum'],
    );
    pushDeep(
      trigger,
      `GPS: ${lat.toFixed(6)}, ${lng.toFixed(6)} — Montfortplatz 1.`,
      ['gps_confirmed', 'orientierung'],
    );
  }

  // --- Altes Schloss / Rathaus ---
  {
    const lat = 47.6703058;
    const lng = 9.5864078;
    const { spot, trigger } = ensureSpot(pack, 'tettnang_altes_schloss', {
      name: 'Altes Schloss · Rathaus',
      category: 'verwaltung',
      lat,
      lng,
      tier: 1,
      relevance: ['geschichte', 'orientierung', 'montfort'],
    });
    spot.facts = {
      origin:
        'Nach Zerstörung der mittelalterlichen Burg neu als Residenz errichtet; später Forst/Speicher; seit Umbau 1904 Rathaus (Montfortplatz 7).',
      now: 'Rathaus / Bürgerbüro — Fundbüro vermutlich hier.',
      tags: ['rathaus'],
    };
    trigger.general_info =
      'Das Alte Schloss ist heute Rathaus: die frühere Residenz der Montforter nach dem Burgbrand — kompakter Verwaltungsbau zwischen Neuem Schloss und Altstadt, nicht das barocke Museum am großen Platz.';
    cascadeApproaches(spot, lat, lng, [
      {
        m: 40,
        text: 'Ein schlossartiger Verwaltungsbau — das Alte Schloss, heute Rathaus am Montfortplatz.',
      },
    ]);
    for (const [q, a] of [
      [
        'Woran erkenne ich diesen Ort',
        'Am Rathaus-/Schlossbau Montfortplatz 7 — kleiner als die Vierflügelanlage des Neuen Schlosses',
      ],
      [
        'Ist das dasselbe wie das Neue Schloss',
        'Nein: Altes Schloss = Rathaus; Neues Schloss = Barockmuseum Montfortplatz 1',
      ],
      [
        'Wo ist das Fundbüro',
        'Vermutlich Bürgerbüro im Rathaus — LIVE Öffnung und Verfahren prüfen',
      ],
    ]) {
      pushDeep(trigger, faq(q, a), ['faq', 'user_question']);
    }
    pushDeep(
      trigger,
      'LIVE: Bürgerbüro-Öffnungszeiten und Fundbüro-Modalitäten frisch prüfen.',
      ['live_hint', 'ephemeral'],
    );
  }

  // --- Torschloss & Montfort-Museum ---
  {
    const lat = 47.6715;
    const lng = 9.5885;
    const { spot, trigger } = ensureSpot(pack, 'tettnang_torschloss', {
      name: 'Torschloss & Montfort-Museum',
      category: 'denkmal',
      lat,
      lng,
      tier: 1,
      relevance: ['geschichte', 'museum', 'stadtbefestigung'],
      halfM: 28,
    });
    spot.facts = {
      origin:
        'Ältestes weltliches Baudenkmal: Befestigungserlaubnis 1330 (Wilhelm II.); Torturm 1464 (Ulrich); Renaissance-Wohnbau unter Landschreiber Leuthold, Heilig-Kreuz-Kapelle 1578; nach Burgzerstörung wieder Residenz; ab 1783 Schule (Joseph II.); heute Montfort-Museum, Stadtarchiv und Elektronikmuseum.',
      architecture:
        'Staffelgiebel-Ensemble Torturm + Wohnschloss + Kapelle; fünf Wappen über dem Torbogen (Montfort–Österreich–Bayern–Württemberg–Baden-Württemberg).',
      now: 'Montfortstraße 43 / Bärenplatz — Museum + Archiv.',
      tags: ['torschloss', 'museum'],
    };
    spot.bullets = [
      'Stadtprivileg 1379 im Archiv (u. a. fester Steuersatz, Erbrecht).',
      'Elektronikmuseum im Ensemble (ehrenamtlich).',
      'Kapelle 1578; zeitweise Arrestzelle im späten 18. Jh.',
    ];
    spot.sub_pois = [
      {
        id: 'tettnang_torschloss_kapelle',
        name: 'Heilig-Kreuz-Kapelle',
        lat: lat - 0.00005,
        lng: lng - 0.00004,
        radius_m: 10,
        fact_details:
          'Kapellenanbau 1578; Wandmalerei Roll-/Beschlagwerk 2002 freigelegt; später zeitweise Arrestzelle.',
        tags: ['kapelle', 'sub_poi'],
      },
    ];
    trigger.general_info =
      'Am Bärenplatz steht das Torschloss: Staffelgiebel und Torturm markieren den alten Stadtzugang. Über dem Bogen erzählen fünf Wappen die Herrschaftswechsel von Montfort bis Baden-Württemberg. Innen: Montfort-Museum, Stadtarchiv mit mittelalterlichen Urkunden und das Elektronikmuseum — LIVE Öffnungen prüfen.';
    cascadeApproaches(spot, lat, lng, [
      {
        m: 50,
        text: 'Wuchtige Staffelgiebel bilden ein Nadelöhr an der alten Stadtgrenze — das Torschloss.',
      },
      {
        m: 20,
        text: 'Über dem Torbogen: fünf Wappen der Herrschaftsfolgen. Links Altstadt, rechts Bärenplatz.',
      },
      {
        m: 8,
        text: 'An der Südwestecke der Kapellenanbau von 1578 — später zeitweise Arrestzelle.',
      },
    ]);
    for (const [q, a] of [
      [
        'Woran erkenne ich diesen Ort',
        'Am Torturm mit Staffelgiebeln zwischen Markt/Bärenplatz — nicht an der großen Vierflügelanlage Montfortplatz',
      ],
      [
        'Was ist im Torschloss',
        'Montfort-Museum zur Stadtgeschichte, Stadtarchiv, Elektronikmuseum — LIVE Öffnung prüfen',
      ],
      [
        'Was bedeuten die Wappen am Tor',
        'Montfort, Österreich, Bayern, Württemberg und Baden-Württemberg — die wechselnden Herrschaften',
      ],
      [
        'Querverbindung Kronenbrauerei',
        'Vor dem Tor der Barockbau, in dem Anton IV. wohnte — 1847 von Franz Tauscher erworben, Keimzelle der Kronenbrauerei',
      ],
    ]) {
      pushDeep(trigger, faq(q, a), ['faq', 'user_question']);
    }
    pushDeep(
      trigger,
      'LIVE: Öffnungszeiten Montfort-Museum und Elektronikmuseum frisch prüfen — Preise nie aus dem Pack vorlesen.',
      ['live_hint', 'ephemeral', 'museum'],
    );
    pushDeep(
      trigger,
      `GPS: ${lat.toFixed(6)}, ${lng.toFixed(6)} — Montfortstraße 43 / Bärenplatz.`,
      ['gps_confirmed'],
    );
  }

  // Align Elektronikmuseum to Torschloss area (same ensemble)
  {
    const el = pack.spots.find((s) => /elektronikmuseum/i.test(s.id + s.name));
    if (el) {
      const t = pack.trigger_points.find((x) => x.id === el.id);
      el.pack_role = 'story';
      el.place_tier = 2;
      el.relevance = ['museum', 'technik'];
      setGeo(el, t || { id: el.id }, 47.6720508, 9.5884962, 18);
      if (t) {
        t.lat = 47.6720508;
        t.lng = 9.5884962;
        t.general_info =
          'Im Torschloss-Ensemble zeigt das ehrenamtlich betriebene Elektronikmuseum Funk- und Rechnertechnik — Tettnangs Technikseite neben Montfort-Geschichte. LIVE: Öffnungszeiten prüfen.';
        pushDeep(
          t,
          faq(
            'Woran erkenne ich diesen Ort',
            'Am Museumsstandort Montfortstraße im Torschloss-Umfeld — Technik-/Elektronikbeschilderung',
          ),
          ['faq', 'user_question'],
        );
        pushDeep(
          t,
          'Querverbindung: Montfort-Museum und Stadtarchiv im selben historischen Ensemble.',
          ['querverbindung'],
        );
        pushDeep(
          t,
          'LIVE: Öffnung Elektronikmuseum (typisch saisonal) und Tickets frisch prüfen.',
          ['live_hint', 'ephemeral'],
        );
        pushDeep(
          t,
          'GPS: 47.672051, 9.588496 — Montfortstraße 41.',
          ['gps_confirmed'],
        );
      }
    }
  }

  // --- St. Gallus ---
  {
    const lat = 47.6735;
    const lng = 9.5887;
    const { spot, trigger } = ensureSpot(pack, 'tettnang_st_gallus', {
      name: 'Pfarrkirche St. Gallus',
      category: 'kirche',
      lat,
      lng,
      tier: 1,
      relevance: ['kirche', 'geschichte', 'kunst'],
      halfM: 26,
    });
    spot.facts = {
      origin:
        'Sakraler Ort seit dem 9. Jh. (Gallus-Patrozinium). Spätgotischer Turmstumpf 15. Jh.; nach Blitz 1702 barocke Zwiebelhaube 1705. Neoromanisches Schiff Mitte 19. Jh.; Fliegerschaden 1944, Wiederaufbau bis 1956. Innenraum-Transformation 1990/91 durch Helmut Lutz (versenkter Hochaltar als 14. Kreuzwegstation, moderne Giebelfenster).',
      architecture:
        'Gotischer Turm + barocke Zwiebelhaube + neoromanisches Schiff; moderne Lutz-Gestaltung im Chor.',
      now: 'Kirchstraße 28 — auch Konzertort (Orgel Reiser Opus 282, überholt/erweitert).',
      tags: ['kirche', 'gallus'],
    };
    trigger.general_info =
      'Hoch über der Kirchstraße thront St. Gallus mit barocker Zwiebelhaube auf gotischem Turm. Im Inneren hat Helmut Lutz den Raum modern geöffnet — der alte Hochaltar liegt symbolisch als Grabplatte im Boden. In der Vorhalle das Epitaph für Graf Anton IV., den letzten Montforter.';
    cascadeApproaches(spot, lat, lng, [
      {
        m: 100,
        text: 'Der Blick wird vom Kirchturm mit barocker Zwiebelhaube dominiert — St. Gallus.',
      },
      {
        m: 20,
        text: 'Am Vorplatz wachen Fasnetsfiguren-Bildnisse (u. a. Hopfennarr, Gätterlet) neben dem Gotteshaus.',
      },
      {
        m: 8,
        text: 'In der Vorhalle: Epitaph für Graf Anton IV. mit Füllhorn — Ironie angesichts der Montfort-Schulden.',
      },
    ]);
    for (const [q, a] of [
      [
        'Woran erkenne ich diesen Ort',
        'Am hohen Turm mit Zwiebelhaube in der Kirchstraße — nicht am Schloss-Torturm',
      ],
      [
        'Was ist innen besonders',
        'Helmut-Lutz-Umbau 1990/91: versenkter Hochaltar als 14. Station; moderne Glasfenster; starke Orgelkultur',
      ],
      [
        'Querverbindung Anton IV',
        'Epitaph in der Vorhalle; sein Wohnhaus am Bärenplatz wurde später Kronenbrauerei',
      ],
    ]) {
      pushDeep(trigger, faq(q, a), ['faq', 'user_question']);
    }
    pushDeep(
      trigger,
      'LIVE: Gottesdienst-/Konzerttermine und Chororgel-Projekte frisch prüfen — keine Pack-Preise für Orgelumbauten vorlesen.',
      ['live_hint', 'ephemeral'],
    );
  }

  // --- Bärenplatz / ZOB / Kronenbrauerei ---
  {
    const lat = 47.671666;
    const lng = 9.588654;
    const { spot, trigger } = ensureSpot(pack, 'tettnang_baerenplatz', {
      name: 'Bärenplatz · ZOB & Kronenbrauerei',
      category: 'verwaltung',
      lat,
      lng,
      tier: 1,
      relevance: ['orientierung', 'transport', 'brauerei', 'hopfen'],
      halfM: 35,
      district: 'zentrum',
    });
    spot.facts = {
      origin:
        'Historischer Stadtplatz; Gebäude Bärenplatz 7/8 um 1780 Altersruhesitz Graf Anton IV.; 1847 Franz Xaver Tauscher → Kronenbrauerei (Familie Tauscher). 1993 „Tettnanger Keller-Pils“ als frühes Bio-Bier der Region. Kronenbrunnen: Vorgänger 1904, heutige Form ab 1960.',
      now: 'ZOB BODO (u. a. Regiobus 900 Richtung Ravensburg; Stadtbus 224/226). Gasthof-Betrieb der Krone 2024 geschlossen; Brauerei produziert weiter.',
      tags: ['zob', 'brauerei', 'platz'],
    };
    spot.bullets = [
      'Zentraler Busknoten — kein eigener Bahnanschluss in Tettnang.',
      'Start des Tettnanger Hopfenpfads Richtung Hopfengut N°20.',
      'Nette Toilette / barrierefreie WC im Forsthaus-Umfeld.',
    ];
    trigger.general_info =
      'Am Bärenplatz kreuzen sich Altstadt-Tor, Busknoten und Brauereigeschichte: Hier wohnte Anton IV., hier gründete Franz Tauscher 1847 die Kronenbrauerei, hier startet der Hopfenpfad. Der Kronenbrunnen ist geprüfte Trinkwasserstelle. LIVE: Fahrpläne BODO und Gastro-Status frisch prüfen.';
    cascadeApproaches(spot, lat, lng, [
      {
        m: 50,
        text: 'Torschloss links, geschäftiger Busplatz rechts — der Bärenplatz öffnet sich.',
      },
      {
        m: 20,
        text: 'Überdachte Bushaltestellen: ZOB mit Linien in die Region und zum Bodensee.',
      },
      {
        m: 10,
        text: 'Kronenbrunnen mit Madonna-Säule — im Sommer Flaschen auffüllen (geprüftes Trinkwasser).',
      },
    ]);
    for (const [q, a] of [
      [
        'Woran erkenne ich diesen Ort',
        'Am offenen Platz vor dem Torschloss mit Busüberdachung und Kronenbrunnen — Verkehrsknoten der Innenstadt',
      ],
      [
        'Gibt es einen Bahnhof',
        'Nein in Tettnang selbst — Umstieg über ZOB Bärenplatz; nächste Bahnknoten Meckenbeuren oder Friedrichshafen',
      ],
      [
        'Was ist mit der Kronenbrauerei',
        'Handwerkliche Brauerei besteht; Gasthof-Betrieb 2024 geschlossen — LIVE aktuellen Status prüfen',
      ],
      [
        'Wo startet der Hopfenpfad',
        'Am Bärenplatz / Kronen-Bezug — Lehrpfad „vom Brauer zum Bauer“ Richtung Hopfengut N°20',
      ],
    ]) {
      pushDeep(trigger, faq(q, a), ['faq', 'user_question']);
    }
    pushDeep(
      trigger,
      'LIVE: BODO-Fahrpläne, Bus-Barrierefreiheit und Ticketregeln frisch prüfen. LIVE: Gastro am Platz / Krone-Status frisch.',
      ['live_hint', 'ephemeral', 'transit'],
    );
  }

  // Kronenbrunnen → directory/sub of baerenplatz or keep story thin linked
  {
    const br = pack.spots.find((s) => s.id === 'tettnang_kronenbrunnen');
    if (br) {
      const t = pack.trigger_points.find((x) => x.id === br.id);
      br.pack_role = 'story';
      br.place_tier = 3;
      br.relevance = ['wasser', 'orientierung'];
      if (t) {
        setGeo(br, t, 47.671666, 9.588654, 12);
        t.general_info =
          'Der Kronenbrunnen am Bärenplatz: Betonbecken mit Madonna-Säule, Nachfolger des Brunnens von 1904 — geprüfte Trinkwasserstelle und Platzmarke vor Torschloss und ehemaligem Gasthof Krone.';
        pushDeep(
          t,
          faq(
            'Woran erkenne ich diesen Ort',
            'Am viereckigen Brunnenbecken mit Mariensäule direkt am Bärenplatz',
          ),
          ['faq', 'user_question'],
        );
        pushDeep(
          t,
          'LIVE: Wasserqualität/Freigabe saisonal vom Gesundheitsamt — bei Frost ggf. abgestellt.',
          ['live_hint', 'ephemeral', 'wasser'],
        );
        pushDeep(
          t,
          'Weitere Trinkwasser: Loretobrunnen, Grabenstraße; Refill-Initiative in Läden/Behörden.',
          ['wasser', 'service'],
        );
        pushDeep(t, 'GPS am Bärenplatz — Querverbindung ZOB und Torschloss.', [
          'querverbindung',
        ]);
      }
    }
  }

  // --- Hopfengut N°20 (Museum + Pfad-Ende) ---
  {
    const et = pack.trigger_points.find((t) => t.id === 'tettnang_hopfengut_no20');
    const useLat = hopfenPin?.lat || et?.lat || 47.685;
    const useLng = hopfenPin?.lng || et?.lng || 9.595;
    const { spot, trigger } = ensureSpot(pack, 'tettnang_hopfengut_no20', {
      name: 'Hopfengut N°20 · Hopfenmuseum',
      category: 'museum',
      lat: useLat,
      lng: useLng,
      tier: 1,
      relevance: ['hopfen', 'museum', 'wanderung', 'gastro'],
      halfM: 40,
      district: 'siggenweiler',
    });
    spot.facts = {
      origin:
        'Hof der Familie Locher in Siggenweiler; 1995 Eröffnung Tettnanger Hopfenmuseum (damals erstes seiner Art in DE) auf ca. 2000 m² — Handpflücke bis Industrie; Exponate u. a. Pflückmaschine Wolf WSZ550 und Heisse Darre. Hopfenpfad 1996 (Inge Locher & Fritz Tauscher), Rundweg ca. 8 km.',
      architecture:
        'Aktiver Agrarbetrieb mit Museum und Schaubrauerei-Kooperation; sechs Meter hoher Hopfensteg auf Augenhöhe mit den Ranken.',
      now:
        hopfenPin?.address ||
        'Hopfengut 20, 88069 Tettnang-Siggenweiler.',
      tags: ['hopfen', 'museum', 'bioland'],
    };
    spot.bullets = [
      'Ende/Highlight des Tettnanger Hopfenpfads.',
      'Schaubrauerei-Kooperation mit Brauerei Krone.',
      'Panoramen Richtung Säntis/Bodensee an Höhenpunkten des Pfads.',
    ];
    trigger.general_info =
      'Über den Hopfengärten liegt Hopfengut N°20: Museum, Hof und Duft der Darre erzählen 175 Jahre Tettnanger Hopfen — vom „Grünen Gold“ der Handpflücke bis zur Maschine. Der Hopfensteg hebt dich auf Rankenhöhe; der Lehrpfad verbindet das Gut mit dem Bärenplatz unten in der Stadt. LIVE: Öffnung, Führungen und Gastro frisch prüfen.';
    cascadeApproaches(spot, useLat, useLng, [
      {
        m: 80,
        text: 'Hopfenreihen und Hofgebäude — das Gut N°20 mit Museum über der Altstadt.',
      },
      {
        m: 25,
        text: 'Der hölzerne Hopfensteg ragt am Feldrand auf — Blick auf Augenhöhe mit den Dolden.',
      },
      {
        m: 10,
        text: 'Eingang Museum/Hof: Holzbalken und Werkzeuge — Betrieb und Ausstellung fließen ineinander.',
      },
    ]);
    for (const [q, a] of [
      [
        'Woran erkenne ich diesen Ort',
        'Am Hopfengut mit Museum und oft sichtbarem Hopfensteg mitten in den Feldern von Siggenweiler — nicht am Schloss in der Altstadt',
      ],
      [
        'Was ist der Hopfenpfad',
        'Ca. 8 km Themenweg „vom Brauer zum Bauer“ zwischen Bärenplatz/Krone und Hopfengut — LIVE Wegezustand prüfen',
      ],
      [
        'Was sieht man im Museum',
        'Hopfenanbau von Handpflücke bis Technik; u. a. Pflückmaschine und Heisse Darre — LIVE Führungen prüfen',
      ],
      [
        'Querverbindung Krone',
        'Locher-Hopfen und Kronen-Biere gehören zusammen — Pfad verbindet Gut und Bärenplatz',
      ],
    ]) {
      pushDeep(trigger, faq(q, a), ['faq', 'user_question']);
    }
    pushDeep(
      trigger,
      'LIVE: Museum-/Gastro-Öffnung, Tickets, Bodensee Card PLUS und Erntezeiten (typisch ab Ende August) frisch prüfen — keine Pack-Preise. LIVE: aktuelle Anbauflächen/Erträge nie als feste Wahrheit vorlesen.',
      ['live_hint', 'ephemeral', 'hopfen'],
    );
  }

  // Merge old hopfenmuseum spot into directory alias or remove duplicate story
  {
    const hm = pack.spots.find((s) => s.id === 'tettnang_hopfenmuseum_laden');
    if (hm) {
      hm.pack_role = 'directory';
      hm.place_tier = 4;
      hm.name = 'Hopfenmuseum (siehe Hopfengut N°20)';
      hm.tags = [
        ...new Set([
          ...(hm.tags || []),
          'directory',
          'tier4',
          'alias_hopfengut',
          'amenity_skip',
        ]),
      ];
      const t = pack.trigger_points.find((x) => x.id === hm.id);
      if (t) {
        t.general_info =
          'Alias: Das Tettnanger Hopfenmuseum liegt am Hopfengut N°20 in Siggenweiler — dort die volle Story und der Hopfenpfad.';
        pushDeep(
          t,
          'User-Frage: Wo ist das Hopfenmuseum? Antwort: Am Hopfengut N°20 in Siggenweiler — nicht ein separates Altstadt-Museum.',
          ['faq', 'user_question', 'directory'],
        );
      }
    }
  }

  // Aussicht Hopfenpfad
  {
    const a = pack.spots.find((s) => /aussichtspunkt_am_hopfenpfad/i.test(s.id));
    if (a) {
      const t = pack.trigger_points.find((x) => x.id === a.id);
      a.category = 'aussicht';
      a.pack_role = 'story';
      a.place_tier = 2;
      a.name = 'Aussicht Hopfenpfad · Brünnensweiler Höhe';
      if (t) {
        t.general_info =
          'Entlang des Hopfenpfads öffnen Höhen wie Brünnensweiler Höhe oder Irrmannsberg Panoramen über Hopfenreihen bis zum Bodensee und zur Säntis-Silhouette — freier Aussichtsgenuss ohne Ticket.';
        pushDeep(
          t,
          faq(
            'Woran erkenne ich diesen Ort',
            'An Infotafeln des Hopfenpfads und dem Weitblick über Felder zum See/Alpen — nicht am Schlossplatz',
          ),
          ['faq', 'user_question'],
        );
        pushDeep(
          t,
          'LIVE: Wegezustand, „Sunset Sounds“ und ähnliche Events frisch prüfen.',
          ['live_hint', 'ephemeral'],
        );
        pushDeep(
          t,
          'Querverbindung: Start am Bärenplatz, Ziel/Highlight Hopfengut N°20.',
          ['querverbindung'],
        );
        pushDeep(t, 'Kostenloser Outdoor-Panoramapunkt am Lehrpfad.', [
          'aussicht',
        ]);
      }
    }
  }

  // Schlosspark
  {
    const p = pack.spots.find((s) => /schlosspark/i.test(s.id));
    if (p) {
      const t = pack.trigger_points.find((x) => x.id === p.id);
      p.pack_role = 'story';
      p.place_tier = 2;
      if (t) {
        t.general_info =
          'Der Schlossgarten am Neuen Schloss wurde 1977 mit symmetrischen Beeten neu angelegt — Grünrahmen der Barockfassade und Festfläche (u. a. Bähnlesfest/Flohmarkt). LIVE: Veranstaltungen prüfen.';
        pushDeep(
          t,
          faq(
            'Woran erkenne ich diesen Ort',
            'Am Grün direkt vor der großen Schlossfassade am Montfortplatz',
          ),
          ['faq', 'user_question'],
        );
        pushDeep(
          t,
          'LIVE: Festnutzung, Flohmarkt/Bähnlesfest-Termine frisch prüfen.',
          ['live_hint', 'ephemeral'],
        );
        pushDeep(t, 'Querverbindung: Neues Schloss und Tourist-Info am Platz.', [
          'querverbindung',
        ]);
        pushDeep(t, 'GPS am Schlossgarten — Spazieren und Orientieren.', [
          'orientierung',
        ]);
      }
    }
  }

  // Klinik — directory / context
  {
    const kLat = klinikPin?.lat || 47.665;
    const kLng = klinikPin?.lng || 9.595;
    const { spot, trigger } = ensureSpot(pack, 'tettnang_klinik_campus', {
      name: 'Ehem. Klinik Tettnang (Medizin Campus)',
      category: 'gesundheit',
      lat: kLat,
      lng: kLng,
      tier: 4,
      role: 'directory',
      relevance: ['notfall', 'offline_lookup'],
      halfM: 30,
    });
    const hosp = pack.spots.find(
      (s) =>
        s.id !== spot.id &&
        /krankenhaus|klinik|medizin campus|emil.?münch|emil.?muench/i.test(
          s.name + s.id,
        ),
    );
    if (hosp) {
      hosp.pack_role = 'directory';
      hosp.place_tier = 4;
      hosp.tags = [
        ...new Set([
          ...(hosp.tags || []),
          'directory',
          'tier4',
          'amenity_skip',
        ]),
      ];
    }
    spot.facts = {
      origin:
        'Ehemaliges Kreiskrankenhaus / Medizin Campus Bodensee an der Emil-Münch-Straße 16 — stationärer Betrieb eingestellt.',
      now: 'Keine lokale Notaufnahme mehr. LIVE: aktuelle ambulante Nachnutzung und nächste Kliniken prüfen.',
      tags: ['gesundheit', 'directory'],
    };
    trigger.general_info =
      'Hier stand die Klinik Tettnang — der stationäre Betrieb wurde eingestellt. Für Notfälle gelten die Kliniken in Friedrichshafen oder Ravensburg; Notruf 112. LIVE: aktuellen Versorgungsstatus prüfen.';
    pushDeep(
      trigger,
      faq(
        'Wo ist die Notaufnahme',
        'Nicht mehr in Tettnang — Klinikum Friedrichshafen oder St. Elisabethen Ravensburg; Notruf 112. LIVE Status prüfen',
      ),
      ['faq', 'user_question', 'notfall'],
    );
    pushDeep(
      trigger,
      'LIVE: Ob ambulante Angebote (z. B. nach Betreiberwechsel) existieren — frisch recherchieren, nichts aus dem Pack als Öffnung behaupten.',
      ['live_hint', 'ephemeral', 'gesundheit'],
    );
  }

  // Citywide offline QA from audit (stable)
  const qa = [
    {
      q: 'Gibt es einen Bahnhof in Tettnang?',
      a: 'Nein. Zentraler Umstieg ist der ZOB Bärenplatz (BODO). Nächste Bahnknoten: Meckenbeuren oder Friedrichshafen.',
      tags: ['transport'],
    },
    {
      q: 'Wo ist die Tourist-Info?',
      a: 'Montfortplatz 2, neben dem Neuen Schloss. LIVE: Öffnungszeiten prüfen.',
      tags: ['service'],
    },
    {
      q: 'Wo bekomme ich Trinkwasser?',
      a: 'Kronenbrunnen, Loretobrunnen, Grabenstraße (geprüft); plus Refill-Stationen in Läden/Behörden. LIVE: Frost/Abstellung beachten.',
      tags: ['wasser'],
    },
    {
      q: 'Wo sind öffentliche Toiletten?',
      a: 'Barrierefreie Anlage im Forsthaus-Nebengebäude; Parkhaus Grabenstraße; Nette Toilette in Gastronomie. LIVE: Öffnungsfenster prüfen.',
      tags: ['service'],
    },
    {
      q: 'Was ist Tettnang bekannt für?',
      a: 'Montfort-Schlösser, Hopfenstadt mit Hopfenmuseum/Hopfengut N°20, Fasnet (Hopfennarr), Nähe Bodensee.',
      tags: ['orientierung'],
    },
    {
      q: 'Was ist der Hopfennarr?',
      a: 'Prägende Fasnetsfigur der Narrenzunft Tettnang (Weißnarr mit Hopfenmotiv); dazu u. a. Rote Spinne, Gätterlet, Hopfensau.',
      tags: ['brauchtum'],
    },
    {
      q: 'Welche großen Feste gibt es?',
      a: 'Montfortfest (meist Juli), Bähnlesfest (meist September, Flohmarkt/Innenstadt), Schwäbisch-Alemannische Fasnet. LIVE: Termine prüfen.',
      tags: ['events', 'live'],
    },
    {
      q: 'Wo ist die Polizei?',
      a: 'Keine 24/7-Touristenwache vor Ort — Revierversorgung über Friedrichshafen/Ravensburg/Lindau; Notruf 110.',
      tags: ['notfall'],
    },
    {
      q: 'Wo ist die Notaufnahme?',
      a: 'Klinik Tettnang ohne stationäre Notaufnahme — Klinikum Friedrichshafen oder St. Elisabethen Ravensburg; 112.',
      tags: ['notfall'],
    },
    {
      q: 'Welcher Nahverkehr gilt?',
      a: 'BODO-Verbund; ZOB Bärenplatz; u. a. Regiobus 900, Stadtbus 224/226. LIVE: Fahrpläne und Deutschlandticket-Regeln prüfen.',
      tags: ['transport'],
    },
    {
      q: 'Was ist die Bodensee Card PLUS?',
      a: 'Touristenkarte mit Ermäßigungen/Freieintritten u. a. Schloss und Hopfengut — LIVE aktuelle Leistungen und Kauf prüfen (Tourist-Info / Web).',
      tags: ['live', 'service'],
    },
    {
      q: 'Wo sind Supermärkte?',
      a: 'u. a. Kaufland Ravensburger Straße; plus Directory-Katalog im Pack. LIVE: Öffnungen prüfen.',
      tags: ['einkaufen'],
    },
  ];
  const seen = new Set();
  pack._offline_qa = [];
  for (const e of qa) {
    const k = e.q.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    pack._offline_qa.push({ ...e, tags: ['offline_qa', ...(e.tags || [])] });
  }
  // keep prior category QAs if useful
  for (const e of pack._offline_qa || []) {
    /* already set */
  }

  // Re-harvest category summaries briefly
  const byCat = new Map();
  for (const s of pack.spots) {
    const c = (s.category || 'ort').toLowerCase();
    if (!byCat.has(c)) byCat.set(c, []);
    byCat.get(c).push(s.name);
  }
  for (const [cat, q] of [
    ['supermarket', 'Welche Supermärkte sind im Pack?'],
    ['apotheke', 'Welche Apotheken sind im Pack?'],
    ['restaurant', 'Welche Restaurants sind im Pack?'],
    ['hotel', 'Welche Hotels sind im Pack?'],
  ]) {
    const names = byCat.get(cat) || [];
    if (!names.length) continue;
    pack._offline_qa.push({
      q,
      a: `${names.slice(0, 8).join('; ')}.`,
      tags: ['offline_qa', 'directory', cat],
    });
  }

  // Spot FAQ harvest append
  for (const tp of pack.trigger_points || []) {
    for (const raw of tp.deep_data_pool || []) {
      const text = typeof raw === 'string' ? raw : raw?.text;
      const m = String(text || '').match(
        /^\s*User-Frage:\s*(.+?)\?\s*Antwort:\s*(.+)\s*$/is,
      );
      if (!m) continue;
      const q = m[1].trim().replace(/\?+$/, '') + '?';
      const a = m[2].trim();
      const k = q.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      pack._offline_qa.push({
        q,
        a,
        tags: ['offline_qa', 'spot_faq'],
      });
    }
  }

  pack._live_research = [
    {
      id: 'schloss_live',
      topic: 'Neues Schloss',
      prompt:
        'Aktuelle Führungen, Tickets und Barriere-Hinweise Neues Schloss Tettnang (schloss-tettnang.de) frisch suchen — keine Pack-Preise.',
      tags: ['live', 'museum'],
    },
    {
      id: 'hopfen_live',
      topic: 'Hopfengut / Museum',
      prompt:
        'Öffnung, Führungen, Gastro Hopfengut N°20 / Hopfenmuseum und aktuelle Ernte-/Saisoninfos frisch prüfen.',
      tags: ['live', 'hopfen'],
    },
    {
      id: 'bodo_live',
      topic: 'BODO ÖPNV',
      prompt:
        'Aktuelle Fahrpläne ZOB Bärenplatz / Linie 900 und Stadtbus 224/226 frisch prüfen.',
      tags: ['live', 'transit'],
    },
    {
      id: 'notfall_live',
      topic: 'Notaufnahme',
      prompt:
        'Aktuelle Notfallversorgung für Tettnang (Friedrichshafen/Ravensburg) und Apotheken-Notdienst 116117 frisch prüfen.',
      tags: ['live', 'notfall'],
    },
  ];

  // Soft transit stub
  pack._transit = pack._transit || {
    verbund: 'BODO',
    note: 'Kein eigener Bahnhof; ZOB Bärenplatz. LIVE Fahrpläne.',
    hubs: [
      {
        id: 'zob_baerenplatz',
        name: 'ZOB Bärenplatz',
        lat: 47.671666,
        lng: 9.588654,
      },
    ],
  };

  pack._pack_index = {
    total: pack.spots.length,
    story: pack.spots.filter((s) => s.pack_role !== 'directory').length,
    directory: pack.spots.filter((s) => s.pack_role === 'directory').length,
    offline_qa: pack._offline_qa.length,
    note: 'UI: Gesamtzahl zeigen; Trigger nur Story Tier 1–2 (+ selektiv 3).',
  };

  const gate = runQualityGate(pack, { strict: false });
  console.log(
    `[master] spots=${pack.spots.length} story=${pack._pack_index.story} dir=${pack._pack_index.directory} qa=${pack._offline_qa.length} ok=${gate.ok} err=${gate.errors.length} warn=${gate.warnings.length}`,
  );
  if (gate.errors.length) console.log(gate.errors.slice(0, 20));

  if (hasFlag('apply') || !hasFlag('dry')) {
    const file = savePack(pack, { bumpVersion: true });
    console.log('[master] wrote', file, 'v' + pack.data_version);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
