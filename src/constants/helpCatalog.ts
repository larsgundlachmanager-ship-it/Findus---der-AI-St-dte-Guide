/**
 * Findus Hilfe- & Erklärungs-Katalog — thematisch gruppiert, suchbar.
 * Jeder Eintrag: Was · Wie · Optimal.
 */

export type HelpEntry = {
  id: string;
  title: string;
  /** Kurz: was man damit macht */
  what: string;
  /** Wie es funktioniert */
  how: string;
  /** Beste Bedingungen / Tipps */
  optimal: string;
  keywords: string[];
};

export type HelpTopicGroup = {
  id: string;
  label: string;
  entries: HelpEntry[];
};

function entry(
  id: string,
  title: string,
  what: string,
  how: string,
  optimal: string,
  keywords: string[],
): HelpEntry {
  return { id, title, what, how, optimal, keywords };
}

export function helpEntryBody(e: HelpEntry): string {
  return `Was: ${e.what}\n\nWie: ${e.how}\n\nOptimal: ${e.optimal}`;
}

export function helpEntrySearchBlob(e: HelpEntry): string {
  return [e.title, e.what, e.how, e.optimal, ...e.keywords].join(' ');
}

export const HELP_TOPIC_GROUPS: HelpTopicGroup[] = [
  {
    id: 'start',
    label: 'Start & Profil',
    entries: [
      entry(
        'who',
        'Wer ist Findus?',
        'Persönlicher Reise-Concierge vor Ort — erzählt, antwortet, navigiert und plant.',
        'Nutzt Standort, Profil und Stadt-Pack. Modul 1 an Wahrzeichen; Mikrofon für Fragen; Kalender für den Tag.',
        'Kopfhörer, GPS draußen, Stadt-Pack geladen, Profil ausgefüllt (Allergien, Stil, Interessen).',
        ['wer', 'persona', 'concierge', 'hands-free', 'einführung'],
      ),
      entry(
        'onboarding',
        'Einrichtung (Express / Standard)',
        'Profil anlegen: Über dich, Charakter, Interessen, Budget, Allergien & Unverträglichkeiten.',
        'Express = kompakt in einem Screen; Standard = Schritt für Schritt inkl. Concierge-Prefs.',
        'Ehrlich bei Allergien und Ernährung — fließt in Restaurant-Tipps und Warnungen ein.',
        ['einrichtung', 'onboarding', 'express', 'allergie', 'profil'],
      ),
      entry(
        'allergies',
        'Allergien & Unverträglichkeiten',
        'Findus meidet unpassende Essenstipps und kann bei Bedarf nachfragen.',
        'Unter Einrichtung / Concierge-Profil Chips wählen oder Freitext (Nüsse, Laktose, …).',
        'Bekannte Allergien immer setzen — auch „Keine“. Später in Einstellungen änderbar.',
        ['allergie', 'unverträglichkeit', 'laktose', 'nüsse', 'gluten', 'ernährung'],
      ),
      entry(
        'voice',
        'Stimme ändern',
        'Wählen, wie Findus klingt — per Sprache oder in den Einstellungen.',
        'Per Sprache: „Stimme von Lukas“, „Sprich wie Alina“, oder „Stimme ändern“ (dann Auswahl). Alternativ Zahnrad → Einrichtung → Stimme: Hörprobe, dann Namen tippen. Live-Personas brauchen Cartesia (nicht reine System-TTS).',
        'Sag den Stimmen-Namen klar; oder tippe eine der Stimmen-Buttons in meiner Antwort.',
        [
          'stimme',
          'tts',
          'hörprobe',
          'audio',
          'stimme ändern',
          'sprachbefehl',
          'alina',
          'lukas',
          'persona',
        ],
      ),
      entry(
        'self-explain',
        'Findus erklärt sich selbst',
        'Du kannst mich fragen, wie etwas geht — ich erkläre Features, Stimme, Wecker, Navigation, Planung.',
        'Sag z. B. „Wie ändere ich die Stimme?“, „Was kannst du?“, „Erklär den Kalender“, „Hilfe Wecker“. Ich antworte aus meinem Hilfe-Katalog und öffne bei Bedarf die Einstellungen.',
        'Konkrete Frage stellen („Wie …?“ / „Was ist …?“) — dann bekommst du Was / Wie / Optimal.',
        [
          'hilfe',
          'erklären',
          'erkläre',
          'was kannst du',
          'anleitung',
          'wie geht',
          'selbsterklärung',
        ],
      ),
      entry(
        'character',
        'Charakter & Interessen',
        'Ton und Themen-Schwerpunkte steuern.',
        'Einstellungen → Charakter / Interessen bzw. im Onboarding wählen.',
        'Je klarer die Interessen, desto bessere POI- und Restaurant-Vorschläge.',
        ['charakter', 'interessen', 'stil', 'ton'],
      ),
    ],
  },
  {
    id: 'vorort',
    label: 'Vor Ort',
    entries: [
      entry(
        'modul1',
        'Modul 1: Wahrzeichen & Geschichten',
        'Automatische Geschichten an markanten Orten — Hook, Anker, Story, was man hier machen kann.',
        'Bei Annäherung oft kurzer Teaser; am Ort volle Story. Darunter Stichpunkte + Buttons (Mehr Historie, Route, Links). Mehr Historie vertieft denselben Ort (max. ~1200 Zeichen, nichts erfinden).',
        'Zu Fuß/Rad draußen, GPS gut, Stadt-Pack mit POIs geladen. Ohne Pack: kaum Ortsstories. Kopfhörer empfohlen.',
        ['modul 1', 'wahrzeichen', 'poi', 'geschichte', 'stichpunkte', 'mehr historie'],
      ),
      entry(
        'modul1-limits',
        'Modul 1: Was geht / was nicht',
        'Nur Pack-Fakten + erkannte Angebote (Events, Buchung) — keine erfundenen Partys.',
        'Geht: Geschichte, Angebote aus dem Datensatz, Speisekarte/Website-Buttons wenn URL im Pack. Geht nicht: fremde Museen vorschlagen bei „Mehr Historie“, Adress-/Telefon-Dump am Anfang, Stadt ohne Pack wie Prisdorf-Guide.',
        'Stadt-Pack vorher laden. In neuer Stadt: Coverage (Stadt-Fläche) + Pack nötig für Stempel-% und Stories.',
        ['limits', 'stadt-pack', 'coverage', 'offline', 'halluzination'],
      ),
      entry(
        'teaser',
        'Früher Hinweis (Teaser)',
        'Kurzer Anstupser bevor du am Ort bist — ohne Spoiler-Name zuerst.',
        'Findus beschreibt optisch („das Gebäude da vorne…“), dann Name und Einladung.',
        'Blickrichtung frei, nicht im Auto mit schlechtem GPS.',
        ['teaser', 'annäherung', 'hook', 'wegweiser'],
      ),
      entry(
        'actions',
        'Action-Buttons',
        'Schnell reagieren: Route, mehr Info, Speisekarte, Tickets, Anrufen.',
        'Unter der Antwort / Story erscheinen Buttons — 1:1 zu Gesprochenem.',
        'Nach Event-/Essens-Fragen Buttons nutzen statt neu tippen.',
        ['buttons', 'action', 'route', 'speisekarte', 'tickets'],
      ),
      entry(
        'dining',
        'Essen & Reservierung',
        'Restaurants finden, Allergien beachten, Tisch anfragen.',
        '„Tisch für zwei um acht“ oder „wo gibt’s veganes Abendessen?“ — Buttons für Route, Speisekarte, Anrufen.',
        'Allergien & Budget im Profil; konkrete Uhrzeit und Personenzahl nennen.',
        ['essen', 'restaurant', 'reservierung', 'speisekarte', 'allergie'],
      ),
      entry(
        'wishlist',
        'Merkliste / Favoriten',
        'Orte merken und später einplanen.',
        'Bei Vorschlägen merken; im Plan oder Stadt-Welcome als Idee wieder aufgreifen.',
        'Nach dem ersten Besuch speichern, bevor du weitergehst.',
        ['merkliste', 'favoriten', 'wishlist', 'merken'],
      ),
    ],
  },
  {
    id: 'mic',
    label: 'Mikrofon & Fragen',
    entries: [
      entry(
        'mic',
        'Mikrofon bedienen',
        'Fragen stellen, Orte suchen, buchen lassen, Wetter checken — und Findus unterbrechen.',
        'Kurz tippen = Tippfeld / schreiben. Lange halten (≥ ca. 2 s) = Sprechen; Findus wird unterbrochen, Loslassen sendet. Sehr kurzer Hold zählt nicht. Unten am Homescreen (und kompakt im Plan-Kalender).',
        'Ruhige Umgebung oder Headset; Mic-Berechtigung + Audio-Consent. Nach einmal Tippen+Halten verschwindet der Coach-Hinweis.',
        ['mikrofon', 'spracheingabe', 'halten', 'tippen', 'stt', 'unterbrechen', 'barge-in'],
      ),
      entry(
        'mic-gestures',
        'Mikrofon: Tippen · Halten · Unterbrechen',
        'Drei Gesten, ein Button.',
        '1) Tippen → Textfeld. 2) Halten → Sprache. 3) Während Findus spricht: Mic halten unterbricht sofort (Barge-in).',
        'Einmal erfolgreich gehalten → Hinweistext am Mic bleibt weg (Checkliste).',
        ['geste', 'halten', 'tippen', 'coach', 'checkliste'],
      ),
      entry(
        'handsfree',
        'Hands-free / Shortcut',
        'Findus starten ohne aufs Display zu starren.',
        'Sag „Shortcut aktivieren“ — Findus prüft, was Android zulässt (Notification „Sprechen“, Home-Shortcut, Assistenten-Einstellungen) und bietet dir die Optionen an. Die sticky Notification „Findus bereit“ mit Button „Sprechen“ startet das Mikro auch vom Sperrbildschirm.',
        'Power-Taste/Gemini kann die App nicht überschreiben. Kopfhörer-Play/Pause steuert oft Musik — zuverlässig bleibt die Notification.',
        [
          'hands-free',
          'handsfree',
          'shortcut',
          'notification',
          'sprechen',
          'sperrbildschirm',
        ],
      ),
      entry(
        'livechat',
        'Live-Chat',
        'Durchgehend zuhören und sich unterhalten — ohne jedes Mal den Knopf zu halten.',
        'Sag „Live-Chat starten“, wisch am Mikro nach links, nutze „Sprechen“, oder die In-Ear-Taste (wenn unterstützt). Rechts am Mic = einmal fixieren. Im Gesprächsfenster frei weiterreden.',
        'Einstellungen → Hands-free & Live-Chat: In-Ear auf Aus / Mikro an / Live-Chat. Greift, wenn Findus die Media-Session hält — nicht während Spotify o. Ä.',
        [
          'live-chat',
          'livechat',
          'in-ear',
          'kopfhörer',
          'gespräch',
          'zuhören',
          'unterhalten',
        ],
      ),
      entry(
        'examples',
        'Beispiel-Fragen',
        'Alles von Navigation bis Party und Reservierung.',
        '„Führ mich zum Hotel.“ · „Wo gibt’s guten Kaffee?“ · „Tisch für zwei um acht.“ · „Was geht heute Abend?“ · „Brauche ich einen Schirm?“',
        'Ort + Wunsch in einem Satz nennen — Findus forscht parallel und kombiniert.',
        ['fragen', 'beispiele', 'events', 'wetter', 'essen'],
      ),
      entry(
        'multiintent',
        'Mehrteilige Fragen',
        'Essen + Aussicht + Uhrzeit in einem Satz — ein kombinierter Plan.',
        'Parallel recherchieren, dann Buttons: Route Essen, Route Aussicht, optional Multi-Stop.',
        'To-go + Sunset = Imbiss + echte Aussicht (keine Haltestelle).',
        ['multi', 'compound', 'essen', 'aussicht', 'parallel'],
      ),
      entry(
        'justdoit',
        'Just-Do-It (keine Permission-Fragen)',
        'Ergebnis + Buttons in einer Antwort — nicht „Soll ich suchen?“.',
        'Concierge recherchiert und liefert Orte, Nummern, Routen direkt.',
        'Bei Blockade (fehlende Flugnummer) kommt eine gezielte Rückfrage.',
        ['just do it', 'concierge', 'ohne nachfragen'],
      ),
      entry(
        'ack',
        'Frühes Ack-Audio',
        'Sofort hören, dass Findus die Frage verstanden hat — dann das Ergebnis.',
        'Bei Recherche: intent-passendes Ack („Speisekarte raus“, „Termine“, „Ort“, „Geschichtsbücher“, „plane kurz…“), dann Satz-Streaming.',
        'Netz an; Headset; nicht unterbrechen während der ersten Sätze.',
        ['warten', 'ack', 'streaming', 'latency', 'speisekarte', 'termine'],
      ),
    ],
  },
  {
    id: 'nav',
    label: 'Navigation',
    entries: [
      entry(
        'compass',
        'Kompass & Fuß-Navigation',
        'Hands-free zum Ziel führen.',
        'Route starten (Button oder „Führ mich zu …“). Kompass zeigt Richtung; Ankunfts-Outro am Ziel.',
        'Standort „Immer“ / präzise; draußen; zu Fuß oder Rad.',
        ['navigation', 'kompass', 'route', 'führen'],
      ),
      entry(
        'queue',
        'Stopp-Queue / Multi-Stop',
        'Mehrere Ziele in Reihenfolge abarbeiten.',
        'Während Nav: Queue rechts — verschieben, löschen, umsortieren. Swipe öffnet Routen-Modus.',
        'Vor dem Losgehen Stopps prüfen; lange Touren in kurze Etappen teilen.',
        ['queue', 'multistopp', 'stopps', 'swipe'],
      ),
      entry(
        'leaveby',
        'Leave-by (rechtzeitig los)',
        'Nicht den Zug/Flug/Kino/Sunset verpassen.',
        'Findus rechnet Ankunftspuffer + Weg rückwärts und erinnert zum Aufbruch — Trigger am Aufbruch, nicht am Event. Fixe Punkte setzen Leave-by automatisch — keine „Wann erinnern?“-Frage.',
        'GPS + Benachrichtigungen an; feste Uhrzeiten im Plan.',
        ['leave-by', 'puffer', 'aufbruch', 'erinnerung', 'kino', 'zug', 'sunset'],
      ),
      entry(
        'nav-cancel',
        'Navigation beenden',
        'Route stoppen ohne Menü-Suche.',
        'Während Navigation: langer Druck auf die Live-Anzeige beendet die Führung. Am Ziel einmal „Ziel erreicht“ — kein Loop.',
        'Einmal getestet → Coach-Hinweis verschwindet für immer.',
        ['navigation aus', 'stop', 'lang drücken', 'ziel erreicht'],
      ),
      entry(
        'live-delays',
        'Live-Verspätungen ÖPNV',
        'Findus kann Verspätungen ansagen, wenn Live-Daten da sind.',
        'Frage z. B. „Kommt der Zug pünktlich?“ oder plane Leave-by — kurz vor Abfahrt prüft Findus nach. EU: Transitous; DE wo angebunden HAFAS/DB.',
        'Netz nötig. Ohne Daten sagt er transparent Bescheid — kein Fake-Fahrplan.',
        ['verspätung', 'öpnv', 'live', 'zug', 'bus'],
      ),
    ],
  },
  {
    id: 'planning',
    label: 'Planung & Timeline',
    entries: [
      entry(
        'plan-calendar',
        'Tagesplan / Kalender öffnen',
        'Timeline des Tages: Stopps, Leave-by, Auswahlfragen.',
        'Oben rechts Kalender-/Plan-Icon tippen. Dort: geplante Orte, ❓-Auswahl, Änderungen (blau bis Fix).',
        'Einmal geöffnet → Coach „Tagesplanung“ verschwindet.',
        ['kalender', 'timeline', 'tagesplan', 'plan'],
      ),
      entry(
        'plan-choices',
        'Auswahl in der Timeline (❓)',
        'Bei A/B-Vorschlägen tippst du den gewünschten Stopp.',
        'Zeilen mit ❓ sind wählbar. Unten Schnellantworten: rechts typisch Bestätigen, links Ablehnen/Optimieren.',
        'Erst wählen → dann Leave-by/Nav. „Andere Alternativen“ = neue Orte.',
        ['fragezeichen', 'auswahl', 'choice', 'bestätigen'],
      ),
      entry(
        'plan-flow',
        'Abendplan: Sunset → Essen → Party',
        'Mehrere Wünsche nacheinander abarbeiten.',
        'Nach einer Auswahl kommt der nächste offene Punkt (zeitlich nahe zuerst). Sunset vorbei → ehrlich + auf morgen.',
        'Wünsche klar sagen („vorher essen“, „danach Bar“).',
        ['sunset', 'abendessen', 'party', 'queue', 'mehrteilig'],
      ),
      entry(
        'plan-dining',
        'Restaurants im Plan',
        'Echte Lokale — Tankstellen nur Notfall.',
        'Pitch mit Vibes, Distanz, Speisekarte/Website. Alternativen = 3–4 neue Richtungen.',
        'Allergien im Profil; Küche nennen (Burger, Schnitzel…).',
        ['restaurant', 'speisekarte', 'alternativen', 'tankstelle'],
      ),
    ],
  },
  {
    id: 'stamp',
    label: 'Stempelkarte',
    entries: [
      entry(
        'passport',
        'Stempelkarte & Fog-of-War',
        'Sehen, was du schon erkundet hast — Orte + Flächen-% der Stadt (Coverage).',
        'Oben rechts unter dem Zahnrad das Karten-Icon → Stempelkarte, Kategorien, Prozent. Coverage = Stadt-BBox, nicht das Pack.',
        'GPS an, Stadt geladen; zu Fuß freiruckeln zählt. Einmal geöffnet → Coach weg.',
        ['stempelkarte', 'fog', 'prozent', 'karte', 'hud', 'coverage'],
      ),
      entry(
        'livehud',
        'Live-Anzeige (oben links)',
        'Aktueller Ort, Nav-Ziel, kurze Vorschläge — tippen lädt Tipps.',
        'Zeile oben links tippen = Tipps. Stempelkarte: Karten-Icon unter dem Zahnrad.',
        'Während Navigation und Stadtbummel im Blick behalten.',
        ['live', 'hud', 'anzeige', 'tipps'],
      ),
    ],
  },
  {
    id: 'logistics',
    label: 'Wetter & Reisen',
    entries: [
      entry(
        'weather',
        'Wetter & Regen',
        'Schirm-Tipp bei Regen.',
        'OpenWeather live; Warnungen vor Regen mit Café-Vorschlag.',
        'Netz für frische Daten; GPS für Standort-Wetter.',
        ['wetter', 'regen', 'schirm', 'openweather'],
      ),
      entry(
        'transit',
        'ÖPNV & Züge',
        'Verbindungen und Leave-by für Bus/Bahn.',
        'Live-Checks kurz vor Leave-by sowie 24h/4h vorher. Push auch bei gesperrtem Screen.',
        'Benachrichtigungen an; Bahnhof/Ziel klar im Plan.',
        ['öpnv', 'zug', 'bus', 'verbindung', 'verspätung'],
      ),
      entry(
        'flight',
        'Flüge',
        'Abflug, Gate, Verspätung im Blick.',
        'Flugnummer nennen → adaptive Checks (24h → 4h → engmaschig). Plan nur bei spürbarer Änderung.',
        'Flugnummer + Datum; Push erlauben.',
        ['flug', 'gate', 'flightaware', 'abflug'],
      ),
      entry(
        'events',
        'Events & Nightlife',
        'Tagesaktuelles Programm statt Platzhalter.',
        '„Was geht heute Abend?“ → Kalender/Flyer/PDF; Buttons für Route, Flyer, Tickets.',
        'Stadt mit Netz; abends fragen für frische Programme.',
        ['events', 'party', 'nightlife', 'heute abend', 'flyer'],
      ),
    ],
  },
  {
    id: 'audio',
    label: 'Audio & Stumm',
    entries: [
      entry(
        'saver',
        'Sparmodus',
        'Akku und Daten schonen.',
        'Einstellungen → Sparmodus: weniger Prefetch/API, kürzere Antworten möglich.',
        'Lange Tage, schwaches Netz, niedriger Akku.',
        ['sparmodus', 'akku', 'daten'],
      ),
      entry(
        'mute',
        'Stummmodus',
        'Kein Audio z. B. im Museum — später wieder wecken.',
        'Einstellungen: Stumm bis Uhrzeit oder Distanz (Wake-Radius). „Stumm beenden“ weckt sofort.',
        'Museum, Konzert, Meeting; Wake-Distanz ≥ 20 m setzen.',
        ['stumm', 'mute', 'museum', 'aufwachen'],
      ),
      entry(
        'module1-bg',
        'Modul 1 im Hintergrund',
        'Wann Findus an Orten erzählt, wenn die App zu oder das Handy gesperrt ist.',
        'Einstellungen → Audio: Immer (Standard) · Nur Kopfhörer · Nur App offen.',
        'Taschenlautsprecher stören? „Nur Kopfhörer“ oder „Nur App offen“ wählen.',
        ['modul 1', 'hintergrund', 'sperrbildschirm', 'kopfhörer', 'gesperrt'],
      ),
      entry(
        'battery',
        'Akku unter 15 %',
        'Findus schaltet auf Audio-first und sucht Powerbank-Automaten oder Steckdosen in der Nähe.',
        'Automatischer Survival-Hinweis — konkrete Route-Buttons wenn GPS da ist.',
        'Powerbank-Automat oder Café mit Steckdose annehmen wenn angeboten.',
        ['akku', 'battery', 'survival', 'laden', 'powerbank', 'steckdose'],
      ),
    ],
  },
  {
    id: 'settings',
    label: 'Einstellungen',
    entries: [
      entry(
        'setup-menu',
        'Einrichtung im Zahnrad',
        'Stadt, Stimme, Über dich, Kontakt, Charakter, Prefs nachträglich ändern.',
        '⚙️ → Einrichtung: Akkordeons für alle Profil-Teile inkl. Concierge-Prefs (Allergien!).',
        'Nach Ortswechsel Stadt neu laden; Kontakt für Reservierungen pflegen.',
        ['einstellungen', 'einrichtung', 'stadt', 'kontakt'],
      ),
      entry(
        'triggers-settings',
        'Meine Trigger (Einstellungen)',
        'Leave-by, Geo- und Zeit-Erinnerungen aus dem Plan.',
        '⚙️ → Meine Trigger: alles, was dich pünktlich machen soll. Läuft automatisch mit bestätigtem Plan — du musst nicht „Erinnerung einrichten“ tippen.',
        'Benachrichtigungen erlauben. Einmal angeschaut → Coach abgehakt.',
        ['trigger', 'erinnerung', 'leave-by', 'meine trigger'],
      ),
      entry(
        'internal',
        'Interne Einstellungen',
        'Gelerntes Profil, Logistik, Push-Trigger einsehen.',
        '⚙️ → Interne Einstellungen: Memory löschen, offene Flüge/Züge/To-dos, geplante Trigger.',
        'Zum Prüfen was Findus „weiß“ — nicht nötig für den Alltag.',
        ['intern', 'gelernt', 'memory', 'logistik', 'trigger'],
      ),
      entry(
        'feature-checklist',
        'Feature-Checkliste (einmal verstehen)',
        'Hinweise verschwinden, sobald du die Geste/Funktion einmal genutzt hast.',
        'Mic tippen+halten, Kalender öffnen, Zahnrad, Stempelkarte, Navigation starten/beenden. Verbal: Findus schlägt Features vor; wenn du es nicht nutzt, 3× Pause, beim 4. Mal wieder Erinnerung — bis du es einmal machst, dann nie wieder.',
        'Einstellungen → Erklärungen zum Nachlesen; Coach nur bis zum ersten Erfolg.',
        ['checkliste', 'coach', 'onboarding', 'einmal', 'tipp'],
      ),
      entry(
        'notifications',
        'Benachrichtigungen',
        'Erinnerungen trotz gesperrtem Bildschirm.',
        'System-Permission + Schalter „Hinweise & Erinnerungen“ im Profil.',
        'Immer erlauben für Leave-by, Flug und Bus.',
        ['benachrichtigung', 'push', 'permission'],
      ),
      entry(
        'location-perm',
        'Standort-Rechte',
        'Navigation und POI-Erkennung.',
        'Android: möglichst „Immer zulassen“ für Hintergrund. Findus führt bis zum Systemdialog.',
        'Draußen testen; Batterie-Optimierung für die App lockern wenn GPS stirbt.',
        ['standort', 'gps', 'permission', 'android'],
      ),
      entry(
        'citypack',
        'Stadt-Pack & Offline',
        'POIs und Geschichten offline dabei.',
        'Einrichtung → Stadt wählen und Pack laden. Offline: Pack-Inhalte; Netz: Live-Events, Cloud-Stimme, Recherche.',
        'Einmal mit WLAN laden vor der Reise.',
        ['stadt-pack', 'offline', 'download'],
      ),
      entry(
        'legal',
        'Datenschutz & Impressum',
        'Pflichtinfos zu Daten, KI und Partner-Links.',
        '⚙️ → Datenschutz & Impressum.',
        'Vor dem Teilen von Kontaktdaten kurz lesen.',
        ['datenschutz', 'impressum', 'ki', 'partner'],
      ),
      entry(
        'feedback',
        'Feedback & Probleme',
        'Bugs und Wünsche melden.',
        'Unter Einstellungen Feedback / Probleme — hilft dir und anderen.',
        'Reproduktionsschritt + Stadt nennen.',
        ['feedback', 'bug', 'problem'],
      ),
    ],
  },
  {
    id: 'trouble',
    label: 'Probleme',
    entries: [
      entry(
        'gps-fail',
        'GPS hängt / Route fail',
        'Findus entschuldigt sich und nennt einen Fix.',
        '„Geh kurz ein paar Schritte ins Freie.“ Standort-Rechte prüfen.',
        'Nicht in tiefen Gebäuden oder unterirdisch erwarten.',
        ['gps', 'fehler', 'route', 'troubleshooting'],
      ),
      entry(
        'mic-fail',
        'Mikrofon geht nicht',
        'Spracheingabe wiederherstellen.',
        'App-Berechtigung Mikrofon; bei „nicht verfügbar“ System-Einstellungen. Kurz tippen zum Schreiben als Fallback.',
        'Headset neu stecken; andere App die das Mic blockiert schließen.',
        ['mikrofon', 'permission', 'stt', 'fehler'],
      ),
      entry(
        'no-audio',
        'Kein Ton',
        'Audio wieder hören.',
        'Stummmodus prüfen; Lautstärke Media; Stimme neu wählen; Spar-/Offline-Modus.',
        'Kopfhörer-Verbindung und Stumm-Session beenden.',
        ['ton', 'audio', 'stumm', 'lautstärke'],
      ),
    ],
  },
];

