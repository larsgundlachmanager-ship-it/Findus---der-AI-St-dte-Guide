# 3-Wochen Live-QA — Zwischen-/Abschlussbericht

**Datum:** 2026-08-29 · **Gerät:** `00143157P001105` · **APK live:** **2.0.26 / 53**  
**Methode:** Tippfeld-Ask (`_three_week_marathon.py`) + Ask-Server (`:8791`) + UI-Captures  
**Code-Fixes (lokal, brauchen Release-Rebuild + `gold:publish`):** Wetter-Titel, Call-1 Hotel-Geländer, Owner-Gold

Captures: `.cursor/live10/` · `.cursor/live12/` · Runner: `scripts/deviceQa/_qa40_live.py` (40+ Katalog)

---

## Kurzfazit

Call 1 → Fact-Lane → Call 2 läuft in den Kernpfaden **grundsätzlich richtig** (Steak Top-2, Nav ETA, Wangerooge Fähre+Flug, Lissabon-Funnel, Flug nach Uhr fragen).  
Schwachstellen: **Tippfeld/Ask-Harness flaky** (leere Captures), **Wetter-Titel „Sechzehn“**, **lokales Hotel → Reisebüro**, **Outfit dünn**, **Rooftop dünn**, **Vegan/Angus/Compound oft leer im Capture**.

Ohne neuen Release-Build greifen die heutigen Code-Fixes auf dem Handy noch nicht.

---

## Call-1 / Call-2 Beobachtungen (qualitativ)

| Frage | Call 1 (vermutet) | Code / Lane | Call 2 / UI | Verdict |
|-------|-------------------|-------------|-------------|---------|
| Steak Nähe | pitch + criteria Steak | Pitch | Top-2 Rindock’s + Rio Grande, Buttons | ✅ PASS |
| Flug Wien + Taxi (ohne Uhr) | flight_advisor, Lücke Uhr | Flight | „Wann fliegst du?“ · HAM→VIE | ✅ korrekt (Uhr fehlt) |
| Hotel Pool/Sauna lokal | **reisebuero** (zu aggressiv) | Reisebüro | „Von wo…?“ Board | ⚠️ sollte lokal pitchen |
| Wangerooge | island compare | Island | Fähre + Flug ab 55€, Inselflieger | ✅ PASS |
| Nav Bahnhof Prisdorf | nav_execute | Nav | 357 m · 5 Min · Ankunft | ✅ PASS |
| Tour 1h | tour_module | Tour/Timeline | Multi-Stop Tour gestartet | ✅ PASS |
| Lissabon Wochenende | reisebuero | Funnel | Freitag-Uhr + HAM→LIS + Hotel | ✅ PASS |
| London Wochenende | reisebuero | Funnel | Board / Origin-Ask | ✅/⚠️ OK für Trip |
| Outfit Abend | chat/weather | Chat | nur „leichtere Kleidung“, Touren-Btn | ⚠️ dünn |
| Rooftop+Outfit | events | Events | Club/Konzert dünn, Nav-Pollution | ⚠️ |
| Wetter | chat_lane | Weather | früher „keine Live-Daten“ / „Wetter in Sechzehn“ | ❌ Bug (Code gefixt) |
| Vegan / Angus / Compound / Modul1 | — | — | oft leeres UI (Harness) | ❌ Capture |

---

## Batch-Ergebnisse (Tippfeld)

### Batch A
| ID | Auto | Hinweis |
|----|------|---------|
| wetter | false PASS (Tippfeld stuck) | Harness |
| steak | PASS | Rindock’s + Rio Grande |
| vegan | FAIL | leer |
| hotel_pool | PASS* | Reisebüro statt lokal Pitch |
| oepnv | NO_MODAL | Harness |
| flug_wien_taxi | FAIL* | korrekt Uhr nachgefragt |
| kino | Tippfeld stuck | Harness |

### Batch B
| ID | Auto | Hinweis |
|----|------|---------|
| vegan/angus/compound/modul1 | FAIL | leer |
| wangerooge | PASS | Fähre+Flug |
| outfit | PASS* | dünn |
| london | PASS | Reisebüro |
| lisbon | PASS | Uhr Freitag |
| nav_prisdorf | PASS | Route |
| tour_1h | PASS | Tour |
| rooftop | PASS* | dünn + Nav-Rest |

**Ask-Server Retest Vegan:** Queue ok, UI leer → Poller liefert nicht zuverlässig in den Turn (bekannt aus Overnight).

---

## Fixes in diesem Lauf (Repo)

1. **`spickzettelTitle.ts`** — `cityHint` vor Speech; Zahlwörter (`Sechzehn`) nie als Stadt; Smoke-Tests.
2. **`weatherDayPlanSpeech.ts`** — bei „hier“/GPS Pack-Hint nutzen; Zahlwort-Stadt verwerfen.
3. **`shortTermContext.ts`** — Zahlwörter in `TRAVEL_CITY_STOP`.
4. **`call1ThinkFrame.ts`** — Hotel ohne Zielstadt = `pitch_module` lokal, nicht Reisebüro.
5. **`ownerGold.pack.json`** — Wetter-Titel, Outfit-Konkretheit, Hotel lokal, Reisebüro nur mit Ziel.

**Noch nötig vom User:** `npm run gold:publish` + `npm run install:android:release -- -Build` (Auto-Publish/Build war in der Session geblockt).

---

## Was noch fehlt bis „40 grün“

- Rebuild APK → Wetter + Hotel-Routing live verifizieren  
- Tippfeld/Ask-Harness härten (Submit zuverlässig, längere Waits, Tour-Reset)  
- Follow-ups: Flug `18 Uhr` → Leave-by + Taxi; Steak Ablehnung; Compound Punkte  
- Vegan/Angus/Kino/ÖPNV/Modul1 erneut bis Capture nicht leer  
- Rooftop+Outfit: Orte + Kleidung in einer Antwort  
- Map: ÖPNV-Linie auf Karte manuell bestätigen  

---

## Empfohlene nächste Schritte

1. Release **2.0.27** mit obigen Fixes installieren  
2. `gold:publish`  
3. `_qa40_live.py` / Marathon mit Tour-Force-Stop vor jedem Ask  
4. Gezielt die FAIL-Liste bis grün durchziehen  

*Harness-Noise ≠ Produkt-Bug; leere Captures zuerst als Testinfra behandeln.*
