# Findus — Strukturbaum (v3)

> Stand: 29.07.2026 · React Native / Expo · `src/` + Android-Native  
> Quelle: WhatsApp-Vision + Masterbook V5 + implementierter Code  
> **Globale Gesetze:** Abstraktion · Zero Templates · No Dead-Ends · Graceful Offline

---

## 1. Globale System-Regeln

| Regel | Bedeutung |
|-------|-----------|
| **Strukturelles Denken** | POI-Metadaten ↔ User-State (Profil, Memory, Kontext) — kein Hardcoding einzelner Orte |
| **Zero Templates** | Keine vorgefertigten User-Antwort-Arrays; Gemini formuliert aus rohen Parametern |
| **No Dead-Ends** | Universal-Fallback + Recherche-Agents wenn Standard-Pipeline nicht reicht |
| **Graceful Offline** | Online-first; offline empathisch + lokaler Datensatz; ehrliche Lücken statt erfundener Fakten |
| **Währung** | Alle Preise → **Euro (€)** |
| **Test-Anker** | **Prisdorf** für Offline-Tests |
| **Gemini-Default** | `gemini-2.5-flash-lite` → Pro nur als Fallback bei dünnen Antworten |

---

## 2. Top-Level Architektur

```
┌─────────────────────────────────────────────────────────────────┐
│  App.tsx — Boot, Onboarding-Gate, DB, Sync, Monitore            │
└───────────────────────────────┬─────────────────────────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        │                       │                       │
        ▼                       ▼                       ▼
  HomeScreen              OnboardingNavigator       SettingsScreen
  (LiveStage + HUD)       (Express / Standard)      (Profil, Stimme)
        │
        └── useGeofencing ──► exploreModule (GPS-Tick)
        └── useVoiceInput ──► questionsModule + Intent-Router
        └── ConciergeCard / CompassNavOverlay / CityMapModal
```

### Runtime-Kern (3 Module + Querschnitt)

```
Findus Runtime
│
├── ORCHESTRATOR          Modul-State · Cooldowns · Interrupt vs Queue
│   └── src/runtime/orchestrator.ts · stateMachine.ts
│
├── AUDIO-PIPELINE        Satz-Streaming · Piper (primär) · Lookahead
│   └── src/runtime/audioPipeline.ts · speechModule.ts · ttsService.ts
│
├── MODUL 1 — Erkunden    GPS → Trigger → Relevanz → Narration (A/B/C)
│   └── src/runtime/exploreModule.ts · triggerEngine.ts · narrationPipeline.ts
│
├── MODUL 2 — Fragen      Voice/Text → Concierge → Actions → Spickzettel
│   └── src/runtime/questionsModule.ts · useVoiceInput.ts
│
├── MODUL 3 — Navigation  OSM-first · Multi-Stop · Bike/ÖPNV · Aufpasser
│   └── src/runtime/navigationModule.ts · navigationService.ts
│
├── MOBILITY / GROWTH     Presence-Ping · Stempelkarte · Community-Cache
│   └── mobilityModule.ts · growthModule.ts · locationTracker.ts
│
└── UI-MODUL              HUD · LiveStage · Feature-Tips · Dev-Board
    └── uiModule.ts · components/liveStage/
```

---

## 2.1 Modul-Priorität (wer darf wann reden?)

```
PRIORITÄT (hoch → niedrig)

1. MODUL 2 — Fragen & Rückfragen
   User tippt/s spricht → TTS SOFORT stoppen
   → danach 30 s GPS-Pause (Cooldown after_user_question)
   → Modul wird wieder freigegeben (nicht dauerhaft blockiert!)

2. MODUL 3 — Navigation
   Abbiegehinweis ≤50 m → Modul 1 pausiert (still)
   Nav-Cooldown 5 s nach Nav-Start
   Route hat Vorrang vor Ortsgeschichten

3. MODUL 1 — Erkunden (Default / Roadtrip)
   Läuft IMMER im Hintergrund wenn:
   · Findus redet nicht (oder Queue nach Satzende)
   · kein aktives Mikro / kein Generating
   · Cooldowns abgelaufen (30s Frage · 10s nach Ort · 5s nach Rede)
```

