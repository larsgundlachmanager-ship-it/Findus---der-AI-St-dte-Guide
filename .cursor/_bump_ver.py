# -*- coding: utf-8 -*-
from pathlib import Path
import os

ROOT = Path(__file__).resolve().parents[1]


def atomic(p: Path, text: str) -> None:
    tmp = p.with_suffix(p.suffix + ".tmp_bump")
    tmp.write_text(text, encoding="utf-8", newline="\n")
    os.replace(tmp, p)


p = ROOT / "app.json"
t = p.read_text(encoding="utf-8")
t2 = t.replace('"version": "2.0.91"', '"version": "2.0.92"', 1)
t2 = t2.replace('"versionCode": 118', '"versionCode": 119', 1)
if t2 == t:
    raise SystemExit("app.json bump failed")
atomic(p, t2)
print("app.json -> 2.0.92 / 119")

p = ROOT / "android" / "app" / "build.gradle"
t = p.read_text(encoding="utf-8")
t2 = t.replace("versionCode 118", "versionCode 119", 1)
t2 = t2.replace('versionName "2.0.91"', 'versionName "2.0.92"', 1)
if "versionCode 119" not in t2:
    raise SystemExit("gradle bump failed")
atomic(p, t2)
print("build.gradle -> 2.0.92 / 119")

notes_dir = ROOT / "releases" / "2.0.92"
notes_dir.mkdir(parents=True, exist_ok=True)
text = (
    "Navigation von der Karte startet wieder zuverlässig. "
    "ÖPNV-Timeline ohne Doppel-Einträge, klareres Akkordeon. "
    "Bus ohne Fake-Gleis; Verspätung und Abfahrt getrennt lesbar. "
    "Gebäude-Namen beim Kartentipp (z. B. Laden). "
    "Letzte Fußstrecke Ausstieg zum Ziel wieder auf der Karte. "
    "Rad-Umschaltung räumt ÖPNV auf.\n"
)
(notes_dir / "whatsnew-de-DE-v119.txt").write_text(text, encoding="utf-8")
print("release notes:")
print(text.strip())
