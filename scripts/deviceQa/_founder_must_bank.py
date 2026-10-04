#!/usr/bin/env python3
"""Founder-Pflicht Live-QA: Flug/Taxi/Theater/Kino/Gastro/Hotel/Trivia/Plan/Tour."""
from __future__ import annotations

SCENARIOS: list[dict] = [
    # --- Flug komplett ---
    {
        "id": "flug_morgen_ham",
        "q": "Hey Yorro, ich will morgen fliegen — guck bei Hamburg Fluege, was geht so Richtung Sueden, und ob ich noch Tickets kriege",
        "wait": 48,
        "reset_before": True,
        "family": "flight",
        "checks": {
            "need_any": [r"flug|ham|ticket|abflug|option|süd|sued|barcelona|lissabon|wien|athen|mallorca|roma|rom"],
            "fail_any": [r"passende optionen und routen werden|steakhouse"],
            "want_btn": [r"flug|ticket|web|buch|weiter|maps"],
        },
    },
    {
        "id": "flug_fu_uhr",
        "q": "Nimm den ersten, Abflug so gegen 10 Uhr",
        "wait": 36,
        "family": "flight",
        "checks": {
            "need_any": [r"10|uhr|leave|los|flughafen|gate|check|gepaeck|gepäck"],
            "fail_any": [r"passende optionen und routen werden"],
            "want_btn": [],
        },
    },
    {
        "id": "flug_fu_taxi_vorbestellen",
        "q": "Bitte Taxi zum Flughafen vorreservieren",
        "wait": 34,
        "family": "flight",
        "checks": {
            "need_any": [r"taxi|uber|bolt|abhol|vorbestell|link|flughafen"],
            "fail_any": [r"passende optionen und routen werden|wohin\?"],
            "want_btn": [r"taxi|uber|bolt|web|maps|route"],
        },
    },
    # --- Taxi solo ---
    {
        "id": "taxi_hbf_jetzt",
        "q": "Buch mir ein Taxi zum Hauptbahnhof",
        "wait": 30,
        "reset_before": True,
        "family": "taxi",
        "checks": {
            "need_any": [r"taxi|uber|hbf|hauptbahnhof|link|min"],
            "fail_any": [r"passende optionen und routen werden"],
            "want_btn": [r"taxi|uber|web|maps|route"],
        },
    },
    {
        "id": "taxi_vorbestellen_morgen",
        "q": "Reserviere morgen frueh um 7 Uhr ein Taxi zum Flughafen Hamburg",
        "wait": 34,
        "reset_before": True,
        "family": "taxi",
        "checks": {
            "need_any": [r"taxi|uber|7|flughafen|ham|vorbestell|link|morgen"],
            "fail_any": [r"passende optionen und routen werden"],
            "want_btn": [r"taxi|uber|web|maps"],
        },
    },
    # --- Theater / Kino / Live / Party ---
    {
        "id": "theater_heute",
        "q": "Welche Theaterstuecke oder Vorstellungen laufen heute oder die Tage in der Naehe?",
        "wait": 38,
        "reset_before": True,
        "family": "theater",
        "checks": {
            "need_any": [r"theater|stück|stueck|vorstellung|bühne|buehne|schauspiel|musical|uhr"],
            "fail_any": [r"passende optionen und routen werden"],
            "want_btn": [r"ticket|programm|web|maps|route"],
        },
    },
    {
        "id": "kino_heute",
        "q": "Kinosuche: Welche Filme laufen heute Abend in der Naehe, mit Uhrzeiten?",
        "wait": 38,
        "reset_before": True,
        "family": "cinema",
        "checks": {
            "need_any": [r"kino|film|uhr|vorstellung|cineplex|cinema"],
            "fail_any": [r"passende optionen und routen werden"],
            "want_btn": [r"ticket|programm|web|maps|kino|route"],
        },
    },
    {
        "id": "livemusik",
        "q": "Wo kann man heute oder am Wochenende Live-Musik sehen oder hoeren?",
        "wait": 36,
        "reset_before": True,
        "family": "nightlife",
        "checks": {
            "need_any": [r"live|musik|konzert|band|club|bar|gig|uhr|wochenende"],
            "fail_any": [r"passende optionen und routen werden"],
            "want_btn": [r"ticket|web|maps|route|programm"],
        },
    },
    {
        "id": "party_wo",
        "q": "Wo kann man hier Party machen — Clubs oder gute Locations?",
        "wait": 36,
        "reset_before": True,
        "family": "nightlife",
        "checks": {
            "need_any": [r"party|club|bar|disco|nacht|location|tanz"],
            "fail_any": [r"passende optionen und routen werden"],
            "want_btn": [r"maps|web|route|ticket"],
        },
    },
    # --- Gastro speziell ---
    {
        "id": "gastro_aussicht_flair",
        "q": "Restaurant mit schoener Aussicht, gemuetlichem Ambiente und gutem Flair — am besten Terrasse",
        "wait": 38,
        "reset_before": True,
        "family": "dining",
        "checks": {
            "need_any": [r"restaurant|terrasse|aussicht|blick|ambiente|flair|gemüt|gemuet"],
            "fail_any": [r"passende optionen und routen werden"],
            "want_btn": [r"speisekarte|route|maps|web"],
            "want_bulletish": True,
        },
    },
    {
        "id": "gastro_steak_elbblick",
        "q": "Spezifisch: Steak mit Elbblick, nicht zu steif",
        "wait": 36,
        "reset_before": True,
        "family": "dining",
        "checks": {
            "need_any": [r"steak|elb|blick|grill|restaurant"],
            "fail_any": [r"passende optionen und routen werden|vegan corner"],
            "want_btn": [r"speisekarte|route|maps"],
        },
    },
    {
        "id": "bier_guenstig",
        "q": "Wo gibt es das guenstigste Bier in der Naehe und was kostet es?",
        "wait": 32,
        "reset_before": True,
        "family": "dining",
        "checks": {
            "need_any": [r"bier|euro|€|preis|guenstig|günstig|angebot|kneipe|bar"],
            "fail_any": [r"passende optionen und routen werden|reisebüro"],
            "want_btn": [r"route|maps|web|angebot"],
        },
    },
    # --- Unterkunft ---
    {
        "id": "hotel_suche",
        "q": "Unterkunftsuche: Hotel oder Apartment fuer Freitag bis Sonntag, zentral, unter 600 Euro",
        "wait": 42,
        "reset_before": True,
        "family": "hotel",
        "checks": {
            "need_any": [r"hotel|apartment|stay|buch|euro|zimmer|nacht"],
            "fail_any": [r"passende optionen und routen werden|steakhouse"],
            "want_btn": [r"hotel|stay|buch|web|maps"],
        },
    },
    {
        "id": "hotel_spezifisch",
        "q": "Spezifisch: Boutique-Hotel mit Spa oder Sauna und Fruehstueck",
        "wait": 40,
        "reset_before": True,
        "family": "hotel",
        "checks": {
            "need_any": [r"hotel|spa|sauna|frühstück|fruehstueck|boutique|wellness"],
            "fail_any": [r"passende optionen und routen werden"],
            "want_btn": [r"hotel|stay|buch|web"],
        },
    },
    {
        "id": "hotel_fu_buchen",
        "q": "Zeig mir den Buchungslink vom ersten Hotel",
        "wait": 28,
        "family": "hotel",
        "checks": {
            "need_any": [r"buch|stay|link|hotel|web|offen|hier"],
            "fail_any": [r"passende optionen und routen werden"],
            "want_btn": [r"hotel|stay|buch|web"],
        },
    },
    # --- Trivia / Quiz ---
    {
        "id": "michel_hoehe",
        "q": "Wie hoch ist der Michel?",
        "wait": 26,
        "reset_before": True,
        "family": "trivia",
        "checks": {
            "need_any": [r"meter|m\b|michel|hoch|132|147|\d{2,3}"],
            "fail_any": [r"wen meinst du|passende optionen und routen werden|steakhouse"],
            "want_btn": [],
            "want_bulletish": True,
        },
    },
    {
        "id": "eiffel_farbe",
        "q": "Wie viel Farbe wuerde auf dem Eiffelturm raufpassen — also wie viel Farbe braucht man zum Streichen?",
        "wait": 30,
        "reset_before": True,
        "family": "trivia",
        "checks": {
            "need_any": [r"farbe|tonne|liter|anstrich|eiffel|\d"],
            "fail_any": [r"wen meinst du|passende optionen und routen werden"],
            "want_btn": [],
        },
    },
    {
        "id": "quiz_fu_eintritt_michel",
        "q": "Und was kostet der Eintritt auf den Turm?",
        "wait": 26,
        "family": "trivia",
        "checks": {
            "need_any": [r"euro|€|eintritt|ticket|turm|michel|preis"],
            "fail_any": [r"passende optionen und routen werden|eiffel.*farbe"],
            "want_btn": [r"ticket|web|maps|route"],
        },
    },
    # --- Erinnerung / Zahnbürste ---
    {
        "id": "zahnbuerste_erinnerung",
        "q": "Was brauche ich noch — eine Zahnbuerste. Kannst du mich daran erinnern, die mitzunehmen?",
        "wait": 26,
        "reset_before": True,
        "family": "reminder",
        "checks": {
            "need_any": [r"zahnbürste|zahnbuerste|erinner|gemerkt|todo|mitnehm"],
            "fail_any": [r"passende optionen und routen werden|wecker um"],
            "want_btn": [],
        },
    },
    {
        "id": "zahnbuerste_fu_timeline",
        "q": "Trag das bitte in die Timeline ein",
        "wait": 24,
        "family": "reminder",
        "checks": {
            "need_any": [r"timeline|eingetragen|notiz|todo|zahnbürste|zahnbuerste|dran"],
            "fail_any": [r"passende optionen und routen werden"],
            "want_btn": [r"plan|timeline|kalender"],
        },
    },
    # --- Timeline / Tour / Planungsmodus ---
    {
        "id": "plan_tag_fuellen",
        "q": "Planungsmodus: Fuell mir die Timeline fuer heute — vormittags Kaffee, mittags gutes Essen, nachmittags ein Museum oder Theater, abends Live-Musik oder Party, und trag das alles ein",
        "wait": 55,
        "reset_before": True,
        "family": "plan",
        "checks": {
            "need_any": [r"kaffee|essen|museum|theater|live|party|timeline|plan|uhr|stopp"],
            "fail_any": [r"passende optionen und routen werden"],
            "want_btn": [r"tagesplan|kalender|plan|route|timeline"],
        },
    },
    {
        "id": "plan_fu_durchgehen",
        "q": "Lass uns jeden Punkt der Timeline durchgehen, step by step",
        "wait": 40,
        "family": "plan",
        "checks": {
            "need_any": [r"punkt|erste|nächste|naechste|stopp|kaffee|essen|museum|abend"],
            "fail_any": [r"passende optionen und routen werden"],
            "want_btn": [],
        },
    },
    {
        "id": "plan_fu_aendern_abend",
        "q": "Abend aendern: lieber ruhiges Restaurant mit Flair statt Party",
        "wait": 36,
        "family": "plan",
        "checks": {
            "need_any": [r"restaurant|abend|flair|ruhig|timeline|ersetzt|geändert|geaendert"],
            "fail_any": [r"passende optionen und routen werden"],
            "want_btn": [r"speisekarte|route|maps|plan"],
        },
    },
    {
        "id": "tour_modus",
        "q": "Tourmodus: Wir haben zwei Stunden — fuehr mich zu zwei spannenden Orten und danach zum Essen",
        "wait": 42,
        "reset_before": True,
        "family": "tour",
        "checks": {
            "need_any": [r"tour|stopp|minute|ort|essen|route|zwei|2"],
            "fail_any": [r"passende optionen und routen werden|32 std"],
            "want_btn": [r"route|starten|tour|nav|tagesplan"],
        },
    },
    {
        "id": "tour_fu_start",
        "q": "Start die Route zum ersten Stopp",
        "wait": 28,
        "family": "tour",
        "checks": {
            "need_any": [r"route|nav|min|stopp|starten|unterwegs|links|rechts"],
            "fail_any": [r"passende optionen und routen werden"],
            "want_btn": [r"route|starten|nav"],
        },
    },
]

assert len(SCENARIOS) >= 20, len(SCENARIOS)
print("founder_must scenarios", len(SCENARIOS))
