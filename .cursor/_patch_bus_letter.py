# -*- coding: utf-8 -*-
from pathlib import Path
import os

ROOT = Path(__file__).resolve().parents[1]


def write_atomic(p: Path, text: str) -> None:
    tmp = p.with_suffix(p.suffix + ".tmp_patch")
    tmp.write_text(text, encoding="utf-8", newline="\n")
    os.replace(tmp, p)


def patch(path: str, old: str, new: str, label: str) -> None:
    p = ROOT / path
    t = p.read_text(encoding="utf-8")
    if old not in t:
        raise SystemExit(f"FAIL {label}")
    write_atomic(p, t.replace(old, new, 1))
    print(f"ok {label}")


BUS_NULL = """  if (bus) return null;
  return `Gleis ${p}`;
}"""

BUS_LETTER = """  if (bus) {
    // Busbahnhof-Buchstaben (A/B/C) = Abfahrtsbereich; nackte Ziffern weglassen.
    if (/^[A-Za-z]$/.test(p)) return `Abfahrtsbereich ${p.toUpperCase()}`;
    return null;
  }
  return `Gleis ${p}`;
}"""

for rel in (
    "src/module2/timeline/liveTourSchedule.ts",
    "src/module2/timeline/plannedJourneyGroup.ts",
    "src/services/navigation/navRouteMapPayload.ts",
):
    patch(rel, BUS_NULL, BUS_LETTER, f"bus letter {rel}")

patch(
    "src/module2/timeline/liveTourSchedule.smoke.test.ts",
    """assert(
  /gleis/i.test(hbfZob[zobIdx]?.badge || hbfZob[zobIdx - 1]?.badge || ''),
  'Gleis am ZOB, nicht Steig/Abfahrt-N',
);""",
    """assert(
  /abfahrtsbereich\\s*b/i.test(hbfZob[zobIdx]?.badge || hbfZob[zobIdx - 1]?.badge || ''),
  'Bus-ZOB: Abfahrtsbereich B, kein Fake-Gleis',
);
assert(
  !/gleis/i.test(hbfZob[zobIdx]?.badge || ''),
  'ZOB-Stop ohne Gleis-Label',
);""",
    "smoke zob",
)

print("done")
