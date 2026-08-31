#!/usr/bin/env python3
"""Strict manual regrade of .cursor/live13 captures."""
from __future__ import annotations

import json
import re
from pathlib import Path

OUT = Path(r"c:\Users\larsf\Findus 2.0\.cursor\live13")
r = json.loads((OUT / "full-3week-report.json").read_text(encoding="utf-8"))

SHEET = re.compile(
    r"(spickzettel|•|alternativen|reiseb|wann flieg|essen in|wetter in|hotel|"
    r"programm|cineplex|route|bahnhof |notdienst|apotheke|konsulat|aldi|lidl|"
    r"stay22|ticket|zwei option|1 stunde|elbblick|michel|angus|vegan|taxi|"
    r"handgep|spider|foerde|förde|budget|parkplatz|museum)",
    re.I,
)

manual = {}
for x in r["results"]:
    tid = x["id"]
    p = OUT / f"{tid}-text.txt"
    txt = p.read_text(encoding="utf-8", errors="ignore") if p.exists() else ""
    low = txt.lower()
    notes: list[str] = []
    ok = x["verdict"] == "PASS"
    has_sheet = bool(SHEET.search(low))

    if "frage an yorro" in low or "schreib deine frage" in low:
        ok = False
        notes.append("tippfeld_stuck")
    if "keine direkten live-wetterdaten" in low or "keine live-wetterdaten" in low:
        ok = False
        notes.append("weather_empty")

    if tid == "wetter":
        if "wetter in prisdorf" in low and "keine" not in low and "°" in txt:
            ok = True
            notes.append("weather_ok")
        elif "keine" in low:
            ok = False
    if tid == "outfit":
        if "jacke" in low or "schuhe" in low or "pulli" in low:
            ok = True
            notes.append("clothes_ok")
        if "wetter in" in low and "speisekarte" in low:
            notes.append("stale_title")
        if ("teich" in low or "feuer" in low) and "jacke" not in low:
            ok = False
            notes.append("wrong_pitch")
    if tid == "steak" and ("rindock" in low or "bulls" in low):
        ok = True
        if "cuisine_" in low:
            notes.append("facet_leak")
    if tid == "steak_fu_reject":
        if "steak" not in low and "restaurant" not in low and "essen" not in low:
            ok = False
            notes.append("fu_drift")
    if tid == "oepnv" and "abfahrt" not in low and "s-bahn" not in low:
        if "bahnhof" in low and "minuten" not in low:
            ok = False
            notes.append("too_thin")
    if tid == "nav_fast_hbf" and "bahnhof prisdorf" in low and "hamburg" not in low:
        ok = False
        notes.append("wrong_hbf")
    if tid == "pass_lost":
        if "heimatverein" in low:
            ok = False
            notes.append("heimatverein")
        if "konsulat" not in low and "botschaft" not in low:
            ok = False
            notes.append("not_consulate")
    if tid == "kino_fu_spiderman" and "spider" not in low:
        ok = False
        notes.append("no_spiderman")
    if tid == "flug_fu_leaveby":
        if "sag nochmal" in low or "worum" in low:
            ok = False
            notes.append("lost_context")
        if "touren" in low and "uhr" not in low:
            ok = False
            notes.append("not_leaveby")
    if tid == "museum_trex" and "rex" not in low and "dino" not in low:
        if low.count("museum") <= 2:
            ok = False
            notes.append("thin_museum")
    if tid == "hotel_fu_pool" and "datensatz" in low:
        ok = False
        notes.append("city_switch")
    if tid == "spikeball" and not has_sheet:
        ok = False
        notes.append("empty")
    if tid == "parking_ticket" and "17" not in low and "park" not in low:
        ok = False
        notes.append("no_ack")
    if not has_sheet and tid not in ("parking_ticket",) and "tippfeld_stuck" not in notes:
        ok = False
        notes.append("no_or_weak_sheet")

    manual[tid] = {
        "auto": x["verdict"],
        "manual": "PASS" if ok else "FAIL",
        "notes": notes,
        "snip": " | ".join([ln.strip() for ln in txt.splitlines() if ln.strip()][:10])[:200],
    }

mp = sum(1 for v in manual.values() if v["manual"] == "PASS")
ap = sum(1 for x in r["results"] if x["verdict"] == "PASS")
print(f"MANUAL {mp}/{len(manual)}  AUTO {ap}/{len(r['results'])}")
print("--- FAILS ---")
for tid, v in manual.items():
    if v["manual"] == "FAIL":
        note = ",".join(v["notes"]) or "-"
        print(f"FAIL {tid:22} auto={v['auto']:4} {note}")
        print(f"     {v['snip'][:130]}")
print("--- SAMPLE PASS ---")
for tid in (
    "wetter",
    "steak",
    "hotel_pool",
    "london",
    "lisbon",
    "kino",
    "nav_prisdorf",
    "veg_abend",
    "compound_hh",
    "outfit",
):
    v = manual.get(tid)
    if v:
        note = ",".join(v["notes"]) or "-"
        print(f"{v['manual']:4} {tid:22} {note}")

out = Path(r"c:\Users\larsf\Findus 2.0\data\liveQuality\full-3week-manual-review.json")
out.write_text(
    json.dumps(
        {
            "manual_pass": mp,
            "total": len(manual),
            "auto_pass": ap,
            "items": manual,
        },
        ensure_ascii=False,
        indent=2,
    ),
    encoding="utf-8",
)
print("Wrote", out)
