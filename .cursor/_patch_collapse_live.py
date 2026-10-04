# -*- coding: utf-8 -*-
from pathlib import Path
import os

ROOT = Path(__file__).resolve().parents[1]


def write_atomic(p: Path, text: str) -> None:
    tmp = p.with_suffix(p.suffix + ".tmp_patch")
    tmp.write_text(text, encoding="utf-8", newline="\n")
    os.replace(tmp, p)


p = ROOT / "src/components/PlanCalendarModal.tsx"
t = p.read_text(encoding="utf-8")
old = """        if (
          g.count >= 2 &&
          next[id] === undefined &&
          userToggledGroups.current[id] == null
        ) {
          // Geplante ÖPNV/Flug-Gruppen zu — Live-Fahrt bleibt offen.
          if (id !== 'live_journey') {
            next[id] = true;
            changed = true;
          } else if (
            g.endMs != null &&
            g.endMs < Date.now() - 5 * 60_000
          ) {
            next[id] = true;
            changed = true;
          }
        }"""
new = """        if (
          g.count >= 2 &&
          next[id] === undefined &&
          userToggledGroups.current[id] == null
        ) {
          // Auch Live-ÖPNV zu — nur Kopf „Fahrt zu … · Zeiten“, Schritte per Tippen.
          next[id] = true;
          changed = true;
        }"""
if old not in t:
    raise SystemExit("collapse old not found")
write_atomic(p, t.replace(old, new, 1))
print("ok default collapse live")
