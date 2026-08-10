#!/usr/bin/env node
/** Generates data/staedte/berlin.depth-waveE.json — additive T1 depth (≥3000 pool after merge). */
import path from 'node:path';
import { STAEDTE_DIR, loadPack, writeJson } from './lib.mjs';

const LIVE =
  'LIVE: Öffnungszeiten, Eintritt, Führungen und Saisonprogramme ephemer auf berlin.de, visitBerlin oder offiziellen Betreiber-Sites prüfen.';

function tagText(text) {
  if (text.startsWith('Visuell')) return ['visuell', 'wegweiser'];
  if (text.startsWith('LIVE')) return ['live_hint', 'ephemeral'];
  if (text.startsWith('Quer')) return ['quer'];
  if (text.startsWith('Leben jetzt')) return ['leben_jetzt'];
  return ['geschichte'];
}

function poolChars(trigger) {
  const gi = trigger?.general_info || '';
  const deep = (trigger?.deep_data_pool || [])
    .map((e) => (typeof e === 'string' ? e : e.text || ''))
    .join('');
  return gi.length + deep.length;
}

function dedupeKey(text) {
  return String(text || '')
    .toLowerCase()
    .slice(0, 80);
}

function canAdd(existingTexts, text) {
  const k = dedupeKey(text);
  return !existingTexts.some((t) => dedupeKey(t) === k);
}

