from pathlib import Path
import re

p = Path("src/components/homeMap/nativeHomeMap.smoke.test.ts")
s = p.read_text(encoding="utf-8")
neu = """assert(
  explore.includes('needleNorth') &&
    explore.includes('needleSouth') &&
    explore.includes('compassDial'),
  'Kompass ist klassische Nadel (rot/weiss)',
);
assert(
  explore.includes('Kompass kalibrieren') &&
    explore.includes('btnCalibrate') &&
    !explore.includes('showCalibrate ?'),
  'Acht-Button immer sichtbar',
);"""
m = re.search(
    r"assert\(\s*explore\.includes\('compassN'\).*?'Acht-Button nur bei Kalibrierung',\s*\);",
    s,
    re.S,
)
if not m:
    raise SystemExit("anchor missing")
out = s[: m.start()] + neu + s[m.end() :]
tmp = Path(".cursor/_smoke_tmp.ts")
tmp.write_text(out, encoding="utf-8")
tmp.replace(p)
print("patched")
