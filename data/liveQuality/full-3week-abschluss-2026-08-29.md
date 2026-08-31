# Full 3-Wochen Live-QA — Abschluss (2026-08-29)

Gerät: `00143157P001105` · APK `2.0.26` (versionCode 53) · Captures: `.cursor/live13/`

## Kurzfazit

**Nein — nicht alle Tests sind grün.**  
Auto-Harness: **31/43 PASS**. Nach inhaltlicher Prüfung der UI-Captures: **~27/43 PASS**.

Alle 43 Szenarien der letzten ~3 Wochen wurden live getippt und die Antworten (Spickzettel / Speech-Snips / Buttons) gegen die Frage geprüft — nicht nur Auto-Regex.

## Lernen

| Schicht | Status |
|--------|--------|
| Am Gerät korrigieren (`correctionLearning` → LearnedRule) | vorhanden |
| Owner-Gold + `gold:publish` | **26 Blueprints** publiziert (u. a. Hotel lokal, Dining Must-Filter, Flug Leave-by, Topic-Cut) |
| Crowd / collective | vorhanden, braucht mehrere User |

**Nein:** der Marathon in Cursor schreibt nicht automatisch neue Regeln. Lernen braucht User-Korrektur am Gerät, Owner-Gold, oder Crowd.

Komische Formulierungen / Komplexes: **teilweise**. Gut z. B. Steak, Kino, Reisebüro London/Lissabon, Hotel lokal (kein „Von wo?“). Schwach: leere Turns (vegan/angus/Notfall/Compound), falscher Hbf→Prisdorf, Pass/Konsulat ohne Treffer, Wetter ohne Live-Daten in diesem Lauf.

## Starke Treffer (inhaltlich OK)

- **steak** — Reo / Rindock´s, Speisekarte verlinkt  
- **hotel_pool** — Hotels in Prisdorf + Stay22, kein Reisebüro-Funnel  
- **kino** — Filme/Spielzeiten  
- **london / lisbon** — Reisebüro-Funnel  
- **nav_prisdorf**, **veg_abend**, Outfit mit Jacke/Schuhe (Titel teils veraltet)

## Inhaltliche Fails (Auswahl)

| ID | Problem |
|----|---------|
| wetter | „Keine direkten Live-Wetterdaten“ |
| vegan / angus | kein Spickzettel |
| compound_hh / kiel_combo | „nichts Passendes“ / leer |
| fuss_notfall / zahn / scooter | leer |
| nav_fast_hbf | navigiert **Bahnhof Prisdorf** statt regionalem Hbf |
| oepnv | zu dünn / kein klarer Anschluss |
| pass_lost | kein Konsulat |
| museum_trex | nur dünnes „Museum“ |
| toilet / flug_wien_taxi | Tippfeld stuck (Harness) |
| wangerooge / flug_barcelona | leer / kein Sheet |

## Harness-Hinweise

- Follow-ups brauchen Kontext (kein Reset dazwischen) — qa40-Reihenfolge.  
- Auto-PASS ohne Spickzettel war früher zu locker; Ambient-Home ≠ Antwort.

## Nächste Fixes (Lern-first)

1. Leere Turns (Dining/Notfall/Compound) — warum Call-2/UI nicht öffnet  
2. Gold/Dispatch: Hauptbahnhof ≠ Ortsbahnhof  
3. Pass/Konsulat-Blaupause härten  
4. Wetter Live-Daten / Fallback ehrlich aber nützlich  
5. Tippfeld-Submit zuverlässiger (Keyboard/Fragen-Tap)
