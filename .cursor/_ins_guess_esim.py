from pathlib import Path

p = Path(r"c:\Users\larsf\Findus 2.0\src\reisebuero\research\funnel.ts")
t = p.read_text(encoding="utf-8")
if "function guessEsimCountrySlug" in t:
    print("defined ok")
    raise SystemExit(0)

sn = Path(r"c:\Users\larsf\Findus 2.0\.cursor\_guess_esim_snippet.ts").read_text(encoding="utf-8")
mark = "const {\n    buyInFromParts,\n    buildDayPlans,"
if mark not in t:
    raise SystemExit("mark missing")
t = t.replace(mark, sn + "\n\n" + mark, 1)
tmp, bak = p.with_suffix(".ts.__new"), p.with_suffix(".ts.__bak")
tmp.write_text(t, encoding="utf-8")
if bak.exists():
    bak.unlink()
p.rename(bak)
tmp.rename(p)
bak.unlink(missing_ok=True)
print("inserted")
