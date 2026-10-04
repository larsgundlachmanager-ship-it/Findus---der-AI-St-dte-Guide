# Reisebüro — Teil-Inventar & Lücken-Flow Masterplan

**Zielbild:** User kann (auch in einer langen Sprachnachricht ~10 Min) erzählen, was **schon gebucht / schon klar** ist und was **noch fehlt**. Yorro erkennt das Inventar, spricht **nur die Lücken** step-by-step durch, recherchiert/trägt ein und hängt den Plan in Magazin + Timeline.

**Besitz:** Yorros **Reisebüro** (Akt 1–5). Modul 2 erkennt nur und **übergibt** (`execution=reisebuero`) — kein zweites Reise-Gehirn.

**Nicht:** Orts-Hardcodes, Pflicht-Sätze, Kernel-/TTS-Umbau. Struktur-Blaupause, stadt-agnostisch.

---

## Zielbild (User-Sätze → Verhalten)

| User sagt (Wortlaut frei) | Yorro versteht | Tut |
|---------------------------|----------------|-----|
| Flug da, brauche noch Hotel | `bookedFlight=true`, Stay fehlt | Nur Stay (+ Transfer) suchen |
| Unterkunft da, muss noch hin / fliege dahin | `bookedStay=true`, Transport fehlt | Nur Anreise (Flug/Bahn/Bus) |
| Flug + Hotel, brauche Mietwagen | beide gebucht, `rentalCar=true` / need | Nur Mietwagen-Deeplink + Timeline-Stop |
| Bahn + Unterkunft fehlen, Ziel klar | Stay+Rail offen | Bahn + Stay parallel, kein Flug |
| Schon Ticket für Event/Konzert/Turnier | Aktivität gebucht | Event nicht neu pitchen; Rest drumherum |
| Langer Dump: Daten, Leute, was gebucht, was fehlt, Wünsche | Full Ledger + Inventory | Recap → nur Lücken fragen → Research scoped |

**Done wenn:** Lange Monologe füllen Flipchart; Magazin/Timeline zeigen nur fehlende Buchungs-Schritte; schon Gebuchtes erscheint als „schon da“ ohne Fake-Partner-Link.

---

## Ist-Stand (schon da)

| Baustein | Wo | Grenze |
|----------|-----|--------|
| `bookedStay` / `bookedFlight` / `bookedTransfer` | `types.ts`, `parseBriefSlots.ts` | Kein `bookedRail` / `bookedCar` / `bookedActivity` |
| „Hotel schon · Flug suchen“ Flipchart | `flipchartNotes.ts` | Nur Flug↔Hotel-Kreuz |
| Frage `bookedBits` | `questionCatalog.ts`, `completeness.ts` | Nur wenn Stay schon true & Mode leer |
| Funnel skip Stay/Flug wenn gebucht | `funnel.ts` `searchStayLive` / `searchFlightLive` | Kein scoped Magazin „nur Lücke“ |
| Handoff Flug+Hotel / Urlaub | `handoff.ts` + Call-1 `reisebuero` | „hab Flug, brauch Hotel“ oft zu dünn für Handoff |
| Compound-Tagesplan | Modul 2 `compoundPlanIngest` | **Stadt-Heute**, kein Urlaubs-Inventar |
| Mic im Magazin | `ReisebueroModal` | Feedback, kein Inventar-Walkthrough |

---

## Phase A — Inventar-Modell (SSOT Ledger)

Erweitern, ohne Dialog-Skripte:

| # | Slot / Feld | Bedeutung | Parse-Trigger (Struktur) |
|---|-------------|-----------|---------------------------|
| A.1 | `bookedFlight` | Flug schon da | schon da (härten: „Flieger hab ich“, „Tickets gebucht“) |
| A.2 | `bookedStay` | Unterkunft schon da | schon da |
| A.3 | `bookedTransfer` | Transfer schon da | schon da |
| A.4 | **`bookedRail`** (neu) | Bahn/ICE schon | „Bahn schon“, „Zugticket hab ich“ |
| A.5 | **`bookedBus`** (neu, optional) | Fernbus schon | „Flix schon“ |
| A.6 | **`bookedCar`** (neu) | Mietwagen schon **oder** explizit unnötig | trennen von `rentalCar` need |
| A.7 | **`needCar`** klar | brauche noch Mietwagen | „brauch noch Mietwagen“ |
| A.8 | **`bookedActivities[]`** (neu) | schon gebuchte Events/Tickets (Name, Ort, Tag) | „Konzert-Tickets hab ich“, „Turnier-Anmeldung steht“ |
| A.9 | **`inventoryMode`** | `full_discover` \| `gap_fill` \| `add_on` | aus booked*/need* ableiten |
| A.10 | Intent-Notes Flipchart | „Flug ✓ · Hotel suchen“ | `flipchartNotes` erweitern |

