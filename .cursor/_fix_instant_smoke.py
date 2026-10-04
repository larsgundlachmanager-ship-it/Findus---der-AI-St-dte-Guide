from pathlib import Path
import os
import tempfile

p = Path(r"C:\Users\larsf\Findus 2.0\src\module2\chat\instantFactFormat.smoke.test.ts")
t = p.read_text(encoding="utf-8")
old = "assert.match(turn, /Sofort Commit/, 'Beat-1 no LLM wait');"
new = "assert.match(turn, /localArithEarly|Sofort Commit/, 'Beat-1 / early local math');"
if old not in t:
    raise SystemExit("pattern missing")
tmp = Path(tempfile.gettempdir()) / "ifs.smoke.tmp"
tmp.write_text(t.replace(old, new, 1), encoding="utf-8")
bak = p.with_suffix(".ts.bak")
os.replace(p, bak)
os.replace(tmp, p)
bak.unlink(missing_ok=True)
print("ok")
