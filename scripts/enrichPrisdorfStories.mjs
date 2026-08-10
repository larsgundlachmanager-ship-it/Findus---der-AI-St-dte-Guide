#!/usr/bin/env node
/**
 * Enrich every Prisdorf spot with storytelling matrix:
 * origin/geschichte, heute, zukunft, quiz, cta.
 * Local only — no upload.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCityPack } from './geo/validatePack.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACK = path.join(ROOT, 'data/staedte/prisdorf.json');

function deep(text, tags) {
  return { text, tags };
}

function hasTag(pool, tag) {
  return (pool || []).some(
    (e) =>
      Array.isArray(e?.tags) &&
      e.tags.map(String).map((t) => t.toLowerCase()).includes(tag),
  );
}

function hasTextMatch(pool, re) {
  return (pool || []).some((e) => re.test(String(e?.text || '')));
}

/** Curated story blocks keyed by spot id (partial — rest filled generically). */
const STORIES = {
  prisdorf_bahnhof_wartehäuschen: {
    zukunft:
      'Bürger und Verein Wartehäuschen Prisdorf halten das Denkmal in Schuss — jede neue Sanierungsrunde entscheidet, ob das Fachwerk weiter als Treffpunkt am Gleis bleibt.',
    quiz:
      'Schätzfrage: In welchem Jahr bekam Prisdorf sein denkmalgeschütztes Fachwerk-Wartehäuschen — 1844, 1911 oder 1947? (Antwort: 1911; die Bahnstrecke selbst gibt es seit 1844.)',
    cta: 'Bleib einen Moment am Wartehäuschen stehen, tipp vorsichtig ans Fachwerk und schau dir die Walmdach-Silhouette an — dann steig ein und fahr ein Stück Richtung Hamburg oder holsteinischer Westen.',
  },
  prisdorf_gemeindezentrum_hudenbarg: {
    zukunft:
      'Das Ensemble am Hudenbarg bleibt das organisatorische Herz: Gemeinde, Feuerwehr, Kita und Sport teilen sich weiter denselben Campus — Umbauten folgen dem Bedarf der wachsenden Wohngemeinde.',
    quiz:
      'Schätzfrage: Wie viele Menschen leben ungefähr in Prisdorf — eher 800, 2.350 oder 8.000? (Antwort: rund 2.350.)',
    cta: 'Schau in den Schaukasten am Hudenbarg: Oft hängen dort Termine für Bürgerversammlung, Feuerwehr und Vereine — nimm dir einen Zettel oder ein Foto für später.',
  },
  prisdorf_kriegerehrenmal_bilsbek: {
    zukunft:
      'Der Heimatverein pflegt den Stein weiter — Gedenken bleibt leise und lokal, ohne Spektakel.',
    quiz:
      'Schätzfrage: An wie viele Gefallene des Ersten Weltkriegs erinnert das Ehrenmal namentlich — 5, 12 oder 40? (Antwort: zwölf.)',
    cta: 'Bleib einen Moment still stehen, lies die Namen auf dem Stein und geh dann bewusst weiter über die Bilsbekbrücke — ohne Selfie-Posen vor dem Mahnmal.',
  },
  prisdorf_peiner_hof: {
    zukunft:
      'Golf, Hotel und Restaurant am Peiner Hof bleiben öffentliches Freizeitangebot — der historische Hofname Peyne (1477) lebt als Marke weiter.',
    quiz:
      'Schätzfrage: Wann wurde der Peiner Hof erstmals urkundlich erwähnt — 1342, 1477 oder 1844? (Antwort: 1477 als Peyne.)',
    cta: 'Wenn du Zeit hast: Geh bis zum Fairway-Blick, trink etwas im Goldschätzchen oder Hotelbereich und schau, wie Agrargeschichte und Freizeit heute nebeneinanderliegen.',
  },
  prisdorf_peiner_hag_gewerbe: {
    zukunft:
      'Peiner Hag bleibt Einkaufs- und Gewerbeachse; Leerstände und Umnutzungen (wie nach dem toom-Wegzug) prägen die nächsten Jahre.',
    quiz:
      'Schätzfrage: Seit wann prägt das Gewerbegebiet Peiner Hag Prisdorf wirtschaftlich spürbar — 1950er, 1970er oder 2000er? (Antwort: ab den 1970er Jahren.)',
    cta: 'Geh einmal quer durchs Center: Marktkauf, Bäcker, Apotheke, Mode — zähl, wie viele Alltagswege du hier in zehn Minuten erledigen kannst.',
  },
  prisdorf_pinnau_ufer: {
    zukunft:
      'Als Teil von FFH- und Landschaftsschutz bleibt die Pinnau-Niederung auf Naturschutz kursiert — Erholung ja, wilde Eingriffe nein.',
    quiz:
      'Schätzfrage: Ab wann begann man die Pinnau hier zu regulieren, um Winterhochwasser zu dämpfen — 1783, 1883 oder 1983? (Antwort: 1883.)',
    cta: 'Lauf ein Stück dem Ufer entlang, halt inne und zähl Vögel oder hör nur dem Wasser zu — ohne die Feuchtwiesen zu betreten, wo Schutz gilt.',
  },
  prisdorf_tsv_sportgelände: {
    zukunft:
      'Der TSV bleibt Mehrsparten-Verein; Jugend für Jugend und Breitensport sichern den Nachwuchs auf dem Gelände am Ahrenloher Weg.',
    quiz:
      'Schätzfrage: In welchem Jahr — und wo — wurde der TSV Prisdorf gegründet? Tipp: Es hing mit einem Gasthof zusammen. (Antwort: 17.09.1947 bei einer Tanzveranstaltung in Hoyers Gasthof.)',
    cta: 'Schau auf die Vereinstafel: Wenn Training oder Jugendtreff läuft, frag höflich nach einer Schnupperstunde — Handball, Fußball oder Yoga starten oft niedrigschwellig.',
  },
  prisdorf_tcp_tennis: {
    zukunft:
      'TCP setzt auf Halle, Online-Buchung und Sommerfest — Tennis bleibt fester Teil der Sportachse am Ahrenloher Weg.',
    quiz:
      'Schätzfrage: In welchem Monat findet typischerweise das TCP-Sommerfest mit Spaßturnier statt — Mai, September oder Dezember? (Antwort: September.)',
    cta: 'Wenn Plätze frei sind: Buch online eine Stunde oder schau beim Sommerfest vorbei — Zuschauen und Mitgrillen sind oft willkommen.',
  },
  prisdorf_bilsbek_schule: {
    zukunft:
      'Die gemeinsame Grundschule mit Kummerfeld bleibt langfristig geplant — Kinder aus beiden Dörfern unter einem Dach.',
    quiz:
      'Schätzfrage: Seit welchem Schuljahr lernen Prisdorf und Kummerfeld hier gemeinsam — 2003/04, 2013/14 oder 2020/21? (Antwort: 2013/14.)',
    cta: 'Außerhalb der Schulzeiten: Geh am Gebäude vorbei und lies die Namensgeschichte — Bilsbek als Fluss, der Schule und Dorf verbindet.',
  },
  prisdorf_eisenbahnbrücke_hudenbarg: {
    zukunft:
      'Der 2018/19 erneuerte Trogbau soll Jahrzehnte halten — Prisdorfer nennen ihn trotzdem weiter liebevoll Eisbahnbrücke.',
    quiz:
      'Schätzfrage: Was kostete der Neubau der Eisenbahnüberführung am Hudenbarg ungefähr — 0,5 Mio., 4,77 Mio. oder 40 Mio. Euro? (Antwort: rund 4,77 Millionen.)',
    cta: 'Steh kurz auf der Brücke, spür den Zug darunter und mach ein Foto der Gleisachse — ohne die Fahrbahn zu blockieren.',
  },
  prisdorf_feuerlöschteich_gemeindeteich: {
    zukunft:
      'Als Löschwasserreserve bleibt der Teich kritisch für die Feuerwehr — Jugendfeuerwehr übt hier weiter.',
    quiz:
      'Schätzfrage: Wofür wurde der Teich ursprünglich angelegt — Zierteich, Löschwasser oder Badeanstalt? (Antwort: Löschwasser für die Feuerwehr.)',
    cta: 'Geh einmal um den Teich, bleib an der Ecke Hudenbarg/Hauptstraße stehen und stell dir vor, wie die Jugendfeuerwehr hier mit der Tragkraftspritze übt.',
  },
  prisdorf_alte_schule_lütte_prisdörper: {
    zukunft:
      'Lütte Prisdörper bleibt Kita-Standort im Dorfzentrum — Nachfolger der alten Dorfschule und der Schwalbe-Anfänge.',
    quiz:
      'Schätzfrage: Wann wurde die alte Grundschule abgerissen, bevor die Kita in den Neubau zog — 2003, 2013 oder 2018? (Antwort: 1. Juni 2013.)',
    cta: 'Schau vom Weg aus auf den Hofbaum und den hellen Kita-Bau — und denk daran: Hier stand jahrzehntelang die Dorfschule.',
  },
  prisdorf_marktkauf_meyers_frischecenter: {
    zukunft:
      'Als Meyers Frischecenter bleibt der Markt der Alltagsanker — Sortiment und lokale Bindung entscheiden über die nächsten Jahre.',
    quiz:
      'Schätzfrage: Seit welchem Jahr steht hier ein großer Markt — und wer übernahm ihn 2021? (Antwort: seit 1973 Marktkauf; 2021 Jörg Meyer / Meyers Frischecenter.)',
    cta: 'Geh rein, hol dir etwas Frisches vom Markt und ein Franzbrötchen vom Bäcker — klassischer Prisdorf-Alltag in zehn Minuten.',
  },
  prisdorf_freiwillige_feuerwehr: {
    zukunft:
      'Mit rund 50 Aktiven und Jugendfeuerwehr seit 1977 bleibt die Wehr das Sicherheitsrückgrat — Nachwuchs werben ist Daueraufgabe.',
    quiz:
      'Schätzfrage: Wann wurde die Freiwillige Feuerwehr Prisdorf gegründet — 1789, 1889 oder 1989? (Antwort: 22. September 1889.)',
    cta: 'Wenn die Fahrzeughalle offen ist oder ein Fest läuft: Frag höflich nach einer Führung oder Jugendfeuerwehr-Info — Interesse ist willkommen.',
  },
  prisdorf_grossstadtmission_dahl: {
    origin:
      'Die Großstadt-Mission Hamburg-Altona bringt seit Jahrzehnten soziale Arbeit nach Prisdorf — betreutes Wohnen und Tagesförderung für Menschen mit Behinderung.',
    heute:
      'Am Ellernstrang 2a/2b und Dahl laufen Wohngruppen, Tagesförderstätte und ambulante Hilfen — leise Infrastruktur, die das Dorf mitträgt.',
    zukunft:
      'Inklusion vor Ort bleibt Auftrag: stabile Plätze und Alltagshilfe in der Gemeinde statt anonymer Großeinrichtung.',
    quiz:
      'Schätzfrage: Wie viele Klienten wohnen typischerweise in einer der betreuten Wohngemeinschaften am Ellernstrang — eher 2–3, 10–11 oder 40? (Antwort: rund zehn bis elf.)',
    cta: 'Geh respektvoll an den Häusern vorbei — ohne zu starren — und denk daran: Hier passiert echte Nachbarschaftshilfe, die man von außen kaum sieht.',
  },
  prisdorf_heimatverein: {
    origin:
      '1967 gründeten Prisdorfer den Heimatverein für Dorfgemeinschaft — Chronik, Fotos, Exkursionen und Denkmalschutz (auch Wartehäuschen).',
    heute:
      'Etwa hundert Mitglieder halten Dorfgedächtnis wach; Broschüren wie „Straßen gestern und heute“ machen Geschichte greifbar.',
    zukunft:
      'Digitalisierung von Fotos und Straßenchronik steht oft auf der Agenda — der Verein sucht Mitmacher.',
    quiz:
      'Schätzfrage: Seit welchem Jahr gibt es den Heimatverein — 1947, 1967 oder 1994? (Antwort: 1967.)',
    cta: 'Frag nach der nächsten Exkursion oder der Straßen-Broschüre — oder bring ein altes Familienfoto vorbei, wenn du Prisdorf-Wurzeln hast.',
  },
  prisdorf_haus_prisdorf_altenheim: {
    origin:
      'Haus Prisdorf an der Hauptstraße 80 ist das gemeindenahe Alten- und Pflegeheim; Cecilien-Burg GmbH betreibt es seit April 2005.',
    heute:
      'Vollstationäre Pflege mit etwa 30 Plätzen, überwiegend Einzelzimmer und Wintergarten — Alltag und Würde im Dorf.',
    zukunft:
      'Pflegebedarf steigt mit dem Alter der Region — das Haus bleibt zentraler Baustein sozialer Infrastruktur.',
    quiz:
      'Schätzfrage: Seit welchem Jahr betreibt die Cecilien-Burg GmbH das Haus Prisdorf — 1995, 2005 oder 2015? (Antwort: April 2005.)',
    cta: 'Wenn du jemanden besuchst: Bring Zeit und ein kleines Gespräch mit — oder erkundige dich über ehrenamtliche Besuchsdienste im Dorf.',
  },
  prisdorf_drk_ortsverein: {
    origin:
      'Das DRK ist seit 1940 in Prisdorf aktiv — Blutspende, Sanitätsdienst, Seniorengymnastik und soziale Ausfahrten.',
    heute:
      'Ortsverein am Röhmcken 16A; Vorsitz Claudia Splettstößer — das Rote Kreuz bleibt greifbar vor Ort.',
    zukunft:
      'Ehrenamt und Blutspende-Termine brauchen weiter junge Helferinnen und Helfer.',
    quiz:
      'Schätzfrage: Seit wann ist das DRK in Prisdorf aktiv — 1920, 1940 oder 1970? (Antwort: 1940.)',
    cta: 'Schau den nächsten Blutspende-Termin nach oder frag nach Mitmach-Möglichkeiten — Sanitätsdienst bei Dorffesten braucht Verstärkung.',
  },
  prisdorf_bäcker_schlüter: {
    origin:
      'Bäcker Schlüter steht seit 1888 für Handwerksbackwaren im Nordwesten Hamburgs — Prisdorf ist eine von vielen Filialen.',
    heute:
      'Filiale Peiner Hag 11; warme Franzbrötchen und Alltagsversorgung neben dem Gewerbegebiet.',
    zukunft:
      'Filialnetz und Handwerkskultur stehen unter Druck — Qualität und Frühöffnung entscheiden über Kundentreue.',
    quiz:
      'Schätzfrage: Seit welchem Jahr backt die Familie Schlüter in der Region — 1788, 1888 oder 1988? (Antwort: 1888.)',
    cta: 'Kauf ein warmes Franzbrötchen und iss es draußen am Peiner Hag — klassischer Prisdorf-Start in den Tag.',
  },
  prisdorf_bäcker_allwörden_marktkauf: {
    origin:
      'Von Allwörden ist Hamburger Bäckertradition; die Filiale sitzt im Meyers Frischecenter.',
    heute:
      'Backwaren-Theke im Marktkauf — Brötchen und Wocheneinkauf in einem Rutsch.',
    zukunft:
      'Center-Gastronomie und Take-away bleiben stark, solange der Markt Anker bleibt.',
    quiz:
      'Schätzfrage: Warum liegt dieser Bäcker strategisch clever? (Antwort: direkt im Frischecenter — Einkauf und Frühstück kombiniert.)',
    cta: 'Hol dir ein Brötchen direkt nach dem Einkauf — und vergleich mental mit Schlüter nebenan: zwei Bäckerkulturen, ein Gewerbegebiet.',
  },
  prisdorf_backstube_münster: {
    origin:
      'Münster’s Backstube betreibt hier eine Zentralwerkstatt an der Werkstraße — Produktion hinter den Kulissen des Gewerbes.',
    heute:
      'Backbetrieb und Logistik für Filialen; kein klassisches Café, sondern Handwerksmotor.',
    zukunft:
      'Industriebackstuben bleiben unsichtbar, aber systemrelevant für die Region.',
    quiz:
      'Schätzfrage: Ist das hier vor allem ein Café zum Sitzen oder eher eine Produktionswerkstatt? (Antwort: Zentralwerkstatt / Produktion.)',
    cta: 'Wenn die Tür offen ist und Personal Zeit hat: Frag höflich, wohin die frischen Chargen heute fahren — Logistik-Story statt Schaufenster.',
  },
  prisdorf_team_tankstelle: {
    origin:
      'team-Tankstelle Peiner Hag 1a — typische Verkehrsinsel am Gewerbegebiet, entstanden mit dem Autoverkehr der Nachkriegsjahrzehnte.',
    heute:
      'Tanken, Shop, Kurzversorgung für Pendler zwischen Pinneberg und Tornesch.',
    zukunft:
      'E-Mobilität und Shop-Konzepte entscheiden, ob Tankstellen reine Zapfsäulen bleiben oder Service-Hubs werden.',
    quiz:
      'Schätzfrage: Warum steht die Tankstelle ausgerechnet hier? (Antwort: Peiner Hag = Gewerbe-/Pendlerachse an der L 107-Nähe.)',
    cta: 'Wenn du tankst: Kauf etwas Kleines im Shop und nutz die Pause für einen Blick aufs Gewerbegebiet — Prisdorfs wirtschaftliche Seite.',
  },
  prisdorf_stadtgeschichte_gesamt: {
    zukunft:
      'Prisdorf bleibt Wohngemeinde im Baumschulgürtel — Chronik 1985 und Heimatverein halten Geschichte wach, während Neubau und Gewerbe weiterwachsen.',
    quiz:
      'Schätzfrage: Wann wurde Prisdorf erstmals urkundlich genannt — und unter welchem Namen? (Antwort: 1342 als Villa Britzerdorpe.)',
    cta: 'Nimm dir die Dorfchronik-Idee mit: Frag im Bilsbekraum oder beim Heimatverein nach Einblick — 650 Jahre auf wenigen Seiten.',
  },
  prisdorf_staggenborg_apotheke: {
    origin:
      'Staggenborg Apotheke im Marktkauf-Center — zentrale Arzneimittelversorgung für Prisdorf und Umland.',
    heute:
      'Rezept, Beratung, OTCs mitten im Alltagseinkauf — ohne Extra-Weg in die Kreisstadt.',
    zukunft:
      'Apothekensterben trifft ländliche Regionen; Center-Lage stärkt die Chance auf Bestand.',
    quiz:
      'Schätzfrage: Warum ist die Apotheke ausgerechnet im Marktkauf? (Antwort: Frequenz + Ein-Stop-Versorgung fürs Dorf.)',
    cta: 'Wenn du etwas brauchst: Frag die Beratung zu Wechselwirkungen — und nutz den kurzen Weg vom Einkaufswagen zur Theke.',
  },
  prisdorf_gemeinschaftspraxis: {
    origin:
      'Gemeinschaftspraxis Bahnhofstraße 14: Allgemeinmedizin und Geriatrie — Hausarztversorgung im Dorfkern.',
    heute:
      'Anlaufstelle für Familien und Ältere; ersetzt das fehlende Krankenhaus vor Ort.',
    zukunft:
      'Hausärztemangel ist Regionsthema — jede Praxis, die hält, ist strategisch wertvoll.',
    quiz:
      'Schätzfrage: Liegt die Praxis eher am Peiner Hag oder an der Bahnhofstraße? (Antwort: Bahnhofstraße 14.)',
    cta: 'Wenn du Patient bist: Bring Medikamentenliste mit. Wenn nicht: Schätz den Fußweg Bahnhof → Praxis — typischer Dorf-Radius.',
  },
  prisdorf_zahnarztpraxis: {
    origin:
      'Zahnarztpraxis Heilmann und von Döhren, Bahnhofstraße 3 — Implantologie und Angstpatienten-Betreuung.',
    heute:
      'Fachzahnmedizin im Dorf, nicht nur in Pinneberg oder Hamburg.',
    zukunft:
      'Spezialisierung (Implantate, Angstpatienten) hält die Praxis wettbewerbsfähig.',
    quiz:
      'Schätzfrage: Welche besondere Patientengruppe wird hier ausdrücklich betreut? (Antwort: Angstpatienten.)',
    cta: 'Bei Terminnot: Ruf früh an. Sonst: Merk dir die Adresse Bahnhofstraße 3 für den Notfall im Urlaub bei Verwandten.',
  },
  prisdorf_friseur_klier: {
    origin:
      'Frisör Klier — Filialkette im Marktkauf-Center, Teil der Peiner-Hag-Alltagsinfrastruktur.',
    heute:
      'Schnitt, Farbe, Online-Termin — schnelle Versorgung beim Einkauf.',
    zukunft:
      'Kettenfriseure bleiben volumenstark; lokale Coiffeure daneben für Persönliches.',
    quiz:
      'Schätzfrage: Warum sitzt Klier im Marktkauf und nicht an der Hauptstraße? (Antwort: Laufkundschaft + Parkplätze des Centers.)',
    cta: 'Buch online einen Slot und kombinier ihn mit dem Wocheneinkauf — klassischer Peiner-Hag-Flow.',
  },
  prisdorf_coiffeur_jensen: {
    origin:
      'Coiffeur C. Jensen in Schnickenfeld 53 — Dorffriseur abseits der Center-Ketten.',
    heute:
      'Persönlicher Salon im Wohngebiet, Gegenmodell zur Mall-Filiale.',
    zukunft:
      'Solange Stammkundschaft hält, bleibt der Salon ein Stück Dorfidentität.',
    quiz:
      'Schätzfrage: Liegt Jensen eher im Gewerbegebiet oder im Wohnquartier? (Antwort: Schnickenfeld — Wohnquartier.)',
    cta: 'Wenn du Lokalität magst: Probier den Dorffriseur statt der Kette — und frag nach der Geschichte des Straßennamens Schnickenfeld.',
  },
  prisdorf_baumschule_huckfeldt: {
    origin:
      'Baumschule Holger Huckfeldt seit 1963 — Rosen, Hortensien, Gräser im größten Baumschulgebiet Europas.',
    heute:
      'Familienbetrieb Hauptstraße 104–106; hunderttausende Topfrosen und große Buchsbaum-Kultur.',
    zukunft:
      'Klimawandel und Schädlinge fordern Baumschulen — Sortenwahl und Beratung werden wichtiger.',
    quiz:
      'Schätzfrage: Wie viele Topfrosen produziert der Betrieb grob pro Jahr — 15.000, 150.000 oder 1,5 Mio.? (Antwort: über 150.000.)',
    cta: 'Geh durch die Freilandrosen, frag nach einer robusten Sorte für deinen Balkon — und nimm den Duft mit als Prisdorf-Souvenir.',
  },
  prisdorf_gärtnerei_clematis_westphal: {
    origin:
      'Clematis Westphal: Wurzeln 1953 in Quickborn, seit 1978 am Peiner Hof in Prisdorf — Spezialisten für Waldreben.',
    heute:
      'Über 400 Sorten, rund 100.000 Pflanzen jährlich, Schaugarten am Golfpark.',
    zukunft:
      'Export und Hobbygärtner halten die Nische; Schaugarten bleibt Besuchermagnet.',
    quiz:
      'Schätzfrage: Wie viele Clematis-Sorten gibt es hier ungefähr — 40, 400 oder 4.000? (Antwort: über 400.)',
    cta: 'Schlendere durch den Schaugarten am Golfplatz und such dir eine Lieblingssorte — frag nach Klettertipps für den Gartenzaun.',
  },
  prisdorf_kkiosk_post: {
    origin:
      'kkiosk mit Post/DHL im Marktkauf — Nachfolger der klassischen Dorfpost im Digitalzeitalter.',
    heute:
      'Briefe, Pakete, Tabak, Lotto: letzte Meter der staatlichen Infrastruktur im Center.',
    zukunft:
      'Filialsterben trifft Poststellen; Center-Lage ist Überlebensstrategie.',
    quiz:
      'Schätzfrage: Was findest du hier außer Briefmarken noch — eher Lotto oder Fahrkartenautomaten der Bahn? (Antwort: Lotto/Tabak/Pakete; Bahnautomaten eher nicht.)',
    cta: 'Schick eine Postkarte aus Prisdorf — absurderweise vom Marktkauf aus, mitten im 21. Jahrhundert.',
  },
  prisdorf_pm_service: {
    origin:
      'PM Service im Markt: Schuhreparatur und Schlüssel — altes Handwerk im Center-Format.',
    heute:
      'Sofort-Hilfe für kaputte Reißverschlüsse und verlorene Schlüssel am Peiner Hag.',
    zukunft:
      'Reparieren statt Wegwerfen bleibt Trend — solche Micro-Dienste gewinnen wieder.',
    quiz:
      'Schätzfrage: Welches Handwerk steckt hinter PM Service? (Antwort: Schuhe und Schlüssel.)',
    cta: 'Bring den quietschenden Schuh oder lass einen Ersatzschlüssel machen — und spar dir die Fahrt nach Pinneberg.',
  },
  prisdorf_hoyers_gasthof: {
    origin:
      'Hoyers Gasthof Hauptstraße 102 — klassischer Dorfgasthof; am 17.09.1947 wurde hier bei einer Tanzveranstaltung der TSV Prisdorf gegründet.',
    heute:
      'Gasthof und Hotel mit mediterraner Küche und Fremdenzimmern zwischen Hamburg und Nordsee.',
    zukunft:
      'Dorfgasthöfe kämpfen um Gäste — Events und Übernachtung sichern Bestand.',
    quiz:
      'Schätzfrage: Welcher Verein wurde 1947 ausgerechnet hier gegründet? (Antwort: TSV Prisdorf.)',
    cta: 'Iss etwas, oder trink einen Kaffee auf der Bank davor — und denk an die Tanznacht, aus der ein Sportverein entstand.',
  },
  prisdorf_santorini_gastro: {
    origin:
      'Santorini im Marktkauf: mediterrane Delikatessen — südliche Küche im norddeutschen Gewerbegebiet.',
    heute:
      'To-go und Feinkost für den schnellen Feierabend neben dem Wocheneinkauf.',
    zukunft:
      'Convenience und mediterrane Trends halten solche Theken am Leben.',
    quiz:
      'Schätzfrage: Passt „Santorini“ eher zu Fischbrötchen oder zu Olivenöl & Antipasti? (Antwort: südländische Spezialitäten.)',
    cta: 'Probier etwas Mediterranes als Kontrast zum Franzbrötchen — Prisdorf schmeckt internationaler als man denkt.',
  },
  prisdorf_kitz_jungtierrettung: {
    origin:
      'Herbst 2023: Kitz- und Jungtierrettung Prisdorf e.V. — Drohnen mit Wärmebild gegen Mähtod.',
    heute:
      'Ehrenamtliche retten Rehkitze vor der Mahd; finanziert über Spenden und Engagement.',
    zukunft:
      'Jede Mähsaison braucht wieder Flugstunden, Akkus und Helfer — der Verein wächst mit dem Bedarf.',
    quiz:
      'Schätzfrage: Womit spüren die Retter Kitze im hohen Gras auf — Hunde, Traktorlampen oder Wärmebilddrohnen? (Antwort: Drohnen mit Wärmebildkamera.)',
    cta: 'In der Mähsaison: Melde dich als Helfer oder Spender — oder teil den Verein in der Nachbarschaft, bevor die Maschinen fahren.',
  },
  prisdorf_pmv_veranstaltungen: {
    origin:
      'Idee nach der 650-Jahr-Feier 1992; Verein „Prisdorf macht Vergnügen“ seit 1994 als Dach für Dorffest, Osterfeuer und Event-Kalender.',
    heute:
      'PmV e.V. bündelt Vereine und organisiert das öffentliche Dorfleben.',
    zukunft:
      'Ohne Nachwuchs sterben Dorffeste — PmV bleibt die Klammer fürs Vergnügen.',
    quiz:
      'Schätzfrage: Wann wurde PmV gegründet — und welche große Feier inspirierte die Idee? (Antwort: 1994; Inspiration 650-Jahr-Feier 1992.)',
    cta: 'Schau den Event-Kalender: Nächstes Dorffest oder Osterfeuer mitfeiern — oder frag, wo Helfer gebraucht werden.',
  },
  prisdorf_bilsbek_fluss: {
    origin:
      'Die Bilsbek fließt durch Prisdorf zur Pinnau; Regulierung kurz nach 1883 gegen Winterhochwasser.',
    heute:
      'Teilweise regulierter Bach mit Feuchtwiesen; Namensgeber für Schule und Bilsbekraum.',
    zukunft:
      'Renaturierung und Hochwasserschutz müssen sich die Waage halten — Natura-2000-Nähe verpflichtet.',
    quiz:
      'Schätzfrage: Wohin fließt die Bilsbek — direkt in die Elbe oder erst in die Pinnau? (Antwort: in die Pinnau, dann zur Elbe.)',
    cta: 'Lauf ein Stück am Bach entlang (wo Wege erlaubt sind) und such die Stelle, an der du das Wasser hörst — Dorfgeräusch statt Straßenlärm.',
  },
  prisdorf_loeschbrunnen_außenbezirke: {
    origin:
      'Löschbrunnen Hauen: 15,5 m tief, in Betrieb seit 30.03.1954 — Wasserreserve für die Feuerwehr in den Außenbezirken.',
    heute:
      'Noch in Nutzung; unsichtbare, aber kritische Infrastruktur neben dem Gemeindeteich.',
    zukunft:
      'Solange Löschwasser gebraucht wird, bleiben Brunnen und Teiche Pflicht — auch wenn niemand sie „besucht“.',
    quiz:
      'Schätzfrage: Seit wann ist der Löschbrunnen Hauen dokumentiert in Nutzung — 1854, 1954 oder 2004? (Antwort: 30.03.1954.)',
    cta: 'Such den Brunnen nicht als Touristenattraktion — merk dir nur: Auch abseits vom Dorfkern steckt Sicherheitstechnik im Boden.',
  },
  prisdorf_kirche_kummerfeld: {
    origin:
      'Ev.-Luth. Kirchengemeinde Kummerfeld (gegr. 1964) mit Osterkirche (1970) — zuständig auch für Prisdorf und Borstel-Hohenraden.',
    heute:
      'Gottesdienste und Gemeindeleben in der Osterkirche; das zeltartige Dach wurde anfangs spöttisch „Zirkuszelt“ genannt.',
    zukunft:
      'Gemeinde bleibt regional geteilt — Prisdorf ohne eigene Dorfkirche, aber mit fester Gemeindestelle.',
    quiz:
      'Schätzfrage: Warum steht die Kirche nicht mitten in Prisdorf? (Antwort: Prisdorf gehört zur Kirchengemeinde Kummerfeld / Osterkirche.)',
    cta: 'Fahr oder lauf zur Osterkirche, schau dir das Zeltdach an und bleib einen Moment in der Stille — auch wenn Kirchen sonst nicht dein Thema sind.',
  },
  prisdorf_zur_schwalbe_geschichte: {
    origin:
      '1976 startete die Prisdorfer Spielstunde / Kita-Idee im Lokal „Zur Schwalbe“ an der Hauptstraße — wo früher Zapfhähne standen.',
    heute:
      'Die Spur führt zum heutigen Kita-Standort Lütte Prisdörper; die Schwalbe selbst ist Geschichtsanker.',
    zukunft:
      'Die Story bleibt Erinnerung — Umbau alter Gasthäuser zu Sozialräumen ist Modell fürs Dorf.',
    quiz:
      'Schätzfrage: Wo begann die Kita-Geschichte Prisdorfs — in der Schule, im Rathaus oder in einer Kneipe? (Antwort: im Lokal Zur Schwalbe.)',
    cta: 'Steh an der Hauptstraße und stell dir vor: Aus Tresen wurden Spielsachen — such die Stelle der alten Schwalbe und mach ein Gedankenfoto.',
  },
  prisdorf_bilsbekraum: {
    origin:
      'Bilsbekraum Hudenbarg 5 — Bürgerraum im Gemeindezentrum, benannt nach dem Dorfbach.',
    heute:
      'Gemeindeversammlung, Veranstaltungen, Heimatarchiv-Nähe — Demokratie im Dorfmaßstab.',
    zukunft:
      'Bleibt multifunktionaler Raum für Vereine und Verwaltung.',
    quiz:
      'Schätzfrage: Nach was ist der Bilsbekraum benannt — einem Bürgermeister oder einem Bach? (Antwort: nach dem Bach Bilsbek.)',
    cta: 'Schau den Aushang: Nächste Bürgerversammlung oder Vereinsabend mitnehmen — Demokratie beginnt oft in genau solchen Räumen.',
  },
  prisdorf_reiterverein_bilsbek: {
    origin:
      'Reiterverein Am Bilsbek seit 1924 (20 Gründungsreiter); nach 1945 zeitweise alliiertes Verbot bis 1947.',
    heute:
      'Aktiver Pferdesport in der Region (historisch an Prisdorf/Bilsbek gebunden).',
    zukunft:
      'Turniere und Jugendarbeit sichern den Verein — Flächen und Kosten bleiben Herausforderungen.',
    quiz:
      'Schätzfrage: Wie viele Reiter gründeten den Verein 1924 — 5, 20 oder 200? (Antwort: 20.)',
    cta: 'Wenn ein Turnier ansteht: Schau zu am Band — oder frag nach Schnupperreiten für Einsteiger.',
  },
  prisdorf_blume_aktuell: {
    origin:
      'Blume aktuell im Marktkauf — Floristik für Fest, Alltag und Trauer im Gewerbegebiet.',
    heute:
      'Sträuße und Gestecke ohne Extra-Weg nach Pinneberg.',
    zukunft:
      'Saisongeschäft und Online-Konkurrenz fordern den Laden — Qualität vor Ort zählt.',
    quiz:
      'Schätzfrage: Wann brauchst du hier eher Blumen — nur Hochzeit oder auch Trauer? (Antwort: beides; Floristik für Fest und Trauer.)',
    cta: 'Kauf einen kleinen Strauß für jemanden im Dorf — oder für dich selbst als Pause vom Einkaufsstress.',
  },
  prisdorf_krause_karosserie: {
    origin:
      'Krause Karosseriebetrieb Werkstraße 11 — Handwerk im Gewerbegebiet hinter dem Schaufenster.',
    heute:
      'Karosserie und Lackierung für Unfall- und Verschleißschäden.',
    zukunft:
      'E-Autos und Sensorik machen Karosseriearbeit komplexer — Fachbetriebe bleiben gefragt.',
    quiz:
      'Schätzfrage: Liegt Krause eher an der Hauptstraße oder an der Werkstraße? (Antwort: Werkstraße 11.)',
    cta: 'Wenn die Beule nervt: Hol ein Angebot — und schau dir an, wie viel Handwerk im Peiner Hag steckt, das man sonst übersieht.',
  },
  prisdorf_ernstings_family: {
    origin:
      'Ernsting’s family: Unternehmensstart Ende der 1960er (minipreis/Waschküchen-Legende); Filiale im Marktkauf Prisdorf.',
    heute:
      'Familienmode im Center — praktischer Stopp beim Wocheneinkauf.',
    zukunft:
      'Filialhandel kämpft mit Online — Center-Lage hilft durch Frequenz.',
    quiz:
      'Schätzfrage: Wie begann Ernsting’s family der Legende nach — als Boutique an der Alster oder als Minipreis in der Waschküche? (Antwort: Minipreis/Waschküche der Gründerfamilie.)',
    cta: 'Kombinier Modebummel mit Einkauf — zehn Minuten, ein Outfit, weiter zum Franzbrötchen.',
  },
  prisdorf_prisdorf_net: {
    origin:
      'prisdorf.net — private Bürgerseite mit Insider-Blick auf Bahnhof, Post und Dorfalltag.',
    heute:
      'Digitale Dorfchronik von unten: Links, Anekdoten, Orientierungshilfe.',
    zukunft:
      'Solange jemand pflegt, bleibt sie Gegenstück zur Amtsseite.',
    quiz:
      'Schätzfrage: Ist prisdorf.net die offizielle Gemeinde-Website? (Antwort: Nein — private Bürgerseite; offiziell eher prisdorf.de / Amt Pinnau.)',
    cta: 'Öffne prisdorf.net später am Abend und vergleich mit dem, was du heute zu Fuß gesehen hast — digitale und reale Dorfkarte.',
  },
  prisdorf_wald_hauen: {
    origin:
      'Wald und Knicks bei Hauen — historische Kulturlandschaft aus Reddern, Feldgehölzen und Forst.',
    heute:
      'Naherholung für Spaziergänger, Hundemenschen und ruhige Köpfe am Dorfrand.',
    zukunft:
      'Klimaschäden und Betretungsregeln bestimmen, wie „wild“ der Wald bleiben darf.',
    quiz:
      'Schätzfrage: Was sind Knicks in Schleswig-Holstein? (Antwort: typische Wallhecken / Feldgrenzen mit Gehölz.)',
    cta: 'Geh 20 Minuten in den Wald Hauen, lass das Handy in der Tasche und zähl, wie oft du nur Wind hörst.',
  },
  prisdorf_fairway_hotel: {
    origin:
      'Fairway Hotel am Peiner Hof — Übernachtung direkt am Golfplatz, entstanden mit dem Freizeit-Umbau des historischen Hofs.',
    heute:
      'Zimmer und Ferienwohnungen, rund 0,8 km zum Bahnhof — Golfen und Schlafen ohne Auto.',
    zukunft:
      'Kurzreisen und Golfpakete bleiben das Geschäftsmodell.',
    quiz:
      'Schätzfrage: Wie weit ist das Hotel grob vom Bahnhof — 0,8 km, 8 km oder 18 km? (Antwort: etwa 0,8 km.)',
    cta: 'Wenn du übernachtest: Lauf morgens zum Bahnhof statt Taxi — Prisdorf ist klein genug dafür.',
  },
  prisdorf_eat_happy_sushi: {
    origin:
      'EAT HAPPY Sushi To-Go im Marktkauf — globale Convenience-Küche im Dorf-Center.',
    heute:
      'Schnelles Sushi neben dem Einkaufswagen, ohne Restaurantabend.',
    zukunft:
      'To-go-Konzepte wachsen, solange Qualität und Kühlkette stimmen.',
    quiz:
      'Schätzfrage: Erwartest du hier ein Sushi-Restaurant mit Tischservice oder To-go? (Antwort: To-go im Marktkauf.)',
    cta: 'Probier eine Box und iss sie draußen auf einer Bank — ungewöhnlicher, aber ehrlicher Prisdorf-Snack.',
  },
  prisdorf_star_textilreinigung: {
    origin:
      'Star Textilreinigung im Marktkauf — Dienstleistung, die früher eigene Ladenzeilen brauchte.',
    heute:
      'Hemden, Anzüge, Wintermäntel reinigen lassen beim Einkauf.',
    zukunft:
      'Nachhaltiges Pflegen statt Neukaufen spricht für Reinigungen — wenn die Preise fair bleiben.',
    quiz:
      'Schätzfrage: Warum liegt die Reinigung im Center? (Antwort: Laufkundschaft und Parken beim Marktkauf.)',
    cta: 'Bring die Jacke mit, die du „später“ machen wolltest — und hol sie beim nächsten Einkauf wieder ab.',
  },
  prisdorf_toom_baumarkt: {
    origin:
      'toom am Peiner Hag war jahrelang der Heimwerker-Anker neben Marktkauf; Standortgeschichte des Gewerbegebiets.',
    heute:
      'Der frühere toom-Standort markiert den Umbruch am Peiner Hag: Der Markt wurde nach Pinneberg (Neubau) verlagert — vor Ort bleibt die Gewerbe-Erinnerung und Nachfolgenutzung im Blick.',
    zukunft:
      'Flächen am Peiner Hag werden weiter umgenutzt; Heimwerker fahren heute eher zum Pinneberger Standort.',
    quiz:
      'Schätzfrage: Was passierte mit dem toom am Peiner Hag? (Antwort: Verlagerung/Neubau nach Pinneberg — der Prisdorfer Standort ist Teil der Gewerbe-Geschichte.)',
    cta: 'Schau, was heute an der alten Baumarkt-Lage passiert — Leerstand, Umbau oder neuer Mieter erzählen die nächste Kapitelzeile.',
  },
  prisdorf_sav_angelteich: {
    origin:
      'Sportanglerverein Uetersen-Tornesch e.V. von 1965 — eigener Teich und Vereinshütte in Prisdorf.',
    heute:
      'Angeln, Jugendarbeit, Ruhe am Wasser; Königsangeln und Vereinsleben.',
    zukunft:
      'Gewässerschutz und Nachwuchsangeln sichern den Teich als Lernort.',
    quiz:
      'Schätzfrage: Seit wann gibt es den Anglerverein — 1945, 1965 oder 1985? (Antwort: 1965.)',
    cta: 'Wenn erlaubt: Sitz still an der Hütte, zähl die Ringe im Wasser — oder frag nach einer Gastkarte / Mitgliedschaft.',
  },
  prisdorf_jagdgemeinschaft: {
    origin:
      'Jagdgemeinschaft Prisdorf — Teil der Kulturlandschaft aus Feld, Wald und Knick; Mitglied im Dachverband PmV.',
    heute:
      'Wildhege, Abschussplanung, Mitwirkung bei Dorffesten über PmV.',
    zukunft:
      'Konfliktfelder Wildschaden und Biodiversität bleiben; Transparenz hilft dem Image.',
    quiz:
      'Schätzfrage: Über welchen Dachverein ist die Jagdgemeinschaft mit Dorffesten verbunden? (Antwort: Prisdorf macht Vergnügen / PmV.)',
    cta: 'Bei PmV-Festen: Sprich Jägerinnen und Jäger auf Hege und Feldwege an — Lernen statt Vorurteil.',
  },
  prisdorf_strassen_gestern_heute: {
    origin:
      'Heimatverein-Broschüre „Straßen gestern und heute“ — fotografischer und erzählerischer Vergleich der Dorfachsen.',
    heute:
      'Greifbare Lokalgeschichte für Spaziergänge mit Smartphone-Gedächtnis.',
    zukunft:
      'Digitale Neuauflagen und QR-Ideen liegen nahe, solange Mitmacher da sind.',
    quiz:
      'Schätzfrage: Wer gibt die Broschüre heraus — Amt, Bahn oder Heimatverein? (Antwort: Heimatverein.)',
    cta: 'Besorg die Broschüre und lauf eine Straße zweimal: einmal mit dem Heft, einmal ohne — was hat sich verändert?',
  },
  prisdorf_strassenverzeichnis: {
    origin:
      'Straßenverzeichnis PLZ 25497 — administrative Ordnung eines nur 5,23 km² großen Dorfes mit dichter Benennung.',
    heute:
      'Orientierung für Post, Feuerwehr und Neubürger; Kernachsen Hudenbarg, Hauptstraße, Bahnhofstraße, Peiner Hag.',
    zukunft:
      'Neue Baugebiete bringen neue Straßennamen — Chronik schreibt mit.',
    quiz:
      'Schätzfrage: Wie groß ist die Gemeindefläche ungefähr — 5, 25 oder 55 km²? (Antwort: etwa 5,23 km².)',
    cta: 'Pick dir drei Straßennamen und find heraus, wonach sie heißen — Person, Flur oder Funktion.',
  },
  prisdorfer_feldmark: {
    zukunft:
      'Feldmark und Zonenwege bleiben Puffer zwischen Wohnen, Baumschulen und Natur — Bebauungsdruck aus der Metropolregion bleibt Thema.',
    quiz:
      'Schätzfrage: Liegt Prisdorf im größten zusammenhängenden Baumschulgebiet Europas — ja oder nein? (Antwort: ja, Kreis Pinneberg / Baumschulregion.)',
    cta: 'Lauf einen Zonenweg durch die Feldmark und zähl Baumschulflächen vs. Wiesen — Landschaft lesen wie eine Karte.',
  },
};

