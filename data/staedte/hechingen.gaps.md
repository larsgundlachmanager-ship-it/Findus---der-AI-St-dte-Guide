# Findus Deep-Research — Zollernstadt Hechingen

Modul-1-Pack-Fokus: stabile Orte, Geschichte, Orientierung, GPS-Eingänge, Wegweiser, Offline-Erzählungen, FAQ.
Nicht ins Pack hardcoden: Preise, Speisekarten-URLs die rotieren, heutige Konzerte, Hotelpreise → `_live_research`.

## Pack-Status
- spots: 81
- categories: aussicht, bahnhof, cafe, denkmal, freizeit, gesundheit, hotel, kirche, museum, natur, restaurant, verwaltung
- missing must-have: ok
- live_research prompts: 4
- transit: no

## Warnings (Top 40)
- hechingen_bahnhof_hechingen: missing general_info / Offline-[Erzählung] (≥20 chars)
- hechingen_hechingen: missing general_info / Offline-[Erzählung] (≥20 chars)
- hechingen_sweg_verkehrsbetrieb_hohenzollerische_landesbahn_hechingen: missing general_info / Offline-[Erzählung] (≥20 chars)
- hechingen_barfusspark_hechingen: missing general_info / Offline-[Erzählung] (≥20 chars)
- hechingen_naldo_verkehrsverbund_neckar_alb_donau_gmbh: missing general_info / Offline-[Erzählung] (≥20 chars)
- hechingen_erleb_dich_pfad_hechingen: missing general_info / Offline-[Erzählung] (≥20 chars)
- hechingen_marchenpfad_hechingen: missing general_info / Offline-[Erzählung] (≥20 chars)
- hechingen_streichelzoo_hofgut_domane: missing general_info / Offline-[Erzählung] (≥20 chars)
- hechingen_burg_hohenzollern: missing general_info / Offline-[Erzählung] (≥20 chars)
- hechingen_kupferpfanne_gerd_merkel: missing general_info / Offline-[Erzählung] (≥20 chars)
- hechingen_museum_restaurant: missing general_info / Offline-[Erzählung] (≥20 chars)
- hechingen_hohenzollerisches_landesmuseum: missing general_info / Offline-[Erzählung] (≥20 chars)
- hechingen_stadthalle_museum: missing general_info / Offline-[Erzählung] (≥20 chars)
- hechingen_romisches_freilichtmuseum_hechingen_stein: missing general_info / Offline-[Erzählung] (≥20 chars)
- hechingen_oldtimermuseum_zollernalb: missing general_info / Offline-[Erzählung] (≥20 chars)
- hechingen_romisches_freilichtmuseum_villa_rustika: missing general_info / Offline-[Erzählung] (≥20 chars)
- hechingen_unterer_turm: missing general_info / Offline-[Erzählung] (≥20 chars)
- hechingen_hechingen_altstadt: missing general_info / Offline-[Erzählung] (≥20 chars)
- hechingen_stiftskirche_st_jakobus: missing general_info / Offline-[Erzählung] (≥20 chars)
- hechingen_rom_kath_kirchengemeinde_zollern: missing general_info / Offline-[Erzählung] (≥20 chars)
- hechingen_klosterkirche_st_luzen: missing general_info / Offline-[Erzählung] (≥20 chars)
- hechingen_evangelische_johanneskirche: missing general_info / Offline-[Erzählung] (≥20 chars)
- hechingen_marienkapelle: missing general_info / Offline-[Erzählung] (≥20 chars)
- hechingen_ruhe_christi_kapelle: missing general_info / Offline-[Erzählung] (≥20 chars)
- hechingen_heiligkreuzkapelle: missing general_info / Offline-[Erzählung] (≥20 chars)
- hechingen_evangelische_kirchengemeinde_hechingen: missing general_info / Offline-[Erzählung] (≥20 chars)
- hechingen_marktplatz_brunnen: missing general_info / Offline-[Erzählung] (≥20 chars)
- hechingen_brunnen: missing general_info / Offline-[Erzählung] (≥20 chars)
- hechingen_marien_brunnen: missing general_info / Offline-[Erzählung] (≥20 chars)
- hechingen_dorfbrunnen_hirtenknabe: missing general_info / Offline-[Erzählung] (≥20 chars)
- hechingen_nichthuldiger_brunnen: missing general_info / Offline-[Erzählung] (≥20 chars)
- hechingen_krieger_denkmal: missing general_info / Offline-[Erzählung] (≥20 chars)
- hechingen_hechingen_bechtoldsweiler: missing general_info / Offline-[Erzählung] (≥20 chars)
- hechingen_kunstdenkmal_maria_hat_geholfen: missing general_info / Offline-[Erzählung] (≥20 chars)
- hechingen_furstengarten: missing general_info / Offline-[Erzählung] (≥20 chars)
- hechingen_aussichtspunkt_hohenzollernblick: missing general_info / Offline-[Erzählung] (≥20 chars)
- hechingen_starzelpark: missing general_info / Offline-[Erzählung] (≥20 chars)
- hechingen_aussichtspunkt_beurener_heide: missing general_info / Offline-[Erzählung] (≥20 chars)
- hechingen_aussichtspunkt_jokenplatz: missing general_info / Offline-[Erzählung] (≥20 chars)
- hechingen_wanderparkplatz_huttenwiesen: missing general_info / Offline-[Erzählung] (≥20 chars)

