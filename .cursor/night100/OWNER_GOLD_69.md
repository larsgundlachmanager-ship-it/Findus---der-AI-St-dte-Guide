# Owner-Gold — 69 Blaupausen

Anzahl: **69** — davon **13** Legacy ohne `situationKey`.

Quelle: `src/module2/blueprints/ownerGold.pack.json`

## activity_poi (4)

### 15. `Picknick outdoor` _(legacy)_

Picknick outdoor: Park/Wiese/See/Grillplatz plus Wetter; Tap startet Nav, keine Heritage-Tour. Unverbindlich fragen, ob noch Einkauf für unterwegs.

**Expect:** `concrete_place`, `route_button`, `alternatives`, `answer_first`

**Avoid:** `long_history`, `address_unless_asked`

### 19. `activity_poi::interest_activity_expand_v1`

Lust auf Thema (z. B. Dinosaurier): Pitch Top-2. Pack lokal zuerst; wenn leer Umkreis erweitern (50–100 km). Distanz, Preis/Ticket, Anreise. Outdoor/Kleidung/Wetter nur wenn’s passt und heute noch nicht gesagt — nie erzwingen. Follow-up gleiches Thema vertiefen.

**Expect:** `concrete_place`, `alternatives`, `answer_first`, `route_button`, `tickets`

**Avoid:** `vague_filler`, `permission_questions`, `long_history`

### 36. `activity::rental_evidence_needs_v1`

Verleih/Aktivität (SUP, Surf, Rad, …): zwei Optionen wenn möglich, Preise nur von Website belegt, Website-/Preis-Button, Route. Gleiche Blaupause für jedes Verleih-Thema — kein Sport-Hardcode.

**Expect:** `concrete_place`, `alternatives`, `prices`, `website`, `route_button`, `answer_first`

**Avoid:** `vague_filler`, `permission_questions`, `fake_promises`

### 59. `activity_poi::water_body_activity_followup_v1`

Follow-up zu genanntem Gewässer (Größe→SUP): Answer-first ja/nein + wo auf dem Wasser. Optional 1–2 echte Verleihe mit Preisen/Links am selben Gewässer — nie lokale Gastro/Heimatverein als Ersatz.

**Expect:** `answer_first`, `concrete_place`, `prices`, `website`, `route_button`

**Avoid:** `vague_filler`, `permission_questions`, `new_pitch`

## dining (14)

### 3. `dining::pitch_reject_followup_v1`

Ablehnung einer Pitch-Option (mag ich nicht / kein X / was noch): gleicher Suchkontext, andere Orte ohne Abgelehntes. Call-2 nur diesen Faden, kein totes Trivia.

**Expect:** `alternatives`, `answer_first`, `concrete_place`, `route_button`

**Avoid:** `vague_filler`, `permission_questions`, `long_history`

### 4. `dining::compound_sunset_view_v1`

Compound-Abend (Gericht + Sonnenuntergang/Blick): neues Thema ohne alten Chat. Backend Top-5 nach Kriterien (Gericht, Blick, Offen, Budget, Diät, Timeline), Speak Top-2. Call 2 pitcht Warum; nach Wahl jetzt=Nav oder später=Timeline+Leave-by.

**Expect:** `concrete_place`, `alternatives`, `answer_first`, `route_button`, `menu`

**Avoid:** `vague_filler`, `permission_questions`, `long_history`, `address_unless_asked`

### 5. `Essenswunsch (auch morgen in anderer Stadt)` _(legacy)_

Essenswunsch (auch morgen in anderer Stadt): Bridge zusagen, dann Pitch mit zwei passenden Orten. Totes Trivia nicht mischen. Kein Tagesplan-Popup, kein Pack-Zwang.

**Expect:** `concrete_place`, `alternatives`, `answer_first`, `route_button`

**Avoid:** `vague_filler`, `permission_questions`, `long_history`

### 6. `Gastro inkl. Frühstück, Café, Bar, Snack, Gericht` _(legacy)_

Gastro inkl. Frühstück, Café, Bar, Snack, Gericht: genannter Ort = genau der, auch außerhalb GPS; sonst Nähe. Preise, Speisekarte als Deep-Link (nicht Homepage). Zweite Option hinten. Route.

**Expect:** `prices`, `menu`, `concrete_place`, `alternatives`, `answer_first`, `route_button`

**Avoid:** `vague_filler`, `fake_promises`, `address_unless_asked`, `long_history`, `hours_unless_tight`, `opposite_diet`

### 35. `dining::dish_two_options_price_menu_v1`

