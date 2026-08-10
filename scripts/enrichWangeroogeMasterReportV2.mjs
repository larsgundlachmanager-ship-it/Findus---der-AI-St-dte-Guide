#!/usr/bin/env node
/**
 * Embed Gemini master-report narratives nearly 1:1 into Wangerooge pack.
 * Preserves existing FAQ entries; upgrades bullets/facts/approaches/deep_data.
 * Bumps data_version → 12.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCityPack } from './geo/validatePack.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACK = path.join(ROOT, 'data/staedte/wangerooge.json');
const INDEX = path.join(ROOT, 'data/staedte/index.json');
const VERSION = 12;

function deep(text, tags) {
  return { text: String(text).trim(), tags: tags || ['master_report'] };
}

function pushUnique(pool, entry) {
  const key = entry.text.toLowerCase().slice(0, 120);
  if (pool.some((e) => String(e.text || '').toLowerCase().slice(0, 120) === key)) {
    return false;
  }
  pool.push(entry);
  return true;
}

function keepFaqs(pool) {
  return (pool || []).filter(
    (e) =>
      Array.isArray(e?.tags) &&
      e.tags.map(String).map((t) => t.toLowerCase()).includes('faq'),
  );
}

function setNonFaqPool(tp, entries) {
  const faqs = keepFaqs(tp.deep_data_pool);
  tp.deep_data_pool = [...entries, ...faqs];
}

function patchApproaches(spot, teasersByRadius) {
  if (!Array.isArray(spot.approach_triggers)) return;
  for (const a of spot.approach_triggers) {
    const r = a.radius_m ?? a.radiusMeters;
    // match nearest defined radius
    let best = null;
    let bestDiff = Infinity;
    for (const [rr, text] of Object.entries(teasersByRadius)) {
      const d = Math.abs(Number(rr) - Number(r));
      if (d < bestDiff) {
        bestDiff = d;
        best = text;
      }
    }
    if (best && bestDiff <= 30) a.teaser_text = best;
  }
}

const pack = JSON.parse(fs.readFileSync(PACK, 'utf8'));
const byId = (id) => pack.spots.find((s) => s.id === id);
const tpById = (id) => pack.trigger_points.find((t) => t.id === id);

// ─── 1) Alter Leuchtturm ─────────────────────────────────────────────
{
  const spot = byId('wangerooge_inselmuseum_alter_leuchtturm');
  const tp = tpById(spot.id);
  spot.bullets = [
    'Adresse: Zedeliusstraße 3, 26486 Wangerooge.',
    'Der Alte Leuchtturm ist das architektonische und historische Manifest des Wiederaufbaus der Insel nach der Neujahrsflut 1854/1855.',
    'Bei der Flut wurde das westliche Inseldorf fast nivelliert: 21 von 75 Wohnhäusern restlos zerstört; Inselmasse schrumpfte auf kritische 175 Hektar; acht Wochen Isolierung durch Treibeis.',
    'Juni 1855: Regierungsbeschluss zur Aufgabe der Insel — 82 Insulaner verweigerten die staatlich geförderte Umsiedlung und gründeten ab 1865 das neue Dorf im Osten exakt um diesen Turm.',
    '37 m hoher Steinturm (Entwurf oldenburgischer Baurat Lasius), Bau ab 1855, drei Jahre Bauzeit; grauer Zementputz; auf 7 m Höhe kreisförmige Wärterwohnung.',
    'Lichtquelle anfangs Argandlampe mit Rüböl; entzündet am 2. Oktober 1856; gelöscht am 7. November 1969 zugunsten des neuen Leuchtturms.',
    'Seit 1968 Heimatmuseum (Gemeindebesitz); ehemalige Laterne = Aussichtsplattform. Seit 15. März 1996 Standesamt. Exakt 146 Stufen, kein Aufzug (Denkmalschutz).',
    'Am Fuß des Turms: letzte Wangerooger Schmalspur-Dampflokomotive als Denkmal (seit 1968) — sie fährt nicht mehr, sie erinnert an die mechanisierte Frühphase der Inselbahn. Kontakt Kurverwaltung Tel. 04469-8432.',
  ];
  spot.facts = {
    origin:
      'Der Alte Leuchtturm ist das architektonische und historische Manifest des Wiederaufbaus: Nach der Neujahrsflut 1854/1855 und dem staatlichen Aufgabebeschluss gründeten 82 Insulaner ab 1865 das neue Ostdorf um diesen Turm.',
    architecture:
      '37 m Steinturm, Entwurf Baurat Lasius, grauer Zementputz, Wärterwohnung auf 7 m; Argandlampe/Rüböl ab 2.10.1856 bis 7.11.1969.',
    now: 'Heimatmuseum seit 1968, Standesamt seit 15.03.1996, 146 Stufen zur Laterne; Dampflok-Denkmal am Fuß (kein Betrieb). Kurverwaltung 04469-8432.',
    tags: ['museum', 'must_have', 'geschichte', 'aussicht', 'standesamt', 'master_report'],
  };
  patchApproaches(spot, {
    150: 'Über den Dächern der Fußgängerzone erhebt sich die markante, graue Zementputz-Fassade des Alten Leuchtturms. Dieses Bauwerk ist mehr als ein maritimes Seezeichen; es ist der architektonische Nukleus des heutigen Inseldorfes, das nach der Flut 1855 hier gegründet wurde.',
    42: 'Über den Dächern der Fußgängerzone erhebt sich die markante, graue Zementputz-Fassade des Alten Leuchtturms. Dieses Bauwerk ist mehr als ein maritimes Seezeichen; es ist der architektonische Nukleus des heutigen Inseldorfes, das nach der Flut 1855 hier gegründet wurde.',
    20: 'Erinnerst du dich an die zerstörerischen Kräfte der Neujahrsflut, von der wir sprachen? Genau hier, im Schatten des 1855 erbauten Turms, bauten 82 hartnäckige Insulaner ein neues Leben auf. Beachte zur Rechten die historische Schmalspur-Dampflok, die seit 1968 hier an die mechanisierte Frühphase der Inselbahn erinnert — sie ist Denkmal, kein fahrender Zug.',
    14: 'Erinnerst du dich an die zerstörerischen Kräfte der Neujahrsflut, von der wir sprachen? Genau hier, im Schatten des 1855 erbauten Turms, bauten 82 hartnäckige Insulaner ein neues Leben auf. Beachte zur Rechten die historische Schmalspur-Dampflok, die seit 1968 hier an die mechanisierte Frühphase der Inselbahn erinnert — sie ist Denkmal, kein fahrender Zug.',
    5: 'Du stehst nun vor dem Portal. Der Turm misst 37 Meter. Wenn du die Aussichtsplattform in der alten Laterne genießen oder hier gar heiraten möchtest, bereite dich auf einen steilen Aufstieg über exakt 146 historische Stufen vor. Einen Aufzug gibt es aus Denkmalschutzgründen nicht.',
    8: 'Du stehst nun vor dem Portal. Der Turm misst 37 Meter. Wenn du die Aussichtsplattform in der alten Laterne genießen oder hier gar heiraten möchtest, bereite dich auf einen steilen Aufstieg über exakt 146 historische Stufen vor. Einen Aufzug gibt es aus Denkmalschutzgründen nicht.',
  });
  for (const sub of spot.sub_pois || []) {
    if (/Dampflok/i.test(sub.name)) {
      sub.fact_details =
        'Letzte Wangerooger Schmalspur-Dampflokomotive als Denkmal seit 1968 am Fuß des Alten Leuchtturms. Sie fährt nicht — sie erinnert an die mechanisierte Frühphase der Inselbahn, deren heutiger Betrieb modernisiert ist.';
    }
    if (/Portal/i.test(sub.name)) {
      sub.fact_details =
        'Portal des Alten Leuchtturms: 37 m, 146 Stufen zur Aussichtsplattform in der alten Laterne — kein Aufzug (Denkmalschutz). Seit 15.03.1996 Standesamt; Trauungen und Museumsbesuche über Kurverwaltung 04469-8432.';
    }
  }
  setNonFaqPool(tp, [
    deep(
      'Historische Kausalität: Der Alte Leuchtturm ist das architektonische und historische Manifest des Wiederaufbaus der Insel. Seine Entstehung ist kausal an die verheerende Neujahrsflut von 1854/1855 geknüpft. Bei dieser Flut wurde das ursprüngliche westliche Inseldorf fast vollständig nivelliert, 21 von 75 Wohnhäusern wurden restlos zerstört, und die Inselmasse schrumpfte auf kritische 175 Hektar. Acht Wochen lang war die Insel durch massives Treibeis vom Festland isoliert, was die Regierung im Juni 1855 zu dem Beschluss veranlasste, die Insel offiziell aufzugeben. Exakt 82 Insulaner verweigerten jedoch die staatlich geförderte Umsiedlung und gründeten ab 1865 ein neues Dorf im geschützteren Osten der Insel — exakt um diesen Turm herum.',
      ['geschichte', 'sturmflut', 'must_have', 'master_report', 'erzaehlung'],
    ),
    deep(
      'Bau und Licht: Das 37 Meter hohe Bauwerk wurde nach einem Entwurf des oldenburgischen Baurats Lasius ab 1855 in einer dreijährigen Bauzeit errichtet. Massiver Steinturm mit grauem Zementputz; auf 7 Metern Höhe kreisförmig angelegte Wärterwohnung. Die Lichtquelle, anfangs eine Argandlampe mit Rübölbetrieb, wurde am 2. Oktober 1856 entzündet und leistete bis zum 7. November 1969 Dienst, bevor sie zugunsten des neuen Leuchtturms gelöscht wurde.',
      ['architecture', 'geschichte', 'master_report'],
    ),
    deep(
      'Live heute: Gebäude im Besitz der Gemeinde Wangerooge. Zugang zur Aussichtsplattform: exakt 146 Stufen — auch für Hochzeitsgesellschaften, denn der Turm ist seit dem 15. März 1996 offiziell Standesamt. Kein Aufzug aus Denkmalschutzgründen. Im direkten Außenbereich am Fuß des Turms steht die letzte Wangerooger Dampflokomotive als Denkmal (seit 1968) — sie fährt nicht, sie erinnert an die Frühphase der Inselbahn. Kontakt Trauungen/Museum: Kurverwaltung Tel. 04469-8432.',
      ['live', 'standesamt', 'denkmal', 'inselbahn', 'master_report'],
    ),
  ]);
  tp.general_info =
    'Der Alte Leuchtturm ist Nukleus und Manifest des Insel-Wiederaufbaus nach 1855 — Museum, Standesamt, Dampflok-Denkmal am Fuß.';
}

// ─── 2) Westturm ─────────────────────────────────────────────────────
{
  const spot = byId('wangerooge_westturm');
  const tp = tpById(spot.id);
  spot.bullets = [
    'Offizielle Adresse: Im Westen 38, 26486 Wangerooge (DJH/Post). Maps navigiert teils über „Straße zum Westen“ — postalisch nicht der Turm.',
    'Der markante rotbraune Backsteinturm mit seinen charakteristischen drei Spitzen ist das unverkennbare Wahrzeichen Wangerooges.',
    'Heutiger Turm 56 m hoch, erbaut 1932–1933 auf 124 Eisenbetonpfählen (je 6 m lang, 30 cm stark). Historisierender Nachbau.',
    'Originaler Alter Westturm 1597–1602 stand ca. 900 m weiter südsüdöstlich: Landmarke, Kirche, Gefängnis, Strandgut-Lager und Zufluchtsort bei Sturmfluten. Drei Spitzen = Peilhilfe Nord–Süd für die Schifffahrt.',
    '1914 wurde der historische Turm aus kriegstaktischen Gründen gesprengt; Fundamentsteine bei Ebbe am Weststrand unterhalb des Neuen Leuchtturms sichtbar (Spot Fundamente).',
    'Nach Fertigstellung 1933 von der nationalsozialistischen Führung annektiert und als Herberge der Hitlerjugend zweckentfremdet.',
    'Heute DJH-Jugendherberge: 2005 Anbau, insgesamt 168 Betten. Innenraum bis 7. Etage nur für Hausgäste. DJH-Fahrradverleih Tel. 04469-439.',
    'DJH-Bistro Westturm: täglich 11:00–17:00 Snacks/Getränke auch für Spaziergänger auf der Sonnenterrasse.',
  ];
  spot.facts = {
    origin:
      'Der markante rotbraune Backsteinturm mit drei Spitzen ist das unverkennbare Wahrzeichen: 1932/33 Nachbau des 1914 gesprengten Turms von 1597–1602 (~900 m SSE der heutigen Position), einst Kirche, Gefängnis, Strandgutlager und Sturmflut-Zuflucht.',
    architecture:
      '56 m, rotbrauner Backstein, drei Spitzen (historisch Peilhilfe N–S), Fundament auf 124 Eisenbetonpfählen. Adresse Im Westen 38.',
    now: 'DJH-Herberge (168 Betten, Innen nur Hausgäste); Bistro 11–17 für Spaziergänger; Fahrradverleih 04469-439. 1933 kurzzeitig HJ-Herberge.',
    tags: ['aussicht', 'must_have', 'djh', 'geschichte', 'master_report'],
  };
  patchApproaches(spot, {
    200: 'Vor dir in der Dünenlandschaft erhebt sich massiv das 56 Meter hohe Wahrzeichen der Insel: Der Westturm. Der markante rotbraune Backsteinturm mit seinen charakteristischen drei Spitzen war einst überlebenswichtig für die Peilung der Handelsschiffe in der Nordsee.',
    48: 'Vor dir in der Dünenlandschaft erhebt sich massiv das 56 Meter hohe Wahrzeichen der Insel: Der Westturm. Der markante rotbraune Backsteinturm mit seinen charakteristischen drei Spitzen war einst überlebenswichtig für die Peilung der Handelsschiffe in der Nordsee.',
    50: 'Der Backsteinbau, auf den du zugehst, stammt aus den Jahren 1932/33. Der Originalturm aus der Zeit um 1602 stand etwa 900 Meter von hier entfernt. Erinnerst du dich an den Verlust des alten Inseldorfes? Dieser historische Turm bot damals den einzigen Schutz vor dem Ertrinken, bis er 1914 gesprengt wurde.',
    22: 'Der Backsteinbau, auf den du zugehst, stammt aus den Jahren 1932/33. Der Originalturm aus der Zeit um 1602 stand etwa 900 Meter von hier entfernt. Erinnerst du dich an den Verlust des alten Inseldorfes? Dieser historische Turm bot damals den einzigen Schutz vor dem Ertrinken, bis er 1914 gesprengt wurde.',
    10: 'Du stehst nun vor dem achteckigen Bau, der auf 124 Eisenbetonpfählen ruht. Der Turm selbst ist heute eine Jugendherberge mit 168 Betten und für Tagesgäste im Inneren nicht zugänglich, bietet von außen aber ein exzellentes Motiv für Architekturfotografien. Das DJH-Bistro lädt Spaziergänger tagsüber ein.',
  });
  setNonFaqPool(tp, [
    deep(
      'Wahrzeichen: Der markante rotbraune Backsteinturm mit seinen charakteristischen drei Spitzen ist das unverkennbare Wahrzeichen Wangerooges. Das heutige 56 Meter hohe Bauwerk wurde 1932–1933 auf einem massiven Fundament von 124 sechs Meter langen und 30 Zentimeter starken Eisenbetonpfählen errichtet — ein historisierender Nachbau.',
      ['architecture', 'must_have', 'master_report', 'erzaehlung'],
    ),
    deep(
      'Originalturm 1597–1602 stand etwa 900 Meter weiter südsüdöstlich und war multifunktional: Seezeichen/Landmarke, Kirche, Gefängnis, Lager für Strandgut und vor allem lebensrettender Zufluchtsort bei schweren Sturmfluten. Die drei Turmspitzen dienten in genauer Nord-Süd-Richtung als Peilhilfe für die Navigation. 1914 aus kriegstaktischen Gründen gesprengt; Überreste (Fundamentsteine) bei Ebbe am Strand im Westen unterhalb des Neuen Leuchtturms sichtbar.',
      ['geschichte', 'must_have', 'master_report', 'tide'],
    ),
    deep(
      'Nach Fertigstellung wurde der Nachbau von 1933 unmittelbar von der nationalsozialistischen Führung annektiert und als Herberge für die Hitlerjugend zweckentfremdet. Heute: DJH-Jugendherberge, 2005 Anbau, 168 Betten; Innenraum für Tagesgäste gesperrt. DJH-Fahrradverleih Tel. 04469-439. Offizielle Adresse Im Westen 38.',
      ['geschichte', 'live', 'djh', 'master_report'],
    ),
  ]);
  tp.general_info =
    'Rotbrauner Westturm mit drei Spitzen — Wahrzeichen, DJH-Herberge, Nachbau des 1914 gesprengten Turms von 1602.';
}

// ─── 3) Café Pudding ─────────────────────────────────────────────────
{
  const spot = byId('wangerooge_cafe_pudding');
  const tp = tpById(spot.id);
  spot.bullets = [
    'Adresse: Zedeliusstraße (Übergang zur Oberen Strandpromenade), 26486 Wangerooge.',
    'Herausragendes Beispiel architektonischer Umnutzung: runder Bau auf der Promenadendüne umschließt einen massiven Wehrmachtsbunker aus dem Zweiten Weltkrieg.',
    'Nach dem Krieg galt der Betonklotz als landschaftlicher „Schandfleck“. 1948 erwarb Familie Folkerts eine Eisbereitungsmaschine und verkaufte Eis/Kuchen aus dem nackten Bunker.',
    'Winter 1948/49 Ausbau; offizielle Eröffnung als Café Pudding am 4. Juni 1949. Name von „um den Pudding gehen“ = die Düne umrunden (kein Dessert-Bezug).',
    'Erweiterungen: 1971/72 festes Dach statt Dachterrasse, Umbau im 4-m-Umkreis; 1999 und 2009 Sonnenterrassen nach Südosten. Heute 4. Generation: Thorn Folkerts.',
    'Di–So 11:00–21:30, Abendkarte 17:30–20:30; Montag strikter Ruhetag. Eigene Eisherstellung & Konditorei, 360°-Rundumblick.',
    'Historisch getrennt vom Mahnmal Hartmannsstand (311 Tote 25.04.1945) — anderer Bunker, andere Geschichte.',
  ];
  spot.facts = {
    origin:
      'Café Pudding: zivile Umnutzung eines Wehrmachtsbunkers. 1948 Folkerts mit Eis aus dem nackten „Schandfleck“-Bunker; Eröffnung 4. Juni 1949. Name: „um den Pudding gehen“.',
    architecture:
      'Runder Bau umschließt den Bunker; Erweiterungen 1971/72, Terrassen 1999 und 2009.',
    now: '4. Generation Thorn Folkerts; Eis & Konditorei, Abendkarte; Mo Ruhetag; 360°-Aussicht.',
    tags: ['cafe', 'must_have', 'aussicht', 'geschichte', 'master_report'],
  };
  patchApproaches(spot, {
    100: 'Am Ende der Fußgängerzone, dort wo die Insel scheinbar ins Meer abbricht, siehst du einen markanten, runden Bau auf der Düne thronen. Das ist das legendäre Café Pudding.',
    36: 'Am Ende der Fußgängerzone, dort wo die Insel scheinbar ins Meer abbricht, siehst du einen markanten, runden Bau auf der Düne thronen. Das ist das legendäre Café Pudding.',
    20: 'Kaum zu glauben, aber dieses helle, einladende Stück Inselarchitektur verbirgt in seinem Kern einen massiven Weltkriegsbunker. Nach dem Krieg galt er als Schandfleck — 1949 machte die Familie Folkerts daraus ein Symbol der zivilen Erholung. (Nicht verwechseln mit dem Hartmannsstand-Mahnmal 1945.)',
    14: 'Kaum zu glauben, aber dieses helle, einladende Stück Inselarchitektur verbirgt in seinem Kern einen massiven Weltkriegsbunker. Nach dem Krieg galt er als Schandfleck — 1949 machte die Familie Folkerts daraus ein Symbol der zivilen Erholung. (Nicht verwechseln mit dem Hartmannsstand-Mahnmal 1945.)',
    5: 'Hier beginnt der „Pudding“. Ob für hausgemachtes Eis oder ostfriesischen Tee — die Aussicht von dieser Düne auf die rollenden Wellen des Wattenmeers ist unvergleichlich. Beachte, dass montags Ruhetag herrscht. Führung heute: Thorn Folkerts, vierte Generation.',
    8: 'Hier beginnt der „Pudding“. Ob für hausgemachtes Eis oder ostfriesischen Tee — die Aussicht von dieser Düne auf die rollenden Wellen des Wattenmeers ist unvergleichlich. Beachte, dass montags Ruhetag herrscht. Führung heute: Thorn Folkerts, vierte Generation.',
  });
  setNonFaqPool(tp, [
    deep(
      'Geschichte: Das Café Pudding ist ein herausragendes Beispiel für architektonische Umnutzung und die zivile Transformation militärischer Hinterlassenschaften. Das runde Gebäude thront direkt auf einer Promenadendüne und umschließt architektonisch einen massiven Bunker der Wehrmacht. Nach dem Krieg galt der Betonklotz als massiver landschaftlicher „Schandfleck“. 1948 erwarb die Gründerfamilie Folkerts eine Eisbereitungsmaschine und begann, aus dem nackten Bunker heraus Eis und Kuchen zu verkaufen. Winter 1948/49 Ausbau; Eröffnung am 4. Juni 1949.',
      ['geschichte', 'cafe', 'ww2', 'master_report', 'erzaehlung'],
    ),
    deep(
      'Etymologie: Der Name leitet sich nicht von einer Süßspeise ab, sondern von der insularen Wegführung — die Düne zu umrunden und wieder zurückzukehren, wurde lokal als „um den Pudding gehen“ bezeichnet. Erweiterungen 1971/72, Terrassen 1999 und 2009. Betrieb heute in der vierten Generation von Thorn Folkerts.',
      ['geschichte', 'sprache', 'master_report'],
    ),
    deep(
      'Live: Spezialitätenkonditorei mit eigener Eisherstellung und Torten plus regionale warme Gerichte. Di–So 11:00–21:30; Abendkarte 17:30–20:30; Montag strikter Ruhetag. 360-Grad-Rundumblick über Meer und Promenade.',
      ['live', 'cafe', 'master_report'],
    ),
  ]);
}

// ─── 4) Rosenhaus ────────────────────────────────────────────────────
{
  const spot = byId('wangerooge_nationalpark_haus_wangerooge');
  const tp = tpById(spot.id);
  spot.bullets = [
    'Adresse: Friedrich-August-Straße 18, 26486 Wangerooge — Nationalpark-Haus „Rosenhaus“.',
    'Eduktives Epizentrum zum UNESCO-Weltnaturerbe Wattenmeer: Vogelzug, Küstenwandel, interaktive Stationen, Seewasser-Aquarium, Filmeraum.',
    'Im Garten: vollständiges Skelett eines gestrandeten Pottwals — Zeuge der marinen Megafauna vor dieser Küste.',
    'Stark unterstützt durch FÖJ (Freiwilliges Ökologisches Jahr): naturkundliche Führungen und Wattwanderungen.',
    'Ganzjährig kostenloser Eintritt; zertifiziert barrierefrei (rollstuhlgerecht, taktile Reize); Euro-Schlüssel-WC.',
    'Saison 15.03.–31.10.: Di–Fr 09–13 & 14–18; Sa/So/Feiertag 10–12 & 14–17; Montag Ruhetag.',
  ];
  patchApproaches(spot, {
    50: 'Vor dir liegt das ökologische Herz der Insel: Das Nationalpark-Haus „Rosenhaus“. Es beheimatet das gesammelte Wissen über das fragile UNESCO-Weltnaturerbe.',
    22: 'Vor dir liegt das ökologische Herz der Insel: Das Nationalpark-Haus „Rosenhaus“. Es beheimatet das gesammelte Wissen über das fragile UNESCO-Weltnaturerbe.',
    15: 'Wirf einen Blick durch den Zaun in den Garten — dort ruht das gewaltige Knochengerüst eines gestrandeten Pottwals. Ein stummer, aber mächtiger Zeuge der enormen Dimensionen der marinen Megafauna direkt vor dieser Küste.',
    12: 'Wirf einen Blick durch den Zaun in den Garten — dort ruht das gewaltige Knochengerüst eines gestrandeten Pottwals. Ein stummer, aber mächtiger Zeuge der enormen Dimensionen der marinen Megafauna direkt vor dieser Küste.',
    5: 'Der Eintritt in dieses Zentrum ist kostenfrei und die Architektur zu 100 % rollstuhlgerecht. Drinnen warten interaktive Aquarien und fundierte Analysen zum Vogelzug auf dich.',
    8: 'Der Eintritt in dieses Zentrum ist kostenfrei und die Architektur zu 100 % rollstuhlgerecht. Drinnen warten interaktive Aquarien und fundierte Analysen zum Vogelzug auf dich.',
  });
  setNonFaqPool(tp, [
    deep(
      'Das Rosenhaus fungiert als edukatives Epizentrum der Insel und widmet sich der ökologischen Komplexität des UNESCO-Weltnaturerbes Wattenmeer — insbesondere Vogelzug und Küstenwandel. Operativ stark durch FÖJ unterstützt: Führungen und Wattwanderungen.',
      ['natur', 'unesco', 'museum', 'master_report'],
    ),
    deep(
      'Im Garten ruht das vollständige Skelett eines gestrandeten Pottwals — massiver Zeuge der marinen Megafauna vor dieser Küste.',
      ['natur', 'must_have', 'master_report'],
    ),
    deep(
      'Inklusion: Gebäude und Ausstellung zertifiziert barrierefrei (Wendekreise, taktile Reize); öffentliches behindertengerechtes WC mit Euro-Schlüssel. Eintritt ganzjährig kostenlos. Saison 15.03.–31.10.: Di–Fr 09–13/14–18; Wochenende/Feiertag 10–12/14–17; Mo Ruhetag.',
      ['barrierefreiheit', 'live', 'master_report'],
    ),
  ]);
}

// ─── 5) Inselbahnhof ─────────────────────────────────────────────────
{
  const spot = byId('wangerooge_db_bahnhof_wangerooge');
  const tp = tpById(spot.id);
  spot.bullets = [
    'Adresse: Bahnhofstraße 6, 26486 Wangerooge — zentraler Verkehrsknoten der autofreien Insel (§ 46 StVO).',
    'Die Schmalspur-Inselbahn hat Monopolstellung: Fracht, Passagiere vom Fähranleger Südwest und Reisegepäck laufen hier zusammen.',
    'Historie eng mit der Dampflok-Ära verknüpft — deren Relikt (Denkmal) steht am Alten Leuchtturm, der heutige Bahnbetrieb ist modernisiert.',
    'Fahrkartenausgabe, Gepäckabfertigung, Tourist-Information (Saison 08:00–18:00). Barrierefrei PA-13509-2023: stufenlos, Tresen 90 cm, WC Tür 93 cm / Bewegungsflächen 292×62 cm.',
    'Gepäckausgabe am Vorplatz = Gegenstück zu den roten Containern in Harlesiel. West-Gäste: Hauszustellung obligatorisch.',
    'Binnenmobilität: zu Fuß, Fahrrad (Verleihe u. a. Beier, Edens, FeWo-Insel), buchbarer Inselshuttle/Elektrokarren ab ca. 16,00 € für bis zu 4 Personen je Zone (+2 €/Gepäck). Keine E-Scooter (gesetzliches Verbot), keine konventionellen Taxis.',
  ];
  const faqs = keepFaqs(tp.deep_data_pool);
  const orient = (tp.deep_data_pool || []).filter(
    (e) =>
      !(e.tags || []).map(String).map((t) => t.toLowerCase()).includes('faq') &&
      ((e.tags || []).includes('orientierung') ||
        (e.tags || []).includes('link') ||
        (e.tags || []).includes('karte')),
  );
  setNonFaqPool(tp, [
    deep(
      'Da die Nordseeinsel per strikter Gesetzeslage (§ 46 StVO) absolut autofrei ist, übernimmt die Schmalspur-Inselbahn eine systemrelevante Monopolstellung. Der Inselbahnhof ist der logistische Flaschenhals für Fracht, Passagiere vom Fähranleger und Reisegepäck. Die Historie ist mit der Dampflok-Ära verknüpft (Relikt-Denkmal am Alten Leuchtturm); das heutige System ist standardisiert und modernisiert — es fährt keine historische Dampflok mehr im Regelbetrieb.',
      ['transport', 'bahnhof', 'must_have', 'master_report', 'erzaehlung'],
    ),
    deep(
      'Live: Fahrkarten, Gepäckabfertigung, Tourist-Info Saison 08–18 Uhr. Barrierefreiheit Zertifikat PA-13509-2023 (stufenlos, Schalter 90 cm, WC Türbreite 93 cm, Bewegungsflächen 292×62 cm, Haltegriffe beidseitig). Gepäckkette: Harlesiel rote Container → Fähre → Inselbahn → Bahnhofsvorplatz.',
      ['barrierefreiheit', 'live', 'gepaeck', 'master_report'],
    ),
    deep(
      'Binnenmobilität ohne Auto: Fußwege (Zedeliusstraße barrierefrei), Fahrradverleih (u. a. Beier, Edens, FeWo-Insel), Inselshuttle/Elektrokarren ab 16,00 € bis 4 Personen je Zone zzgl. 2,00 €/Gepäckstück. Miet-E-Scooter gesetzlich verboten; keine konventionellen Taxis.',
      ['transport', 'live', 'master_report'],
    ),
    ...orient,
  ]);
  tp.deep_data_pool = [...tp.deep_data_pool, ...faqs];
}

// ─── 6) Harlesiel tariffs extras ─────────────────────────────────────
{
  const tp = tpById('harlesiel_faehrhafen');
  const spot = byId('harlesiel_faehrhafen');
  pushUnique(
    tp.deep_data_pool,
    deep(
      'Sondergepäck Saison 2026: Fahrrad/Klapprad ab 17 Zoll bzw. Golfcaddy 30,00 €. Nur Handgepäck an Bord (max. 2 Stück, 50×40×25 cm). Motorschiffe Harlingerland und Wangerooge sind barrierefrei; der Watt Sprinter ist ausdrücklich nicht barrierefrei konzipiert.',
      ['transport', 'preise', 'saison_2026', 'barrierefreiheit', 'master_report'],
    ),
  );
  pushUnique(
    tp.deep_data_pool,
    deep(
      'Tide diktiert den Fahrplan (bis zu sechs Abfahrten/Tag Hauptsaison) — keine U-Bahn, keine Nachtbusse, keine E-Scooter, keine Festpreis-Taxis vom Flughafen. PKW bleiben auf gebührenpflichtigen Parkplätzen in Harlesiel (7,00 €/angefangener Tag).',
      ['transport', 'tide', 'master_report'],
    ),
  );
  if (spot && Array.isArray(spot.bullets)) {
    if (!spot.bullets.some((b) => /Golfcaddy|30,00/.test(b))) {
      spot.bullets.push(
        'Sondergepäck 2026: Fahrrad/Golfcaddy 30,00 €. Watt Sprinter nicht barrierefrei; Schiffe Harlingerland/Wangerooge schon.',
      );
    }
  }
}

// ─── 7) Neuer Leuchtturm (war zu dünn) ───────────────────────────────
{
  const spot = byId('wangerooge_neuer_leuchtturm_wangerooge');
  const tp = tpById(spot.id);
  spot.bullets = [
    'Adresse: Straße zum Westen / Weststrand, 26486 Wangerooge — aktiver Leuchtturm, Nachfolger des Alten Leuchtturms (Lichtwechsel 7.11.1969).',
    'Unterhalb am Strand: bei Ebbe Fundamente des Alten Westturms (1597–1602, 1914 gesprengt) — Lost Place, Spot „Fundamente Alter Westturm“.',
    'Google-Bewertung oft um 4.5/5; Landmarke für Westkap und Dünenwege.',
    'Nicht verwechseln mit dem DJH-Westturm (Im Westen 38) noch mit dem Alten Leuchtturm (Museum Zedeliusstraße 3).',
  ];
  spot.facts = {
    origin:
      'Neuer Leuchtturm übernahm am 7. November 1969 das Seezeichen vom Alten Leuchtturm im Dorf.',
    architecture: 'Aktiver Leuchtturm am Weststrand; Orientierungspunkt für Fundamente Alter Westturm bei Ebbe.',
    now: 'Aussichtspunkt/Landmarke West; Trennung: Neuer LT ≠ Westturm-DJH ≠ Alter LT-Museum.',
    tags: ['aussicht', 'must_have', 'geschichte', 'master_report'],
  };
  const faqs = keepFaqs(tp.deep_data_pool);
  setNonFaqPool(tp, [
    deep(
      'Der Neue Leuchtturm ist das aktive Seezeichen seit dem 7. November 1969 — Nachfolger des Alten Leuchtturms im Dorf. Am Strand darunter liegen bei Ebbe die Fundamentsteine des 1914 gesprengten Alten Westturms (nicht der DJH-Westturm).',
      ['geschichte', 'must_have', 'master_report'],
    ),
    deep(
      'Drei Türme klar trennen: (1) Alter Leuchtturm = Museum/Standesamt Zedeliusstraße 3, (2) Westturm = rotbraunes DJH-Wahrzeichen Im Westen 38, (3) Neuer Leuchtturm = aktives Seezeichen am Weststrand.',
      ['orientierung', 'master_report'],
    ),
  ]);
  tp.deep_data_pool = [...tp.deep_data_pool, ...faqs];
  patchApproaches(spot, {
    28: 'Vor dir der Neue Leuchtturm — aktives Seezeichen seit 1969. Bei Ebbe lohnt der Blick unterhalb am Strand zu den Fundamenten des alten Westturms von 1602.',
    26: 'Von hier aus siehst du den Neuen Leuchtturm. Nicht verwechseln mit dem rotbraunen Westturm (DJH) oder dem Alten Leuchtturm im Dorf.',
  });
}

// ─── 8) Kurverwaltung system facts ───────────────────────────────────
{
  const tp = tpById('wangerooge_wangerooge_erholung_ist_eine_insel_kurverwaltung');
  if (tp) {
    pushUnique(
      tp.deep_data_pool,
      deep(
        'Sicherheit & Medizin (Master-Report): Polizei Charlottenstraße 9, Tel. 04469-94690-0 (Notruf 110). Kein Krankenhaus — Dr. med. Frank Kortenhorn, Robbenstraße 12, Tel. 04469-1700 (Rufweiterleitung); Dr. med. Annick Goltz, Nikolausstraße 4–6, Tel. 04469-9469963. Rettung 112 (Helikopter/Seenotkreuzer). Insel-Apotheke Zedeliusstraße 31, Tel. 04469-1435. Fundbüro Kurverwaltung Obere Strandpromenade 3, Tel. 04469-99164, Mo–Fr 10–12.',
        ['sicherheit', 'medizin', 'master_report'],
      ),
    );
    pushUnique(
      tp.deep_data_pool,
      deep(
        'Digital & Geld: #free_inselwlan (SSID, Werbeclip 5–10 s, Tagesauth); Vodafone ~240 Hotspots; Freifunk 8 Knoten. LzO SB-Filiale Zedeliusstraße 34, 06–23 Uhr, barrierefrei. Keine Rossmann/DM-Ketten; keine Euronet-Touristenfallen dokumentiert.',
        ['wlan', 'geld', 'master_report'],
      ),
    );
    pushUnique(
      tp.deep_data_pool,
      deep(
        'Kultur/Freizeit: Nikolaikirche Am Dorfplatz 34; St.-Willehad Westingstraße 7. Hartmannsstand-Holzkreuz: 311 Tote 25.04.1945. Golfclub Insel Wangerooge e.V. gegründet 2007, 9-Loch Jadehörn 17 am Inselflugplatz (bundesweit einzigartig). Souvenirs u. a. Mooikram, Perlenmeer, SteinZeit-Atelier am Wattenmeer 8a. Strandbuggys kostenfrei an der Pudding-Uhr (solar).',
        ['kultur', 'freizeit', 'master_report'],
      ),
    );
  }
}

// ─── 9) Golfclub founding ────────────────────────────────────────────
{
  const spot = byId('wangerooge_golfclub');
  const tp = tpById('wangerooge_golfclub');
  if (spot) {
    if (!spot.bullets?.some((b) => /2007/.test(b))) {
      spot.bullets = [
        ...(spot.bullets || []),
        'Golfclub Insel Wangerooge e.V. gegründet 2007; 9-Loch-Platz Jadehörn 17, architektonisch in den Inselflugplatz integriert — bundesweit einmaliges Konzept.',
      ];
    }
  }
  if (tp) {
    pushUnique(
      tp.deep_data_pool,
      deep(
        'Golfclub Insel Wangerooge e.V., gegründet 2007: 9-Loch-Platz an Jadehörn 17, räumlich mit dem Inselflugplatz überlagert — in Deutschland einzigartiges Konzept von Luftfahrt und Golfsport.',
        ['sport', 'master_report'],
      ),
    );
  }
}

// ─── 10) Gerken / Digger's gastro extras ─────────────────────────────
{
  const gerken = tpById('wangerooge_strandhotel_gerken');
  if (gerken) {
    pushUnique(
      gerken.deep_data_pool,
      deep(
        'Strandhotel Gerken, Obere Strandpromenade 21: Frühstücksbüfett 27,00 € (auch externe Gäste) mit Fischsalaten, Matjes, Pancake-Automat, vier Brotsorten der Inselbäckerei Kruse und glutenfreien Alternativen. Abendbüfett ab 17:30 38,00 € regionale Küche. Fischerstube tagsüber: Kibbelinge, Fischbrötchen, Bubblewaffeln, „Bier der Inselbrauerei“. Lounge/Bar bis 01:00.',
        ['gastro', 'preise', 'saison_2026', 'master_report'],
      ),
    );
  }
  const diggers = tpById('wangerooge_digger_s_strandbar');
  if (diggers) {
    pushUnique(
      diggers.deep_data_pool,
      deep(
        'Digger\'s Strandbar, Obere Strandpromenade 3: Surf-Ästhetik (Boards an der Decke, Palettenmöbel), eigener Gin. Ableger „Digger\'s Außenposten“ ~50 m: Outdoor-Party/Happy Hour unter Schirmen mit Meerblick.',
        ['gastro', 'bar', 'master_report'],
      ),
    );
  }
}

pack.data_version = VERSION;
pack.updated_at = new Date().toISOString().slice(0, 10);

const validation = validateCityPack(pack);
if (!validation.ok) {
  console.error(validation);
  process.exit(1);
}

fs.writeFileSync(PACK, JSON.stringify(pack, null, 2));

const index = JSON.parse(fs.readFileSync(INDEX, 'utf8'));
const city = (index.available_cities || []).find((c) => c.id === 'wangerooge');
if (city) city.data_version = VERSION;
index.last_global_update = new Date().toISOString();
fs.writeFileSync(INDEX, JSON.stringify(index, null, 2));

// gap re-check
const blob = JSON.stringify(pack);
const checks = [
  'Manifest des Wiederaufbaus',
  'Dampflokomotive als Denkmal',
  'rotbraune Backsteinturm',
  'drei Spitzen',
  'Hitlerjugend',
  '168 Betten',
  'Schandfleck',
  'Thorn Folkerts',
  'Inselshuttle',
  'E-Scooter',
  'Golfcaddy',
  'Harlingerland',
  'Annick Goltz',
  '2007',
  'Mooikram',
  'Argandlampe',
];
const missing = checks.filter((c) => !blob.includes(c));
console.log(
  JSON.stringify(
    {
      data_version: VERSION,
      validation,
      missingAfter: missing,
      present: checks.length - missing.length,
    },
    null,
    2,
  ),
);
