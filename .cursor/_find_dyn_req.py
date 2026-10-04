import re
from pathlib import Path

root = Path(r"C:\Users\larsf\Findus 2.0\src")
out = Path(r"C:\Users\larsf\Findus 2.0\.cursor\live6w\dyn_requires.txt")
lines_out = []
for p in root.rglob("*"):
    if p.suffix not in {".ts", ".tsx", ".js", ".jsx"}:
        continue
    try:
        t = p.read_text(encoding="utf-8")
    except Exception:
        continue
    for i, line in enumerate(t.splitlines(), 1):
        if "require(" not in line:
            continue
        s = line.strip()
        if s.startswith("//") or s.startswith("*"):
            continue
        if re.search(r"require\(\s*['\"]", line):
            continue
        if "require()" in line.replace(" ", ""):
            continue
        lines_out.append(f"{p.relative_to(root)}:{i}:{s[:180]}")

out.write_text("\n".join(lines_out[:200]), encoding="utf-8")
print(f"wrote {len(lines_out)} hits")
