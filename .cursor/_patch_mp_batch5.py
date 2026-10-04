# -*- coding: utf-8 -*-
from __future__ import annotations

import os
import shutil
import time
from pathlib import Path

ROOT = Path(r"c:\Users\larsf\Findus 2.0")


def force_write(path: Path, content: str) -> None:
    path = Path(path)
    tmp = path.with_suffix(path.suffix + f".tmp{os.getpid()}")
    bak = path.with_suffix(path.suffix + ".bak_mp")
    tmp.write_text(content, encoding="utf-8")
    for i in range(10):
        try:
            if path.exists():
                try:
                    if bak.exists():
                        bak.unlink()
                except OSError:
                    pass
                try:
                    path.replace(bak)
                except OSError:
                    shutil.copy2(path, bak)
                    path.unlink(missing_ok=True)
            os.replace(tmp, path)
            try:
                if bak.exists():
                    bak.unlink()
            except OSError:
                pass
            print(f"OK {path.relative_to(ROOT)}")
            return
        except OSError as e:
            print(f"  retry {i+1} {path.name}: {e}")
            time.sleep(0.35)
    raise SystemExit(f"FAILED {path}")


def patch(rel: str, old: str, new: str) -> None:
    path = ROOT / rel
    t = path.read_text(encoding="utf-8")
    if old not in t:
        print(f"MISS {rel}")
        return
    force_write(path, t.replace(old, new, 1))


patch(
    "src/services/navigation/stationCountdown.ts",
    """  // Mode-Dip walk in Bahn: Phase in_transit reicht für HUD/Speech.
  if (!isTransitMode(opts.transportMode) && !riding(opts.navPhase ?? null)) {
    return;
  }
  if (!riding(opts.navPhase ?? null) && !isTransitMode(opts.transportMode)) {
    return;
  }
  if (!riding(opts.navPhase ?? null)) return;""",
    """  // Mode-Dip walk in Bahn: Phase in_transit reicht.
  if (!riding(opts.navPhase ?? null)) return;""",
)

# Tighten vehicleSoon — read exact lines first via python
p = ROOT / "src/services/navigation/transitGuideCoach.ts"
t = p.read_text(encoding="utf-8")
# Find vehicleSoon block
idx = t.find("void speakKey('soon', vehicleSoonSpeech(facts));")
print("soon idx", idx)
print(t[idx-400:idx+80] if idx > 0 else "not found")
