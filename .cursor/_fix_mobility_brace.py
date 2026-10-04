from pathlib import Path

p = Path(r"C:\Users\larsf\Findus 2.0\src\constants\conciergePrefs.ts")
tmp = Path(str(p) + ".new")
t = p.read_text(encoding="utf-8")
t2 = t.replace(
    "{ id: 'car', label: 'Auto', hint: 'Mietwagen / eigenes Auto' },\n};",
    "{ id: 'car', label: 'Auto', hint: 'Mietwagen / eigenes Auto' },\n];",
)
if t2 == t:
    raise SystemExit("pattern not found")
tmp.write_text(t2, encoding="utf-8")
print("fixed")
