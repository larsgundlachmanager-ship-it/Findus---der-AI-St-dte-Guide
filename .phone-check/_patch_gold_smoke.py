from pathlib import Path

p = Path(r"src/module2/router/call1ThinkFrame.smoke.test.ts")
t = p.read_text(encoding="utf-8")
if "gold transfer" in t:
    print("already")
    raise SystemExit(0)
needle = "assert(/FRAGE-ART|Reise AN SICH|VOR ORT/i.test(FINDUS_CALL1_THINK_FRAME), 'trip vs whats-on discrimination');"
add = (
    needle
    + "\n  assert(/Situations-Muster|ungetestete Formulierungen/i.test(FINDUS_CALL1_THINK_FRAME), 'gold transfer');"
)
if needle not in t:
    raise SystemExit("needle missing")
p.write_text(t.replace(needle, add, 1), encoding="utf-8")
print("ok")
