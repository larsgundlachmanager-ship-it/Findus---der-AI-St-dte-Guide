#!/usr/bin/env node
import path from 'node:path';
import { DEPTH_PAD, DEPTH_PAD_B, DEPTH_PAD_C, DEPTH_PAD_D } from './umlandWaveADepthPad.mjs';
import { STAEDTE_DIR, loadPack, writeJson } from './lib.mjs';

const LIVE_GENERIC =
  'LIVE: Öffnungszeiten, Eintritt, Führungen und Tarife ephemer auf offiziellen Tourismus- oder Betreiber-Websites prüfen.';

function pool(lines) {
  return lines.map((text) => ({
    text,
    tags: text.startsWith('LIVE')
      ? ['live_hint', 'ephemeral']
      : text.startsWith('Visuell') || text.startsWith('Quer')
        ? ['master_report', text.startsWith('Visuell') ? 'visuell' : 'quer']
        : ['master_report'],
  }));
}

function mergedLines(id, base) {
  return [
    ...base,
    ...(DEPTH_PAD[id] || []),
    ...(DEPTH_PAD_B[id] || []),
    ...(DEPTH_PAD_C[id] || []),
    ...(DEPTH_PAD_D[id] || []),
  ];
}

function spotEntry(id, pack, general_info, lines, extra = {}) {
  const s = pack.spots.find((x) => x.id === id);
  if (!s) {
    console.warn(`[skip] ${pack.city_id}: missing spot ${id}`);
    return null;
  }
  const allLines = mergedLines(id, lines);
  return {
    id,
    name: s.name,
    lat: s.lat,
    lng: s.lng,
    place_tier: extra.place_tier ?? s.place_tier,
    pack_role: s.pack_role || 'story',
    general_info,
    deep_data_pool: pool(allLines),
    faqs: extra.faqs || [],
    bullets: extra.bullets || [],
    facts: extra.facts,
  };
}

