#!/usr/bin/env python3
"""Continue Phase 7.6 from current Akt-2 Recap on Nothing, then B+C."""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

ROOT = Path(r"c:\Users\larsf\Findus 2.0")
spec = importlib.util.spec_from_file_location(
    "p76", ROOT / "scripts" / "deviceQa" / "_phase76_reisebuero_device_qa.py"
)
p76 = importlib.util.module_from_spec(spec)
assert spec.loader
spec.loader.exec_module(p76)

import json
from datetime import datetime, timezone

OUT = p76.OUT
OUT.mkdir(parents=True, exist_ok=True)
report = {
    "at": datetime.now(timezone.utc).isoformat(),
    "serial": p76.SERIAL,
    "mode": "continue_from_recap",
    "scenarios": {},
}

p76.log("CONTINUE from current UI")
p76.ensure_reverse()
xml = p76.dump()
p76.shot("cont_start")
p76.log("snip: " + p76.blob(xml)[:300])

# Confirm Akt 2 if present
if p76.re.search(r"passt das so|akt\s*2", p76.blob(xml), p76.re.I):
    p76.answer_open_gaps(xml)
    p76.try_start_search()

a = p76.wait_magazine("a_warm", min_opts=4, timeout_s=300)
report["scenarios"]["A_warm_open4"] = a

p76.log("=== B Prag WE ===")
p76.new_trip()
for c in [
    "Nur Prag, Wochenende zu zweit, ab Hamburg, fliegen. Kein Party, kein Pool.",
    "Freitag 25. September bis Sonntag 27. September 2026, Budget 400 Euro pro Person fuer alles",
    "Apartment am liebsten, Notfall Hotel. Verpflegung egal, vor Ort zu Fuss, nur Handgepaeck",
]:
    p76.send(c, wait=6)
    p76.shot("b_brief")
p76.send("Ja passt, such bitte zwei Pakete", wait=6)
b = p76.wait_magazine("b_prag", min_opts=2, timeout_s=300)
report["scenarios"]["B_prag_specific2"] = b

p76.log("=== C langer Dump ===")
p76.new_trip()
p76.send(
    "Also wir sind zu viert, Maennerwochenende Anfang Oktober, starten ab Hamburg. "
    "Flug haben wir noch nicht, Hotel auch nicht. Budget so 350 Euro pro Person. "
    "Wir wollen Party und Pool, Anreise egal Flug oder Bahn maximal vier Stunden. "
    "Apartment waere cool, sonst Hotel. Verpflegung egal, vor Ort OEPNV, nur Handgepaeck. "
    "Bitte nur die Luecken abfragen und dann suchen.",
    wait=10,
)
p76.shot("c_dump")
xml = p76.dump()
# answer a couple gaps then check recap/gap speech
for _ in range(4):
    if not p76.answer_open_gaps(xml):
        break
    xml = p76.dump()
c = {
    "ok": p76.looks_recap_or_gap(xml) or p76.hub_or_composer(xml),
    "recap_or_gap": p76.looks_recap_or_gap(xml),
    "snip": p76.blob(xml)[:500],
}
p76.shot("c_after")
report["scenarios"]["C_long_dump"] = c

a_pass = bool(a.get("ok") and (a.get("option_est", 0) >= 4 or a.get("hint4")))
b_pass = bool(
    b.get("ok")
    and (b.get("option_est", 0) >= 2 or b.get("hint2") or b.get("fenster", 0) >= 1)
)
c_pass = bool(c.get("ok") or c.get("recap_or_gap"))
report["pass"] = {"A": a_pass, "B": b_pass, "C": c_pass, "all": a_pass and b_pass and c_pass}
(OUT / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
p76.log(json.dumps(report["pass"], indent=2))
raise SystemExit(0 if report["pass"]["all"] else 1)
