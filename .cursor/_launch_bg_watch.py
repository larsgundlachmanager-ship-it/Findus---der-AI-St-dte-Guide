#!/usr/bin/env python3
"""Launch bg reconnect watcher without PowerShell path mangling."""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(r"c:\Users\larsf\Findus 2.0")
OUT = ROOT / ".cursor" / "live6w"
OUT.mkdir(parents=True, exist_ok=True)
script = ROOT / ".cursor" / "_bg_reconnect_110.py"
stdout = OUT / "reconnect-watch-stdout.log"
stderr = OUT / "reconnect-watch-stderr.log"
pidfile = OUT / "reconnect-watch.pid"

# kill previous watchers
subprocess.run(
    [
        "powershell",
        "-NoProfile",
        "-Command",
        "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" |"
        " Where-Object { $_.CommandLine -match '_bg_reconnect_110|_six_week_live' } |"
        " ForEach-Object { Stop-Process -Id $_.ProcessId -Force }",
    ],
    capture_output=True,
    text=True,
    timeout=40,
)

env = os.environ.copy()
env["FINDUS_QA_SERIAL"] = "00143157P001105"
env["ANDROID_SERIAL"] = "00143157P001105"

flags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) | getattr(
    subprocess, "DETACHED_PROCESS", 0
)
sout = stdout.open("w", encoding="utf-8", errors="replace")
serr = stderr.open("w", encoding="utf-8", errors="replace")
p = subprocess.Popen(
    [sys.executable, "-u", str(script)],
    cwd=str(ROOT),
    stdout=sout,
    stderr=serr,
    env=env,
    creationflags=flags,
    close_fds=True,
)
pidfile.write_text(str(p.pid), encoding="utf-8")
print("WATCH_PID", p.pid)
