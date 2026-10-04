import re
import subprocess
from pathlib import Path

subprocess.run(["adb", "shell", "uiautomator", "dump", "/sdcard/w2.xml"], check=False)
subprocess.run(["adb", "pull", "/sdcard/w2.xml", r".cursor\live7\w2.xml"], check=False)
p = Path(r".cursor\live7\w2.xml")
if not p.exists():
    print("no xml")
else:
    t = p.read_text(encoding="utf-8", errors="ignore")
    texts = re.findall(r'text="([^"]+)"', t)
    interesting = []
    for x in texts:
        if not x.strip():
            continue
        low = x.lower()
        if any(k in low for k in ("wecker", "yo", "gestellt", "aktual", "zweiten", "schon")):
            interesting.append(x)
        elif len(x) > 8 and not x.startswith("&#"):
            interesting.append(x)
    Path(r".cursor\live7\w2-texts.txt").write_text(
        "\n".join(interesting), encoding="utf-8"
    )
    print("texts", len(interesting), "-> w2-texts.txt")
    for x in interesting[:30]:
        print(x.encode("ascii", "replace").decode())
print("----LOG----")
r = subprocess.run(
    ["adb", "logcat", "-d", "-t", "800"],
    capture_output=True,
    text=True,
    errors="ignore",
)
keys = ("FindusAlarm", "alarmService", "typed ask", "submit (main)", "ensureWake", "HandleSet")
lines = [ln for ln in (r.stdout or "").splitlines() if any(k in ln for k in keys)]
Path(r".cursor\live7\w2-logs.txt").write_text("\n".join(lines[-80:]), encoding="utf-8")
print("log hits", len(lines))
for ln in lines[-40:]:
    print(ln[:240].encode("ascii", "replace").decode())