**SSOT:** `types.ts` · `parseBriefSlots.ts` · `slotLedger` · Flipchart · Smokes mit den User-Sätzen oben.

---

## Phase B — Langer Dump (≤ ~10 Min Sprachnachricht)

| # | Arbeit | Detail |
|---|--------|--------|
| B.1 | Endpoint / STT-Geduld | Reisebüro-Mic: lange Stille erlauben; kein Early-Cut mitten im Monolog (`reisebueroLiveChat` / Endpoint) |
| B.2 | Multi-Slot-Parse in **einem** Turn | Alle booked*/dates/adults/dest/wishes aus einem Text; nicht nur erste Frage |
| B.3 | LLM-Assist nur als **Struktur-Hint** | Optional: Inventar-JSON (booked/need/facts) → Ledger mergen; **kein** Wortlaut-Skript; Gate mit Heuristik |
| B.4 | Chunked Flipchart | Jede erkannte Tatsache = eigener Sticker (grün gebucht / gelb Lücke) |
| B.5 | Nach Dump: kurzer Recap | „Flug und Hotel habt ihr — fehlt noch Mietwagen und Transfer“ → Akt 2 light oder direkt Lücken-Fragen |
| B.6 | Modul-2 Handoff | Sätze wie „hab Flug, brauch Hotel in X“ → `execution=reisebuero` + pending Utterance mit vollem Text |

**Done wenn:** Ein 2–3 Min Test-Monolog füllt ≥80 % der genannten Slots; Lücken-Liste stimmt.

---

## Phase C — Lücken-Fragen (Akt 1 scoped)

| # | Arbeit | Detail |
|---|--------|--------|
| C.1 | `nextQuestionKey` respektiert Inventory | Wenn Flug gebucht → **keine** bags/Flug-Fragen außer User öffnet; wenn Stay gebucht → keine lodgingKind-Pflicht |
| C.2 | Fragenkatalog „Gap-only“ | Reihenfolge: fehlende Anreise → fehlende Stay → Transfer → Mietwagen → Aktivitäten → Soft-Wünsche |
| C.3 | `bookedBits` generalisieren | Nicht nur Hotel→Flug; Matrix Stay↔Flight↔Rail↔Car |
| C.4 | Keine Voll-Discovery wenn `gap_fill` | Brief „fertig“ sobald Lücken-Slots beantwortbar / Research startbar |
| C.5 | Add-on nach Magazin | Mic-Feedback „brauch noch Mietwagen“ → Ledger patch + Checklist/Research nachziehen ohne neuen Full-Funnel |

---

## Phase D — Research scoped (Akt 3)

| # | Arbeit | Funnel |
|---|--------|--------|
| D.1 | `searchFlightLive` / `searchStayLive` | schon: skip wenn booked — **härten + Tests** |
| D.2 | Rail/Bus nur wenn Mode/Need | Wenn Stay gebucht + Mode train → nur Bahn-Matrix |
| D.3 | Mietwagen-only Research | Partner-Deeplink + Preis wenn belegt; kein Fake-Stay |
| D.4 | Activity-only | Wenn Flug+Stay gebucht → nur Clubs/Momente/Tickets am Stay |
| D.5 | Theater-Copy | Checkliste: „Hotel schon da — suche Flug…“ statt Voll-Discovery-Teaser |
| D.6 | Keine CHECK24-Leerlinks | bleibt: Pauschal nur bei Intent (bereits gefixt) |

---

## Phase E — Magazin & Buchung step-by-step (Akt 4)

| # | Arbeit | Detail |
|---|--------|--------|
| E.1 | Journey-Beats „schon da“ | Beat ohne `bookUrl` oder Badge „schon gebucht“ — kein Partner öffnen |
| E.2 | Checklist = nur Lücken | `buildBookingChecklist` / `pickTransportsForBooking`: gebuchte Legs weglassen |
| E.3 | Speech-Pitch | „Flug habt ihr — ich hab euch das Hotel rausgesucht…“ (Struktur, Wortlaut frei) |
| E.4 | Tagesplan | Soft-Tage + Live-POIs; schon gebuchte Aktivität als Fixpunkt am Tag |
| E.5 | Magazin-Mic | Feedback → Gap-Patch (C.5), nicht nur Smalltalk |
| E.6 | Farben vom Hero | behalten (Ambient) |

