#!/usr/bin/env node
/**
 * Apply user answers + Google tourist discovery + place tiers for Hechingen.
 *   node scripts/cityPack/refineHechingenAnswers.mjs --apply
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
import { geocode, resolvePlace } from './google.mjs';
import { runQualityGate } from './qualityGate.mjs';

loadEnvFile();

function pushDeep(trigger, text, tags) {
  const clean = String(text || '').trim();
  if (clean.length < 18) return;
  trigger.deep_data_pool = trigger.deep_data_pool || [];
  const key = clean.toLowerCase().slice(0, 90);
  if (
    trigger.deep_data_pool.some((e) =>
      (typeof e === 'string' ? e : e?.text || '')
        .toLowerCase()
        .slice(0, 90) === key,
    )
  ) {
    return;
  }
  trigger.deep_data_pool.push({ text: clean, tags: tags || ['master_report'] });
}

function setGeo(spot, trigger, lat, lng, half = 26) {
  trigger.lat = lat;
  trigger.lng = lng;
  trigger.radius_m = half;
  spot.polygonCoordinates = boxPolygon(lat, lng, half);
  trigger.polygon = spot.polygonCoordinates.map((p) => ({
    lat: p.latitude,
    lng: p.longitude,
  }));
  trigger.trigger_kind = 'area';
  trigger.trigger_type = 'polygon';
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
  spot.place_tier = tier;
  spot.relevance = relevance || [];
  spot.tags = [
    ...new Set([
      ...(spot.tags || []),
      category,
      'module1',
      `tier${tier}`,
      ...(relevance || []),
      'master_report',
    ]),
  ];
  setGeo(spot, trigger, lat, lng, tier === 1 ? 28 : 22);
  return { spot, trigger };
}

function approaches(spot, lat, lng, teasers) {
  spot.approach_triggers = teasers.map((text, i) => {
    const m = [55, 22, 8][i] || 30;
    const p = offset(lat, lng, -m * 0.65, i * 5);
    return {
      id: `${spot.id}_approach_${i + 1}`,
      lat: p.lat,
      lng: p.lng,
      radius_m: Math.min(38, Math.max(10, Math.round(m * 0.4))),
      teaser_text: text,
      condition_rule: 'always',
    };
  });
}

async function main() {
  const pack = loadPack('hechingen');
  pack.name = 'Zollernstadt Hechingen';

  // --- Prune thin / non-tourist noise ---
  const DROP =
    /kapelle|marienkapelle|ruhe.?christi|heiligkreuz|kirchengemeinde zollern|evangelische kirchengemeinde|bechtoldsweiler|dorfbrunnen|nichthuldiger|marien brunnen|kunstdenkmal|jokenplatz|wanderparkplatz|unterer tor hechingen|bismarckstein|aussichtspunkt$|golf|skate|bolzplatz|weiherstadion|minigolf|halle.?freibad|zentrum am fursten|zentrum am fürsten|stadthalle museum|museum - restaurant|hechingen altstadt$/i;
  const before = pack.spots.length;
  pack.spots = pack.spots.filter((s) => !DROP.test(s.name) && !DROP.test(s.id));
  // keep only one generic brunnen if any; drop loose brunnen without depth
  pack.spots = pack.spots.filter((s) => {
    if (/^brunnen$/i.test(s.name)) return false;
    if (/marktplatz brunnen/i.test(s.name)) return true;
    return true;
  });
  const keepIds = new Set(pack.spots.map((s) => s.id));
  pack.trigger_points = pack.trigger_points.filter((t) => keepIds.has(t.id));
  console.log(`[prune] ${before} → ${pack.spots.length}`);

  // Bundled side facts on city history
  const hist = pack.trigger_points.find((t) => t.id === 'hechingen_stadtgeschichte');
  if (hist) {
    pushDeep(
      hist,
      'Nebenorte/Kapellen ohne eigene Triggerdichte: kleinere Kapellen und Dorfbrunnen sind bewusst nicht als Einzelspots geführt — Fokus auf fundierte Kernorte mit kaskadierenden Annäherungen.',
      ['meta', 'place_tier', 'master_report'],
    );
  }

  // 1) Burg — Oberer Parkplatz P1
  {
    const { spot, trigger } = ensureSpot(pack, 'hechingen_burg_hohenzollern', {
      name: 'Burg Hohenzollern · Besucherstart P1',
      category: 'denkmal',
      lat: 48.3257,
      lng: 8.9639,
      tier: 1,
      relevance: ['must_see', 'panorama', 'geschichte', 'familie'],
    });
    spot.facts = {
      origin:
        'Wahrzeichen der Zollern; Besucherstart ist der Obere Parkplatz P1 in Bisingen — von dort Fußweg oder Pendelbus.',
      architecture:
        'Neugotische Burggestalt (u.a. Friedrich August Stüler); vom Parkplatz aus beginnt der Aufstieg.',
      now: 'Adresse Navigationsziel: Oberer Parkplatz Burg Hohenzollern, 72379 Bisingen.',
      tags: spot.tags,
    };
    spot.bullets = [
      'Besucherstart / Ticket-Logistik: Oberer Parkplatz P1.',
      'GPS: 48.32570, 8.96390',
      'Maps: https://maps.google.com/?q=48.32570,8.96390',
    ];
    trigger.general_info =
      'Der offizielle Start für Burgbesucher ist der Obere Parkplatz P1 — hier beginnt Fußweg oder Pendelbus zur Burg Hohenzollern über Hechingen.';
    pushDeep(
      trigger,
      'GPS Besuchereingang/Parkplatz P1: 48.325700, 8.963900 — Oberer Parkplatz Burg Hohenzollern, 72379 Bisingen.',
      ['gps_confirmed', 'orientierung', 'master_report'],
    );
    pushDeep(
      trigger,
      'User-Frage: Woran erkenne ich diesen Ort? Antwort: Großer oberer Burg-Parkplatz mit Ausschilderung Burg Hohenzollern — nicht die Altstadt, sondern der Bergzugang in Bisingen.',
      ['faq', 'user_question', 'visual_anchor'],
    );
    pushDeep(
      trigger,
      'LIVE: Tickets, Pendelbus und Öffnungszeiten der Burg frisch recherchieren.',
      ['live_hint', 'ephemeral'],
    );
    approaches(spot, 48.3257, 8.9639, [
      'Vor dir liegt der Obere Parkplatz der Burg — der echte Besucherstart, nicht irgendein Waldweg.',
      'P1: Von hier starten Fußweg und Pendelbus zur Burg Hohenzollern.',
      'Navigationsziel erreicht: Oberer Parkplatz — weiter zu Fuß oder mit dem Shuttle.',
    ]);
    spot.sub_pois = [
      {
        id: `${spot.id}_sub_p1`,
        name: 'Oberer Parkplatz P1',
        lat: 48.3257,
        lng: 8.9639,
        radius_m: 12,
        fact_details: 'Offizieller Besuchereingang / Ticket-Logistik-Start.',
        tags: ['eingang', 'gps_entrance'],
      },
    ];
    console.log('[1] Burg P1');
  }

  // 2) Stiftskirche
  {
    const { spot, trigger } = ensureSpot(pack, 'hechingen_stiftskirche_st_jakobus', {
      name: 'Stiftskirche St. Jakobus',
      category: 'kirche',
      lat: 48.35163,
      lng: 8.96367,
      tier: 1,
      relevance: ['must_see', 'architektur', 'geschichte'],
    });
    spot.facts = {
      origin:
        "Frühklassizistischer Sakralbau von Pierre Michel d'Ixnard — Wahrzeichen der Oberstadt am Kirchplatz/Schloßplatz.",
      architecture:
        'Mächtige antikisierende Tempelfassade mit Säulenportikus — Kontrast zu Fachwerk und Altem Schloss.',
      now: 'Adressebereich: Kirchplatz / Schloßplatz, 72379 Hechingen.',
      tags: spot.tags,
    };
    spot.bullets = [
      'Architekt: Pierre Michel d’Ixnard.',
      'Visueller Anker: Säulenportikus / Tempelfassade.',
      'GPS: 48.35163, 8.96367',
    ];
    trigger.general_info =
      "Am Kirchplatz erhebt sich die Stiftskirche St. Jakobus: d’Ixnards klassizistische Tempelfassade mit Säulenportikus — massiver Kontrast zu Fachwerk und benachbartem Altem Schloss.";
    pushDeep(
      trigger,
      'User-Frage: Woran erkenne ich diesen Ort? Antwort: An der mächtigen antikisierenden Tempelfassade mit Säulenportikus — klar anders als die umliegenden Fachwerkhäuser und das Alte Schloss daneben.',
      ['faq', 'user_question', 'visual_anchor'],
    );
    pushDeep(
      trigger,
      'Querverbindung Altes Schloss/Landesmuseum: Sakrale Tempelfassade und Residenzmuseum stehen am selben Platzensemble.',
      ['querverbindung', 'master_report'],
    );
    approaches(spot, 48.35163, 8.96367, [
      'Am Kirchplatz zeichnet sich eine Tempelfassade ab — das ist die Stiftskirche, nicht einfach irgendeine Kirche.',
      'Säulenportikus voraus: Pierre Michel d’Ixnards klassizistisches Statement.',
      'Direkt vor dem Portikus der Stiftskirche St. Jakobus.',
    ]);
    console.log('[2] Stiftskirche');
  }

  // 3a) Landesmuseum / Altes Schloss + Grotz/Heisenberg cascade
  {
    let g = await resolvePlace('Hohenzollerisches Landesmuseum Hechingen Schloßplatz 5', {
      preferTypes: ['museum'],
    });
    if (!g) {
      const geo = await geocode('Schloßplatz 5, 72379 Hechingen');
      const loc = geo.results?.[0]?.geometry?.location;
      g = { lat: loc.lat, lng: loc.lng, address: 'Schloßplatz 5, 72379 Hechingen' };
    }
    const { spot, trigger } = ensureSpot(
      pack,
      'hechingen_hohenzollerisches_landesmuseum',
      {
        name: 'Altes Schloss / Hohenzollerisches Landesmuseum',
        category: 'museum',
        lat: g.lat,
        lng: g.lng,
        tier: 1,
        relevance: ['must_see', 'geschichte', 'architektur', 'science_history'],
      },
    );
    spot.facts = {
      origin:
        'Altes Schloss am Schloßplatz 5: Residenzgeschichte, später u.a. Trikotagenfabrik Grotz — im Krieg Ausweichquartier des Kaiser-Wilhelm-Instituts (Heisenberg/Weizsäcker).',
      architecture: 'Historisches Schlossgebäude mit kurioser Nutzungskette bis zum heutigen Museum.',
      now: 'Heute Hohenzollerisches Landesmuseum — Kreuzwegstationen Taubenschmid, Relikte der Hohenzollerischen Hochzeit 1598.',
      tags: spot.tags,
    };
    trigger.general_info =
      'Im Alten Schloss am Schloßplatz steckt eine absurde Nutzungskette: Fürstin Eugenie wurde hier aufgebahrt, später lief hier die Trikotagenfabrik Grotz — beschlagnahmt für Heisenbergs Atomforschung — und heute ist es das Hohenzollerische Landesmuseum.';
    pushDeep(
      trigger,
      'Kaskade Nutzungen: Aufbahrung Fürstin Eugenie → Trikotagenfabrik Grotz → Kaiser-Wilhelm-Institut für Physik (Heisenberg, Weizsäcker) → Landesmuseum.',
      ['geschichte', 'science_history', 'master_report'],
    );
    pushDeep(
      trigger,
      'Kein eigener Spot „Grotz-Fabrik“: die Fabrik war hier im Alten Schloss — die Geschichte gehört an diesen Pin.',
      ['meta', 'master_report'],
    );
    pushDeep(
      trigger,
      'User-Frage: Woran erkenne ich diesen Ort? Antwort: Am Schloßplatz das historische Schlossgebäude mit Museumsschild — neben der Tempelfassade der Stiftskirche.',
      ['faq', 'user_question', 'visual_anchor'],
    );
    pushDeep(
      trigger,
      'Querverbindung Medical Valley: Aus der Textil-/Trikotagenwelt wurde später Dialyse-/MedTech — die Grotz-Episode ist die Brücke zur modernen Cluster-Stadt.',
      ['querverbindung', 'wirtschaft'],
    );
    pushDeep(
      trigger,
      'LIVE: Öffnungszeiten und Eintritt des Landesmuseums frisch prüfen.',
      ['live_hint', 'ephemeral'],
    );
    approaches(spot, g.lat, g.lng, [
      'Am Schloßplatz: das Alte Schloss voraus — heute Museum, früher Fabrik und Denkzelle der Physik.',
      'Schloßplatz 5: Hier wurde Geschichte umgenutzt, bis das Landesmuseum einzog.',
      'Eingang Landesmuseum / Altes Schloss.',
    ]);
    console.log('[3a] Altes Schloss / Landesmuseum', g.lat, g.lng);
  }

  // 3b) Medical Valley / Bentley
  {
    let g = await resolvePlace('Bentley InnoMed Lotzenäcker 3 Hechingen', {
      preferTypes: ['establishment'],
    });
    if (!g) {
      const geo = await geocode('Lotzenäcker 3, 72379 Hechingen');
      const loc = geo.results?.[0]?.geometry?.location;
      g = { lat: loc.lat, lng: loc.lng, address: 'Lotzenäcker 3, 72379 Hechingen' };
    }
    const { spot, trigger } = ensureSpot(pack, 'hechingen_medical_valley_bentley', {
      name: 'Medical Valley · Bentley Lotzenäcker',
      category: 'freizeit',
      lat: g.lat,
      lng: g.lng,
      tier: 3,
      relevance: ['wirtschaft', 'architektur', 'interest_tech'],
    });
    spot.category = 'denkmal'; // architecture/economy landmark
    spot.facts = {
      origin:
        'Medical Valley Hechingen: nach Textilniedergang MedTech-Cluster; Bentley InnoMed mit markanter 32-m-Verbindungsbrücke am Lotzenäcker.',
      architecture:
        'Neubau-Ensemble inkl. Verbindungsbrücke über die Straße Lotzenäcker — sichtbarer Architektur-Marker des Clusters.',
      now: 'Adresse: Lotzenäcker 3 — Gewerbegebiet, nicht Altstadt.',
      tags: spot.tags,
    };
    trigger.general_info =
      'Im Gewerbegebiet Lotzenäcker steht das moderne Medical-Valley-Gesicht Hechingens: Bentley-Bauten mit 32-Meter-Verbindungsbrücke — Architektur für Wirtschafts- und Technikinteressierte, nicht klassisches Altstadt-Sightseeing.';
    pushDeep(
      trigger,
      'User-Frage: Woran erkenne ich diesen Ort? Antwort: An der langen Verbindungsbrücke zwischen Neubauten über der Straße Lotzenäcker — klar Gewerbe-/Campus-Optik, keine Altstadt.',
      ['faq', 'user_question', 'visual_anchor'],
    );
    pushDeep(
      trigger,
      'Relevanz: Tier-3 — nur wenn Interesse an Wirtschaft/Architektur/MedTech; sonst eher Altstadt und Burg.',
      ['place_tier', 'relevance'],
    );
    pushDeep(
      trigger,
      'Querverbindung Altes Schloss: Von Heisenberg/Grotz-Textil zur Dialyse-Industrie — dieselbe Stadt, zwei Epochen.',
      ['querverbindung', 'geschichte'],
    );
    approaches(spot, g.lat, g.lng, [
      'Gewerbegebiet Lotzenäcker: MedTech-Architektur voraus, nicht Residenzromantik.',
      'Die Verbindungsbrücke zwischen den Bentley-Bauten wird sichtbar.',
      'Lotzenäcker 3: Medical-Valley-Anker.',
    ]);
    console.log('[3b] Medical Valley', g.lat, g.lng);
  }

  // 4) Neues Schloss / Sparkasse ATM
  {
    let g = await resolvePlace('Neues Schloss Hechingen Schloßplatz 1', {
      preferTypes: ['bank', 'point_of_interest'],
    });
    if (!g) {
      const geo = await geocode('Schloßplatz 1, 72379 Hechingen');
      const loc = geo.results?.[0]?.geometry?.location;
      g = { lat: loc.lat, lng: loc.lng };
    }
    const { spot, trigger } = ensureSpot(pack, 'hechingen_neues_schloss_sparkasse', {
      name: 'Neues Schloss · Sparkasse ATM',
      category: 'service',
      lat: g.lat,
      lng: g.lng,
      tier: 3,
      relevance: ['service', 'atm', 'architektur'],
    });
    spot.facts = {
      origin: 'Klassizistisches Neues Schloss (Burnitz, 1818) — heute Sitz der lokalen Sparkasse.',
      architecture: 'Profane Nachnutzung eines Fürstenschlosses als Bank.',
      now: 'Infrastruktur-Spot: Geldautomat im historischen Fürstenschloss.',
      tags: spot.tags,
    };
    trigger.general_info =
      'Im klassizistischen Neuen Schloss am Schloßplatz sitzt die Sparkasse — Fun-Fact für Reisende: Geld abheben im historischen Fürstenschloss, ohne es als Innen-Sightseeing zu verkaufen.';
    pushDeep(
      trigger,
      'User-Frage: Woran erkenne ich diesen Ort? Antwort: Klassizistisches Schlossgebäude am Schloßplatz mit Bank-/Sparkassen-Beschilderung — nicht das Museum im Alten Schloss.',
      ['faq', 'user_question', 'visual_anchor'],
    );
    pushDeep(
      trigger,
      'Fun: Hier hebst du im Fürstenschloss ab — Architektur trifft Alltag.',
      ['fun', 'service'],
    );
    pushDeep(
      trigger,
      'LIVE: Ob der ATM 24/7 zugänglich ist und welche Karten gehen, vor Ort prüfen.',
      ['live_hint', 'ephemeral'],
    );
    approaches(spot, g.lat, g.lng, [
      'Am Schloßplatz: klassizistisches Neues Schloss — heute Bank, nicht Museum.',
      'Sparkasse im Fürstenschloss voraus.',
    ]);
    console.log('[4] Neues Schloss ATM', g.lat, g.lng);
  }

  // --- Google / research tourist adds ---
  // Fix St. Luzen GPS from Google
  {
    const g = await resolvePlace('Klosterkirche St. Luzen Hechingen', {
      preferTypes: ['church'],
    });
    if (g) {
      const spot = pack.spots.find((s) => s.id === 'hechingen_klosterkirche_st_luzen');
      const trigger = pack.trigger_points.find((t) => t.id === spot?.id);
      if (spot && trigger) {
        setGeo(spot, trigger, g.lat, g.lng, 28);
        spot.place_tier = 1;
        spot.relevance = ['must_see', 'architektur', 'geschichte'];
        spot.tags = [...new Set([...(spot.tags || []), 'tier1', 'must_see'])];
        pushDeep(
          trigger,
          `GPS Haupteingang (Google): ${g.lat.toFixed(6)}, ${g.lng.toFixed(6)}${g.address ? ` — ${g.address}` : ''}.`,
          ['gps_confirmed', 'sourced_google'],
        );
        console.log('[fix] St. Luzen GPS', g.lat, g.lng);
      }
    }
  }

  // Alte Synagoge
  {
    const g =
      (await resolvePlace('Alte Synagoge Hechingen Goldschmiedstraße 20', {
        preferTypes: ['synagogue', 'museum'],
      })) ||
      (await geocode('Goldschmiedstraße 20, 72379 Hechingen').then((r) => {
        const loc = r.results?.[0]?.geometry?.location;
        return loc
          ? { ...loc, address: 'Goldschmiedstraße 20, 72379 Hechingen' }
          : null;
      }));
    if (g) {
      const { spot, trigger } = ensureSpot(pack, 'hechingen_alte_synagoge', {
        name: 'Alte Synagoge Hechingen',
        category: 'museum',
        lat: g.lat,
        lng: g.lng,
        tier: 1,
        relevance: ['must_see', 'geschichte', 'juedisch', 'erinnerung'],
      });
      spot.facts = {
        origin:
          '1767 erbaut; Mitte 19. Jh. ~1/4 der Stadtbevölkerung jüdisch. 1938 Innenraum verwüstet, Gebäude blieb wegen dichter Bebauung stehen.',
        architecture:
          'Klassizistische Fassade 1881; innen maurische Schablonenmalerei, Flachkuppel mit Sternenhimmel — seit 1986 Gedenk- und Begegnungsstätte.',
        now: 'Goldschmiedstraße 20 — Ausstellung zur jüdischen Geschichte Hechingens.',
        tags: spot.tags,
      };
      trigger.general_info =
        'In der engen Goldschmiedstraße hinter der Stiftskirche liegt die Alte Synagoge von 1767: gerettet und seit 1986 Erinnerungs-, Ausstellungs- und Kulturort — eng verknüpft mit Madame Kaulla und dem jüdischen Friedhof.';
      pushDeep(
        trigger,
        'User-Frage: Woran erkenne ich diesen Ort? Antwort: In der verwinkelten Goldschmiedstraße ein in die Bebauung eingefügtes Gotteshaus mit klassizistischer Fassade — kein freistehender Dom.',
        ['faq', 'user_question', 'visual_anchor'],
      );
      pushDeep(
        trigger,
        'Querverbindung Jüdischer Friedhof / Madame Kaulla: Gemeindeleben in der Stadt, ewiges Ruherecht am Galgenrain.',
        ['querverbindung', 'geschichte'],
      );
      pushDeep(
        trigger,
        'LIVE: Öffnungszeiten (oft sonntags nachmittags) und Führungen frisch prüfen.',
        ['live_hint', 'ephemeral'],
      );
      approaches(spot, g.lat, g.lng, [
        'Hinter der Stiftskirche engt sich die Altstadt — wir nähern uns der Alten Synagoge.',
        'Goldschmiedstraße: klassizistische Fassade in dichter Bebauung.',
        'Eingang Alte Synagoge — Erinnerungsort der jüdischen Gemeinde.',
      ]);
      console.log('[add] Alte Synagoge', g.lat, g.lng);
    }
  }

  // Villa Eugenia deepen / ensure
  {
    const g = await resolvePlace('Villa Eugenia Hechingen Zollernstraße 10', {
      preferTypes: ['tourist_attraction', 'point_of_interest'],
    });
    const fursten =
      pack.spots.find((s) => /fürstengarten|furstengarten|villa eugenia/i.test(s.name)) ||
      null;
    if (g && fursten) {
      const trigger = pack.trigger_points.find((t) => t.id === fursten.id);
      fursten.name = 'Fürstengarten & Villa Eugenia';
      fursten.place_tier = 1;
      fursten.relevance = ['must_see', 'geschichte', 'natur', 'kultur'];
      setGeo(fursten, trigger, g.lat, g.lng, 40);
      trigger.general_info =
        'Villa Eugenia (ab 1786/87 Lustgartenhaus, 1833/34 Residenz) im englischen Fürstengarten: Letztes Domizil von Fürst Constantin und Fürstin Eugenie — Liszt und Berlioz prägten das orpheische Hechingen; heute Kultur- und Tagungsort.';
      pushDeep(
        trigger,
        'User-Frage: Woran erkenne ich diesen Ort? Antwort: Klassizistisches Schlösschen mit Rotunde/Flügeln mitten im Landschaftspark — nicht die Burg auf dem Berg.',
        ['faq', 'user_question', 'visual_anchor'],
      );
      pushDeep(
        trigger,
        'Querverbindung Schloss Lindich: Eugenie wohnte zuerst in Lindich, bevor die Villa Eugenia Stadtschloss wurde.',
        ['querverbindung'],
      );
      pushDeep(
        trigger,
        'LIVE: Führungen, Café-Sonnntag und Veranstaltungen in der Villa frisch prüfen.',
        ['live_hint', 'ephemeral'],
      );
      console.log('[enrich] Fürstengarten/Villa', g.lat, g.lng);
    }
  }

  // Schloss Lindich (exterior / context — private)
  {
    const g = await resolvePlace('Schloss Lindich Hechingen', {
      preferTypes: ['tourist_attraction', 'point_of_interest'],
    });
    if (g) {
      const { spot, trigger } = ensureSpot(pack, 'hechingen_schloss_lindich', {
        name: 'Schloss Lindich',
        category: 'denkmal',
        lat: g.lat,
        lng: g.lng,
        tier: 2,
        relevance: ['geschichte', 'architektur', 'panorama'],
      });
      spot.facts = {
        origin:
          '1738–1741 Rokoko-Jagd- und Lustschloss für Fürst Friedrich Ludwig; Gäste u.a. Napoleon III., Liszt, Berlioz; Eugenie wohnte hier vor der Villa Eugenia.',
        architecture:
          'Quadratischer Hauptbau mit Kavaliershäusern im Halbkreis; Park/sternförmige Wege.',
        now: 'Privat bewohnt — Innen nicht besichtigen; Außenwirkung und Burgblick; Restaurant in Kavaliershaus möglich.',
        tags: spot.tags,
      };
      trigger.general_info =
        'Westlich der Stadt thront Schloss Lindich als Rokoko-Lustschloss mit Blick zur Alb und Burg — historisch eng mit Eugenie und dem orpheischen Hof verbunden, heute privat: eher Kontext- und Außenspot als Museumsbesuch.';
      pushDeep(
        trigger,
        'User-Frage: Woran erkenne ich diesen Ort? Antwort: Freistehendes Schlösschen mit ringförmig angeordneten Kavaliershäusern außerhalb der Kernstadt — klar kein Altstadt-Fachwerk.',
        ['faq', 'user_question', 'visual_anchor'],
      );
      pushDeep(
        trigger,
        'LIVE: Ob Park/Restaurant zugänglich ist (oft nur Tag des offenen Denkmals für Park), frisch prüfen — kein Innenbesuch erwarten.',
        ['live_hint', 'ephemeral'],
      );
      approaches(spot, g.lat, g.lng, [
        'Außerhalb der Kernstadt: Lindich zeichnet sich als freistehendes Schlösschen ab.',
        'Halbkreis der Kavaliershäuser wird lesbar — Rokoko-Anlage Lindich.',
      ]);
      console.log('[add] Schloss Lindich', g.lat, g.lng);
    }
  }

  // Oldtimer + Kalender museum
  {
    const g = await resolvePlace('Oldtimermuseum Zollernalb Hechingen', {
      preferTypes: ['museum'],
    });
    if (g) {
      const existing = pack.spots.find((s) => /oldtimer/i.test(s.name));
      const id = existing?.id || 'hechingen_oldtimermuseum_zollernalb';
      const { spot, trigger } = ensureSpot(pack, id, {
        name: 'Oldtimermuseum Zollernalb & Kalendermuseum',
        category: 'museum',
        lat: g.lat,
        lng: g.lng,
        tier: 2,
        relevance: ['familie', 'technik', 'museum'],
      });
      spot.facts = {
        origin:
          'Im ehemaligen Zollerpark-Kaufhaus: ~1800 m², Fahrzeuggeschichte ab 1886; integriertes Deutsches Kalendermuseum.',
        now: 'Obere Mühlstraße 7 — Wechselausstellungen, Werkstattblicke.',
        tags: spot.tags,
      };
      trigger.general_info =
        'An der Oberen Mühlstraße zeigt das Oldtimermuseum Zollernalb mobile Geschichte ab 1886 — und im Seitentrakt ein in Europa seltenes Kalendermuseum. Ideal als Familien-/Technik-Detour, nicht als Residenz-Ersatz.';
      pushDeep(
        trigger,
        'User-Frage: Woran erkenne ich diesen Ort? Antwort: Großes Museumsgebäude an der Oberen Mühlstraße mit Oldtimer-Bezug — näher am Starzelpark als am Schloßplatz.',
        ['faq', 'user_question', 'visual_anchor'],
      );
      pushDeep(
        trigger,
        'LIVE: Öffnungszeiten (oft So/Feiertag) und Eintritt frisch prüfen.',
        ['live_hint', 'ephemeral'],
      );
      approaches(spot, g.lat, g.lng, [
        'Obere Mühlstraße: das Oldtimer-/Kalendermuseum liegt voraus.',
        'Eingang Oldtimermuseum Zollernalb.',
      ]);
      console.log('[enrich] Oldtimer', g.lat, g.lng);
    }
  }

  // Märchenpfad
  {
    const g = await resolvePlace('Märchenpfad Hechingen', {
      preferTypes: ['tourist_attraction', 'park'],
    });
    if (g) {
      const { spot, trigger } = ensureSpot(pack, 'hechingen_maerchenpfad', {
        name: 'Märchenpfad Hechingen',
        category: 'natur',
        lat: g.lat,
        lng: g.lng,
        tier: 2,
        relevance: ['familie', 'natur'],
      });
      trigger.general_info =
        'Der Märchenpfad ist ein familienorientierter Themenweg — Ergänzung zu Schaukelweg und Barfußpfad, wenn Kinder mitwandern.';
      pushDeep(
        trigger,
        'User-Frage: Woran erkenne ich diesen Ort? Antwort: Beschilderte Märchen-/Themenstationen am Weg, klar familien- und pfadartig — kein Museumsgebäude.',
        ['faq', 'user_question', 'visual_anchor'],
      );
      pushDeep(
        trigger,
        'LIVE: Stationen und Begehbarkeit saisonal prüfen.',
        ['live_hint', 'ephemeral'],
      );
      approaches(spot, g.lat, g.lng, [
        'Der Märchenpfad beginnt — Themenstationen für Familien.',
        'Erste Märchenstation voraus.',
      ]);
      console.log('[add] Märchenpfad', g.lat, g.lng);
    }
  }

  // Evangelische Johanneskirche (restore if pruned earlier overwrite)
  {
    const g = await resolvePlace('Evangelische Johanneskirche Hechingen Zollernstraße', {
      preferTypes: ['church'],
    });
    if (g && !pack.spots.some((s) => /johanneskirche/i.test(s.name))) {
      const { spot, trigger } = ensureSpot(pack, 'hechingen_johanneskirche', {
        name: 'Evangelische Johanneskirche',
        category: 'kirche',
        lat: g.lat,
        lng: g.lng,
        tier: 2,
        relevance: ['architektur', 'altstadt'],
      });
      trigger.general_info =
        'Die evangelische Johanneskirche an der Zollernstraße ist der protestantische Gegenpol zur katholischen Stiftskirche — Altstadt-Orientierungspunkt Richtung Fürstengarten/Obertor.';
      pushDeep(
        trigger,
        'User-Frage: Woran erkenne ich diesen Ort? Antwort: Kirche an der Zollernstraße im Altstadtgefüge — nicht die große Tempelfassade der Stiftskirche am Kirchplatz.',
        ['faq', 'user_question', 'visual_anchor'],
      );
      approaches(spot, g.lat, g.lng, [
        'An der Zollernstraße: Johanneskirche voraus.',
        'Eingang Johanneskirche.',
      ]);
      console.log('[add] Johanneskirche', g.lat, g.lng);
    }
  }

  // Tier tags on existing core
  const tierMap = [
    [/stadtgeschichte/, 1, ['must_see', 'geschichte']],
    [/unterer_turm/, 1, ['must_see', 'geschichte', 'orientierung']],
    [/juedischer_friedhof|jüdischer/, 1, ['must_see', 'geschichte', 'juedisch']],
    [/roemisches|freilicht/, 1, ['must_see', 'geschichte', 'familie']],
    [/obertorplatz|schaukelweg/, 1, ['must_see', 'familie', 'orientierung']],
    [/bahnhof_hechingen$/, 1, ['transport', 'orientierung']],
    [/kloster_stetten|dominikaner/, 1, ['must_see', 'geschichte', 'architektur']],
    [/hofgut_domane$/, 2, ['freizeit', 'familie']],
    [/barfuss|erleb_dich|starzel/, 2, ['familie', 'natur']],
    [/hohenzollernblick|beurener/, 2, ['panorama']],
    [/rathaus|buerger|bürger/, 2, ['service', 'verwaltung']],
    [/krieger/, 2, ['geschichte']],
  ];
  for (const s of pack.spots) {
    for (const [rx, tier, rel] of tierMap) {
      if (rx.test(s.id) || rx.test(s.name)) {
        s.place_tier = s.place_tier || tier;
        s.relevance = [...new Set([...(s.relevance || []), ...rel])];
        s.tags = [
          ...new Set([...(s.tags || []), `tier${s.place_tier}`, ...rel]),
        ];
      }
    }
    if (!s.place_tier) {
      s.place_tier = (s.tags || []).includes('optional_live') ? 3 : 2;
      s.tags = [...new Set([...(s.tags || []), `tier${s.place_tier}`])];
    }
  }

  // Pack-level tier doctrine
  pack._place_tiers = {
    description:
      'Tier 1 = Must-See Kern (aktive Annäherung). Tier 2 = starke Detours wenn Interesse/Zeit. Tier 3 = Service/Wirtschaft/Kontext — nur bei passendem Profil, sonst nicht aufdrängen.',
    tiers: {
      1: 'must_see',
      2: 'worth_detour',
      3: 'context_or_service',
    },
  };

  const gate = runQualityGate(pack, { strict: false });
  console.log(
    `[refine] spots=${pack.spots.length} ok=${gate.ok} err=${gate.errors.length} warn=${gate.warnings.length} needsNarr=${gate.gaps.needsNarration.length}`,
  );
  const byTier = { 1: 0, 2: 0, 3: 0 };
  for (const s of pack.spots) byTier[s.place_tier || 2] = (byTier[s.place_tier || 2] || 0) + 1;
  console.log('[tiers]', byTier);
  console.log(
    '[names]',
    pack.spots
      .sort((a, b) => (a.place_tier || 9) - (b.place_tier || 9))
      .map((s) => `T${s.place_tier} ${s.name}`)
      .join(' | '),
  );

  if (hasFlag('apply') || !hasFlag('dry')) {
    const file = savePack(pack, { bumpVersion: true });
    console.log('[refine] wrote', file, 'v' + pack.data_version);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