/** id → { general_info?, lines: string[] } */
const SPOT_DEPTH = {
  berlin_grosser_tiergarten: {
    general_info:
      'Berlins grüne Mitte zwischen Spreebogen, Tiergartenstraße und Charlottenburg: der Große Tiergarten (~210 ha) entstand aus kurfürstlichen Jagdgründen und wurde unter Friedrich dem Großen öffentlich zugänglich; Peter Joseph Lenné gestaltete ihn im 19. Jh. als Landschaftspark mit Wegen, Gewässern und Denkmälern — heute Naherholung mitten in der Hauptstadt.',
    lines: [
      'Visuell: weite Wiesen, Alleen und Teichlandschaft zwischen Hochbauten — vom Brandenburger Tor über Straße des 17. Juni bis zum Großen Stern und Zoo.',
      '1527: Kurfürst Joachim I. ließ Jagdgebiet anlegen; „Tiergarten“ als Name für Wildgehege und später Park (Wikipedia).',
      '1742: Friedrich II. öffnete den Park der Bevölkerung — Übergang von Fürstenpark zum städtischen Freiraum.',
      '1830er: Peter Joseph Lenné überarbeitet Wege, Sichtachsen und Pflanzungen im Stil englischer Landschaftsgärten.',
      'Großer Stern: zentraler Verkehrsknoten mit Fußgängertunneln; seit 1938/39 Standort der Siegessäule (versetzt vom Königsplatz).',
      'Denkmäler im Park: u. a. Bismarck-Nationaldenkmal, Königin-Luise-Denkmal, Goethe- und Lessing-Denkmal, Comenius-Brunnen.',
      'Zweiter Weltkrieg: starke Entwaldung als Brennholz; Nachkrieg Wiederaufforstung und schrittweise Rekonstruktion der Wege.',
      'Sowjetisches Ehrenmal Tiergarten an der Straße des 17. Juni — Gedenken an Soldaten der Roten Armee (Wikipedia).',
      'Schloss Bellevue am Spreeufer: Amtssitz des Bundespräsidenten am Rand des Parks.',
      'Südlicher Rand: Kulturforum mit Philharmonie, Neue Nationalgalerie und Staatsbibliothek — Kultur trifft Park.',
      'Tiergartenstraße und Hofjägerallee: historische Achsen durch den Park; Verbindung zu Spree und Regierungsviertel.',
      'Rousseau-Insel und Neuer See: beliebte Spazier- und Bootsziele; Café am Neuen See im Park.',
      'Nach Mauerfall 1989 wieder durchgängige Ost-West-Verbindung durch den Park und entlang der Straße des 17. Juni.',
      'Leben jetzt: Joggen, Rad, Picknick, Liegewiesen; Großer Tiergarten ganzjährig öffentlich zugänglich ohne Eintritt.',
      'Quer: Zoo Berlin am Hardenbergplatz, Siegessäule, Brandenburger Tor, Schloss Bellevue, Haus der Kulturen der Welt.',
      'Vogel- und Kleintiervielfalt in altem Baumbestand; Fledermaus- und Spechtarten in den Randbereichen (Naturführer Berlin).',
      'Winters: reduzierte Beleuchtung, trotzdem frequentierte Hauptwege; Sommer: Open-Air-Events am Spreeufer in Nachbarschaft.',
      LIVE,
    ],
  },
  berlin_mauerpark: {
    general_info:
      'Stadtpark in Prenzlauer Berg auf dem ehemaligen Todesstreifen der Berliner Mauer: seit den 1990er Jahren als Freizeitfläche umgestaltet, heute bekannt für Flohmarkt, Sportflächen und die sonntägliche Bearpit-Karaoke — Erinnerung an die Teilung bleibt durch Mauerreste und Toponym sichtbar.',
    lines: [
      'Visuell: lange Wiese mit Sportanlagen, Mauerresten und Tribünen am „Bearpit“ — zwischen Gleimstraße und Bernauer Straße-Nähe.',
      'Name „Mauerpark“: Park liegt auf Gelände der früheren Grenzanlagen zwischen Ost- und West-Berlin (Wikipedia).',
      '1990er: Umgestaltung aus Brach- und Grenzflächen zu öffentlichem Park; Teil der innerstädtischen Grünvernetzung.',
      'Sonntags Flohmarkt entlang der Gleimstraße — einer der bekanntesten Berliner Trödelmärkte (visitBerlin).',
      'Bearpit-Karaoke: open-air Bühnenkultur sonntags; internationales Publikum (ephemer — Wetter und Saison).',
      'Sport: Basketballfelder, Slackline-Bäume, Beachvolleyball; Friedrich-Ludwig-Jahn-Sportpark grenzt nördlich.',
      'Mauersegmente als historische Zeugnisse im Park — ergänzend zu Gedenkstätte Bernauer Straße.',
      'Max-Schmeling-Halle und Jahn-Sportpark als Nachbarn — Konzert- und Sportgroßevents (LIVE Kalender).',
      'Leben jetzt: Picknick, Musik, Skate und Spaziergänge; junge, urbane Parkkultur in Prenzlauer Berg.',
      'Quer: Bernauer Straße Gedenkstätte, Gleisdreieck-Park, Kulturbrauerei, Arkonaplatz.',
      'Akustik und Lärmschutz: Wohnbebauung rund um den Park — Nutzungskonflikte werden städtisch begleitet (Presseberichte).',
      'Grünbrücken und Bepflanzung verbinden ehemals getrennte Stadtstrukturen nach 1989.',
      'Winter weniger Marktaktivität; Sommer Hauptsaison für Flohmarkt und Karaoke.',
      'Historie: Grenzstreifen war hier besonders breit — dokumentiert in Mauergedenkstätten der Nachbarschaft.',
      LIVE,
    ],
  },
  berlin_berlin_treptower_park: {
    general_info:
      'Großpark an der Spree in Treptow: landschaftlich angelegt, bekannt für das Sowjetische Ehrenmal — eines der größten Soldatenfriedhöfe und Monumente der Sowjetunion außerhalb der ehemaligen UdSSR, eröffnet 1949, mit zentraler „Mutter Heimat“-Statue und Sarkophag-Reliefs.',
    lines: [
      'Visuell: weitläufige Wiesen und Alleen mit Blick auf gewaltige Sowjetische Ehrenmal-Anlage am Spreeufer.',
      'Parkfläche historisch als Volkspark konzipiert; Spreeufer und Gastronomie (Zenner) als traditioneller Ausflugsort.',
      'Sowjetisches Ehrenmal: zur Erinnerung an ca. 80.000 in Berlin gefallene Sowjetsoldaten (Wikipedia).',
      'Architekten: u. a. Jakow Belopolski, Wladimir Isajew, Alexander A. Gorpenko; Landschaftsgestaltung Willy Scheld.',
      'Zentrale Figur: 12 m hohe „Mutter Heimat“ aus Bronze auf Sockel mit Goldmosaik — ikonisches Motiv.',
      'Sechzehn Sarkophage mit Reliefs aus Marmor zeigen Kampf- und Opferszenen des Zweiten Weltkriegs.',
      'Ehemaliges Stalin-Relief an der Eingangsanlage 1961 entfernt; historische Fotos dokumentieren die Veränderung.',
      'Ehrenhalle mit Fresken und Sowjetischem Ehrenmal-Inschriftband — feierliche Achsensymmetrie.',
      'Nach 1990 bleibt Gedenkstätte erhalten; Pflege durch Berlin und russische Partner (Wikipedia).',
      'Leben jetzt: Spazieren, Rad am Spreeufer, Liegewiesen; Gedenkstätte free access (LIVE Sonderveranstaltungen).',
      'Quer: Plänterwald, Insel der Jugend, Arena Berlin/Eventflächen an der Spree.',
      'Zenner Biergarten: historische Gaststätte im Park — Sommerbetrieb (LIVE).',
      'Volksparktradition: Konzerte und Feste auf Wiesen — Kalender ephemer.',
      LIVE,
    ],
  },
  berlin_berliner_mauerweg: {
    general_info:
      'Der Berliner Mauerweg folgt dem ehemaligen Verlauf der Berliner Mauer auf etwa 160 km als Wander- und Radroute durch Berlin und Brandenburg — markiert, dokumentiert und von der Senatsverwaltung als Erinnerungs- und Freizeitprojekt ausgewiesen (berlin.de / Wikipedia).',
    lines: [
      'Visuell: Wegemarkierung mit Mauerweg-Logo, oft parallel zu Mauerstreifen, Gleisanlagen oder Gewässern — städtisch und ländlich wechselnd.',
      'Gesamtlänge rund 160 km — vollständiger Ring um West-Berlin bzw. entlang der früheren Grenze (Wikipedia).',
      'Route für Radfahrer und Wanderer in Abschnitten; offizielle Beschilderung und Online-Karten (berlin.de).',
      'Kein einzelner Park, sondern Verbindungsweg mit Erinnerungsstationen, Info-Tafeln und Resten von Wachtürmen.',
      'Abschnitte führen an Gedenkstätte Bernauer Straße, East Side Gallery, Checkpoint Charlie-Umfeld und Grünzügen vorbei.',
      'Teile verlaufen auf ehemaligen Kontrollwegen und Kolonnenstraßen der Grenztruppen.',
      'Brandenburg-Anteil: Mauerweg verbindet Berlin mit umliegenden Gemeinden — ländliche Passagen.',
      'Leben jetzt: Tagesetappen oder mehrtägige Tour; Radverleih und ÖPNV-Anbindung je Abschnitt (LIVE).',
      'Quer: Kombination mit Mauermuseum, Dokumentationszentrum und städtischen Parks entlang der Route.',
      'Erinnerungspolitik: Weg verbindet Freizeit und Lernen über die Teilungsgeschichte (Senatsstelle).',
      'Jahreszeitlich: winterliche Abschnitte weniger belebt; Frühjahr/Herbst beliebt für Radtouren.',
      'Historische Fotos am Info-Tafeln zeigen frühere Sperr- und Todesstreifen-Situation.',
      'Grenzübergänge und ehemalige Übergangsstellen werden an Markierungen erklärt.',
      LIVE,
    ],
  },
  berlin_tierpark_berlin: {
    general_info:
      'Tierpark Berlin in Friedrichsfelde: mit rund 160 ha einer der flächengrößten Zoos Europas, 1955 in der DDR als Antwort auf den West-Berliner Zoo eröffnet; Schloss Friedrichsfelde im Park, Stiftung Tiergarten Berlin gemeinsam mit Zoo Berlin.',
    lines: [
      'Visuell: weitläufige Parklandschaft mit Schloss Friedrichsfelde, großen Gehegen und asiatisch gestalteten Toranlagen.',
      'Eröffnung 2. Juli 1955 als „Tierpark Berlin“ — östliches Gegenstück zum Zoologischen Garten (Wikipedia).',
      'Namenspatron Alfred Brehm; Fokus auf artgerechte, großflächige Haltung und Zucht seltener Arten.',
      'Berühmter Elefant „Knautschke“ wurde GDR-Mediensymbol — Standbilder und Erinnerung im Park.',
      'Schloss Friedrichsfelde: barockes Schloss im Tierpark, Ausstellungen und Veranstaltungen (LIVE).',
      'Stiftung Tiergarten Berlin verwaltet Tierpark und Zoo gemeinsam — Forschung und Artenschutz.',
      'Großgehege für Hirsche, Bisons und Raubtiere; historische Bärenanlagen modernisiert.',
      'Leben jetzt: Familienausflug, Führungen, Fütterungen — Tickets und Öffnung LIVE (tierpark.de).',
      'Quer: Friedrichsfelde Palace Museum, Tram-Anbindung, Gedenkstätte Hohenschönhausen in weiter Ferne.',
      'Fläche ermöglicht Kombination Zoo-Besuch und Spaziergang wie in einem Landschaftspark.',
      'Nach 1990 Investitionen in Gehege und Besucherzentren; internationale Kooperationen.',
      'Historie: Konkurrenz und später Partnerschaft mit Zoo Berlin spiegeln Berliner Teilungsgeschichte.',
      LIVE,
    ],
  },
  berlin_garten_der_welt: {
    general_info:
      'Erholungspark Marzahn: „Gärten der Welt“ mit internationalen Gartenkulturen — ausgehend von IGA 2003 und großer Erweiterung zur IGA 2017; chinesischer, japanischer, koreanischer, arabisch-islamischer und weiterer Themengärten auf ehemaligen Plattenbau-Trümmerflächen.',
    lines: [
      'Visuell: pagodenartige Dächer, Kabelkrane der IGA, formal angelegte Gärten und Wiesen über Marzahn.',
      'Entwicklung aus Erholungspark Marzahn (1970er) und Internationalen Gartenausstellungen (Wikipedia).',
      'IGA 2017 brachte neue Gärten und Seilbahn — städtebauliche Aufwertung des Bezirks.',
      'Chinesischer Garten „Garten des wiedergewonnenen Mondes“, japanischer Kaisergarten, koreanischer Garten.',
      'Arabisch-islamischer Garten, italienischer Renaissance-Garten, Balinese Garten — kulturelle Vielfalt.',
      'Jüdischer Garten seit Erweiterung — Erinnerung und Gartenkunst verbunden (Presse/SMB-nahe Dokumentation).',
      'Gründer-Gärten und Karl-Foerster-Staudengarten für heimische Pflanzenkunde.',
      'Leben jetzt: Spaziergänge, Events, IGA-Halle — Eintritt und Saison LIVE (gruen-berlin.de / visitBerlin).',
      'Quer: Kienbergpark, Seilbahn zum Kienberg, Plattenbau-Architektur Marzahn als Kontrast.',
      'Nachwende: Park entstand auf rekultivierten Industrie- und Wohngebietsflächen.',
      'Gartenschau-Tradition verbindet Bildung, Botanik und Freizeit für Familien.',
      LIVE,
    ],
  },
  berlin_st_marienkirche: {
    general_info:
      'Evangelische Pfarrkirche St. Marien am Fuße der Fernsehturm-Nähe und Neptunbrunnen: eine der ältesten noch genutzten Kirchen Berlins (Gotik ab 13. Jh.), nach Kriegsschäden wiederhergestellt, heute Kontrast zwischen historischem Mauerwerk und Alex-Skyline.',
    lines: [
      'Visuell: Backsteingotik mit hohem Turm neben Neptunbrunnen und Rotes Rathaus — Fernsehturm im Hintergrund.',
      'Erste Erwähnung 1292; zentrale Pfarrkirche der mittelalterlichen Doppelstadt Berlin-Cölln (Wikipedia).',
      'Gotischer Hallenchor; barocke Veränderungen am Turm und Innenausstattung in späteren Jahrhunderten.',
      'Zweiter Weltkrieg: schwere Schäden; Wiederaufbau in DDR als bewusstes Zeichen historischer Kontinuität.',
      'Neptunbrunnen vor der Kirche: barockes Brunnenensemble mit vier Flüssen-Allegorien.',
      'Nähe Nikolaiviertel und Spree — historische Mitte der Stadt.',
      'Leben jetzt: Gottesdienste, Konzerte, Turmbesteigung saisonal (LIVE Gemeinde/Museum).',
      'Quer: Rotes Rathaus, Fernsehturm, Nikolaikirche, Spreepromenade.',
      'Innen: spätgotische Formen und restaurierte Ausstattung — Führungen LIVE.',
      'Historische Grabplatten und Epitaphe als Zeugnisse Berliner Bürgerschaft.',
      'Protestantische Gemeinde St. Marien aktiv in der City-Mitte.',
      LIVE,
    ],
  },
  berlin_franzosische_kirche_zu_berlin_hugenottenkirche: {
    general_info:
      'Französische Friedrichstadtkirche am Gendarmenmarkt: Zentrum der Hugenotten-Gemeinde nach Zuwanderung ab 1685 (Edikt von Fontainebleau); Friedrich Wilhelm I. gewährte Schutz — barocke Predigtkirche mit charakteristischen Turmhauben, heute französisch-reformierte und united Gemeinde.',
    lines: [
      'Visuell: schlanker Turm mit charakteristischer Haube am Gendarmenmarkt zwischen Konzerthaus und Deutschem Dom.',
      '1685: Edikt von Fontainebleau vertreibt Hugenotten aus Frankreich — Zuwanderung nach Brandenburg (Wikipedia).',
      'Kurfürst Friedrich Wilhelm I. lud Glaubensflüchtlinge ein; Berliner „Friedrichstadt“ als Siedlungsgebiet.',
      'Kirche 1701–1705 errichtet; Architektur im barocken Stil für reformierte französische Gemeinde.',
      'Französischsprachige Tradition in Gottesdiensten und Kultur bis heute facettenreich.',
      'Gendarmenmarkt als städtebauliches Ensemble: Französischer Dom, Deutscher Dom, Schauspielhaus/Konzerthaus.',
      'Orgel und Konzerte: musikalische Tradition — Kalender LIVE.',
      'Leben jetzt: Gottesdienst, Führungen, Gendarmenmarkt-Festivals.',
      'Quer: Deutscher Dom Ausstellung, Konzerthaus Berlin, Friedrichstraße.',
      'Hugenotten brachten Handwerk, Künste und Handel — prägten Berliner Wirtschaftsgeschichte.',
      'Innenraum: schlicht-reformierte Ausstattung mit historischen Epitaphen.',
      LIVE,
    ],
  },
  berlin_altes_museum: {
    general_info:
      'Altes Museum am Lustgarten (Karl Friedrich Schinkel, 1823–1830): erstes Museumsgebäule der Museumsinsel, ionischer Säulenportikus und Rotunde — heute Antikensammlung der Staatlichen Museen zu Berlin, UNESCO-Welterbe seit 1999.',
    lines: [
      'Visuell: breiter Säulenportikus mit grün patinierter Kuppelrotunde, Blick vom Lustgarten und Berliner Dom.',
      'Schinkels Entwurf prägte klassizistische Museumarchitektur Deutschlands (Wikipedia).',
      'Rotunde im Inneren: historische Raumfolge für Skulpturensaal-Konzept 19. Jh.',
      'Antikensammlung: griechische und römische Kunst, u. a. Porträts und Vasen.',
      'Teil des Museumsinsel-Ensembles mit Neues Museum, Pergamon, Bode, Alte Nationalgalerie.',
      'James-Simon-Galerie als Besucherzentrum südlich — Eingangsbereich SMB (seit 2019).',
      'Nach Kriegsschäden und Teilung Wiederaufbau; heute sanierte Ausstellungsräume (SMB).',
      'Leben jetzt: Dauerausstellung Antike, Sonderausstellungen — Ticket SMB LIVE.',
      'Quer: Berliner Dom, Lustgarten, Humboldt Forum, Spreepromenade.',
      'Forum Fridericianum: historische Idee eines Kulturforums Unter den Linden.',
      'Architektur: Säulenordnung nach antikem Vorbild symbolisiert Bildung und Staat.',
      LIVE,
    ],
  },
  berlin_bode_museum: {
    general_info:
      'Bode-Museum an der Spitze der Museumsinsel (Ernst von Ihne, 1897–1904): monumentale Kuppel über der Spreebiegung — Skulpturensammlung, Museum für Byzantinische Kunst und Münzkabinett der Staatlichen Museen zu Berlin.',
    lines: [
      'Visuell: gewölbtes Hauptportal und Kuppel über der Spree — „Monbijou-Brücke“ als klassischer Fotostandpunkt.',
      'Ursprünglich Kaiser-Friedrich-Museum; 1956 umbenannt nach Wilhelm von Bode (Wikipedia).',
      'Skulpturensammlung: Mittelalter bis 18. Jh., u. a. Donatello, Riemenschneider-Kontext.',
      'Museum für Byzantinische Kunst: ikonische Werke und Kulturgüter des Byzanz.',
      'Münzkabinett: eine der bedeutendsten numismatischen Sammlungen weltweit (SMB).',
      'Innenhof und Treppenhäuser: repräsentative Beaux-Arts-Architektur von Ihne.',
      'Nach Wiederaufbau post-1990 zentrale Achse der Museumsinsel-Sanierung.',
      'Leben jetzt: kombinierte Ticketoptionen Museumsinsel — Öffnung LIVE smb.museum.',
      'Quer: Neues Museum, Pergamonbau, Spreefahrt, Monbijoupark.',
      'UNESCO-Welterbe Museumsinsel: Bode als nördlicher Abschluss des Ensembles.',
      'Barocksaal und Skulpturengalerien für „Mehr Historie“-Tiefe geeignet.',
      LIVE,
    ],
  },
  berlin_museum_fur_naturkunde: {
    general_info:
      'Museum für Naturkunde Berlin (Invalidenstraße): Forschungsmuseum der Humboldt-Universität mit weltberühmtem Dinosauriersaal — Giraffatitan brancai (ehemals Brachiosaurus), T. rex „Tristan“, Millionen Objekte in Sammlung seit Gründung 1810.',
    lines: [
      'Visuell: historisches Gebäude mit modernem Glasanbau; im Saal rekonstruierte Dinosaurierskelette unter Hohe Decke.',
      'Gegründet 1810; Sammlungen überleben Kriege mit Verlusten und späterer Wiederzusammenführung (Wikipedia).',
      'Giraffatitan brancai: eines der größten montierten Dinosaurierskelette weltweit — Tendaguru-Funde.',
      'Tyrannosaurus rex „Tristan“: prominent ausgestelltes Fossil — Wechselausstellungen LIVE.',
      'Systematische Sammlungen: Mineralogie, Zoologie, Paläontologie, Evolution.',
      'Forschung: Biodiversität, Klimawandel, Digitisierung der Sammlung (MfN Berlin).',
      'Architektur: Bombenschäden, Sanierung und Erweiterung für Besucherströme.',
      'Leben jetzt: Familien, Schulklassen, Sonderausstellungen — Tickets LIVE (museumfuernaturkunde.berlin).',
      'Quer: Humboldt-Universität, Nordbahnhof, Regierungsviertel.',
      'Historische Sammlungsräume mit Fisch-, Vogel- und Säugetierpräparaten.',
      'Öffentliche Führungen zu Evolution und Fossilienforschung.',
      LIVE,
    ],
  },
  berlin_deutsche_oper_berlin: {
    general_info:
      'Deutsche Oper Berlin in Charlottenburg (Bismarckstraße): 1912 eröffnet, nach Kriegszerstörung 1961 als moderner Opernbau wiedereröffnet — heute eines der drei Berliner Staatsoper-Häuser im Ensemble der Stiftung Oper in Berlin.',
    lines: [
      'Visuell: breite Glasfront und helle Foyerarchitektur an der Bismarckstraße — Kontrast zum historischen Charlottenburg.',
      'Eröffnung 1912 als „Deutsche Oper“; Zerstörung 1943, Neubau eröffnet 1961 (Wikipedia).',
      'Architekt Fritz Bornemann: funktionaler Nachkriegsoperbau mit großer Bühnentechnik.',
      'Repertoire: Oper, Ballett, Operette — internationales Ensemble (stiftung-oper-berlin.de).',
      'Intendanten und Regisseure prägten stilbildende Inszenierungen — Programm LIVE.',
      'Leben jetzt: Premieren, Spielplan online; barrierefreie Zugänge modernisiert (LIVE).',
      'Quer: Charlottenburg, Ku’damm, Savignyplatz, Schloss Charlottenburg.',
      'Akustik und Sichtlinien: Saal für große Besucherzahlen konzipiert.',
      'Nachwende: Sanierungen Foyer und Bühnentechnik; internationale Gastspiele.',
      'Historie: West-Berliner Opernanker während der Teilung.',
      LIVE,
    ],
  },
  berlin_konzerthaus_berlin: {
    general_info:
      'Konzerthaus am Gendarmenmarkt: Schinkels „Schauspielhaus“ (1818–1821), nach Kriegswiederaufbau als Konzertsaal — Heimat des Konzerthausorchesters Berlin unter Christoph Eschenbach und weiteren Chefdirigenten; zentraler klassischer Konzertort.',
    lines: [
      'Visuell: klassizistische Säulenfront mit Dreiecksgiebel zwischen Französischer und Deutscher Dom am Gendarmenmarkt.',
      'Schinkel entwarf das Schauspielhaus als Herzstück des Gendarmenmarkt-Ensembles (Wikipedia).',
      '1945 ausgebrannt; Wiederaufbau 1984 als Konzerthaus mit moderner Akustik.',
      'Konzerthausorchester Berlin: traditionsreiches Orchester mit festem Spielplan.',
      'Großer Saal, Kleiner Saal und Werner-Otto-Saal für unterschiedliche Formate.',
      'Leben jetzt: Symphoniekonzerte, Kammerkonzerte, Festivals — Karten LIVE (konzerthaus.de).',
      'Quer: Französische Kirche, Deutscher Dom, Friedrichstraße, Unter den Linden.',
      'Gendarmenmarkt: Weihnachtsmarkt und Open-Air-Events saisonal (LIVE).',
      'Architekturdetails: Schinkels Proportionen und Giebelreliefs nach historischem Vorbild.',
      'Teilung: Gendarmenmarkt an der Sektorgrenze — symbolische Mitte nach 1990.',
      LIVE,
    ],
  },
  berlin_zoologischer_garten_berlin: {
    lines: [
      'Visuell: Zoologischer Garten Station und Ku’damm-Nähe; Elefantentor als orientalisch anmutendes Wahrzeichen am Hardenbergplatz.',
      '1844 Eröffnung durch Naturforscher Martin Lichtenstein und Zoologischen Verein — ältester Zoo Deutschlands (Wikipedia).',
      'Elefantentor 1899: Entwurf Peter Emil Löffler im maurischen Stil — Wappentier Berliner Bär am Tor.',
      'Weltkrieg: schwere Schäden; berühmte Tiergeschichten wie Knautschke im Ost-Zoo vs. West-Zoo.',
      'Heute über 20.000 Tiere in über 1.300 Arten — artenreichster Zoo Europas nach Artikelzahl (Zoo Berlin).',
      'Große Panda-Aufzucht Kooperation mit China; Biodiversitätszentrum und Artenschutzprojekte.',
      'Aquarium im Zoo: Fische, Reptilien, Insekten unter einem Dach — separates Ticket LIVE.',
      'Stiftung Tiergarten Berlin: gemeinsame Strategie mit Tierpark Friedrichsfelde.',
      'Leben jetzt: Tageskarten, Jahreskarten, Fütterungen — zoo-berlin.de LIVE.',
      'Quer: Gedächtniskirche, Ku’damm, Landwehrkanal, Aquarium.',
      'Historische Tierhäuser modernisiert; Affenhaus und Vogelvolieren Sanierungsprojekte.',
      'Forschung: Erhaltungszucht bedrohter Arten, wissenschaftliche Publikationen.',
      LIVE,
    ],
  },
  berlin_nikolaiviertel: {
    lines: [
      'Visuell: wiederaufgebaute kleinteilige Häuser und Kopfsteinpflaster an der Spree — Nikolaikirche mit doppeltem Turm.',
      'Nikolaikirche: älteste Kirche Berlins (ca. 1230); heute Museum und Konzertsaal (Wikipedia).',
      'Historische Mitte Berlin-Cölln; Zerstörung im Krieg, städtebauliche Neugestaltung 1980er DDR.',
      'Rekonstruktion als touristisches und Wohnviertel mit Gastronomie an der Spree.',
      'Ephraim-Palais: Rokoko-Fassade als Ausstellungsort Stadtmuseum — LIVE.',
      'Knoblauch-Haus: Bürgerhausmuseum zur Geschichte des Bürgertums.',
      'Leben jetzt: Spaziergänge, Cafés, Bootsanleger; Nikolaikirche Führungen LIVE.',
      'Quer: Rotes Rathaus, Spreeinsel, Molkenmarkt, Alexanderplatz.',
      'Historische Grundrisse der Doppelstadt an Info-Tafeln erklärt.',
      'Nach 1990 weitere Sanierungen und Nutzungsmix Wohnen/Gastronomie/Kultur.',
      'Spreeuferpromenade verbindet zum Dom und Museumsinsel.',
      LIVE,
    ],
  },
  berlin_deutsches_historisches_museum: {
    lines: [
      'Visuell: Zeughaus-Unter den Linden mit barocker Fassade und modernem I.M.-Pei-Anbau (Exhibition Hall).',
      'Zeughaus: ältestes erhaltenes Gebäude am Boulevard; Waffensammlung historisch, heute Dauerausstellung (Wikipedia).',
      'Pei-Bau 2003: Glas- und Stahlbau für Wechselausstellungen und große Rundgänge.',
      'Dauerausstellung „Deutsche Geschichte in Bildern und Zeugnissen“ — chronologischer Rundweg.',
      'Sammlung: Alltags- und Politikgeschichte von Mittelalter bis Gegenwart.',
      'Leben jetzt: Sonderausstellungen national und international — dhm.de LIVE.',
      'Quer: Unter den Linden, Humboldt-Universität, Bebelplatz, Staatsoper.',
      'Bebelplatz: Buchverbrennung 1933 — Gedenkraum „Leere Bibliothek“ in Gehdistanz.',
      'Forschung und Bildung: Vermittlung kontroverser Themen mit Quellenarbeit.',
      'Barockes Zeughaus-Inneres mit historischer Decke und Vitrinen.',
      LIVE,
    ],
  },
  berlin_kaiser_wilhelm_gedachtniskirche: {
    lines: [
      'Visuell: hohler, beschädigter Turm mit Kreuz und neue blaue Glasbeton-Kirche Eiermanns am Breitscheidplatz.',
      '1891–1895: Neoromanische Gedächtniskirche für Wilhelm I. nach Entwurf Franz Schwechten (Wikipedia).',
      'November 1943: schwere Luftschäden; Turm als Mahnmal stehen gelassen — „Hohler Zahn“.',
      '1961: Eiermann-Bauten — hexagonale Kirchenräume mit blauen Glasfenstern von Gabriel Loire.',
      'Mosaikprogramme im Inneren der Ruine teils erhalten — Kriegszerstörung sichtbar.',
      'Leben jetzt: Gottesdienste, Gedenkandachten, Turmaufstieg saisonal — LIVE Gemeinde.',
      'Quer: Ku’damm, Zoo, Europa-Center, Tauentzienstraße.',
      'Mahnmal-Funktion: bewusste Kombination aus Ruine und Neubau statt reinem Wiederaufbau.',
      'Breitscheidplatz: zentraler West-Berliner Platz — Weihnachtsmarkt und Events (LIVE).',
      'Historische Fotos zeigen Turm vor und nach dem Krieg.',
      LIVE,
    ],
  },
  berlin_unter_den_linden: {
    lines: [
      'Visuell: breite Prachtachse mit Lindenbäumen (Neupflanzungen), Staatsoper, Humboldt-Universität und Schlossbrücke zum Dom.',
      '1647: Kurfürst Friedrich Wilhelm ließ Unter den Linden als Reit- und Promenadenachse anlegen (Wikipedia).',
      'Forum Fridericianum: Opernhaus, Universität, Akademie — Aufklärungsprojekt Friedrichs II.',
      'Humboldt-Universität: Hauptgebäude am Boulevard; Gründung 1810 als Berliner Universität.',
      'Staatsoper Unter den Linden: historische Oper mit Sanierung und Neueröffnung 2017 (Staatsoper Berlin).',
      'Bebelplatz: Staatsbibliothek, Hedwigskathedrale, Hotel Adlon — städtebauliche Ensembles.',
      'Schlossbrücke: Schinkels Brückenarchitektur zum Lustgarten und Museumsinsel.',
      'DDR-Zeit: breite Republikstraße; Palast der Republik (abgerissen) und Staatsratsgebäude.',
      'Nach 1990: Humboldt Forum im Berliner Schloss; Wiederherstellung historischer Silhouette.',
      'Leben jetzt: Flanieren, Cafés, Kulturinstitute — Baustellen und Verkehr ephemer (LIVE).',
      'Quer: Brandenburger Tor, Deutsches Historisches Museum, Friedrichstraße, Spree.',
      'Parade- und Demonstrationsgeschichte von Kaiserzeit bis friedliche Revolution.',
      LIVE,
    ],
  },
};

