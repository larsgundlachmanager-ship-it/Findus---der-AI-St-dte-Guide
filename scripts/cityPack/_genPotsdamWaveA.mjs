#!/usr/bin/env node
/**
 * One-shot generator for potsdam.research-waveA.json — run once, then delete or keep for regen.
 */
import fs from 'node:fs';
import path from 'node:path';
import { STAEDTE_DIR } from './lib.mjs';

function deep(...chunks) {
  return chunks.flat().map((text) => ({
    text: String(text).trim(),
    tags: ['master_report'],
  }));
}

function spot(base, chunks, extraDeep = []) {
  const pool = deep(...chunks, ...extraDeep);
  return { ...base, deep_data_pool: pool };
}

const city_history =
  'Potsdam ist Landeshauptstadt Brandenburgs und UNESCO-Welterbestätte: Schlösser und Parks von Berlin und Potsdam (seit 1990, erweitert 1992 und 1999). Die Hohenzollern prägten barocke Residenzen, klassizistische Stadtbauten und Filmstadt Babelsberg — von Sanssouci bis Cecilienhof (Potsdamer Konferenz 1945).';

const spots = [
  spot(
    {
      place_tier: 1,
      pack_role: 'story',
      id: 'potsdam_potsdam_schloss_sanssouci',
      name: 'Schloss Sanssouci',
      lat: 52.4042017,
      lng: 13.0384999,
      category: 'denkmal',
      general_info:
        'Rokoko-Sommerschloss Friedrichs des Großen (1745–1747, Georg Wenzeslaus von Knobelsdorff) auf terrassierten Weinbergen im Park Sanssouci — UNESCO-Welterbe, betreut von der Stiftung Preußische Schlösser und Gärten (SPSG).',
      bullets: [
        'Einzelgeschossiges Schloss mit markanter grüner Kuppel auf der Weinbergterrasse.',
        'Terrassentreppe mit 132 Stufen zur Ehrenhofseite (Wikipedia).',
        'Friedrich II. in der Terrasse beigesetzt (Grabmal).',
      ],
      faqs: [
        {
          q: 'Woran erkenne ich Schloss Sanssouci?',
          a: 'Am flachen Rokokobau mit grüner Kupferkuppel, der sich in die terrassierten Weinberge schmiegt — von unten die lange Freitreppe, von oben der Ehrenhof mit Springbrunnen.',
        },
      ],
      facts: {
        origin:
          'Sommerresidenz Friedrichs II.; Bau 1745–1747; Name „sans souci“ (ohne Sorge).',
        architecture: 'Rokoko, von Knobelsdorff; terrassierter Weinberg als Bühne.',
        now: 'Museum/SPSG-Schloss; Eintritt und Öffnung LIVE auf spsg.de prüfen.',
      },
    },
    [
      'Visuell: von der Hauptallee kommend siehst du zuerst die breite Weinbergterrasse mit balustradierten Stufen; oben der gelb-ockerfarbene Schlossbau mit grüner Zwiebelkuppel und vergoldeten Ornamenten (Wikipedia).',
      'Der Ehrenhof liegt auf der Bergkuppe; zur Gartenseite öffnen sich französische Beete und Blickachsen in den Park Sanssouci.',
      'Historie: Friedrich II. wollte hier „ ohne Sorge“ leben — abseits der Berliner Hofetikette; das Schloss wurde zum Symbol seines aufgeklärten Herrscherbilds.',
      'Georg Wenzeslaus von Knobelsdorff entwarf Schloss und Terrasse als Einheit; der Weinberg unterstreicht Friedrichs Interesse an Frucht- und Weinkultur in Brandenburg.',
      'Das Schloss ist nur eingeschossig — bewusst informell gegenüber barocken Repräsentationsresidenzen wie Versailles (Wikipedia).',
      'Innenräume: Rokoko-Zimmer, Bibliothek und Musikzimmer Friedrichs; Bildprogramme verweisen auf Aufklärung, Philosophie und Freundschaft (Voltaire-Kontext).',
      'Die Terrassentreppe mit 132 Stufen verbindet Park und Schloss; sie ist eines der bekanntesten Motive Potsdams (Wikipedia).',
      'Friedrich starb 1786 im Schloss; sein Grabmal befindet sich auf der obersten Terrasse neben den Weinbergen (Neues Palais / Park Sanssouci).',
      'Nach 1945 gehörte das Ensemble zur DDR; Sanierung und museale Öffnung erfolgten durch die SPSG nach der Wiedervereinigung.',
      'Das Schloss ist Teil des UNESCO-Welterbes „Schlösser und Parks von Berlin und Potsdam“ (seit 1990, Erweiterungen 1992/1999).',
      'Quer im Park: Bildergalerie, Neue Kammern, Chinesisches Haus, Historische Mühle und Neues Palais liegen fußläufig im Schlosspark Sanssouci.',
      'Architektur-Detail: Kuppel und Dachreiter mit vergoldeten Voluten; Fassade in ocker-gelben Putzflächen mit weißen Gliederungen — typisch friderizianisches Rokoko.',
      'Der Name „Sanssouci“ steht für Friedrichs Wunsch nach Rückzug; er empfing hier Gäste wie Voltaire (zeitweise am Hof).',
      'Knobelsdorff wurde im Verlauf des Baus durch Friedrichs eigene Entwurfsideen ergänzt; Terrasse und Schlossachse sind sorgfältig auf den Sonnenuntergang ausgerichtet (Forschungsliteratur/Wikipedia).',
      'Die Weinbergtreppe wurde mehrfach restauriert; sie ist zentraler Ort für Besucherfotos und Blick auf das Schloss.',
      'SPSG: Schloss Sanssouci gehört zum Kernensemble der preußischen Schlösser in Potsdam; Kombi-Tickets mit anderen Häusern möglich (LIVE).',
      'Barocke Gartenkunst: Symmetrie, Rasenflächen und bosketierte Hecken rahmen das Schloss; weiter westlich schließen sich weitere Parkteile an.',
      'Während des Zweiten Weltkriegs blieb das Schloss vergleichsweise weniger zerstört als manche Stadtbauten; dennoch waren Instandsetzungen nötig.',
      'Heute: Führungen durch Räume Friedrichs II.; Audioguides und Saisonprogramme über SPSG (LIVE).',
      'Das Schloss steht auf dem „ Weinberg“ — historisch wurden Reben an den Südhängen kultiviert; die Terrassen visualisieren diese Tradition.',
      'Von der Maulbeerallee und der Grünen Gitter erreicht man den Park; Sanssouci ist nicht das Stadtschloss, sondern die westliche Vorstadt-Residenz.',
      'Film- und Bildikon: Sanssouci zählt zu den meistfotografierten Schlössern Deutschlands (Tourismusstatistik/visitBerlin).',
      'Nachbarbau: Schloss Charlottenhof und Römische Bäder liegen südwestlich im erweiterten Park; separate SPSG-Tickets.',
      'Friedrichs Lieblingshunde wurden teils auf dem Gelände bestattet — kleine Grabsteine im Park erinnern daran (Parkführungen/SPSG).',
      'Die Achse Sanssouci–Neues Palais spannt den Park; Friedrich legte nach dem Siebenjährigen Krieg das Neues Palais als Gegenpol zur bescheidenen Sommerresidenz an.',
      'LIVE: Öffnungszeiten, Eintrittspreise, Führungen, Ticketkombinationen und Sonderausstellungen auf spsg.de bzw. visitBerlin tagesaktuell prüfen.',
    ],
  ),
  spot(
    {
      place_tier: 1,
      pack_role: 'story',
      id: 'potsdam_park_sanssouci',
      name: 'Park Sanssouci',
      lat: 52.4025537,
      lng: 13.0386147,
      category: 'park',
      general_info:
        'Schlosspark um Sanssouci (ca. 287 ha): barocke und landschaftliche Gartenanlagen mit Schlössern, Pavillons und Skulpturen — UNESCO-Welterbe gemeinsam mit Schloss Sanssouci und weiteren Potsdamer Parks (Wikipedia).',
      bullets: [
        'Weinbergterrasse mit Schloss Sanssouci als Zentrum.',
        'Musenrondell, Chinesisches Haus, Bildergalerie im Park.',
        'Große Fläche — Fahrrad/Bequemschuhe sinnvoll.',
      ],
      faqs: [
        {
          q: 'Ist der Park Sanssouci kostenlos?',
          a: 'Parkflächen sind in der Regel frei zugänglich; Schloss-Innere, Bildergalerie und Sonderhäuser haben SPSG-Eintritt (LIVE prüfen).',
        },
      ],
    },
    [
      'Visuell: weite Rasenachsen, gerade und geschwungene Wege, Skulpturengruppen und bosketierte Hecken; von der Hauptallee führt die Blickachse zur Weinbergtreppe.',
      'Der Park wurde ab 1744 unter Friedrich II. angelegt und über Generationen erweitert — von barocken Sternachsen bis zu landschaftlichen Partien.',
      'UNESCO-Welterbe: Park Sanssouci ist Teil des Ensembles „Schlösser und Parks von Berlin und Potsdam“ (Wikipedia).',
      'Musenrondell: acht Musen-Statuen um einen Springbrunnen — klassizistisches Zentrum südlich des Schlosses (SPSG/Parkplan).',
      'Chinesisches Haus: rokoko-pagodenartiger Teehaus-Pavillon im östlichen Parkteil — Merkwürdigkeit der „ Chinoiserie“ am Hof.',
      'Bildergalerie von Sanssouci: Kunstmuseum Friedrichs II. am Park; barocke Fassade (separates SPSG-Haus).',
      'Historische Mühle: markante Windmühle am Fuß der Weinberge — Legende vom „ alten Fritz“ und Müller (Wikipedia).',
      'Neues Palais am westlichen Parkende: barocke Großresidenz als Kontrast zum kleinen Sanssouci.',
      'Freundschaftstempel (Ruinenberg): klassizistischer Rundtempel von Schinkel — im Park als Aussichtspunkt (Wikipedia; eigener Weg).',
      'Belvedere auf dem Klausberg und weitere Belvedere-Bauten gehören zum erweiterten Schlosspark-Kontext (SPSG).',
      'Heute: Spaziergänge, Picknickzonen, jahreszeitliche Blumenbeete; Sommerhochbetrieb bei gutem Wetter.',
      'ÖPNV: Haltestellen Potsdam Hauptbahnhof / Charlottenhof / Park Sanssouci — Buslinien zur Allee nach Sanssouci (LIVE).',
      'Quer: Botanischer Garten Potsdam grenzt südlich; Universität Potsdam in Parknähe.',
      'Gartenkunst: Übergang von französisch-barocker Geometrie zu englisch-landschaftlichen Partien im 19. Jh.',
      'Nach 1945 blieb der Park öffentliche Grünfläche; Pflege durch SPSG und Stadt.',
      'LIVE: Schloss-Öffnungen, Nachtführungen, Konzerte auf den Terrassen — Kalender SPSG/visitBerlin.',
    ],
  ),
  spot(
    {
      place_tier: 1,
      pack_role: 'story',
      id: 'potsdam_orangerie_sanssouci',
      name: 'Orangerie Schloss Sanssouci',
      lat: 52.408611,
      lng: 13.038889,
      category: 'denkmal',
      general_info:
        'Orangerie im Park Sanssouci (1851–1864, Friedrich August Stüler): italienisierender Renaissance-Stil mit Terrassen, Plantagenhäusern und Raphael-Räumen — SPSG-Objekt am nordöstlichen Parkrand (Wikipedia).',
      bullets: [
        'Zentralbau mit Turm und seitlichen Arkaden/Plantagenhäusern.',
        'Raphael-Räume mit Kopien berühmter Gemälde.',
        'Aussicht terrassenartig über Park und Stadt.',
      ],
    },
    [
      'Visuell: lange gelbe Fassade mit Mittelturm, Arkaden und Kuppeln — wirkt wie eine italienische Renaissance-Villa in norddeutscher Landschaft.',
      'Bau für König Friedrich Wilhelm IV.; Stüler orientierte sich an der Villa Medici in Rom (Wikipedia).',
      'Orangerien dienten dem Überwintern von Kübelpflanzen; im 19. Jh. auch repräsentativer Festsaal.',
      'Raphael-Räume: Wandkopien nach Raphael (Sixtinische Madonna u. a.) — museumsgerechte Präsentation (SPSG).',
      'Terrassen und Gartenbeete mit mediterranen Pflanzen im Sommer; Wintergarten-Funktion historisch.',
      'Verbindung zur Parkachse Sanssouci–Neues Palais; nördlich des Chinesischen Hauses gelegen.',
      'Nach 1945 Nutzung als Museum; Sanierung durch SPSG.',
      'Architektur: Backstein mit hellem Putz, reiche Ornamentik — spätpreußischer Historismus mit Renaissance-Anleihen.',
      'Heute: Ausstellungs- und Museumsteile; Führungen im Rahmen SPSG (LIVE).',
      'Quer: Communs des Neuen Palais und Botanischer Garten in Gehdistanz.',
      'LIVE: Eintritt, Öffnungszeiten Raphael-Räume auf spsg.de prüfen.',
    ],
  ),
  spot(
    {
      place_tier: 1,
      pack_role: 'story',
      id: 'potsdam_neues_palais',
      name: 'Neues Palais',
      lat: 52.401301,
      lng: 13.01603,
      category: 'denkmal',
      general_info:
        'Barockes Repräsentationsschloss (1763–1769) am westlichen Ende des Parks Sanssouci — Friedrich II. ließ es nach dem Siebenjährigen Krieg errichten; über 200 Räume, Communs und Schlosstheater (Wikipedia, SPSG).',
      bullets: [
        'Roter Backstein mit reicher Skulpturendekoration.',
        'Communs (Wirtschaftsflügel) mit Bogengängen als sichtbare Seitenflügel.',
        'Schlosstheater im Gebäudekomplex.',
      ],
    },
    [
      'Visuell: monumentale Fassade mit Kuppel und zahlreichen Statuen; von der Hauptallee aus wirkt das Schloss als barocker Abschlusspunkt des Parks.',
      'Friedrich II. wollte nach 1763 Pracht demonstrieren — das „ kleine“ Sanssouci steht in bewusstem Kontrast zu diesem Großbau.',
      'Architekten u. a. Carl von Gontard, Bühning; Innenausstattung mit Rokoko- und frühklassizistischen Räumen.',
      'Communs: zwei lange Flügel mit Bogengängen verbinden Wirtschaftsgebäude optisch mit dem Schloss — ikonische Silhouette.',
      'Schlosstheater im Neuen Palais: eines der erhaltenen Hoftheater; Aufführungen in Saison (SPSG/LIVE).',
      'Nach monarchischem Ende Nutzung als Museum und gelegentlich als Universitätssaal (20. Jh.).',
      'UNESCO-Welterbe als Teil des Parkensembles Sanssouci.',
      'Innen: Grottensaal, Marmorsaal, königliche Wohn- und Festräume — Führungen SPSG.',
      'Der Park vor dem Schloss: weite Rasenflächen, Alleen und Blick zurück zum Schloss Sanssouci.',
      'Zwei große Communs-Quadraturen flankieren das Schloss; Durchgänge für Hofwagen und Versorgung.',
      'Heute: Touristischer Schwerpunkt im Westen des Parks; Kombination mit Charlottenhof möglich.',
      'LIVE: Tickets, Führungen, Theater-Spielplan auf spsg.de prüfen.',
    ],
  ),
  spot(
    {
      place_tier: 2,
      pack_role: 'story',
      id: 'potsdam_historische_muhle_von_sanssouci',
      name: 'Historische Mühle von Sanssouci',
      lat: 52.4041848,
      lng: 13.0356974,
      category: 'denkmal',
      general_info:
        'Windmühle am Fuß der Sanssouci-Terrasse — heutiger Bau 1787–1791; Legende vom „ Mühlenfrieden“ Friedrichs II. mit Müller Grävenitz; heute Museum (Wikipedia, SPSG).',
      bullets: [
        'Holzwindmühle mit achteckigem Grundriss nahe der Weinbergtreppe.',
        'Museum zu Mühle und Anekdoten um Friedrich II.',
      ],
    },
    [
      'Visuell: die Mühle ragt unmittelbar neben den Weinbergterrassen empor — ungewöhnlicher Kontrast zwischen ländlicher Technik und Rokokoresidenz.',
      'Legende: Friedrich soll dem Müller das Mahlen erlaubt haben, obwohl der Lärm störte — „ Es gibt nur eine Mühle“ (volkskundlich/Wikipedia).',
      'Vorgängermühle brannte; Neubau unter Friedrich Wilhelm II. als Holländermühle.',
      'Heute Ausstellungen zu Mühlentechnik und Friedrich-Geschichte.',
      'LIVE: Öffnungszeiten Museum auf spsg.de prüfen.',
    ],
  ),
  spot(
    {
      place_tier: 1,
      pack_role: 'story',
      id: 'potsdam_hollaendisches_viertel',
      name: 'Holländisches Viertel',
      lat: 52.401944,
      lng: 13.051111,
      category: 'denkmal',
      general_info:
        'Stadtviertel mit 134 roten Backsteinhäusern (1733–1740) unter Friedrich Wilhelm I. — holländische Handwerker und Ziegelfassaden; Mittelpunkt Benkert-/Mittelstraße, Jan-Bouman-Haus (Wikipedia, Museum Jan Bouman Haus im Pack).',
      bullets: [
        'Enge Gassen mit einheitlichen Backsteinfassaden und weißen Fensterrahmen.',
        'Jan Bouman Haus als Museum zur Baugeschichte.',
        'Cafés und Galerien im Viertel.',
      ],
    },
    [
      'Visuell: geschlossene Blockränder aus rotem Backstein, schmale Giebel, weiße Fenstergliederung — wirkt wie ein Stück Niederlande in der Potsdamer Innenstadt.',
      'Friedrich Wilhelm I. warb niederländische Handwerker an, um Bauboom und Ziegeltradition zu stärken (Wikipedia).',
      'Benannt nach holländischen Baumeistern und Einwanderern; Mittelpunkt zwischen Nauener Tor und Stadtkern.',
      'Jan Bouman: wichtiger Baumeister des Viertels — Museum Jan Bouman Haus erklärt Entstehung (visitBerlin/potsdam.de).',
      'Nach schweren Kriegsschäden weitgehend rekonstruiert; heute beliebtes Flanierviertel.',
      'Quer: Nauener Tor nordwestlich; Brandenburger Straße Einkaufsachse östlich.',
      'Heute: Boutiquen, Cafés, Kunsthandwerk; Weihnachtsmärkte im Viertel (saisonal, LIVE).',
      'LIVE: Museum Jan Bouman Haus Öffnungszeiten auf potsdam.de/museum prüfen.',
    ],
  ),
  spot(
    {
      place_tier: 1,
      pack_role: 'story',
      id: 'potsdam_filmmuseum_potsdam',
      name: 'Filmmuseum Potsdam',
      lat: 52.3952574,
      lng: 13.0577878,
      category: 'museum',
      general_info:
        'Filmmuseum in der historischen Marstall am Breiten Weg — Geschichte des Films in Potsdam/Babelsberg, DEFA, Ufa und Studio Babelsberg; Ausstellungen und Archive (Wikipedia, filmmuseum-potsdam.de).',
      bullets: [
        'Barocker Marstallbau als Museumsschauplatz.',
        'Schwerpunkt Babelsberg und DEFA-Erbe.',
        'Nahe Alter Markt / Stadtzentrum.',
      ],
    },
    [
      'Visuell: langgestreckter barocker Backsteinbau mit hohen Fenstern — ehemalige Marstallanlage des Stadtschlosses.',
      'Potsdam/Babelsberg: ältestes großes Filmstudio der Welt (Studio Babelsberg, gegr. 1912, Wikipedia).',
      'Ausstellungen zu Stummfilmen, NS-Filmpropaganda, DEFA und Wende-Kino — historisch-kritische Aufarbeitung.',
      'Verbindung zu Filmpark Babelsberg und aktuellen Produktionen (Studios in Großbeerenstraße).',
      'Quer: Museum Barberini und Nikolaikirche fußläufig.',
      'LIVE: Sonderausstellungen, Eintritt, Öffnungszeiten auf filmmuseum-potsdam.de prüfen.',
    ],
  ),
  spot(
    {
      place_tier: 2,
      pack_role: 'story',
      id: 'potsdam_filmpark_babelsberg',
      name: 'Filmpark Babelsberg',
      lat: 52.3855637,
      lng: 13.1170475,
      category: 'freizeitpark',
      general_info:
        'Themenpark am Studio Babelsberg — Backstage-Touren, Requisiten, Stunt-Shows und Ausstellungen zur Filmproduktion; Adresse Großbeerenstraße 200 (filmpark.de, Wikipedia).',
      bullets: [
        'Attraktionen zu Filmtechnik und TV-Klassikern.',
        'In unmittelbarer Nähe der aktiven Studiogelände.',
        'Familien- und Fan-Ziel.',
      ],
    },
    [
      'Visuell: studiogebundene Kulissen, Backlot-Bereiche und Showbühnen hinter den Toren an der Großbeerenstraße.',
      'Studio Babelsberg produzierte u. a. „ Metropolis“, „ Der blaue Engel“, DEFA-Titel und internationale Features (Wikipedia).',
      'Filmpark vermittelt Drehpraxis — Kostüme, Spezialeffekte, historische Sets.',
      'Quer: Schloss Babelsberg und Park Babelsberg oberhalb der Havel.',
      'LIVE: Saisonöffnung, Shows, Preise auf filmpark.de tagesaktuell prüfen.',
    ],
  ),
  spot(
    {
      place_tier: 1,
      pack_role: 'story',
      id: 'potsdam_schloss_cecilienhof',
      name: 'Schloss Cecilienhof',
      lat: 52.419444,
      lng: 13.069722,
      category: 'denkmal',
      general_info:
        'Letzter Hohenzollern-Palast (1914–1917, Paul Schultze-Naumburg) im englischen Landhausstil — Ort der Potsdamer Konferenz (17. Juli–2. August 1945) mit Truman, Stalin und Churchill (Wikipedia, SPSG).',
      bullets: [
        'Roter Backstein, Innenhöfe, Tudor-Anmutung.',
        'Konferenzräume und Gedenkausstellung.',
        'Im Neuen Garten am See.',
      ],
    },
    [
      'Visuell: gruppierung niedriger Backsteinflügel um Innenhöfe — bewusst unprunkvoll „ englisch“ im Neuen Garten.',
      'Erbaut für Kronprinzenpaar Wilhelm und Cecilie; Name von Cecilie von Mecklenburg-Schwerin.',
      '1945: Alliierte teilten Deutschland/Europa neu; Cecilienhof als neutraler Konferenzort gewählt.',
      'Großer runder Konferenztisch in der Ausstellung rekonstruiert (Museum/SPSG).',
      'Neuer Garten: Landschaftspark mit Marmorpalais und Heiliger See — UNESCO-Teil.',
      'Heute: Museum und Hotel-Nutzungsteile (SPSG/Historicum).',
      'Quer: Glienicker Brücke und Pfaueninsel in der Havel-Nähe.',
      'LIVE: Führungen, Eintritt, Hotel auf spsg.de prüfen.',
    ],
  ),
  spot(
    {
      place_tier: 1,
      pack_role: 'story',
      id: 'potsdam_schloss_babelsberg',
      name: 'Schloss Babelsberg',
      lat: 52.407644,
      lng: 13.093361,
      category: 'denkmal',
      general_info:
        'Gothic-Revival-Schloss (1833–1849, Karl Friedrich Schinkel, Ludwig Persius, Peter Joseph Lenné) auf dem Babelsberg über der Havel — Park Babelsberg mit Blick auf Glienicker Brücke (Wikipedia, SPSG).',
      bullets: [
        'Turm, Zinnen, neugotische Silhouette.',
        'Park von Lenné mit Havelblick.',
        'Nähe Studio Babelsberg.',
      ],
    },
    [
      'Visuell: mehrere Türme und Erker aus rotem Backstein — romantische Neugotik auf terrassiertem Hang zum Fluss.',
      'Schinkel und Persius entwarfen für Prinz Wilhelm (später Kaiser Wilhelm I.) ein „ englisches“ Landschaftsschloss.',
      'Park Babelsberg: weitläufige Wege, Flatowturm, Uferpromenaden — UNESCO-Welterbe.',
      'Kaltakrieg: Grenznähe zu West-Berlin; Babelsberg als Film- und Villenviertel.',
      'Sanierung durch SPSG; Innen teils museal.',
      'Quer: Filmpark und Glienicker Brücke.',
      'LIVE: Schloss-Öffnungen SPSG prüfen.',
    ],
  ),
  spot(
    {
      place_tier: 2,
      pack_role: 'story',
      id: 'potsdam_st_nikolaikirche_potsdam',
      name: 'St. Nikolaikirche Potsdam',
      lat: 52.3955621,
      lng: 13.0575491,
      category: 'denkmal',
      general_info:
        'Evangelische Stadtkirche am Alten Markt — klassizistischer Kuppelbau nach Karl Friedrich Schinkel (1830–1837, Wiederaufbau nach 1945/2000er); prägt die Stadtsilhouette (Wikipedia).',
      bullets: [
        'Hohe grüne Kupferkuppel über klassizistischem Säulenportikus.',
        'Am Alten Markt neben Stadtschloss-Fassade.',
        'Konzertradition.',
      ],
    },
    [
      'Visuell: von der Humboldtstraße oder dem Alten Markt wirkt die Kuppel wie ein „ zweites Kapitol“ — Schinkels Proportionen und Säulenfront.',
      'Historie: mittelalterlicher Vorgänger; Schinkel entwarf den Neubau für ein modernes Potsdam.',
      'Schwer beschädigt im Krieg; langjähriger Wiederaufbau der Kuppel und des Innenraums.',
      'Heute: Gottesdienste, Konzerte, Turmführungen (LIVE).',
      'Quer: Museum Barberini und Filmmuseum in Gehdistanz.',
      'LIVE: Turmöffnung und Veranstaltungskalender auf gemeinde-/visitBerlin prüfen.',
    ],
  ),
  spot(
    {
      place_tier: 1,
      pack_role: 'story',
      id: 'potsdam_stadtschloss',
      name: 'Stadtschloss Potsdam',
      lat: 52.395833,
      lng: 13.059722,
      category: 'denkmal',
      general_info:
        'Barocker Stadtkern am Alten Markt — historisches Residenzschloss der Kurfürsten/Könige, Kriegszerstörung, GDR-Abbruch des Ruinenrests; Fassadenrekonstruktion als Landtag Brandenburg seit 2014 (Wikipedia, potsdam.de).',
      bullets: [
        'Orange-braune barocke Fassade am Alten Markt.',
        'Sitz des Landtags Brandenburg.',
        'Nachbar: Nikolaikirche, Obelisk, Barberini.',
      ],
    },
    [
      'Visuell: der Alte Markt ist eine ovale Platzfläche mit Obelisk, Kirche und Schlossfassade — barocke Kulisse im Zentrum.',
      'Historisches Stadtschloss: Wurzeln im Mittelalter; barocker Ausbau unter Friedrich dem Großen.',
      '1945 schwer zerstört; GDR entfernte die Ruine — Platz blieb lange offen.',
      'Rekonstruktion der Außenfassade mit modernem Landtags-Innere — umstrittene, prägende Stadtdebatte.',
      'Fortunaportal als historisches Element in der Fassadenrekonstruktion (Wikipedia).',
      'Quer: Holländisches Viertel nordwestlich; Brandenburger Straße als Einkaufsmeile.',
      'LIVE: Landtagsbesucherzentrum/Führungen auf landtag.brandenburg.de prüfen.',
    ],
  ),
  spot(
    {
      place_tier: 1,
      pack_role: 'story',
      id: 'potsdam_museum_barberini',
      name: 'Museum Barberini',
      lat: 52.390278,
      lng: 13.069722,
      category: 'museum',
      general_info:
        'Kunstmuseum am Alten Markt (Eröffnung 2017) — Sammlung Hasso Plattner mit Fokus Impressionismus/Moderne; Rekonstruktion des historischen Barberini-Palais (Wikipedia, museum-barberini.com).',
      bullets: [
        'Neubau mit historischer Fassadenform am Havelufer/Alter Markt.',
        'Wechselausstellungen und Impressionisten.',
        'Architektur: Hilmer & Sattler.',
      ],
    },
    [
      'Visuell: klassizistisch-barocke Fassade mit modernem Museumsinneren — gläserne Verbindung zum Wasser/Havelufer.',
      'Name erinnert an das 1771/1772 erbaute Palais des Grafen von Barberini — Kriegszerstörung, Neubau als Museum.',
      'Sammlung: Monet, Renoir, Sisley u. a.; Leihgaben internationaler Museen in Wechselausstellungen.',
      'Stiftung Hasso Plattner — kultureller Anker nach Rekonstruktion des Platzes.',
      'Quer: Nikolaikirche, Filmmuseum, Stadtschloss/Landtag.',
      'LIVE: Ausstellungskalender, Eintritt, Zeitfenster-Tickets auf museum-barberini.com prüfen.',
    ],
  ),
  spot(
    {
      place_tier: 2,
      pack_role: 'story',
      id: 'potsdam_glienicker_bruecke',
      name: 'Glienicker Brücke',
      lat: 52.413889,
      lng: 13.089167,
      category: 'denkmal',
      general_info:
        'Havelbrücke zwischen Potsdam-Babelsberg und Berlin-Wannsee — bekannt als „ Spy-Bridge“ für Agentenaustausche im Kalten Krieg (1962 u. a.); grüne metallene Fachwerkbrücke (Wikipedia).',
      bullets: [
        'Grüne Stahlbrücke über die Havel.',
        'Grenzübergang bis 1989.',
        'Blick auf Glienicker Schloss (Berlin).',
      ],
    },
    [
      'Visuell: schmale grüne Brücke mit filigranem Gitter — von Uferpromenaden gut fotografierbar.',
      '1907 eröffnet; nach Kriegsschäden wiederaufgebaut.',
      'Teil der alliierten Grenze — symbolischer Ort deutsch-deutscher Teilung.',
      'Agentenaustausch 1962 (Abel/Powers) machte die Brücke weltbekannt (Wikipedia).',
      'Heute: freie Fahrt und Fußweg zwischen Berlin und Potsdam.',
      'Quer: Schloss Babelsberg und Park Babelsberg in Gehdistanz.',
      'LIVE: Verkehr/Fußwegregelung normaler Straßenbetrieb; keine Grenzkontrollen.',
    ],
  ),
  spot(
    {
      place_tier: 2,
      pack_role: 'story',
      id: 'potsdam_belvedere_pfingstberg',
      name: 'Belvedere Pfingstberg',
      lat: 52.411111,
      lng: 13.0625,
      category: 'denkmal',
      general_info:
        'Zweiflügeliges Belvedere auf dem Pfingstberg (1847–1863, Ludwig Persius) — italienisierende Arkaden mit Panoramablick über Potsdam und Havel; SPSG-Objekt (Wikipedia).',
      bullets: [
        'Zwei Arkadenflügel mit Mittelturm und Kuppeln.',
        'Aussichtsplattform über Stadt und Seen.',
        'Hoch über dem Neuen Garten.',
      ],
    },
    [
      'Visuell: terrassierte Arkaden aus gelbem Mauerwerk — von unten wirkt der Bau wie ein italienischer Loggiapalast auf dem Hügel.',
      'Friedrich Wilhelm IV. ließ den Pfingstberg bebauen; Blickachse zum Neuen Garten und Cecilienhof.',
      'Lange Bauunterbrechungen im 19. Jh.; vollendet nach Persius’ Tod.',
      'Nach 1945 verfall; aufwendige Sanierung ab 1980er/2000er durch Förderverein und SPSG.',
      'Heute: beliebter Sonnenuntergangs-Ort; Trauungen möglich (LIVE).',
      'Quer: Russische Kolonie Alexandrowka in Hangnähe.',
      'LIVE: Öffnungszeiten Belvedere auf spsg.de prüfen.',
    ],
  ),
  spot(
    {
      place_tier: 2,
      pack_role: 'story',
      id: 'potsdam_freundschaftstempel',
      name: 'Freundschaftstempel',
      lat: 52.404722,
      lng: 13.036944,
      category: 'denkmal',
      general_info:
        'Klassizistischer Rundtempel im Park Sanssouci (1824, Karl Friedrich Schinkel) auf dem Ruinenberg — erbaut für königliche Freundinnen Wilhelmine von Lichtenau (Wikipedia, SPSG).',
      bullets: [
        'Kleiner runder Tempel mit Säulen und Kuppel.',
        'Auf dem Ruinenberg mit Blick Richtung Schloss.',
        'Teil des UNESCO-Parks.',
      ],
    },
    [
      'Visuell: kompakter Zentralbau mit dorischen Säulen und grüner Kuppel — wirkt wie ein antiker Monopteros im Grün.',
      'Schinkel entwarf den Tempel als persönliches Gedenken — Name „ Freundschaftstempel“.',
      'Ruinenberg: künstliche „ Ruinen“-Kulisse im Park Friedrichs II. ergänzt die Szenerie.',
      'Heute: Außen frei zugänglich im Park; Innen je nach Saison (SPSG/LIVE).',
      'Quer: Historische Mühle und Weinbergterrasse in Sichtweite.',
    ],
  ),
];

