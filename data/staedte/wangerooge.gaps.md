# Findus Deep-Research — Wangerooge

Modul-1-Pack-Fokus: stabile Orte, Geschichte, Orientierung, GPS-Eingänge, Wegweiser, Offline-Erzählungen, FAQ.
Nicht ins Pack hardcoden: Preise, Speisekarten-URLs die rotieren, heutige Konzerte, Hotelpreise → `_live_research`.

## Pack-Status
- spots: 107
- categories: aussicht, bahnhof, cafe, denkmal, einkaufen, fischrestaurant, freizeit, gesundheit, hafen, hotel, kirche, museum, natur, ort, restaurant, service, sicherheit, sport, transport, verwaltung
- missing must-have: ok
- live_research prompts: 4
- transit: no

## Google Deep Research — Master Prompt

```
Erstelle einen evidenzbasierten Ortsbericht für Wangerooge (Deutschland) für einen Offline-Stadtführer.
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
- **events**: Was läuft HEUTE und in den nächsten 7 Tagen an Konzerten, Theater, Festen und Touren in Wangerooge? Nur belegte Termine mit Datum, Ort, Link.
- **tours**: Welche geführten Touren, Wanderungen, Watt-/Naturführungen oder Ticket-Erlebnisse gibt es aktuell in Wangerooge? Links zur Buchung, keine erfundenen Preise.
- **dining**: Aktuelle Speisekarten, Ruhetag und Bewertungen für empfohlene Restaurants/Cafés in Wangerooge — Links suchen, keine alten Pack-Preise wiederholen.
- **hotels**: Aktuelle Hotel-/Unterkunftsverfügbarkeit und Preise in Wangerooge für das geplante Datum — Live-Suche, keine Pack-Preise.

## Spot-Übersicht (Kurz)
- `wangerooge_cafe_pudding` [cafe/optional] narr=124 deep=14 approaches=3 poly
- `wangerooge_db_bahnhof_wangerooge` [bahnhof/main] narr=197 deep=39 approaches=3 poly
- `wangerooge_inselmuseum_alter_leuchtturm` [museum/main] narr=125 deep=14 approaches=3 poly
- `wangerooge_westturm` [aussicht/main] narr=110 deep=13 approaches=3 poly
- `wangerooge_fahranleger_wangerooge` [transport/main] narr=199 deep=15 approaches=2 poly
- `wangerooge_nationalpark_haus_wangerooge` [museum/main] narr=127 deep=14 approaches=3 poly
- `wangerooge_bistro_am_strand_wangerooge` [restaurant/optional] narr=50 deep=15 approaches=2 poly
- `wangerooge_neuer_leuchtturm_wangerooge` [museum/main] narr=208 deep=23 approaches=2 poly
- `wangerooge_nikolai_kirche_evangelisch_lutherische_kirchenge` [kirche/main] narr=90 deep=13 approaches=2 poly
- `wangerooge_djh_bistro_westturm` [restaurant/optional] narr=42 deep=15 approaches=2 poly
- `wangerooge_haus_am_alten_leuchtturm` [museum/main] narr=168 deep=13 approaches=2 poly
- `wangerooge_dorfplatz` [ort/main] narr=126 deep=14 approaches=2 poly
- `wangerooge_obere_strandpromenade` [natur/main] narr=177 deep=12 approaches=2 poly
- `wangerooge_restaurant_friesenjung` [restaurant/optional] narr=45 deep=15 approaches=2 poly
- `wangerooge_digger_s_strandbar` [cafe/optional] narr=41 deep=15 approaches=2 poly
- `wangerooge_restaurant_unser_boot` [restaurant/optional] narr=46 deep=15 approaches=2 poly
- `wangerooge_griechisches_restaurant_kreta` [restaurant/optional] narr=52 deep=15 approaches=2 poly
- `wangerooge_italian_love_story` [restaurant/optional] narr=41 deep=15 approaches=2 poly
- `wangerooge_restaurant_buhne_35` [cafe/optional] narr=42 deep=15 approaches=2 poly
- `wangerooge_gaststatte_dune_17` [restaurant/optional] narr=41 deep=15 approaches=2 poly
- `wangerooge_strandhotel_gerken` [restaurant/optional] narr=41 deep=18 approaches=2 poly
- `wangerooge_restaurant_kruse` [restaurant/optional] narr=39 deep=15 approaches=2 poly
- `wangerooge_eiscafe_pizzeria_ristorante_venezia` [cafe/optional] narr=61 deep=14 approaches=2 poly
- `wangerooge_cafe_neudeich` [cafe/optional] narr=35 deep=14 approaches=2 poly
- `wangerooge_inselbackerei_kruse_ohg` [cafe/optional] narr=46 deep=14 approaches=2 poly
- `wangerooge_der_pirat` [restaurant/optional] narr=32 deep=15 approaches=2 poly
- `wangerooge_inselmarkt_wangerooge_lammers_e_k` [einkaufen/optional] narr=57 deep=15 approaches=2 poly
- `wangerooge_frischemarkt_wangerooge` [einkaufen/optional] narr=46 deep=15 approaches=2 poly
- `wangerooge_cafe_treibsand` [cafe/optional] narr=37 deep=14 approaches=2 poly
- `wangerooge_parkhotel_wangerooge` [hotel/optional] narr=43 deep=15 approaches=2 poly
- `wangerooge_teestube_wangerooge_ug_haftungsbeschrankt` [restaurant/optional] narr=66 deep=16 approaches=2 poly
- `wangerooge_hotel_hanken` [hotel/optional] narr=35 deep=14 approaches=2 poly
- `wangerooge_wfv_gmbh_wangerooge` [hotel/optional] narr=42 deep=14 approaches=2 poly
- `wangerooge_backerei_bolte` [cafe/optional] narr=37 deep=14 approaches=2 poly
- `wangerooge_meerwasser_erlebnisbad_oase` [freizeit/main] narr=160 deep=14 approaches=2 poly
- `wangerooge_kaffee_kontor_wangerooge` [restaurant/optional] narr=47 deep=15 approaches=2 poly
- `wangerooge_restaurant_krusch` [restaurant/optional] narr=40 deep=15 approaches=2 poly
- `wangerooge_jan_seedorf` [restaurant/optional] narr=34 deep=15 approaches=2 poly
- `wangerooge_surfcafe_wangerooge` [cafe/optional] narr=42 deep=14 approaches=2 poly
- `wangerooge_lazarettbunker_wangerooge` [museum/main] narr=159 deep=13 approaches=2 poly
- `wangerooge_die_fischbar` [fischrestaurant/optional] narr=35 deep=15 approaches=2 poly
- `wangerooge_westkap_wangerooge` [hotel/optional] narr=41 deep=14 approaches=2 poly
- `wangerooge_cafe_klonschnack` [cafe/optional] narr=39 deep=13 approaches=2 poly
- `wangerooge_fischerstube` [fischrestaurant/optional] narr=35 deep=15 approaches=2 poly
- `wangerooge_restaurant_asterias` [restaurant/optional] narr=42 deep=15 approaches=2 poly
- `wangerooge_snabbelkraam` [cafe/optional] narr=35 deep=14 approaches=2 poly
- `wangerooge_fischgeschaft_kruse` [fischrestaurant/optional] narr=42 deep=15 approaches=2 poly
- `wangerooge_atlantic_hotel_garni_albrecht` [hotel/optional] narr=52 deep=14 approaches=2 poly
- `wangerooge_cafe_famoos` [cafe/optional] narr=34 deep=14 approaches=2 poly
- `wangerooge_haus_am_meer_wangerooge` [hotel/optional] narr=46 deep=13 approaches=2 poly
- `wangerooge_der_kuchenladen` [cafe/optional] narr=38 deep=14 approaches=2 poly
- `wangerooge_inselverein_des_gutenbergheims_wangerooge_e_v` [hotel/optional] narr=69 deep=14 approaches=2 poly
- `wangerooge_strandburg` [hotel/optional] narr=33 deep=15 approaches=2 poly
- `wangerooge_delis_strandreich` [cafe/optional] narr=40 deep=14 approaches=2 poly
- `wangerooge_hauptstrand` [natur/main] narr=146 deep=11 approaches=1 poly
- `wangerooge_hartmannstand_gedenken` [denkmal/main] narr=124 deep=11 approaches=1 poly
- `wangerooge_st_willehad` [kirche/main] narr=162 deep=12 approaches=1 poly
- `wangerooge_golfclub` [freizeit/main] narr=141 deep=13 approaches=1 poly
- `wangerooge_diggers_aussenposten` [cafe/optional] narr=66 deep=12 approaches=1 poly
- `wangerooge_fundamente_alter_westturm` [denkmal/main] narr=113 deep=12 approaches=1 poly
- `harlesiel_faehrhafen` [transport/main] narr=210 deep=18 approaches=3 poly
- `wangerooge_polizei` [sicherheit/main] narr=134 deep=11 approaches=1 poly
- `wangerooge_praxis_kortenhorn` [gesundheit/main] narr=81 deep=11 approaches=1 poly
- `wangerooge_insel_apotheke` [gesundheit/main] narr=134 deep=11 approaches=1 poly
- `wangerooge_lzo_geldautomat` [service/main] narr=146 deep=11 approaches=1 poly
- `wangerooge_aussichtsplatz_wangerooge` [aussicht/main] narr=89 deep=13 approaches=2 poly
- `wangerooge_deckwerk_wangerooge` [natur/main] narr=97 deep=13 approaches=2 poly
- `wangerooge_westlagune_wangerooge` [natur/main] narr=90 deep=13 approaches=2 poly
- `wangerooge_hafeneinfahrt_backbord_wangerooge` [hafen/main] narr=105 deep=13 approaches=2 poly
- `wangerooge_flugplatz_wangerooge_edwg` [transport/main] narr=97 deep=13 approaches=2 poly
- `wangerooge_bunkerreste_jade_ost_batterie` [denkmal/main] narr=109 deep=13 approaches=2 poly
- `wangerooge_jever_aussichtsplattform` [aussicht/main] narr=87 deep=13 approaches=2 poly
- `wangerooge_tuunpad` [natur/main] narr=87 deep=13 approaches=2 poly
- `wangerooge_lokschuppen_wangerooge` [bahnhof/main] narr=96 deep=13 approaches=2 poly
- `wangerooge_altes_wiegehauschen` [denkmal/main] narr=114 deep=13 approaches=2 poly
- `wangerooge_plattform_westende_wangerooge` [aussicht/main] narr=106 deep=13 approaches=2 poly
- `wangerooge_denk_mal_nach` [ort/main] narr=90 deep=13 approaches=2 poly
- `wangerooge_kriegerdenkmal` [denkmal/main] narr=91 deep=13 approaches=2 poly
- `wangerooge_dunenlandschaft_seelen_pfad` [natur/main] narr=106 deep=13 approaches=2 poly
- `wangerooge_ehemaliger_ostlicher_anleger_wangerooge` [bahnhof/main] narr=116 deep=13 approaches=2 poly
- `wangerooge_dunenlandschaft_westlagune` [natur/main] narr=105 deep=13 approaches=2 poly
- `wangerooge_kurpark_teichgarten` [natur/main] narr=98 deep=13 approaches=2 poly
- `wangerooge_mellumrat_e_v_wangerooge_oststation` [ort/main] narr=113 deep=13 approaches=2 poly
- `wangerooge_petra_losch_wattwandern_wangerooge` [natur/main] narr=113 deep=13 approaches=2 poly
- `wangerooge_hundestrand` [natur/main] narr=88 deep=13 approaches=2 poly
- `wangerooge_musik_pavillion_im_rosengarten` [aussicht/main] narr=107 deep=13 approaches=2 poly
- `wangerooge_memorial_luftwaffen_geschwader_71` [aussicht/main] narr=110 deep=13 approaches=2 poly
- `wangerooge_kurpark_rosengarten` [natur/main] narr=98 deep=13 approaches=2 poly
- `wangerooge_kurpark_steingarten` [natur/main] narr=101 deep=13 approaches=2 poly
- `wangerooge_modular_pumptrack_skateanlage` [ort/main] narr=106 deep=13 approaches=2 poly
- `wangerooge_kath_pfarrgemeinde_st_willehad_gemeindeburo` [ort/main] narr=122 deep=13 approaches=2 poly
- `wangerooge_klockhaus` [kirche/main] narr=86 deep=14 approaches=2 poly
- `wangerooge_sport_und_surfstrand_wangerooge` [natur/main] narr=109 deep=13 approaches=2 poly
- `wangerooge_kampfbahn_siedlerstrasse` [ort/main] narr=100 deep=13 approaches=2 poly
- `wangerooge_dunen_spielplatz` [natur/main] narr=93 deep=13 approaches=2 poly
- `wangerooge_spielplatz_am_westlichen_strand` [natur/main] narr=108 deep=13 approaches=2 poly
- `wangerooge_spielplatz_am_ostlichen_strand` [natur/main] narr=107 deep=13 approaches=2 poly
- `wangerooge_kinderspielhaus_sockenland` [ort/main] narr=103 deep=13 approaches=2 poly
- `wangerooge_hafenmeister_wangerooge` [bahnhof/main] narr=100 deep=13 approaches=2 poly
- `wangerooge_schiffsmeldestelle_wangerooge` [ort/main] narr=106 deep=13 approaches=2 poly
- `wangerooge_friedhofskapelle` [kirche/main] narr=93 deep=14 approaches=2 poly
- `wangerooge_helmer_und_christine_janssen_haus_klippersteven_wohn` [natur/main] narr=150 deep=13 approaches=2 poly
- `wangerooge_dunenhaus` [natur/main] narr=86 deep=13 approaches=2 poly
- `wangerooge_collage_galerie_am_damenpfad` [ort/main] narr=107 deep=13 approaches=2 poly
- `wangerooge_historische_uhr_pudding_uhr` [denkmal/main] narr=116 deep=13 approaches=2 poly
- `wangerooge_wangerooger_tennis_club_e_v` [sport/main] narr=89 deep=14 approaches=2 poly
- `wangerooge_wangerooge_erholung_ist_eine_insel_kurverwaltung` [verwaltung/main] narr=195 deep=22 approaches=2 poly

---
Nach dem Report: Datei speichern und `node scripts/cityPack/mergeDeepResearch.mjs --city wangerooge --file <report>` ausführen.