function ensurePool(tp) {
  if (!Array.isArray(tp.deep_data_pool)) tp.deep_data_pool = [];
  return tp.deep_data_pool;
}

function pushUnique(pool, entry) {
  const key = entry.text.trim().toLowerCase();
  if (pool.some((e) => String(e?.text || '').trim().toLowerCase() === key)) {
    return false;
  }
  pool.push(entry);
  return true;
}

function enrichSpot(pack, spot) {
  const tp = (pack.trigger_points || []).find((t) => t.id === spot.id);
  if (!tp) return { id: spot.id, name: spot.name, added: 0, skipped: true };

  const pool = ensurePool(tp);
  const story = STORIES[spot.id] || {};
  let added = 0;
  const fields = [];

  // Prefer existing general_info / facts for origin/heute if story lacks them
  const origin =
    story.origin ||
    spot.facts?.origin ||
    (tp.general_info
      ? `Ursprung/Kontext: ${tp.general_info.split('.')[0]}.`
      : null);
  const heute =
    story.heute ||
    spot.facts?.now ||
    (tp.general_info ? `Heute: ${tp.general_info}` : null);

  const blocks = [
    origin &&
      !hasTag(pool, 'geschichte') &&
      !hasTextMatch(pool, /ursprung|gegründet|urkund|seit \d{4}/i) &&
      deep(origin, ['geschichte', 'origin', 'historical_core']),
    heute &&
      !hasTag(pool, 'heute') &&
      deep(
        heute.startsWith('Heute') ? heute : `Heute: ${heute}`,
        ['heute', 'live', 'now'],
      ),
    story.zukunft &&
      !hasTag(pool, 'zukunft') &&
      deep(story.zukunft, ['zukunft', 'ausblick']),
    story.quiz &&
      !hasTag(pool, 'quiz') &&
      deep(story.quiz, ['quiz', 'schaetzfrage', 'fun']),
    story.cta &&
      !hasTag(pool, 'cta') &&
      deep(story.cta, ['cta', 'aufforderung', 'explore']),
  ].filter(Boolean);

  for (const b of blocks) {
    if (pushUnique(pool, b)) {
      added += 1;
      fields.push(b.tags[0]);
    }
  }

  // Always ensure quiz+cta exist somehow for EVERY spot
  if (!hasTag(pool, 'quiz') && !story.quiz) {
    const fallbackQuiz = deep(
      `Schätzfrage zu ${spot.name}: Was glaubst du, wozu dieser Ort den Prisdorfern im Alltag am meisten dient — Alltag, Freizeit oder Erinnerung? Schau dich um und entscheide.`,
      ['quiz', 'schaetzfrage', 'fun'],
    );
    if (pushUnique(pool, fallbackQuiz)) {
      added += 1;
      fields.push('quiz');
    }
  }
  if (!hasTag(pool, 'cta') && !story.cta) {
    const fallbackCta = deep(
      `Aufforderung: Bleib 30 Sekunden bewusst an ${spot.name} stehen, nimm ein Detail wahr (Geräusch, Material, Geruch) und geh erst dann weiter — so merkt sich dein Kopf den Ort.`,
      ['cta', 'aufforderung', 'explore'],
    );
    if (pushUnique(pool, fallbackCta)) {
      added += 1;
      fields.push('cta');
    }
  }

  // Strengthen spot.facts matrix
  spot.facts = spot.facts || { tags: spot.tags || [] };
  if (origin && !spot.facts.origin) spot.facts.origin = origin.replace(/^Ursprung\/Kontext:\s*/i, '');
  if (heute && !spot.facts.now) {
    spot.facts.now = heute.replace(/^Heute:\s*/i, '');
  }
  spot.facts.tags = Array.from(
    new Set([
      ...(spot.facts.tags || []),
      ...(spot.tags || []),
      'geschichte',
      'quiz',
      'cta',
    ]),
  );
  spot.tags = Array.from(
    new Set([...(spot.tags || []), 'story_enriched', 'quiz', 'cta']),
  );

  // Improve first approach teaser if still generic
  for (const a of spot.approach_triggers || []) {
    if (/Gleich voraus liegt|Geh die letzten Meter|ein paar Schritte weiter/i.test(a.teaser_text || '')) {
      a.teaser_text = `Gleich voraus: ${spot.name}. Hier gibt’s Geschichte, Alltag und eine kleine Schätzfrage — komm näher.`;
    }
  }

  return {
    id: spot.id,
    name: spot.name,
    category: spot.category || '',
    added,
    fields,
    deepAfter: pool.length,
  };
}

