# Findus Deep-Research — Lübeck

Modul-1-Pack-Fokus: stabile Orte, Geschichte, Orientierung, GPS-Eingänge, Wegweiser, Offline-Erzählungen, FAQ.
Nicht ins Pack hardcoden: Preise, Speisekarten-URLs die rotieren, heutige Konzerte, Hotelpreise → `_live_research`.

## Pack-Status
- spots: 199
- categories: activity, altstadt, apotheke, aussicht, bahnhof, bakerei, cafe, denkmal, einkaufen, freizeit, freizeitpark, gepaeck, geschichte, gesundheit, golf, hafen, hotel, kino, kirche, markt, museum, natur, restaurant, service, souvenir, spielplatz, sport, supermarket, tankstelle, theater, toilette, tour, verwaltung, wanderung, wasser
- missing must-have: ok
- live_research prompts: 4
- transit: no

## Errors
- luebeck_stadtgeschichte: invalid polygon

## Warnings (Top 40)
- luebeck_lubeck_hauptbahnhof: missing general_info / Offline-[Erzählung] (≥20 chars)
- luebeck_db_reisezentrum_lubeck_hbf: missing general_info / Offline-[Erzählung] (≥20 chars)
- luebeck_lubeck_zob_hauptbahnhof: missing general_info / Offline-[Erzählung] (≥20 chars)
- luebeck_zob_hauptbahnhof_lubeck: missing general_info / Offline-[Erzählung] (≥20 chars)
- luebeck_lubecker_hafen_gesellschaft_mbh: missing general_info / Offline-[Erzählung] (≥20 chars)
- luebeck_fahranleger_ms_hanse: missing general_info / Offline-[Erzählung] (≥20 chars)
- luebeck_hafenrundfahrt: missing general_info / Offline-[Erzählung] (≥20 chars)
- luebeck_europaisches_hansemuseum: missing general_info / Offline-[Erzählung] (≥20 chars)
- luebeck_museumsquartier: missing general_info / Offline-[Erzählung] (≥20 chars)
- luebeck_museum_behnhaus_dragerhaus: missing general_info / Offline-[Erzählung] (≥20 chars)
- luebeck_museum_holstentor: missing general_info / Offline-[Erzählung] (≥20 chars)
- luebeck_museum_fur_natur_und_umwelt: missing general_info / Offline-[Erzählung] (≥20 chars)
- luebeck_museumshafen_lubeck: missing general_info / Offline-[Erzählung] (≥20 chars)
- luebeck_willy_brandt_haus_lubeck: missing general_info / Offline-[Erzählung] (≥20 chars)
- luebeck_ev_luth_kirchengemeinde_st_marien_zu_lubeck: missing general_info / Offline-[Erzählung] (≥20 chars)
- luebeck_st_petri_zu_lubeck: missing general_info / Offline-[Erzählung] (≥20 chars)
- luebeck_st_aegidien_kirche_lubeck_ev_luth_kirchengemeinde_st_aegidien_zu_lubeck: missing general_info / Offline-[Erzählung] (≥20 chars)
- luebeck_st_jakobi_kirche_lubeck_ev_luth_kirchengemeinde_st_jakobi_lubeck: missing general_info / Offline-[Erzählung] (≥20 chars)
- luebeck_propsteikirche_herz_jesu_lubeck: missing general_info / Offline-[Erzählung] (≥20 chars)
- luebeck_ev_luth_laurentius_kirchengemeinde_lubeck_st_lorenz_kirche: missing general_info / Offline-[Erzählung] (≥20 chars)
- luebeck_skulptur_der_maria_magdalena: missing general_info / Offline-[Erzählung] (≥20 chars)
- luebeck_kaiser_wilhelm_i_denkmal: missing general_info / Offline-[Erzählung] (≥20 chars)
- luebeck_johannes_brahms_statue: missing general_info / Offline-[Erzählung] (≥20 chars)
- luebeck_brunnen_sod: missing general_info / Offline-[Erzählung] (≥20 chars)
- luebeck_skulptur: missing general_info / Offline-[Erzählung] (≥20 chars)
- luebeck_heinrich_der_lowe_denkmal: missing general_info / Offline-[Erzählung] (≥20 chars)
- luebeck_stadtpark: missing general_info / Offline-[Erzählung] (≥20 chars)
- luebeck_naturufer: missing general_info / Offline-[Erzählung] (≥20 chars)
- luebeck_dragerpark: missing general_info / Offline-[Erzählung] (≥20 chars)
- luebeck_burgerpark: missing general_info / Offline-[Erzählung] (≥20 chars)
- luebeck_wiese_an_der_wallstreet: missing general_info / Offline-[Erzählung] (≥20 chars)
- luebeck_muhlenteich: missing general_info / Offline-[Erzählung] (≥20 chars)
- luebeck_leuchtturm_redner_lubeck: missing general_info / Offline-[Erzählung] (≥20 chars)
- luebeck_pitchingzone: missing general_info / Offline-[Erzählung] (≥20 chars)
- luebeck_sportbad_st_lorenz: missing general_info / Offline-[Erzählung] (≥20 chars)
- luebeck_zentralbad_lubeck: missing general_info / Offline-[Erzählung] (≥20 chars)
- luebeck_sportzentrum_falkenwiese: missing general_info / Offline-[Erzählung] (≥20 chars)
- luebeck_sport_und_freizeitareal_falkenwiese: missing general_info / Offline-[Erzählung] (≥20 chars)
- luebeck_schwarzlicht_minigolf_in_lubeck: missing general_info / Offline-[Erzählung] (≥20 chars)
- luebeck_minigolf_in_den_wallanlagen: missing general_info / Offline-[Erzählung] (≥20 chars)