/** Flache Liste aller Einträge (Suche). */
export function allHelpEntries(): HelpEntry[] {
  return HELP_TOPIC_GROUPS.flatMap((g) => g.entries);
}

export function findHelpGroupForEntry(entryId: string): HelpTopicGroup | null {
  return HELP_TOPIC_GROUPS.find((g) => g.entries.some((e) => e.id === entryId)) ?? null;
}

function normalizeHelpQuery(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Sprach-/Suche: beste Hilfe-Einträge zum User-Text. */
export function searchHelpEntries(query: string, limit = 3): HelpEntry[] {
  const q = normalizeHelpQuery(query);
  if (!q) return [];
  const tokens = q.split(' ').filter((t) => t.length >= 2);
  const scored = allHelpEntries()
    .map((e) => {
      const blob = normalizeHelpQuery(helpEntrySearchBlob(e));
      let score = 0;
      if (blob.includes(q)) score += 12;
      for (const t of tokens) {
        if (blob.includes(t)) score += 3;
        if (e.keywords.some((k) => normalizeHelpQuery(k).includes(t))) score += 4;
        if (normalizeHelpQuery(e.title).includes(t)) score += 5;
      }
      return { e, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.e);
}

/** Spoken Kurzfassung Was/Wie/Optimal. */
export function helpEntrySpeech(e: HelpEntry): string {
  return `${e.title}. Was: ${e.what} Wie: ${e.how} Optimal: ${e.optimal}`;
}