| Cooldown | Dauer | Wann |
|----------|-------|------|
| `after_user_question` | **30 s** | Nach jeder User-Frage |
| `after_poi_complete` | **10 s** | Nach erzähltem Hauptort |
| `after_speech` | **5 s** | Nach jeder Findus-Rede |
| `during_navigation` | **5 s** | Kurz nach Nav-Start |

Implementierung: `stateMachine.ts` · `orchestrator.ts`

**Bugfix v3.1:** Modul blieb nach Fragen auf `questions` → Erkunden tot. Jetzt: Cooldown statt Dauer-Block + `onUserInputEnd` setzt Modul zurück auf `explore`/`navigation`.

---

## 2.2 Modul 1 — Trigger-Tiefe (50 m / 20 m · Smart Arrow)

```
GPS-Tick → evaluateGpsTrigger → resolveExploreDepth
│
├─ SKIP
│    · Abbiege ≤50 m voraus (Smart-Arrow-Knoten via getNavExploreGateSnapshot)
│
├─ TEASER (Wegweiser-Hook + Interest-Watch) — NUR bei Bewegung
│    · Navigation aktiv + POI ≤50 m
│    · Anderer **Knotenpunkt** ≤20 m (Cluster) — nur area/approach/legacy, KEINE Sub-POIs
│    · Free-Roam + schnelle Bewegung (>~7 km/h)
│    · User stoppt / kehrt um → Deep-Dive (Vollerzählung)
│
└─ FULL (Approach + Story oder direkte Story)
     · Free-Roam + Stillstand (Dwell/Speed ~0) → Sofort volle Story, kein Teaser
     · Free-Roam, Route frei, kein Cluster ≤20 m
     · Navigation: kein Abbiege ≤50 m + kein POI-Cluster
```

Dateien: `exploreTriggerPolicy.ts` · `exploreModule.ts` · `runTeaserWithInterestWatch()` in `narrationPipeline.ts` · `navigationService.ts` (Smart Arrow Gate) · `locationTracker.ts` (`isUserStationaryForExplore`)

**20-m-Cluster:** Zählt nur **Anker-Knotenpunkte** (`area` · `approach` · `legacy`) — Sub-POIs werden ignoriert (Spam-Schutz).

**Stillstand:** Teaser ist exklusiv für User in Bewegung. Bei Dwell/Stillstand startet Flow B direkt.

---

## 2.3 Modul 2 — Two-Pass Concierge (Reasoning-Baum)

```
User-Frage (auch 2+ Min Spracheingabe)
  │
  ├─ PASS 1 — ANALYSE (runConciergePass1 · JSON)
  │     · statedFacts · subQuestions (priorisiert)
  │     · userGoal · topicMode · needsClarification
  │     · deferParts („erst Punkt X, dann Rest“)
  │     · researchTasks (web · event · flight · food · poi)
  │     · sanityChecks · anticipatedFollowUps · memoryToStore
  │     → merge in useOpenQuestionStore (offene Teilfragen + Fakten)
  │
  ├─ RESEARCH EXECUTE (executePass1Research)
  │     · dining → Evening Dining Orchestrator (Budget · Rating · Hotel · Sunset)
  │     · side-trip → Pre-Flight Side-Trip Feasibility (POI · Hin+Rück · Leave-by · Risiko)
  │     · flight → Flight-Day-Orchestrator (Flugplatz · ETA · Checkout · Reminder)
  │     · poi → Pack-Miss → Web-Research + Draft (Nightly → Supabase)
  │     · eventResearch · webResearch aus Pass-1-Plan
  │     · prepareConciergeContext (Essen · Hotel · Flug · Events …)
  │
  ├─ PASS 2 — ANTWORT (runConciergePass2)  ODER prebuilt Flight-Day Response
  │     · Pass-1-Block + Research + Self-Check-Prompt
  │     · speechText kompakt — KEINE Adressen unless explizit gefragt
  │     · quickActions = exakt gesprochene Orte/Links (max 4 bei Events)
  │     · JEDE Teilfrage beantworten oder ehrlich defer
  │     · Antizipierte Rückfragen eingewebt (Ziel: ~95 % keine Nachfrage)
  │
  ├─ ENRICH + REFLECT
  │     · enrichWithConciergeOffers (Route · PDF · Reservierung)
  │     · reflectAndSyncConciergeActions (Relevanz · Button-Sync · Extra-Mile)
  │
  └─ PERSIST
        · markAnswered(subQuestionId) wenn beantwortet
        · offene Teile für nächsten Turn in useOpenQuestionStore
```