## Google Deep Research — Master Prompt

```
Erstelle einen evidenzbasierten Ortsbericht für Lübeck (Deutschland) für einen Offline-Stadtführer.
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

### Erzählung fehlt (13)
Schreibe für jeden Ort eine Offline-Erzählung (80–200 Wörter), atmosphärisch, ohne Adress-Dump:
- luebeck_lubeck_hauptbahnhof
- luebeck_lubeck_zob_hauptbahnhof
- luebeck_zob_hauptbahnhof_lubeck
- luebeck_europaisches_hansemuseum
- luebeck_museum_behnhaus_dragerhaus
- luebeck_museum_holstentor
- luebeck_museumshafen_lubeck
- luebeck_st_aegidien_kirche_lubeck_ev_luth_kirchengemeinde_st_aegidien_zu_lubeck
- luebeck_st_jakobi_kirche_lubeck_ev_luth_kirchengemeinde_st_jakobi_lubeck
- luebeck_historische_altstadt_lubeck
- luebeck_lubecker_altstadt
- luebeck_panorama_lubecker_altstadt
- luebeck_wanderweg_an_der_trave

### Deep/FAQ fehlt (14)
Je Ort ≥4 Deep-Fakten + ≥3 FAQ im Format „User-Frage: … Antwort: …“:
- luebeck_lubeck_hauptbahnhof
- luebeck_lubeck_zob_hauptbahnhof
- luebeck_zob_hauptbahnhof_lubeck
- luebeck_europaisches_hansemuseum
- luebeck_museum_behnhaus_dragerhaus
- luebeck_museum_holstentor
- luebeck_museumshafen_lubeck
- luebeck_st_aegidien_kirche_lubeck_ev_luth_kirchengemeinde_st_aegidien_zu_lubeck
- luebeck_st_jakobi_kirche_lubeck_ev_luth_kirchengemeinde_st_jakobi_lubeck
- luebeck_historische_altstadt_lubeck
- luebeck_lubecker_altstadt
- luebeck_panorama_lubecker_altstadt
- luebeck_wanderweg_an_der_trave
- luebeck_stadtgeschichte

### Coverage-Check (nichts vergessen)
- Gibt es markante Trampelpfade, Promenaden, Aussichtspunkte, die noch fehlen?
- Alle Bahnhöfe/Haltestellen/Fähranleger vollständig?
- Offizieller Ortsplan / Webcam / Tourismus-URL?
- Typische Touren-Typen (nur Typ + wo buchen, keine heutigen Termine)?

## Live-Research Prompts (App, nicht Pack-Hardcode)
- **events**: Was läuft HEUTE und in den nächsten 7 Tagen an Konzerten, Theater, Festen und Touren in Lübeck? Nur belegte Termine mit Datum, Ort, Link.
- **tours**: Welche geführten Touren, Wanderungen, Watt-/Naturführungen oder Ticket-Erlebnisse gibt es aktuell in Lübeck? Links zur Buchung, keine erfundenen Preise.
- **dining**: Aktuelle Speisekarten, Ruhetag und Bewertungen für empfohlene Restaurants/Cafés in Lübeck — Links suchen, keine alten Pack-Preise wiederholen.
- **hotels**: Aktuelle Hotel-/Unterkunftsverfügbarkeit und Preise in Lübeck für das geplante Datum — Live-Suche, keine Pack-Preise.

## Spot-Übersicht (Kurz)
- `luebeck_lubeck_hauptbahnhof` [bahnhof/main] narr=0 deep=1 approaches=2 poly
- `luebeck_db_reisezentrum_lubeck_hbf` [bahnhof/main] narr=0 deep=1 approaches=2 poly
- `luebeck_lubeck_zob_hauptbahnhof` [bahnhof/main] narr=0 deep=1 approaches=2 poly
- `luebeck_zob_hauptbahnhof_lubeck` [bahnhof/main] narr=0 deep=1 approaches=2 poly
- `luebeck_lubecker_hafen_gesellschaft_mbh` [hafen/main] narr=0 deep=1 approaches=2 poly
- `luebeck_fahranleger_ms_hanse` [hafen/main] narr=0 deep=1 approaches=2 poly
- `luebeck_hafenrundfahrt` [hafen/main] narr=0 deep=1 approaches=2 poly
- `luebeck_europaisches_hansemuseum` [museum/main] narr=0 deep=1 approaches=2 poly
- `luebeck_museumsquartier` [museum/main] narr=0 deep=1 approaches=2 poly
- `luebeck_museum_behnhaus_dragerhaus` [museum/main] narr=0 deep=1 approaches=2 poly
- `luebeck_museum_holstentor` [museum/main] narr=0 deep=1 approaches=2 poly
- `luebeck_museum_fur_natur_und_umwelt` [museum/main] narr=0 deep=1 approaches=2 poly
- `luebeck_museumshafen_lubeck` [museum/main] narr=0 deep=1 approaches=2 poly
- `luebeck_willy_brandt_haus_lubeck` [museum/main] narr=0 deep=1 approaches=2 poly
- `luebeck_ev_luth_kirchengemeinde_st_marien_zu_lubeck` [kirche/main] narr=0 deep=1 approaches=2 poly
- `luebeck_st_petri_zu_lubeck` [kirche/main] narr=0 deep=1 approaches=2 poly
- `luebeck_st_aegidien_kirche_lubeck_ev_luth_kirchengemeinde_st_aegidien_zu_lubeck` [kirche/main] narr=0 deep=1 approaches=2 poly
- `luebeck_st_jakobi_kirche_lubeck_ev_luth_kirchengemeinde_st_jakobi_lubeck` [kirche/main] narr=0 deep=1 approaches=2 poly
- `luebeck_propsteikirche_herz_jesu_lubeck` [kirche/main] narr=0 deep=1 approaches=2 poly
- `luebeck_ev_luth_laurentius_kirchengemeinde_lubeck_st_lorenz_kirche` [kirche/main] narr=0 deep=1 approaches=2 poly
- `luebeck_skulptur_der_maria_magdalena` [denkmal/main] narr=0 deep=1 approaches=2 poly
- `luebeck_kaiser_wilhelm_i_denkmal` [denkmal/main] narr=0 deep=1 approaches=2 poly
- `luebeck_johannes_brahms_statue` [denkmal/main] narr=0 deep=1 approaches=2 poly
- `luebeck_brunnen_sod` [denkmal/main] narr=0 deep=1 approaches=2 poly
- `luebeck_skulptur` [denkmal/main] narr=0 deep=1 approaches=2 poly
- `luebeck_heinrich_der_lowe_denkmal` [denkmal/main] narr=0 deep=1 approaches=2 poly
- `luebeck_stadtpark` [natur/main] narr=0 deep=1 approaches=2 poly
- `luebeck_naturufer` [natur/main] narr=0 deep=1 approaches=2 poly
- `luebeck_dragerpark` [natur/main] narr=0 deep=1 approaches=2 poly
- `luebeck_burgerpark` [natur/main] narr=0 deep=1 approaches=2 poly
- `luebeck_wiese_an_der_wallstreet` [natur/main] narr=0 deep=1 approaches=2 poly
- `luebeck_muhlenteich` [natur/main] narr=0 deep=1 approaches=2 poly
- `luebeck_leuchtturm_redner_lubeck` [aussicht/main] narr=0 deep=1 approaches=2 poly
- `luebeck_pitchingzone` [freizeit/main] narr=0 deep=1 approaches=2 poly
- `luebeck_sportbad_st_lorenz` [freizeit/main] narr=0 deep=1 approaches=2 poly
- `luebeck_zentralbad_lubeck` [freizeit/main] narr=0 deep=1 approaches=2 poly
- `luebeck_sportzentrum_falkenwiese` [freizeit/main] narr=0 deep=1 approaches=2 poly
- `luebeck_sport_und_freizeitareal_falkenwiese` [freizeit/main] narr=0 deep=1 approaches=2 poly
- `luebeck_schwarzlicht_minigolf_in_lubeck` [freizeit/main] narr=0 deep=1 approaches=2 poly
- `luebeck_minigolf_in_den_wallanlagen` [freizeit/main] narr=0 deep=1 approaches=2 poly
- `luebeck_hansestadt_lubeck` [verwaltung/main] narr=0 deep=1 approaches=2 poly
- `luebeck_historische_altstadt_lubeck` [altstadt/main] narr=0 deep=1 approaches=2 poly
- `luebeck_lubecker_altstadt` [altstadt/main] narr=0 deep=1 approaches=2 poly
- `luebeck_panorama_lubecker_altstadt` [aussicht/main] narr=0 deep=1 approaches=2 poly
- `luebeck_panoramagang` [aussicht/main] narr=0 deep=1 approaches=2 poly
- `luebeck_theater_lubeck` [theater/optional] narr=0 deep=1 approaches=2 poly
- `luebeck_theater_combinale_lubeck` [theater/optional] narr=0 deep=1 approaches=2 poly
- `luebeck_theaterschiff_lubeck` [theater/optional] narr=0 deep=1 approaches=2 poly
- `luebeck_zaubertheater_lubeck` [theater/optional] narr=0 deep=1 approaches=2 poly
- `luebeck_hoftheater_lubeck` [theater/optional] narr=0 deep=1 approaches=2 poly
- `luebeck_wanderweg_an_der_trave` [wanderung/main] narr=0 deep=1 approaches=2 poly
- `luebeck_wanderweg_dragerweg` [wanderung/main] narr=0 deep=1 approaches=2 poly
- `luebeck_wakenitzufer` [wanderung/main] narr=0 deep=1 approaches=2 poly
- `luebeck_lubeck_hbf_gleis_2` [wanderung/main] narr=0 deep=1 approaches=2 poly
- `luebeck_lasertag_lubeck` [freizeitpark/main] narr=0 deep=1 approaches=2 poly
- `luebeck_myjump_lubeck_trampolinpark_trampolinhalle_schleswig_holstein` [freizeitpark/main] narr=0 deep=1 approaches=2 poly
- `luebeck_lunapark` [freizeitpark/main] narr=0 deep=1 approaches=2 poly
- `luebeck_lubeck_laden` [souvenir/main] narr=0 deep=1 approaches=2 poly
- `luebeck_principessa_geschenkartikel_wohnaccessoires` [souvenir/main] narr=0 deep=1 approaches=2 poly
- `luebeck_nanu_nana` [souvenir/main] narr=0 deep=1 approaches=2 poly
- `luebeck_dearuniverse` [souvenir/main] narr=0 deep=1 approaches=2 poly
- `luebeck_lubeck_zwischenzeilen_das_kulturmagazin` [souvenir/main] narr=0 deep=1 approaches=2 poly
- `luebeck_st_jurgen_apotheke` [gesundheit/optional] narr=0 deep=1 approaches=2 poly
- `luebeck_st_gertrud_apotheke` [gesundheit/optional] narr=0 deep=1 approaches=2 poly
- `luebeck_sana_kliniken_lubeck_gmbh` [gesundheit/optional] narr=0 deep=1 approaches=2 poly
- `luebeck_gemeinschaftspraxis_huxtertor` [gesundheit/optional] narr=0 deep=1 approaches=2 poly
- `luebeck_stadt_apotheke_lubeck` [gesundheit/optional] narr=0 deep=1 approaches=2 poly
- `luebeck_hausarztpraxis_wolken_wiltsch` [gesundheit/optional] narr=0 deep=1 approaches=2 poly
- `luebeck_e_kiosk_24_lubeck` [supermarket/optional] narr=52 deep=4 approaches=0 poly
- `luebeck_rewe_to_go_bei_aral` [supermarket/optional] narr=54 deep=4 approaches=0 poly
- `luebeck_grossparkplatz_rewe_lidl_moislinger_allee` [service/main] narr=75 deep=4 approaches=0 poly
- `luebeck_e_center_lubeck` [supermarket/optional] narr=50 deep=4 approaches=0 poly
- `luebeck_rewe` [supermarket/optional] narr=39 deep=4 approaches=0 poly
- `luebeck_pinguin_apotheke_am_hauptbahnhof` [apotheke/optional] narr=64 deep=4 approaches=0 poly
- `luebeck_pinguin_apotheke_muhlenstrasse` [apotheke/optional] narr=61 deep=4 approaches=0 poly
- `luebeck_linda_pegasus_apotheke` [apotheke/optional] narr=56 deep=4 approaches=0 poly
- `luebeck_uksh_lubeck_notaufnahme` [gesundheit/optional] narr=57 deep=4 approaches=0 poly
- `luebeck_sana_kliniken_lubeck_gmbh_notaufnahme` [gesundheit/optional] narr=71 deep=4 approaches=0 poly
- `luebeck_universitatsklinikum_schleswig_holstein_campus_lubeck_interdisziplinare_` [gesundheit/optional] narr=119 deep=4 approaches=0 poly
- `luebeck_notaufnahme_kinderklinik_universitatsklinikum_schleswig_holstein_campus_` [gesundheit/optional] narr=114 deep=4 approaches=0 poly
- `luebeck_1_polizeirevier_lubeck` [service/main] narr=54 deep=4 approaches=0 poly
- `luebeck_4_polizeirevier_lubeck` [service/main] narr=54 deep=4 approaches=0 poly
- `luebeck_2_polizeirevier_lubeck` [service/main] narr=54 deep=4 approaches=0 poly
- `luebeck_3_polizeirevier_lubeck` [service/main] narr=54 deep=4 approaches=0 poly
- `luebeck_polizeistation_huxtertor` [service/main] narr=55 deep=4 approaches=0 poly
- `luebeck_polizeistation_synagoge` [service/main] narr=54 deep=4 approaches=0 poly
- `luebeck_polizei_wasserschutzpolizeirevier_lubeck` [service/main] narr=71 deep=4 approaches=0 poly
- `luebeck_bundespolizeirevier_lubeck` [service/main] narr=57 deep=4 approaches=0 poly
- `luebeck_polizeistation_buntekuh` [service/main] narr=54 deep=4 approaches=0 poly
- `luebeck_domspielplatz` [spielplatz/optional] narr=47 deep=4 approaches=0 poly
- `luebeck_spielplatz` [spielplatz/optional] narr=44 deep=4 approaches=0 poly
- `luebeck_wasserspielplatz_kaisertor` [spielplatz/optional] narr=60 deep=4 approaches=0 poly
- `luebeck_spielplatz_an_der_mauer` [spielplatz/optional] narr=57 deep=4 approaches=0 poly
- `luebeck_spielplatz_alsheide_engelswisch` [spielplatz/optional] narr=65 deep=4 approaches=0 poly
- `luebeck_innenhof_spielplatz_glockengiesserstrasse` [spielplatz/optional] narr=73 deep=4 approaches=0 poly
- `luebeck_kanalspielplatz` [spielplatz/optional] narr=49 deep=4 approaches=0 poly
- `luebeck_golfclub_bfv_lubeck_e_v` [golf/optional] narr=52 deep=4 approaches=0 poly
- `luebeck_cinestar_lubeck_stadthalle` [kino/optional] narr=54 deep=4 approaches=0 poly
- `luebeck_filmhaus` [kino/optional] narr=130 deep=7 approaches=1 poly
- `luebeck_kommunales_kino_lubeck` [kino/optional] narr=50 deep=4 approaches=0 poly
- `luebeck_kolosseum_festsaal` [kino/optional] narr=46 deep=4 approaches=0 poly
- `luebeck_musik_und_kongresshalle_lubeck` [kino/optional] narr=59 deep=4 approaches=0 poly
- `luebeck_erotikkino_lubeck` [kino/optional] narr=45 deep=4 approaches=0 poly
- `luebeck_urban_apes_lubeck` [activity/optional] narr=49 deep=4 approaches=0 poly
- `luebeck_naturschutzgebiet_schellbruch` [natur/main] narr=58 deep=4 approaches=0 poly
- `luebeck_nsg_schellbruch` [natur/main] narr=44 deep=4 approaches=0 poly
- `luebeck_naturschutzgebiet_wakenitz_muggenbusch` [natur/main] narr=67 deep=4 approaches=0 poly
- `luebeck_naturschutzgebiet_wakenitz_gartnergasse` [natur/main] narr=68 deep=4 approaches=0 poly
- `luebeck_wakenitz` [natur/main] narr=131 deep=7 approaches=1 poly
- `luebeck_tennis_lbv_phonix` [sport/optional] narr=46 deep=4 approaches=0 poly
- `luebeck_stadion_lohmuhle` [sport/optional] narr=45 deep=4 approaches=0 poly
- `luebeck_buniamshof` [sport/optional] narr=39 deep=4 approaches=0 poly
- `luebeck_lubecker_tennis_u_hockey_club_e_v` [sport/optional] narr=66 deep=4 approaches=0 poly
- `luebeck_tennisschule_raabe_gbr_im_lbv_phonix` [sport/optional] narr=65 deep=4 approaches=0 poly
- `luebeck_lubecker_racket_club_e_v_tennis_padel_pickleball` [sport/optional] narr=82 deep=4 approaches=0 poly
- `luebeck_lsc_von_1999_e_v_abt_tennis` [sport/optional] narr=58 deep=4 approaches=0 poly
- `luebeck_naturbad_falkenwiese` [freizeit/main] narr=52 deep=4 approaches=0 poly
- `luebeck_altstadtbad_krahenteich` [altstadt/main] narr=55 deep=4 approaches=0 poly
- `luebeck_naturbad_marli` [freizeit/main] narr=46 deep=4 approaches=0 poly
- `luebeck_freibad_moisling` [freizeit/main] narr=48 deep=4 approaches=0 poly
- `luebeck_naturbad_eichholz_kleiner_see` [freizeit/main] narr=61 deep=4 approaches=0 poly
- `luebeck_freibad_schlutup` [freizeit/main] narr=48 deep=4 approaches=0 poly
- `luebeck_swl_trinkwasserbrunnen` [wasser/optional] narr=52 deep=4 approaches=0 poly
- `luebeck_trinkbrunnen_blau` [wasser/optional] narr=47 deep=4 approaches=0 poly
- `luebeck_star_tankstelle` [tankstelle/optional] narr=49 deep=4 approaches=0 poly
- `luebeck_avia_tankstelle_lohmuhle_daniela_kunz` [tankstelle/optional] narr=71 deep=4 approaches=0 poly
- `luebeck_hem_tankstelle` [tankstelle/optional] narr=48 deep=4 approaches=0 poly
- `luebeck_citti_tankstelle` [tankstelle/optional] narr=50 deep=4 approaches=0 poly
- `luebeck_shell` [tankstelle/optional] narr=39 deep=4 approaches=0 poly
- `luebeck_avia_xpress` [tankstelle/optional] narr=45 deep=4 approaches=0 poly
- `luebeck_jet_tankstelle` [tankstelle/optional] narr=48 deep=4 approaches=0 poly
- `luebeck_backerei_und_konditorei_mohr` [bakerei/main] narr=56 deep=4 approaches=0 poly
- `luebeck_junge_die_backerei` [bakerei/main] narr=47 deep=4 approaches=0 poly
- `luebeck_vollkornbackerei_das_freibackhaus_e_k` [bakerei/main] narr=66 deep=4 approaches=0 poly
- `luebeck_unser_muhlenbacker` [cafe/optional] narr=46 deep=4 approaches=0 poly
- `luebeck_feinbackerei_schuler` [bakerei/main] narr=48 deep=4 approaches=0 poly
- `luebeck_rossmann_drogeriemarkt` [einkaufen/optional] narr=55 deep=4 approaches=0 poly
- `luebeck_dm_drogerie_markt` [einkaufen/optional] narr=50 deep=4 approaches=0 poly
- `luebeck_linden_arcaden_lubeck` [einkaufen/optional] narr=56 deep=4 approaches=0 poly
- `luebeck_budni_muhlenstrasse` [einkaufen/optional] narr=53 deep=4 approaches=0 poly
- `luebeck_parkplatz_rossmann` [service/main] narr=51 deep=4 approaches=0 poly
- `luebeck_kleverschusskreuz` [denkmal/main] narr=48 deep=4 approaches=0 poly
- `luebeck_krankenhaus_rotes_kreuz_lubeck_geriatriezentrum_ambulanz_und_tagesklinik` [gesundheit/optional] narr=107 deep=4 approaches=0 poly
- `luebeck_krankenhaus_rotes_kreuz_lubeck_geriatriezentrum` [gesundheit/optional] narr=82 deep=4 approaches=0 poly
- `luebeck_krankenhaus_rotes_kreuz_lubeck_geriatriezentrum_und_tagespflege_erika_ge` [gesundheit/optional] narr=118 deep=4 approaches=0 poly
- `luebeck_ev_luth_kirchengemeinde_in_st_jurgen_kreuzkirche` [denkmal/main] narr=84 deep=4 approaches=0 poly
- `luebeck_kreuzweise_filmproduktion` [denkmal/main] narr=56 deep=4 approaches=0 poly
- `luebeck_offentliche_toilette` [toilette/main] narr=52 deep=4 approaches=0 poly
- `luebeck_offentliches_wc` [toilette/main] narr=47 deep=4 approaches=0 poly
- `luebeck_offentliche_toilette_schulgarten` [toilette/main] narr=64 deep=4 approaches=0 poly
- `luebeck_stasher_luggage_storage_meierstrasse_open_24_7` [gepaeck/main] narr=81 deep=4 approaches=0 poly
- `luebeck_stasher_luggage_storage_tondernstrasse_open_24_7` [gepaeck/main] narr=83 deep=4 approaches=0 poly
- `luebeck_stasher_luggage_storage_osterweide_open_24_7` [gepaeck/main] narr=79 deep=4 approaches=0 poly
- `luebeck_citybox24_lubeck_lohmuhle` [gepaeck/main] narr=58 deep=4 approaches=0 poly
- `luebeck_wochenmarkt_am_brink` [markt/main] narr=49 deep=4 approaches=0 poly
- `luebeck_wochenmarkt_am_brolingplatz` [markt/main] narr=58 deep=4 approaches=0 poly
- `luebeck_wochenmarkt_hasenweg` [markt/main] narr=49 deep=4 approaches=0 poly
- `luebeck_wochenmarkt_am_hanseplatz` [markt/main] narr=54 deep=4 approaches=0 poly
- `luebeck_mein_wochenmarkt_meesenplatz` [markt/main] narr=59 deep=4 approaches=0 poly
- `luebeck_parkplatz_wochenmarkt_am_brink` [service/main] narr=59 deep=4 approaches=0 poly
- `luebeck_mein_wochenmarkt_bad_schwartau` [markt/main] narr=59 deep=4 approaches=0 poly
- `luebeck_mein_wochenmarkt_schlutup` [markt/main] narr=56 deep=4 approaches=0 poly
- `luebeck_travea_restaurant_lubeck` [restaurant/optional] narr=58 deep=4 approaches=0 poly
- `luebeck_meersalz_lubeck` [restaurant/optional] narr=49 deep=4 approaches=0 poly
- `luebeck_restaurant_lubecker_hanse` [restaurant/optional] narr=59 deep=4 approaches=0 poly
- `luebeck_restaurant_schlumachers` [restaurant/optional] narr=57 deep=4 approaches=0 poly
- `luebeck_unterfreunden` [restaurant/optional] narr=47 deep=4 approaches=0 poly
- `luebeck_fangfrisch_lubeck` [restaurant/optional] narr=51 deep=4 approaches=0 poly
- `luebeck_restaurant_nordlicht` [restaurant/optional] narr=54 deep=4 approaches=0 poly
- `luebeck_kaffeehaus_lubeck` [cafe/optional] narr=45 deep=4 approaches=0 poly
- `luebeck_cafe_union` [cafe/optional] narr=38 deep=4 approaches=0 poly
- `luebeck_cafe_freundlich_vegetarisch_vegan` [cafe/optional] narr=65 deep=4 approaches=0 poly
- `luebeck_cafe_czudaj_lubeck` [cafe/optional] narr=46 deep=4 approaches=0 poly
- `luebeck_cafebar_huxstrasse` [cafe/optional] narr=45 deep=4 approaches=0 poly
- `luebeck_cafe_marae_kaffee_zauberei` [cafe/optional] narr=58 deep=4 approaches=0 poly
- `luebeck_aram_cafe` [cafe/optional] narr=37 deep=4 approaches=0 poly
- `luebeck_pension_amedy` [hotel/optional] narr=42 deep=4 approaches=0 poly
- `luebeck_premier_inn_lubeck_city_centre_hotel` [hotel/optional] narr=65 deep=4 approaches=0 poly
- `luebeck_b_b_hotel_lubeck_berliner_platz` [hotel/optional] narr=60 deep=4 approaches=0 poly
- `luebeck_pension_italia` [hotel/optional] narr=43 deep=4 approaches=0 poly
- `luebeck_b_b_hotel_lubeck_hbf` [hotel/optional] narr=49 deep=4 approaches=0 poly
- `luebeck_premier_inn_lubeck_city_stadtgraben_hotel` [hotel/optional] narr=70 deep=4 approaches=0 poly
- `luebeck_bob_w_lubeck_old_town` [hotel/optional] narr=50 deep=4 approaches=0 poly
- `luebeck_aparthotel_stadtpark_lubeck` [hotel/optional] narr=56 deep=4 approaches=0 poly
- `luebeck_lubecker_dom` [denkmal/main] narr=137 deep=4 approaches=1 poly
- `luebeck_thorweg` [denkmal/main] narr=132 deep=4 approaches=1 poly
- `luebeck_denkmal_lubeck_niendorf` [denkmal/main] narr=148 deep=4 approaches=1 poly
- `luebeck_thomas_mann_stein` [denkmal/main] narr=142 deep=4 approaches=1 poly
- `luebeck_aussichtsplattform_flughafen_lubeck` [aussicht/main] narr=161 deep=4 approaches=1 poly
- `luebeck_burgergarten` [natur/main] narr=135 deep=4 approaches=1 poly
- `luebeck_wesloer_wald_see` [wanderung/main] narr=143 deep=4 approaches=1 poly
- `luebeck_wesloer_wald` [wanderung/main] narr=139 deep=4 approaches=1 poly
- `luebeck_boat_now_lubeck` [tour/main] narr=137 deep=4 approaches=1 poly
- `luebeck_bootsvermietung_hubner` [tour/main] narr=144 deep=4 approaches=1 poly
- `luebeck_stuhff_lubecker_barkassenfahrt` [tour/main] narr=154 deep=4 approaches=1 poly
- `luebeck_city_schiffahrt_h_gabriel` [tour/main] narr=148 deep=4 approaches=1 poly
- `luebeck_k3_stadtfuhrungen_lubeck` [tour/main] narr=146 deep=4 approaches=1 poly
- `luebeck_s_strene_grene` [souvenir/main] narr=140 deep=4 approaches=1 poly
- `luebeck_stadtgeschichte` [geschichte/main] narr=336 deep=1 approaches=0 nopoly

---
Nach dem Report: Datei speichern und `node scripts/cityPack/mergeDeepResearch.mjs --city luebeck --file <report>` ausführen.