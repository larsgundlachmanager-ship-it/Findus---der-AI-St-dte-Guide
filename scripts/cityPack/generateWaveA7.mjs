#!/usr/bin/env node
/**
 * Generate research-waveA.json for 7 city packs.
 * Core orientation text + Wikipedia DE extract sentences (verified); LIVE tags for ephemeral.
 */
import fs from 'node:fs';
import path from 'node:path';
import { STAEDTE_DIR } from './lib.mjs';

const P = (text, tags = ['master_report']) => ({ text: text.trim(), tags });
const LIVE = (text) => P(`LIVE: ${text}`, ['live_hint', 'ephemeral', 'master_report']);

function lines(block, extra = []) {
  return block
    .trim()
    .split(/\n+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 25)
    .map((t) => P(t))
    .concat(extra);
}

async function wikiSentences(title, limit = 35, altTitles = []) {
  const tryTitles = [title, ...(altTitles || [])].filter(Boolean);
  for (const t of tryTitles) {
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      prop: 'extracts',
      explaintext: 'true',
      exsectionformat: 'plain',
      redirects: '1',
      titles: t,
    });
    const res = await fetch(`https://de.wikipedia.org/w/api.php?${params}`, {
      headers: { 'User-Agent': 'FindusCityPackResearch/1.0 (contact: dev@findus.local)' },
    });
    if (!res.ok) continue;
    const data = await res.json();
    const page = Object.values(data.query?.pages || {})[0];
    if (!page?.extract || page.missing) continue;
    const raw = page.extract.replace(/\[\d+\]/g, '').replace(/\s+/g, ' ').trim();
    const parts = raw.split(/(?<=[.!?])\s+(?=[A-ZÄÖÜ„„(])/).filter(Boolean);
    const out = [];
    for (const s of parts) {
      const tx = s.trim();
      if (tx.length < 45 || tx.length > 420) continue;
      if (/^\(/.test(tx) && tx.length < 80) continue;
      out.push(P(tx, ['master_report', 'wikipedia']));
      if (out.length >= limit) break;
    }
    if (out.length >= 3) return out;
  }
  return [];
}

function poolSize(spot) {
  return (
    (spot.general_info || '').length +
    (spot.deep_data_pool || []).reduce((a, e) => a + (e.text || '').length, 0)
  );
}

async function buildSpot(def) {
  const wikiLimit = def.wikiLimit ?? (def.tier === 1 ? 32 : 16);
  let wiki = await wikiSentences(def.wiki, wikiLimit, def.wikiAlt);
  if (def.wikiAlso) {
    for (const t of def.wikiAlso) {
      wiki = wiki.concat(await wikiSentences(t, 14));
      await new Promise((r) => setTimeout(r, 80));
    }
  }
  const manual = lines(
    [def.block, def.extraBlock || ''].filter(Boolean).join('\n'),
    def.live || [],
  );
  let deep_data_pool = [...manual, ...wiki];
  const min = def.tier === 1 ? 3000 : 1200;
  if (poolSize({ general_info: def.general_info, deep_data_pool }) < min) {
    const more = await wikiSentences(def.wiki, 45, [...(def.wikiAlt || []), ...(def.wikiAlso || [])]);
    deep_data_pool = [...manual, ...wiki, ...more];
  }
  return {
    id: def.id,
    name: def.name,
    place_tier: def.tier,
    pack_role: 'story',
    lat: def.lat,
    lng: def.lng,
    category: def.category,
    general_info: def.general_info,
    bullets: def.bullets || [],
    facts: def.facts || {},
    faqs: def.faqs || [],
    deep_data_pool,
  };
}

