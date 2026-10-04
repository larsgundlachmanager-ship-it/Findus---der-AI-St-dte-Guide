# Live-Nav Masterplan — 2.0.97 Test (Nothing)

Ziel: Alle Hänger und Fehlansagen aus dem Fuß+ÖPNV-Live-Test lösen  
(Morgen 08:18–08:27 + Abend 19:19–21:08, Nothing).

Positiv behalten: Bahn-Ansage gut · Fog-Trail-Idee gut (nur härten).  
Bereits gefixt (Retest): Adresse = Exact-Coords (kein POI-Snap) · Fog-Trail ohne Maske/dunklem Zoom-Kasten.

---

## Phase 0 — Kritische Hänger (zuerst)

| # | Problem | Fix-Richtung | SSOT |
|---|---------|--------------|------|
| 0.1 | **Route nicht auf Karte** (auch Morgen: „route weg“) | injectNavRoute / Tour-Commit nach Start & nach ÖPNV→Fuß; nie wipe während navActive | `HomePresenceMap` injectNavRoute, `navRouteMapPayload` |
| 0.2 | Speech stoppt nach „alles klar“, lange Pause / **Speech sehr spät** | Bridge + Nav-Start parallel; Call-2 ETA in dieselbe TTS-Session; Timeline/Busy nicht blocken | `navStartSpeech`, `presentConcierge`, `kickCall1ParallelWork` |
| 0.3 | Nach ÖPNV **Fußroute geht nicht weiter** | Alight → nächstes Tour-Bein force foot enrich; Stationskette nicht als einzige Geometrie hängen lassen | `multiStopTour`, `startNavigationToCoords`, journey handoff |
| 0.4 | **App stockt** — Fertig nicht tippbar, UI träge | Fog/Map-Arbeit vom JS-Hot-Path; Chrome-Lane frei; keine Sync-Mega-Jobs während Nav | `interactiveBootGate`, fog chunk/yield, `uiInstant` |
| 0.5 | **GPS hängt zurück** / aktualisiert nicht mehr | Fog-Load darf GPS-Tick nicht blocken; Cadence halten; Watchdog wenn stale | `navigationService` GPS, fog engine off-main |
| 0.6 | **Nav-Cue TTS Cache ENOENT** (Log ×3) → Cue stumm | Cache-Miss → sofort neu synth / Fallback; stale Path nicht abspielen | `AudioVoiceService` / cached nav cue |
| 0.7 | **Browse-Pack Spam** uetersen/appen HTTP 400 während Nav | Fehlendes Pack nicht retry-loopen; Nav-Lane blockiert Catalog-Browse | `cityCatalog` + research lane |
| 0.8 | **Ambient Places während aktiver Nav** (`Arena OR Stadion…` alle ~1 Min) | Ambient/Places-Poll pausieren solange `navActive` / speaking | `ambientEventPitch` / places poll |

**Done wenn:** Nav ≤1–2 s nach Bridge, blaue Linie sichtbar, nach Bus-Ausstieg Fußlinie da, UI tippbar, GPS ≤~2–3 s frisch, keine Cue-ENOENT, kein Catalog-Spam in Nav.

---

## Phase 1 — ÖPNV-Takt (eine Blaupause)

**Sequenz (Wortlaut frei):**

1. **Unterwegs zum Halt:** nur Fuß-Cues — **keine** Linie/Bus-Nummer.
2. **Erstes Ankommen am Halt:** Live-Min + Linie + Ziel + Gleis/Abfahrtbereich (falls bekannt). HUD = Minuten bis Fahrzeug (nicht Ziel-ETA).
3. **Fahrzeug gleich da:** Einsteigen + Linie/Ziel; Anzeige sofort „steig ein“.
4. **Nach Einsteigen:** kurz Bestätigung + X Haltestellen bis Ausstieg. HUD = „noch X Stationen bis … → Y Min“, **live** runterzählen.
5. **Noch 3 / 2 / 1 Station:** Countdown-Ansage.
6. **Jetzt aussteigen.**
7. **Fuß weiter:** ggf. „entgegen der Fahrtrichtung“ wenn Route so liegt.

