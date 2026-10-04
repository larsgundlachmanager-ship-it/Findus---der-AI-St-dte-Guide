#!/usr/bin/env python3
"""Stop leftover phase76 QA process if still running."""
from __future__ import annotations

import subprocess
import time

# Kill by window title / command line match
ps = (
    "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | "
    "Where-Object { $_.CommandLine -match 'phase76_reisebuero|rb_magazine' } | "
    "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $_.ProcessId }"
)
r = subprocess.run(
    ["powershell", "-NoProfile", "-Command", ps],
    capture_output=True,
    text=True,
    encoding="utf-8",
    errors="replace",
)
print("killed:", (r.stdout or "").strip() or "(none)")
print("err:", (r.stderr or "").strip()[:200])
time.sleep(1.5)
