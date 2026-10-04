# Reisebüro — Rebuild Masterplan (Perfect Trip)

**Auftrag:** Umbau auf Founder-Vision (Brief tief · Zeitflex-Wertigkeit · Theater Research · Magazin 2–4 + Tages-Timetable + Karte · Timeline mit Links).

**Nicht:** Kernel/TTS · Orts-Hardcodes · Pflicht-Sätze · Omio-Vergleichswände.

**Doks:**  
`REISEBUERO_PERFECT_TRIP_VISION.md` · `REISEBUERO_FRAGENKATALOG.md` · `REISEBUERO_TOURIST_SUBPATHS.md` · `REISEBUERO_PARTNER_FIELDS.md` · Gap-Inventar

---

## Was „Theater“ ist (nicht Timeline)

- **Akt-3-Theater** = Live-Wartebildschirm / Checkliste der Research-Stages (Region → Flüge → Stays → Vergleich…).  
- **Tages-Timetable** = Akt-4-Magazin: Fr Anreise, Sa Programm, So Rück — mit Datum, Wochentag, Uhrzeit, Links.  
- **Yorro-Timeline** = Akt 5: derselbe Plan als App-Stops.

---



## Phase 0 — Vertrag ✅


| #                             | Status                                |
| ----------------------------- | ------------------------------------- |
| 0.1 Vision + Katalog Soll     | ✅                                     |
| 0.2 acts.ts Doctrine          | ✅ (nachziehen bei Optionen/Timetable) |
| 0.3 Partner-Feld-Matrix       | ✅ `REISEBUERO_PARTNER_FIELDS.md`      |
| 0.4 Touristen-Unterpfade ~30  | ✅ `REISEBUERO_TOURIST_SUBPATHS.md`    |
| 0.5 Theater vs Timetable klar | ✅ Vision                              |


---



## Phase 1 — Fragenkatalog + Unterpfade


| #    | Arbeit                                               | Prio |
| ---- | ---------------------------------------------------- | ---- |
| 1.1  | `lodgingRank` Erst/Notfall                           | P0   |
| 1.2  | `surfacePref` FlixTrain≠Bus                          | P0   |
| 1.3  | `bahncard` nur bei Bahn                              | P0   |
| 1.4  | Alter einzeln                                        | P0   |
| 1.5  | Party Musik/Rhythmus/Drinks                          | P1   |
| 1.6  | Spa Intent/Include/Beach                             | P1   |
| 1.7  | Cruise Tiefe (Seetage, Allergie, Erst…)              | P1   |
| 1.8  | Familie Kids-Club vs. zusammen                       | P1   |
| 1.9  | maxRailH / Layover getrennt                          | P0   |
| 1.10 | `whenFlex` **Prefer vs Soft** (Do ab 13 / Di>Mi)     | P0   |
| 1.11 | cityExplore + Museen/Kirchen                         | P1   |
| 1.12 | accessNeeds 70+/Rollstuhl                            | P1   |
| 1.13 | Event/Turnier Role                                   | P2   |
| 1.14 | Shelf abhaken                                        | ✅ Prefs+Apply+Chips |
| 1.15 | **Unterpfade** aus Personas verdrahten (Branch-when) | ✅ `touristPersonas.ts` |
| 1.16 | `hopStops` Multi-City Reihenfolge                    | P1   |
| 1.17 | Partner-Audit: je Site Prefill-Smoke                 | P1   |


---



## Phase 2 — Verstehen + Ranking + Flipchart


| #   | Arbeit                                                     |
| --- | ---------------------------------------------------------- |
| 2.1 | Härte-Parse („geilste“, „muss“, „Notfall“, „wenn möglich“) |
| 2.2 | Slot-Overwrite (Budget 400→500)                            |
| 2.3 | Flipchart Prod = nur LLM                                   |
| 2.4 | Research-Brief JSON aus Ledger                             |
| 2.5 | whenFlex-Parse: prefer outbound/return + earliest clock    |


---



## Phase 3 — Akt 2 Recap


| #   | Arbeit                                                 |
| --- | ------------------------------------------------------ |
| 3.1 | Recap: Härten + Prefer-Fenster + Erst/Zweit + Inventar |
| 3.2 | Trade-offs nur andeuten („Do ab 13 geht auch“)         |


---



## Phase 4 — Akt 3 Research-Theater (offen→eng)

Stages (Theater-Checkliste):

`brief_plan` → `open_space` → `access_filter` → `shortlist` → `stay_tracks` → `flight_matrix` (**Prefer-Score**) → `score_compare` → `feeder` → `package_pick` (**2–4**)


| #   | Arbeit                                                                                  |
| --- | --------------------------------------------------------------------------------------- |
| 4.1 | Stages + Theater-UI Copy                                                                | ✅ `theaterStages.ts` + STAGE_META |
| 4.2 | Multi-Track Stay                                                                        |
| 4.3 | Optional drop wenn teuer                                                                |
| 4.4 | Aktivitäts-Match Score                                                                  |
| 4.5 | Gap-Fill scoped                                                                         |
| 4.6 | **Zeitfenster-Score:** Prefer-Tag > Soft; Uhrzeit-Trade-off (früher Rück vs. mehr Zeit) |
| 4.7 | **Optionen-Policy:** offen → 4; spez. → mind. 2 (Hotels oder Flugfenster)               |
| 4.8 | Multi-City Hop: Stay+Zug pro Stop                                                       |
| 4.9 | Partner-Prefill aus Matrix                                                              |


---



## Phase 5 — Akt 4 Magazin + Tages-Timetable + Karte