| # | Problem | Fix |
|---|---------|-----|
| 1.1 | Bus-Linie zu früh (noch nicht am Halt) | Gate: board-Speech erst near board-stop |
| 1.2 | „Steig jetzt ein“ zu früh | Erst wenn Live-Abfahrt ≈ jetzt / Fahrzeug da |
| 1.3 | HUD Ziel-ETA am Halt | HUD-Mode: waiting → vehicle ETA; riding → stations+min |
| 1.4 | „Nicht mehr schaffen“ zu früh | Live-Board prüfen (wirklich abgefahren?) |
| 1.5 | Alte Verbindung (Prisdorf) | Progress erkennen → Verbindung/Tour refresh |
| 1.6 | Karte ≠ echte Linienfahrt | Transit-Geometrie = Journey-Legs / Stationskette, nicht Fuß-OSRM |
| 1.7 | GPS in Bahn verrückt | Puck auf Nav-Linie; Pfeil = Fahrtrichtung |
| 1.8 | Ausstieg / noch-X / Ride-Start-Speech fehlen | `transitRideCadence` + `stationCountdown` verdrahten |

---

## Phase 2 — Fuß-Speech & HUD-Hints

| # | Problem | Fix |
|---|---------|-----|
| 2.1 | Abbiege-Speech zu früh | Final/Warn-Distanzen + GPS-Lag; „jetzt“ enger |
| 2.2 | Nur „jetzt links“, ohne Straßen-Tipp wenn komplex | Complex nur bei echt eng/viele Abzweige; dann Straßen-/Merkmal-Tipp („schau mal …“), **nie** „unübersichtlich“ |
| 2.3 | HUD „— unübersichtlich“ | Suffix streichen; Tip nur Speech bei komplex |
| 2.4 | Kein „schau nach links/rechts“ | Look-Direction-Phrasen raus |
| 2.5 | „hinter Bahnwartehäuschen“ falsch | Spatial vor/hinter vs. Ziel/Ansatz |
| 2.6 | Landmarke doppelt | Dedup letzte angesagte Landmarke |
| 2.7 | „Kurz falsch“ Fehlalarm | Wrong-way härter; am Halt/ÖPNV-Übergang dämpfen |
| 2.8 | „Sorry“ bei Unterbrechung | Apology-Pfad bei Barge-in killen |
| 2.9 | BF u.ä. | Speech-Expand Abkürzungen (BF→Bahnhof) |
| 2.10 | **Zweite Kreuzung stumm** — nur 1× „rechts“ | Jede Maneuver-Grenze: Warn + Final; kein Skip/Cooldown der nächsten Kreuzung frisst |

---

## Phase 3 — Karte / Chrome / Fog / Kamera

