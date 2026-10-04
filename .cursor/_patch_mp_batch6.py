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
    "src/services/navigation/transitGuideCoach.ts",
    """  if (
    spoken.has('halt') &&
    waitSec != null &&
    waitSec <= VEHICLE_SOON_SEC &&
    waitSec >= -20 &&
    dHalt <= HALT_NEAR_M + 25
  ) {
    void speakKey('soon', vehicleSoonSpeech(facts));
  }""",
    """  // „Steig ein“ erst am Halt + Fahrzeug wirklich nah (Live: zu früh).
  if (
    spoken.has('halt') &&
    waitSec != null &&
    waitSec <= Math.min(VEHICLE_SOON_SEC, 45) &&
    waitSec >= -20 &&
    dHalt <= HALT_NEAR_M
  ) {
    void speakKey('soon', vehicleSoonSpeech(facts));
  }""",
)

patch(
    "src/services/navigation/turnComplexityClassifier.ts",
    """const COMPLEX_THRESHOLD = 35;""",
    """/** Live: Tip nur bei echt eng/viele Abzweige — nicht jeder Gabel. */
const COMPLEX_THRESHOLD = 48;""",
)

patch(
    "src/services/navigation/turnComplexityClassifier.ts",
    """  // Zwei+ Straßennamen im Fenster = Gabelung/Nebenstraße nah → unübersichtlich.
  if (roadCount >= 2) {
    score += roadCount >= 3 ? 30 : 22;
    reasons.push(
      roadCount >= 3 ? 'multi_road_intersection' : 'nearby_fork_roads',
    );
  }""",
    """  // Zwei Straßen nur mit Extra-Signal (eng gekettet) — sonst erst ab 3.
  const tightFork =
    typeof ctx.chainGapM === 'number' &&
    Number.isFinite(ctx.chainGapM) &&
    ctx.chainGapM > 0 &&
    ctx.chainGapM <= 35;
  if (roadCount >= 3) {
    score += 30;
    reasons.push('multi_road_intersection');
  } else if (roadCount >= 2 && tightFork) {
    score += 24;
    reasons.push('nearby_fork_roads');
  }""",
)

print("batch6 done")
