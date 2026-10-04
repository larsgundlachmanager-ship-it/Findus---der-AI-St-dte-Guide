import subprocess
import time
import re
from pathlib import Path

ADB = Path.home() / "AppData/Local/Android/Sdk/platform-tools/adb.exe"
ROOT = Path(r"c:\Users\larsf\Findus 2.0")
OUT = ROOT / ".cursor/live9"


def adb(*args):
    return subprocess.run(
        [str(ADB), *args], capture_output=True, text=True, encoding="utf-8", errors="ignore"
    )


print("launch", adb("shell", "monkey", "-p", "de.findus.app", "-c", "android.intent.category.LAUNCHER", "1").stdout)
time.sleep(6)
adb("reverse", "tcp:8791", "tcp:8791")
ask = subprocess.run(
    ["node", str(ROOT / "scripts/deviceQa/ask.mjs"), "Ich moechte heute Abend all you can eat essen, aber kein Asiatisch. Was empfiehlst du?"],
    capture_output=True,
    text=True,
    cwd=str(ROOT),
)
print("ask", ask.stdout, ask.stderr)
time.sleep(60)
adb("shell", "uiautomator", "dump", "/sdcard/ui.xml")
adb("pull", "/sdcard/ui.xml", str(OUT / "ideal-ayce-ui2.xml"))
t = (OUT / "ideal-ayce-ui2.xml").read_text(encoding="utf-8", errors="ignore")
texts = [x for x in re.findall(r'text="([^"]+)"', t) if len(x) > 2]
(OUT / "ideal-ayce-texts2.txt").write_text("\n".join(texts), encoding="utf-8")
print("--- UI ---")
print("\n".join(texts[:120]))
blob = "\n".join(texts).lower()
print("HAS_GOLDSCH", "goldsch" in blob)
print("HAS_AYCE_HINT", any(k in blob for k in ["buffet", "all you", "unbegrenzt", "ayce", "kein"]))