| #   | Arbeit                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------ |
| 5.1 | 2–4 Optionen UI (Stadt / Lodging / Flugfenster)                                                        | ✅ Kind-Badge + Stay-Spur Expand |
| 5.2 | Pro Option volles Magazin                                                                              | ✅ TripStoryScroll |
| 5.3 | Interaktive Karte + Tag-Nummern                                                                        | ✅ Map-Canvas |
| 5.4 | **Tages-Timetable:** jeder Tag = Datum + Wochentag + Blocks + Uhrzeit + Links (Flug/Stay/Ticket/Event) | ✅ Head + CTAs |
| 5.5 | Mic-Refine                                                                                             | ✅ magazineRefine (kein Katalog) |
| 5.6 | Buy-in nur Wohnen+Fahrt                                                                                | ✅ Extras raus aus Buy-in |
| 5.7 | Multi-City Timetable (Mailand→Verona→Venedig)                                                          | ✅ hop annotate + Timeline |
| 5.8 | „Zweites Magazin“ / zweite Option bei Unsicherheit Flugfenster                                         | ✅ Prefer+Soft Karten |


---



## Phase 6 — Akt 5 Timeline


| #   | Arbeit                                               |
| --- | ---------------------------------------------------- |
| 6.1 | Timetable → Timeline-Stops 1:1 inkl. Wochentag/Datum | ✅ Multi-Day Buckets |
| 6.2 | Alle Book-Links mitgeben                             | ✅ Blocks + Checklist + Wishes |
| 6.3 | Schon gebucht ohne Fake-URL                          | ✅ mapsUrl null + usableBookUrl |


---



## Phase 7 — Qualität / Tests


| #   | Arbeit                                                              | Status |
| --- | ------------------------------------------------------------------- | ------ |
| 7.1 | Katalog + whenFlex Parse-Smokes                                     | ✅ `phase1Plus` / `phase7Qa` |
| 7.2 | Prefer-Score Smoke (Di vs Mi gleicher Preis)                        | ✅ Cap 24, Di>Mi in `phase7Qa` |
| 7.3 | Optionen-Policy Smoke (offen=4, spez≥2)                             | ✅ |
| 7.4 | Funnel-Stage Smoke                                                  | ✅ `theaterStages` |
| 7.5 | Magazin Timetable + Karte Datenform                                 | ✅ `magazinePhase5` + Timeline |
| 7.6 | Device-QA: Dump + warm/günstig 4 Optionen + Prag-WE 2 Hotels        | 🟡 Offline-Policy ✅ (`phase76OptionPolicy.offline`: warm→4, Prag→2 inkl. Seed-Dest-Parse). Device noch offen — kein USB-Gerät (`scripts/deviceQa/_phase76_*.py`) |
| 7.7 | Bestehende FAIL-Smokes (reisebuero / bookCta / presence) nachziehen | ✅ cruise Buy-in + Ready anti-loop |


---



## Noch fehlend zur Perfect Version (Gap-Liste)


| Thema                             | Fehlt heute                   |
| --------------------------------- | ----------------------------- |
| Prefer Do 13:00 / Di>Mi           | ✅ whenFlex + Score             |
| Mind. 2 / offen 4 Optionen        | ✅ Policy + Magazin-Finalize + Cover-Hint |
| Flugfenster als 2. Magazin-Option | ✅ Prefer+Soft als zwei Karten + Badge |
| Theater vs Timetable              | ✅ Rail brief_plan→…→package_pick + Normalize |
| Tagesplan Datum+Wochentag+Links   | ✅ weekdayLabel + bookUrl       |
| Multi-City Hop Timetable          | ✅ hopStops + Zug-Legs + Timeline 1:1 |
| FlixTrain≠Bus                     | ✅ surfacePref + Bus-Skip       |
| Ranking Erst/Notfall              | ✅ lodgingRank + Recap Erstspur |
| Party/Spa/Cruise Tiefe            | ✅ Catalog                      |
| Unterpfade 30 Personas            | ✅ `touristPersonas.ts` + Catalog-Branches + Smoke |
| Partner-Feld-Audit                | ✅ Keys-Smoke                   |
| Karte mit Tag-Nummern             | ✅ Magazin-Map Canvas + Layout |
| Shelf abhaken                     | ✅ Prefs-Werte + Apply + ✓ Flipchart-Chips |
| Zugang 70+/Rollstuhl              | ✅ accessNeeds Slot             |


---



## Bau-Reihenfolge

1. Phase 1–2 (Katalog + whenFlex + Ranking)
2. Phase 3 Recap
3. Phase 4 Funnel + Prefer-Score + Optionen-Policy
4. Phase 5 Magazin Timetable + Karte + 2–4 Optionen
5. Phase 6–7 Timeline + QA

---



## Fortschritt

- [x] Phase 0 Doks
- [x] Phase 1 Katalog-Code
- [x] Phase 2 Parse Prefer/Soft + Ranking + surface + hops
- [x] Phase 3 Recap Prefer-Fenster + Ranking + Inventar + Hops
- [x] Phase 4 Prefer-Score + Optionen-Policy + Flugfenster-Varianten + **Theater-Rail** (offen→eng, Legacy-Normalize, Funnel-Map)
- [x] Phase 5 Magazin: 2–4 Optionen (Stadt/Stay/Fenster) · Timetable · Karte · Buy-in Wohnen+Fahrt · Mic-Refine
- [x] Phase 6 Timeline Multi-Day 1:1 · Book-Links · schon gebucht ohne Fake-URL
- [x] Phase 7 Smokes (`phase7Qa` · Prefer Di>Mi · Policy · Theater · Magazin/Timeline · bookCta/presence/reisebuero/tripPackage) — Device-QA 7.6 wenn QA-Handy da

*Stand: 18.09.2026 — Phase 7 QA grün (ohne Device).*