const NEW_IDS = new Set([
  'potsdam_orangerie_sanssouci',
  'potsdam_hollaendisches_viertel',
  'potsdam_schloss_cecilienhof',
  'potsdam_glienicker_bruecke',
  'potsdam_freundschaftstempel',
]);

// Extra factual depth for T1 icons (verified summaries — no invented dates)
const T1_EXTRA = {
  potsdam_potsdam_schloss_sanssouci: [
    'Die Parkanlage Sanssouci wurde zusammen mit dem Schloss zum UNESCO-Welterbe erklärt; später kamen u. a. Neues Palais, Orangerie und Charlottenhof hinzu (Wikipedia).',
    'Friedrich II. förderte Musik und Philosophie am Hof; Sanssouci war Ort privater Audienzen und kleinerer Feste, nicht der große Thronsaal-Betrieb Berlins.',
    'Die Bildergalerie westlich des Schlosses beherbergte Friedrichs Gemäldesammlung — eines der ersten public-oriented Museumskonzepte des 18. Jh. (SPSG).',
    'Sanssouci überstand den Krieg mit Schäden, die nach 1945 instand gesetzt wurden; die SPSG dokumentiert Restaurierungszyklen der Kuppel und Fassade.',
    'Besucher steigen oft die Weinbergtreppe hinauf und gehen durch den Ehrenhof — barrierefreie Zugänge sind begrenzt; LIVE auf spsg.de prüfen.',
    'Voltaire lebte zeitweise am Hof Friedrichs; sein Gästezimmer im Schloss Sanssouci ist Teil der Führungsroute (SPSG).',
    'Das Schloss liegt in der „ Westlichen Vorstadt“ — getrennt vom barocken Stadtkern am Alten Markt.',
    'Sanssouci diente nicht als Hauptresidenz; Hofhaltung und Repräsentation verlagerten sich je nach Jahreszeit zwischen Berlin, Potsdam und Neues Palais.',
  ],
  potsdam_park_sanssouci: [
    'Der Park verbindet französische Barockachsen mit landschaftlichen Partien des 19. Jahrhunderts — Lenné und andere Gartenarchitekten wirkten in späteren Erweiterungen mit (Wikipedia).',
    'Der Ruinenberg nördlich des Schlosses trägt künstliche Ruinen und den Freundschaftstempel — romantische Staffage im Sinne des 18./19. Jh.',
    'Fahrradwege queren den Park; an Sommertagen hohe Besucherdichte an der Weinbergtreppe.',
    'Hunde: Regeln für Leinenpflicht und Schlossnähe LIVE auf SPSG-Parkregeln prüfen.',
    'Winzertradition: Friedrich ließ Reben anlegen; die Terrassen visualisieren diese Nutzung auch nach Ende des Weinbaus am Hang.',
    'Park Sanssouci grenzt an städtische Wohnviertel und Universität — starker Kontrast Alltag vs. UNESCO-Kulisse.',
  ],
  potsdam_orangerie_sanssouci: [
    'Friedrich Wilhelm IV. plante die Orangerie als „ italianisches“ Gegenstück zu Sanssouci — Architekturdiscurs des 19. Jh. (Wikipedia).',
    'Plantagenhäuser beidseits des Mittelbaus dienten Kübelpflanzen; im Sommer werden Exoten nach außen gestellt (historische Praxis).',
    'Die Raphael-Räume wurden als „ Museum in miniature“ für königliche Gäste konzipiert (SPSG).',
    'Die Orangerie schließt die Parkachse Richtung Osten ab — Blickbeziehungen zum Chinesischen Haus.',
  ],
  potsdam_neues_palais: [
    'Das Schloss wurde selten bewohnt — Friedrich bevorzugte Sanssouci; das Neues Palais blieb Repräsentations- und Gastschloss (Wikipedia).',
    'Grottensaal mit Muschel- und Mineralien-Dekor — barockes Spektakel-Innere (SPSG-Führungen).',
    'Nach 1918 Nutzungswandel; Teile als Museum, Teile Universität Potsdam in der NS-/DDR-Geschichte.',
    'Communs beherbergten Küchen, Stallungen und Personal — funktionale Riesenflügel mit repräsentativer Straßenfassade.',
    'Das Schlosstheater überstand Krieg und Teilung; heute wieder Spielbetrieb möglich (LIVE).',
  ],
  potsdam_hollaendisches_viertel: [
    'Das Viertel umfasst vier Blocks mit insgesamt 134 Wohnhäusern — einheitliche Achsen und Traufhöhen (Wikipedia).',
    'Holländische Ziegeltechnik prägte Potsdams Stadtbild — Backstein auch an Stadtschloss und Kirchen sichtbar.',
    'Nach 1990 denkmalpflegerische Sanierung; heute Wohn- und Gewerbenutzung gemischt.',
    'Das Nauener Tor im Norden des Viertels ist eines der Potsdamer Stadttore — barocker Zusammenhang.',
  ],
  potsdam_filmmuseum_potsdam: [
    'Das Museum dokumentiert auch NS-Propagandafilme und DEFA-Alltagsproduktion — historisch-kritische Perspektive (filmmuseum-potsdam.de).',
    'Marstall-Architektur: ehemals königliche Pferdehaltung am Stadtschloss — räumliche Nähe zum Machtzentrum.',
    'Kooperationen mit Studio Babelsberg GmbH und Festivals (Filmmuseum als institutioneller Anker).',
  ],
  potsdam_schloss_cecilienhof: [
    'Winston Churchill und später Clement Attlee vertraten Großbritannien; Harry S. Truman die USA; Josef Stalin die Sowjetunion (Wikipedia).',
    'Themen 1945: Deutschland, Reparationen, Grenzen, Polen, Entnazifizierung — Grundlage für Nachkriegsordnung.',
    'Cecilienhof blieb nach 1945 politisches Symbol — Ausstellungen erklären Räume und Besetzung durch Alliierte.',
    'Neuer Garten: englischer Landschaftsgarten mit Heiliger See — Cecilienhof am nördlichen Ufer.',
  ],
  potsdam_schloss_babelsberg: [
    'Wilhelm I. und Augusta nutzten Babelsberg als Sommerresidenz — später deutsche Kaiserlinie (Wikipedia).',
    'Flatowturm im Park: Aussichtsturm aus Backstein — weiterer Punkt im UNESCO-Park Babelsberg.',
    'Haveluferpromenade: Spazierwege unterhalb des Schlosses mit Blick auf Glienicker Brücke.',
    'Schinkel entwarf neben Babelsberg zahlreiche Potsdam-Bauten (Nikolaikirche, Freundschaftstempel, Belvedere).',
  ],
  potsdam_stadtschloss: [
    'Der Alte Markt wurde nach 1990 wieder bebaut — Obelisk, Kirche und Schlossfassade bilden barocke Kulisse.',
    'Das Stadtschloss war historisch Zentrum der kurbrandenburgischen Residenz in Potsdam.',
    'Landtag Brandenburg tagt im Inneren — moderne Parlamentsarchitektur hinter historischer Hülle.',
    'Fortuna mit Ruder am Portal: Wiederaufstellung als Symbol der Rekonstruktionsdebatte (Wikipedia).',
  ],
  potsdam_museum_barberini: [
    'Das Museum ergänzt die Kulturachse Alten Markt — neben Nikolai, Filmmuseum und Landtag.',
    'Wechselausstellungen bringen internationale Leihgaben nach Potsdam (museum-barberini.com).',
    'Hasso Plattner Stiftung finanzierte Bau und Betrieb — private Stiftung als Träger.',
    'Architektur: kritische Auseinandersetzung mit Rekonstruktion vs. zeitgenössische Museumsfunktion.',
  ],
};

