#!/usr/bin/env python3
"""Retry Uber taxi ask with full flight time; dump UI + logcat."""
from __future__ import annotations

import os
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(r"c:\Users\larsf\Findus 2.0")
sys.path.insert(0, str(ROOT / "scripts" / "deviceQa"))
os.environ.setdefault("FINDUS_QA_SERIAL", "ce12171cccf9c0810c")
from _device_ids import require_qa_serial  # noqa: E402

ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
OUT = ROOT / ".cursor" / "live9" / "taxi_uber"
Q = (
    "Mein Flug morgen nach Wien geht um 18 Uhr von Hamburg, "
    "bitte Taxi zum Flughafen vorbestellen"
)


def adb(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [ADB, "-s", require_qa_serial(), *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    for _ in range(2):
        adb("shell", "input", "keyevent", "4")
        time.sleep(0.6)
    adb("reverse", "tcp:8791", "tcp:8791")
    adb("logcat", "-c")
    print("ASK:", Q, flush=True)
    req = urllib.request.Request(
        "http://127.0.0.1:8791/ask",
        data=Q.encode("utf-8"),
        method="POST",
        headers={"Content-Type": "text/plain; charset=utf-8"},
    )
    with urllib.request.urlopen(req, timeout=12) as r:
        print("askServer:", r.read().decode("utf-8", "replace")[:200], flush=True)

    best = ""
    for i in range(20):
        time.sleep(5)
        adb("shell", "uiautomator", "dump", "/data/local/tmp/ui.xml")
        xml = adb("shell", "cat", "/data/local/tmp/ui.xml").stdout or ""
        hits = [k for k in ("Uber", "Taxi", "Flughafen", "Los ", "HAM", "18:") if k in xml]
        print(f"poll[{i}] hits={hits}", flush=True)
        if len(xml) > len(best):
            best = xml
        if "Uber" in hits or ("Taxi" in hits and "Flughafen" in hits):
            best = xml
            break

    (OUT / "retry-ask.xml").write_text(best, encoding="utf-8")
    shot = subprocess.check_output(
        [ADB, "-s", require_qa_serial(), "exec-out", "screencap", "-p"]
    )
    (OUT / "retry-ask.png").write_bytes(shot)

    texts = []
    for m in re.finditer(r'text="([^"]{2,})"', best):
        s = m.group(1).replace("&#10;", " ")
        if s not in texts:
            texts.append(s)
    (OUT / "retry-ask-texts.txt").write_text("\n".join(texts), encoding="utf-8")
    print("--- TEXTS ---", flush=True)
    print("\n".join(texts[:50]), flush=True)

    log = adb("logcat", "-d", "-v", "brief", "*:I").stdout or ""
    (OUT / "retry-log.txt").write_text(log, encoding="utf-8", errors="replace")
    urls = re.findall(r"https?://(?:m\.)?uber\.com/[^\s\"'<>]+", log, re.I)
    print("--- UBER URLS ---", flush=True)
    for u in urls[:10]:
        print(u[:220], flush=True)
        print("  pickup_time=", "pickup_time" in u, "reserve=", "/go/reserve" in u, flush=True)
    keys = [
        ln
        for ln in log.splitlines()
        if re.search(r"uber|pickup_time|book_uber|Taxi · Los|Flughafen", ln, re.I)
    ]
    print("--- LOG HITS ---", flush=True)
    for ln in keys[:30]:
        print(ln[:220], flush=True)

    ok = bool(urls) and any("pickup_time" in u or "/go/reserve" in u for u in urls)
    ui_ok = any(re.search(r"Uber|Taxi", t, re.I) for t in texts)
    print(f"PASS_URL={ok} UI_TAXI_UBER={ui_ok}", flush=True)
    return 0 if ok or ui_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
