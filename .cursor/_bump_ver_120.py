# -*- coding: utf-8 -*-
from pathlib import Path
import os

root = Path(r"c:\Users\larsf\Findus 2.0")

p = root / "app.json"
t = p.read_text(encoding="utf-8")
t2 = t.replace('"versionCode": 119', '"versionCode": 120')
t2 = t2.replace('"version": "2.0.92"', '"version": "2.0.93"')
t2 = t2.replace('"buildNumber":  "32"', '"buildNumber":  "33"')
tmp = p.with_suffix(".json.tmpwrite")
tmp.write_text(t2, encoding="utf-8")
os.replace(tmp, p)
print("app.json versionCode=120" if '"versionCode": 120' in t2 else "FAIL app.json")

notes = root / "releases" / "2.0.93"
notes.mkdir(parents=True, exist_ok=True)
(notes / "whatsnew-de-DE-v120.txt").write_text(
    "Navigation in der Hosentasche: Ansagen und Vibration auch bei Standby. "
    "Abbiegungen früher und mit klaren Landmarken; Ziel erreicht wird immer gesagt. "
    "ETA passt sich schneller an dein Tempo an. GPS- und Kompass-Button getrennt "
    "(zentrieren/ranzoomen/folgen vs. Norden/Blickrichtung). Navigation startet flotter "
    "— Karte schon während der Bestätigung. Adress-Ziele behalten die Hausnummer.\n",
    encoding="utf-8",
)
print("notes ok")

g = (root / "android" / "app" / "build.gradle").read_text(encoding="utf-8")
print("gradle ok" if "versionCode 120" in g and 'versionName "2.0.93"' in g else "FAIL gradle")