Gericht-Wunsch (Pizza/Rucola/Steak): zwei echte unterschiedliche Orte (nie Duplikat, nie Pension/Hotel ohne Gastro). Speech überzeugt kurz mit Distanz + Gericht + Preis wenn belegt. Stichpunkte = Distanz, Gericht/Preis, ein Review-Hook (Steinofen/Portion) — nie nur Ambiente/frische Gerichte. Buttons: Route + Speisekarte/Website je Option.

**Expect:** `concrete_place`, `alternatives`, `answer_first`, `route_button`, `menu`

**Avoid:** `vague_filler`, `permission_questions`, `long_history`, `fake_promises`

### 37. `dining::evidence_needs_generic_v1`

Genanntes Gericht/Produkt (egal welches): zwei echte Orte, Review-Beleg zum Item wenn vorhanden, Preis nur belegt, Speisekarte-Button (Deeplink wenn möglich). Kein neues Hardcode pro Gericht — gleiche Blaupause für jedes Item.

**Expect:** `concrete_place`, `alternatives`, `answer_first`, `menu`, `prices`, `route_button`

**Avoid:** `vague_filler`, `permission_questions`, `fake_promises`, `long_history`

### 38. `dining::ayce_cuisine_hard_filter_v1`

All-you-can-eat: Hard-Filter — nur Orte mit belegtem AYCE/Buffet-Flatrate (Reviews/Website/Name), offen am genannten Abend, Nähe zuerst. Soft-Fill mit Café/Rösterei/normalem Restaurant verboten. Leer → ehrlich + Umkreis (Nachbarorte) nochmal suchen, nie Goldschätzchen unterschieben. Speisekarte als Button wenn belegt.

**Expect:** `alternatives`, `answer_first`, `concrete_place`, `menu`

**Avoid:** `permission_questions`, `vague_filler`, `fake_promises`, `opposite_diet`

### 39. `dining::vegan_must_honest_v1`

Vegan/Veggie/Kein-Fleisch: Must-Filter — nur Orte mit belegter veganer Küche oder klarer veganer Option (Reviews/Tags/Name). Nie Steakhouse/Biergarten/Allround ohne Vegan-Beleg (z. B. Goldschätzchen) als Ersatz. Leer → ehrlich + weiter suchen, nicht einzelnen Irrelevant-Treffer pitchen.

**Expect:** `answer_first`, `alternatives`, `concrete_place`, `honest_empty`, `vegan_evidence`

**Avoid:** `soft_fill_generic`, `steakhouse`, `opposite_diet`, `biergarten_fill`, `permission_questions`

### 40. `dining::schedule_ask_when_v1`

Nach Gastro-Wahl „Einplanen“: kurze Wann-Frage + Uhr-Chips. Mit Uhr → Stopp + Anreise-Leg in Timeline; bei Los >10 Min Timeline kurz öffnen. Kein „schon eingetragen“ ohne Zeit.

**Expect:** `answer_first`, `casual_tone`, `just_do_it`

**Avoid:** `permission_questions`, `vague_filler`

### 43. `dining::cuisine_tonight_authentic_v1`

Cuisine + heute Abend + Atmosphäre (authentisch/heimisch): Call 1 zieht Küche/Zeit/Stadt/Vibe; Backend sucht Pack+Places; Vibe nur Soft. Leer → Retry (breitere Query, Vibe lockern). Mindestens 1–2 Optionen oder ehrlich nach Retry — nie sofort „kein Treffer“, nie Nightlife-Ersatz.

**Expect:** `concrete_place`, `alternatives`, `answer_first`, `route_button`, `menu`

**Avoid:** `vague_filler`, `permission_questions`, `fake_promises`, `address_unless_asked`, `opposite_diet`

### 44. `Gericht-Wunsch (Steak, Angus, Döner, …)` _(legacy)_

Gericht-Wunsch (Steak, Angus, Döner, …): Must-Filter in der Fact-Lane. Soft-Fail nur in derselben Familie. Nie Steak durch Döner/Pizza ersetzen; ehrlich wenn kein Beleg.

**Expect:** `concrete_place`, `alternatives`, `answer_first`, `menu`

**Avoid:** `vague_filler`, `permission_questions`, `opposite_diet`, `fake_promises`

### 45. `dining::post_choice_step_v1`

Nach Gastro-Wahl: Timing jetzt vs. Abend. Jetzt → Nav/ÖPNV. Abend → Timeline + Tisch-Link. Stichpunkte = Vibe/Specialty/Preis, keine Kategorie-Labels. Speisekarte = echte Karte-URL.

**Expect:** `answer_first`, `concrete_place`, `route_button`, `booking_url`, `menu`, `prices`

**Avoid:** `permission_questions`, `vague_filler`, `long_history`, `new_pitch`

### 46. `dining::reserve_sticky_venue_v1`

