from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\services\homeMap\homeMapNavStart.ts")
t = p.read_text(encoding="utf-8")
t = t.replace("kein addPlanStop", "kein Plan-Duplikat")
t = t.replace(
    "Timeline nur Live-Spiegel (kein Plan-Duplikat).",
    "Timeline nur ueber Live-Nav-Spiegel.",
)
tmp = Path(r"c:\Users\larsf\Findus 2.0\.cursor\_h2.ts")
tmp.write_text(t, encoding="utf-8", newline="\n")
try:
    p.unlink()
except Exception as e:
    print(e)
p.write_bytes(tmp.read_bytes())
print("addPlanStop left", "addPlanStop" in p.read_text(encoding="utf-8"))
