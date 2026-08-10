# Findus Deep-Research — Prisdorf

Modul-1-Pack-Fokus: stabile Orte, Geschichte, Orientierung, GPS-Eingänge, Wegweiser, Offline-Erzählungen, FAQ.
Nicht ins Pack hardcoden: Preise, Speisekarten-URLs die rotieren, heutige Konzerte, Hotelpreise → `_live_research`.

## Pack-Status
- spots: 56
- categories: aussicht, bahnhof, bildung, cafe, denkmal, einkaufen, freizeit, geschichte, gesundheit, kirche, kultur, museum, natur, restaurant, service, sicherheit, soziales, sport, verwaltung
- missing must-have: ok
- live_research prompts: 4
- transit: yes

## Google Deep Research — Master Prompt

```
Erstelle einen evidenzbasierten Ortsbericht für Prisdorf (Deutschland) für einen Offline-Stadtführer.
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
- **events**: Was läuft HEUTE und in den nächsten 7 Tagen an Konzerten, Theater, Festen und Touren in Prisdorf? Nur belegte Termine mit Datum, Ort, Link.
- **tours**: Welche geführten Touren, Wanderungen, Watt-/Naturführungen oder Ticket-Erlebnisse gibt es aktuell in Prisdorf? Links zur Buchung, keine erfundenen Preise.
- **dining**: Aktuelle Speisekarten, Ruhetag und Bewertungen für empfohlene Restaurants/Cafés in Prisdorf — Links suchen, keine alten Pack-Preise wiederholen.
- **hotels**: Aktuelle Hotel-/Unterkunftsverfügbarkeit und Preise in Prisdorf für das geplante Datum — Live-Suche, keine Pack-Preise.

## Spot-Übersicht (Kurz)
- `prisdorf_bahnhof_wartehäuschen` [bahnhof/main] narr=326 deep=30 approaches=3 poly
- `prisdorf_gemeindezentrum_hudenbarg` [verwaltung/main] narr=317 deep=29 approaches=2 poly
- `prisdorf_kriegerehrenmal_bilsbek` [denkmal/main] narr=301 deep=19 approaches=2 poly
- `prisdorf_peiner_hof` [freizeit/main] narr=308 deep=25 approaches=2 poly
- `prisdorf_peiner_hag_gewerbe` [service/main] narr=283 deep=22 approaches=2 poly
- `prisdorf_pinnau_ufer` [aussicht/main] narr=312 deep=24 approaches=2 poly
- `prisdorf_tsv_sportgelände` [freizeit/main] narr=309 deep=21 approaches=2 poly
- `prisdorf_tcp_tennis` [freizeit/main] narr=275 deep=19 approaches=2 poly
- `prisdorf_bilsbek_schule` [bildung/main] narr=283 deep=18 approaches=2 poly
- `prisdorf_eisenbahnbrücke_hudenbarg` [aussicht/main] narr=289 deep=20 approaches=2 poly
- `prisdorf_feuerlöschteich_gemeindeteich` [natur/main] narr=278 deep=20 approaches=2 poly
- `prisdorf_alte_schule_lütte_prisdörper` [bildung/main] narr=287 deep=18 approaches=1 poly
- `prisdorf_marktkauf_meyers_frischecenter` [service/main] narr=305 deep=20 approaches=2 poly
- `prisdorf_freiwillige_feuerwehr` [verwaltung/main] narr=294 deep=19 approaches=2 poly
- `prisdorf_grossstadtmission_dahl` [soziales/main] narr=301 deep=18 approaches=2 poly
- `prisdorf_heimatverein` [museum/main] narr=285 deep=18 approaches=2 poly
- `prisdorf_haus_prisdorf_altenheim` [service/main] narr=240 deep=17 approaches=2 poly
- `prisdorf_drk_ortsverein` [service/main] narr=220 deep=17 approaches=1 poly
- `prisdorf_bäcker_schlüter` [cafe/optional] narr=305 deep=19 approaches=2 poly
- `prisdorf_bäcker_allwörden_marktkauf` [cafe/optional] narr=257 deep=19 approaches=2 poly
- `prisdorf_backstube_münster` [cafe/optional] narr=273 deep=19 approaches=2 poly
- `prisdorf_team_tankstelle` [service/main] narr=187 deep=19 approaches=2 poly
- `prisdorf_stadtgeschichte_gesamt` [geschichte/main] narr=334 deep=69 approaches=2 poly
- `prisdorf_staggenborg_apotheke` [gesundheit/main] narr=159 deep=17 approaches=2 poly
- `prisdorf_gemeinschaftspraxis` [gesundheit/main] narr=82 deep=15 approaches=2 poly
- `prisdorf_zahnarztpraxis` [gesundheit/main] narr=187 deep=15 approaches=2 poly
- `prisdorf_friseur_klier` [service/main] narr=158 deep=15 approaches=2 poly
- `prisdorf_coiffeur_jensen` [service/main] narr=134 deep=15 approaches=2 poly
- `prisdorf_baumschule_huckfeldt` [bildung/main] narr=107 deep=16 approaches=2 poly
- `prisdorf_gärtnerei_clematis_westphal` [sport/main] narr=90 deep=16 approaches=2 poly
- `prisdorf_kkiosk_post` [service/main] narr=141 deep=15 approaches=2 poly
- `prisdorf_pm_service` [service/main] narr=157 deep=15 approaches=2 poly
- `prisdorf_hoyers_gasthof` [restaurant/optional] narr=75 deep=18 approaches=1 poly
- `prisdorf_santorini_gastro` [restaurant/optional] narr=49 deep=17 approaches=2 poly
- `prisdorf_kitz_jungtierrettung` [natur/main] narr=155 deep=16 approaches=2 poly
- `prisdorf_pmv_veranstaltungen` [kultur/main] narr=85 deep=16 approaches=2 poly
- `prisdorf_bilsbek_fluss` [natur/main] narr=84 deep=16 approaches=2 poly
- `prisdorf_loeschbrunnen_außenbezirke` [sicherheit/main] narr=155 deep=16 approaches=2 poly
- `prisdorf_kirche_kummerfeld` [kirche/main] narr=152 deep=16 approaches=2 poly
- `prisdorf_zur_schwalbe_geschichte` [bildung/main] narr=87 deep=16 approaches=2 poly
- `prisdorf_bilsbekraum` [verwaltung/main] narr=138 deep=15 approaches=2 poly
- `prisdorf_reiterverein_bilsbek` [sport/main] narr=152 deep=16 approaches=2 poly
- `prisdorf_blume_aktuell` [einkaufen/optional] narr=135 deep=16 approaches=1 poly
- `prisdorf_krause_karosserie` [service/main] narr=123 deep=15 approaches=1 poly
- `prisdorf_ernstings_family` [einkaufen/optional] narr=137 deep=15 approaches=2 poly
- `prisdorf_prisdorf_net` [verwaltung/main] narr=87 deep=15 approaches=1 poly
- `prisdorf_wald_hauen` [natur/main] narr=137 deep=16 approaches=2 poly
- `prisdorf_fairway_hotel` [restaurant/optional] narr=71 deep=17 approaches=2 poly
- `prisdorf_eat_happy_sushi` [restaurant/optional] narr=35 deep=17 approaches=2 poly
- `prisdorf_star_textilreinigung` [service/main] narr=137 deep=15 approaches=2 poly
- `prisdorf_toom_baumarkt` [service/main] narr=91 deep=17 approaches=2 poly
- `prisdorf_sav_angelteich` [natur/main] narr=154 deep=15 approaches=2 poly
- `prisdorf_jagdgemeinschaft` [natur/main] narr=349 deep=16 approaches=1 poly
- `prisdorf_strassen_gestern_heute` [geschichte/main] narr=165 deep=18 approaches=2 poly
- `prisdorf_strassenverzeichnis` [geschichte/main] narr=157 deep=15 approaches=1 poly
- `prisdorfer_feldmark` [natur/main] narr=334 deep=19 approaches=2 poly

---
Nach dem Report: Datei speichern und `node scripts/cityPack/mergeDeepResearch.mjs --city prisdorf --file <report>` ausführen.