## Google Deep Research — Master Prompt

```
Erstelle einen evidenzbasierten Ortsbericht für Zollernstadt Hechingen (Deutschland) für einen Offline-Stadtführer.
Nur belegte Fakten mit Quelle. Keine erfundenen Preise/Öffnungszeiten ohne Datum.

Abschnitte:
1) Stadtgeschichte (Gründung, Name, prägende Ereignisse, heute) — max. ~800 Wörter
2) Must-See Orte (Module 1): Museen, Denkmäler, Kirchen, Natur/Aussicht, Bahnhof/Hafen, besondere Architektur
   Pro Ort: Herkunft, Architektur, was man DORT machen kann, visuelle Anker (Fassade/Eingang/Farbe/Form), FAQ (5 typische Fragen)
   Pflicht-FAQ pro Ort: „Woran erkenne ich diesen Ort?“ (sichtbare Merkmale von der Straße/vom Weg, bevor der Name fällt)
   Querverbindungen: logische Bezüge zu anderen Orten derselben Stadt (Achsen, Kontraste, gemeinsame Geschichte)
3) Wege & Orientierung: wichtige Pfade/Promenaden/Trampelpfade, offizielle Ortspläne (URL)
4) ÖPNV: Bahnhöfe/Haltestellen/Fähren mit Namen (keine Live-Fahrpläne)
5) Service/Notfall: Arzt, Apotheke, Polizei, Defi — nur stabile Infos
6) Explizit NICHT: tagesaktuelle Konzertlisten, Hotelpreise, Speisekarten-Preise
```

## Gezielte Lückenfragen

### Erzählung fehlt (63)
Schreibe für jeden Ort eine Offline-Erzählung (80–200 Wörter), atmosphärisch, ohne Adress-Dump:
- hechingen_bahnhof_hechingen
- hechingen_hechingen
- hechingen_sweg_verkehrsbetrieb_hohenzollerische_landesbahn_hechingen
- hechingen_barfusspark_hechingen
- hechingen_naldo_verkehrsverbund_neckar_alb_donau_gmbh
- hechingen_erleb_dich_pfad_hechingen
- hechingen_marchenpfad_hechingen
- hechingen_streichelzoo_hofgut_domane
- hechingen_burg_hohenzollern
- hechingen_kupferpfanne_gerd_merkel
- hechingen_museum_restaurant
- hechingen_hohenzollerisches_landesmuseum
- hechingen_stadthalle_museum
- hechingen_romisches_freilichtmuseum_hechingen_stein
- hechingen_oldtimermuseum_zollernalb
- hechingen_romisches_freilichtmuseum_villa_rustika
- hechingen_unterer_turm
- hechingen_hechingen_altstadt
- hechingen_stiftskirche_st_jakobus
- hechingen_rom_kath_kirchengemeinde_zollern
- hechingen_klosterkirche_st_luzen
- hechingen_evangelische_johanneskirche
- hechingen_marienkapelle
- hechingen_ruhe_christi_kapelle
- hechingen_heiligkreuzkapelle
- hechingen_evangelische_kirchengemeinde_hechingen
- hechingen_marktplatz_brunnen
- hechingen_brunnen
- hechingen_marien_brunnen
- hechingen_dorfbrunnen_hirtenknabe
- hechingen_nichthuldiger_brunnen
- hechingen_krieger_denkmal
- hechingen_hechingen_bechtoldsweiler
- hechingen_kunstdenkmal_maria_hat_geholfen
- hechingen_furstengarten
- hechingen_aussichtspunkt_hohenzollernblick
- hechingen_starzelpark
- hechingen_aussichtspunkt_beurener_heide
- hechingen_aussichtspunkt_jokenplatz
- hechingen_wanderparkplatz_huttenwiesen

