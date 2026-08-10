#!/usr/bin/env node
/**
 * Enrich Wangerooge pack with Gemini regional-history master report.
 * Does NOT upload — local data/staedte/wangerooge.json only.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boxPolygon } from './geo/osm.mjs';
import { validateCityPack } from './geo/validatePack.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACK_PATH = path.join(ROOT, 'data/staedte/wangerooge.json');

function centroid(poly) {
  const n = poly.length;
  let lat = 0;
  let lng = 0;
  for (const p of poly) {
    lat += p.latitude ?? p.lat;
    lng += p.longitude ?? p.lng;
  }
  return { lat: lat / n, lng: lng / n };
}

/** Offset from lat/lng by meters north / east. */
function offsetMeters(lat, lng, northM, eastM) {
  const dLat = northM / 111320;
  const dLng = eastM / (111320 * Math.cos((lat * Math.PI) / 180));
  return { lat: +(lat + dLat).toFixed(7), lng: +(lng + dLng).toFixed(7) };
}

/**
 * Place approach point roughly `distanceM` from center along a bearing (deg from N).
 * radius_m is the GPS fire radius around that point.
 */
function approachAt(lat, lng, distanceM, bearingDeg, radiusM, id, teaser) {
  const rad = (bearingDeg * Math.PI) / 180;
  const north = distanceM * Math.cos(rad);
  const east = distanceM * Math.sin(rad);
  const p = offsetMeters(lat, lng, north, east);
  return {
    id,
    lat: p.lat,
    lng: p.lng,
    radius_m: radiusM,
    teaser_text: teaser,
    condition_rule: 'always',
  };
}

function deep(text, tags) {
  return { text, tags: tags || ['sourced_gemini'] };
}

function upsertSpot(pack, spot) {
  const i = pack.spots.findIndex((s) => s.id === spot.id);
  if (i >= 0) pack.spots[i] = { ...pack.spots[i], ...spot };
  else pack.spots.push(spot);
}

function upsertTrigger(pack, tp) {
  const i = (pack.trigger_points || []).findIndex((t) => t.id === tp.id);
  if (i >= 0) pack.trigger_points[i] = { ...pack.trigger_points[i], ...tp };
  else {
    pack.trigger_points = pack.trigger_points || [];
    pack.trigger_points.push(tp);
  }
}

function syncTriggerFromSpot(pack, spot, generalInfo, deepPool) {
  const poly = spot.polygonCoordinates;
  const c = poly ? centroid(poly) : { lat: pack.lat, lng: pack.lng };
  const existing = (pack.trigger_points || []).find((t) => t.id === spot.id);
  upsertTrigger(pack, {
    id: spot.id,
    name: spot.name,
    lat: existing?.lat ?? c.lat,
    lng: existing?.lng ?? c.lng,
    radius_m: existing?.radius_m ?? 45,
    trigger_kind: 'area',
    trigger_type: 'polygon',
    polygon: poly
      ? poly.map((p) => ({
          lat: p.latitude ?? p.lat,
          lng: p.longitude ?? p.lng,
        }))
      : existing?.polygon,
    general_info: generalInfo,
    deep_data_pool: deepPool,
  });
}