| # | Problem | Fix |
|---|---------|-----|
| 3.1 | Hard-Nav öffnet Timeline | `requestOpenPlanCalendar` bei hard/short nav unterdrücken; still spiegeln |
| 3.2 | Follow-Lock: Pan löst, Zoom behält | Gesture: zoom ≠ detach |
| 3.3 | Fog: dicker, **ohne Glow**, keine Mehrfach-Überlappung | Glow-Layer weg (`fog-trail-glow`); feste Breite; kein Alpha-Stack; optional ~60 m Tip-Kapsel (kein Full-Merge in Nav) — Screenshot: Spur mit Glow + Überlapp klar sichtbar |
| 3.4 | **Zentrieren** langsam / geht nicht | Recenter-Button → sofort `setCamera` + Follow; nicht hinter Map-Polish | `YorroHomeCamera`, recenter handler |
| 3.5 | **Karte nach Blickrichtung** geht nicht | Heading-up / bearing aus Device-Compass während Follow | Camera follow mode |
| 3.6 | Pan: **GPS-Punkt wandert mit** der Karte | Puck = echte GPS-Koordinate (Screen folgt Kamera, Marker bleibt geo-fix); kein Camera-Center als Fake-GPS | `NativeHomeMapView` puck source |
| 3.7 | Fog-Load → **GPS stockt**, App blockiert | Fog async/chunked; nie Sync auf GPS-Tick; bei Nav Trail-only | fogTrackEngine + performance lanes |
| 3.8 | **Fog nach Nav-Ende weg** (Screenshot Tages-Zusammenfassung) | Nav aus → Trail aus, aber Catchup `forceFogRecompute(walkTrack)` muss Fläche/Reveal wieder setzen; Track während ÖPNV nicht leeren; Maske/Reveal sichtbar; **keine roten Artefakt-Quadrate** | `ensureNavFogCatchupWatch`, `HOME_MAP_FOG_MASK_ENABLED`, revealFc |

---

## Phase 4 — Nebenbei

| # | Problem | Fix |
|---|---------|-----|
| 4.1 | Login-Erinnerung fehlte | Auth/Guest-Nudge-Pfad prüfen (wann feuern) |
| 4.2 | Adresse sprang zum nächsten Ort (bereits gefixt) | Retest Exact-Coords / kein Places-Snap bei Straße+Nr. |
| 4.3 | Gemini `finishReason=MAX_TOKENS` (Log) | Concierge/Nav-Prompt kürzen oder Token-Budget; Truncate → Speech-Lücke vermeiden |
| 4.4 | `[geofence] POI not found: -1` (Log Ende) | Geofence-ID nach Alight/Tour-Wechsel nicht stale lassen |
| 4.5 | Timeline durcheinander (Screenshot 21:04) | Stop-Reihenfolge (Ausstieg vor Ziel); keine zweite ÖPNV-Tour nach „Tour fertig“; Reminder ≠ Stale-Plan | Tour/Timeline commit |

---

## Screenshot-Evidenz (Nothing, 16.09.)

| Shot | Was zu sehen | Plan |
|------|----------------|------|
| Fuß Prisdorf · Trail cyan | Glow + Überlapp/Stapel; Route blau OK; RB71-Chip | 3.3, Bahn-Chip behalten |
| „an Historisches Bahnwartehäuschen“ | Landmark in HUD + Spatial-Risiko | 2.5 / 2.6 |
| ÖPNV · „Noch 8 Stationen“ | HUD-Stationen da; Linie folgt Straßen ≠ Transit | 1.8 teils ok · **1.6** |
| Timeline 21:04 | Tour fertig + noch ÖPNV; Stop 2 vor Stop 1; Beenden | **4.5** · 1.5 · 0.3 |
| Nach Nav · Tages-Zusammenfassung | **kein Fog/Trail**, rote Quadrate, 3 % erkundet | **3.8** |

Video Desktop `screen-20260916-204719.mp4` — bei Fix-Phase Frames ziehen (Shell hier gerade tot).

---

## Fortschritt (Code, 16.09. Abend)

### Erledigt
- **P0** Route sichtbar · Speech ohne Lücke · Fuß nach ÖPNV · Cue-ENOENT · Catalog/Places-Spam aus in Nav
- **P1** ÖPNV-Takt: Halt/Ein/Fahrt/Aus · HUD Fahrzeug-Min · Stationen live · Transit-Geometrie · Stale-Catchup · Puck-Snap · entgegen Fahrtrichtung · Missed nur bei echtem Abfahren
- **P2** Timing/jede Kreuzung · kein unübersichtlich/Sorry/schau-nach · Spatial an statt hinter · Landmark-Dedup · Wrong-way dämpfen · BF→Bahnhof
- **P3** Timeline zu bei Hard-Nav · Zoom≠detach · Fog dicker/ohne Glow/Catchup · Recenter 1-Tap · Heading-up · Puck geo-fix
- **P4** Login-Nudge · Geofence -1 Guard · Gemini Token/Truncate