### Flight-Day (Beispiel „Flug 14 Uhr, erinnere mich“)

```
runFlightDayOrchestrator
  → findAirportPoi (Pack/Geocode)
  → Hotel Memory + ETA Fußweg
  → Ankunftspuffer (Insel vs. Security)
  → Checkout/Frühstück live (Web) falls nicht in notes
  → leaveByMs + Session-Plan + Push 30 Min vorher
  → HUD Countdown „In X Min losgehen“
  → Actions: Erinnerung · Route Flugplatz · Gepäck · Zeitlücke
```

Dateien: `flightDayOrchestrator.ts` · `findAirportPoi.ts` · `conciergeTwoPass.ts` · `useOpenQuestionStore.ts`

### Pre-Flight Side-Trip („Schaffe ich den Leuchtturm noch?“)

```
runPreFlightSideTripFeasibility
  → resolveFlightDeadlineContext (Session · Memory · Chat · Verspätung FlightAware)
  → resolveSideTripCandidates (Pack) oder Places/Geocode
  → Mehrere Treffer? → Disambiguation („Welchen Leuchtturm?“) + SHOW_MORE-Chips
  → Zeit: Hin + Aufenthalt (~20 Min) + Rück vs. leaveByMs
  → Risiko grün/gelb/rot (Puffer ≥25 / ≥12 / darunter)
  → ehrliche Antwort + Route-Button + Alternative + „entspannt essen“
```

Dateien: `preFlightSideTripFeasibility.ts` · `conciergeTwoPass.ts` · `poiDiscoveryResearch.ts`

### Durst / Discovery

`detectDiscoveryIntent`: Durst/trinken → convenience/supermarket, Richtung aus GPS-Track, Top-2 Route-Buttons (voraus + Alternative).

### Evening Dining („Was schlägst du heute Abend vor?“)

```
runEveningDiningOrchestrator
  → Anker: Hotel (Memory) oder GPS
  → Wunschzeit (Default 19:00) · Sonnenuntergang (Open-Meteo)
  → Pack-POIs + Google Places (ohne openNow — Abend!)
  → Score: Bewertung · Hotel-Distanz · Budget · Aussicht/Terrasse · Rollstuhl
  → 2–4 Optionen · Favorit mit Begründung · ehrlich über Budget (+X €)
  → Event-Match (Party/Konzert am Venue)
  → Buttons: Route · Reservieren · Speisekarte · Weiter suchen
```

Dateien: `eveningDiningOrchestrator.ts` · `conciergeTwoPass.ts` · `poiFilterService.ts`

### Compound Multi-Intent (Tennis + Zahnbürste + Essen + Strand)

LLM-Router Timing-Kaskade → `activateCompoundSessionPlan` → Leave-by Reminder + optional Sofort-Nav + Multi-Stop-Tour.

### POI-Miss Research

