#!/usr/bin/env python3
"""Extra Live-Fails aus Voice-Feedback (Sep 10–11) + Ideal-Suite."""
from __future__ import annotations

VOICE_FEEDBACK_SCENARIOS: list[dict] = [
    {
        "id": "vf_ayce_kein_asiatisch",
        "q": "Ich habe Lust heute Abend All you can eat zu essen, aber kein Asiatisch. Was kannst du mir empfehlen?",
        "wait": 75,
        "reset_before": True,
        "family": "dining_ayce",
        "tap_btns": [r"speisekarte|website|maps|karte"],
        "checks": {
            "need_any": [
                r"all.?you.?can.?eat|ayce|buffet|flatrate|unbegrenzt|schlemmer|"
                r"restaurant|essen in |navigation zum"
            ],
            "fail_any": [
                r"essen in goldschätzchen|essen in goldschaetzchen|restaurant goldschätzchen(?!\s*$)",
                r"pinerhof|event.?lane|was heute Abend los ist",
                r"passende optionen und routen werden",
            ],
            "want_btn": [r"speisekarte|website|maps|web|route"],
            "want_bulletish": True,
        },
    },
    {
        "id": "vf_ayce_stt_oyukin",
        "q": "Nee, ich moechte gerne heute Abend Oyukin Eat essen, also All you can eat, kein asiatisch",
        "wait": 75,
        "reset_before": True,
        "family": "dining_ayce",
        "tap_btns": [r"speisekarte|website|maps"],
        "checks": {
            "need_any": [r"all.?you.?can.?eat|ayce|buffet|flatrate|unbegrenzt|essen"],
            "fail_any": [r"essen in goldschätzchen|essen in goldschaetzchen|pinerhof|heuers"],
            "want_btn": [r"speisekarte|website|maps|web"],
        },
    },
    {
        "id": "vf_croque",
        "q": "Ich habe Lust auf einen leckeren Croque. Wo kann ich da hingehen?",
        "wait": 60,
        "reset_before": True,
        "family": "dining_specialty",
        "tap_btns": [r"speisekarte|maps|website"],
        "checks": {
            "need_any": [r"croque|bäcker|baecker|café|cafe|bistro|sandwich|toast"],
            "fail_any": [
                r"keinen belegten treffer für croak|keinen belegten treffer für croque",
                r"passende optionen und routen werden",
            ],
            "want_btn": [r"speisekarte|maps|web|route"],
            "want_bulletish": True,
        },
    },
    {
        "id": "vf_dinosaurier",
        "q": "Gibt es irgendwo ein Museum, wo ich Dinosaurier angucken kann?",
        "wait": 65,
        "reset_before": True,
        "family": "activity_expand",
        "tap_btns": [r"maps|web|ticket|route"],
        "checks": {
            "need_any": [r"dinosaur|saurier|museum|zoo|ausstellung|jurassic|fossil"],
            "fail_any": [
                r"soll ich dir die tickets",
                r"passende optionen und routen werden",
                r"keine live-wetterdaten",
            ],
            "want_btn": [r"maps|web|ticket|route"],
            "want_bulletish": True,
        },
    },
    {
        "id": "vf_ayce_no_search_meta",
        "q": "All you can eat heute Abend, kein Asiatisch bitte",
        "wait": 75,
        "reset_before": True,
        "family": "dining_ayce",
        "checks": {
            "need_any": [r"all.?you.?can.?eat|ayce|buffet|flatrate|restaurant|essen"],
            "fail_any": [
                r"in\s+\d+\s*km\s+nichts",
                r"online erweitert",
                r"ringweise",
                r"soll ich weiter suchen",
                r"essen in goldschätzchen|essen in goldschaetzchen",
            ],
            "want_btn": [r"speisekarte|maps|web|route"],
        },
    },
    {
        "id": "vf_nav_fuss_not_oepnv",
        "q": "Bring mich zu Fuss zum naechsten Cafe",
        "wait": 55,
        "reset_before": True,
        "family": "nav",
        "tap_btns": [r"route|starten|navigation"],
        "checks": {
            "need_any": [r"café|cafe|fuss|fuß|geh|min|route|meter"],
            "fail_any": [r"öpnv|oepnv|s-bahn|u-bahn|buslinie"],
            "want_btn": [r"route|starten|maps|nav"],
        },
    },
]