### Hotfix 17.09 — 30s nach „Alles klar“
**Nicht Fog** (Full-Merge in Nav schon aus). Ursache: Call-2 Speech wartete auf `presentToUi` → zweites `await commitHandsFreeNavStart` (Geocode/FOSSGIS).  
Fix: Call-2 vor presentToUi · Target-Name/Loading setzen · Auto-Start skip wenn schon loading · Fog pausiert auch bei `navRouteLoading`.

### APK
Erst wenn du sagst „neue APK“.

---

## Log-Evidenz (`.cursor/_live_nav_test_124.log`, 20:28–21:12)

| Log-Signal | Passt zu |
|------------|----------|
| `voice submit` 20:28:47 → ~3 Min Stille bis nächstes sinnvolles Event | 0.2 Speech-Lücke |
| `voice submit (timeline)` 21:04:54 | 3.1 Timeline bei Hard-Nav |
| `cached nav cue play failed` ENOENT ×3 | **0.6 neu** |
| `Browse-Pack uetersen/appen` HTTP 400 × Dutzende | **0.7 neu** (Lag) |
| `places new-text Arena OR Stadion…` wiederholt in Nav | **0.8 neu** |
| `gemini finishReason=MAX_TOKENS` | **4.3 neu** |
| `geofence POI not found: -1` | **4.4 neu** |
| MapLibre `Canceled` / stream reset | Noise (Zoom/Pan), kein eigener Fix |

**Grenze der Logs:** Capture = gefiltertes ReactNativeJS. Viele User-Bugs (HUD-Text, „unübersichtlich“, Wrong-way-Wortlaut, fehlendes Aussteigen, Route unsichtbar) stehen **nicht** als Error-String — die kommen aus deinen Live-Meldungen + UI. Morgen-Test (08:18) war in dieser Datei nicht drin, ist aber im Plan (0.4/0.5/3.4–3.6/2.10).

---

## Reihenfolge (Abarbeitung)

```
P0 Route + Speech-Lücke + Fuß-nach-ÖPNV + UI/GPS nicht blocken
 → P1 ÖPNV-Blaupause (Halt→Ein→Fahrt→Aus→Fuß)
 → P2 Fuß-Cues (jede Kreuzung, Timing, Complex, Spatial, Sorry, BF)
 → P3 Timeline / Zoom-vs-Pan / Recenter / Heading-up / Puck-fix / Fog-Polish
 → P4 Login-Reminder + Adress-Retest
 → APK nur wenn du sagst + kurzer Retest Nothing
```

## Nicht anfassen

- TTS-Satz-Pipeline (Queue/Pump)
- Kernel umbauen
- Fog-Maske wieder an (dunkler Zoom-Kasten)
- APK bauen, bis du „neue APK“ sagst

## Abnahme (kurz)

1. Adresse → exakter Punkt, Linie sofort sichtbar, Speech ohne Lücke nach Bridge  
2. Fuß: **jede** Kreuzung angesagt; Cues rechtzeitig; kein „unübersichtlich“ / „schau nach links“  
3. Halt: erst dort Linie+Min+Gleis; Einsteigen erst wenn da  
4. Fahrt: HUD live Stationen+Min; Puck auf Linie; Ausstieg+Fuß weiter  
5. Fog: klare Spur in Nav (kein Glow/Stack) → **nach Nav-Ende Fläche/Reveal wieder da**, keine roten Quadrate  
6. Pan unlock / Zoom lock; Recenter schnell; Blickrichtung-Follow  
7. App bleibt tippbar (Fertig / Chrome) während Nav  
8. Timeline: Stop-Reihenfolge korrekt, kein Doppel-ÖPNV nach Tour-Ende  
