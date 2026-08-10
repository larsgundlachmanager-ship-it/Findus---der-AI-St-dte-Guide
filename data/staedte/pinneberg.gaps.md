# Findus Deep-Research — Pinneberg

Modul-1-Pack-Fokus: stabile Orte, Geschichte, Orientierung, GPS-Eingänge, Wegweiser, Offline-Erzählungen, FAQ.
Nicht ins Pack hardcoden: Preise, Speisekarten-URLs die rotieren, heutige Konzerte, Hotelpreise → `_live_research`.

## Pack-Status
- spots: 20
- categories: aussicht, bahnhof, denkmal, einkaufen, freizeit, geschichte, gesundheit, hotel, kirche, museum, natur, sport, verwaltung
- missing must-have: ok
- live_research prompts: 5
- transit: yes

## Google Deep Research — Master Prompt

```
Erstelle einen evidenzbasierten Ortsbericht für Pinneberg (Deutschland) für einen Offline-Stadtführer.
Nur belegte Fakten mit Quelle. Keine erfundenen Preise/Öffnungszeiten ohne Datum.

Abschnitte:
1) Stadtgeschichte (Gründung, Name, prägende Ereignisse, heute) — max. ~800 Wörter
2) Must-See Orte (Module 1): Museen, Denkmäler, Kirchen, Natur/Aussicht, Bahnhof/Hafen, besondere Architektur
   Pro Ort: Herkunft, Architektur, was man DORT machen kann, visuelle Anker (Fassade/Eingang), FAQ (5 typische Fragen)
3) Wege & Orientierung: wichtige Pfade/Promenaden/Trampelpfade, offizielle Ortspläne (URL)
4) ÖPNV: Bahnhöfe/Haltestellen/Fähren mit Namen (keine Live-Fahrpläne)
5) Service/Notfall: Arzt, Apotheke, Polizei, Defi — nur stabile Infos
6) Explizit NICHT: tagesaktuelle Konzertlisten, Hotelpreise, Speisekarten-Preise
```

## Gezielte Lückenfragen

### Coverage-Check (nichts vergessen)
- Gibt es markante Trampelpfade, Promenaden, Aussichtspunkte, die noch fehlen?
- Alle Bahnhöfe/Haltestellen/Fähranleger vollständig?
- Offizieller Ortsplan / Webcam / Tourismus-URL?
- Typische Touren-Typen (nur Typ + wo buchen, keine heutigen Termine)?

## Live-Research Prompts (App, nicht Pack-Hardcode)
- **events**: Was läuft HEUTE und in den nächsten 7 Tagen in Pinneberg (Konzerte, SummerJazz, Theater, Führungen)? Nur belegte Termine mit Datum, Ort, Link — keine Pack-Preise.
- **tours**: Aktuelle Führungen, Bäder-Öffnung, Ausstellungen Drostei/Stadtmuseum/Samlandmuseum Pinneberg — Links und heutige Zeiten frisch suchen.
- **dining**: Aktuelle Speisekarten und Öffnungszeiten empfohlener Restaurants/Cafés in Pinneberg — Links suchen, keine Pack-Preise.
- **hotels**: Hotel-/Unterkunftspreise und Verfügbarkeit in Pinneberg für das Reisedatum live suchen.
- **events**: SummerJazz Pinneberg: aktuelles Festivaljahr, Bühnen, Programm und Festival-Pin — nur frische Quellen, keine alten Pack-Preise.

## Spot-Übersicht (Kurz)
- `pinneberg_bahnhof_pr` [bahnhof/main] narr=154 deep=23 approaches=2 poly
- `pinneberg_hotel_cap_polonio` [hotel/optional] narr=221 deep=18 approaches=2 poly
- `pinneberg_die_drostei` [museum/main] narr=183 deep=31 approaches=2 poly
- `pinneberg_stadtmuseum` [museum/main] narr=151 deep=26 approaches=2 poly
- `pinneberg_rathauspassage` [einkaufen/optional] narr=207 deep=19 approaches=2 poly
- `pinneberg_kriegerdenkmal_bahnhofvorplatz` [denkmal/main] narr=214 deep=18 approaches=2 poly
- `pinneberg_deutsches_baumschulmuseum` [museum/main] narr=231 deep=18 approaches=2 poly
- `pinneberg_stadtgeschichte` [geschichte/main] narr=178 deep=10 approaches=2 poly
- `pinneberg_samlandmuseum` [museum/main] narr=195 deep=9 approaches=2 poly
- `pinneberg_wasserturm_pinneberg` [aussicht/main] narr=173 deep=9 approaches=2 poly
- `pinneberg_torhaus_ilo_park` [denkmal/main] narr=188 deep=9 approaches=1 poly
- `pinneberg_bader_pinneberg` [freizeit/main] narr=152 deep=7 approaches=2 poly
- `pinneberg_vfl_pinneberg_stadion_fahltsweide` [sport/main] narr=148 deep=7 approaches=2 poly
- `pinneberg_drosteipark` [natur/main] narr=147 deep=6 approaches=2 poly
- `pinneberg_christuskirche_pinneberg` [kirche/main] narr=132 deep=5 approaches=2 poly
- `pinneberg_regio_klinikum_pinneberg` [gesundheit/main] narr=118 deep=7 approaches=2 poly
- `pinneberg_rathaus_pinneberg` [verwaltung/main] narr=144 deep=8 approaches=2 poly
- `pinneberg_waldgebiet_fahlt` [natur/main] narr=113 deep=5 approaches=2 poly
- `pinneberg_rosengarten_pinneberg` [natur/main] narr=117 deep=4 approaches=2 poly
- `pinneberg_bahnhof_thesdorf` [bahnhof/main] narr=124 deep=10 approaches=2 poly

---
Nach dem Report: Datei speichern und `node scripts/cityPack/mergeDeepResearch.mjs --city pinneberg --file <report>` ausführen.