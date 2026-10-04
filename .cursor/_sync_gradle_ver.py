from pathlib import Path
import re

p = Path("android/app/build.gradle")
s = p.read_text(encoding="utf-8")
s2 = re.sub(r"versionCode\s+\d+", "versionCode 131", s)
s2 = re.sub(r'versionName\s+"[^"]+"', 'versionName "2.0.104"', s2)
tmp = Path(".cursor/_build_gradle_ver.gradle")
tmp.write_text(s2, encoding="utf-8")
tmp.replace(p)
print("ok")
for line in p.read_text(encoding="utf-8").splitlines():
    if "versionCode" in line or "versionName" in line:
        if "defaultConfig" in line or line.strip().startswith("version"):
            print(line.strip())
