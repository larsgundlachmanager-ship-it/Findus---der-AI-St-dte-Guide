import re
import subprocess
import time
from pathlib import Path

subprocess.run(
    ["adb", "shell", "am", "start", "-n", "de.findus.app/.MainActivity"],
    check=False,
)
time.sleep(2)
subprocess.run(
    [
        "curl.exe",
        "-s",
        "-X",
        "POST",
        "http://127.0.0.1:8791/ask",
        "--data-binary",
        "Stell einen Wecker um 7:05",
    ],
    check=False,
)
time.sleep(22)
subprocess.run(["adb", "shell", "uiautomator", "dump", "/sdcard/w3.xml"], check=False)
subprocess.run(["adb", "pull", "/sdcard/w3.xml", r".cursor\live7\w3.xml"], check=False)
t = Path(r".cursor\live7\w3.xml").read_text(encoding="utf-8", errors="ignore")
texts = re.findall(r'text="([^"]+)"', t)
Path(r".cursor\live7\w3-texts.txt").write_text("\n".join(x for x in texts if x.strip()), encoding="utf-8")
keys = ("wecker", "yo", "gestellt", "schon", "aktual", "7:05", "07:05", "ging", "zweiten")
print("---- interesting ----")
for x in texts:
    low = x.lower()
    if any(k in low for k in keys) or "Uhr" in x:
        print(x.encode("ascii", "replace").decode())
