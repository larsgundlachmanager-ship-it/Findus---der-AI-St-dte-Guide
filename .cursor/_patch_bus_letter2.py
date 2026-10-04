# -*- coding: utf-8 -*-
from pathlib import Path
import os

ROOT = Path(__file__).resolve().parents[1]


def write_atomic(p: Path, text: str) -> None:
    tmp = p.with_suffix(p.suffix + ".tmp_patch")
    tmp.write_text(text, encoding="utf-8", newline="\n")
    os.replace(tmp, p)


p = ROOT / "src/module2/timeline/liveTourSchedule.smoke.test.ts"
t = p.read_text(encoding="utf-8")
old = """assert(
  /gleis/i.test(hbfZob[zobIdx]?.badge || hbfZob[zobIdx - 1]?.badge || ''),
  'Gleis am ZOB, nicht Steig/Abfahrt-N',
);"""
new = """assert(
  /abfahrtsbereich\\s*b/i.test(hbfZob[zobIdx]?.badge || hbfZob[zobIdx - 1]?.badge || ''),
  'Bus-ZOB: Abfahrtsbereich B, kein Fake-Gleis',
);
assert(
  !/gleis/i.test(hbfZob[zobIdx]?.badge || ''),
  'ZOB-Stop ohne Gleis-Label',
);"""
if old not in t:
    raise SystemExit("smoke old not found")
write_atomic(p, t.replace(old, new, 1))
print("ok smoke")

p = ROOT / "src/services/navigation/navRouteMapPayload.ts"
t = p.read_text(encoding="utf-8")
old = """  if (isBusVehicle(mode)) return '';
  return `Gleis ${p}`;
}"""
new = """  if (isBusVehicle(mode)) {
    if (/^[A-Za-z]$/.test(p)) return `Abfahrtsbereich ${p.toUpperCase()}`;
    return '';
  }
  return `Gleis ${p}`;
}"""
if old not in t:
    raise SystemExit("payload old not found")
write_atomic(p, t.replace(old, new, 1))
print("ok payload")
