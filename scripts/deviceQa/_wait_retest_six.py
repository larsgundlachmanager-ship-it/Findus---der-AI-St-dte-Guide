#!/usr/bin/env python3
"""Wait for QA adb device, then retest the 6 founder-must fails (max 4 attempts each)."""
from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _device_ids import require_qa_serial  # noqa: E402

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
ROOT = Path(r"c:\Users\larsf\Findus 2.0")
PY = sys.executable
IDS = [
    "flug_morgen_ham",
    "taxi_vorbestellen_morgen",
    "theater_heute",
    "gastro_aussicht_flair",
    "hotel_spezifisch",
    "zahnbuerste_erinnerung",
]


def adb(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [ADB, "-s", require_qa_serial(), *args], capture_output=True, text=True
    )


def has_device() -> bool:
    serial = require_qa_serial()
    r = subprocess.run([ADB, "devices"], capture_output=True, text=True)
    return any(
        line.startswith(serial + "\t") and line.endswith("\tdevice")
        for line in (r.stdout or "").splitlines()
    )


def main() -> int:
    print("Waiting for adb device…", flush=True)
    for i in range(120):  # up to ~10 min
        if has_device():
            print("DEVICE_OK", flush=True)
            break
        time.sleep(5)
        if i % 6 == 0:
            print(f"still waiting ({i*5}s)", flush=True)
    else:
        print("ERROR: no device after 10 min", flush=True)
        return 2

    adb("reverse", "tcp:8791", "tcp:8791")
    adb("reverse", "tcp:8081", "tcp:8081")
    adb("shell", "am", "force-stop", "de.findus.app")
    time.sleep(1)
    adb(
        "shell",
        "am",
        "start",
        "-a",
        "android.intent.action.VIEW",
        "-d",
        "exp+findus://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081",
        "de.findus.app",
    )
    time.sleep(14)

    cmd = [
        PY,
        str(ROOT / "scripts" / "deviceQa" / "_night100_abschluss.py"),
        "--max-attempts",
        "4",
        "--only",
        *IDS,
    ]
    print("RUN", " ".join(cmd), flush=True)
    return subprocess.call(cmd, cwd=str(ROOT))


if __name__ == "__main__":
    raise SystemExit(main())