const CITIES = {
  muenchen: {
    city_history:
      'München: 1158 urkundlich; seit 1506 bayerische Hauptstadt. Wittelsbacher Residenzstadt zwischen Alpen und Isar (Wikipedia).',
    offline_qa: [
      {
        q: 'Wann wurde München Hauptstadt Bayerns?',
        a: '1506 unter Kurfürst Albrecht IV. (Wikipedia).',
        tags: ['muenchen'],
      },
    ],
    spots: [
      {
        id: 'muenchen_marienplatz',
        name: 'Marienplatz',
        tier: 2,
        wiki: 'Marienplatz (München)',
        general_info:
          'Zentraler Platz der Altstadt mit Neues Rathaus (Glockenspiel), Marien­säule und S-Bahn-Knoten Marienplatz.',
        block: `Visuell: Neugotischer Rathausturm mit Glockenspiel dominiert; Marien­säule goldene Figur in der Mitte; Fußgängerzonen strahlen ab.
Wegweiser: Von der Kaufingerstraße kommend siehst du den Turm frontal; U-Bahn-Ausgang unter dem Platz.`,
        live: [LIVE('Glockenspiel-Zeiten: offizielle Angaben muenchen.de / Rathaus.')],
      },
      {
        id: 'muenchen_deutsches_museum',
        name: 'Deutsches Museum',
        tier: 1,
        wiki: 'Deutsches Museum',
        general_info:
          'Größtes naturwissenschaftlich-technisches Museum der Welt auf der Museumsinsel — gegründet 1903 von Oskar von Miller.',
        block: `Visuell: Kalksteinfassade auf der Isar-Insel; Kuppeln und Hallen von Brücken sichtbar.
Wegweiser: Von der Corneliusbrücke aus erkennst du die Inselbebauung mit Kuppelsaal.`,
        live: [LIVE('Tickets und Öffnungszeiten: deutsches-museum.de.')],
      },
      {
        id: 'muenchen_residenz_museum',
        name: 'Residenz Museum',
        tier: 1,
        wiki: 'Münchner Residenz',
        general_info:
          'Wittelsbacher Stadtresidenz mit Antiquarium und Prunkräumen — einer der größten Palastkomplexe Europas.',
        block: `Visuell: Palastfassaden am Hofgarten; Antiquarium-Säulenhalle innen Renaissance-Ikonenmotiv.`,
        live: [LIVE('Führungen Residenz und Schatzkammer: residenz-muenchen.de.')],
      },
      {
        id: 'muenchen_residenz_munchen',
        name: 'Residenz München',
        tier: 2,
        wiki: 'Münchner Residenz',
        wikiLimit: 10,
        general_info: 'Gesamtanlage der Wittelsbacher Residenz mit Innenhöfen, Grottenhof und Zugang zum Museum.',
        block: `Visuell: Grottenhof mit Muschel-Dekor und Perseus-Brunnen; mehrere Innenhöfe.`,
        extraBlock: `Die Münchner Residenz war ab dem 16. Jahrhundert Sitz der Wittelsbacher in der Hauptstadt (Wikipedia Münchner Residenz).
Der Grottenhof entstand unter Albrecht V. im 16. Jahrhundert mit Muschel-Dekor (Residenz München).
Der Max-Joseph-Platz und der Hofgarten grenzen an die Anlage; der Residenzstraße-Trakt verbindet zum Odeonsplatz (Wikipedia).`,
      },
      {
        id: 'muenchen_englischer_garten',
        name: 'Englischer Garten',
        tier: 2,
        wiki: 'Englischer Garten (München)',
        general_info:
          'Ca. 375 ha Landschaftspark ab 1789 — Isar, Monopteros, Chinesischer Turm, Eisbachwelle.',
        block: `Visuell: Weite Wiesen, Isararm, Biergärten; Monopteros-Hügel mit Stadtblick.`,
      },
      {
        id: 'muenchen_schloss_nymphenburg',
        name: 'Schloss Nymphenburg',
        tier: 1,
        wiki: 'Schloss Nymphenburg',
        general_info:
          'Barockes Sommerschloss der Wittelsbacher (1664 ff.), Geburtsort Ludwigs II., mit Schlosspark.',
        block: `Visuell: Breite barocke Fassade mit Wasserachse; Kuppel mittig.`,
        live: [LIVE('Schloss und Park: schloesser.bayern.de.')],
      },
      {
        id: 'muenchen_schlosspark_nymphenburg',
        name: 'Schlosspark Nymphenburg',
        tier: 1,
        wiki: 'Schlosspark Nymphenburg',
        wikiLimit: 28,
        general_info: 'Park mit Kanälen, Amalienburg, Badenburg und Pagodenburg hinter Schloss Nymphenburg.',
        block: `Visuell: Symmetrische Wasserachse, Jagdschlösschen in Grünflächen.`,
      },
      {
        id: 'muenchen_olympiapark_munchen',
        name: 'Olympiapark München',
        tier: 2,
        wiki: 'Olympiapark (München)',
        general_info: 'Erbe der Olympischen Spiele 1972 — Zeltdach, Olympiasee, Stadion und Olympiaturm.',
        block: `Visuell: Zeltdachkonstruktion Frei Otto über Stadion und Halle; See im Vordergrund.`,
        live: [LIVE('Events, Turm, Stadionführungen: olympiapark.de.')],
      },
      {
        id: 'muenchen_chinesischer_turm',
        name: 'Chinesischer Turm',
        tier: 2,
        wiki: 'Chinesischer Turm (München)',
        general_info: 'Pagodenturm (1789–1790) im Englischen Garten mit großem Biergarten.',
        block: `Visuell: Grün lackierter Pagodenturm über Biergarten-Bänken.`,
      },
      {
        id: 'muenchen_eisbachwelle',
        name: 'Eisbachwelle',
        tier: 2,
        wiki: 'Eisbachwelle',
        general_info: 'Stationäre Surfwelle im Eisbach am Englischen Garten — Münchner Spektakel.',
        block: `Visuell: Surfer auf stehender Welle; Zuschauer an Ufer under Brücken.`,
      },
      {
        id: 'muenchen_spielzeugmuseum_im_alten_rathausturm',
        name: 'Spielzeugmuseum im Alten Rathausturm',
        tier: 1,
        wiki: 'Altes Rathaus (München)',
        wikiAlt: ['Spielzeugmuseum (München)'],
        general_info: 'Spielzeugsammlung im Turm des Alten Rathauses am Marienplatz.',
        block: `Visuell: Gotischer Rathausturm am Marienplatz — Museum im Turm.`,
        live: [LIVE('Öffnungszeiten: spielzeugmuseum-muenchen.de.')],
      },
      {
        id: 'muenchen_frauenkirche',
        name: 'Frauenkirche (Dom zu Unserer Lieben Frau)',
        tier: 1,
        wiki: 'Münchner Dom',
        lat: 48.138781,
        lng: 11.573664,
        category: 'kirche',
        general_info: 'Gotische Kathedrale mit zwei Domtürmen (99 m) — Wahrzeichen Münchens.',
        block: `Visuell: Zwei Backsteintürme mit „Welschen Hauben“ prägen die Skyline.`,
      },
      {
        id: 'muenchen_viktualienmarkt',
        name: 'Viktualienmarkt',
        tier: 2,
        wiki: 'Viktualienmarkt',
        lat: 48.135125,
        lng: 11.576319,
        category: 'markt',
        general_info: 'Dauerhafter Markt seit 1807 — Delikatessen, Maibaum, Biergärten in der Altstadt.',
        block: `Visuell: Stände, Maibaum mit Zunftfiguren, kleine Biergärten.`,
      },
      {
        id: 'muenchen_olympiaturm',
        name: 'Olympiaturm München',
        tier: 2,
        wiki: 'Olympiaturm',
        lat: 48.174082,
        lng: 11.553606,
        category: 'aussicht',
        general_info: '291 m Fernmeldeturm (1968) mit Aussichtsplattform im Olympiapark.',
        block: `Visuell: Schlanker Turm mit Antennenkranz über Zeltdach.`,
        extraBlock: `Der Olympiaturm München ist 291 Meter hoch und wurde 1968 fertiggestellt (Wikipedia Olympiaturm).
Er steht im Olympiapark neben dem Zeltdach-Stadion der Spiele 1972 (Wikipedia).
Aussichtsplattform und Restaurant bieten Panorama über Stadt und Alpenrand bei Föhn (Olympiapark München).`,
        live: [LIVE('Aussichtsplattform wetterabhängig — olympiapark.de.')],
      },
    ],
  },
  frankfurt_am_main: {
    city_history:
      'Frankfurt am Main: Kaiserstadt und Messestadt; Paulskirche 1848, Skyline am Main, Goethe-Geburtshaus (Wikipedia).',
    offline_qa: [],
    spots: [
      {
        id: 'frankfurt_am_main_roemer_city',
        name: 'Roemer City',
        tier: 2,
        wiki: 'Römer (Frankfurt am Main)',
        general_info: 'Mittelalterliches Rathausensemble Römer am Römerberg — Wahrzeichen der Mainmetropole.',
        block: `Visuell: Drei Giebelhäuser mit Staffelgiebeln am Römerberg; Fachwerkhäuser am Platz.`,
      },
      {
        id: 'frankfurt_am_main_katholische_kirchengemeinde_dom_st_bartholomaus',
        name: 'Katholische Kirchengemeinde Dom St. Bartholomäus',
        tier: 2,
        wiki: 'Kaiserdom St. Bartholomäus',
        general_info: 'Kaiserdom St. Bartholomäus am Domplatz — Wahl- und Krönungsstätte deutscher Kaiser.',
        block: `Visuell: Roter Sandsteindom mit schlankem Turm am Domplatz.`,
      },
      {
        id: 'frankfurt_am_main_main_tower',
        name: 'MAIN TOWER',
        tier: 2,
        wiki: 'Main Tower',
        general_info: '200 m Büroturm mit öffentlicher Aussichtsplattform — Panorama über Bankenviertel und Main.',
        block: `Visuell: Glasfassade am Mainufer; Aussichtsetage oberhalb der Bankdistrikte.`,
        live: [LIVE('Aussicht Öffnungszeiten: maintower.de.')],
      },
      {
        id: 'frankfurt_am_main_palmengarten_frankfurt',
        name: 'Palmengarten Frankfurt',
        tier: 2,
        wiki: 'Palmengarten Frankfurt',
        general_info: '22 ha botanischer Garten (1871) mit Tropen- und Subtropenhäusern im Westend.',
        block: `Visuell: Gewächshäuser und Wiesen zwischen Bahnhofsviertel und Westend.`,
        live: [LIVE('Eintritt und Öffnung: palmengarten.de.')],
      },
      {
        id: 'frankfurt_am_main_stadel_museum',
        name: 'Städel Museum',
        tier: 1,
        wiki: 'Städelsches Kunstinstitut',
        wikiAlt: ['Städel Museum'],
        general_info: 'Eines der ältesten und bedeutendsten Kunstmuseen Deutschlands am Museumsufer.',
        block: `Visuell: Historischer Trakt am Mainufer; moderne Erweiterung unter Garten.`,
        live: [LIVE('Tickets staedelmuseum.de.')],
      },
      {
        id: 'frankfurt_am_main_goethe_haus',
        name: 'Goethe-Haus',
        tier: 1,
        wiki: 'Goethe-Haus (Frankfurt am Main)',
        wikiAlt: ['Goethehaus (Frankfurt am Main)', 'Goethehaus Frankfurt'],
        wikiAlso: ['Johann Wolfgang von Goethe', 'Frankfurt am Main'],
        extraBlock: `Das Goethe-Haus in der Großer Hirschgraben 23–25 ist das Geburtshaus Johann Wolfgang von Goethes, geboren 28. August 1749 (Goethehaus Frankfurt, Wikipedia).
Das barocke Bürgerhaus wurde im Zweiten Weltkrieg zerstört und anhand der Originalpläne wiederaufgebaut; heute Museum und Forschungsstätte der Freien Deutschen Hochstift (Goethehaus Frankfurt).
Im Geburtshaus sind Wohnräume der Familie Goethe historisch eingerichtet; der Dichter verbrachte seine Kindheit bis zur Studienzeit hier (Goethehaus Frankfurt).
Das angrenzende Goethe-Museum zeigt Ausstellungen zur Klassik und Moderne (Goethehaus Frankfurt).
Visuell im Ensemble: Fachwerk- und Putz-Fassaden der Altstadt nahe Liebfrauenberg.`,
        lat: 50.110278,
        lng: 8.677778,
        category: 'museum',
        general_info: 'Geburtshaus Johann Wolfgang von Goethes (1749) — Museum und Forschungsstätte.',
        block: `Visuell: Bürgerhaus mit Fachwerk-/Stein-Fassade Große Hirschgraben.`,
        live: [LIVE('Museum Öffnung: goethehaus-frankfurt.de.')],
      },
      {
        id: 'frankfurt_am_main_alte_oper',
        name: 'Alte Oper',
        tier: 2,
        wiki: 'Alte Oper (Frankfurt am Main)',
        wikiAlt: ['Alte Oper Frankfurt'],
        general_info: 'Konzerthaus im Gründerzeit-Stil (1880) am Opernplatz — Wiederaufbau nach 1952.',
        block: `Visuell: Renaissance-Revival-Fassade mit Loggia am Opernplatz.`,
      },
      {
        id: 'frankfurt_am_main_hessen_shop_kleinmarkthalle',
        name: 'Hessen Shop Kleinmarkthalle',
        tier: 2,
        wiki: 'Kleinmarkthalle (Frankfurt am Main)',
        wikiAlt: ['Kleinmarkthalle Frankfurt am Main'],
        wikiAlso: ['Frankfurt am Main'],
        extraBlock: `Die Kleinmarkthalle an der Hasengasse wurde 1954 eröffnet und ersetzte die 1944 zerstörte alte Markthalle (Wikipedia Kleinmarkthalle Frankfurt).
In der Halle sind über 60 Marktstände mit Obst, Gemüse, Metzerei, Backwaren und internationalen Spezialitäten (Stadt Frankfurt).
Das Backsteinbauwerk mit Bogentragwerk ist ein zentraler Marktplatz der Innenstadt nahe Zeil und Konstablerwache (Wikipedia).
Der Hessen-Shop im Eingangsbereich bietet regionale Produkte — der Pack-Spot markiert diesen Eingangsbereich der Halle.`,
        general_info: 'Markthalle am Hasengasse — über 60 Stände; Hessen-Shop ist Eingangsbereich.',
        block: `Visuell: Backsteinhalle 1954; Marktstände innen — Eingang Hasengasse.`,
      },
      {
        id: 'frankfurt_am_main_paulskirche',
        name: 'Paulskirche',
        tier: 2,
        wiki: 'Paulskirche (Frankfurt am Main)',
        general_info: 'Nationalversammlung 1848 in der ovalen Kirche — Symbol deutscher Demokratie.',
        block: `Visuell: Rote Sandstein-oval auf Paulsplatz.`,
      },
      {
        id: 'frankfurt_am_main_eiserner_steg',
        name: 'Eiserner Steg',
        tier: 2,
        wiki: 'Eiserner Steg (Frankfurt am Main)',
        general_info: 'Fußgängerbrücke über den Main (1869) — Verbindung Altstadt und Sachsenhausen mit Skyline-Blick.',
        block: `Visuell: Eisenfachwerkbrücke mit Blick auf Skyline und Dom.`,
      },
    ],
  },
  koeln: {
    city_history:
      'Köln: römische Colonia Claudia Ara Agrippinensium; gotischer Dom UNESCO-Welterbe; Karnevals- und Medienstadt (Wikipedia).',
    offline_qa: [],
    spots: [
      {
        id: 'koeln_koelner_dom',
        name: 'Kölner Dom',
        tier: 1,
        wiki: 'Kölner Dom',
        lat: 50.941278,
        lng: 6.958281,
        category: 'kirche',
        general_info:
          'Gotische Metropolitankathedrale — UNESCO-Welterbe, Bau 1248–1880, zwei 157 m Türme.',
        block: `Visuell: Zwei filigrane Spitztürme; dunkler Trachit-Fassadenblock am Domplatzen.`,
        live: [LIVE('Turmsteigung und Führungen: koelner-dom.de.')],
      },
      {
        id: 'koeln_aussichtspunkt_hohenzollernbrucke',
        name: 'Aussichtspunkt Hohenzollernbrücke',
        tier: 2,
        wiki: 'Hohenzollernbrücke (Köln)',
        wikiAlt: ['Hohenzollernbrücke'],
        general_info: 'Bahn- und Fußgängerbrücke mit Liebesschlössern — Dom-Silhouette vom Rhein.',
        block: `Visuell: Eiserne Brückenbögen mit Schienen; Dom im Hintergrund.`,
      },
      {
        id: 'koeln_wasserspielplatz_in_der_altstadt',
        name: 'Wasserspielplatz in der Altstadt',
        tier: 1,
        wiki: 'Altstadt (Köln)',
        wikiAlt: ['Kölner Altstadt', 'Innenstadt (Köln)'],
        wikiAlso: ['Kölner Dom', 'Köln'],
        wikiLimit: 22,
        general_info: 'Historische Altstadt mit engen Gassen, Brauhäusern und Rheinufer-Nähe — Pack-Spot nahe Wasserspielplatz.',
        block: `Visuell: Gassen zwischen Dom und Rhein; Brauhaus-Fassaden und Kneipen.`,
        extraBlock: `Die Kölner Altstadt umfasst die historischen Quartiere zwischen Dom, Rhein und Alter Markt mit engen Gassen und Kölner Brauhaus-Kultur (Wikipedia Altstadt Köln).
Der Heinzelmännchenbrunnen und die Rheinpromenade liegen fußläufig; der Dom prägt die Silhouette in fast jeder Gasse (Stadt Köln).
Kölsch wird in traditionellen Brauhäusern ausgebaut und in 0,2-l-Stangen serviert — Brauhaus-Tradition (Kölner Brauhaus-Kultur, Wikipedia).`,
      },
      {
        id: 'koeln_museum_ludwig',
        name: 'Museum Ludwig',
        tier: 1,
        wiki: 'Museum Ludwig',
        general_info: 'Museum für Moderne Kunst am Dom — Pop Art, Picasso, Zeitgenossen.',
        block: `Visuell: Backstein-Modernismus nahe Dom und Rhein.`,
        live: [LIVE('museum-ludwig.de Öffnungszeiten.')],
      },
      {
        id: 'koeln_schokoladenmuseum_koln',
        name: 'Schokoladenmuseum Köln',
        tier: 1,
        wiki: 'Schokoladenmuseum Köln',
        general_info: 'Museum der Schokolade am Rheinauhafen — Geschichte Kakaos und Produktion.',
        block: `Visuell: Glas- und Stahl-Bau am Rhein mit Schiffsmotiv.`,
        live: [LIVE('schokoladenmuseum.de Tickets.')],
      },
      {
        id: 'koeln_rheinboulevard',
        name: 'Rheinboulevard',
        tier: 2,
        wiki: 'Rheinboulevard (Köln)',
        wikiAlt: ['Rheinauhafen (Köln)', 'Köln-Deutz'],
        extraBlock: `Der Rheinboulevard in Köln-Deutz ist eine städtische Freitreppe und Promenade am Rhein mit Blick auf Dom und Hohenzollernbrücke (Stadt Köln, Wikipedia Rheinboulevard).`,
        general_info: 'Promenade am Rhein mit Treppen und Blick auf Hohenzollernbrücke und Dom.',
        block: `Visuell: Breite Stufen zum Rhein; Skyline Dom–Brücke.`,
      },
      {
        id: 'koeln_heinzelmannchenbrunnen',
        name: 'Heinzelmännchenbrunnen',
        tier: 2,
        wiki: 'Heinzelmännchenbrunnen',
        general_info: 'Brunnen (1915) zur Kölner Sage der Heinzelmännchen am Altstadt-Aufgang.',
        block: `Visuell: Bronze-Figurengruppe mit kleinen Helfern.`,
      },
      {
        id: 'koeln_freitreppe_an_domplatte',
        name: 'Freitreppe an Domplatte',
        tier: 2,
        wiki: 'Kölner Dom',
        wikiLimit: 8,
        general_info: 'Treffpunkt an der Domplatte mit Dom-Fassade und Platzpanorama.',
        block: `Visuell: Weite Freitreppe vor Dom-Westfassade.`,
        extraBlock: `Die Domplatte liegt vor der Westfassade des Kölner Doms und ist zentraler Platz zwischen Bahnhof, Dom und Rhein (Stadt Köln).
Die Freitreppe dient als Aufenthalt mit Blick auf die gotische Fassade und die zwei Türme (Wikipedia Kölner Dom).`,
      },
    ],
  },
  duesseldorf: {
    city_history:
      'Düsseldorf: Residenzstadt der Kurfürsten von der Pfalz; Königsallee, MedienHafen-Architektur und Rheinmetropole (Wikipedia).',
    offline_qa: [],
    spots: [
      {
        id: 'duesseldorf_konigsallee',
        name: 'Königsallee',
        tier: 2,
        wiki: 'Königsallee',
        wikiLimit: 20,
        wikiAlso: ['Düsseldorf'],
        extraBlock: `Die Königsallee wurde ab 1802 als Prachtboulevard angelegt; der Wassergraben (Kö-Graben) und Kastanien prägen das Straßenbild (Wikipedia Königsallee).
Luxus-Ladenpassagen und Modehäuser säumen den Boulevard; der Schadow-Kreis am Anfang verbindet Altstadt und Kö (Wikipedia).
`,
        general_info: 'Prachtboulevard mit Kö-Graben, Kastanien und Luxus-Ladenpassagen.',
        block: `Visuell: Doppelallee mit Wassergraben und Kastanien.`,
      },
      {
        id: 'duesseldorf_rheinturm_dusseldorf_gespiegelt',
        name: 'Rheinturm Düsseldorf - gespiegelt',
        tier: 2,
        wiki: 'Rheinturm (Düsseldorf)',
        wikiAlt: ['Rheinturm Düsseldorf'],
        wikiAlso: ['Düsseldorf', 'Medienhafen Düsseldorf'],
        general_info: '240,5 m Fernsehturm (1981) mit Aussichtsplattform und Lichtskulptur.',
        block: `Visuell: Betonschaft mit Kugel und Antenne — Wahrzeichen der Skyline.`,
        live: [LIVE('rheinturm.de Öffnung.')],
        extraBlock: `Der Rheinturm Düsseldorf ist 240,5 Meter hoch und wurde 1981 in Betrieb genommen (Wikipedia Rheinturm Düsseldorf).
Er dient als Fernmeldeturm und trägt eine Aussichtsplattform sowie ein Drehrestaurant (Wikipedia).
Die Lichtskulptur „Lichtzeitpegel“ an der Turmfassade ist ein Wahrzeichen der Landeshauptstadt (Wikipedia).`,
      },
      {
        id: 'duesseldorf_altstadt_dusseldorf',
        name: 'Altstadt Düsseldorf',
        tier: 2,
        wiki: 'Düsseldorfer Altstadt',
        general_info: '„Längste Theke der Welt“ — enge Gassen mit Brauereien zwischen Markt und Rhein.',
        block: `Visuell: Schmalen Fassaden, Kneipen dicht nebeneinander.`,
      },
      {
        id: 'duesseldorf_aussichtspunkt_hafen_und_gehry_gebaude',
        name: 'Aussichtspunkt Hafen und Gehry-Gebäude',
        tier: 2,
        wiki: 'Neuer Zollhof',
        general_info: 'MedienHafen mit Frank Gehry’s gewellten Fassaden am Rhein.',
        block: `Visuell: Geschwungene Metallfassaden drei Gebäude am Hafenbecken.`,
      },
      {
        id: 'duesseldorf_medienhafen_dusseldorf_e_v',
        name: 'MedienHafen Düsseldorf e.V.',
        tier: 2,
        wiki: 'Medienhafen Düsseldorf',
        wikiLimit: 12,
        general_info: 'Hafenquartier mit Architektur der 1990er — Büros, Medien, Gastronomie.',
        block: `Visuell: Kranbahnen, Speicher und moderne Neubauten am Wasser.`,
      },
      {
        id: 'duesseldorf_schloss_benrath',
        name: 'Schloss Benrath',
        tier: 1,
        wiki: 'Schloss Benrath',
        general_info: 'Spätbarockes Jagdschloss (1756–1773) mit Spiegelweiher und Park.',
        block: `Visuell: Rosa Putz-Fassade mit zwei Flügeln am Weiher.`,
        live: [LIVE('schloss-benrath.de Führungen.')],
      },
    ],
  },
  stuttgart: {
    city_history:
      'Stuttgart: Herzogtum Württemberg; Automobilstadt Mercedes und Porsche; Wein auf den Rebenhängen (Wikipedia).',
    offline_qa: [],
    spots: [
      {
        id: 'stuttgart_neues_schloss_stuttgart',
        name: 'Neues Schloss Stuttgart',
        tier: 1,
        wiki: 'Neues Schloss (Stuttgart)',
        general_info: 'Barock-Residenzschloss am Schlossplatz — Zentrum der Innenstadt.',
        block: `Visuell: Drei Flügel um Schlossplatz; Jubiläumssäule mittig.`,
      },
      {
        id: 'stuttgart_mittlerer_schlossgarten',
        name: 'Mittlerer Schlossgarten',
        tier: 1,
        wiki: 'Schlossgarten (Stuttgart)',
        wikiLimit: 24,
        general_info: 'Park zwischen Schlossplatz, Staatsoper und Hauptbahnhof.',
        block: `Visuell: Alleen, Teich und Oper im Hintergrund.`,
      },
      {
        id: 'stuttgart_mercedes_benz_museum',
        name: 'Mercedes-Benz Museum',
        tier: 1,
        wiki: 'Mercedes-Benz Museum',
        general_info: 'Automobilmuseum in Doppelhelix-Gebäude — Geschichte Mercedes-Benz.',
        block: `Visuell: Glas-Doppelhelix nahe Untertürkheim.`,
        live: [LIVE('mercedes-benz-museum.de Tickets.')],
      },
      {
        id: 'stuttgart_porsche_museum',
        name: 'Porsche Museum',
        tier: 1,
        wiki: 'Porsche-Museum',
        wikiAlt: ['Porsche Museum', 'Porsche-Museum (Stuttgart-Zuffenhausen)'],
        general_info: 'Museum der Porsche AG in Zuffenhausen — Renn- und Serienfahrzeuge.',
        block: `Visuell: Dynamisch schwebender Stahlbetonbau an Porsche-Platz.`,
        live: [LIVE('porsche.com/museum.')],
      },
      {
        id: 'stuttgart_fernsehturm_stuttgart',
        name: 'Fernsehturm Stuttgart',
        tier: 2,
        wiki: 'Fernsehturm Stuttgart',
        general_info: 'Erster Fernsehturm der Welt (1956) auf dem Hohen Bopser — Aussicht über Weinberge.',
        block: `Visuell: Betonschaft mit Kugel und Sendeantenne über Stadt.`,
        live: [LIVE('fernsehturm-stuttgart.de.')],
      },
      {
        id: 'stuttgart_wilhelma',
        name: 'Wilhelma',
        tier: 2,
        wiki: 'Wilhelma',
        general_info: 'Zoologisch-botanischer Garten in historischem maurischem Schlossensemble.',
        block: `Visuell: Gewölbte Fassaden und Gewächshäuser im Neckar-Kessel.`,
        live: [LIVE('wilhelma.de Öffnungszeiten.')],
      },
    ],
  },
  dresden: {
    city_history:
      'Dresden: sächsische Residenzstadt; barockes Stadtbild, Frauenkirche-Wiederaufbau, Elbe-Kultur (Wikipedia).',
    offline_qa: [],
    spots: [
      {
        id: 'dresden_frauenkirche_dresden',
        name: 'Frauenkirche Dresden',
        tier: 2,
        wiki: 'Frauenkirche (Dresden)',
        general_info: 'Barocke Kuppelkirche — Ruine bis 1994, Wiederaufbau bis 2005.',
        block: `Visuell: Große Sandsteinkuppel mit Kreuz; Neumarkt-Umfeld.`,
      },
      {
        id: 'dresden_dresdner_zwinger',
        name: 'Dresdner Zwinger',
        tier: 2,
        wiki: 'Zwinger (Dresden)',
        general_info: 'Barockes Festungs- und Gartenensemble — Mathematisch-Physikalischer Salon, Gemäldegalerie Alte Meister.',
        block: `Visuell: Sandsteinbögen, Kronentor und Nymphenbad.`,
        live: [LIVE('skd.museum Eintritt.')],
      },
      {
        id: 'dresden_semperoper_dresden',
        name: 'Semperoper Dresden',
        tier: 2,
        wiki: 'Semperoper',
        general_info: 'Opernhaus Gottfried Semper an der Elbe — zweiter Wiederaufbau 1985.',
        block: `Visuell: Neorenaissance-Fassade am Theaterplatz mit Elbblick.`,
      },
      {
        id: 'dresden_residenzschloss_dresden',
        name: 'Residenzschloss Dresden',
        tier: 1,
        wiki: 'Residenzschloss Dresden',
        lat: 51.0525,
        lng: 13.7369,
        category: 'schloss',
        general_info: 'Renaissance-Residenz der Wettiner mit Grünem Gewölbe und Türckische Cammer.',
        block: `Visuell: Verschachtelte Schlossflügel am Taschenberg neben Zwinger.`,
        live: [LIVE('skd.museum Residenzschloss.')],
      },
      {
        id: 'dresden_bruhlsche_terrasse',
        name: 'Brühlsche Terrasse',
        tier: 2,
        wiki: 'Brühlsche Terrasse',
        general_info: '„Balcony of Europe“ — Promenade auf der Elbterrasse mit Panorama.',
        block: `Visuell: Sandstein-Stützmauer mit Balustrade über der Elbe.`,
      },
      {
        id: 'dresden_historisches_grunes_gewolbe',
        name: 'Historisches Grünes Gewölbe',
        tier: 2,
        wiki: 'Grünes Gewölbe',
        general_info: 'Schatzkammer August des Starken im Residenzschloss — barocke Prunkstücke.',
        block: `Visuell: Historische Gewölbe-Räume im Schloss.`,
        live: [LIVE('skd.museum Grünes Gewölbe Termin.')],
      },
    ],
  },
  hochheim_am_main: {
    city_history:
      'Hochheim am Main: Weinbau-Stadt im Rheingau, bekannt für Hochheimer Wein und historische Kernstadt (Wikipedia).',
    offline_qa: [
      {
        q: 'Welche Weinlage ist Hochheim namensgebend?',
        a: 'Die Lage „Hochheim“ im Rheingau — Begriff „Hock“ für Wein (Volksmund, Weinbauverband Rheingau).',
        tags: ['wein'],
      },
    ],
    spots: [
      {
        id: 'hochheim_am_main_altstadt_hochheim',
        name: 'Altstadt Hochheim',
        tier: 2,
        wiki: 'Hochheim am Main',
        wikiLimit: 16,
        general_info: 'Historischer Ortskern mit Fachwerk, Weingütern und Kirchen — Rheingau-Weinstadt.',
        block: `Visuell: Engere Gassen, Fachwerk und Weinstuben nahe Main.`,
      },
      {
        id: 'hochheim_am_main_pfarrkirche_st_peter_und_paul',
        name: 'Pfarrkirche St. Peter und Paul',
        tier: 2,
        wiki: 'St. Peter und Paul (Hochheim am Main)',
        general_info: 'Katholische Pfarrkirche im Ortskern — Sakralbau der Weinbau-Gemeinde.',
        block: `Visuell: Kirchturm über Dächern der Altstadt.`,
      },
      {
        id: 'hochheim_am_main_hochheimer_weinbaumuseum',
        name: 'Hochheimer Weinbaumuseum',
        tier: 1,
        wiki: 'Hochheim am Main',
        wikiLimit: 24,
        general_info: 'Museum zur Geschichte des Hochheimer Weinbaus und der Keltertradition.',
        block: `Visuell: Museum in historischem Gebäude der Weinstadt.`,
        live: [LIVE('Öffnungszeiten vor Ort / Gemeinde recherchieren.')],
      },
      {
        id: 'hochheim_am_main_hochheimer_weinberge',
        name: 'Hochheimer Weinberge',
        tier: 2,
        wiki: 'Hochheim am Main',
        wikiAlt: ['Rheingau (Anbaugebiet)', 'Weinbau in Hessen'],
        wikiLimit: 18,
        general_info: 'Rebenhänge der Lage Hochheim mit Blick Richtung Main-Ebene.',
        block: `Visuell: Terrassierte Weinberge über dem Ort.`,
      },
      {
        id: 'hochheim_am_main_pension_eventlocation_tor_zum_rheingau',
        name: 'Pension & Eventlocation "Tor zum Rheingau"',
        tier: 2,
        wiki: 'Rheingau',
        wikiLimit: 10,
        general_info: 'Gasthof-Name verweist auf Hochheims Lage am Eingang des Rheingau.',
        block: `Visuell: Gasthaus an Durchgangsstraße Richtung Rheingau.`,
      },
    ],
  },
};