function main() {
  const pack = JSON.parse(fs.readFileSync(PACK_PATH, 'utf8'));

  // ─── 1) Alter Leuchtturm ───────────────────────────────────────────
  {
    const id = 'wangerooge_inselmuseum_alter_leuchtturm';
    const spot = pack.spots.find((s) => s.id === id);
    const c = centroid(spot.polygonCoordinates);
    // Approaches along Zedeliusstraße axis (~south = into Dorf)
    const approaches = [
      approachAt(
        c.lat,
        c.lng,
        150,
        180,
        42,
        `${id}_approach_far`,
        'Über den Dächern der Fußgängerzone erhebt sich die markante, graue Zementputz-Fassade des Alten Leuchtturms. Dieses Bauwerk ist mehr als ein maritimes Seezeichen; es ist der architektonische Nukleus des heutigen Inseldorfes, das nach der Flut 1855 hier gegründet wurde.',
      ),
      approachAt(
        c.lat,
        c.lng,
        20,
        200,
        14,
        `${id}_approach_mid`,
        'Erinnerst du dich an die zerstörerischen Kräfte der Neujahrsflut, von der wir sprachen? Genau hier, im Schatten des 1855 erbauten Turms, bauten 82 hartnäckige Insulaner ein neues Leben auf. Beachte zur Rechten die historische Schmalspur-Dampflok, die seit 1968 hier an die mechanisierte Frühphase der Inselbahn erinnert.',
      ),
      approachAt(
        c.lat,
        c.lng,
        5,
        210,
        8,
        `${id}_approach_near`,
        'Du stehst nun vor dem Portal. Der Turm misst 37 Meter. Wenn du die Aussichtsplattform in der alten Laterne genießen oder hier gar heiraten möchtest, bereite dich auf einen steilen Aufstieg über exakt 146 historische Stufen vor. Einen Aufzug gibt es aus Denkmalschutzgründen nicht.',
      ),
    ];
    const bullets = [
      'Adresse: Zedeliusstraße 3, 26486 Wangerooge.',
      '37 m hoher Steinturm (Entwurf Baurat Lasius), erbaut ab 1855; Licht erstmals am 2. Oktober 1856, gelöscht am 7. November 1969 zugunsten des neuen Leuchtturms.',
      'Nach der Neujahrsflut 1854/55 wurde das Westdorf fast zerstört (21 von 75 Häusern); 82 Insulaner gründeten ab 1865 das neue Dorf um diesen Turm.',
      'Seit 1968 Heimatmuseum; ehemalige Laterne = Aussichtsplattform (146 Stufen, kein Aufzug). Seit 15. März 1996 Standesamt.',
      'Am Fuß: letzte Wangerooger Dampflokomotive als Denkmal. Kontakt Kurverwaltung Tel. 04469-8432.',
    ];
    const deepPool = [
      deep(
        'Neujahrsflut 1854/1855: ursprüngliches westliches Inseldorf fast nivelliert; Inselmasse schrumpfte auf kritische 175 Hektar; acht Wochen Isolierung durch Treibeis. Juni 1855: Regierungsbeschluss zur Aufgabe der Insel — 82 Insulaner verweigerten die Umsiedlung.',
        ['geschichte', 'sturmflut', 'must_have'],
      ),
      deep(
        'Bau: dreijährige Bauzeit ab 1855 nach Entwurf des oldenburgischen Baurats Lasius; massiver Steinturm mit grauem Zementputz; auf 7 m Höhe kreisförmige Wärterwohnung. Lichtquelle anfangs Argandlampe mit Rüböl.',
        ['architecture', 'geschichte'],
      ),
      deep(
        'Eigentum Gemeinde Wangerooge. Aussichtsplattform: 146 Stufen. Standesamt seit 15.03.1996. Trauungen und Museumsbesuche über Kurverwaltung 04469-8432.',
        ['live', 'barrierefreiheit', 'verwaltung'],
      ),
      deep(
        'Am Fuß des Turms steht die letzte Wangerooger Schmalspur-Dampflok als Denkmal (seit 1968).',
        ['inselbahn', 'denkmal'],
      ),
    ];
    Object.assign(spot, {
      name: 'Alter Leuchtturm (Inselmuseum & Standesamt)',
      district: 'Dorf',
      category: 'museum',
      tags: Array.from(
        new Set([
          ...(spot.tags || []),
          'museum',
          'must_have',
          'aussicht',
          'geschichte',
          'standesamt',
          'sourced_gemini',
        ]),
      ),
      bullets,
      facts: {
        origin:
          'Nach der Neujahrsflut 1854/55 entstand ab 1855 der Alte Leuchtturm als Nukleus des neuen Ostdorfes; 82 Insulaner gründeten ab 1865 das Dorf um diesen Turm.',
        architecture:
          '37 m Steinturm, Entwurf Baurat Lasius, grauer Zementputz, Wärterwohnung auf 7 m; Licht 1856–1969.',
        now: 'Heimatmuseum seit 1968, Standesamt seit 1996, 146 Stufen zur Laterne; Dampflok-Denkmal am Fuß.',
        tags: ['museum', 'must_have', 'geschichte', 'aussicht', 'standesamt'],
      },
      approach_triggers: approaches,
      sub_pois: [
        {
          id: `${id}_sub_eingang`,
          name: 'Portal Alter Leuchtturm',
          lat: approaches[2].lat,
          lng: approaches[2].lng,
          radius_m: 8,
          fact_details:
            'Portal des Alten Leuchtturms: 146 Stufen zur Aussichtsplattform in der alten Laterne — kein Aufzug (Denkmalschutz). Seit 1996 auch Standesamt.',
          tags: ['sub_poi', 'eingang', 'standesamt'],
        },
        {
          id: `${id}_sub_dampflok`,
          name: 'Dampflok-Denkmal',
          ...offsetMeters(c.lat, c.lng, -8, 12),
          radius_m: 10,
          fact_details:
            'Letzte Wangerooger Schmalspur-Dampflokomotive — Denkmal seit 1968 für die Frühphase der Inselbahn.',
          tags: ['sub_poi', 'denkmal', 'inselbahn'],
        },
      ],
    });
    syncTriggerFromSpot(
      pack,
      spot,
      'Der Alte Leuchtturm ist das architektonische Manifest des Wiederaufbaus nach der Neujahrsflut 1854/55 — und der Nukleus des heutigen Inseldorfes.',
      deepPool,
    );
  }

  // ─── 2) Westturm ───────────────────────────────────────────────────
  {
    const id = 'wangerooge_westturm';
    const spot = pack.spots.find((s) => s.id === id);
    const c = centroid(spot.polygonCoordinates);
    // Approach from east (Telegrafenweg / Dorf → Westen)
    const approaches = [
      approachAt(
        c.lat,
        c.lng,
        200,
        90,
        48,
        `${id}_approach_far`,
        'Vor dir in der Dünenlandschaft erhebt sich massiv das 56 Meter hohe Wahrzeichen der Insel: Der Westturm. Die drei charakteristischen Spitzen waren einst überlebenswichtig für die Peilung der Handelsschiffe in der Nordsee.',
      ),
      approachAt(
        c.lat,
        c.lng,
        50,
        95,
        22,
        `${id}_approach_mid`,
        'Der Backsteinbau, auf den du zugehst, stammt aus den Jahren 1932/33. Der Originalturm aus der Zeit um 1602 stand etwa 900 Meter von hier entfernt. Dieser historische Turm bot damals den einzigen Schutz vor dem Ertrinken, bis er 1914 gesprengt wurde.',
      ),
      approachAt(
        c.lat,
        c.lng,
        10,
        100,
        10,
        `${id}_approach_near`,
        'Du stehst nun vor dem achteckigen Bau, der auf 124 Eisenbetonpfählen ruht. Der Turm selbst ist heute eine Jugendherberge und für Tagesgäste im Inneren nicht zugänglich, bietet von außen aber ein exzellentes Motiv für Architekturfotografien.',
      ),
    ];
    const bullets = [
      'Adresse (Gemini): Im Westen 38, 26486 Wangerooge — Google listet „Str. Zum Westen 27“; Koordinaten aus Places beibehalten.',
      '56 m rotbrauner Backsteinturm (1932–33) auf 124 Eisenbetonpfählen (je 6 m lang, 30 cm stark); historisierender Nachbau des Alten Westturms (1597–1602).',
      'Originalturm stand ~900 m südsüdöstlich: Kirche, Gefängnis, Strandgutlager, Fluchtort bei Sturmfluten; drei Spitzen als Nord-Süd-Peilhilfe. 1914 gesprengt — Fundamente bei Ebbe unterhalb des Neuen Leuchtturms sichtbar.',
      'Heute DJH-Jugendherberge (Anbau 2005, 168 Betten); Innenraum bis 7. Etage nur für Hausgäste. DJH-Fahrradverleih vor Ort Tel. 04469-439.',
    ];
    const deepPool = [
      deep(
        'Alter Westturm (1597–1602): Landmarke, Kirche, Gefängnis, Strandgutlager und Zuflucht bei Sturmfluten. Drei Spitzen = Peilhilfe N–S. 1914 aus kriegstaktischen Gründen gesprengt.',
        ['geschichte', 'must_have', 'krieg'],
      ),
      deep(
        'Nachbau 1932/33: 56 m, 124 Eisenbetonpfähle. Unmittelbar nach Fertigstellung von der NS-Führung als Hitlerjugend-Herberge zweckentfremdet.',
        ['geschichte', 'architecture', 'ns_zeit'],
      ),
      deep(
        'DJH Westturm: 168 Betten, Anbau 2005. Tagesgäste: Innenraum gesperrt. Fahrradverleih Tel. 04469-439.',
        ['live', 'hotel', 'djh'],
      ),
      deep(
        'Fundamente des Originalturms sind bei Ebbe am Strand im Westen unterhalb des Neuen Leuchtturms sichtbar.',
        ['natur', 'geschichte', 'ebbe'],
      ),
    ];
    Object.assign(spot, {
      district: 'West',
      category: 'aussicht',
      tags: Array.from(
        new Set([
          ...(spot.tags || []),
          'aussicht',
          'must_have',
          'djh',
          'geschichte',
          'wahrzeichen',
          'sourced_gemini',
        ]),
      ),
      bullets,
      facts: {
        origin:
          'Der heutige Westturm (1932/33) ist Nachbau des Alten Westturms (1597–1602), der 1914 gesprengt wurde und bei Sturmfluten als Zuflucht diente.',
        architecture:
          '56 m Backstein, drei Spitzen (historisch Peilhilfe), Fundament auf 124 Eisenbetonpfählen.',
        now: 'DJH-Jugendherberge mit 168 Betten; Innenraum für Tagesgäste gesperrt; Fahrradverleih am Gelände.',
        tags: ['aussicht', 'must_have', 'djh', 'geschichte'],
      },
      approach_triggers: approaches,
      sub_pois: [
        {
          id: `${id}_sub_eingang`,
          name: 'Westturm Vorplatz',
          lat: approaches[2].lat,
          lng: approaches[2].lng,
          radius_m: 10,
          fact_details:
            'Vor dem Westturm: achteckiger Backsteinbau auf 124 Pfählen. Innen nur für DJH-Hausgäste — außen starkes Fotomotiv.',
          tags: ['sub_poi', 'djh'],
        },
      ],
    });
    syncTriggerFromSpot(
      pack,
      spot,
      'Der rotbraune Westturm mit drei Spitzen ist das unverkennbare Wahrzeichen Wangerooges — und heute Jugendherberge.',
      deepPool,
    );
  }

  // ─── 3) Café Pudding ───────────────────────────────────────────────
  {
    const id = 'wangerooge_cafe_pudding';
    const spot = pack.spots.find((s) => s.id === id);
    const c = centroid(spot.polygonCoordinates);
    // Approach from south along Zedeliusstraße toward Promenade
    const approaches = [
      approachAt(
        c.lat,
        c.lng,
        100,
        180,
        36,
        `${id}_approach_far`,
        'Am Ende der Fußgängerzone, dort wo die Insel scheinbar ins Meer abbricht, siehst du einen markanten, runden Bau auf der Düne thronen. Das ist das legendäre Café Pudding.',
      ),
      approachAt(
        c.lat,
        c.lng,
        20,
        190,
        14,
        `${id}_approach_mid`,
        'Kaum zu glauben, aber dieses helle, einladende Stück Inselarchitektur verbirgt in seinem Kern einen massiven Weltkriegsbunker. 1949 machte die Familie Folkerts aus diesem militärischen Relikt ein Symbol der zivilen Erholung.',
      ),
      approachAt(
        c.lat,
        c.lng,
        5,
        200,
        8,
        `${id}_approach_near`,
        "Hier beginnt der 'Pudding'. Ob für hausgemachtes Eis oder ostfriesischen Tee – die Aussicht von dieser Düne auf die rollenden Wellen ist unvergleichlich. Beachte: montags ist Ruhetag.",
      ),
    ];
    const bullets = [
      'Adresse: Zedeliusstraße / Übergang Obere Strandpromenade (Places: Zedeliusstraße 49).',
      'Runder Bau auf Promenadendüne umschließt Wehrmachtsbunker; Familie Folkerts startete 1948 mit Eis aus dem Bunker, Eröffnung Café Pudding am 4. Juni 1949.',
      'Name: lokal „um den Pudding gehen“ = die Düne umrunden — nicht die Süßspeise. Heute 4. Generation (Thorn Folkerts).',
      'Eigene Eisherstellung & Konditorei, warme Gerichte; Di–So 11:00–21:30, Abendkarte 17:30–20:30; Montag Ruhetag. 360°-Meerblick.',
    ];
    const deepPool = [
      deep(
        '1948: Familie Folkerts kauft Eisbereitungsmaschine und verkauft Eis/Kuchen aus dem nackten Bunker. Winter 1948/49 Ausbau; Eröffnung 4. Juni 1949.',
        ['geschichte', 'cafe', 'ww2'],
      ),
      deep(
        'Etymologie: „um den Pudding gehen“ = die Düne umrunden und zurückkehren — lokale Wegführung, keine Süßspeise.',
        ['geschichte', 'sprache'],
      ),
      deep(
        'Erweiterungen: 1971/72 festes Dach statt Dachterrasse, Umbau im 4-m-Umkreis; 1999 und 2009 Sonnenterrassen nach Südosten.',
        ['architecture'],
      ),
      deep(
        'Live: Di–So 11:00–21:30; Abendkarte 17:30–20:30; Mo Ruhetag. Spezialitätenkonditorei mit eigener Eisherstellung.',
        ['live', 'cafe', 'kaffee'],
      ),
    ];
    Object.assign(spot, {
      district: 'Nord',
      category: 'cafe',
      tags: Array.from(
        new Set([
          ...(spot.tags || []),
          'cafe',
          'kaffee',
          'aussicht',
          'must_have',
          'geschichte',
          'sourced_gemini',
        ]),
      ),
      bullets,
      facts: {
        origin:
          'Café Pudding entstand 1948/49 aus einem Wehrmachtsbunker auf der Promenadendüne — Eröffnung 4. Juni 1949 durch Familie Folkerts.',
        architecture:
          'Runder Bau umschließt den Bunker; Erweiterungen 1971/72, Terrassen 1999 und 2009.',
        now: '4. Generation Folkerts; Eis & Konditorei, Abendkarte; Mo Ruhetag; 360°-Aussicht.',
        tags: ['cafe', 'must_have', 'aussicht', 'geschichte'],
      },
      approach_triggers: approaches,
      sub_pois: [
        {
          id: `${id}_sub_terrasse`,
          name: 'Café Pudding Terrasse',
          lat: approaches[2].lat,
          lng: approaches[2].lng,
          radius_m: 8,
          fact_details:
            'Terrasseneingang Café Pudding — Kern ist ein WWII-Bunker. Montags Ruhetag.',
          tags: ['sub_poi', 'cafe', 'aussicht'],
        },
      ],
    });
    syncTriggerFromSpot(
      pack,
      spot,
      'Café Pudding thront auf der Promenadendüne — zivile Umnutzung eines Wehrmachtsbunkers und Epizentrum der Insel-Kaffeekultur.',
      deepPool,
    );
  }

  // ─── 4) Nationalpark-Haus Rosenhaus ────────────────────────────────
  {
    const id = 'wangerooge_nationalpark_haus_wangerooge';
    const spot = pack.spots.find((s) => s.id === id);
    const c = centroid(spot.polygonCoordinates);
    const approaches = [
      approachAt(
        c.lat,
        c.lng,
        50,
        270,
        22,
        `${id}_approach_far`,
        "Vor dir liegt das ökologische Herz der Insel: Das Nationalpark-Haus 'Rosenhaus'. Es beheimatet das gesammelte Wissen über das fragile UNESCO-Weltnaturerbe Wattenmeer.",
      ),
      approachAt(
        c.lat,
        c.lng,
        15,
        280,
        12,
        `${id}_approach_mid`,
        'Wirf einen Blick durch den Zaun in den Garten – dort ruht das gewaltige Knochengerüst eines gestrandeten Pottwals. Ein stummer Zeuge der marinen Megafauna vor dieser Küste.',
      ),
      approachAt(
        c.lat,
        c.lng,
        5,
        290,
        8,
        `${id}_approach_near`,
        'Der Eintritt ist kostenfrei und die Architektur rollstuhlgerecht. Drinnen warten interaktive Stationen, Seewasser-Aquarium und Analysen zum Vogelzug.',
      ),
    ];
    const bullets = [
      'Adresse: Friedrich-August-Straße 18, 26486 Wangerooge — Nationalpark-Haus „Rosenhaus“.',
      'Umweltbildung zum UNESCO-Weltnaturerbe Wattenmeer; Garten mit Skelett eines gestrandeten Pottwals; FÖJ-Unterstützung für Führungen und Wattwanderungen.',
      'Ganzjährig kostenloser Eintritt; zertifiziert barrierefrei inkl. Euro-Schlüssel-WC.',
      'Saison 15.03.–31.10.: Di–Fr 09–13 & 14–18; Sa/So/Feiertag 10–12 & 14–17; Montag Ruhetag.',
    ];
    const deepPool = [
      deep(
        'Rosenhaus: edukatives Zentrum zum UNESCO-Weltnaturerbe Wattenmeer — Vogelzug, Küstenwandel, interaktive Ausstellung, Aquarium, Filmeraum.',
        ['natur', 'museum', 'unesco'],
      ),
      deep(
        'Im Garten: vollständiges Skelett eines gestrandeten Pottwals.',
        ['natur', 'must_have'],
      ),
      deep(
        'Barrierefrei zertifiziert (rollstuhlgerecht, taktile Reize); öffentliches Euro-Schlüssel-WC. Eintritt kostenlos.',
        ['barrierefreiheit', 'live'],
      ),
      deep(
        'Öffnungszeiten Saison 15.03.–31.10.: Di–Fr 09–13/14–18; Wochenende/Feiertag 10–12/14–17; Mo Ruhetag. FÖJ organisiert Führungen und Wattwanderungen.',
        ['live'],
      ),
    ];
    Object.assign(spot, {
      name: 'Nationalpark-Haus „Rosenhaus“',
      district: 'Dorf',
      category: 'museum',
      tags: Array.from(
        new Set([
          ...(spot.tags || []),
          'museum',
          'natur',
          'unesco',
          'barrierefreiheit',
          'must_have',
          'sourced_gemini',
        ]),
      ),
      bullets,
      facts: {
        origin:
          'Nationalpark-Haus Rosenhaus vermittelt die ökologische Komplexität des UNESCO-Weltnaturerbes Wattenmeer.',
        architecture:
          'Zertifiziert barrierefrei; Ausstellung mit Aquarium und Filmeraum; Pottwal-Skelett im Garten.',
        now: 'Kostenloser Eintritt; Saisonzeiten Mo Ruhetag; FÖJ-Führungen und Wattwanderungen.',
        tags: ['museum', 'natur', 'unesco', 'barrierefreiheit'],
      },
      approach_triggers: approaches,
      sub_pois: [
        {
          id: `${id}_sub_pottwal`,
          name: 'Pottwal-Skelett (Garten)',
          ...offsetMeters(c.lat, c.lng, 5, -12),
          radius_m: 12,
          fact_details:
            'Im Garten des Rosenhauses: Skelett eines gestrandeten Pottwals — Dimensionen der marinen Megafauna vor Wangerooge.',
          tags: ['sub_poi', 'natur'],
        },
        {
          id: `${id}_sub_eingang`,
          name: 'Rosenhaus Eingang',
          lat: approaches[2].lat,
          lng: approaches[2].lng,
          radius_m: 8,
          fact_details:
            'Eingang Nationalpark-Haus — kostenlos, rollstuhlgerecht, Euro-Schlüssel-WC.',
          tags: ['sub_poi', 'eingang', 'barrierefreiheit'],
        },
      ],
    });
    syncTriggerFromSpot(
      pack,
      spot,
      'Das Rosenhaus ist das ökologische Herz der Insel — UNESCO-Wattenmeer, Pottwal-Skelett und kostenlose barrierefreie Ausstellung.',
      deepPool,
    );
  }

  // ─── 5) Inselbahnhof ───────────────────────────────────────────────
  {
    const id = 'wangerooge_db_bahnhof_wangerooge';
    const spot = pack.spots.find((s) => s.id === id);
    const c = centroid(spot.polygonCoordinates);
    const approaches = [
      approachAt(
        c.lat,
        c.lng,
        50,
        0,
        22,
        `${id}_approach_far`,
        'Hier pulsiert die infrastrukturelle Lebensader der Insel. Der Bahnhof Wangerooge ist der logistische Dreh- und Angelpunkt für jeden Besucher und jede Warenlieferung.',
      ),
      approachAt(
        c.lat,
        c.lng,
        20,
        10,
        14,
        `${id}_approach_mid`,
        'Schau auf das logistische Ballett vor dir. Hier am Vorplatz findet die zentrale Gepäckausgabe statt — Großgepäck aus den roten Containern von Harlesiel kommt genau hier wieder an.',
      ),
      approachAt(
        c.lat,
        c.lng,
        5,
        15,
        8,
        `${id}_approach_near`,
        'Zur Linken die stufenlosen Zugänge zur Tourist-Info, rechts die Fahrkartenschalter. Alles auf Rollstuhlgerechtigkeit geprüft, inklusive abgesenkter Tresen (90 cm).',
      ),
    ];
    const bullets = [
      'Adresse: Bahnhofstraße 6, 26486 Wangerooge — zentraler Verkehrsknoten der autofreien Insel (§ 46 StVO).',
      'Schmalspur-Inselbahn: Monopol für Passagiere vom Fähranleger, Fracht und Reisegepäck.',
      'Fahrkarten, Gepäckabfertigung, Tourist-Info (Saison oft 08:00–18:00). Barrierefrei zertifiziert (PA-13509-2023): stufenlos, Tresen 90 cm, WC Türbreite 93 cm.',
      'Gepäck am Vorplatz abholen — außer gebuchter Hauszustellung (obligatorisch für Gäste im Westen).',
    ];
    const deepPool = [
      deep(
        'Autofreie Insel (§ 46 StVO): Inselbahn ist systemrelevanter Flaschenhals für Fracht, Passagiere vom Südwest-Anleger und Gepäck.',
        ['transport', 'must_have', 'inselbahn'],
      ),
      deep(
        'Barrierefreiheit Zertifikat PA-13509-2023: stufenloser Zugang, Service-Schalter 90 cm, WC Türbreite 93 cm, Bewegungsflächen 292×62 cm, Haltegriffe beidseitig.',
        ['barrierefreiheit', 'live'],
      ),
      deep(
        'Gepäcklogistik: Ausgabe am Bahnhofsvorplatz. Hauszustellung kostenpflichtig und für West-Gäste (z. B. Jugendherberge) obligatorisch.',
        ['transport', 'gepaeck', 'live'],
      ),
      deep(
        'Tourist-Information im Bahnhofsbereich, in der Saison typisch 08:00–18:00 besetzt.',
        ['live', 'verwaltung'],
      ),
    ];
    Object.assign(spot, {
      name: 'Inselbahnhof Wangerooge',
      district: 'Dorf',
      category: 'bahnhof',
      tags: Array.from(
        new Set([
          ...(spot.tags || []),
          'bahnhof',
          'must_have',
          'transport',
          'barrierefreiheit',
          'inselbahn',
          'sourced_gemini',
        ]),
      ),
      bullets,
      facts: {
        origin:
          'Als autofreie Insel ist die Schmalspur-Inselbahn das logistische Monopol — der Bahnhof der Flaschenhals für Menschen, Fracht und Gepäck.',
        architecture:
          'Barrierefrei zertifiziert (PA-13509-2023): stufenlos, abgesenkte Schalter, normgerechtes WC.',
        now: 'Fahrkarten, Gepäckausgabe, Tourist-Info; Hauszustellung für West-Gäste Pflicht.',
        tags: ['bahnhof', 'must_have', 'transport', 'barrierefreiheit'],
      },
      approach_triggers: approaches,
      sub_pois: [
        {
          id: `${id}_sub_gepaeck`,
          name: 'Gepäckausgabe Vorplatz',
          ...offsetMeters(c.lat, c.lng, -15, 5),
          radius_m: 14,
          fact_details:
            'Zentrale Gepäckausgabe: Hier kommen die roten Container-Gepäckstücke von Harlesiel an. West-Gäste brauchen Hauszustellung.',
          tags: ['sub_poi', 'gepaeck', 'transport'],
        },
        {
          id: `${id}_sub_info`,
          name: 'Tourist-Info / Schalter',
          lat: approaches[2].lat,
          lng: approaches[2].lng,
          radius_m: 8,
          fact_details:
            'Tourist-Info und Fahrkartenschalter — stufenlos, Tresenhöhe 90 cm (Zertifikat PA-13509-2023).',
          tags: ['sub_poi', 'barrierefreiheit'],
        },
      ],
    });
    syncTriggerFromSpot(
      pack,
      spot,
      'Der Inselbahnhof ist die Lebensader Wangerooges: Schmalspurbahn, Gepäck und Tourist-Info unter einem Dach.',
      deepPool,
    );
  }

  // ─── 6) Enrich Fähranleger with logistics (Harlesiel chain) ─────────
  {
    const spot = pack.spots.find((s) => /fähranleger|anleger/i.test(s.name));
    if (spot) {
      const extra = [
        'Autofrei: PKW bleiben in Harlesiel (Parken ca. 7 €/angefangener Tag).',
        'Nur Handgepäck an Bord (max. 2 Stück, 50×40×25 cm). Großgepäck (max. 25 kg) in rote Container in Harlesiel — parallel per Schiff + Inselbahn zum Bahnhofsvorplatz.',
        'Fähre Erw. ca. 43–46 € Hin/Rück; Kind 6–14 ca. 26–28 €; Hund ca. 28 €. Watt Sprinter Erw. 77 €. Gepäckstück ca. 9,50 € Hin/Rück; Hauszustellung ca. 19,50 €; Fahrrad/Golf ca. 30 €.',
        'Inselshuttle Elektrokarren ab ca. 16 € bis 4 Personen (zzgl. 2 €/Gepäck). Watt Sprinter nicht barrierefrei; MS Harlingerland/Wangerooge schon.',
      ];
      spot.bullets = Array.from(new Set([...(spot.bullets || []), ...extra]));
      spot.tags = Array.from(
        new Set([...(spot.tags || []), 'transport', 'gepaeck', 'sourced_gemini']),
      );
      spot.facts = {
        ...(spot.facts || {}),
        now: 'Tideabhängige Fährlogistik Harlesiel↔Wangerooge; strikte Gepäckregeln und Inselbahn-Anschluss.',
        tags: Array.from(
          new Set([...(spot.facts?.tags || []), 'transport', 'gepaeck']),
        ),
      };
      const tp = (pack.trigger_points || []).find((t) => t.id === spot.id);
      if (tp) {
        tp.deep_data_pool = [
          ...(tp.deep_data_pool || []),
          deep(
            'Parken Harlesiel ca. 7 €/Tag. Handgepäck-Limit an Bord; Großgepäck Container→Bahnhof. Preise Stand Recherche: Fähre Erw. 43–46 €, Watt Sprinter 77 €, Gepäck 9,50 €, Hauszustellung 19,50 €.',
            ['transport', 'preise', 'gepaeck'],
          ),
          deep(
            'Fahrplan diktiert von Gezeiten (bis ca. 6 Abfahrten/Tag Hauptsaison) — kein klassischer Verbundfahrplan.',
            ['transport', 'tide'],
          ),
        ];
        tp.general_info =
          tp.general_info ||
          'Fähranleger Wangerooge: tideabhängiger Anschluss an Harlesiel und Start der Inselbahn-Logistik.';
      }
    }
  }

  // ─── 7) Enrich Gerken / Fischerstube / Diggers ─────────────────────
  {
    const gerken = pack.spots.find((s) => /gerken/i.test(s.name));
    if (gerken) {
      gerken.bullets = Array.from(
        new Set([
          ...(gerken.bullets || []),
          'Obere Strandpromenade 21: Frühstücksbüfett 27 € (u. a. Fischsalate, Matjes, Pancakes, Brot von Inselbäckerei Kruse, glutenfrei).',
          'Abendbüfett ab 17:30 ca. 38 € regionale Küche; auch für Nicht-Hotelgäste. Lounge/Bar bis 01:00.',
        ]),
      );
      gerken.tags = Array.from(
        new Set([...(gerken.tags || []), 'restaurant', 'hotel', 'sourced_gemini']),
      );
    }
    const fisch = pack.spots.find((s) => /^Fischerstube$/i.test(s.name));
    if (fisch) {
      fisch.bullets = Array.from(
        new Set([
          ...(fisch.bullets || []),
          'Im Strandhotel Gerken: Kibbelinge, Fischbrötchen, Bubblewaffeln; „Bier der Inselbrauerei“; Online-Abholservice.',
        ]),
      );
      fisch.tags = Array.from(
        new Set([...(fisch.tags || []), 'fisch', 'fischrestaurant', 'sourced_gemini']),
      );
    }
    const digger = pack.spots.find((s) => /digger/i.test(s.name));
    if (digger) {
      digger.bullets = Array.from(
        new Set([
          ...(digger.bullets || []),
          'Obere Strandpromenade 3: Surf-Ästhetik, Palettenmöbel, eigener Gin, Cocktails. Ableger „Digger’s Außenposten“ ~50 m: Happy Hour, Schirmbar Meerblick.',
        ]),
      );
      digger.tags = Array.from(
        new Set([...(digger.tags || []), 'bar', 'cafe', 'sourced_gemini']),
      );
    }
  }

  // ─── 8) New spots from Gemini (approx coords near known anchors) ───
  const pudding = pack.spots.find((s) => s.id === 'wangerooge_cafe_pudding');
  const puddingC = centroid(pudding.polygonCoordinates);
  const neuerLt = pack.spots.find((s) => /neuer leuchtturm/i.test(s.name));
  const neuerC = neuerLt
    ? centroid(neuerLt.polygonCoordinates)
    : { lat: 53.7895, lng: 7.868 };

  const newSpots = [
    {
      id: 'wangerooge_hartmannstand_gedenken',
      name: 'Hartmannstand Gedenkkreuz',
      district: 'Nord',
      category: 'denkmal',
      // approx: dunes near north/west of village — offset from Pudding toward west dunes
      lat: offsetMeters(puddingC.lat, puddingC.lng, -80, -350).lat,
      lng: offsetMeters(puddingC.lat, puddingC.lng, -80, -350).lng,
      halfM: 25,
      tags: ['denkmal', 'geschichte', 'krieg', 'sourced_gemini'],
      bullets: [
        'Hartmannstand in den Dünen: holzernes Gedenkkreuz für 311 Menschen, die am 25. April 1945 bei einem alliierten Bombenangriff in einem Bunker getötet wurden — wenige Tage vor Kriegsende.',
      ],
      facts: {
        origin:
          'Am 25.04.1945 starben 311 Menschen bei einem Bombenangriff in einem Bunker am Hartmannstand.',
        now: 'Einfaches Holzkreuz in den Dünen erinnert an die Opfer.',
        tags: ['denkmal', 'geschichte', 'krieg'],
      },
      general:
        'Ein stilles Gedenken in den Dünen: 311 Opfer des Bombenangriffs vom 25. April 1945.',
      deep: [
        deep(
          '25. April 1945: alliierter Bombenangriff; 311 Tote in einem Bunker am Hartmannstand. Gedenkkreuz in den Dünen.',
          ['geschichte', 'krieg', 'denkmal'],
        ),
      ],
      approaches: [
        {
          dist: 40,
          bearing: 90,
          r: 18,
          teaser:
            'In den Dünen am Hartmannstand steht ein einfaches Holzkreuz — Gedenken an 311 Menschen, die hier 1945 ums Leben kamen.',
        },
      ],
    },
    {
      id: 'wangerooge_st_willehad',
      name: 'St.-Willehad-Kirche',
      district: 'Dorf',
      category: 'kirche',
      lat: offsetMeters(53.7902, 7.8995, -40, -80).lat,
      lng: offsetMeters(53.7902, 7.8995, -40, -80).lng,
      halfM: 22,
      tags: ['kirche', 'sourced_gemini'],
      bullets: [
        'Adresse: Westingstraße 7, 26486 Wangerooge — katholische Kirche der Insel (neben der evangelischen Nikolaikirche am Dorfplatz).',
      ],
      facts: {
        origin: 'Katholische St.-Willehad-Kirche, Westingstraße 7.',
        now: 'Eines der beiden prägenden Sakralbauten im Inseldorf.',
        tags: ['kirche'],
      },
      general:
        'Die katholische St.-Willehad-Kirche in der Westingstraße ergänzt die evangelische Nikolaikirche am Dorfplatz.',
      deep: [
        deep(
          'Sakralbauten der Insel: evangelische Nikolaikirche (Am Dorfplatz 34) und katholische St.-Willehad (Westingstraße 7).',
          ['kirche', 'geschichte'],
        ),
      ],
      approaches: [
        {
          dist: 30,
          bearing: 180,
          r: 16,
          teaser:
            'Vor dir: St.-Willehad, die katholische Kirche Wangerooges in der Westingstraße.',
        },
      ],
    },
    {
      id: 'wangerooge_golfclub',
      name: 'Golfclub Insel Wangerooge',
      district: 'Ost',
      category: 'freizeit',
      lat: offsetMeters(53.7902, 7.8995, -200, 600).lat,
      lng: offsetMeters(53.7902, 7.8995, -200, 600).lng,
      halfM: 40,
      tags: ['freizeit', 'golf', 'sourced_gemini'],
      bullets: [
        'Adresse: Jadehörn 17 — Golfclub Insel Wangerooge e.V., gegründet 2007.',
        '9-Loch-Platz architektonisch direkt in den Inselflugplatz integriert — bundesweit einmalige Überlagerung von Luftfahrt und Golfsport.',
      ],
      facts: {
        origin: 'Golfclub seit 2007; 9-Loch am Inselflugplatz Jadehörn 17.',
        now: 'Einzigartig in DE: Golfplatz und Flugplatz auf demselben Gelände.',
        tags: ['freizeit', 'golf'],
      },
      general:
        'Auf Wangerooge teilen sich Golf und Flugplatz dasselbe Gelände — ein bundesweit einmaliges Konzept.',
      deep: [
        deep(
          'Golfclub Insel Wangerooge e.V. (2007): 9 Löcher am Jadehörn 17, integriert in den Inselflugplatz.',
          ['freizeit', 'golf'],
        ),
      ],
      approaches: [
        {
          dist: 60,
          bearing: 270,
          r: 28,
          teaser:
            'Hier überlagern sich Golfgrün und Flugplatz — der 9-Loch-Platz des Golfclubs Insel Wangerooge.',
        },
      ],
    },
    {
      id: 'wangerooge_diggers_aussenposten',
      name: "Digger's Außenposten",
      district: 'Nord',
      category: 'cafe',
      lat: offsetMeters(puddingC.lat, puddingC.lng, -20, 50).lat,
      lng: offsetMeters(puddingC.lat, puddingC.lng, -20, 50).lng,
      halfM: 18,
      tags: ['cafe', 'bar', 'sourced_gemini'],
      bullets: [
        'Ableger von Digger’s Strandbar (~50 m entfernt an der Promenade): Happy Hour, Schirmbar mit Meerblick.',
      ],
      facts: {
        origin: 'Outdoor-Ableger der Digger’s Strandbar an der Promenade.',
        now: 'Happy Hour und Schirmbar mit Meerblick.',
        tags: ['cafe', 'bar'],
      },
      general: 'Digger’s Außenposten: Outdoor-Party und Happy Hour unter Schirmen mit Meerblick.',
      deep: [
        deep(
          'Digger’s Außenposten ca. 50 m von der Strandbar: Happy Hour, Schirmbar, Meerblick.',
          ['cafe', 'bar'],
        ),
      ],
      approaches: [
        {
          dist: 25,
          bearing: 180,
          r: 14,
          teaser:
            'Gleich voraus: Digger’s Außenposten — Schirmbar und Happy Hour mit Meerblick.',
        },
      ],
    },
    {
      id: 'wangerooge_fundamente_alter_westturm',
      name: 'Fundamente Alter Westturm (Ebbe)',
      district: 'West',
      category: 'denkmal',
      lat: offsetMeters(neuerC.lat, neuerC.lng, -80, -40).lat,
      lng: offsetMeters(neuerC.lat, neuerC.lng, -80, -40).lng,
      halfM: 30,
      tags: ['denkmal', 'geschichte', 'ebbe', 'natur', 'sourced_gemini'],
      bullets: [
        'Bei Ebbe am Strand westlich unterhalb des Neuen Leuchtturms: Fundamentsteine des 1914 gesprengten Alten Westturms (1597–1602) — maritimer Lost Place.',
      ],
      facts: {
        origin:
          'Überreste des Alten Westturms (1597–1602), 1914 gesprengt; nur bei Ebbe sichtbar.',
        now: 'Lost Place am Weststrand unterhalb des Neuen Leuchtturms — tideabhängig.',
        tags: ['denkmal', 'geschichte', 'ebbe'],
      },
      general:
        'Nur bei Ebbe sichtbar: die Fundamente des historischen Westturms von 1602 unterhalb des Neuen Leuchtturms.',
      deep: [
        deep(
          'Original-Westturm stand ~900 m südsüdöstlich des heutigen Westturms; Fundamente bei Ebbe unterhalb Neuer Leuchtturm.',
          ['geschichte', 'ebbe', 'denkmal'],
        ),
      ],
      approaches: [
        {
          dist: 40,
          bearing: 0,
          r: 20,
          teaser:
            'Bei Ebbe kannst du hier die Fundamentsteine des alten Westturms von 1602 entdecken — 1914 gesprengt.',
        },
      ],
    },
  ];

  for (const ns of newSpots) {
    if (pack.spots.some((s) => s.id === ns.id)) continue;
    const poly = boxPolygon(ns.lat, ns.lng, ns.halfM);
    const approaches = (ns.approaches || []).map((a, i) =>
      approachAt(
        ns.lat,
        ns.lng,
        a.dist,
        a.bearing,
        a.r,
        `${ns.id}_approach_${i + 1}`,
        a.teaser,
      ),
    );
    const spot = {
      id: ns.id,
      name: ns.name,
      district: ns.district,
      category: ns.category,
      tags: ns.tags,
      bullets: ns.bullets,
      facts: ns.facts,
      polygonCoordinates: poly,
      approach_triggers: approaches,
      sub_pois: [],
    };
    pack.spots.push(spot);
    syncTriggerFromSpot(pack, spot, ns.general, ns.deep);
  }

  // ─── 9) Island system narrative on Kurverwaltung / Hauptstrand ─────
  {
    const kur = pack.spots.find((s) => /kurverwaltung|erholung ist eine/i.test(s.name));
    if (kur) {
      const extras = [
        'Sicherheit: Polizei Charlottenstraße 9, Tel. 04469-94690-0 (Notruf 110). Kein Krankenhaus — Ärzte: Dr. Kortenhorn Robbenstraße 12 (04469-1700, Rufweiterleitung); Dr. Goltz Nikolausstraße 4–6 (04469-9469963). Rettung 112 (Heli/Seenot).',
        'Insel-Apotheke Zedeliusstraße 31 (04469-1435). DRK-Strandwache Badesaison Mitte Mai–Mitte Oktober. Fundbüro Kurverwaltung Obere Strandpromenade 3, Mo–Fr 10–12 (04469-99164).',
        'WLAN: #free_inselwlan (Werbeclip, Tagesauth); Vodafone ~240 Hotspots; Freifunk 8 Knoten. LzO SB-Filiale Zedeliusstraße 34, 06–23 Uhr, barrierefrei.',
        'Dünen abseits der Wege betreten verboten (Erosion). Strandbuggys (Ballonreifen) kostenfrei an der Pudding-Uhr (solar). Viele Strandabgänge barrierefrei.',
      ];
      kur.bullets = Array.from(new Set([...(kur.bullets || []), ...extras]));
      kur.tags = Array.from(
        new Set([...(kur.tags || []), 'verwaltung', 'barrierefreiheit', 'sourced_gemini']),
      );
      const tp = (pack.trigger_points || []).find((t) => t.id === kur.id);
      if (tp) {
        tp.deep_data_pool = [
          ...(tp.deep_data_pool || []),
          ...extras.map((t) => deep(t, ['live', 'infrastruktur'])),
        ];
      }
    }
  }

  pack.data_version = 5;
  pack._build = {
    ...(pack._build || {}),
    gemini_enrichment: {
      at: new Date().toISOString(),
      source: 'Regionalhistorischer Master-Report Gemini',
      master_spots: 5,
      new_spots: newSpots.map((s) => s.id),
      notes: [
        'Approach-Lagerungen approximiert entlang Sichtachsen; exakte Peilungen ggf. nachmessen.',
        'Westturm-Adresse Gemini „Im Westen 38“ vs Google „Str. Zum Westen 27“ — Koordinaten unverändert Places.',
        'Hartmannstand/Golf/Willehad/Fundamente: Koordinaten geschätzt — Gemini-Nachschärfung empfohlen.',
        'Harlesiel-Trigger noch nicht als eigener Mainland-Spot; Logistik am Fähranleger+Bahnhof verdichtet.',
        'Preise/Öffnungszeiten Stand Gemini-Recherche — saisonal verifizieren.',
      ],
    },
  };

  fs.writeFileSync(PACK_PATH, JSON.stringify(pack, null, 2));
  const v = validateCityPack(pack);
  const geo = pack.spots.filter(
    (s) => s.polygonCoordinates?.length && s.approach_triggers?.length,
  ).length;
  console.log(
    JSON.stringify(
      {
        spots: pack.spots.length,
        version: pack.data_version,
        geo,
        approaches: pack.spots.reduce(
          (n, s) => n + (s.approach_triggers || []).length,
          0,
        ),
        subs: pack.spots.reduce((n, s) => n + (s.sub_pois || []).length, 0),
        validate: v,
      },
      null,
      2,
    ),
  );
}

main();
