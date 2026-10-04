from pathlib import Path
import re
import subprocess

OUT = Path(r"C:\Users\larsf\Findus 2.0\.cursor\live7")
p = OUT / "choice725.xml"
t = p.read_text(encoding="utf-8", errors="ignore") if p.exists() else ""
texts = re.findall(r'text="([^"]+)"', t)
(OUT / "choice725-texts.txt").write_text(
    "\n".join([x for x in texts if x.strip()][:80]), encoding="utf-8"
)
print("Aktual", "Aktualisieren" in t)
print("Zweiten", "Zweiten" in t)
print("725", "07:25" in t or "7:25" in t)
print("632", "06:32" in t or "6:32" in t)
print("wrote choice725-texts.txt", len(texts))

r = subprocess.run(
    [
        r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe",
        "-s",
        "00143157P001105",
        "logcat",
        "-d",
        "-t",
        "5000",
    ],
    capture_output=True,
    text=True,
    errors="ignore",
)
hits = [ln for ln in (r.stdout or "").splitlines() if "FindusAlarm" in ln]
(OUT / "replace-findusalarm.txt").write_text("\n".join(hits[-80:]), encoding="utf-8")
print("FindusAlarm lines", len(hits))
for ln in hits[-20:]:
    print(ln.encode("ascii", "replace").decode())