const SPOT_LINES = {
  spreewald_schloss_lubbenau: {
    general_info:
      'Schloss Lübbenau am Spreeufer: barock-neoklassizistische Residenz mit Park und Orangerie — Wahrzeichen der Kahnfahrerstadt im UNESCO-Biosphärenreservat Spreewald.',
    lines: [
      'Visuell: heller Schlossbau mit Mansarddach und Orangerie am Wasser; von der Spree aus Kähne, Uferpromenade und Schlosspark mit altem Baumbestand.',
      'Das Schloss entstand ab 1682 für die Familie von Dyhrn auf älteren Grundmauern; mehrfache Umbauten prägten die heutige Silhouette (Wikipedia).',
      'Im 18. Jahrhundert gehörte das Anwesen der Familie Promnitz; der Park wurde als Lustgarten und Wirtschaftshof genutzt.',
      '1813 erwarb Friedrich Wilhelm von Redern das Schloss; er ließ es im neoklassizistischen Stil erweitern und den Park neu gestalten.',
      'Die Orangerie Schloss Lübbenau diente dem Überwintern von Kübelpflanzen und ist heute Veranstaltungs- und Ausstellungsort.',
      'Nach 1945 Nutzung als Kinderheim und später als Hotel; Sanierung der Außenanlagen und des Parks in den 1990er/2000er Jahren.',
      'Heute beherbergt das Schloss ein Hotel mit Restaurant; der Schlosspark ist öffentlich begehbar und verbindet Altstadt und Hafen.',
      'Architektur: zweigeschossiger Kern mit Mansarddach, symmetrische Nebengebäude und Wirtschaftshof — typisch brandenburgische Adelssitze.',
      'Historische Verbindung zur Spreewald-Kahnfahrt: Adel und Handel nutzten Wasserwege; der Hafen liegt unmittelbar in der Nähe.',
      'Im Schlosspark finden Konzerte, Märkte und kulturelle Veranstaltungen statt — Termine saisonal (Tourismus Lübbenau).',
      'Quer: Freilandmuseum Lehde per Kahn oder Rad erreichbar; Großer Spreewaldhafen und Kleiner Hafen für Kahnabfahrten.',
      'Sorbische/wendische Kultur prägt Lübbenau: Gurken, Tracht und Dialekt im Umland des Schlosses spürbar.',
      'Der Lehder Graben und die Hauptspree verbinden Schloss, Altstadt und Außendörfer zu einem Wasserstraßen-Netz.',
      'Friedliche Parkanlage mit Teichen und Alleen — im Frühjahr Kahn-Hauptsaison, im Herbst Nebel über den Gräben.',
      'Das Schloss ist kein Museum im engeren Sinn; Innenbesichtigung nur im Rahmen von Hotel/Gastronomie oder Events.',
      'Denkmalschutz und Biosphärenreservat begrenzen bauliche Eingriffe — Erhalt der historischen Uferlinie am Schloss.',
      'Wikipedia verweist auf Verbindungen zur schlesischen Promnitz-Linie und zur preußischen Provinzialgeschichte.',
      'Fun Fact: Lübbenau wird oft „Kahnfahrerstadt“ genannt — das Schloss bildet das städtische Gegenstück zur flachen Kahnkultur.',
      'Der Schlosspark verbindet Spreeuferwege mit der Orangerie — Spaziergäste sehen Kähne unterhalb der Terrasse.',
      'Sanierungsphasen dokumentierten barocke Fundamente unter späteren Putzschichten — Baugeschichte mehrphasig.',
      'Regionalmuseum und Heimatverein Lübbenau vermitteln ergänzend Stadtgeschichte jenseits des Schlosses.',
      LIVE_GENERIC,
    ],
  },
  spreewald_freilandmuseum_lehde: {
    general_info:
      'Freilandmuseum Lehde: museumsgerechter Spreewald-Ortsteil mit Hofanlagen, Tracht und Handwerk — zentraler Ort für wendische Alltagsgeschichte.',
    lines: [
      'Visuell: reetgedeckte Blockbauten, Wiesenstreifen zwischen Wassergräben, Rauch aus Schornsteinen — Lehde wirkt wie eingefrorener Dorfkern.',
      'Lehde ist einer der kleinsten Ortsteile Lübbenaus und liegt mitten im Biosphärenreservat Spreewald (Wikipedia).',
      'Das Freilandmuseum zeigt historische Hofanlagen, Küchen, Werkstätten und sorbische/wendische Lebensweise.',
      'Typische Spreewaldhäuser: Blockbau, Reetdach, farbige Fensterrahmen — Anpassung an feuchtes Klima und Hochwasser.',
      'Gurkenanbau und -verarbeitung gehörten zum Hofwirtschaftssystem; Gurkenmuseum und Verkostung in der Region belegt.',
      'Kahnfahrt nach Lehde: Abfahrten u. a. vom Großen Spreewaldhafen; Gräben enger als auf der Hauptspree.',
      'Das Museum vermittelt Handwerk: Weben, Schmieden, Küche — Demonstrationen je nach Saison und Programm.',
      'Lehde wurde durch Tourismus und Museum bekannt, blieb aber Wohnort mit wenigen Einwohnern.',
      'Historisch wendische Siedlungsstruktur: Streusiedlung entlang der Gräben statt klassischer Straßendorf-Achse.',
      'Quer: Radweg Lehde verbindet Lübbenau mit Außendörfern; Schleuse Lehde an der Hauptspree in der Nähe.',
      'UNESCO-Biosphärenreservat Spreewald seit 1991 — Lehde liegt im Kernzone-Umfeld mit strengen Naturschutzregeln.',
      'Vogel- und Fischreichtum der Gräben prägt das Freilandmuseum-Außengelände; Störche und Wasservögel häufig.',
      'Winter: ruhige Gräben, Reetdächer; Sommer: Hauptsaison für Museum und Kahn — Wartezeiten an Hafenstegen möglich.',
      'Das Freilandmuseum ist eine der bekanntesten kulturellen Adressen im Spreewald neben Kahnfahrt und Schloss Lübbenau.',
      'Leben jetzt: Museumsgastronomie und Souvenirs mit Spreewald-Motiven; Trachtenvereine in der Region aktiv.',
      'Sorbische Sprache und Brauchtum werden in Museumsszenen erklärt — Dialekt „Wendisch“ in Ausstellungen.',
      'Historische Landwirtschaft: Rinder, Gänse und Gemüseanbau auf engen Hofflächen zwischen Gräben.',
      'Schleuse Lehde reguliert Wasserstand zwischen Lehder Fließ und Hauptspree — technisches Denkmal nebenan.',
      LIVE_GENERIC,
    ],
  },
  spreewald_grosser_spreewaldhafen_lubbenau: {
    general_info:
      'Großer Spreewaldhafen Lübbenau: zentraler Steg für Kahnfahrten, Gastronomie und Spreewald-Einstieg — Startpunkt vieler Rundfahrten.',
    lines: [
      'Visuell: breite Wasserfläche mit anliegenden Kahnen, Landungsstegen, Gastronomie und Blick auf Altstadt und Schlosspark.',
      'Gewerbliche Kahnfahrten starten hier in Richtung Lehde, Burg, Schlepzig und Hauptspree — traditionelles Ruderboot ohne Motor.',
      'Kahnfährleute erklären auf Deutsch und oft Englisch; Standardrouten dauern typischerweise 1–2 Stunden (Betreiber variieren).',
      'Lübbenau trägt den Beinamen Kahnfahrerstadt; der Hafen ist touristisches Zentrum neben Spreewaldhof und Altstadt.',
      'Historisch dienten Kähne dem Transport von Gurken, Torf und Holz — heute überwiegend Tourismus.',
      'Quer: Kleiner Hafen am Spreeschlößchen und weitere private Anbieter ergänzen das Angebot.',
      LIVE_GENERIC,
    ],
  },
  spreewald_lubbenau: {
    general_info:
      'Lübbenau/Spreewald: Kernstadt im Biosphärenreservat mit Altstadt, Spreewaldhof, Gurkenhandel und Kahnhäfen — Tor zum Spreewald.',
    lines: [
      'Visuell: Fachwerk und Putzbauten in der Altstadt, Spreewaldhof mit Gastronomie, Türme der Stadtkirche, Gräben am Rand.',
      'Erste Erwähnung des Ortes im 13. Jahrhundert; wendische Besiedlung und später deutsche Hohenzollern-Herrschaft (Wikipedia).',
      'Spreewaldhof: zentraler Platz mit Gastronomie, Veranstaltungen und Marktcharakter — Wahrzeichen der Innenstadt.',
      'Gurken aus dem Spreewald sind EU-weit geschützte Herkunftsbezeichnung; Verkauf und Verkostung in der Altstadt üblich.',
      'Bahnhof Lübbenau verbindet mit Berlin und Cottbus; viele Tagesgäste starten hier Kahnfahrten.',
      'Altstadt mit Boutiquen, Cafés und sorbischen Souvenirs; Fußgängerzonen und enge Gassen.',
      'Quer: Schloss und Große Hafen fußläufig; Radwege ins Außengebiet Lehde und Straupitz.',
      LIVE_GENERIC,
    ],
  },
  spreewald_kleiner_hafen_am_spreeschlosschen_lubbenau_kahnfahrmannsverein_der_spr: {
    general_info:
      'Kleiner Hafen am Spreeschlößchen: traditioneller Kahnabfahrtsort des Kahnfährmannsvereins — ruhiger als der Große Hafen.',
    lines: [
      'Visuell: enger Hafenbecken mit Spreeschlößchen-Gastronomie, hölzerne Stege und flache Spreewaldkähne.',
      'Der Kahnfährmannsverein der Spreewaldfreunde bietet Fahrten in kleineren Gruppen an — familiärer Charakter.',
      'Abfahrten oft in Richtung Lehde und Nebengräben; Ruderboot ohne Motor gemäß Spreewald-Tradition.',
      'Quer: wenige Gehminuten zum Großen Spreewaldhafen und Schlosspark.',
      LIVE_GENERIC,
    ],
  },
  beelitz_mannersanatorium_beelitz_heilstatten: {
    general_info:
      'Männersanatorium der Beelitz-Heilstätten: monumentaler Backsteinbau des frühen 20. Jahrhunderts — prägendes Gebäude der ehemaligen Lungenheilanstalt.',
    lines: [
      'Visuell: lange Fassaden aus rotem Klinker, Erker und Türme, von Baumalleen umrahmt — ikonisch für Beelitz-Heilstätten-Fotografien.',
      'Die Heilstätten entstanden 1898–1930 als Lungenheilanstalten der Berliner Lebensversicherungsanstalt — einer der größten Heilanlagen Europas (Wikipedia).',
      'Architekt Heino Schmieden und weitere planeten Pavillon-Anlagen in Parklandschaft — Luftkur und Sonnenlicht als Therapie.',
      'Männer- und Frauensanatorien getrennt; Wirtschaftsgebäude, Kochküche und Alpenhaus ergänzen das Ensemble.',
      'Nach 1945 sowjetische Militärkrankenhaus-Nutzung; später zivilmedizinische Nutzung und teilweise Leerstand.',
      'Seit den 1990ern Teile als Reha-Kliniken, Baumwipfelpfad und Baumkronenpfad-Tourismus — Denkmalschutz für Backsteinbauten.',
      'Die Beelitz-Heilstätten sind Kulisse für Film und Fotografie; verfallene Flügel nur geführt zugänglich.',
      'Historie: Tuberkulose-Bekämpfung prägte Medizingeschichte; frische Waldluft und Ruhe als Behandlungskonzept.',
      'Quer: Baumkronenpfad Beelitz in den Kiefern nördlich der Anlagen; Führungen durch ausgewählte Flügel (Anbieter variieren).',
      'Parkartige Alleen zwischen Pavillons — Rehe und alte Baumalleen in der Heilstätten-Landschaft.',
      'Frauenpavillon und Kochküche als weitere markante Bauten im Gesamtensemble Beelitz-Heilstätten.',
      'Bahnhof Beelitz-Heilstätten verbindet mit Berlin; viele Besucher kommen für Baumkronenpfad und Architektur.',
      'Denkmalpflege und Investorprojekte versuchen Erhalt und Nutzung in Balance — nicht alle Gebäude öffentlich zugänglich.',
      'Leben jetzt: geführte Touren, Baumkronenpfad-Tickets, Reha-Patienten in aktiven Klinikflügeln.',
      'Backsteinformate und Gesimsbänder unterscheiden Männer- von Frauensanatorium — architekturhistorische Details.',
      'Alpenhaus und Wirtschaftshof illustrieren autarke Versorgung der Lungenheilanstalt vor Antibiotika-Zeit.',
      LIVE_GENERIC,
    ],
  },
  beelitz_beelitz_heilstatten: {
    general_info:
      'Beelitz-Heilstätten: weitläufiges Sanatoriumsensemble aus Backsteinpavillons in Waldlage — Medizin-, Architektur- und Erlebnisgeschichte südwestlich von Berlin.',
    lines: [
      'Visuell: Dutzende Pavillons, Verbindungsgänge und Wirtschaftsgebäude zwischen Kiefern — verfallene und sanierte Flügel nebeneinander.',
      'Entwicklung ab 1898 als Lungenheilanstalt der Berliner Versicherung; Erweiterungen bis in die 1930er (Wikipedia).',
      'Nach 1945 bis 1994 sowjetisches Militärkrankenhaus; danach gemischte zivile Nutzung.',
      'Heute: Reha-Kliniken, Natur-Park, Baumkronenpfad, Baum & Zeit mit Barfußpark und Baumwipfelpfad in der Region.',
      'Quer: Männersanatorium und Frauenpavillon als fotogene Hauptbauten; Alpenhaus als markantes Nebengebäude.',
      LIVE_GENERIC,
    ],
  },
  beelitz_baumkronenpfad_beelitz: {
    general_info:
      'Baumkronenpfad Beelitz: hölzerner Hängebrücken- und Aussichtspfad in den Kiefern bei den Beelitz-Heilstätten — Erlebnisweg in ca. 40 m Höhe.',
    lines: [
      'Visuell: gelbe und rote Holzbrücken zwischen Kiefernwipfeln, Aussichtsplattformen und Spiral-Treppe — weithin sichtbar aus dem Wald.',
      'Eröffnet 2015 als Erlebnispfad der Baumkronenpfad Beelitz GmbH in der Nähe der historischen Heilstätten (Wikipedia, Betreiber).',
      'Rundweg mit Hängebrücken, Seilrutsche optional und Aussicht auf Heilstätten-Architektur und Wald.',
      'Der Pfad ergänzt ältere Baumwipfelpfade in Brandenburg; Tickets und Zeiten am Eingang bzw. online.',
      'Quer: Architektur-Touren in Heilstätten-Flügeln oft kombinierbar; Bahnhof Beelitz-Heilstätten fußläufig erreichbar.',
      'Leben jetzt: familienfreundlicher Waldparcours; wetterabhängige Öffnung — Windeinschränkungen möglich.',
      'Der Pfad liegt in Kiefern des Naturparks — barrierefreie Teile und WC am Eingang (Betreiberangaben).',
      'Länge und Höhe machen ihn zum längsten Baumkronenpfad der Region — Architektur aus Holz und Stahlseilen.',
      LIVE_GENERIC,
    ],
  },
  oranienburg_gedenkstatte_und_museum_sachsenhausen: {
    general_info:
      'Gedenkstätte und Museum Sachsenhausen: ehemaliges Konzentrationslager (1936–1945) und sowjetisches Speziallager — zentraler Ort der Erinnerung.',
    lines: [
      'Visuell: lagertypische Baracken, Wachtürme, Appellplatz und Gedenkstätten — weitläufige, nüchterne Anlage nördlich Oranienburg.',
      'Das KZ Sachsenhausen wurde 1936 von der SS errichtet — Modellager nahe der Reichshauptstadt (Stiftung Brandenburgische Gedenkstätten).',
      'Zehntausende Häftlinge starben durch Hunger, Krankheit, Misshandlung und Erschießungen; Todesmarsch 1945.',
      'Nach 1945 bis 1950 sowjetisches Speziallager Nr. 7 auf Teilen des Geländes — tausende weitere Tote.',
      'Heute: Stiftung Brandenburgische Gedenkstätten; Dauerausstellung, Archive und Bildungsarbeit.',
      'Appellplatz, Schutzhaftlager, Station Z und sowjetisches Ehrenmal gehören zu den zentralen Stationen.',
      'Internationale Häftlinge aus vielen Ländern; Sachsenhausen als Ausbildungs- und Verwaltungszentrum der SS.',
      'Gedenkveranstaltungen am 27. Januar und am Jahrestag der Befreiung 1945.',
      'Quer: Oranienburg Schloss und Havel in der Nähe — Kontrast barocker Residenz und NS-Verbrechensort.',
      'Besucherzentrum und Führungen in mehreren Sprachen; Respektvolle Kleidung und Verhalten erwartet.',
      'Opfergruppen: politische Gefangene, Juden, Sinti und Roma, Homosexuelle, „Asoziale“ u. a. — differenzierte Ausstellungen.',
      'Lagermauer und Wachtürme zeigen die ursprüngliche Geometrie; Teile rekonstruiert, Teile original.',
      'Leben jetzt: Bildungsreisen, Archive für Nachfahren, digitale Gedenkprojekte der Stiftung.',
      'Gedenkstätte kooperiert mit Schulen und internationalen Partnern — Bildungsprogramme ganzjährig.',
      'Stiftung Brandenburgische Gedenkstätten betreut mehrere NS- und Sowjetzeit-Orte in Brandenburg.',
      LIVE_GENERIC,
    ],
  },
  oranienburg_schlossmuseum_oranienburg: {
    general_info:
      'Schloss Oranienburg: erste barocke Hohenzollern-Residenz in Brandenburg — Schlossmuseum zu Oranien-Nassau und preußischer Frühgeschichte.',
    lines: [
      'Visuell: heller Putzbau mit rotem Ziegeldach am Schlosshafen der Havel; Schlosspark und Orangerie im Umfeld.',
      'Erbaut ab 1651 für die Große Kurfürstin Luise Henriette von Oranien — Namensgeberin der Stadt (Wikipedia).',
      'Johann Gregor Memling: „Luise-Altar“ und bedeutende Kunstsammlung im Museum (SPSG/Museum Oranienburg).',
      'Barockgarten und Schlosspark mit Skulpturen; Havelufer mit Schlosshafen für Boote.',
      'Schlossmuseum zeigt Oranier-Geschichte, preußische Frühzeit und lokale Ausstellungen.',
      'Nach Kriegsschäden und DDR-Nutzung restauriert; heute museumspädagogische Programme.',
      'Quer: Gedenkstätte Sachsenhausen in derselben Stadt — historischer Kontrast 17. vs. 20. Jahrhundert.',
      'Orangerie im Schlosspark für Veranstaltungen; Spielplatz und Café im Park.',
      'Architektur: niederländisch beeinflusstes Barock — Fensterachsen und Giebel betont.',
      'Leben jetzt: Schlossmuseum mit wechselnden Sonderausstellungen; Schlosspark frei zugänglich.',
      'Großer Kurfürst Friedrich Wilhelm nutzte Oranienburg als Residenz vor Berliner Expansion — politische Bedeutung.',
      'Havel-Schifffahrt verbindet Schlosshafen mit Berlin und Fürstenberg — Wasserstraße historisch.',
      LIVE_GENERIC,
    ],
  },
  oranienburg_schlosspark_oranienburg: {
    general_info:
      'Schlosspark Oranienburg: barocke Parkanlage am Havelufer mit Orangerie — grüner Rahmen des Schlosses und Schlosshafens.',
    lines: [
      'Visuell: Wiesen, Alleen, Havelblick und Orangerie — offene Parklandschaft hinter dem Schloss.',
      'Entstand parallel zum Schossbau im 17. Jahrhundert; spätere Umgestaltungen im Landschaftsstil.',
      'Schlosshafen und Caravan-Stellplatz am Wasser; Bootsanleger für Havel-Touren.',
      'Quer: Schlossmuseum und Gedenkstätte Sachsenhausen — unterschiedliche Erinnerungsorte in Oranienburg.',
      LIVE_GENERIC,
    ],
  },
  werder_insel_werder: {
    general_info:
      'Inselstadt Werder (Havel): historische Kernstadt auf einer Havelinsel — Plantagen, Markt und Baumblütenfest.',
    lines: [
      'Visuell: enge Gassen, Backsteinfassaden, Obstplantagen und Havelufer — Inselcharakter mit Brücken und Fähren.',
      'Werder liegt an der Einmündung der Glindowsee-Kette in die Havel; Insel seit Mittelalter besiedelt (Wikipedia).',
      'Baumblütenfest seit 1879 — eines der ältesten Feste Deutschlands; Hauptsaison Ende April/Anfang Mai (Kirschblüte).',
      'Plantagen prägen Stadt und Wirtschaft; Werder ist traditionelles Obstanbaugebiet Brandenburgs.',
      'Marktplatz und historische Altstadt mit Cafés; Fußgängerzonen auf der Insel.',
      'Quer: Heilig-Geist-Kirche und Inselsteg; Anlegestellen für Havel-Schifffahrt nach Potsdam und Berlin.',
      LIVE_GENERIC,
    ],
  },
  werder_heilig_geist_kirche: {
    general_info:
      'Heilig-Geist-Kirche Werder: Backsteinkirche der Inselstadt — prägendes Sakralbauwerk nahe Markt und Havel.',
    lines: [
      'Visuell: Backsteingotik mit Turm, nahe Markt und Ufer — Orientierungspunkt in der Altstadt.',
      'Evangelische Gemeinde Werder/Havel; historischer Kernbau mit späteren Ergänzungen (Wikipedia/Kirchenführer).',
      'Quer: Baumblütenfest und Plantagenrundgänge starten oft in der Altstadt um die Kirche.',
      LIVE_GENERIC,
    ],
  },
  werder_werder_havel_markt: {
    general_info:
      'Markt Werder (Havel): Zentrum der Inselstadt mit Rathaus-Umfeld, Cafés und Obstverkauf — soziales Herz Werders.',
    lines: [
      'Visuell: Platz mit Rathaus-Fassade, Gastronomie, Marktständen — besonders während Baumblütenfest.',
      'Historischer Marktplatz der Inselstadt; Verbindung zu Plantagen und Havelpromenade.',
      'Quer: Heilig-Geist-Kirche und Schiffsanleger fußläufig.',
      LIVE_GENERIC,
    ],
  },
  brandenburg_havel_dom_st_peter_und_paul: {
    general_info:
      'Dom St. Peter und Paul auf der Dominsel: größte mittelalterliche Kirche Brandenburgs — romanisch-gotischer Backsteinbau.',
    lines: [
      'Visuell: massiver Backsteindom mit Türmen auf der Dominsel, umgeben von Havelarmen und Altstadt.',
      'Kernbau 12.–14. Jahrhundert; wichtigste Bischofskirche der Mark Brandenburg (Wikipedia).',
      'Dominsel gilt als historische Wiege Brandenburgs — slawische Burg Brandenburg und späterer Bischofssitz.',
      'Innen: gotische Hallen, Grabdenkmäler und Ausstellungen zur Kirchengeschichte.',
      'Architektur: Backstein gotik typisch für Norddeutschland; romanische Anteile im Chor.',
      'Quer: Altstadt Brandenburg, Rathaus und St.- Katharinen-Kirche auf der anderen Havelseite erreichbar.',
      'Dommuseum und Führungen zu Architektur und Bischofsgeschichte.',
      'Havel umfließt die Dominsel — Brücken verbinden mit Neustadt und Altstadt.',
      'Leben jetzt: Gottesdienste, Konzerte und Kulturveranstaltungen im Dom.',
      'Silhouette der Doppeltürme prägt Stadtpanorama von Havel und Neustadt aus — Orientierungspunkt.',
      'Dom wurde mehrfach restauriert nach Kriegsschäden — heutige Dachform und Farbe dokumentiert.',
      'Bischofsgeschichte verbindet Dominsel mit Christianisierung der Slawen in der Mark.',
      LIVE_GENERIC,
    ],
  },
  brandenburg_havel_brandenburg_altstadt: {
    general_info:
      'Brandenburg Altstadt: mittelalterliche Stadt auf der Insel in der Havel mit Fachwerk, Kirchen und historischem Hafen.',
    lines: [
      'Visuell: Fachwerkhäuser, Kirchtürme, Havelpromenade und enge Gassen — kleinstädtische Atmosphäre.',
      'Altstadt auf der Inselstadt in der Havel; gegründet als slawische Siedlung und deutsche Stadt (Wikipedia).',
      'St.- Katharinen-Kirche und weiteres Backsteinerbe in der Altstadt.',
      'Historischer Hafen und Schifffahrt auf der Havel; Radwege entlang des Flusses.',
      'Quer: Dominsel mit St.- Peter-und-Paul-Dom über Brücken erreichbar.',
      LIVE_GENERIC,
    ],
  },
  brandenburg_havel_rathaus_brandenburg: {
    general_info:
      'Rathaus Brandenburg an der Havel: spätgotischer Backsteinbau am Altstädtischen Markt — Wahrzeichen der Altstadt.',
    lines: [
      'Visuell: Backstein-Rathaus mit Schieferdach und Turm am Marktplatz — zentral in der Altstadt.',
      'Gotischer Backsteinbau, Wahrzeichen der politischen Geschichte der Stadt (Wikipedia).',
      'Marktplatz mit Cafés und Veranstaltungen; Verbindung zur Havelpromenade.',
      'Quer: Dominsel und Neustadt über Brücken — drei Stadtteile durch Havel getrennt.',
      LIVE_GENERIC,
    ],
  },
  bad_saarow_scharmutzelsee: {
    general_info:
      'Scharmützelsee: zweitgrößter Natursee Brandenburgs — Kern des Kurorts Bad Saarow mit Strand, Promenade und Wassersport.',
    lines: [
      'Visuell: weite Wasserfläche, Schilfgürtel, Strandbäder und Segelboote — flache Ufer in Barnim.',
      'Entstanden in der Eiszeit als Gletschertalsee; Fläche ca. 12 km² (Wikipedia).',
      'Bad Saarow am Westufer entwickelte sich im 20. Jahrhundert zum Kurbetrieb und Tourismus.',
      'Scharmützelsee ist beliebt für Schwimmen, Segeln, SUP und Radwege rund um den See.',
      'Quer: Kurpark, aja Resort und Bad Saarow Strand entlang der Uferpromenade.',
      'Leben jetzt: Strandbäder mit Saisonbetrieb; Schifffahrt und Bootsverleih an mehreren Anlegern.',
      'Ufergemeinden wie Bad Saarow, Diensdorf und Wendisch Rietz teilen das Seeufer — verschiedene Strandcharaktere.',
      'Schilfgürtel schützt Brutvögel; Naturschutz und Badebetrieb werden abgestimmt (Naturschutzbehörde).',
      LIVE_GENERIC,
    ],
  },
  bad_saarow_kurpark: {
    general_info:
      'Kurpark Bad Saarow: Parkanlage mit Kolonnaden und Seeblick — klassisches Kurort-Ambiente am Scharmützelsee.',
    lines: [
      'Visuell: Alleen, Kolonnaden, Blick auf See — gepflegte Kurpark-Architektur.',
      'Entstand im Zuge des Kurbetriebs Bad Saarow; Erholung und Spaziergänge.',
      'Quer: Seebalkon und Strand Bad Saarow; aja Therme in der Nähe.',
      LIVE_GENERIC,
    ],
  },
  bad_saarow_aja_bad_saarow: {
    general_info:
      'aja Bad Saarow: Resort mit Therme und Wellness am Scharmützelsee — modernes Kur- und Freizeitangebot.',
    lines: [
      'Visuell: Resort-Architektur am Seeufer, große Therme-Halle sichtbar von der Promenade.',
      'Therme und Hotelbetrieb am Scharmützelsee — Sauna, Pools und Wellness (Betreiber aja).',
      'Quer: Kurpark und öffentliche Strandbereiche in Gehdistanz.',
      LIVE_GENERIC,
    ],
  },
  bad_saarow_bad_saarow_strand: {
    general_info:
      'Bad Saarow Strand: Badestelle und Promenade am Scharmützelsee — Sommer-Haupttreffpunkt am Westufer.',
    lines: [
      'Visuell: Sandstrand, Stege, Liegewiesen und Blick über den See.',
      'Saisonaler Badebetrieb; Wasserqualität wird überwacht (offizielle Badegewässer-Daten).',
      'Quer: Anlegestellen für Scharmützelsee-Rundfahrten.',
      LIVE_GENERIC,
    ],
  },
  chorin_kloster_chorin: {
    general_info:
      'Kloster Chorin: ehemaliges Zisterzienserkloster — Backsteingotik in der Schorfheide, heute Konzert- und Ausstellungsort.',
    lines: [
      'Visuell: rote Backsteinfassaden, offene Ruinen und restaurierte Kirche — spiegeln sich im Klosterteich.',
      'Gegründet 1273 als Zisterzienserkloster; bedeutendes Backsteinbauwerk der Mark (Wikipedia).',
      'Aufgelöst in der Reformation; danach Verfall und beginnende Restaurierung im 19./20. Jahrhundert.',
      'Heute: Brandenburgisches Kloster Chorin — Konzerte (Choriner Musiksommer), Ausstellungen, Klosterladen.',
      'Klosterteich und Park umgeben die Anlage; Fahrradwege durch die Schorfheide.',
      'Biosphärenreservat Schorfheide-Chorin umschließt die Region — Wald- und Seelandschaft.',
      'Architektur: frühe Backsteingotik mit charakteristischen Formen Zisterzienser-Bauhütte.',
      'Quer: Grimnitzsee und Schorfheide-Wald in der Umgebung; Bahnhof Angermünde/Chorin erreichbar.',
      'Leben jetzt: Führungen durch Klosterführer; Veranstaltungskalender auf klosterchorin.de.',
      'Choriner Musiksommer bringt klassische Konzerte in die Klosterkirche — Akustik und Atmosphäre bekannt.',
      'Restaurierung der Backsteingewölbe läuft seit dem 19. Jahrhundert — fortlaufende Denkmalpflege.',
      'Zisterzienser-Ordensregeln prägten ursprüngliche Wirtschaft: Fischteiche, Mühle, Landwirtschaft.',
      LIVE_GENERIC,
    ],
  },
  wandlitz_liepnitzsee: {
    general_info:
      'Liepnitzsee: klarer Waldsee im Barnim nahe Wandlitz — Badestellen, Fähren und Wanderwege in Naturschutzgebiet.',
    lines: [
      'Visuell: Waldufer, Sandstrände und glitzerndes Wasser zwischen Kiefern — beliebtes Berliner Naherholungsziel.',
      'Naturschutzgebiet Liepnitzsee und Lüder-Luch; Bade- und Bootsnutzung reguliert (Wikipedia, Untere Naturschutzbehörde).',
      'Fähren verbinden Nord- und Südufer; Wanderweg am Ufer.',
      'Quer: Wandlitzsee und Waldsiedlung Wandlitz in der Gemeinde — unterschiedliche Erholungs- und Geschichtesebenen.',
      'Leben jetzt: Strandbad und Bootsverleih saisonal; Regeln zu Hunden und Feuerstellen beachten.',
      LIVE_GENERIC,
    ],
  },
  wandlitz_waldsiedlung_wandlitz: {
    general_info:
      'Waldsiedlung Wandlitz: Siedlung der DDR-Führung im Wald — historisch abgeschirmter Wohnkomplex, heute Wohngebiet.',
    lines: [
      'Visuell: eingestreute Einfamilienhäuser in dichtem Wald — abgeschirmte Straßenführung.',
      'Entstand ab 1950 als Wohnsiedlung für SED-Politbüro und Staatsratsmitglieder (Wikipedia).',
      'Nach 1989 Öffnung und Umwandlung in normalen Wohnort; Denkmal- und Erinnerungsdebatten.',
      'Quer: Liepnitzsee und Wandlitzer See für Naherholung — geografisch nahe, historisch kontrastreich.',
      'Leben jetzt: Wohngebiet ohne touristische Großführungen; öffentliche Wege respektvoll nutzen.',
      LIVE_GENERIC,
    ],
  },
  rheinsberg_kasse_schloss: {
    general_info:
      'Schloss Rheinsberg: friderizianisches Schloss am Grienecksee — Jugendresidenz Friedrichs des Großen, heute Museum und Konzerte.',
    lines: [
      'Visuell: orangefarbener Schlossbau mit Türmen, Terrasse zum Grienecksee und Schlosspark.',
      'Friedrich II. verbrachte als Kronprinz Jahre auf Schloss Rheinsberg (1736–1740) — prägende Zeit (Wikipedia, SPSG).',
      'Kurt Tucholsky schrieb „Rheinsberg“ über Friedrichs Aufenthalt — literarische Berühmtheit.',
      'Schloss und Park gehören zur Stiftung Preußische Schlösser und Gärten; Museum und Konzerte.',
      'Schlosstheater Rheinsberg im Park — klassische Konzerte und Veranstaltungen.',
      'Grienecksee und Rheinsberger Gewässer — Bootsfahrten und Uferpromenade.',
      'Architektur: barock mit friderizianischen Ergänzungen; Innenräume mit Portraits und Möbeln.',
      'Quer: Schlosspark, Gartenportal, Sphinxtreppe und Feldsteingrotte als Park-Stationen.',
      'Stadt Rheinsberg mit Hafen und Gastronomie am Wasser.',
      'Leben jetzt: Schlossführungen SPSG; Konzertsaison Schlosstheater.',
      'Kronprinz Friedrich komponierte hier Flötenstücke und debattierte Aufklärung — biografische Wendepunkte.',
      'Schlosskapelle und Bibliothek zeigen frühe Interessen des späteren Königs — museale Räume.',
      'Rheinsberger Schlossliteratur: Tucholsky-Roman popularisierte den Ort deutschlandweit.',
      LIVE_GENERIC,
    ],
  },
  rheinsberg_schlosspark_rheinsberg: {
    general_info:
      'Schlosspark Rheinsberg: barocker Landschaftspark mit Skulpturen, Grotte und Seeblick — Rahmen des Schlosses.',
    lines: [
      'Visuell: Alleen, Sphinxtreppe, Grotte und Blick auf Grienecksee — romantischer Park.',
      'Gestaltung im 18. Jahrhundert; Erweiterungen für Konzert- und Spaziergäste.',
      'Quer: Schloss Rheinsberg und Schlosstheater im Park.',
      LIVE_GENERIC,
    ],
  },
  rheinsberg_aussichtspunkt_schloss_rheinsberg: {
    general_info:
      'Aussichtspunkt Schloss Rheinsberg: erhöhte Sicht auf Schloss, See und Park — beliebtes Fotomotiv.',
    lines: [
      'Visuell: Schloss-Silhouette über Grienecksee vom Aussichtspunkt — Postkartenmotiv.',
      'Quer: wenige Minuten zum Schloss-Eingang und Park.',
      LIVE_GENERIC,
    ],
  },
};

