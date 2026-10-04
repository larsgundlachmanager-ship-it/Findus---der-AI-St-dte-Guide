# -*- coding: utf-8 -*-
"""Batch masterplan P0–P3 high-confidence patches."""
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


def patch(rel: str, old: str, new: str, *, required: bool = True) -> bool:
    path = ROOT / rel
    t = path.read_text(encoding="utf-8")
    if old not in t:
        if required:
            # already patched?
            if new.strip()[:40] in t:
                print(f"SKIP already {rel}")
                return False
            raise SystemExit(f"OLD not found in {rel}:\n{old[:120]}...")
        print(f"SKIP missing {rel}")
        return False
    force_write(path, t.replace(old, new, 1))
    return True


# --- 3) HUD unübersichtlich ---
patch(
    "src/services/navigation/navTurnHint.ts",
    """  const extra = road
    ? ` — in die ${road}`
    : landmark
      ? ` — an ${landmark}`
      : ' — unübersichtlich';""",
    """  // Complex: nur Straßen-/Landmark-Tipp in HUD — nie „unübersichtlich“.
  const extra = road
    ? ` — in die ${road}`
    : landmark
      ? ` — an ${landmark}`
      : '';""",
)

# --- 4) Sorry interrupt ---
patch(
    "src/services/AudioVoiceService.ts",
    """function withNavYieldLead(text: string): string {
  const t = text.trim();
  if (!t) return t;
  if (/unterbrech/i.test(t) || /^\\s*sorry\\b/i.test(t)) return t;
  const body = t.charAt(0).toLowerCase() + t.slice(1);
  return `Sorry, dass ich kurz unterbreche — ${body}`;
}""",
    """function withNavYieldLead(text: string): string {
  // Kein „Sorry, dass ich unterbreche“ — Cue direkt (Live-Test: nervt stark).
  return text.trim();
}""",
)

# --- Fog trail: thicker, no glow ---
patch(
    "src/services/homeMap/homeMapStyle.ts",
    """/** Nav-Trail (A): Glow + Kern — kein Abdunkeln, nur Spur. */
export const HOME_MAP_FOG_TRAIL_CORE_WIDTH = 5;
export const HOME_MAP_FOG_TRAIL_GLOW_WIDTH = 14;
export const HOME_MAP_FOG_TRAIL_CORE_OPACITY = 0.55;
export const HOME_MAP_FOG_TRAIL_GLOW_OPACITY = 0.22;""",
    """/** Nav-Trail (A): nur Kernlinie — dicker, ohne Glow, kein Alpha-Stack. */
export const HOME_MAP_FOG_TRAIL_CORE_WIDTH = 10;
export const HOME_MAP_FOG_TRAIL_GLOW_WIDTH = 0;
export const HOME_MAP_FOG_TRAIL_CORE_OPACITY = 0.72;
export const HOME_MAP_FOG_TRAIL_GLOW_OPACITY = 0;""",
)

# --- Wrong-way: damp at walk_to_stop ---
patch(
    "src/services/navigation/wrongWayMonitor.ts",
    """const ON_ROUTE_M = 18;
/** Default Off-Path (Fuß). Caller kann bike ~90 m via offPathMinM setzen. */
const OFF_PATH_MIN_M = 32;
/** Vor der Warnung: so weit aktiv weg von der Route. */
const ACTIVE_WRONG_WALK_M = 18;""",
    """const ON_ROUTE_M = 22;
/** Default Off-Path (Fuß). Caller kann bike ~90 m via offPathMinM setzen. */
const OFF_PATH_MIN_M = 48;
/** Vor der Warnung: so weit aktiv weg von der Route. */
const ACTIVE_WRONG_WALK_M = 28;""",
)

# --- mirrorTour: don't open calendar for start_nav_now ---
patch(
    "src/module2/tour/mirrorTourToTimeline.ts",
    """    requestOpenPlanCalendar();
  } catch {
    /* soft */
  }

  return inserted;
}""",
    """    // Hard/short Nav: still spiegeln, Timeline NICHT aufklappen.
    if (req.uiLayout === 'timeline_stack') {
      requestOpenPlanCalendar();
    }
  } catch {
    /* soft */
  }

  return inserted;
}""",
)

print("batch1 done")
