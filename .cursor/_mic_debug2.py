#!/usr/bin/env python3
from pathlib import Path
import re
import sys

sys.path.insert(0, r"c:\Users\larsf\Findus 2.0\scripts\deviceQa")
import os

os.environ["FINDUS_QA_SERIAL"] = "00143157P001105"
import importlib.util

p = Path(r"c:\Users\larsf\Findus 2.0\scripts\deviceQa\_three_week_marathon.py")
s = importlib.util.spec_from_file_location("tw", p)
m = importlib.util.module_from_spec(s)
s.loader.exec_module(m)
xml = Path(r"c:\Users\larsf\Findus 2.0\.cursor\live6w\ui.xml").read_text(
    encoding="utf-8", errors="ignore"
)

# raw node containing Mikrofon
for n in re.findall(r"<node [^/]*?/>|<node [^>]*>", xml):
    if "Mikrofon" in n or "mikrofon" in n.lower():
        Path(r"c:\Users\larsf\Findus 2.0\.cursor\live6w\mic_raw_node.txt").write_text(
            n, encoding="utf-8"
        )
        print("RAW_LEN", len(n))
        print("clickable true?" , 'clickable="true"' in n)
        print("has bounds", "bounds=" in n)
        break
else:
    print("NO RAW NODE with Mikrofon")

nodes = list(m.nodes(xml))
print("parsed nodes", len(nodes))
for n in nodes:
    if "mikro" in (n["desc"] + n["text"]).lower():
        print("PARSED", n)
Path(r"c:\Users\larsf\Findus 2.0\.cursor\live6w\mic_debug2.txt").write_text(
    f"nodes={len(nodes)}\n"
    + "\n".join(
        f"{n['click']}|{n['desc'][:80]}|{n['text'][:40]}"
        for n in nodes
        if n["desc"] or n["text"]
    ),
    encoding="utf-8",
)
print("wrote debug2")
