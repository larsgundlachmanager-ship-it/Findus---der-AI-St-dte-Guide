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


# hinter → an (Live: Ziel lag VOR dem Wartehäuschen)
patch(
    "src/services/navigation/spatialOrientation.ts",
    """    if (kind === 'alley') {
      return scrubRoboticNavSpeak(
        `Hinter ${land} durch die schmale Gasse ${turn}.`,
      );
    }
    const alley =
      turn.includes('links') || turn.includes('rechts')
        ? ` Da musst du ${turn} durch.`
        : '';
    return scrubRoboticNavSpeak(
      `Hinter ${land} biegen wir gleich ${turn} ab.${alley}`,
    );""",
    """    if (kind === 'alley') {
      return scrubRoboticNavSpeak(
        `An ${land} durch die schmale Gasse ${turn}.`,
      );
    }
    // Default „an“ — nie pauschal „hinter“ (Live: Ziel lag davor).
    return scrubRoboticNavSpeak(
      `An ${land} ${turn} abbiegen.`,
    );""",
)

# Landmark dedup in cueScheduler — skip same landmark twice in a row
p = ROOT / "src/services/navigation/handsFreeNav/cueScheduler.ts"
t = p.read_text(encoding="utf-8")
if "lastSpokenLandmarkKey" not in t:
    # add module-level state near top after imports - find a good anchor
    anchor = "export type "
    # simpler: patch the landmark speak block
    old = """  if (landmark && turn !== 'geradeaus') {
    return scrubRoboticNavSpeak(
      buildLandmarkFirstCue({
        landmark,
        relation: {
          side: 'front',
          bearingRelDeg: 0,
          sidePhrase: 'voraus',
          shortPhrase: 'vor dir',
        },
        turn,
        roadName: opts.roadName,
        visualKind,
      }),
    );
  }"""
    new = """  if (landmark && turn !== 'geradeaus') {
    const landKey = landmark.trim().toLowerCase();
    try {
      const g = globalThis as { __findusLastNavLandmark?: string };
      if (g.__findusLastNavLandmark === landKey) {
        landmark = null;
      } else {
        g.__findusLastNavLandmark = landKey;
      }
    } catch {
      /* soft */
    }
  }
  if (landmark && turn !== 'geradeaus') {
    return scrubRoboticNavSpeak(
      buildLandmarkFirstCue({
        landmark,
        relation: {
          side: 'front',
          bearingRelDeg: 0,
          sidePhrase: 'voraus',
          shortPhrase: 'vor dir',
        },
        turn,
        roadName: opts.roadName,
        visualKind,
      }),
    );
  }"""
    if old in t:
        force_write(p, t.replace(old, new, 1))
    else:
        print("MISS cueScheduler landmark block")
else:
    print("SKIP cueScheduler dedup already")

print("batch7 done")
