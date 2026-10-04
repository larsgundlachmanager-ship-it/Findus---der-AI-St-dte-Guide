from pathlib import Path
import re

p = Path("android/app/build.gradle")
t = p.read_text(encoding="utf-8")
m = re.search(r"versionCode\s+(\d+)", t)
n = int(m.group(1)) + 1
t = re.sub(r"versionCode\s+\d+", f"versionCode {n}", t, count=1)
m2 = re.search(r'versionName\s+"([^"]+)"', t)
parts = m2.group(1).split(".")
parts[-1] = str(int(parts[-1]) + 1)
name = ".".join(parts)
t = re.sub(r'versionName\s+"[^"]+"', f'versionName "{name}"', t, count=1)
p.write_text(t, encoding="utf-8")
print(f"bumped to {n} / {name}")
