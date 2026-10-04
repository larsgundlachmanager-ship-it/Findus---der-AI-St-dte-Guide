#!/usr/bin/env python3
import os, sys, re
from pathlib import Path

os.environ["FINDUS_QA_SERIAL"] = "00143157P001105"
sys.path.insert(0, r"c:\Users\larsf\Findus 2.0\scripts\deviceQa")
import importlib.util

p = Path(r"c:\Users\larsf\Findus 2.0\scripts\deviceQa\_three_week_marathon.py")
s = importlib.util.spec_from_file_location("tw", p)
m = importlib.util.module_from_spec(s)
s.loader.exec_module(m)
xml = Path(r"c:\Users\larsf\Findus 2.0\.cursor\live6w\ui.xml").read_text(
    encoding="utf-8", errors="ignore"
)
hits = []
for n in m.nodes(xml):
    blob = f"{n.get('desc','')} {n.get('text','')}"
    if re.search(r"mikro|mic|yorro spricht|yorro denkt", blob, re.I):
        hits.append(
            {
                "click": n["click"],
                "looks": m._looks_like_mic(n),
                "desc": (n.get("desc") or "")[:100],
                "text": (n.get("text") or "")[:40],
                "cls": n.get("cls"),
            }
        )
out = Path(r"c:\Users\larsf\Findus 2.0\.cursor\live6w\mic_debug.txt")
out.write_text(repr(hits), encoding="utf-8")
print("wrote", out, "n=", len(hits))