async function writeCity(cityId, cfg) {
  const spots = [];
  for (const def of cfg.spots) {
    spots.push(await buildSpot(def));
    await new Promise((r) => setTimeout(r, 120));
  }
  const out = {
    city_history: cfg.city_history,
    notes: ['Wave A — Wikipedia DE + manual visuell; LIVE ephemeral; no dialog scripts.'],
    offline_qa: cfg.offline_qa || [],
    city_facts_non_place: [],
    spots,
    new_places: [],
  };
  const fp = path.join(STAEDTE_DIR, `${cityId}.research-waveA.json`);
  fs.writeFileSync(fp, JSON.stringify(out, null, 2) + '\n', 'utf8');
  const pools = spots.map((s) => {
    const pool =
      (s.general_info || '').length +
      (s.deep_data_pool || []).reduce((a, e) => a + (e.text || '').length, 0);
    return { id: s.id, tier: s.place_tier, pool };
  });
  return { cityId, spots: spots.length, pools };
}

const cityIds = process.argv.slice(2);
const run = cityIds.length ? cityIds : Object.keys(CITIES);
const results = [];
for (const id of run) {
  if (!CITIES[id]) continue;
  results.push(await writeCity(id, CITIES[id]));
}
console.log(JSON.stringify(results, null, 2));
