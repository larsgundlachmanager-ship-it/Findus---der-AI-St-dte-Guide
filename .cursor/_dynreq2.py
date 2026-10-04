from pathlib import Path
import re

root = Path(r"C:\Users\larsf\Findus 2.0\src")
out = []
for p in root.rglob("*.ts*"):
    try:
        lines = p.read_text(encoding="utf-8").splitlines()
    except Exception:
        continue
    for i, line in enumerate(lines, 1):
        if "require(" not in line:
            continue
        s = line.strip()
        if s.startswith("//") or s.startswith("*"):
            continue
        # skip string-literal requires on same line
        if re.search(r"require\(\s*['\"]", line):
            continue
        out.append(f"{p.as_posix()}:{i}:{s[:160]}")

Path(r"C:\Users\larsf\Findus 2.0\.cursor\live6w\dyn_req2.txt").write_text(
    "\n".join(out), encoding="utf-8"
)
print(len(out))
for x in out[:40]:
    print(x)