`poiDiscoveryResearch.ts` → Draft lokal → Nightly Sync (~03:00) als `poi_draft` in community_nav_cache.

## 2.4 Proaktive Erinnerungen (15-Min-Tick)

```
tickProactiveReminderEngine (mobilityModule + Header)
  │
  ├─ collectHudTipCandidates → sort by score
  │
  ├─ VOICE (hohe Prio) — nur wenn nicht busy
  │     · Flug · Reservierung · Leave-by / session_deadline
  │
  ├─ PUSH (score ≥90) — dringend, User nicht im Chat
  │
  └─ HUD (Live-Chips oben links, bis 5 Zeilen)
        · Wetter · offene Tasks · Frühstück · Wasser · Sonnencreme
        · Niedrige Prio — keine Stimme
```

Dateien: `proactiveReminderEngine.ts` · `proactiveHudEngine.ts` · `Header.tsx` · `hudTicker.ts`

### Feedback-Fixes (Flug / Plan / Nav)

- Inselflieger: Richtung **Wangerooge→Harle** bei Abreise; kürzere Speech; Tarife auf Karte
- Tagesplan-Frage ≠ Hotel-Navigation (`departurePlanOverview.ts`)
- Verzehrgutschein speichern + im Abreiseplan erwähnen
- **Zeitpuffer-Policy** (`timeBufferPolicy.ts`): immer ≥5 Min; Insel-Flug ~15; **Großflughafen mind. 70 Min**, mit Gepäckabgabe **90 Min** — User nach mehr/weniger fragen
- Turn-Ansagen ~28 m vorher + Bearing-Fallback; „Ziel erreicht“ gesprochen; Arrival ~18 m
- Performance: Route-Cache online, OSRM 1.8s→Google, GPS ohne 4.5s-Wait, Pass-1-Skip bei Orchestratoren, kein doppeltes Web-Research

---

## 3. Codebase-Karte (`src/`)

```
src/
├── runtime/              ★ SSOT für Module 1–3 + Orchestrator
├── services/
│   ├── concierge/        ★ Two-Pass, Kontext, Event-Recherche, Button-Sync, Open Questions
│   ├── navigation/       Route, Geocode, Landmarks, GPS-Buffer, Stempel
│   ├── geminiService.ts  LLM + Concierge-JSON
│   ├── ttsService.ts     Cartesia sonic-3.5 + expo-speech Fallback
│   ├── g2p/              Aussprache / Phonetik (espeak)
│   ├── affiliate/        Stay22 · GYG · Musement · Viator · Uber · Bounce
│   ├── flights/          Inselflieger-API · Flug-Advisor
│   ├── transit/          ÖPNV · GTFS · Ferry · Catch-my-Bus
│   ├── reservation/      Tisch · API · E-Mail · AI-Call
│   ├── planning/         Session-Plan · Intent-Router · Deadlines · Side-Trip Feasibility
│   ├── research/webAgent/ Headless Web-Recherche
│   ├── sync/             POI-Sync · Dictionary · Nightly Cache
│   ├── ai/               Story · Session-Memory · Prompt-Builder
│   ├── persona/          Empathy · Low-Chatter · PersonaEngine
│   ├── memory/           Welcome-Back · Side-Channel · Preference-Capture
│   ├── battery/          Survival Mode · Step-Stats
│   └── …                 weather · shopping · feedback · alarms
├── components/           LiveStage · ConciergeCard · Compass · Karte
├── hooks/                useVoiceInput · useGeofencing · useAssistantTts
├── store/                useFinnusStore (Zentral) + Memory · Plan · GPS
├── db/                   SQLite POIs · Facts · Feedback · Phonetics
├── interests/            Relevanz-Taxonomie · Skip-Pattern-Lernen
├── onboarding/           Express / Standard · Mic-Consent · Persona
├── screens/              HomeScreen · SettingsScreen
└── constants/            Prompts · Voices · Legal · Theme
```

