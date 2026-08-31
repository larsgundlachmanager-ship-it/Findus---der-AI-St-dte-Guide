# Yorro Geräte-Playbook — Sprint-Block (2.0.22 / v49)

**Ziel:** Frische Release-APK manuell gegen die offenen Roadmap-Punkte prüfen.  
**APK:** `android/app/build/outputs/apk/release/app-release.apk` (2.0.22 · versionCode **49**)  
**Install:** `npm run install:android:release` (oder mit `-Build` neu bauen)

**Voraussetzungen**
- [ ] APK v49 installiert (App-Info: Yorro 2.0.22)
- [ ] GPS an, Mikro bereit, Stadt mit Pack (Ideal: **Hamburg** oder aktuelle Reise-Stadt)
- [ ] Optional: Wangerooge-Pack / Nähe Nordsee für Fähre-vs-Flug
- [ ] Regression offline schon grün: `npm run test:regression-gate`

Abhaken nur bei **bestanden**. Fail = 1 Satz Symptom + Uhrzeit.

---

## A. Compound → Tagesplan (Sprint 1)

Sage:
> Morgen 9 Uhr los nach Hamburg, frühstücken, abends Pannfisch mit Elbblick, Michel rauf — wie hoch, wie teuer, was ist das, zwischendurch eine Tour, Sonnenuntergang.

- [ ] Bridge menschlich, dann Antwort (nicht Meta-Recherche)
- [ ] Button **📅 Tagesplan** sichtbar (auch neben anderen Buttons)
- [ ] Tippen → Kalender öffnet **nach** der Speech (nicht mitten im Satz)
- [ ] Slots grob da: Anreise / Frühstück / Pannfisch / Michel / Tour / Sunset
- [ ] Michel Höhe/Preis in der Speech, wenn belegt

---

## B. Step-by-Step-Loop (Compound-Loop)

Nach A (Session/Plan noch aktiv):

- [ ] Chip **„Punkte durchgehen“** tippen **oder** sagen: „Lass uns jeden Punkt durchgehen“
- [ ] Kurzer Opener, **kein** zweiter Voll-Monolog des ganzen Tages
- [ ] Erster Punkt einzeln (Pitch / Optionen)
- [ ] Weiter / Später / Auswahl funktioniert
- [ ] Optional Route nach Commit; nächster Punkt folgt

---

## C. Unseen → Auto-Tour (Sprint 3)

Ort mit Pack + Visit-Historie (z. B. Laboe):

> Wir haben eine Stunde — was haben wir hier noch nicht gesehen? Am Ende gerne am Hafen mit Parkplatz.

- [ ] Tour startet / Nav-Layout (nicht nur Speech-Liste)
- [ ] Default ~60 Min, keine Dauer-Rückfrage
- [ ] „Am Ende am Hafen“ = End-Anker, **kein** Theme-Filter nur Hafen
- [ ] Prefs filtern (z. B. Museen raus wenn skip)

---

## D. Wangerooge Fähre vs. Flug (Sprint 4)

> Wie komme ich nach Wangerooge?

- [ ] Vergleich Fähre **und** Inselflieger in **einer** Antwort
- [ ] Kein erfundener Fährpreis („live bei SIW“ / ehrlich)
- [ ] Flug-„ab“-Tarife ok wenn belegt
- [ ] Buttons: Fährtickets + Inselflieger (Frisonaut/SIW)

> Morgen Flug nach Wien, bitte mit Taxi zum Flughafen

- [ ] Leave-by / Flug-Flow mit **Taxi-Empfehlung**
- [ ] Uber/Taxi-Button vorne; keine sinnlose ÖPNV/Taxi-Chip-Schleife
- [ ] Kein separates reines „Taxi hail“ ohne Flug-Kontext

---

## E. Niche-Gastro

> Restaurant mit Angus-Steak in der Nähe

- [ ] Job/Pitch = Hard-Match (nicht beliebiges Café)
- [ ] Orte mit Angus/Steak-Beleg bevorzugt; Pizzeria raus
- [ ] Soft-Fail ehrlich → Steakhouse-Familie, nie vegan

> Gibt es ein Zugrestaurant oder Speisewagen?

- [ ] Gastro-Pfad, **kein** ÖPNV/„Zug nach …“
- [ ] Speisewagen-/Bahn-Themen-Gastro; kein Bahnhof-Imbiss als Treffer

---

## F. Hotel Hard-Match (Sprint 2) — Stichprobe

> Hotel all-inclusive mit Massage und Pool unter 800 Euro

- [ ] All-inclusive **und** Massage nur wenn belegt (Spa allein reicht nicht)
- [ ] Fehlende Amenities ehrlich; 2 Optionen + Buchungs-Link

---

## G. Partner / Help-First — Stichprobe

> Morgen fliege ich nach Barcelona

- [ ] Sinnvoller Partner-Moment (z. B. eSIM) als Button **nach** der Antwort, kein Uber-Spam aus Help-First

---

## H. Regression Smoke (kurz am Gerät)

- [ ] Flug-Turn → Handgepäck-Chip → schnelle Antwort ohne neues Call-1-Gefühl
- [ ] „Wie komme ich mit ÖPNV zum Hauptbahnhof?“ → Verbindung oder ehrliche Störung
- [ ] Kein Crash beim Kalender öffnen/schließen

---

## Ergebnis

| Datum | Tester | APK | Bestanden? | Schlimmster Fail |
|-------|--------|-----|------------|------------------|
|       |        | 2.0.22/49 | ja / nein  |                  |

**DoD grün** = A–E bestanden; F–H empfohlen.  
Fails → Correction / Owner-Gold / Bug — nicht Kernel anfassen ohne Batterie.
