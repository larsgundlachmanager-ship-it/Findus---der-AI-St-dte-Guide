/**
 * Yorro Hilfe- & Erklärungs-Katalog — thematisch gruppiert, suchbar.
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
        'Wer ist Yorro?',
        'Hands-free Stadtguide für den Städtetrip — läuft mit, erzählt am Ort, hilft bei Fragen, Weg und Essen.',
        'Kopfhörer rein. GPS erkennt den Ort. Stimme für Fragen. Stadt-Pack vorher laden.',
        'Draußen zu Fuß, Pack geladen, GPS an, Stimme hörbar. Dann triggert Yorro von selbst.',
        ['wer', 'persona', 'concierge', 'hands-free', 'einführung'],
      ),
      entry(
        'onboarding',
        'Einrichtung (Express / Standard)',
        'Einmal einrichten, dann läuft der Trip. Express reicht für den Start.',
        'Express = kompakt in einem Screen (empfohlen). Standard = Schritt für Schritt. Feinschliff später unter Einstellungen.',
        'Express wählen, wenn du schnell rauswillst. Allergien kannst du nachziehen.',
        ['einrichtung', 'onboarding', 'express', 'allergie', 'profil'],
      ),
      entry(
        'allergies',
        'Allergien & Unverträglichkeiten',
        'Yorro meidet unpassende Essenstipps und kann bei Bedarf nachfragen.',
        'Einstellungen → Persönliche Informationen → Über dich: Ernährungspräferenzen dabei.',
        'Bekannte Allergien immer setzen — auch „Keine“.',
        ['allergie', 'unverträglichkeit', 'laktose', 'nüsse', 'gluten', 'ernährung'],
      ),
      entry(
        'voice',
        'Stimme ändern',
        'Wählen, wie Yorro klingt — per Sprache oder in den Einstellungen.',
        'Per Sprache: „Stimme von Lukas“, „Sprich wie Alina“, oder „Stimme ändern“. Alternativ Zahnrad → Yorros Charakter → Stimme.',
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
        'Yorro erklärt sich selbst',
        'Du kannst mich fragen, wie etwas geht — ich erkläre Features, Stimme, Wecker, Navigation, Planung.',
        'Sag z. B. „Wie ändere ich die Stimme?“, „Was kannst du?“, „Erklär den Kalender“, „Hilfe Wecker“. Ich antworte aus dem Katalog unter Einstellungen → Erklärungen.',
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
        'Einstellungen → Yorros Charakter (Kernrolle und weitere Einstellungen).',
        'Je klarer die Interessen, desto bessere POI- und Restaurant-Vorschläge.',
        ['charakter', 'interessen', 'stil', 'ton'],
      ),
    ],
  },
  {
    id: 'trip',
    label: 'Aktuelle Reise',
    entries: [
      entry(
        'trip-boot',
        'Aktuelle Reise (Trip-Boot)',
        'Alles, was sich pro Stadt ändern kann — Begleitung, Anreise, Budget, Reisestil, Startpunkt.',
        'Einstellungen → Aktuelle Reise. Poppt auch nach Stadtwechsel oder langer Pause auf.',
        'Nach Ortswechsel (z. B. Hamburg → Lissabon) kurz checken: Freunde vs. allein, Flug vs. Auto, Budget.',
        [
          'reise',
          'trip',
          'stadtwechsel',
          'begleitung',
          'budget',
          'unterkunft',
          'startpunkt',
        ],
      ),
      entry(
        'start-base',
        'Startpunkt & Unterkunft',
        'Von hier starten die Wege im Tagesplan („Los zu …“).',
        'Einstellungen → Aktuelle Reise → Startpunkt: Hier = Zuhause / Hotel / Ferienwohnung (GPS). Stadt-getrennt.',
        'In der neuen Stadt einmal setzen — alter Startpunkt aus anderer Stadt gilt nicht mit.',
        ['hotel', 'unterkunft', 'zuhause', 'startpunkt', 'gps'],
      ),
      entry(
        'motives',
        'Reisezweck',
        'Urlaub, Business, Kurztrip, Party — steuert Ton und Empfehlungs-Mix.',
        'Einstellungen → Aktuelle Reise → Reisezweck (bis 3 Chips).',
        'Bei Geschäftsreise Business setzen; mit Freunden Party/Freizeit — dann stimmen Nightlife-Tipps besser.',
        ['reisezweck', 'business', 'urlaub', 'motives'],
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
        'Bei Annäherung oft kurzer Teaser; am Ort volle Story. Darunter Stichpunkte + Buttons (Mehr Historie, Route, Links). Mehr Historie vertieft denselben Ort (max. ~2000 Zeichen, nichts erfinden).',
        'Zu Fuß/Rad draußen, GPS gut, Stadt-Pack mit POIs geladen. Ohne Pack: kaum Ortsstories. Kopfhörer empfohlen. Cloud-Stimme braucht Netz; ohne Netz spricht die Gerätestimme.',
        ['modul 1', 'wahrzeichen', 'poi', 'geschichte', 'stichpunkte', 'mehr historie'],
      ),
      entry(
        'walk-ready',
        'Bereit zum Laufen',
        'Vier Dinge, die der Tourist merkt: Pack geladen, Stimme hörbar, GPS hält, Navigation spricht.',
        'Stadt vorher herunterladen. Draußen GPS prüfen. Kopfhörer. Cloud-Stimme mit Netz; sonst Gerätestimme.',
        'Vor der Abfahrt einmal mit WLAN das Pack laden.',
        ['walk', 'gps', 'pack', 'offline', 'stimme', 'bereit'],
      ),
      entry(
        'share-moment',
        'Moment teilen',
        'Einen Ort aus der Stempelkarte weiterleiten — der Freund versteht den Moment ohne Tutorial.',
        'In der Stempelkarte: Entdeckungen teilen oder Freund einladen. Die Concierge-Antwort selbst hat keinen Teilen-Button.',
        'Teile den Satz vom Ort, nicht die App-Erklärung.',
        ['teilen', 'whatsapp', 'stempel', 'einladen'],
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
        'Yorro beschreibt optisch („das Gebäude da vorne…“), dann Name und Einladung.',
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
        'Fragen stellen, Orte suchen, buchen lassen, Wetter checken — und Yorro unterbrechen.',
        'Kurz tippen = Tippfeld. Halten = Mikro sofort an (Loslassen sendet). Während Halten nach rechts = Feststelltaste. Nach links = Live-Chat. Unten am Homescreen (und kompakt im Plan-Kalender).',
        'Ruhige Umgebung oder Headset; Mic-Berechtigung + Audio-Consent. Nach einmal Tippen+Halten verschwindet der Coach-Hinweis.',
        ['mikrofon', 'spracheingabe', 'halten', 'tippen', 'stt', 'unterbrechen', 'barge-in'],
      ),
      entry(
        'mic-gestures',
        'Mikrofon: Tippen · Halten · Fixieren · Live-Chat',
        'Vier Gesten, ein Button.',
        '1) Kurz tippen → Tippfeld. 2) Halten → Mikro sofort an. 3) Während Halten nach rechts → Feststelltaste. 4) Nach links → Live-Chat.',
        'Einmal erfolgreich gehalten → Hinweistext am Mic bleibt weg (Checkliste).',
        ['geste', 'halten', 'tippen', 'coach', 'checkliste'],
      ),
      entry(
        'handsfree',
        'Hands-free / Shortcut',
        'Yorro starten ohne aufs Display zu starren.',
        'Sag „Shortcut aktivieren“ — Yorro prüft, was Android zulässt (Notification „Sprechen“, Home-Shortcut, Assistenten-Einstellungen) und bietet dir die Optionen an. Die sticky Notification „Yorro bereit“ mit Button „Sprechen“ startet das Mikro auch vom Sperrbildschirm.',
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
        'Einstellungen → Hands-free & Live-Chat: In-Ear auf Aus / Mikro an / Live-Chat. Greift, wenn Yorro die Media-Session hält — nicht während Spotify o. Ä.',
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
        'Ort + Wunsch in einem Satz nennen — Yorro forscht parallel und kombiniert.',
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
        'Sofort hören, dass Yorro die Frage verstanden hat — dann das Ergebnis.',
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
        'Yorro rechnet Ankunftspuffer + Weg rückwärts und erinnert zum Aufbruch — Trigger am Aufbruch, nicht am Event. Fixe Punkte setzen Leave-by automatisch — keine „Wann erinnern?“-Frage.',
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
        'Yorro kann Verspätungen ansagen, wenn Live-Daten da sind.',
        'Frage z. B. „Kommt der Zug pünktlich?“ oder plane Leave-by — kurz vor Abfahrt prüft Yorro nach. EU: Transitous; DE wo angebunden HAFAS/DB.',
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
        'trip-mode',
        'Städtetrip / N Tage',
        'Touristen-Aufenthalt: „4 Tage München“, „Wochenende in Lübeck“, „Tagestrip …“.',
        'Yorro legt Tag 1–N im Kalender an (Anreise / Erkunden / Abreise), merkt sich den Trip und begrüßt trip-bewusst. Danach Wünsche nachfüllen.',
        'Stadt-Pack laden. Offline: Stories + gecachte Routen; frische Recherche braucht Netz.',
        ['trip', 'urlaub', 'tage', 'wochenende', 'tagestrip', 'städtetrip'],
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
        'Orte, Legende & Erkundungsstand',
        'Suchen, Farben verstehen, sehen was du schon erkundet hast.',
        'Homescreen-Karte: Fog of War, Orte als Flächen. Grün besucht · Blau nur geplant · Violett Auslösen · Rot Story · ruhiges Gelb Alltag. Unten „Orte“: Standard = erste Reihe; Alles / Nichts / Standard.',
        'GPS an, Stadt geladen; zu Fuß freiruckeln zählt.',
        ['stempelkarte', 'fog', 'prozent', 'karte', 'hud', 'coverage', 'orte', 'legende'],
      ),
      entry(
        'livehud',
        'Live-Anzeige (oben)',
        'Ort, Wetter, Tipps — tippen lädt Tipps.',
        'Oben die Live-Anzeige tippen. Unten: Timeline · Orte · Einst.',
        'Während Navigation und Stadtbummel im Blick behalten.',
        ['live', 'hud', 'anzeige', 'tipps', 'wetter'],
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
        'Einstellungen → Allgemeine Einstellungen → Sparmodus: weniger Prefetch/API, kürzere Antworten möglich.',
        'Lange Tage, schwaches Netz, niedriger Akku.',
        ['sparmodus', 'akku', 'daten'],
      ),
      entry(
        'mute',
        'Stummmodus',
        'Kein Audio z. B. im Museum — später wieder wecken.',
        'Einstellungen → Allgemeine Einstellungen: Stumm bis Uhrzeit oder Distanz (Wake-Radius). „Stumm beenden“ weckt sofort.',
        'Museum, Konzert, Meeting; Wake-Distanz ≥ 20 m setzen.',
        ['stumm', 'mute', 'museum', 'aufwachen'],
      ),
      entry(
        'module1-bg',
        'Modul 1 im Hintergrund',
        'Wann Yorro an Orten erzählt, wenn die App zu oder das Handy gesperrt ist.',
        'Einstellungen → Allgemeine Einstellungen → Audio: Immer (Standard) · Nur Kopfhörer · Nur App offen.',
        'Taschenlautsprecher stören? „Nur Kopfhörer“ oder „Nur App offen“ wählen.',
        ['modul 1', 'hintergrund', 'sperrbildschirm', 'kopfhörer', 'gesperrt'],
      ),
      entry(
        'battery',
        'Akku unter 15 %',
        'Yorro schaltet auf Audio-first und sucht Powerbank-Automaten oder Steckdosen in der Nähe.',
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
        'Einstellungen-Menü',
        'Stadtauswahl → Aktuelle Reise → Yorro Reisebüro. Dann Persönlich, Allgemein, Speicher. Danach Trigger, Erklärungen und Datenschutz, Feedback, intern.',
        'Zahnrad: Kacheln in Gruppen. Offene Kachel sitzt oben fest — nichts bleibt darüber. Runterwischen zeigt die restlichen Kacheln. Unterkacheln (Kontakt, Charakter…) pinnen genauso.',
        'Nach Ortswechsel zuerst Stadtauswahl + Aktuelle Reise; Stimme und Charakter unter Persönlich.',
        ['einstellungen', 'einrichtung', 'stadt', 'kontakt', 'aktuelle reise'],
      ),
      entry(
        'triggers-settings',
        'Meine Trigger (Einstellungen)',
        'Leave-by, Geo- und Zeit-Erinnerungen aus dem Plan.',
        '⚙️ → Meine Trigger: alles, was dich pünktlich machen soll. Läuft mit bestätigtem Plan — du musst nicht „Erinnerung einrichten“ tippen.',
        'Benachrichtigungen erlauben. Einmal angeschaut → Coach abgehakt.',
        ['trigger', 'erinnerung', 'leave-by', 'meine trigger'],
      ),
      entry(
        'explanations',
        'Erklärungen',
        'Hilfe-Katalog: Was / Wie / Optimal zu allen Features.',
        '⚙️ → Erklärungen (vor Datenschutz). Suchbar, nach Themen gruppiert.',
        'Wenn du etwas nicht findest: Yorro fragen („Wie …?“).',
        ['erklärungen', 'hilfe', 'katalog', 'anleitung'],
      ),
      entry(
        'internal',
        'Interne Einstellungen',
        'Gelerntes Profil, Logistik, Push-Trigger einsehen.',
        '⚙️ → unter dem Strich „Nur für dich / intern“: Memory, Beta, Logistik.',
        'Zum Prüfen was Yorro „weiß“ — nicht nötig für den Alltag.',
        ['intern', 'gelernt', 'memory', 'logistik', 'trigger'],
      ),
      entry(
        'feature-checklist',
        'Feature-Checkliste (einmal verstehen)',
        'Hinweise verschwinden, sobald du die Geste/Funktion einmal genutzt hast.',
        'Mic tippen+halten, Kalender öffnen, Zahnrad, Stempelkarte, Navigation starten/beenden. Verbal: Feature-Vorschläge bis zum ersten Erfolg.',
        'Einstellungen → Erklärungen zum Nachlesen; Coach nur bis zum ersten Erfolg.',
        ['checkliste', 'coach', 'onboarding', 'einmal', 'tipp'],
      ),
      entry(
        'notifications',
        'Benachrichtigungen',
        'Erinnerungen trotz gesperrtem Bildschirm.',
        'System-Permission + Schalter unter Allgemeine Einstellungen → Antwortstil & Hinweise.',
        'Immer erlauben für Leave-by, Flug und Bus.',
        ['benachrichtigung', 'push', 'permission'],
      ),
      entry(
        'location-perm',
        'Standort-Rechte',
        'Navigation und POI-Erkennung.',
        'Android: möglichst „Immer zulassen“ für Hintergrund. Yorro führt bis zum Systemdialog.',
        'Draußen testen; Batterie-Optimierung für die App lockern wenn GPS stirbt.',
        ['standort', 'gps', 'permission', 'android'],
      ),
      entry(
        'citypack',
        'Stadt-Pack & Offline',
        'POIs und Geschichten offline dabei.',
        'Einstellungen → Stadt: Pack laden. Offline: Pack-Geschichten und gecachte Wege. Netz: Live-Events, Cloud-Stimme, frische Recherche. Ohne Netz spricht die Gerätestimme.',
        'Einmal mit WLAN laden vor der Abfahrt. Walk-Vertrag: Pack da, Stimme da, GPS hält, Navigation spricht.',
        ['stadt-pack', 'offline', 'download'],
      ),
      entry(
        'legal',
        'Datenschutz, AGB & Impressum',
        'Pflichtinfos zu Daten, KI, AGB und Partner-Links.',
        '⚙️ → Datenschutz, AGB & Impressum (nach Erklärungen).',
        'Vor dem Teilen von Kontaktdaten kurz lesen.',
        ['datenschutz', 'impressum', 'agb', 'ki', 'partner'],
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
        'Yorro entschuldigt sich und nennt einen Fix.',
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