**Android-Native:** `FindusDeviceAudioModule.kt` — Geräte-Audio-Route / Low-Latency

---

## 4. Orchestrator — Interrupt-Policy

```
Event eingehend
  │
  ├─ USER_VOICE / USER_TEXT (Modul 2)?
  │     → TTS SOFORT abbrechen (interruptAudioPipeline)
  │     → MODUL = questions
  │     → Cooldown: after_user_question (30 s)
  │
  ├─ GPS_ORTSTRIGGER (Modul 1)?
  │     → Findus redet? → QUEUE (~5 s Pause danach)
  │     → Cooldown aktiv? → SKIP
  │     → sonst → exploreModule → triggerEngine
  │
  └─ NAV_HINT (Modul 3)?
        → Story läuft? → warten bis Satzende
        → nie User-Frage unterbrechen
```

| Cooldown | Pause |
|----------|-------|
| Nach User-Frage | 30 s |
| Während Navigation | 5 s |
| Nach Ort fertig | 10 s |
| Nach Findus-Rede (GPS) | ~5 s |

Implementierung: `stateMachine.ts` · `gpsPolicy.ts` · `adaptiveGpsService.ts`

---

## 5. Audio-Pipeline

```
Gemini Text-Stream / Concierge speechText
  → audioPipeline.feed(tokenChunk)
  → punctuationChunker (Satzende . ! ? :)
  → Chunk N → Piper synthesize + play SOFORT
  → Chunk N+1 parallel (Lookahead / streamingAudioQueueService)
  → Orchestrator: stop | queue | interrupt
```

| Event | Verhalten |
|-------|-----------|
| GPS-Ortstrigger während TTS | **Queue** |
| User-Voice (Modul 2) | **Interrupt** |
| Nav-Abbiege nach Story-Satz | Pause → Hinweis → Resume |
| Web-Link-Tap (PDF/Ticket) | Audio läuft weiter |

**TTS-Stack:** Cartesia sonic-3.5 (Cloud) · expo-speech Offline-Fallback · G2P/Phonetik (espeak) · Dictionary-Sync

---

## 6. Modul 1 — Freies Erkunden

```
useGeofencing → exploreModule.handleLocationUpdate
  │
  ├─ adaptiveGpsService (Fuß 1–5 s · Bike bis 30 s · Deep-Sleep max 2 min)
  ├─ locationTracker (Dwell · Stempelkarte 20 min)
  ├─ tickShoppingReminders · tickInterestWatch
  │
  └─ evaluateGpsTrigger (triggerEngine)
        │
        ├─ LOCK / besucht / Teaser-Lock? → SKIP
        ├─ relevanceEngine + interests/relevanceBridge
        ├─ Gehrichtung weg vom POI? → SKIP
        ├─ Speed zu hoch? → SKIP
        │
        └─ Art?
              ├─ WEGWEISER  → Flow A (Teaser, visuelle Orientierung)
              ├─ HAUPTORT   → Flow B (Story, LOCK, Bullets + Actions)
              └─ NEBENORT   → Flow C (Kurz-Hook)
```

### Flow A — Wegweiser
Visuelle Orientierung zuerst → Landmark-DB / Street View → Hook (Pflicht-Auflösung später)

### Flow B — Hauptort
Intro (falls kein Wegweiser) → Historie → Heute → CTA → ggf. Nebenort · UI max 1–3 Bullets

### Flow C — Nebenort
Kurzer Pitch · Persona-gewichtet

**Masterbook:** Visuals before naming · Dedup LOCK · Adjustable depth

Dateien: `narrationPipeline.ts` · `approachVisualCue.ts` · `poi/poiTeaserLocks.ts`

---

## 7. Modul 2 — Fragen & Concierge

