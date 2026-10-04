# -*- coding: utf-8 -*-
from pathlib import Path
import os

p = Path(__file__).resolve().parents[1] / "src/components/PlanCalendarModal.tsx"
t = p.read_text(encoding="utf-8")
old = """        if (
          g.count >= 2 &&
          next[id] === undefined &&
          userToggledGroups.current[id] == null
        ) {
          // Auch Live-ÖPNV zu — nur Kopf „Fahrt zu … · Zeiten“, Schritte per Tippen.
          next[id] = true;
          changed = true;
        }"""
new = """        if (
          (g.count >= 2 || id === 'live_journey') &&
          next[id] === undefined &&
          userToggledGroups.current[id] == null
        ) {
          // Auch Live-ÖPNV zu — nur Kopf „Fahrt zu … · Zeiten“, Schritte per Tippen.
          next[id] = true;
          changed = true;
        }"""
if old not in t:
    raise SystemExit("not found")
tmp = p.with_suffix(".tsx.tmp_patch")
tmp.write_text(t.replace(old, new, 1), encoding="utf-8", newline="\n")
os.replace(tmp, p)
print("ok")
