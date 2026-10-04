from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\services\navigation\openQuiet.smoke.test.ts")
t = p.read_text(encoding="utf-8")
line = "  '../battery/survivalMode.ts',\n"
if line not in t:
    raise SystemExit("survival line missing or already gone")
p.write_text(t.replace(line, "", 1), encoding="utf-8")
print("ok")