```
User-Frage (useVoiceInput / QuestionModal)
  → onUserInputStart → INTERRUPT TTS
  → llmIntentRouter (Flug · ÖPNV · Memory · Concierge · Nav …)
  │
  └─ Concierge-Pfad (questionsModule)
        │
        ├─ prepareConciergeContext(text)
        │     ├─ detectConciergeKind (food · hotel · flight · general · …)
        │     ├─ canonicalDestination (SSOT: „zum Restaurant Kreta“)
        │     ├─ eventResearchService (heute Abend / PDF / Flyer)
        │     ├─ buildFoodCandidates · buildTodayCandidates
        │     ├─ hotelAvailabilityService (Stay22 live)
        │     ├─ communityTips · weatherBlock
        │     └─ promptBlock → Gemini
        │
        ├─ askGeminiConciergeResponse (JSON: speech + bullets + quickActions)
        │
        ├─ enrichWithConciergeOffers
        │     ├─ Event-Turn: Route + PDF + Tickets (bis 4 Buttons)
        │     ├─ Named Hotel: Live-Verfügbarkeit + Buchungsbutton
        │     ├─ Reservierung: Speisekarte · Tisch · Tel
        │     └─ Affiliate: GYG · Musement · Uber · Bounce (nur wenn Intent)
        │
        ├─ reflectAndSyncConciergeActions  ★ Self-Reflection
        │     ├─ Relevance: echte Events vs. generische Orte?
        │     ├─ Button-Sync: Chips = gesprochene Venues/Links
        │     └─ Extra-Mile: PDF/Flyer-Button wenn recherchiert
        │
        └─ presentConciergeResponse
              ├─ autoStartNavigationIfCommitted (Kompass zuerst)
              ├─ speakRuntimeText (parallel)
              └─ ConciergeCard / LiveStage Actions
```

### Concierge-Subdomains

| Bereich | Service | Verhalten |
|---------|---------|-----------|
| **Event-Recherche** | `eventResearchService.ts` | Gemini + Google Search · PDF/Flyer · keine Kulturverwaltung-Platzhalter |
| **Kanonsisches Ziel** | `canonicalDestination.ts` | Ein benannter Ort = SSOT für Sprache + Route + Reservierung |
| **Button-Sync** | `actionButtonSync.ts` | 3–4 Actions · Speech↔Chip-Invariante |
| **Hotel** | `hotelBookingPack.ts` · `hotelAvailabilityService.ts` | Stay22 Direct API · nur buchen wenn `price.total` live |
| **Flug** | `inselfliegerAdvisor.ts` · `flightAdvisor.ts` | Live-Slots · Tarif · Deep-Link Frisonaut |
| **Reservierung** | `reservationIntel.ts` | Öffnungszeiten · API/E-Mail/Call · Fake-Actions verboten |
| **Quick-Actions** | `prioritizeActions.ts` · `quickActionPolicy.ts` | Nav > Intent-Partner · Event-Cap = 4 |

---

## 8. Modul 3 — Navigation

```
Ziel-Anfrage
  → resolveCanonicalDestination / resolveNavTarget
  → geocodePlaceNameOsmFirst → Google Fallback
  → Route + Landmarken (offlineNavCache · landmarkCache · streetViewCache)
  → CompassNavOverlay · navTurnHint · wrongWayMonitor
  │
  ├─ Multi-Stop (DraggableStopList · navWaypointsRegistry)
  ├─ Bike: frühere Trigger · kürzere Ansagen · Fahrradwege
  ├─ ÖPNV: transit/journeyPlanner · GTFS-Realtime · stationCountdown
  ├─ closingTimeGate · boardingDetector · catchMyBusReminder
  └─ Presence-Ping (~5 min Stille) · proactiveReasoning (Aufpasser)
```

**GPS-Track für Prompts:** `gpsTrackBuffer.ts` → letzte 3 Fixes in Concierge-Kontext

Dateien: `navigationService.ts` · `googleMapsNav.ts` · `contextualDiscovery.ts`

---

## 9. UI-Schicht