Tisch reservieren nach Wahl: gleiches Venue, Reservierungs-URL — kein neuer Pitch, keine fremden Orte, keine zweite Dual-Option.

**Expect:** `booking_url`, `answer_first`, `concrete_place`

**Avoid:** `permission_questions`, `vague_filler`, `new_pitch`

### 67. `dining::ambiance_view_terrace_v1`

Restaurant mit Aussicht/Ambiente/Flair/Terrasse: zwei echte Orte mit belegtem Outdoor-/Blick-Signal wenn möglich; Atmosphäre als Boost nicht als leerer Hard-Wipe. Route + Speisekarte.

**Expect:** `concrete_place`, `alternatives`, `answer_first`, `route_button`, `menu`

**Avoid:** `vague_filler`, `permission_questions`, `fake_promises`

## events (7)

### 47. `events::cinema_program_first_v1`

Kino ohne Film: 2 Kinos mit Charakter (nicht Distanz-Junk). Nach Kino-Wahl: Laden + heutiges Programm/Preise; Show-Ticket-Deep-Link. Filmwahl → passende Vorstellung + Buchungs-URL.

**Expect:** `concrete_place`, `alternatives`, `answer_first`, `tickets`, `times_hours`, `prices`

**Avoid:** `permission_questions`, `vague_filler`, `address_unless_asked`, `new_pitch`

### 48. `events::cinema_after_venue_choice_v1`

Nach Kino-Tap: sofort Programm briefen (heute, sonst morgen/Website). Ticket = Show-Deep-Link wenn belegt. Fakten, kein Re-Pitch und kein Gastro-Drift.

**Expect:** `answer_first`, `concrete_place`, `times_hours`, `prices`, `tickets`, `website`

**Avoid:** `permission_questions`, `vague_filler`, `new_pitch`, `nav_auto_start`

### 49. `events::sports_schedule_tickets_v1`

Nächstes Spiel: 1–2 Sätze (Datum, Uhr, Gegner, genannte Halle hard-match). Kein Zahlen-Stakkato. Stichpunkte kurz lesbar. Partner-Ticket wenn belegt, sonst Venue/Club — kein toter Ticketmaster-Link.

**Expect:** `answer_first`, `concrete_place`, `tickets`, `times_hours`, `prices`, `booking_url`, `website`

**Avoid:** `permission_questions`, `vague_filler`, `meta_app_pitch`, `fake_promises`, `nav_auto_start`

### 52. `events::nearby_festival_clear_open_v1`

Nahes Fest: Call-1 nur Verstanden+Zusagen. Call-2 zuerst Name+Ort+Startuhr klar, dann Details. Programm-Button = echte Fest-Seite wenn belegt; Route tippbar sobald gesprochen. Kein Meta „Infos/Navigation liegen bereit“.

**Expect:** `answer_first`, `concrete_place`, `route_button`, `official_program_url`

**Avoid:** `button_meta_speech`, `motivation_lead_before_fact`, `google_search_as_infos`, `permission_questions`, `address_unless_asked`

### 53. `Abendprogramm` _(legacy)_

Abendprogramm: zwei echte laufende Optionen (Kino, Konzert, Markt, Open Air, Club) mit Uhrzeit und Route; nichts vorschlagen, was schon vorbei ist; keine Essensfrage nach 19 Uhr; kein Button-Meta in der Speech.

**Expect:** `concrete_place`, `alternatives`, `answer_first`, `route_button`

**Avoid:** `permission_questions`, `vague_filler`, `address_unless_asked`, `button_meta_speech`

### 54. `events::date_window_empty_things_to_do_v1`

Frage-Art: was VOR ORT/im Fenster möglich/los ist (nicht die Reise buchen) → execution=events_research. Call 1 erkennt Absicht selbst. Zuerst Events im Fenster; leer → ehrlich + 2–3 lohnende Orte in/um die Stadt. Nie Reisebüro nur wegen Datum+Stadt.

**Expect:** `concrete_place`, `alternatives`, `answer_first`, `route_button`

**Avoid:** `permission_questions`, `vague_filler`, `address_unless_asked`, `fake_festival`

### 66. `events::theater_program_first_v1`

Theaterstücke/Vorstellungen heute oder die Tage: echte Theater/Spielpläne (nicht Kino), 1–2 Häuser mit Stück/Uhr wenn belegt, Programm/Ticket/Route-Buttons. Kein toter Flug-Thread.

**Expect:** `concrete_place`, `alternatives`, `answer_first`, `tickets`, `times_hours`

**Avoid:** `permission_questions`, `vague_filler`, `new_pitch`, `address_unless_asked`

## general (12)

