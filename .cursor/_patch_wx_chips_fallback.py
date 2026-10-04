# -*- coding: utf-8 -*-
from pathlib import Path
import json

def write_rplus(path: Path, text: str) -> None:
    data = text.encode("utf-8")
    with path.open("r+b") as f:
        f.seek(0)
        f.write(data)
        f.truncate()

p = Path(r"c:\Users\larsf\Findus 2.0\src\services\ui\weatherDayPlanSpeech.ts")
text = p.read_text(encoding="utf-8")
old1 = """  const timeline = buildTomorrowTimelineChips(snap, Date.now());
  let bullets = timeline.length
    ? timeline
    : buildWeatherFactChips({"""
new1 = """  const timeline = buildTomorrowTimelineChips(snap, Date.now());
  let bullets =
    timeline.length >= 2
      ? timeline
      : buildWeatherFactChips({"""
old2 = """      const timeline = buildTomorrowTimelineChips(snap, nowMs);
      const bullets = timeline.length
        ? timeline
        : buildWeatherFactChips({"""
new2 = """      const timeline = buildTomorrowTimelineChips(snap, nowMs);
      const bullets =
        timeline.length >= 2
          ? timeline
          : buildWeatherFactChips({"""
if old1 not in text:
    raise SystemExit("old1 missing")
if old2 not in text:
    raise SystemExit("old2 missing")
text = text.replace(old1, new1, 1).replace(old2, new2, 1)
write_rplus(p, text)
print("fallback ok")

g = Path(r"c:\Users\larsf\Findus 2.0\src\module2\blueprints\ownerGold.pack.json")
raw = g.read_text(encoding="utf-8")
try:
    json.loads(raw)
    print("gold json ok", len(raw))
except Exception as e:
    print("gold json BAD", e)
    # show around the summary
    i = raw.find("Allgemeine Wettervorhersage")
    print(repr(raw[i:i+800]))
