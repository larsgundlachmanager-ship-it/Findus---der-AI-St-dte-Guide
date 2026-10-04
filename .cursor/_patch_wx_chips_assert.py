# -*- coding: utf-8 -*-
from pathlib import Path

def write_rplus(path: Path, text: str) -> None:
    with path.open("r+", encoding="utf-8", newline="\n") as f:
        f.seek(0)
        f.write(text)
        f.truncate()

p = Path(r"c:\Users\larsf\Findus 2.0\src\services\ui\weatherDayPlanSpeech.smoke.test.ts")
text = p.read_text(encoding="utf-8")
old = "  assert(!/Also,|kurz zum wetter/i.test(radio.speech), 'no opener');\n}"
new = """  assert(!/Also,|kurz zum wetter/i.test(radio.speech), 'no opener');
  assert(/13° bis 18°/.test(radio.bullets[0] ?? ''), `temp chip: ${radio.bullets[0]}`);
  const chipLine = radio.bullets.join(' | ');
  assert(/10 bis 16 Uhr/.test(chipLine), `cloud window: ${chipLine}`);
  assert(/16 bis 19 Uhr/.test(chipLine), `shower window: ${chipLine}`);
  assert(/ab 19 Uhr/.test(chipLine), `storm window: ${chipLine}`);
  assert(radio.bullets.length <= 4, 'max 4 timeline chips');
}"""
if old not in text:
    raise SystemExit('smoke assert anchor missing')
text = text.replace(old, new, 1)
write_rplus(p, text)
print('smoke asserts ok')

g = Path(r"c:\Users\larsf\Findus 2.0\src\module2\blueprints\ownerGold.pack.json")
gt = g.read_text(encoding="utf-8")
oldg = "Allgemeine Wettervorhersage (ohne Slot-only): 2–3 Fließsätze wie Radio/DWD — zuerst Himmel über heute/morgen/übermorgen kontrastieren (gleiche Tage bündeln), dann Schauer den betroffenen Tagen zuordnen, Wind nur wenn belegt und spürbar, Höchstwerte am Ende weben. Stadt nur wenn genannt oder klarer Ortsbezug. Kleidung nicht in Speech (Chip ok). Kein Telegramm, kein Prozent-Dump, kein Opener."
newg = "Allgemeine Wettervorhersage: Speech 2–3 Fließsätze Radio-Stil. Stichpunkte zeigen den morgigen Tag als Zeitfenster — zuerst Temperaturspanne, dann Icon plus Uhr-Spanne, letzte Phase ab Uhr. Kein Outfit, kein Prozent."
if oldg not in gt:
    raise SystemExit('gold summary missing')
gt = gt.replace(oldg, newg, 1)
import json
json.loads(gt)
write_rplus(g, gt)
print('gold ok')