### 1. `general::bridge_understood_commit_v1`

Bridge (Call 1): Nur DIESE User-Nachricht — Wunsch verstanden + Zusage. Ausnahme: fehlender Blocker-Slot (ohne den Aktion sinnlos) → kurze Gegenfrage, bridgeComplete, keine Recherche-Zusage. Nie Meta-Warte. Neues Thema = frische Bridge. Kontext/Thread darf Slots füllen. Kurz 1–2 Sätze. Keine Venue-Namen/Preise/Minuten. Call 2 hängt flüssig an — außer bridgeComplete.

**Expect:** `answer_first`, `casual_tone`

**Avoid:** `vague_filler`, `permission_questions`

### 2. `general::missing_blocker_slot_clarify_v1`

Aktion/Recherche ohne Pflicht-Slot sinnlos (Flug ohne Uhr, Taxi buchen ohne Ziel, …): Call-1 Bridge = eine gezielte Klärfrage, bridgeComplete=true, work leer. Zuerst Slot aus offenem Thread/Kontext herleiten — nur nachfragen wenn wirklich kein Anker. session=continue. Wortlaut frei.

**Expect:** `answer_first`, `casual_tone`

**Avoid:** `vague_filler`, `permission_questions`, `fake_research_ack`

### 8. `general::weather_night_sky_woven_outfit_v1`

Wetter locker und menschlich in der Speech: Himmel + Temp/Höchst + Regen-Timing in 1–3 kurzen VOLLEN Sätzen, optional Kleidung eingewebt. Stichpunkte = FACT-CHIPS (z. B. „Wechselhaft · bis 24°“, „Heute kein Regen“) — nie Prosa-Sätze kopieren. Nie Telegramm in der Stimme. Nie Navigation aus Wetterfrage. Nie „keine Live-Daten“ / Aushang. Timeline nur wenn Plan wetterrelevant.

**Expect:** `answer_first`, `sky_conditions`, `temp_range`, `rain_timing`, `clothing_tip`, `casual_tone`, `woven_clothing`

**Avoid:** `vague_filler`, `address_unless_asked`, `permission_questions`, `station_board_fallback`, `aushang`, `invent_storm`, `dry_list`, `sun_as_day_at_night`, `parenthetical_aside`

### 9. `general::outfit_woven_prose_v1`

Outfit/Anziehen: konkrete Kleidung zuerst aus belegtem Wetter+Plan, in kurzen vollständigen Sätzen weben — keine (…)-Klammern/Meta, kein Telegramm. Stichpunkte = 1–3 vollständige Sätze (Jacke/Schicht), nie mitten im Satz abbrechen. Kein Touren-Button, kein Sightseeing-Pitch.

**Expect:** `answer_first`, `clothing_tip`, `casual_tone`, `woven_clothing`

**Avoid:** `vague_filler`, `permission_questions`, `dry_list`, `parenthetical_aside`, `tour_button`, `truncated_bullets`

### 10. `Reisepass verloren / Konsulat` _(legacy)_

Reisepass verloren / Konsulat: nächste zuständige Auslandsvertretung oder Bürgeramt-Schritt, Route/Anruf. Nie Heimatverein/Dorfmuseum als Treffer.

**Expect:** `concrete_place`, `answer_first`, `route_button`

**Avoid:** `vague_filler`, `permission_questions`

### 12. `Faktenfrage` _(legacy)_

Faktenfrage: Call-1 = nur Antwort-Einleitung (Person/Aufgabe ansteuern) — NIE Zahl/Alter/Name. Call-2 hängt nahtlos den Fakt in 1–2 Sätzen an. Stichpunkte eine klare Ziffer — keine Tausender-Splits. Kein Essay, keine ungefragte Tour. Isolation bei neuem Thema.

**Expect:** `answer_first`, `casual_tone`, `lookup_button`

**Avoid:** `siezen`, `permission_questions`, `vague_more_button`, `stage_directions`, `dead_thread_weave`

### 50. `general::weather_not_help_v1`

Wetterfrage: belegter Ausblick (Himmel/Temp/Regen) flüssig in Speech + kurze Kleidung. Stichpunkte = FACT-CHIPS (kompakt, max ~2 Zeilen), nie Fließtext. Nie Hilfe-Katalog, nie leeres „keine Live-Daten“, nie Abendplan/Sunset-Queue, nie Navigation starten. Call-1 = kurze Wetter-Zusage ohne Gradzahlen.

**Expect:** `answer_first`, `clothing_tip`, `temp_range`, `rain_timing`

**Avoid:** `vague_filler`, `meta_app_pitch`, `permission_questions`

### 51. `general::weather_rain_focus_v1`