```
HomeScreen
├── Header (HUD: Akku · Wetter · Level · Long-Press Tell-More)
├── LiveStage
│   ├── PresenceCluster    Avatar / Mood
│   ├── BulletsSlot        Stichpunkte
│   ├── ActionsSlot        Quick Actions
│   └── SubtitlesSlot      1 Zeile, 1:1 zur Stimme
├── ConciergeCard          Spickzettel (Route · PDF · Tickets · Ja-Button)
├── CompassNavOverlay      Kompass-Navigation
├── CityMapModal / StampCityMap   Fog-of-War · Stempelkarte
├── StopQueueSheet         Multi-Stop
└── RuntimeDevBoard        (Dev)
```

**Tap-Modal-Konzept:** Tab Karte (Fog-of-War) · Tab Nav-Board (Drag&Drop)

Masterbook UI: Audio-first · Web-Links unterbrechen TTS nicht · Partner-Hinweis „Anzeige“

---

## 10. Daten · Memory · Sync

```
SQLite (database.ts)
  ├── POIs + Facts + Tags
  ├── community_nav_cache · landmarks · street_view
  ├── userSettings · feedbackEntries
  └── cityPronunciations · userCustomPhonetics

Stores (Zustand)
  ├── useFinnusStore      Chat · Nav · ConciergeCard · pendingNavOffer
  ├── useUserMemoryStore  Langzeit (Hotels, Restaurants, Dwell)
  ├── useSessionPlanStore Tagesplan · Deadlines · Tasks
  └── useShoppingTaskStore Einkaufs-Erinnerungen

Sync
  ├── syncService.ts           POI-Background-Sync
  ├── nightlyCacheSync.ts      ~03:00 Community-Pull/Push
  └── dictionarySyncService.ts   TTS-Aussprache
```

**Memory-Protokoll:** Welcome-Back am neuen Tag · Location Isolation (Hotel pro Stadt) · Side-Channel-Capture

---

## 11. Intent-Routing (Querschnitt)

```
useVoiceInput
  ├─ Stop Navigation / Ja-Nav / Pending-Offer
  ├─ Memory-Intent (intentService)
  ├─ Transit / Ferry (transitAdvisor · ferryAdvisor)
  ├─ Flight (flightAdvisor → Inselflieger)
  ├─ Shopping-Reminder-Ack
  └─ questionsModule (Concierge-Follow-up)
       └─ llmIntentRouter (compound plans · multiIntentFanout)
```

---

## 12. Affiliate & Booking

```
affiliateService.ts
  ├── BOOK_STAY22        hotelAvailabilityService (live check)
  ├── OPEN_GYG_WIDGET    GetYourGuide
  ├── OPEN_URL           Musement · Viator · Speisekarte · PDF
  ├── BOOK_UBER
  ├── BOOK_CAR_RENTAL    Economy Bookings
  └── BOOK_BOUNCE_LUGGAGE

Regeln: Keine Fake-Slugs · Disclosure · pendingAffiliateOffer für „Ja, buchen“
```

---

## 13. Masterbook V5 (Cursor Rules)

| Rule | Thema |
|------|-------|
| `findus-masterbook-v5-poi.mdc` | Wegweiser · Main-POI · Visuals-first · Dedup |
| `findus-masterbook-v5-event-research.mdc` | Tagesevents · PDF · Button-Sync |
| `findus-masterbook-v5-canonical-destination.mdc` | Benanntes Ziel = SSOT |
| `findus-masterbook-v5-navigation.mdc` | OSM-first · Bike · ÖPNV |
| `findus-masterbook-v5-booking-flow.mdc` | Hotel · Flug · Reservierung ehrlich |
| `findus-masterbook-v5-memory.mdc` | Welcome-Back · Location Isolation |
| `findus-masterbook-v5-persona.mdc` | Tone · Low-Chatter · Empathy |
| `findus-masterbook-v5-fallbacks.mdc` | Survival Mode · GPS-Troubleshooting |
| `findus-masterbook-v5-cache-weather.mdc` | Wetter · Cache |
| `findus-masterbook-v5-ui.mdc` | HUD · Spickzettel · Progressive Disclosure |
| `self-correction.mdc` | Agent prüft Terminal/Build vor „fertig“ |

