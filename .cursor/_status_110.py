#!/usr/bin/env python3
from pathlib import Path
import subprocess

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
OUT = Path(r"c:\Users\larsf\Findus 2.0\.cursor\live6w")
print(subprocess.run([ADB, "devices", "-l"], capture_output=True, text=True).stdout)
pidf = OUT / "suite.pid"
print("pidfile", pidf.read_text(encoding="utf-8").strip() if pidf.exists() else None)
if pidf.exists():
    pid = int(pidf.read_text().strip())
    r = subprocess.run(
        ["tasklist", "/FI", f"PID eq {pid}"], capture_output=True, text=True
    )
    print(r.stdout)
print("--- log ---")
print((OUT / "full-run-110.log").read_text(encoding="utf-8", errors="ignore") if (OUT / "full-run-110.log").exists() else "none")