Regen-Frage: Call-1 kurze Regen-Zusage („schau kurz den Regen an“). Call-2 zuerst nur Regen (ja/nein + Timing), optional Temp als 2. Stichpunkt. Titel = Regen. Stichpunkte FACT-CHIPS. Kein Outfit-Essay, keine Navigation.

**Expect:** `answer_first`, `rain_timing`

**Avoid:** `vague_filler`, `meta_app_pitch`, `permission_questions`, `nav_auto_start`

### 60. `general::remote_research_no_city_switch_v1`

Remote-Recherche (Hotel/Flug andere Stadt): Home-/Selected-Stadt unverändert. Kein Soft-City-Switch/Popup nur wegen Recherche. City-Picker nach Checkmark+Ladebalken nicht zurücksetzen.

**Expect:** `answer_first`

**Avoid:** `permission_questions`, `vague_filler`, `meta_app_pitch`

### 62. `general::live_hud_concrete_pitch_v1`

Live-Anzeige oben: konkrete Orte mit Distanz/Minuten, Uhr, Preis/ETA nur belegt — nie Gattungs-Fragen („Pause/Park?“, „Foto-Spot?“, „Hochhäuser“). Erholung = menschlicher Opener + Parkname + Gehzeit nur wenn Treffer in der Nähe; Fotospot = Einladung zum Hingucken + Name + Distanz, sonst stumm. Tap = Vertiefung/Route.

**Expect:** `concrete_place`, `answer_first`, `route_button`, `times_hours`

**Avoid:** `vague_filler`, `permission_questions`, `meta_app_pitch`

### 63. `general::wake_alarm_confirm_v1`

Wecker mit klarer Uhrzeit: sofort Native/Clock stellen. Bestätigung max. 1–2 Sätze; ein Stichpunkt; Titel Wecker. Kein Reminder-Button, kein Zweitbutton, kein Wetter-Offer, keine Dreifach-Wiederholung.

**Expect:** `answer_first`, `casual_tone`

**Avoid:** `long_history`, `vague_filler`, `permission_questions`, `meta_app_pitch`

### 68. `general::pack_item_reminder_v1`

Mitnehmen/Pack-Item erinnern (Zahnbürste o. ä.): echte Erinnerung/Todo setzen (SET reminder), Item nennen — kein Wecker, keine Uhrzeit erzwingen wenn Item klar ist.

**Expect:** `answer_first`, `casual_tone`

**Avoid:** `permission_questions`, `vague_filler`

## knowledge (8)

### 13. `knowledge::compact_stat_v1`

Statistik-Kurzfrage (Einwohner, Fläche, Höhe): Call-1 Bridge nur Ort/Thema aus DIESEM User-Satz ansteuern — keine Zahl, nie GPS-/Heimatstadt unterschieben. Call-2 = eine klare Zahl (ca. gerundet ok). Stichpunkte dieselbe Zahl — deutsche Tausender nie splitten. Keine ungefragte Zusatzfläche/Tour. Kein Sight-Pitch.

**Expect:** `answer_first`

**Avoid:** `vague_filler`, `long_history`, `permission_questions`

### 14. `knowledge::arith_short_v1`

Einfache Rechnung: Call-1 leitet die Antwort ein (Aufgabe ansteuern, z. B. erster Teilsatz), Call-2 = nur die Ergebniszahl in einem knappen Satz — kein Theater. Stichpunkt = Rechnung + Ergebnis.

**Expect:** `answer_first`

**Avoid:** `vague_filler`, `long_history`

### 31. `knowledge::topic_cut_isolation_v1`

Beantwortetes Trivia ist tot, sobald ein neues Thema (Flug, Nav, Plan) kommt — nicht in Bridge oder Stichpunkte weiterschicken.

**Expect:** `answer_first`

**Avoid:** `vague_filler`, `long_history`

### 32. `knowledge::person_age_trivia_v1`

Personen-Alter / Wie-heißt Amtstitel: Call-1 = nur Einleitung (Amt/Person ansteuern), NIE Alter/Zahl/Name, nie „wen meinst du?“, nie Recherche-Theater. Call-2 = Antwort zuerst in 1–2 flüssigen Sätzen (+ optional 1 Fun-Fact). 3 kurze Stichpunkte nur aus Call-2 — kein Sticky-Falschalter aus Call-1. Titel = Person/Amt, nie Wetter/GPS. Kein Pitch.

**Expect:** `answer_first`

**Avoid:** `vague_filler`, `permission_questions`, `long_history`, `fake_promises`

### 33. `knowledge::who_is_fact_card_v1`

