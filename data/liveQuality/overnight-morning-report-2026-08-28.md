# Yorro — Overnight Live Report (Update 28.08.2026, ~10:45)

**Gerät:** `00143157P001105` · **APK live:** **2.0.24 / 51** (Install heute Morgen) · **Code/JS-Bundle:** Lissabon-Fixes gebaut (`assembleRelease`); `app.json`/`build.gradle` auf **2.0.25 / 52** synced — nächster Install zeigt die Versionsnummer korrekt.

---

## Die drei Dauerfehler

| # | Problem | Stand live (morgens) |
|---|---------|----------------------|
| 1 | **Vegan → Steakhouse** | ✅ **PASS** — `r2-vegan`: Alternativen **Honest Greens** (Label vegan) + Speisekarte/Maps; **kein** Bulls/Rindock |
| 2 | **Wetter HUD stale** | ✅ **PASS** — durchgängig „Regen noch XX Min“ / „Regen möglich“ (nicht „kein Regen bis Abend“) |
| 3 | **Speisekarte verlässt App** | ⚠️ Button in Alternativen sichtbar; **Tap → InApp-Sheet** diese Runde nicht sauber abgefangen (Timing/Tour). Code in v51 (`InAppBrowserSheet`). Bitte 1× manuell tippen. |

---

## Gastro live (Belege unter `.cursor/live9/`)

| Ask | Ergebnis |
|-----|----------|
| Steak Nähe (`p1-steak`) | ✅ **Rindock’s Pinneberg** (Menü: Steak, 3,8 km) + **Bulls Steakhouse** (12,1 km) + Speisekarte/Maps/Web |
| Steak später (`r1-steak`) | ✅ Header **Brasa D’Ouro – Steakhouse**; Tour-Kontext störte Pitch |
| Vegan (`r2-vegan`) | ✅ Honest Greens · vegan · Speisekarte — Gegen-Diät-Filter hält |

---

## Weitere Priority-Szenarien

| Szenario | Live | Hinweis |
|----------|------|---------|
| Hotel Pool+Sauna | ⚠️ | Einmal Soft-Stadt-Popup „Mit Pool Und / Datensatz“ (falscher City-Switch). Extract-Code filtert Amenities — Popup trotzdem gesehen; Tour/Context störte Folgetests |
| Compound Hamburg + Tagesplan | ❌/⏳ | UI-Antwort oft von **hängender Multi-Stop-Tour** überdeckt; Tagesplan-Button nicht zuverlässig getroffen |
| Flug+Taxi Wien | ✅ overnight | Spickzettel HAM→VIE gestern; heute Morgen Tour-Pollution |
| ÖPNV Hbf | ✅ overnight | Turn submitted |
| Kino heute | ⏳ | Turn submitted overnight; heute Morgen Tour-Pollution |
| Pitch/Tour 1h | ⚠️ | Tour startet; **klebt** (Stop 1/11 · 32 Std · „via Hotels in Lissabon“) und schluckt Folgefragen |
| Modul 1 Wo-bin-ich | ⏳ | Nach Tour-Reset nicht sauber neu erfasst |
| Lissabon Wochenende (~2 Wochen) | ⚠️ | Früher: Sticky-Steak → Lissabon-Steakhouses; „ein Wochenende nach Lissabon“ als Fake-Venue. **Code-Fix:** `namedVenueIntent` TRAVEL_NOT_VENUE + Plan-Family `planen`/`wochenende` + `detectPitchKind` generic. Live danach: oft noch **hängende Multi-Stop-Tour** / lokale ÖPNV-HUD (Hbf) statt klarer Flug+Hotel-UI; letzter Capture `lisbon-f8` nur Platzhalter „Passende Optionen…“ |
| Partner-Deeplinks | ⏳ | Speisekarte/Maps-Buttons da; Uber/Ticket nicht separat verifiziert |
| Map QA (Phase 2) | ⏳ | Frische Home-Map ohne Spaghetti sichtbar; Kompass/POI-Tap-Pass **nicht** abgeschlossen |

---

## Fixes / Build heute Morgen

- Release **2.0.24 (51)** neu gebaut + installiert; später Bundle mit Lissabon-Routing-Fixes; Version **52 / 2.0.25** in `app.json` + `android/app/build.gradle` synced
- Stichpunkte: Sterne raus / km-Dedupe / Wish-Relevanz (`visualBullets`, `pitchSpeech`, `wishFilterRank`) — Analyse bestätigt in [Explore bullet + pitch filter](5b577310-f46f-46b5-924f-746493129033)
- City-Extract: Amenity-Stopwörter („Hotel mit Pool“ ≠ Stadt); Soft-Button-Label `CitySwitchPrompt`
- Lissabon: kein Fake-Venue „Wochenende nach Lissabon“; Wochenend-`planen` → Plan-Family
- `network_security_config` / cleartext für Ask-QA
- Live-Harness Tippfeld (`_marathon_ask`, Mic y≈1850)
- **Ask-Poller (`:8791`) weiterhin stuck** in Release — Tests über Tippfeld

---

## Residual Gaps (ehrlich)

1. **Tour sticky** — Multi-Stop (u. a. Lissabon/Hotels, ~32 Std) schluckt Folge-Asks bis `force-stop` — größter Live-Blocker ([Finish overnight live QA](a8f9bc8e-7114-42c9-a970-02a7bfeb39f7))
2. **Lissabon Wochenende** — Routing-Fixes im Bundle; Live-Flug+Hotel+Programm-Flow noch nicht grün (Tour/ÖPNV-Pollution)
3. **Ask-Server Poller** in Release — UI-Ask nötig
4. **Speisekarte In-App** — Code da, Tap live noch einmal bestätigen
5. **Compound → Tagesplan + Step-by-Step** — nicht grün live
6. **Map Phase 2** — Rotation/POI/ÖPNV-Linie noch offen

---

## Screens

`.cursor/live9/` — u. a. `p1-steak*`, `r2-vegan*`, `fresh-home*`, Wetter-HUD in mehreren Captures.

Playbook: `data/liveQuality/sprint-block-geraete-playbook.md`

---

*Aktualisiert während Morning-Continuation nach Overnight-Session.*