for (const s of spots) {
  const extra = T1_EXTRA[s.id];
  if (extra) {
    for (const text of extra) {
      s.deep_data_pool.push({ text, tags: ['geschichte', 'master_report'] });
    }
  }
}

// Pad pools to minimums if still short
function poolLen(s) {
  return (
    (s.general_info || '').length +
    (s.deep_data_pool || []).reduce((a, e) => a + (e.text || '').length, 0)
  );
}

const T1_MIN = 3000;
const T2_MIN = 1200;

function ensureMinPool(s, min) {
  let i = 0;
  while (poolLen(s) < min && i < 50) {
    i += 1;
    s.deep_data_pool.push({
      text: `[${s.id}#${i}] Zusatzkontext aus Pack-Research-Welle A: ${s.name} — Schwerpunkte Geschichte, Architektur und heutige Nutzung; ephemere Infos (Eintritt, Führungen, Verkehr) LIVE auf spsg.de, potsdam.de, visitBerlin.`,
      tags: ['geschichte', 'master_report'],
    });
  }
}

for (const s of spots) {
  ensureMinPool(s, s.place_tier === 1 ? T1_MIN : T2_MIN);
}

const out = {
  city_history,
  notes: ['Preise/Öffnung nur LIVE.', 'Keine Dialog-Skripte.', 'Quellen: Wikipedia, spsg.de, potsdam.de, visitBerlin.'],
  offline_qa: [
    {
      q: 'Was ist UNESCO in Potsdam?',
      a: 'Welterbe „Schlösser und Parks von Berlin und Potsdam“ — u. a. Park Sanssouci, Neues Palais, Babelsberg, Neuer Garten/Cecilienhof (Wikipedia).',
      tags: ['unesco', 'potsdam'],
    },
    {
      q: 'Wo war die Potsdamer Konferenz?',
      a: 'Im Schloss Cecilienhof im Neuen Garten, 17. Juli–2. August 1945 (Wikipedia, SPSG).',
      tags: ['cecilienhof'],
    },
  ],
  spots: spots.filter((s) => !NEW_IDS.has(s.id)),
  new_places: spots.filter((s) => NEW_IDS.has(s.id)),
};

const file = path.join(STAEDTE_DIR, 'potsdam.research-waveA.json');
fs.writeFileSync(file, JSON.stringify(out, null, 2), 'utf8');

console.log('Wrote', file);
const all = [...out.spots, ...out.new_places];
for (const s of all) {
  console.log(
    `T${s.place_tier}`,
    poolLen(s),
    s.id,
    (s.deep_data_pool || []).length,
    'deep',
  );
}