Wer-/Wie-heißt-Frage (Amt/Titel/Person): Call-1 = Einleitung ohne Name-Fakt, nie „wen meinst du?“. Karten-Titel = Thema aus der Frage (nie Wetter/GPS). Speech Call-2: 1–2 flüssige Sätze, Antwort zuerst. Genau 3 kurze Stichpunkte aus Call-2: Name/Kern zuerst — vollständige Zeilen, kein Call-1-Leak. Kein Pitch.

**Expect:** `answer_first`

**Avoid:** `vague_filler`, `permission_questions`, `long_history`, `fake_promises`

### 34. `knowledge::named_place_fact_or_activity_v1`

Fakt oder Aktivität zu einem genannten Ort (Park, Garten, Museum): Call-1 würdigt die Frage kurz und sagt Recherche zu — kein Nearby-Auswahl-Pitch. Call-2 beantwortet die konkrete Frage (Zahl, was man dort machen kann) mit Stichpunkten; Ort aus Thread behalten bei Follow-ups („was kann man da machen?“). Keine Fake-Treffer-Phrase, keine zweite Venue-Suche als Ersatz.

**Expect:** `answer_first`, `concrete_place`

**Avoid:** `vague_filler`, `permission_questions`, `long_history`, `fake_promises`

### 41. `knowledge::sunrise_sunset_clock_v1`

Sonnenaufgang/-untergang: Call-2 nur Ort + Uhrzeit (1 Satz). Kein Firmament-Essay, kein Extra-Offer.

**Expect:** `answer_first`

**Avoid:** `vague_filler`, `long_history`, `permission_questions`

### 42. `knowledge::named_product_offer_nearby_v1`

Genanntes Produkt im Angebot (auch „irgendwo“): GPS-nahe Märkte, Prospekt filtern, belegte Preise. Button = Produkt-/Flyer-Deep-Link inkl. Preis — nie Ketten-Home, nie Reisebüro. Produkt-agnostisch.

**Expect:** `prices`, `website`, `answer_first`, `concrete_place`, `route_button`

**Avoid:** `permission_questions`, `vague_filler`, `fake_promises`, `address_unless_asked`

## mobility (2)

### 30. `mobility::taxi_missing_destination_clarify_v1`

Taxi/Uber buchen ohne Ziel: zuerst Ziel aus offenem Thread (Kino, Flughafen, Ort) ziehen. Fehlt jeder Anker → Call-1 Bridge = kurze Wohin-Frage, bridgeComplete, keine Buchungs-Recherche. Personenanzahl allein reicht nicht. Wortlaut frei.

**Expect:** `answer_first`, `casual_tone`

**Avoid:** `vague_filler`, `permission_questions`, `fake_research_ack`

### 65. `mobility::taxi_schedule_prebook_v1`

Taxi/Uber vorbestellen mit bekannter Zukunftszeit (Leave-by/morgen): Zusagen, Zeit nennen, Uber-Reserve-/Schedule-Deep-Link mit Datetime — nie Sofort-Fahrt „now“. Optional Taxi-Anruf.

**Expect:** `answer_first`, `website`, `times_hours`, `casual_tone`

**Avoid:** `permission_questions`, `vague_filler`

## navigation (6)

### 7. `Taxi und Flughafentransfer` _(legacy)_

Taxi und Flughafentransfer: Ziel aus Route oder Flughafen; Partnerlink Pickup+Dropoff zuerst, lokale Nummer optional; ÖPNV beenden; Fahrtdauer nennen.

**Expect:** `concrete_place`, `booking_url`

**Avoid:** `vague_filler`, `permission_questions`

### 11. `„Zum Hauptbahnhof“ ohne Ortsname` _(legacy)_

„Zum Hauptbahnhof“ ohne Ortsname: großer Hbf der Region (z. B. Hamburg Hbf), nicht der Dorf-Bahnhof am GPS. Schnell + Route starten.

**Expect:** `concrete_place`, `route_button`, `answer_first`

**Avoid:** `vague_filler`

### 55. `navigation::on_route_zwischenstopp_top2_v1`

Zwischenstopp vage (Eis/Pause): Call-1 Bridge zuerst, dann Top-2 mit Umweg-Minuten. Nie Option-UI vor Bridge. Nach Wahl Stopp einfügen — Originalziel bleibt.

**Expect:** `alternatives`, `answer_first`, `concrete_place`, `route_button`

**Avoid:** `nav_auto_start`, `permission_questions`, `vague_filler`

### 56. `navigation::on_route_named_insert_v1`

Zwischenstopp mit klarem Ort: Bridge verstanden → Stopp/Route dorthin, kein Dual-Pitch fremder Läden. Danach Originalziel fortsetzen/hinzufügen — nie nur Historie ohne Nav.

**Expect:** `concrete_place`, `answer_first`, `route_button`