const CITY_META = {
  spreewald: {
    city_history:
      'Lübbenau im UNESCO-Biosphärenreservat Spreewald: wendische Kahnkultur, Gurken, Reetdach-Dörfer und Wassergräben prägen die „Kahnfahrerstadt“ südöstlich von Berlin.',
    spotIds: [
      'spreewald_schloss_lubbenau',
      'spreewald_freilandmuseum_lehde',
      'spreewald_grosser_spreewaldhafen_lubbenau',
      'spreewald_lubbenau',
      'spreewald_kleiner_hafen_am_spreeschlosschen_lubbenau_kahnfahrmannsverein_der_spr',
    ],
    offline_qa: [
      {
        q: 'Warum UNESCO Spreewald?',
        a: 'Biosphärenreservat Spreewald seit 1991 — einzigartiges Fließgewässer-Netz, Auenwälder und wendische Kulturlandschaft (UNESCO/Brandenburg).',
        tags: ['spreewald', 'unesco'],
      },
    ],
  },
  beelitz: {
    city_history:
      'Beelitz: Lungenheilanstalten-Architektur in Kiefernwald und moderne Baumkronen-Erlebnispfade — Medizin- und Industriekultur südwestlich von Berlin.',
    spotIds: ['beelitz_mannersanatorium_beelitz_heilstatten', 'beelitz_beelitz_heilstatten'],
    new_places: [
      {
        id: 'beelitz_baumkronenpfad_beelitz',
        name: 'Baumkronenpfad Beelitz',
        lat: 52.2594,
        lng: 12.9247,
        category: 'natur',
        place_tier: 1,
        pack_role: 'story',
      },
    ],
  },
  oranienburg: {
    city_history:
      'Oranienburg: baroches Schloss der Oranier-Nassauer und Gedenkstätte Sachsenhausen — Erinnerung und Residenzgeschichte an der Havel.',
    spotIds: [
      'oranienburg_gedenkstatte_und_museum_sachsenhausen',
      'oranienburg_schlossmuseum_oranienburg',
      'oranienburg_schlosspark_oranienburg',
    ],
  },
  werder: {
    city_history:
      'Werder (Havel): Inselstadt mit Obstplantagen und Baumblütenfest — Havelnaher Kurort südlich von Potsdam.',
    spotIds: ['werder_insel_werder', 'werder_heilig_geist_kirche', 'werder_werder_havel_markt'],
  },
  brandenburg_havel: {
    city_history:
      'Brandenburg an der Havel: Dominsel, Dom St. Peter und Paul und Havel-Inselstädte — Wiege der Mark Brandenburg.',
    spotIds: ['brandenburg_havel_dom_st_peter_und_paul', 'brandenburg_havel_brandenburg_altstadt'],
    new_places: [
      {
        id: 'brandenburg_havel_rathaus_brandenburg',
        name: 'Rathaus Altstädtischer Markt Brandenburg',
        lat: 52.4119,
        lng: 12.5311,
        category: 'denkmal',
        place_tier: 2,
        pack_role: 'story',
      },
    ],
  },
  bad_saarow: {
    city_history:
      'Bad Saarow am Scharmützelsee: Kurbetrieb, Strandpromenade und Therme im Barnim — zweitgrößter See Brandenburgs.',
    spotIds: [
      'bad_saarow_scharmutzelsee',
      'bad_saarow_kurpark',
      'bad_saarow_aja_bad_saarow',
      'bad_saarow_bad_saarow_strand',
    ],
  },
  chorin: {
    city_history:
      'Chorin in der Schorfheide: Zisterzienserkloster Chorin und Biosphärenreservat Schorfheide-Chorin — Backsteingotik im Wald.',
    spotIds: ['chorin_kloster_chorin'],
    city_facts_non_place: [
      'Biosphärenreservat Schorfheide-Chorin schützt Wald- und Seelandschaft zwischen Chorin, Brodowin und Schorfheide (UNESCO-MAB, Wikipedia).',
    ],
  },
  wandlitz: {
    city_history:
      'Wandlitz: Barnim-Waldseen mit Liepnitzsee und historischer Waldsiedlung — Naherholung und DDR-Geschichte nördlich von Berlin.',
    spotIds: ['wandlitz_liepnitzsee'],
    new_places: [
      {
        id: 'wandlitz_waldsiedlung_wandlitz',
        name: 'Waldsiedlung Wandlitz',
        lat: 52.7597,
        lng: 13.4578,
        category: 'denkmal',
        place_tier: 2,
        pack_role: 'story',
      },
    ],
  },
  rheinsberg: {
    city_history:
      'Rheinsberg: friderizianisches Schloss am Grienecksee — Kronprinzenzeit Friedrichs des Großen und Kulturort in der Ruppiner Seenlandschaft.',
    spotIds: [
      'rheinsberg_kasse_schloss',
      'rheinsberg_schlosspark_rheinsberg',
      'rheinsberg_aussichtspunkt_schloss_rheinsberg',
    ],
  },
};

