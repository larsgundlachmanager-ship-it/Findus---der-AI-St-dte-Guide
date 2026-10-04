#!/usr/bin/env python3
"""Surgical: answer drinks + tap Brief-button + wait magazine on Nothing."""
from __future__ import annotations

import importlib.util
import json
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(r"c:\Users\larsf\Findus 2.0")
spec = importlib.util.spec_from_file_location(
    "p76", ROOT / "scripts" / "deviceQa" / "_phase76_reisebuero_device_qa.py"
)
p76 = importlib.util.module_from_spec(spec)
assert spec.loader
spec.loader.exec_module(p76)

OUT = p76.OUT
report = {"at": datetime.now(timezone.utc).isoformat(), "serial": p76.SERIAL, "scenarios": {}}

p76.ensure_reverse()
# Ensure RB open
p76.deeplink()
time.sleep(2)
xml = p76.dump()
p76.shot("surg_start")
p76.log(p76.blob(xml)[:350])

# Answer drinks if asking
if p76.re.search(r"drinks|Highlight|preislich", p76.blob(xml), p76.re.I):
    p76.send("Guenstige Drinks nice-to-have, Highlight egal", wait=6)

# Force search tap a few times
for i in range(4):
    p76.dismiss_keyboard()
    ok = p76.try_start_search()
    p76.log(f"search attempt {i} ok={ok}")
    time.sleep(3)
    xml = p76.dump()
    b = p76.blob(xml)
    if p76.re.search(r"akt\s*2|passt das so", b, p76.re.I):
        p76.try_start_search()
    if p76.re.search(r"akt\s*3|akt\s*4|optionen|weitere ideen|theater|w[uü]hle|brief-plan", b, p76.re.I):
        p76.log("research/magazine visible")
        break

a = p76.wait_magazine("a_warm", min_opts=4, timeout_s=360)
report["scenarios"]["A"] = a
p76.shot("surg_a_end")

# B Prag fresh
p76.log("=== B ===")
p76.new_trip()
for c in [
    "Nur nach Prag, Wochenende zu zweit ab Hamburg fliegen, kein Party kein Pool",
    "Freitag 25. September bis Sonntag 27. September 2026, 400 Euro pro Person",
    "Apartment erst, Notfall Hotel, Verpflegung egal, OEPNV, nur Handgepaeck, Drinks egal",
]:
    p76.send(c, wait=6)
for i in range(5):
    p76.try_start_search()
    time.sleep(4)
    if p76.re.search(r"akt\s*3|akt\s*4|optionen", p76.blob(p76.dump()), p76.re.I):
        break
b = p76.wait_magazine("b_prag", min_opts=2, timeout_s=360)
report["scenarios"]["B"] = b

# C dump
p76.log("=== C ===")
p76.new_trip()
p76.send(
    "Zu viert Maennerwochenende Anfang Oktober ab Hamburg. Flug und Hotel fehlen. "
    "Budget 350 Euro p.P. Party und Pool. Max 4 Stunden Anreise. Apartment sonst Hotel. "
    "Verpflegung egal. Bitte Luecken kurz, dann suchen.",
    wait=10,
)
xml = p76.dump()
for _ in range(5):
    if not p76.answer_open_gaps(xml):
        break
    xml = p76.dump()
c = {
    "ok": p76.looks_recap_or_gap(xml) or p76.hub_or_composer(xml),
    "recap_or_gap": p76.looks_recap_or_gap(xml),
    "snip": p76.blob(xml)[:500],
}
p76.shot("surg_c")
report["scenarios"]["C"] = c

a_pass = bool(a.get("ok") and (a.get("option_est", 0) >= 4 or a.get("hint4")))
b_pass = bool(b.get("ok") and (b.get("option_est", 0) >= 2 or b.get("hint2") or b.get("fenster", 0) >= 1))
c_pass = bool(c.get("ok") or c.get("recap_or_gap"))
report["pass"] = {"A": a_pass, "B": b_pass, "C": c_pass, "all": a_pass and b_pass and c_pass}
(OUT / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
p76.log(json.dumps(report["pass"], indent=2))
raise SystemExit(0 if report["pass"]["all"] else 1)