**Avoid:** `permission_questions`, `vague_filler`, `alternatives`

### 57. `navigation::bridge_before_route_v1`

Nav-Start: nach Geocode sofort Call-1 Bridge (Alles klar / navigiere dich) mit ZielNAME — keine Straße/PLZ. ETA in Speech = Live-HUD. Finale Annäherung: Ziel links/rechts Cue.

**Expect:** `answer_first`, `concrete_place`, `duration`

**Avoid:** `address_unless_asked`, `vague_filler`, `permission_questions`

### 58. `navigation::bike_eta_mode_switch_v1`

Fahrrad/ETA während Nav: Profil sofort auf Rad umstellen und Bike-ETA sprechen — keine Permission, kein fremder Nav-Start aus Wetter-Follow-ups.

**Expect:** `duration`, `answer_first`

**Avoid:** `permission_questions`, `vague_filler`

## planning (16)

### 16. `Tag oder Sehenswürdigkeit` _(legacy)_

Tag oder Sehenswürdigkeit: Preise und Ticket-Link in derselben Antwort; Stichpunkte aus dem Gesagten; genannte Orte in die Timeline, nicht GPS-Heimat-POIs.

**Expect:** `prices`, `tickets`, `website`, `concrete_place`, `answer_first`

**Avoid:** `vague_filler`, `address_unless_asked`, `permission_questions`

### 17. `Ticketpflichtiger Zugang erbt Transit` _(legacy)_

Ticketpflichtiger Zugang erbt Transit: Betreiber, Verbindung, belegter Preis, Ticket-Link (Partner vor Website). Timeline-Stop. Lokalen Modus recherchieren.

**Expect:** `prices`, `tickets`, `website`, `concrete_place`, `answer_first`

**Avoid:** `vague_filler`, `permission_questions`

### 18. `Fester Termin` _(legacy)_

Fester Termin: erst Halt und Losgehen rückwärts, dann der Rest — analog Bahn, Konzert, Training. Geländer, Wortlaut frei.

**Expect:** `times_hours`, `answer_first`

**Avoid:** `vague_filler`, `permission_questions`

### 20. `planning::day_plan_hamburg_walk_v1`

Tagesplan multi-slot (auch lange Sprachnachricht): Bridge kurz zusagen, dann Timeline — Los/Anreise, typisches Frühstück-Pitch, Must-Haves/Tour, Landmarke Q&A (was ist das / Eintritt) ohne Top-2-Drift, Abendessen-Pitch zum Sunset/Blick. Charakter färbt nur Ton, nie Inhalt durch Archaik ersetzen. Walk nacheinander; Ablehnung = neue Suche; Ticket bestätigen; Ende Übernachten vs Heimfahrt. Zielstadt-Pack, nicht GPS-Heimat.

**Expect:** `answer_first`, `times_hours`, `concrete_place`, `tickets`

**Avoid:** `permission_questions`, `vague_filler`, `long_history`

### 21. `planning::flight_leave_by_staged_v1`

Leave-by ohne Abflugzeit/Nummer: Bridge würdigt Ziel, kein Recherche-Versprechen. Call 2 fragt sofort Uhrzeit oder Flugnummer — keine Abflugtafel-/Cheap-Flight-Warteschleife. Mit Uhr: Board matchen (±45 Min auf geplante Abflugzeit), Gepäck-Chips einmal, dann Leave-by + ÖPNV/Taxi/Transfer. Eine Anreise-Wahl räumt die anderen weg; Taxi → Uber-Vorbestellen-Button; Transfer → erst Personen+Abholadresse, dann Welcome-Pickups. Explizites morgen/heute bleibt stehen.

**Expect:** `answer_first`, `times_hours`, `casual_tone`

**Avoid:** `permission_questions`, `vague_filler`, `fake_promises`

### 22. `planning::flight_access_choice_v1`

Flughafen-Anreise gewählt: Soft-Commit sofort, rivalisierende Timeline-Optionen weg, kein Floskel-Bridge. Flug-Accordion = Flug + Terminal/Check-in/Security; Transfer-Accordion = nur Leave-by/Fahrt/Kosten. Taxi → Uber-Link mit Schedule wenn Abholung Zukunft (>15 Min), sonst product-selection. ÖPNV → volle Kette; Transfer → Personen und Abholadresse vor Partner-Link.

**Expect:** `answer_first`, `just_do_it`, `casual_tone`

**Avoid:** `permission_questions`, `vague_filler`, `fake_promises`

### 23. `planning::flight_taxi_compound_v1`