---

## Phase F — Timeline & Commit (Akt 5)

| # | Arbeit | Detail |
|---|--------|--------|
| F.1 | `pushOptionToTimeline` | Gebuchte Legs als Info-Stops (ohne Book-URL) oder mit User-URL wenn genannt |
| F.2 | Reihenfolge | Zubringer → Flug/Bahn → Transfer → Stay → Aktivitäten → Rück |
| F.3 | Nachträglich Elemente | „noch Mietwagen“ nach Commit → Timeline-Stop + Checklist nachziehen |
| F.4 | Modul-2 Isolation | Während Reisebüro offen: kein Compound-Plan-Konflikt |

---

## Phase G — Modul-2 nur Handoff

| # | Arbeit | Detail |
|---|--------|--------|
| G.1 | Call-1 Situation | `reisebuero_gap_fill` / detect: booked+need Phrasen |
| G.2 | `isFindusReisebueroHandoff` | „hab Flug brauch Hotel“ + Stadt/Datum → true (auch ohne „Wochenende“) |
| G.3 | Bridge-Speech | Kurz: „mach ich im Reisebüro“ → Overlay + derselben Utterance ingest |
| G.4 | **Nicht** in M2: Flug+Hotel-Research, Magazin, Inventar-Ledger |

---

## Phase H — Qualität / Smokes / Live-QA

| # | Smoke / QA |
|---|------------|
| H.1 | Parse: alle Zielbild-Sätze → korrekte booked*/need* |
| H.2 | Completeness: gap_fill überspringt volle Lodging/Mode-Pflicht sinnvoll |
| H.3 | Funnel: booked Stay → 0 Stay-Live-Calls; Magazin ohne Stay-Book-Button |
| H.4 | Checklist: nur fehlende Schritte |
| H.5 | Handoff: M2-Utterance öffnet Reisebüro mit Inventar |
| H.6 | Device: 1 langer Tippfeld-Dump + 3 Gap-Sätze auf QA-Handy |

---

## Reihenfolge (bauen)

1. **A** Inventar-Slots + Parse + Flipchart  
2. **C** Lücken-Fragen / Completeness  
3. **D** Funnel scoped  
4. **E** Magazin/Checklist „schon da“  
5. **B** Langer Dump (Endpoint + Multi-Parse + optional LLM-Struktur)  
6. **G** Modul-2 Handoff  
7. **F** Timeline nachziehen  
8. **H** Smokes + Live-QA  

---

## Explizit out of scope

- Pauschal-SKU / Yorro als Veranstalter  
- Omio/CHECK24-Vergleichswände  
- Kernel / TTS-Pipeline Umbau  
- Compound-Plan in Modul 2 als Ersatz für Reisebüro  
- Ortsnamen in Prompts hardcoden  

---

## Datei-Besitz (kurz)

| Thema | Dateien |
|-------|---------|
| Slots / Parse | `types.ts`, `parseBriefSlots.ts`, `slotLedger.ts` |
| Fragen | `questionCatalog.ts`, `completeness.ts`, `briefingChat.ts` |
| Board | `flipchartNotes.ts`, `boardPins.ts` |
| Research | `funnel.ts`, `transportMatrix.ts`, `composePlan.ts` |
| Magazin | `storyMagazine.ts`, `TripStoryScroll.tsx`, `ReisebueroModal.tsx` |
| Handoff | `handoff.ts`, `runConciergeTurn.ts`, Call-1 Order |
| Timeline | `timelineHandoff.ts`, `timelineStopsFromOption.ts` |

---

## Fortschritt

- [x] A Inventar-Modell  
- [x] B Langer Dump  
- [x] C Gap-Fragen  
- [x] D Scoped Research  
- [x] E Magazin Lücken-only  
- [x] F Timeline  
- [x] G M2-Handoff  
- [x] H Smokes / QA  

*Stand: 17.09.2026 — verdrahtet inkl. Magazin-Mic Gap-Add-on (`looksLikeGapAddOn` → Live-Verify), `needCar`→Mietwagen-Deeplink, Handoff-Bridge mit Inventar-Recap. Live-QA am Gerät optional.*
