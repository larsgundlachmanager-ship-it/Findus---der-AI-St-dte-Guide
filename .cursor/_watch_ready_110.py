#!/usr/bin/env python3
"""Watch suite log until past app_ready (or timeout)."""
from __future__ import annotations

import re
import subprocess
import time
from pathlib import Path

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
LOG = Path(r"c:\Users\larsf\Findus 2.0\.cursor\live6w\full-run-110.log")
PID_FILE = Path(r"c:\Users\larsf\Findus 2.0\.cursor\live6w\suite.pid")


def main() -> None:
    # reconnect check
    r = subprocess.run([ADB, "devices", "-l"], capture_output=True, text=True)
    print("DEVICES:\n", r.stdout)
    deadline = time.time() + 240
    last_len = 0
    while time.time() < deadline:
        text = LOG.read_text(encoding="utf-8", errors="ignore") if LOG.exists() else ""
        if len(text) != last_len:
            last_len = len(text)
            print("--- log grow", last_len, "---")
            print(text[-1800:])
        # Past ready markers
        if re.search(r"WARN app_ready_timeout", text):
            print("STATUS: saw app_ready_timeout")
        if re.search(
            r"WARN poller_not_seen|\[devAskPoller\]|PASS|FAIL|ASK_FAIL|"
            r"waiting_spick|Spickzettel|NO_MODAL|poller_not_seen|"
            r"ask_posted|ASK_OK|bridge|call2",
            text,
            re.I,
        ):
            print("STATUS: past-ready signal")
            print(text[-2200:])
            return
        # Second scenario started => first reset completed
        if len(re.findall(r"^=== ", text, re.M)) >= 2:
            print("STATUS: second scenario — first reset finished")
            print(text[-2200:])
            return
        # Process dead?
        try:
            pid = int(PID_FILE.read_text().strip())
            subprocess.run(
                ["powershell", "-NoProfile", "-Command", f"Get-Process -Id {pid} | Out-Null"],
                check=True,
                capture_output=True,
            )
        except Exception:
            print("STATUS: suite process gone")
            print(text[-2200:])
            return
        time.sleep(3)
    print("STATUS: watch timeout")
    print(LOG.read_text(encoding="utf-8", errors="ignore")[-2500:])


if __name__ == "__main__":
    main()