function main() {
  const pack = JSON.parse(fs.readFileSync(PACK, 'utf8'));
  const report = [];
  for (const spot of pack.spots) {
    report.push(enrichSpot(pack, spot));
  }

  pack.data_version = 13;
  pack._build = {
    ...(pack._build || {}),
    story_enrichment_v13: {
      at: new Date().toISOString(),
      spots_touched: report.filter((r) => r.added > 0).length,
      total_added_facts: report.reduce((n, r) => n + (r.added || 0), 0),
    },
  };

  fs.writeFileSync(PACK, JSON.stringify(pack, null, 2));

  const indexPath = path.join(ROOT, 'data/staedte/index.json');
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  const pd = (index.available_cities || []).find((c) => c.id === 'prisdorf');
  if (pd) pd.data_version = 13;
  index.last_global_update = new Date().toISOString();
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));

  const enriched = report.filter((r) => r.added > 0);
  fs.writeFileSync(
    path.join(ROOT, 'data/staedte/prisdorf_story_enrichment_report.json'),
    JSON.stringify({ version: 13, validate: validateCityPack(pack), report: enriched }, null, 2),
  );

  console.log(
    JSON.stringify(
      {
        version: pack.data_version,
        spots: pack.spots.length,
        enriched: enriched.length,
        factsAdded: enriched.reduce((n, r) => n + r.added, 0),
        validate: validateCityPack(pack),
      },
      null,
      2,
    ),
  );
}

main();
