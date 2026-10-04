# ÖPNV Live-Reise — Fix-Plan

Eine Reise. Sprache, Karte, Timeline und Live-Anzeige zeigen dieselbe belegte Kette.
Reihenfolge immer: **Ort, dann wie ich dorthin komme.**
Wortlaut bleibt frei. Keine Pflicht-Sätze, keine Sprachfehler als Ortsnamen.

Nicht anfassen: Turn-Kernel, TTS-Pipeline, zweites Kartensystem.

## Zielablauf

1. „Mein Schiff, ab Kiel, spätestens 14 Uhr“ → echter Ort **Cruise Center Kiel** (Adresse belegt).
2. Schiffe dort: nur **Mein Schiff**, wenn der User das gesagt hat.
3. Die eine passende Kreuzfahrt vorschlagen. Ja → Programm eintragen.
4. Call 1: hinbringen oder Verbindung suchen. Call 2: Leave-by rückwärts von der Deadline, dann Programm-Frage.
5. Ein Akkordeon. Kette z. B. Bahnhof Prisdorf → RB61 → Bahnhof Elmshorn → zu Fuß → Bus → Aussteigen → zu Fuß → Cruise Center Kiel.
6. Karte: eine Linie vom echten Standort über jeden Halt bis zum Ziel.
7. Wartezeit, Ankunft, Gleis, Verspätung, frühere Verbindung, Umstiegszeit laufen live und gleich in Timeline und Banner.

## Schutz, damit nichts kaputtgeht

Nach jedem Schritt nur die genannten Tests. Rot → zurück, nicht den nächsten Schritt.

| Schritt | Test |
|---|---|
| Karte / Nebel / Linie | `npm run test:map-releases` und `npx tsx src/services/ui/uiInstant.smoke.test.ts` |
| Route-Payload | `npx tsx src/services/navigation/navRouteMapPayload.smoke.test.ts` |
| Timeline | `npx tsx src/module2/timeline/liveTourSchedule.smoke.test.ts` und `plannedJourneyGroup.smoke.test.ts` |
| Einsteigen | `npx tsx src/services/navigation/boardingDetector.smoke.test.ts` |
| Cruise-Name | `npx tsx src/services/stt/cruiseVoiceRepair.smoke.test.ts` |

## Reihenfolge

### A — Ein Zielname

Sprachsatz wird nie Ziel, Banner oder Timeline-Titel.

- `src/services/stt/cruiseVoiceRepair.ts` ist schon die Reparatur auf „Cruise Center Kiel“. Jede Nav-, Banner- und Plan-Stelle muss das Ergebnis nehmen, nicht `navTurnHint` / Rohtext.
- Löschen: Anzeige von `navTurnHint`, sobald es kein Abbiegesatz ist (Header `NavHudTitle`).
- Löschen: `meta: … hilft das?` in `src/services/ui/proactiveHudEngine.ts` (`produceTransitDepart`).
- `tellMorePrompt` darf nicht in `planSessionOrchestrator` als Wunsch mit „Slot … (um Fixtermine)“ landen. Hinweis-Sätze nicht als offene Pläne schreiben.
- Gap-Fill `Los zu ${first.title}` in `gapFillTravel.ts` nur für echte Orte. Platzhalter „folgt in Sekunden“ und „?“ nicht zeigen, solange das Ziel kein Halt ist.

### B — Eine Verbindung, ein Akkordeon

- Schreiber: nur die Live-Tour (`live_journey` in `liveTourSchedule.ts`).
- Die Leiste „Erinnerung · ÖPNV“ in `PlanCalendarModal.tsx` (Zweig `!hasLiveJourney`) nicht zusätzlich zur Verbindung zeichnen. Ein Kopf, derselbe Gruppenname.
- `upsertSpokenJourneyToTimeline` / `buildPlannedJourneyStops` nicht eine zweite Gruppe „ÖPNV nach …“ neben die Live-Tour legen. Dieselbe `groupId`, oder die gesprochene Journey ersetzt den Platzhalter und wird danach nur noch von der Live-Tour fortgeschrieben.
- Lückenfüller sucht die Verbindung neu, wenn das Ziel ein belegter Halt ist und noch keine Beine da sind. Nicht abbrechen, nur weil eine leere Gruppe existiert.

### C — Reihenfolge Ort, dann Weg

Timeline-Zeile pro Halt:

1. Ort (echter Name, Gleis/Steig nur belegt)
2. Nächster Weg (Linie, Ziel, Stationen, Dauer) 
3. Nächster Ort

Nicht: Bahnzeile, direkt Fußzeile, Ort irgendwo später.

- `liveTourSchedule.ts` / `plannedJourneyGroup.ts`: **Ort → Weg → Ort → Weg** (umgesetzt). Leave-by-Fußweg zum ersten Halt darf davor stehen. `buildDayTimeline` darf gleiche Uhrzeit nicht so sortieren, dass der Fußweg vor „Aussteigen“ rutscht.
- Umstieg (Elmshorn) ist ein eigener Halt, nicht nur `stationCount`.
- `Math.max(t, s.startMs)` in `liveTourSchedule` darf eine frühere Bahn nicht auf die Bus-Uhrzeit schieben. Jedes Bein behält Abfahrt und Ankunft.
- „Verschoben (auto)“ in `planQuietOverlap.ts` stapelt Ausstieg, Fußweg und Ziel nicht auf eine Minute. Die Kette rückt zusammen oder gar nicht.

