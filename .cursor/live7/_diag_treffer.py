import re
import subprocess
from pathlib import Path

out = Path(r".cursor/live7")
out.mkdir(parents=True, exist_ok=True)

r = subprocess.run(
    ["adb", "logcat", "-d", "-t", "2500"],
    capture_output=True,
    text=True,
    errors="ignore",
)
keys = (
    "Treffer",
    "keine",
    "Wecker",
    "FindusAlarm",
    "alarmService",
    "dismiss",
    "DISMISS",
    "typed ask",
    "devAskPoller",
    "submit (main)",
    "ReactNativeJS",
    "softFail",
    "HardMatch",
    "city search",
    "CitySearch",
    "pack",
)
lines = []
for ln in (r.stdout or "").splitlines():
    if any(k.lower() in ln.lower() for k in keys):
        if "bluetooth" in ln.lower() or "APM_Audio" in ln:
            continue
        lines.append(ln)
(out / "treffer-logs.txt").write_text("\n".join(lines[-120:]), encoding="utf-8")
print("log hits", len(lines))
for ln in lines[-40:]:
    print(ln[:240].encode("ascii", "replace").decode())

subprocess.run(["adb", "shell", "uiautomator", "dump", "/sdcard/now.xml"], check=False)
subprocess.run(["adb", "pull", "/sdcard/now.xml", str(out / "now-treffer.xml")], check=False)
p = out / "now-treffer.xml"
if p.exists():
    t = p.read_text(encoding="utf-8", errors="ignore")
    texts = re.findall(r'text="([^"]+)"', t)
    descs = re.findall(r'content-desc="([^"]+)"', t)
    interesting = []
    for x in texts + descs:
        if not x.strip():
            continue
        low = x.lower()
        if any(
            k in low
            for k in (
                "treffer",
                "wecker",
                "gestell",
                "yo",
                "alles klar",
                "schon",
                "aktual",
                "suche",
                "kein",
                "stadt",
                "uhr",
            )
        ):
            interesting.append(x)
    (out / "now-treffer-texts.txt").write_text(
        "\n".join(dict.fromkeys(interesting)), encoding="utf-8"
    )
    print("---- UI interesting ----")
    for x in interesting[:40]:
        print(x.encode("ascii", "replace").decode())
else:
    print("no ui dump")