function buildCity(cityId) {
  const meta = CITY_META[cityId];
  if (!meta) return null;
  const pack = loadPack(cityId);
  const spots = [];
  for (const id of meta.spotIds) {
    const data = SPOT_LINES[id];
    if (!data) continue;
    const e = spotEntry(id, pack, data.general_info, data.lines);
    if (e) spots.push(e);
  }
  for (const np of meta.new_places || []) {
    const data = SPOT_LINES[np.id];
    if (!data) continue;
    spots.push({
      id: np.id,
      name: np.name,
      lat: np.lat,
      lng: np.lng,
      category: np.category || 'ort',
      place_tier: np.place_tier ?? 1,
      pack_role: np.pack_role || 'story',
      general_info: data.general_info,
      deep_data_pool: pool(mergedLines(np.id, data.lines)),
    });
  }
  return {
    city_history: meta.city_history,
    notes: ['Wave A — verified facts, LIVE ephemeral, no dialog scripts.'],
    offline_qa: meta.offline_qa || [],
    city_facts_non_place: meta.city_facts_non_place || [],
    spots,
    new_places: [],
  };
}

function main() {
  const only = process.argv.find((a) => a.startsWith('--city='))?.split('=')[1];
  const ids = only ? [only] : Object.keys(CITY_META);
  for (const id of ids) {
    const payload = buildCity(id);
    if (!payload) continue;
    const out = path.join(STAEDTE_DIR, `${id}.research-waveA.json`);
    writeJson(out, payload);
    console.log(`[gen] ${out} spots=${payload.spots.length}`);
  }
}

main();