Flug + Taxi in einem Satz: Call 1 würdigt Ziel und erklärt Leave-by. Call 2 findet Flug, Timeline mit Taxi-Default; Airport-Fakten unter Flug-Gruppe, Transfer nur Fahrt. Nach Vorbestellen-Ja: kurz Flughafen-X / Los-Y / Taxi-€Z + Uber-Schedule-Button — kein falsches Accordion.

**Expect:** `answer_first`, `just_do_it`, `casual_tone`

**Avoid:** `permission_questions`, `vague_filler`

### 24. `planning::hotel_prefs_before_pitch_v1`

Hotel am Ziel ohne Prefs: erst knappe Klärung (Personen, Budget, Nächte, Must-Haves), dann 2 Optionen mit Preisen und Property-Deep-Link bis Zimmerwahl. Keine Google-Maps-Chips bei Hotels.

**Expect:** `answer_first`, `casual_tone`, `booking_url`

**Avoid:** `permission_questions`, `vague_filler`, `fake_promises`

### 25. `planning::reisebuero_collect_v1`

Reise AN SICH (Flug/Hotel/Anreise/Trip-Inspiration, „überlege nach X zu fliegen — was davor?“): Switch Reisebüro. Call 1 erkennt Absicht, füllt Board, eine Lücke. Reines Hotel-Amenity ohne Zielstadt = lokal pitchen. Gegenpol: nur was-vor-Ort-möglich → nicht dieses Funnel.

**Expect:** `answer_first`, `tickets`, `website`, `casual_tone`

**Avoid:** `permission_questions`, `vague_filler`, `fake_promises`

### 26. `planning::hotel_local_amenities_v1`

Hotel mit Amenities/Budget ohne Zielstadt: 2 Optionen am GPS + Stay22, Must-Amenities nur belegt. Kein Reisebüro „von wo?“.

**Expect:** `concrete_place`, `alternatives`, `answer_first`, `booking_url`

**Avoid:** `permission_questions`, `vague_filler`

### 27. `planning::hotel_empty_followup_v1`

Follow-up zu „erstes Hotel“/Pool nach leerem Hotel-Pitch: ehrlich — kein Hotel genannt. Entweder einmal breiter suchen (Radius/Budget/Amenities lockern) mit benannten Stay22-Optionen, oder kurz klären statt leerer UI.

**Expect:** `answer_first`, `alternatives`, `casual_tone`

**Avoid:** `fake_promises`, `vague_filler`, `permission_questions`

### 28. `planning::stay_day_interactive_v1`

Ort+Fenster schon klar, Frage nur was vor Ort möglich (Highlights, Tour, Abend): interaktiv füllen — Call 1 erkennt Absicht (nicht Reise buchen). Kein neues Reisebüro-Funnel.

**Expect:** `answer_first`, `concrete_place`, `times_hours`, `casual_tone`

**Avoid:** `permission_questions`, `vague_filler`

### 29. `Gebuchter Flug` _(legacy)_

Gebuchter Flug: zuerst Ziel/Tag/Uhr oder Ident klären — fehlt Uhr und Thread hat keine → Call-1 Klärfrage (bridgeComplete), kein Leave-by-Raten. Uhr da → Leave-by rückwärts. Nie Airline-App-Selbstcheck statt Recherche. E-SIM erst wenn Flug in der Timeline steht. Nach Trivia/Essen nur Flug — totes Thema nicht mischen.

**Expect:** `times_hours`, `tickets`, `website`, `answer_first`

**Avoid:** `vague_filler`, `permission_questions`

### 61. `planning::path_tour_learned_pace_v1`

km- oder Zeit-Runde: Distanz/Dauer aus Wunsch; Tempo aus gelerntem Pace-Profil sobald Segmente da, sonst Default. Route grob treffen, kein Pflichtwortlaut.

**Expect:** `duration`, `answer_first`, `concrete_place`

**Avoid:** `vague_filler`, `permission_questions`

### 64. `planning::flight_direction_open_v1`

Offene Flugrichtung (Süden/Norden) mit Origin+Tag: 2–3 benannte Zielstädte pitchen und Ticket-/Suche-Buttons liefern — kein steckenbleibendes „Wohin?“ ohne Optionen.

**Expect:** `answer_first`, `tickets`, `alternatives`, `casual_tone`

**Avoid:** `permission_questions`, `vague_filler`

### 69. `planning::flight_timeline_accordion_v1`

Flug-Timeline: Flug-Accordion trägt Flug plus Ankunft Terminal, Check-in und Security; Transfer-Accordion nur Fahrt zum Flughafen (Leave-by, Dauer, Kosten). Keine Orts-Hardcodes.

**Expect:** `answer_first`, `just_do_it`, `casual_tone`

**Avoid:** `permission_questions`, `vague_filler`