### Deep/FAQ fehlt (63)
Je Ort ≥4 Deep-Fakten + ≥3 FAQ im Format „User-Frage: … Antwort: …“:
- hechingen_bahnhof_hechingen
- hechingen_hechingen
- hechingen_sweg_verkehrsbetrieb_hohenzollerische_landesbahn_hechingen
- hechingen_barfusspark_hechingen
- hechingen_naldo_verkehrsverbund_neckar_alb_donau_gmbh
- hechingen_erleb_dich_pfad_hechingen
- hechingen_marchenpfad_hechingen
- hechingen_streichelzoo_hofgut_domane
- hechingen_burg_hohenzollern
- hechingen_kupferpfanne_gerd_merkel
- hechingen_museum_restaurant
- hechingen_hohenzollerisches_landesmuseum
- hechingen_stadthalle_museum
- hechingen_romisches_freilichtmuseum_hechingen_stein
- hechingen_oldtimermuseum_zollernalb
- hechingen_romisches_freilichtmuseum_villa_rustika
- hechingen_unterer_turm
- hechingen_hechingen_altstadt
- hechingen_stiftskirche_st_jakobus
- hechingen_rom_kath_kirchengemeinde_zollern
- hechingen_klosterkirche_st_luzen
- hechingen_evangelische_johanneskirche
- hechingen_marienkapelle
- hechingen_ruhe_christi_kapelle
- hechingen_heiligkreuzkapelle
- hechingen_evangelische_kirchengemeinde_hechingen
- hechingen_marktplatz_brunnen
- hechingen_brunnen
- hechingen_marien_brunnen
- hechingen_dorfbrunnen_hirtenknabe
- hechingen_nichthuldiger_brunnen
- hechingen_krieger_denkmal
- hechingen_hechingen_bechtoldsweiler
- hechingen_kunstdenkmal_maria_hat_geholfen
- hechingen_furstengarten
- hechingen_aussichtspunkt_hohenzollernblick
- hechingen_starzelpark
- hechingen_aussichtspunkt_beurener_heide
- hechingen_aussichtspunkt_jokenplatz
- hechingen_wanderparkplatz_huttenwiesen

### Coverage-Check (nichts vergessen)
- Gibt es markante Trampelpfade, Promenaden, Aussichtspunkte, die noch fehlen?
- Alle Bahnhöfe/Haltestellen/Fähranleger vollständig?
- Offizieller Ortsplan / Webcam / Tourismus-URL?
- Typische Touren-Typen (nur Typ + wo buchen, keine heutigen Termine)?

## Live-Research Prompts (App, nicht Pack-Hardcode)
- **events**: Was läuft HEUTE und in den nächsten 7 Tagen an Konzerten, Theater, Festen und Touren in Hechingen? Nur belegte Termine mit Datum, Ort, Link.
- **tours**: Welche geführten Touren, Wanderungen, Watt-/Naturführungen oder Ticket-Erlebnisse gibt es aktuell in Hechingen? Links zur Buchung, keine erfundenen Preise.
- **dining**: Aktuelle Speisekarten, Ruhetag und Bewertungen für empfohlene Restaurants/Cafés in Hechingen — Links suchen, keine alten Pack-Preise wiederholen.
- **hotels**: Aktuelle Hotel-/Unterkunftsverfügbarkeit und Preise in Hechingen für das geplante Datum — Live-Suche, keine Pack-Preise.

