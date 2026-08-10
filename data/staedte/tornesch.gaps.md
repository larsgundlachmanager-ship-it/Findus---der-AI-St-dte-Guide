# Findus Deep-Research — Tornesch

Modul-1-Pack-Fokus: stabile Orte, Geschichte, Orientierung, GPS-Eingänge, Wegweiser, Offline-Erzählungen, FAQ.
Nicht ins Pack hardcoden: Preise, Speisekarten-URLs die rotieren, heutige Konzerte, Hotelpreise → `_live_research`.

## Pack-Status
- spots: 128
- categories: activity, altstadt, aussicht, bahnhof, bakerei, cafe, denkmal, freizeit, freizeitpark, gesundheit, golf, hafen, hotel, kirche, markt, museum, natur, restaurant, service, souvenir, spielplatz, sport, supermarket, tankstelle, theater, tour, tourist_info, verwaltung, wanderung, wasser
- missing must-have: ok
- live_research prompts: 4
- transit: no

## Warnings (Top 40)
- tornesch_tornesch: missing general_info / Offline-[Erzählung] (≥20 chars)
- tornesch_stichhafen_des_wsv_uetersen: missing general_info / Offline-[Erzählung] (≥20 chars)
- tornesch_molln_hof: missing general_info / Offline-[Erzählung] (≥20 chars)
- tornesch_ev_kirche_tornesch_ev_luth_kirchengemeinde_tornesch: missing general_info / Offline-[Erzählung] (≥20 chars)
- tornesch_friedenskapelle: missing general_info / Offline-[Erzählung] (≥20 chars)
- tornesch_denkmal_uetersen: missing general_info / Offline-[Erzählung] (≥20 chars)
- tornesch_dampfmuhlen_ruine: missing general_info / Offline-[Erzählung] (≥20 chars)
- tornesch_de_danzenbarg: missing general_info / Offline-[Erzählung] (≥20 chars)
- tornesch_skater_park_tornesch: missing general_info / Offline-[Erzählung] (≥20 chars)
- tornesch_p_r_pendlerparkplatz_tornesch_1: missing general_info / Offline-[Erzählung] (≥20 chars)
- tornesch_hundefreilauf_tornesch: missing general_info / Offline-[Erzählung] (≥20 chars)
- tornesch_esinger_wohld: missing general_info / Offline-[Erzählung] (≥20 chars)
- tornesch_p_r_pendlerparkplatz_tornesch_2: missing general_info / Offline-[Erzählung] (≥20 chars)
- tornesch_kunstlicher_steinhaufen_fur_kleintiere: missing general_info / Offline-[Erzählung] (≥20 chars)
- tornesch_parkplatz_forst_rantzau: missing general_info / Offline-[Erzählung] (≥20 chars)
- tornesch_aussichtsplattform_liether_moor: missing general_info / Offline-[Erzählung] (≥20 chars)
- tornesch_torneum_fussballpark: missing general_info / Offline-[Erzählung] (≥20 chars)
- tornesch_vereinsheim_tus_esingen_e_v: missing general_info / Offline-[Erzählung] (≥20 chars)
- tornesch_naturbad_oberglinde: missing general_info / Offline-[Erzählung] (≥20 chars)
- tornesch_neue_sporthalle_kgst: missing general_info / Offline-[Erzählung] (≥20 chars)
- tornesch_spielplatz_am_luttensee: missing general_info / Offline-[Erzählung] (≥20 chars)
- tornesch_pomm_91_begegnungsstatte_fur_jung_und_alt: missing general_info / Offline-[Erzählung] (≥20 chars)
- tornesch_jurgen_frenzel_schwimmhalle: missing general_info / Offline-[Erzählung] (≥20 chars)
- tornesch_rathaus_tornesch: missing general_info / Offline-[Erzählung] (≥20 chars)
- tornesch_heimathaus_tornesch: missing general_info / Offline-[Erzählung] (≥20 chars)
- tornesch_burg_kino: missing general_info / Offline-[Erzählung] (≥20 chars)
- tornesch_naturlehrpfad_liether_moor: missing general_info / Offline-[Erzählung] (≥20 chars)
- tornesch_geologischer_lehrpfad: missing general_info / Offline-[Erzählung] (≥20 chars)
- tornesch_liether_kalkgrube: missing general_info / Offline-[Erzählung] (≥20 chars)
- tornesch_hexenwald: missing general_info / Offline-[Erzählung] (≥20 chars)
- tornesch_almthof_erlebnisbauernhof_und_hofcafe: missing general_info / Offline-[Erzählung] (≥20 chars)
- tornesch_hanse_stick_and_more: missing general_info / Offline-[Erzählung] (≥20 chars)
- tornesch_wunscherfuller_mit_herz: missing general_info / Offline-[Erzählung] (≥20 chars)
- tornesch_ubuto_uhren_schmuck: missing general_info / Offline-[Erzählung] (≥20 chars)
- tornesch_hgpt_hausarztliche_gesundheitspraxis_tornesch_dr_med_a_hartmaring: missing general_info / Offline-[Erzählung] (≥20 chars)
- tornesch_fasanen_apotheke_25436_tornesch: missing general_info / Offline-[Erzählung] (≥20 chars)
- tornesch_linden_apotheke_25436_tornesch: missing general_info / Offline-[Erzählung] (≥20 chars)
- tornesch_frau_dr_med_petra_gienow: missing general_info / Offline-[Erzählung] (≥20 chars)
- tornesch_dr_med_karin_kowollik_facharztin_fur_allgemeinmedizin: missing general_info / Offline-[Erzählung] (≥20 chars)
- tornesch_tornesch: general_info/Erzählung too short (0<80)