function projectedPool(trigger, projectedGi, addedTexts) {
  return (
    projectedGi.length +
    [...(trigger.deep_data_pool || []).map((e) => e.text || ''), ...addedTexts].join('').length
  );
}

function buildWaveSpotEnrich(pack, id, data) {
  const spot = pack.spots.find((s) => s.id === id);
  const trigger = pack.trigger_points.find((t) => t.id === id);
  if (!spot || !trigger) return null;
  const start = poolChars(trigger);
  if (start >= 3000) return null;

  return buildWaveSpotCore(pack, id, data, start);
}

/** Unique additive chunks even when pool already ≥3000 (deduped against pack). */
function buildWaveSpotEnrichUnique(pack, id, data) {
  const spot = pack.spots.find((s) => s.id === id);
  const trigger = pack.trigger_points.find((t) => t.id === id);
  if (!spot || !trigger) return null;

  const existingTexts = [
    trigger.general_info || '',
    ...(trigger.deep_data_pool || []).map((e) => e.text || ''),
  ];
  const added = [];
  const addedTexts = [];
  for (const line of data.lines || []) {
    if (!canAdd(existingTexts.concat(addedTexts), line)) continue;
    added.push({ text: line, tags: tagText(line) });
    addedTexts.push(line);
  }
  if (added.length === 0) return null;

  return {
    id,
    name: spot.name,
    place_tier: spot.place_tier || 1,
    pack_role: spot.pack_role || 'story',
    deep_data_pool: added,
  };
}

