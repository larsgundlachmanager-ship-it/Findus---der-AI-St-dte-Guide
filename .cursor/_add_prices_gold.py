from pathlib import Path
import json

p = Path(r"C:\Users\larsf\Findus 2.0\src\module2\blueprints\ownerGold.pack.json")
data = json.loads(p.read_text(encoding="utf-8"))

new_bps = [
    {
        "intentFamily": "dining",
        "situationKey": "dining::prices_first_compact_buttons_v1",
        "tags": ["prices", "compact", "buttons", "menu", "pitch"],
        "expect": [
            "prices",
            "answer_first",
            "concrete_place",
            "menu",
            "route_button",
            "alternatives",
        ],
        "avoid": [
            "long_history",
            "vague_filler",
            "address_unless_asked",
            "permission_questions",
            "meta_app_pitch",
        ],
        "summary": "Gastro/Pitch: belegte Preise und Angebot zuerst in 2–4 knappen Saetzen; Historie weglassen. Buttons 1:1 zu Spoken (Route + Speisekarte/Website je Option) — keine Meta-/Mehr-Buttons. Zweite Option kurz hinten.",
    },
    {
        "intentFamily": "activity_poi",
        "situationKey": "activity_poi::prices_first_compact_buttons_v1",
        "tags": ["prices", "compact", "buttons", "activity", "booking"],
        "expect": [
            "prices",
            "duration",
            "life_now",
            "answer_first",
            "concrete_place",
            "booking_url",
            "route_button",
        ],
        "avoid": [
            "long_history",
            "vague_filler",
            "address_unless_asked",
            "permission_questions",
            "meta_app_pitch",
        ],
        "summary": "Aktivitaet/Verleih/Sport: Preis/Dauer/Mitbringen zuerst wenn belegt; kurze Motivation, keine Museums-Historie. Buttons: Route + Buchung/Website zuerst — Labels klar, 1:1 zu Spoken.",
    },
    {
        "intentFamily": "events",
        "situationKey": "events::prices_first_compact_buttons_v1",
        "tags": ["prices", "compact", "buttons", "tickets", "events"],
        "expect": [
            "prices",
            "answer_first",
            "times_hours",
            "tickets",
            "concrete_place",
            "route_button",
        ],
        "avoid": [
            "long_history",
            "vague_filler",
            "address_unless_asked",
            "permission_questions",
            "meta_app_pitch",
        ],
        "summary": "Events/Kino/Programm: Was/Wann/Preis zuerst in knappen Saetzen; Eintritt nur belegt. Buttons: Navigation + Programm/Ticket wenn URL — keine leeren Ticket-Links, keine Adresse außer gefragt.",
    },
    {
        "intentFamily": "planning",
        "situationKey": "planning::prices_first_compact_buttons_v1",
        "tags": ["prices", "compact", "buttons", "tickets", "sight"],
        "expect": [
            "prices",
            "answer_first",
            "tickets",
            "concrete_place",
            "booking_url",
        ],
        "avoid": [
            "long_history",
            "vague_filler",
            "address_unless_asked",
            "permission_questions",
            "meta_app_pitch",
        ],
        "summary": "Sehenswuerdigkeit/Ticket/Tag: Eintritt und Ticket-Link vorne wenn belegt; Antwort kurz. Buttons = Ticket/Website + ggf. Route zu genannten Orten — keine Historie-Essays vor dem Preis.",
    },
    {
        "intentFamily": "hotel",
        "situationKey": "hotel::prices_first_compact_buttons_v1",
        "tags": ["prices", "compact", "buttons", "hotel", "booking"],
        "expect": [
            "prices",
            "answer_first",
            "concrete_place",
            "alternatives",
            "booking_url",
        ],
        "avoid": [
            "vague_filler",
            "permission_questions",
            "long_history",
            "meta_app_pitch",
        ],
        "summary": "Hotel/Stay: zwei Optionen mit belegtem Preis zuerst, dann Pref-Fit; Deep-Link-Buttons je Property. Kein Recherche-Meta, keine stumme UI ohne Speech-Preise.",
    },
    {
        "intentFamily": "general",
        "situationKey": "general::prices_first_compact_buttons_v1",
        "tags": ["prices", "compact", "buttons", "answer_shape"],
        "expect": [
            "prices",
            "answer_first",
            "route_button",
            "casual_tone",
        ],
        "avoid": [
            "long_history",
            "vague_filler",
            "permission_questions",
            "meta_app_pitch",
            "address_unless_asked",
        ],
        "summary": "Preisrelevante Empfehlung (egal Familie): Kern + belegte Preise vorne, Tipps hinten, kurze Speech. Action-Buttons spiegeln Spoken 1:1 — Route/Link statt vager Mehr-Buttons.",
    },
]

existing = {b.get("situationKey") for b in data["blueprints"] if b.get("situationKey")}
added = 0
for bp in new_bps:
    if bp["situationKey"] in existing:
        # replace in place
        for i, old in enumerate(data["blueprints"]):
            if old.get("situationKey") == bp["situationKey"]:
                data["blueprints"][i] = bp
                break
        print("updated", bp["situationKey"])
    else:
        data["blueprints"].append(bp)
        added += 1
        print("added", bp["situationKey"])

# Soft-sharpen existing dining speisekarte summary if still generic
for b in data["blueprints"]:
    if (
        b.get("intentFamily") == "dining"
        and "speisekarte" in (b.get("tags") or [])
        and not b.get("situationKey")
        and "Preise" in b.get("summary", "")
    ):
        b["situationKey"] = "dining::menu_prices_route_compact_v1"
        b["summary"] = (
            "Gastro inkl. Fruehstueck/Cafe/Bar/Snack: Preise und Speisekarte-Deep-Link zuerst; "
            "genannter Ort hard-match. Historie weglassen. Zweite Option hinten. Buttons Route + Karte/Website 1:1."
        )
        print("sharpened dining menu entry")

# validate summaries length
for b in new_bps:
    s = b["summary"]
    assert 12 <= len(s) <= 280, (b["situationKey"], len(s))

p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("total", len(data["blueprints"]), "added", added)