## Spot-Übersicht (Kurz)
- `hechingen_bahnhof_hechingen` [bahnhof/main] narr=0 deep=1 approaches=2 poly
- `hechingen_hechingen` [bahnhof/main] narr=0 deep=1 approaches=2 poly
- `hechingen_sweg_verkehrsbetrieb_hohenzollerische_landesbahn_hechingen` [bahnhof/main] narr=0 deep=1 approaches=2 poly
- `hechingen_barfusspark_hechingen` [freizeit/main] narr=0 deep=1 approaches=2 poly
- `hechingen_naldo_verkehrsverbund_neckar_alb_donau_gmbh` [freizeit/main] narr=0 deep=1 approaches=2 poly
- `hechingen_erleb_dich_pfad_hechingen` [freizeit/main] narr=0 deep=1 approaches=2 poly
- `hechingen_marchenpfad_hechingen` [freizeit/main] narr=0 deep=1 approaches=2 poly
- `hechingen_streichelzoo_hofgut_domane` [freizeit/main] narr=0 deep=1 approaches=2 poly
- `hechingen_burg_hohenzollern` [denkmal/main] narr=0 deep=1 approaches=2 poly
- `hechingen_kupferpfanne_gerd_merkel` [freizeit/main] narr=0 deep=1 approaches=2 poly
- `hechingen_museum_restaurant` [museum/main] narr=0 deep=1 approaches=2 poly
- `hechingen_hohenzollerisches_landesmuseum` [museum/main] narr=0 deep=1 approaches=2 poly
- `hechingen_stadthalle_museum` [museum/main] narr=0 deep=1 approaches=2 poly
- `hechingen_romisches_freilichtmuseum_hechingen_stein` [museum/main] narr=0 deep=1 approaches=2 poly
- `hechingen_oldtimermuseum_zollernalb` [museum/main] narr=0 deep=1 approaches=2 poly
- `hechingen_romisches_freilichtmuseum_villa_rustika` [museum/main] narr=0 deep=1 approaches=2 poly
- `hechingen_unterer_turm` [museum/main] narr=0 deep=1 approaches=2 poly
- `hechingen_hechingen_altstadt` [museum/main] narr=0 deep=1 approaches=2 poly
- `hechingen_stiftskirche_st_jakobus` [kirche/main] narr=0 deep=1 approaches=2 poly
- `hechingen_rom_kath_kirchengemeinde_zollern` [kirche/main] narr=0 deep=1 approaches=2 poly
- `hechingen_klosterkirche_st_luzen` [kirche/main] narr=0 deep=1 approaches=2 poly
- `hechingen_evangelische_johanneskirche` [kirche/main] narr=0 deep=1 approaches=2 poly
- `hechingen_marienkapelle` [kirche/main] narr=0 deep=1 approaches=2 poly
- `hechingen_ruhe_christi_kapelle` [kirche/main] narr=0 deep=1 approaches=2 poly
- `hechingen_heiligkreuzkapelle` [kirche/main] narr=0 deep=1 approaches=2 poly
- `hechingen_evangelische_kirchengemeinde_hechingen` [kirche/main] narr=0 deep=1 approaches=2 poly
- `hechingen_marktplatz_brunnen` [denkmal/main] narr=0 deep=1 approaches=2 poly
- `hechingen_brunnen` [denkmal/main] narr=0 deep=1 approaches=2 poly
- `hechingen_marien_brunnen` [denkmal/main] narr=0 deep=1 approaches=2 poly
- `hechingen_dorfbrunnen_hirtenknabe` [denkmal/main] narr=0 deep=1 approaches=2 poly
- `hechingen_nichthuldiger_brunnen` [denkmal/main] narr=0 deep=1 approaches=2 poly
- `hechingen_krieger_denkmal` [denkmal/main] narr=0 deep=1 approaches=2 poly
- `hechingen_hechingen_bechtoldsweiler` [denkmal/main] narr=0 deep=1 approaches=2 poly
- `hechingen_kunstdenkmal_maria_hat_geholfen` [denkmal/main] narr=0 deep=1 approaches=2 poly
- `hechingen_furstengarten` [natur/main] narr=0 deep=1 approaches=2 poly
- `hechingen_aussichtspunkt_hohenzollernblick` [natur/main] narr=0 deep=1 approaches=2 poly
- `hechingen_starzelpark` [natur/main] narr=0 deep=1 approaches=2 poly
- `hechingen_aussichtspunkt_beurener_heide` [natur/main] narr=0 deep=1 approaches=2 poly
- `hechingen_aussichtspunkt_jokenplatz` [natur/main] narr=0 deep=1 approaches=2 poly
- `hechingen_wanderparkplatz_huttenwiesen` [natur/main] narr=0 deep=1 approaches=2 poly
- `hechingen_aussichtspunkt_burg_hohenzollern_bei_boll` [natur/main] narr=0 deep=1 approaches=2 poly
- `hechingen_unterer_tor_hechingen` [aussicht/main] narr=0 deep=1 approaches=2 poly
- `hechingen_aussichtspunkt_bismarckstein` [aussicht/main] narr=0 deep=1 approaches=2 poly
- `hechingen_aussichtspunkt` [aussicht/main] narr=0 deep=1 approaches=2 poly
- `hechingen_golfclub_hechingen_hohenzollern_e_v` [freizeit/main] narr=0 deep=1 approaches=2 poly
- `hechingen_hallen_freibad_hechingen` [freizeit/main] narr=0 deep=1 approaches=2 poly
- `hechingen_domane_golfpark` [freizeit/main] narr=0 deep=1 approaches=2 poly
- `hechingen_weiherstadion` [freizeit/main] narr=0 deep=1 approaches=2 poly
- `hechingen_minigolfanlage_rapphof` [freizeit/main] narr=0 deep=1 approaches=2 poly
- `hechingen_skatepark_hechingen` [freizeit/main] narr=0 deep=1 approaches=2 poly
- `hechingen_minigolfanlage` [freizeit/main] narr=0 deep=1 approaches=2 poly
- `hechingen_bolzplatz_im_fasanengarten` [freizeit/main] narr=0 deep=1 approaches=2 poly
- `hechingen_burgerburo` [verwaltung/main] narr=0 deep=1 approaches=2 poly
- `hechingen_rathaus_hechingen` [verwaltung/main] narr=0 deep=1 approaches=2 poly
- `hechingen_stadtverwaltung_hechingen` [verwaltung/main] narr=0 deep=1 approaches=2 poly
- `hechingen_apotheke_spranger_hechingen` [gesundheit/main] narr=0 deep=1 approaches=2 poly
- `hechingen_stadt_apotheke_am_obertorplatz` [gesundheit/main] narr=0 deep=1 approaches=2 poly
- `hechingen_lowen_apotheke_hechingen` [gesundheit/main] narr=0 deep=1 approaches=2 poly
- `hechingen_sonnen_apotheke_hechingen` [gesundheit/main] narr=0 deep=1 approaches=2 poly
- `hechingen_zentrum_am_furstengarten` [gesundheit/main] narr=0 deep=1 approaches=2 poly
- `hechingen_dr_bernd_stekeler_und_regina_simmich_theil_arzte_fur_allgemeinmedizin` [gesundheit/main] narr=0 deep=1 approaches=2 poly
- `hechingen_gemeinschaftspraxis_dr_med_d_krauss_und_dr_med_a_reif` [gesundheit/main] narr=0 deep=1 approaches=2 poly
- `hechingen_dres_nicole_und_matthias_dirr_facharzte_fur_innere_medizin_gastroenter` [gesundheit/main] narr=0 deep=1 approaches=2 poly
- `hechingen_siehscht_me_cafe_vesperhausle` [cafe/optional] narr=0 deep=1 approaches=2 poly
- `hechingen_karamela` [cafe/optional] narr=0 deep=1 approaches=2 poly
- `hechingen_cafe_rocker_thomas_rocker` [cafe/optional] narr=0 deep=1 approaches=2 poly
- `hechingen_laganini_bar_restaurant_cafe` [cafe/optional] narr=0 deep=1 approaches=2 poly
- `hechingen_back_bey_backerei_cafe_grill_restaurant` [cafe/optional] narr=0 deep=1 approaches=2 poly
- `hechingen_starkes_cafe` [cafe/optional] narr=0 deep=1 approaches=2 poly
- `hechingen_eiscafe_la_palma` [cafe/optional] narr=0 deep=1 approaches=2 poly
- `hechingen_kaiseki_restaurant` [cafe/optional] narr=0 deep=1 approaches=2 poly
- `hechingen_ristorante_l_amore` [restaurant/optional] narr=0 deep=1 approaches=2 poly
- `hechingen_hofgut_domane_gmbh` [restaurant/optional] narr=0 deep=1 approaches=2 poly
- `hechingen_restaurant_schlossberg_hechingen` [restaurant/optional] narr=0 deep=1 approaches=2 poly
- `hechingen_tommy_s_gastronomie` [restaurant/optional] narr=0 deep=1 approaches=2 poly
- `hechingen_hechinger_hof` [hotel/optional] narr=0 deep=1 approaches=2 poly
- `hechingen_hotel_am_schlossplatz` [hotel/optional] narr=0 deep=1 approaches=2 poly
- `hechingen_pension_rapphof` [hotel/optional] narr=0 deep=1 approaches=2 poly
- `hechingen_lamm_hotel_restaurant` [hotel/optional] narr=0 deep=1 approaches=2 poly
- `hechingen_hotel_gastehaus_unsere_stadtvilla` [hotel/optional] narr=0 deep=1 approaches=2 poly
- `hechingen_wanderheim_hohengasthof_nagelehaus` [hotel/optional] narr=0 deep=1 approaches=2 poly

---
Nach dem Report: Datei speichern und `node scripts/cityPack/mergeDeepResearch.mjs --city hechingen --file <report>` ausführen.