### D — Live-Zeiten und Gleis

- Wartezeit aus `now` und Abfahrt **plus Verspätung**, nicht einmalig beim Aufbau.
- `liveDeparturePoll.ts` schreibt Gleis, Verspätung und neue Abfahrt in die Live-Tour-Zeilen. Heute nur Wecker/Push. Diesen toten Seitenweg für die Timeline nicht stehen lassen: ein Update, Timeline und Banner lesen dieselben Felder.
- `syncLiveRideEtaToTour` / `applyLiveAlightArriveToStops`: nicht nur den aktuellen Ausstieg, und nicht nur bei `in_transit`. Warten am Bahnsteig zählt mit. Ankunftsuhr bleibt sichtbar (`Header.tsx` blendet sie bei `waitingAtBoard` aus — das entfernen).
- „Fahrzeug in X Min“ nur ohne Linie. Sonst Linie und Ziel.
- Frühere Verbindung und Umstiegszeit: wenn die aktuelle Abfahrt nicht mehr zur Deadline passt, still die nächste belegte Verbindung in dieselbe Gruppe schreiben. Alte Beine dieser Fahrt ersetzen, nicht anhänge.

### E — Karte: volle Linie, echter Punkt, Nebel

- `transitDisplayFix` in `navigationService.ts` ersetzt den Pfeil nicht durch einen weit vorne liegenden Spline-Punkt. Echter GPS. Aufs Gleis nur, wenn der Abstand klein ist. Vorwärtssuche über die ganze Reststrecke in `projectOntoSpline` (`routeSpline.ts`) für die Anzeige streichen.
- `buildNavRouteMapPayload`: bei `currentIsTransit` nicht nur `geomFromStop(upcoming[0])`. Alle kommenden Beine als eine Linie vom Standort bis zum Ziel. Bein ohne Geometrie bis zum nächsten Halt nicht zeichnen (kein halbes Kiel-Stück). Luftlinien über 2,5 km, die das Ziel „erreichen“, nicht still verwerfen, wenn es die einzige Bahngeometrie ist — dann die Stationskette zeichnen.
- Leere Karte: solange die Journey fehlt, den bekannten Halt-Pin setzen. Sobald Beine da sind, die volle Linie. Fuß-Polyline im Zug wegnehmen, die Bahnlinie behalten.
- Nebel: `fogBoundsFrozenRef` nicht für die Session einfrieren. Maske am aktuellen Ausschnitt, nach dem Schwenken neu. Spur aus dem Walk-Track nachziehen, auch unterwegs. `trailFc = EMPTY_FC` und das komplette Abschalten über `navFogOff` entfernen, sobald die Maske günstig am Ausschnitt hängt. Kamera nicht per Fog-`setCamera` zurückwerfen.

### F — Navigation bleibt und bleibt flüssig

- `fadeAndStopNavigation` / `stopNavigation` nicht aus Catch-up, falscher Ankunft oder überholtem Spline. Nur echtes Ziel oder User-Abbruch.
- Ein GPS-Tick: Pfeil, Banner, aktuelles Bein. Timeline-Neubau, Abfahrtsabfrage und volle Route gedrosselt, nicht im selben Tick (`applyTick` → `syncLiveRideEtaToTour`, `maybeCatchUpTourProgress`, `injectNavRoute`).
- Phasenwechsel Fuß → Bahn: Banner auf Linie und nächsten Halt, alten Abbiegesatz löschen, ein Übergang. Nicht „zu Fuß“ und „Fahrzeug in 4 Min“ auf dem Gleis.

### G — Kreuzfahrt an dieselbe Reise

- Abfahrtsort belegen, Mein Schiff filtern, eine Reise vorschlagen, nach Ja Programm aus `cruiseProgramResearch.ts` in **dieselbe** Gruppe. Kein zweites Akkordeon.
- Leave-by rückwärts von der Deadline, mit Fuß, Umstieg, Puffer.

## Altlasten löschen (nicht daneben liegen lassen)

- `hilft das?`
- Roh-Sprachsatz als `navTargetName` / Gruppentitel
- Zweites Akkordeon „Erinnerung · ÖPNV“ plus „ÖPNV nach …“
- `trailFc` immer leer und Fog-Aus nur weil Nav an ist
- Fog-Bounds einmal einfrieren
- Puck = `lastMapProjection` ohne Nähe-Check
- Ankunftsuhr aus, solange `waitingAtBoard`
- Offene Pläne aus `tellMorePrompt`
- „Verschoben (auto)“ auf der Live-Kette
- Platzhalter „folgt in Sekunden“, wenn nie eine Verbindung gesucht wird

## Fertig, wenn

Eine Fahrt von Prisdorf zum Cruise Center Kiel: ein Akkordeon, Ort dann Weg, Gleis und Verspätung in Timeline und Banner gleich, Karte eine Linie, Pfeil am echten Standort, Nebel bleibt beim Schwenken, Navigation läuft weiter und ruckelt nicht.