## Google Deep Research — Master Prompt

```
Erstelle einen evidenzbasierten Ortsbericht für Tornesch (Deutschland) für einen Offline-Stadtführer.
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

### Erzählung fehlt (33)
Schreibe für jeden Ort eine Offline-Erzählung (80–200 Wörter), atmosphärisch, ohne Adress-Dump:
- tornesch_tornesch
- tornesch_stichhafen_des_wsv_uetersen
- tornesch_molln_hof
- tornesch_ev_kirche_tornesch_ev_luth_kirchengemeinde_tornesch
- tornesch_friedenskapelle
- tornesch_denkmal_uetersen
- tornesch_dampfmuhlen_ruine
- tornesch_de_danzenbarg
- tornesch_skater_park_tornesch
- tornesch_p_r_pendlerparkplatz_tornesch_1
- tornesch_hundefreilauf_tornesch
- tornesch_esinger_wohld
- tornesch_p_r_pendlerparkplatz_tornesch_2
- tornesch_kunstlicher_steinhaufen_fur_kleintiere
- tornesch_parkplatz_forst_rantzau
- tornesch_aussichtsplattform_liether_moor
- tornesch_torneum_fussballpark
- tornesch_vereinsheim_tus_esingen_e_v
- tornesch_naturbad_oberglinde
- tornesch_neue_sporthalle_kgst
- tornesch_spielplatz_am_luttensee
- tornesch_pomm_91_begegnungsstatte_fur_jung_und_alt
- tornesch_jurgen_frenzel_schwimmhalle
- tornesch_rathaus_tornesch
- tornesch_heimathaus_tornesch
- tornesch_naturlehrpfad_liether_moor
- tornesch_geologischer_lehrpfad
- tornesch_liether_kalkgrube
- tornesch_hexenwald
- tornesch_almthof_erlebnisbauernhof_und_hofcafe
- tornesch_hanse_stick_and_more
- tornesch_wunscherfuller_mit_herz
- tornesch_ubuto_uhren_schmuck

### Deep/FAQ fehlt (33)
Je Ort ≥4 Deep-Fakten + ≥3 FAQ im Format „User-Frage: … Antwort: …“:
- tornesch_tornesch
- tornesch_stichhafen_des_wsv_uetersen
- tornesch_molln_hof
- tornesch_ev_kirche_tornesch_ev_luth_kirchengemeinde_tornesch
- tornesch_friedenskapelle
- tornesch_denkmal_uetersen
- tornesch_dampfmuhlen_ruine
- tornesch_de_danzenbarg
- tornesch_skater_park_tornesch
- tornesch_p_r_pendlerparkplatz_tornesch_1
- tornesch_hundefreilauf_tornesch
- tornesch_esinger_wohld
- tornesch_p_r_pendlerparkplatz_tornesch_2
- tornesch_kunstlicher_steinhaufen_fur_kleintiere
- tornesch_parkplatz_forst_rantzau
- tornesch_aussichtsplattform_liether_moor
- tornesch_torneum_fussballpark
- tornesch_vereinsheim_tus_esingen_e_v
- tornesch_naturbad_oberglinde
- tornesch_neue_sporthalle_kgst
- tornesch_spielplatz_am_luttensee
- tornesch_pomm_91_begegnungsstatte_fur_jung_und_alt
- tornesch_jurgen_frenzel_schwimmhalle
- tornesch_rathaus_tornesch
- tornesch_heimathaus_tornesch
- tornesch_naturlehrpfad_liether_moor
- tornesch_geologischer_lehrpfad
- tornesch_liether_kalkgrube
- tornesch_hexenwald
- tornesch_almthof_erlebnisbauernhof_und_hofcafe
- tornesch_hanse_stick_and_more
- tornesch_wunscherfuller_mit_herz
- tornesch_ubuto_uhren_schmuck

### Coverage-Check (nichts vergessen)
- Gibt es markante Trampelpfade, Promenaden, Aussichtspunkte, die noch fehlen?
- Alle Bahnhöfe/Haltestellen/Fähranleger vollständig?
- Offizieller Ortsplan / Webcam / Tourismus-URL?
- Typische Touren-Typen (nur Typ + wo buchen, keine heutigen Termine)?

## Live-Research Prompts (App, nicht Pack-Hardcode)
- **events**: Was läuft HEUTE und in den nächsten 7 Tagen an Konzerten, Theater, Festen und Touren in Tornesch? Nur belegte Termine mit Datum, Ort, Link.
- **tours**: Welche geführten Touren, Wanderungen, Watt-/Naturführungen oder Ticket-Erlebnisse gibt es aktuell in Tornesch? Links zur Buchung, keine erfundenen Preise.
- **dining**: Aktuelle Speisekarten, Ruhetag und Bewertungen für empfohlene Restaurants/Cafés in Tornesch — Links suchen, keine alten Pack-Preise wiederholen.
- **hotels**: Aktuelle Hotel-/Unterkunftsverfügbarkeit und Preise in Tornesch für das geplante Datum — Live-Suche, keine Pack-Preise.

## Spot-Übersicht (Kurz)
- `tornesch_tornesch` [bahnhof/main] narr=0 deep=1 approaches=2 poly
- `tornesch_stichhafen_des_wsv_uetersen` [hafen/main] narr=0 deep=1 approaches=2 poly
- `tornesch_molln_hof` [museum/main] narr=0 deep=1 approaches=2 poly
- `tornesch_ev_kirche_tornesch_ev_luth_kirchengemeinde_tornesch` [kirche/main] narr=0 deep=1 approaches=2 poly
- `tornesch_friedenskapelle` [kirche/main] narr=0 deep=1 approaches=2 poly
- `tornesch_denkmal_uetersen` [denkmal/main] narr=0 deep=1 approaches=2 poly
- `tornesch_dampfmuhlen_ruine` [denkmal/main] narr=0 deep=1 approaches=2 poly
- `tornesch_de_danzenbarg` [denkmal/main] narr=0 deep=1 approaches=2 poly
- `tornesch_skater_park_tornesch` [natur/main] narr=0 deep=1 approaches=2 poly
- `tornesch_p_r_pendlerparkplatz_tornesch_1` [natur/main] narr=0 deep=1 approaches=2 poly
- `tornesch_hundefreilauf_tornesch` [natur/main] narr=0 deep=1 approaches=2 poly
- `tornesch_esinger_wohld` [natur/main] narr=0 deep=1 approaches=2 poly
- `tornesch_p_r_pendlerparkplatz_tornesch_2` [natur/main] narr=0 deep=1 approaches=2 poly
- `tornesch_kunstlicher_steinhaufen_fur_kleintiere` [natur/main] narr=0 deep=1 approaches=2 poly
- `tornesch_parkplatz_forst_rantzau` [natur/main] narr=0 deep=1 approaches=2 poly
- `tornesch_aussichtsplattform_liether_moor` [aussicht/main] narr=0 deep=1 approaches=2 poly
- `tornesch_torneum_fussballpark` [freizeit/main] narr=0 deep=1 approaches=2 poly
- `tornesch_vereinsheim_tus_esingen_e_v` [freizeit/main] narr=0 deep=1 approaches=2 poly
- `tornesch_naturbad_oberglinde` [freizeit/main] narr=0 deep=1 approaches=2 poly
- `tornesch_neue_sporthalle_kgst` [freizeit/main] narr=0 deep=1 approaches=2 poly
- `tornesch_spielplatz_am_luttensee` [freizeit/main] narr=0 deep=1 approaches=2 poly
- `tornesch_pomm_91_begegnungsstatte_fur_jung_und_alt` [freizeit/main] narr=0 deep=1 approaches=2 poly
- `tornesch_jurgen_frenzel_schwimmhalle` [freizeit/main] narr=0 deep=1 approaches=2 poly
- `tornesch_rathaus_tornesch` [verwaltung/main] narr=0 deep=1 approaches=2 poly
- `tornesch_heimathaus_tornesch` [altstadt/main] narr=0 deep=1 approaches=2 poly
- `tornesch_burg_kino` [theater/optional] narr=0 deep=1 approaches=2 poly
- `tornesch_naturlehrpfad_liether_moor` [wanderung/main] narr=0 deep=1 approaches=2 poly
- `tornesch_geologischer_lehrpfad` [wanderung/main] narr=0 deep=1 approaches=2 poly
- `tornesch_liether_kalkgrube` [wanderung/main] narr=0 deep=1 approaches=2 poly
- `tornesch_hexenwald` [wanderung/main] narr=0 deep=1 approaches=2 poly
- `tornesch_almthof_erlebnisbauernhof_und_hofcafe` [freizeitpark/main] narr=0 deep=1 approaches=2 poly
- `tornesch_hanse_stick_and_more` [souvenir/main] narr=0 deep=1 approaches=2 poly
- `tornesch_wunscherfuller_mit_herz` [souvenir/main] narr=0 deep=1 approaches=2 poly
- `tornesch_ubuto_uhren_schmuck` [souvenir/main] narr=0 deep=1 approaches=2 poly
- `tornesch_hgpt_hausarztliche_gesundheitspraxis_tornesch_dr_med_a_hartmaring` [gesundheit/optional] narr=0 deep=1 approaches=2 poly
- `tornesch_fasanen_apotheke_25436_tornesch` [gesundheit/optional] narr=0 deep=1 approaches=2 poly
- `tornesch_linden_apotheke_25436_tornesch` [gesundheit/optional] narr=0 deep=1 approaches=2 poly
- `tornesch_frau_dr_med_petra_gienow` [gesundheit/optional] narr=0 deep=1 approaches=2 poly
- `tornesch_dr_med_karin_kowollik_facharztin_fur_allgemeinmedizin` [gesundheit/optional] narr=0 deep=1 approaches=2 poly
- `tornesch_lidl` [supermarket/optional] narr=39 deep=4 approaches=0 poly
- `tornesch_aldi_nord` [supermarket/optional] narr=44 deep=4 approaches=0 poly
- `tornesch_lidl_tornesch` [supermarket/optional] narr=48 deep=4 approaches=0 poly
- `tornesch_regio_klinikum_elmshorn` [gesundheit/optional] narr=57 deep=4 approaches=0 poly
- `tornesch_tanzania_hospital` [gesundheit/optional] narr=51 deep=4 approaches=0 poly
- `tornesch_polizei` [service/main] narr=38 deep=4 approaches=0 poly
- `tornesch_spielplatz_zauberflote` [spielplatz/optional] narr=56 deep=4 approaches=0 poly
- `tornesch_spielplatz_rostocker_strasse` [spielplatz/optional] narr=61 deep=4 approaches=0 poly
- `tornesch_spielplatz_schilfweg` [spielplatz/optional] narr=54 deep=4 approaches=0 poly
- `tornesch_spielplatz_forellenring` [spielplatz/optional] narr=57 deep=4 approaches=0 poly
- `tornesch_spielplatz_ortbrookweg_wasserspielplatz` [spielplatz/optional] narr=75 deep=4 approaches=0 poly
- `tornesch_kinderspielplatz_knicktwiete_roter_spielplatz` [spielplatz/optional] narr=81 deep=4 approaches=0 poly
- `tornesch_spielplatz_anne_frank_weg` [spielplatz/optional] narr=59 deep=4 approaches=0 poly
- `tornesch_kinderspielplatz` [spielplatz/optional] narr=50 deep=4 approaches=0 poly
- `tornesch_spielplatz_pastorendamm` [spielplatz/optional] narr=57 deep=4 approaches=0 poly
- `tornesch_golfclub_gut_haseldorf` [golf/optional] narr=50 deep=4 approaches=0 poly
- `tornesch_fairway_golf_peiner_hof` [golf/optional] narr=51 deep=4 approaches=0 poly
- `tornesch_golfpark_weidenhof` [golf/optional] narr=46 deep=4 approaches=0 poly
- `tornesch_golfclub_hamburg_holm` [golf/optional] narr=49 deep=4 approaches=0 poly
- `tornesch_golfplatz` [golf/optional] narr=37 deep=4 approaches=0 poly
- `tornesch_kletterwald_kletterpark_hochseilgarten_heist` [activity/optional] narr=78 deep=4 approaches=0 poly
- `tornesch_forst_rantzau_west` [natur/main] narr=47 deep=4 approaches=0 poly
- `tornesch_liether_kalkgrube_parkplatz` [service/main] narr=57 deep=4 approaches=0 poly
- `tornesch_parkplatz_arboretum_kostenlos` [service/main] narr=58 deep=4 approaches=0 poly
- `tornesch_regenruckhaltebecken_orthbrooksgraben` [natur/main] narr=66 deep=4 approaches=0 poly
- `tornesch_tennisclub_tornesch` [sport/optional] narr=48 deep=4 approaches=0 poly
- `tornesch_petanquebahn_tornesch` [sport/optional] narr=50 deep=4 approaches=0 poly
- `tornesch_badepark_elmshorn` [freizeit/main] narr=49 deep=4 approaches=0 poly
- `tornesch_wasserbeschaffungsverband_haseldorfer_marsch` [wasser/optional] narr=74 deep=4 approaches=0 poly
- `tornesch_holsteiner_wasser_gmbh` [wasser/optional] narr=52 deep=4 approaches=0 poly
- `tornesch_shell` [tankstelle/optional] narr=39 deep=4 approaches=0 poly
- `tornesch_autohof_aral_tornesch` [tankstelle/optional] narr=55 deep=4 approaches=0 poly
- `tornesch_backerei_und_cafe_veloso_tornesch` [bakerei/main] narr=61 deep=4 approaches=0 poly
- `tornesch_backerei_eggers` [bakerei/main] narr=43 deep=4 approaches=0 poly
- `tornesch_backerei_allworden` [bakerei/main] narr=46 deep=4 approaches=0 poly
- `tornesch_reiseburo_sentek_gmbh` [tourist_info/main] narr=57 deep=4 approaches=0 poly
- `tornesch_luttensee` [tourist_info/main] narr=45 deep=4 approaches=0 poly
- `tornesch_hof_meyer_tornesch` [tourist_info/main] narr=54 deep=4 approaches=0 poly
- `tornesch_schlusseldienst_tornesch_gravur_u_sicherheitstechnik_holtig` [tourist_info/main] narr=97 deep=4 approaches=0 poly
- `tornesch_vr_bank_in_holstein_eg_geschaftsstelle` [tourist_info/main] narr=76 deep=4 approaches=0 poly
- `tornesch_wochenmarkt_uetersen` [markt/main] narr=49 deep=4 approaches=0 poly
- `tornesch_wochenmarkt_elmshorn_auf_dem_buttermarkt` [markt/main] narr=69 deep=4 approaches=0 poly
- `tornesch_meine_frischekiste` [markt/main] narr=47 deep=4 approaches=0 poly
- `tornesch_wochenmarkt_pinneberg` [markt/main] narr=50 deep=4 approaches=0 poly
- `tornesch_makhan_restaurant` [restaurant/optional] narr=51 deep=4 approaches=0 poly
- `tornesch_restaurant_himara` [restaurant/optional] narr=51 deep=4 approaches=0 poly
- `tornesch_der_hollander_tornesch` [restaurant/optional] narr=58 deep=4 approaches=0 poly
- `tornesch_gaststatte_birkenhain` [restaurant/optional] narr=55 deep=4 approaches=0 poly
- `tornesch_restaurant_corfu` [restaurant/optional] narr=50 deep=4 approaches=0 poly
- `tornesch_mamma_mia` [restaurant/optional] narr=43 deep=4 approaches=0 poly
- `tornesch_asiahub` [restaurant/optional] narr=41 deep=4 approaches=0 poly
- `tornesch_neuendeich` [restaurant/optional] narr=44 deep=4 approaches=0 poly
- `tornesch_cafe_kleiner_friedrich` [cafe/optional] narr=56 deep=4 approaches=0 poly
- `tornesch_restaurant_ydrama` [restaurant/optional] narr=51 deep=4 approaches=0 poly
- `tornesch_kaffeerosterei_moin_bohne` [cafe/optional] narr=53 deep=4 approaches=0 poly
- `tornesch_rosenhof_kruse` [cafe/optional] narr=42 deep=4 approaches=0 poly
- `tornesch_cafe_langes_muhle` [cafe/optional] narr=45 deep=4 approaches=0 poly
- `tornesch_die_eisdiele` [cafe/optional] narr=40 deep=4 approaches=0 poly
- `tornesch_c_und_s_hotel` [hotel/optional] narr=42 deep=4 approaches=0 poly
- `tornesch_hotel_esinger_hof_by_alesta` [hotel/optional] narr=56 deep=4 approaches=0 poly
- `tornesch_schleswig_holstein_hotel` [hotel/optional] narr=53 deep=4 approaches=0 poly
- `tornesch_hotel_und_gasthof_heidekrug` [restaurant/optional] narr=56 deep=4 approaches=0 poly
- `tornesch_pension_akropolis` [hotel/optional] narr=46 deep=4 approaches=0 poly
- `tornesch_bett_4_you` [hotel/optional] narr=39 deep=4 approaches=0 poly
- `tornesch_myky_hotel_pinneberg` [hotel/optional] narr=49 deep=4 approaches=0 poly
- `tornesch_die_wohnlichen_gastezimmer` [hotel/optional] narr=55 deep=4 approaches=0 poly
- `tornesch_signature_hotel_skarv` [hotel/optional] narr=50 deep=4 approaches=0 poly
- `tornesch_hotel_maximo` [hotel/optional] narr=41 deep=4 approaches=0 poly
- `tornesch_hotel_dias` [hotel/optional] narr=39 deep=4 approaches=0 poly
- `tornesch_kustengarten_und_wasserwald` [denkmal/main] narr=154 deep=4 approaches=1 poly
- `tornesch_chinesischer_garten_ellerhoop` [denkmal/main] narr=156 deep=4 approaches=1 poly
- `tornesch_garten_des_sudens_arboretum_ellerhoop` [denkmal/main] narr=166 deep=4 approaches=1 poly
- `tornesch_denkmal_opfer_der_nationalsozialisten` [denkmal/main] narr=164 deep=4 approaches=1 poly
- `tornesch_atelier_wanda_stehr` [museum/main] narr=145 deep=4 approaches=1 poly
- `tornesch_gemeinschaft_zur_erhaltung_von_kulturgut_in_tornesch_von_1985_e_v` [museum/main] narr=192 deep=4 approaches=1 poly
- `tornesch_eisenbahnfreunde_uetersen_tornesch_e_v` [museum/main] narr=166 deep=4 approaches=1 poly
- `tornesch_sagewerk_tornesch` [museum/main] narr=143 deep=4 approaches=1 poly
- `tornesch_norddeutsche_gartenschau` [natur/main] narr=149 deep=4 approaches=1 poly
- `tornesch_weisser_garten_arboretum_ellerhoop` [natur/main] narr=158 deep=4 approaches=1 poly
- `tornesch_stadttheater_elmshorn` [theater/optional] narr=148 deep=4 approaches=1 poly
- `tornesch_stadt_land_camp_wow_mobile` [tour/main] narr=153 deep=4 approaches=1 poly
- `tornesch_ponyhof_esingen` [tour/main] narr=139 deep=4 approaches=1 poly
- `tornesch_alexander_u_jutta_ramin` [tour/main] narr=148 deep=4 approaches=1 poly
- `tornesch_fahrradhaus_schawo` [tour/main] narr=142 deep=4 approaches=1 poly
- `tornesch_hyggetogo` [souvenir/main] narr=137 deep=4 approaches=1 poly
- `tornesch_meer_liebe_lola` [souvenir/main] narr=143 deep=4 approaches=1 poly
- `tornesch_anderungsschneiderei_ustundag` [souvenir/main] narr=157 deep=4 approaches=1 poly
- `tornesch_kindergeburtstag_mit_schmuck_basteln_bei_euch_zu_hause_kreative_diy_par` [souvenir/main] narr=229 deep=4 approaches=1 poly
- `tornesch_prima_online_haushaltsgerate_tornesch` [souvenir/main] narr=165 deep=4 approaches=1 poly

---
Nach dem Report: Datei speichern und `node scripts/cityPack/mergeDeepResearch.mjs --city tornesch --file <report>` ausführen.