function buildWaveSpotCore(pack, id, data, start) {
  const spot = pack.spots.find((s) => s.id === id);
  const trigger = pack.trigger_points.find((t) => t.id === id);
  if (!spot || !trigger) return null;

  const existingTexts = [
    trigger.general_info || '',
    ...(trigger.deep_data_pool || []).map((e) => e.text || ''),
  ];
  let projectedGi = trigger.general_info || '';
  const useGi = data.general_info && (!projectedGi || projectedGi.length < 80);
  if (useGi) projectedGi = data.general_info;

  const added = [];
  const addedTexts = [];
  for (const line of data.lines || []) {
    if (!canAdd(existingTexts.concat(addedTexts), line)) continue;
    added.push({ text: line, tags: tagText(line) });
    addedTexts.push(line);
    if (projectedPool(trigger, projectedGi, addedTexts) >= 3000) break;
  }

  const finalTotal = projectedPool(trigger, projectedGi, addedTexts);
  if (finalTotal < 3000) {
    console.error(`${id}: projected ${finalTotal} after ${added.length} new chunks (was ${start}) — need more lines`);
    return null;
  }
  if (added.length === 0) return null;

  const out = {
    id,
    name: spot.name,
    place_tier: spot.place_tier || 1,
    pack_role: spot.pack_role || 'story',
    deep_data_pool: added,
  };
  if (useGi) out.general_info = data.general_info;
  return out;
}