---

## 14. Reboot-Phasen (Stand v3)

| Phase | Inhalt | Status |
|-------|--------|--------|
| 0 | Spec · State Machine · AudioPipeline · Relevance-Types | ✅ |
| 1 | Orchestrator (Modul · Cooldowns · Interrupt/Queue) | ✅ |
| 2 | Interest-Expansion · Skip-Pattern-Lernen | ✅ |
| 3 | Modul 1 TriggerEngine | ✅ |
| 4 | Modul 1 Narration (Flows A/B/C) | ✅ |
| 5 | Modul 2 Voice/Questions · Reservation-Intel | ✅ |
| 6 | Modul 3 Nav Core (OSM · Multi-Stop · Landmarks) | ✅ |
| 7 | Bike/ÖPNV/Push/Aufpasser · adaptive GPS | ✅ |
| 8 | UI Karte · HUD · LiveStage · Dev-Board | ✅ |
| 9 | Feature-Tips · Selbsterklärung | ✅ |
| 10 | KI-Wachstum (03:00 Sync · Community-Cache) | ✅ |
| 11 | Cutover poiTrigger → exploreModule | ✅ |
| **12** | **Concierge V2: Canonical Dest · Hotel live · Inselflieger** | ✅ |
| **13** | **Event-Recherche · PDF · Action-Button-Sync (4 Chips)** | ✅ |
| 14 | Piper-Produktmodus · Device-Audio-Native | 🔄 |
| 15 | Einrichtung Express/Standard · Stimmen · Städte-Skalierung | 🔜 |

---

## 15. KI-Wachstum (Community-Cache)

```
Lokale Nutzung (Nav / Wegweiser / Flow A)
  → Landmark- + Geocode- + Street-View-Cache (SQLite)
  → Push bei neuem Fetch (debounced) + Nachtfenster ~03:00–05:00
  → Pull beim Online-Kommen + periodisch (GPS online)

growthModule.ts · nightlyCacheSync.ts · offlineNavCache.ts
```

---

## 16. Einrichtung

```
OnboardingNavigator
  ├── PathChoiceStep        Express vs Standard
  ├── ExpressSetupStep      Schnellstart
  ├── ConciergePrefsStep    Ernährung · Interessen · Tone
  ├── MicConsentStep        DSGVO / Mikro
  └── AgeLifeSlider         Persona-Hint

Express = weniger Optionen · Standard = volle Persona/Interessen-Tiefe
```

---

## 17. End-to-End: „Was geht heute Abend?“

```
User: „Was geht heute Abend?“
  → useVoiceInput → questionsModule
  → prepareConciergeContext
       → researchTodaysEvents (Gemini + Google Search + PDF/Flyer)
       → promptBlock mit konkreten Events (Venue · Uhrzeit · Link)
  → askGeminiConciergeResponse
  → enrichWithConciergeOffers (Route · PDF · Tickets aus Research)
  → reflectAndSyncConciergeActions (Generic-Check · Chip-Sync · PDF-Extra)
  → presentConciergeResponse
       → TTS: „Heute in Wangerooge: Dicke Strandbar ab 20:00 …“
       → ConciergeCard: [Route Strandbar] [Route Turnier] [PDF Programm] [Tickets]
```

**Verboten:** Kulturverwaltung ohne Programm · Buttons für nicht genannte Orte

---

*Letzte Aktualisierung: Strukturbaum v3 — spiegelt Concierge/Event-Engine, Piper-TTS, Stay22/Inselflieger und Masterbook V5.*
