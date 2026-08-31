# -*- coding: utf-8 -*-
import json
from pathlib import Path

p = Path("src/assets/data/floskelLibrary.json")
data = json.loads(p.read_text(encoding="utf-8"))

# Insert named_schedule after events
cats = data["categories"]
# Rebuild ordered dict: insert after events
items = list(cats.items())
new_items = []
inserted = False
for k, v in items:
    if k == "named_schedule":
        continue  # drop any existing
    new_items.append((k, v))
    if k == "events" and not inserted:
        new_items.append((
            "named_schedule",
            {
                "label": "Genannter Termin / Spielplan",
                "phrases": [
                    "Alles klar — ich check den Spielplan kurz.",
                    "Verstanden, ich hol die nächsten Termine.",
                    "Jo, ich schau nach Datum und Anpfiff.",
                    "Moment, ich check offizielle Termine und Tickets.",
                    "Klar, ich recherchiere den nächsten Termin.",
                    "Ich hole Datum, Uhrzeit und Tickets nach.",
                    "Passt, ich check den genannten Termin.",
                ],
            },
        ))
        inserted = True

data["categories"] = dict(new_items)

# Soften generic — no „Gute Richtung“ (klang wie „gute richtig“)
if "generic" in data["categories"]:
    data["categories"]["generic"]["phrases"] = [
        "Verstehe — ich setz genau da an.",
        "Passt, ich mach dir das konkret.",
        "Passt, ich hol dir die nützlichen Fakten dazu.",
        "Genau das klären wir jetzt.",
        "Alles klar, ich geh an dein Anliegen ran.",
    ]

p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
# validate
json.loads(p.read_text(encoding="utf-8"))
print("floskel ok, named_schedule=", "named_schedule" in data["categories"])

# Dedupe floskelEngine second detect
e = Path("src/services/speech/floskelEngine.ts")
et = e.read_text(encoding="utf-8")
count = et.count("looksLikeNamedScheduleQuery")
print("engine count before", count)
# Remove the SECOND occurrence block (keep first at top)
marker = "  // Genannter Spielplan VOR generischem events — neutrale Cover-Floskel, kein Pitch-Opener\n"
if et.count(marker) >= 1:
    idx = et.find(marker)
    # if also early detect exists, remove this one
    if et.find("Cover-Ton, kein") >= 0 or et.find("VOR generic/events") >= 0:
        end = et.find("  if (/\\b(was\\s+geht", idx)
        if end > idx:
            et = et[:idx] + et[end:]
            e.write_text(et, encoding="utf-8")
            print("removed second block, count now", et.count("looksLikeNamedScheduleQuery"))
        else:
            print("end marker not found")
    else:
        print("early detect style different")
else:
    # ensure early detect exists
    if "named_schedule" not in et:
        print("NEED ADD DETECT")
    else:
        print("ok single")