/** Wave-E priority T1 icons (Berlin v14 depth pass). */
const WAVE_E_IDS = [
  'berlin_grosser_tiergarten',
  'berlin_mauerpark',
  'berlin_berlin_treptower_park',
  'berlin_berliner_mauerweg',
  'berlin_tierpark_berlin',
  'berlin_garten_der_welt',
  'berlin_st_marienkirche',
  'berlin_franzosische_kirche_zu_berlin_hugenottenkirche',
  'berlin_altes_museum',
  'berlin_bode_museum',
  'berlin_museum_fur_naturkunde',
  'berlin_deutsche_oper_berlin',
  'berlin_konzerthaus_berlin',
  'berlin_zoologischer_garten_berlin',
  'berlin_nikolaiviertel',
  'berlin_deutsches_historisches_museum',
  'berlin_kaiser_wilhelm_gedachtniskirche',
  'berlin_unter_den_linden',
  'berlin_siegessaule',
  'berlin_east_side_gallery',
  'berlin_berliner_dom',
  'berlin_schloss_charlottenburg',
];

function main() {
  const pack = loadPack('berlin');
  const t1Under = pack.spots
    .filter((s) => s.place_tier === 1 && s.pack_role !== 'directory')
    .map((s) => ({ id: s.id, chars: poolChars(pack.trigger_points.find((t) => t.id === s.id)) }))
    .filter((x) => x.chars < 3000);

  const targetIds = [
    ...new Set([
      ...t1Under.map((x) => x.id),
      ...WAVE_E_IDS.filter((id) => {
        const t = pack.trigger_points.find((x) => x.id === id);
        return t && poolChars(t) < 3000;
      }),
    ]),
  ];

  const enrichIds =
    targetIds.length > 0
      ? targetIds
      : WAVE_E_IDS.filter((id) => SPOT_DEPTH[id] && pack.trigger_points.some((t) => t.id === id));

  const notes = [
    'Berlin depth wave E — additive deep_data_pool (+ general_info wo leer). Quellen: Wikipedia, berlin.de, visitBerlin, offizielle Museen/Oper.',
    targetIds.length > 0
      ? 'Nur Spots mit Trigger-Pool <3000 zum Generierungszeitpunkt.'
      : 'Pack bereits ≥3000 auf allen Wave-E-Icons — zusätzliche deduplizierte Fakten-Chunks (kein generisches Padding).',
    'LIVE für Öffnung/Preise. Kein Upload in diesem Schritt.',
  ];

  const spots = [];
  for (const id of enrichIds) {
    const data = SPOT_DEPTH[id];
    if (!data) continue;
    const built =
      targetIds.length > 0 && targetIds.includes(id)
        ? buildWaveSpotEnrich(pack, id, data)
        : buildWaveSpotEnrichUnique(pack, id, data);
    if (built) spots.push(built);
  }

  const out = { notes, spots };
  writeJson(path.join(STAEDTE_DIR, 'berlin.depth-waveE.json'), out);
  console.log(`Wrote ${spots.length} spots to berlin.depth-waveE.json`);
  for (const s of spots) {
    const trig = pack.trigger_points.find((t) => t.id === s.id);
    const extra = s.deep_data_pool.reduce((n, e) => n + e.text.length, 0);
    const giNew = s.general_info ? s.general_info.length - (trig.general_info || '').length : 0;
    console.log(`${s.id}: +${extra} chars deep, gi delta ${giNew}, was ${poolChars(trig)}`);
  }
}

main();
