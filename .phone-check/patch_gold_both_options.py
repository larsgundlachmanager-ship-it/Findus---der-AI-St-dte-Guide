# -*- coding: utf-8 -*-
from pathlib import Path
import json

p = Path(r"c:\Users\larsf\Findus 2.0\src\module2\blueprints\ownerGold.pack.json")
data = json.loads(p.read_text(encoding="utf-8"))

for s in data.get("situations", []):
    key = s.get("situationKey") or ""
    if key == "dining::call3_dish_price_v1":
        s["expect"] = list(
            dict.fromkeys([*(s.get("expect") or []), "prices", "menu", "alternatives"])
        )
        s["summary"] = (
            "Nach Top-2-Pitch: Call 3 zieht Speisekarte/Ticket/Buchung + belegte Preise "
            "für BEIDE Optionen nach — nie nur Favorit. Preis nur mit Beleg; Link-Button "
            "je Option wenn URL da. Kein erfundenes Euro."
        )
    if key == "dining::dish_two_options_price_menu_v1":
        s["expect"] = list(
            dict.fromkeys([*(s.get("expect") or []), "prices", "menu", "alternatives"])
        )
        s["summary"] = (
            "Gericht-Wunsch: zwei echte unterschiedliche Orte. Speech kurz mit Distanz + Gericht + Preis wenn belegt. "
            "Stichpunkte und Buttons (Route + Speisekarte/Website) für BEIDE Optionen — nie nur Option 1."
        )
    if key == "events::cinema_program_first_v1":
        s["expect"] = list(
            dict.fromkeys([*(s.get("expect") or []), "prices", "tickets", "alternatives"])
        )
        s["summary"] = (
            "Kino ohne Film: 2 Kinos mit Charakter. Ticket-Link und Preis wenn belegt für BEIDE Kinos; "
            "nach Wahl Programm/Preise vertiefen. Filmwahl → Vorstellung + Buchungs-URL je Option."
        )
    if key == "activity::rental_price_call3_v1":
        s["summary"] = (
            "Verleih/Aktivität: Top-2 mit Beleg, dann Call 3 Preise/Dauer/Website für BEIDE Anbieter — "
            "Vergleich A/B nur belegt. Nie nur Name ohne Preis wenn recherchierbar."
        )

p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("ownerGold updated")
