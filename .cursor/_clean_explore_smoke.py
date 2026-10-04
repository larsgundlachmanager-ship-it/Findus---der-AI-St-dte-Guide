from pathlib import Path
import re

p = Path("src/services/discovery/cityExploreProgress.smoke.test.ts")
s = p.read_text(encoding="utf-8")
s2 = re.sub(
    r"\n// Fremde Pack-Reste.*?assert\(mixed\.length === 3, 'mixed fixture'\);\n\}\n",
    "\n",
    s,
    flags=re.S,
)
if s2 == s:
    print("no block or already clean")
else:
    tmp = Path(".cursor/_tmp_smoke.ts")
    tmp.write_text(s2, encoding="utf-8")
    tmp.replace(p)
    print("cleaned")
