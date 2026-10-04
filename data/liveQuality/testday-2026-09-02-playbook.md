# Yorro Testday — 2026-09-02

**APK:** Release `2.0.62` / versionCode **89**  
Pfad: `android/app/build/outputs/apk/release/app-release.apk` (gebaut heute ~12:17)  
**Install:** `npm run install:android:release` — oder APK manuell aufs Handy

## Bevor du startest

- [ ] Release-APK installiert (App-Info: **Yorro 2.0.62**)
- [ ] GPS an, Lautsprecher/Kopfhörer ok, Mikro bereit
- [ ] Stadt mit Pack geladen (Ideal: **Hamburg** / Prisdorf-Umgebung / aktuelle Reise-Stadt)
- [ ] Voice-Memo / Diktiergerät bereit (ein Audio pro Block reicht)

## Audio — so machst du’s

1. Voice-Memo starten **bevor** du Yorro fragst.
2. Laut sagen: **„Frage 3“** (Nummer aus der Liste unten), dann die Frage an Yorro.
3. Yorro-Antwort komplett mitlaufen lassen (nicht abbrechen außer Crash).
4. Wenn’s schlecht war: kurz **nach** der Antwort ins Memo: „Fail — zu dünn / falsch / nichts getan“.
5. Am Ende des Blocks Memo stoppen → hier in den Chat schicken (Datei oder WhatsApp-Export egal).

**Nicht nötig:** Screenshot von jedem Fail. Audio + Nummer reicht. Bei Crash: Screenshot + „Crash bei Frage X“.

## Pro Frage im Kopf checken

1. Bridge ok? (Verstanden + Zusagen, kein Meta)
2. Antwort vorne? (Orte/Zahlen zuerst)
3. Inhalt belegt? (kein Fake-Preis)
4. Buttons = Speech?

---

## Block 1 — Modul 2 Kern (~25 Min)

| # | Sag genau das (oder sinngemäß) |
|---|---|
| 1 | Ich möchte heute Abend ins Kino — welche Filme laufen in der Nähe? |
| 2 | Hotel Freitag bis Sonntag mit Pool unter 500 Euro zu zweit |
| 3 | Mein Freund hat den Fuß gebrochen — wo können wir hin? |
| 4 | Ich habe akute Zahnschmerzen — welcher Zahnarzt hat jetzt Notdienst? |
| 5 | Wie komme ich am schnellsten mit öffentlichen Verkehrsmitteln zum Hauptbahnhof? |
| 6 | Bring mich schnell zum Hauptbahnhof |
| 7 | Restaurant mit Angus-Steak in der Nähe |
| 8 | Ich bin Vegetarier — wo essen wir gut zu Abend? |
| 9 | Welches Fischrestaurant lohnt sich und zeig mir die Speisekarte |
| 10 | Was soll ich heute Abend anziehen? |

## Block 2 — Events / Nightlife / Plan (~20 Min)

| # | Sag genau das |
|---|---|
| 11 | Was geht heute Abend noch — Party oder Konzert? |
| 12 | Ich möchte heute Abend auf eine Rooftop-Party — welche gibt es und was soll ich anziehen? |
| 13 | Mein Budget für heute ist 50 Euro — plane mir Mittagessen, eine Aktivität und einen Snack am Abend |
| 14 | Morgen 9 Uhr los in die Stadt, frühstücken, abends was Gutes mit Aussicht, zwischendurch eine Tour, Sonnenuntergang — mach einen Plan |
| 15 | Lass uns jeden Punkt durchgehen |
| 16 | Wo kann ich mir für heute einen E-Scooter leihen? |
| 17 | Wo ist die nächste Apotheke, die auch nachts geöffnet hat? |
| 18 | Wo gibt es hier saubere öffentliche Toiletten? |

## Block 3 — Nav / Alltag / Memory (~15 Min)

| # | Sag genau das |
|---|---|
| 19 | Wo ist der nächste Aldi oder Lidl? |
| 20 | Das ist mein Parkplatz, Parkticket gilt bis 17:42 Uhr |
| 21 | Ich habe meinen Reisepass verloren — wo ist mein Konsulat? |
| 22 | Was ist das für ein großes Gebäude dort drüben? *(zeige/zeige Richtung — oder tippe einen sichtbaren Ort)* |
| 23 | Wie breit ist die Elbe hier ungefähr? *(nur wenn du in HH-Nähe bist — sonst: „Wie hoch ist [bekanntes Wahrzeichen hier]?“)* |
| 24 | Morgen fliege ich nach Barcelona |

## Block 4 — Modul 1 vor Ort (~20–40 Min, optional draußen)

Am besten bei einem Pack-Ort (Wahrzeichen / Museum / Hafen). Sonst überspringen und später nachholen.

| # | Aktion / Sag |
|---|---|
| 25 | Langsam auf einen bekannten Pack-Ort zu — warten: feuert **Wegweiser** (Richtung + Erkennen)? |
| 26 | Am Ort ankommen — **Hauptstory**, kein zweites Teaser |
| 27 | Stichpunkte + Buttons prüfen („Mehr Historie“ / „Mehr dazu“) |
| 28 | „Erzähl mehr dazu“ / Mehr-Historie-Button |
| 29 | Weggehen und zurück — keine volle Story nochmal (locked) |
| 30 | Wir haben eine Stunde — was haben wir hier noch nicht gesehen? Am Ende gerne am Wasser / Hafen |

## Block 5 — Chrome / Karte Smoke (~5 Min)

| # | Check |
|---|---|
| 31 | Settings öffnet sofort |
| 32 | Timeline öffnet sofort |
| 33 | Orte-Sheet tippbar |
| 34 | Karte pan/zoom ohne Snap zurück |
| 35 | Nach einer Nav: Route sichtbar |

---

## Nach dem Test — so schickst du’s

1. Audio(s) hier in den Chat
2. Optional Kurznotiz:

```
Stadt: …
APK: 2.0.62
Fails: 3, 7, 14 (kurz warum)
Crash: keine / bei #
```

Dann gehe ich Fail für Fail durch (Owner-Gold / Bug / Slot) und gebe dir eine Retest-Liste.
