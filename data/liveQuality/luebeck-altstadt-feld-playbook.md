# Lübeck Altstadt — Feld-Playbook (DoD)

**Voraussetzungen**
- [ ] APK `app-release.apk` (mind. 2.0.4 / v29+, Build mit Schicht-1 cityKey) installiert
- [ ] Lübeck-Pack neu geladen (nach App-Start / Stadtwechsel)
- [ ] GPS + Mikro + (optional) Kopfhörer; Modul-1-Hintergrund-Pref wie gewünscht
- [ ] Optional Preflight: `npm run test:luebeck-feld-preflight` (Code/APK — ersetzt **nicht** die Fuß-Checks)

Abhaken nur bei **bestanden**. Bei Fail: 1 Satz Symptom + Uhrzeit notieren.

---

## 1. Holstentor — Modul 1
- [ ] Approach/Wegweiser feuert **früh genug** (nicht erst vorbei)
- [ ] Facing/Richtung verständlich („links/rechts/vor dir“)
- [ ] Arrival = **Hauptstory**, kein zweites Teaser
- [ ] Kein „soll ich navigieren?“ wenn schon am Tor

## 2. Facing — Café / Sichtsuche
- [ ] „Wo ist [Café/Ort in Sichtweite]?“ → Richtung + Distanz aus **einer** Wahrheit
- [ ] Ort innerhalb weniger Sekunden gefunden (nicht 8 gleichwertige Rätsel)

## 3. Nav-SSOT — „Bring mich zu …“
- [ ] Holstentor / Marien / Pack-Ort: Nav **startet** (nicht nur Button)
- [ ] Speech-km = Karten-km (eine Zahl)
- [ ] „Tennisclub Phoenix **Lübeck**“ → Lübeck, **nicht** Prisdorf
- [ ] Absichtlich falsch abbiegen → Route neu / Cues korrigieren
- [ ] Am Ziel: Ankunft, Navigation aus / ruhig

## 4. Theater / Kirche (Pref an)
- [ ] Vorbei → Story oder ehrlicher Skip (kein stummes Großding ohne Grund)
- [ ] Bei Theater/Kultur: Programm/Eintritt nur wenn belegt + sinnvoller Button

## 5. Bridge
- [ ] Kein „ich check / Moment / bin dran“ als Bridge
- [ ] Bridge geht auf die Frage ein (Wetter/Eis/Motivation) **oder** fehlt → sofort Antwort

## 6. ÖPNV
- [ ] Ziel mit Fuß ≥ ~20 Min → ÖPNV angesprochen + Button/Journey
- [ ] Optional: ÖPNV starten funktioniert grob (nicht Google-Parität fordern)

## 7. Locked / Hintergrund
- [ ] Pref „Immer“/Kopfhörer: Modul 1 spricht auch bei gesperrtem Display / App im Hintergrund
- [ ] Ohne Pref: erwartbares Stoppen — kein Crash

## 8. Pitch / Tour (Kurz)
- [ ] „Günstiges Hotel Lübeck“ → Pitch + Live/Partner, kein erfundenes B&B
- [ ] „Parkplätze?“ → Pitch, nicht still speichern
- [ ] „2 Stunden Altstadt erkunden“ → echte Stopps in Timeline (nicht leere Highlights-Lüge)

---

## Ergebnis

| Datum | Tester | Bestanden? | Schlimmster Fail |
|-------|--------|------------|------------------|
|       |        | ja / nein  |                  |

**DoD grün** = alle Checkboxen 1–7 bestanden (8 empfohlen).  
Sonst: Fails hier + Feedback-JSON → nächste Fix-Runde.
