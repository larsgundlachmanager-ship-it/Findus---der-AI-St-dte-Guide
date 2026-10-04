#!/usr/bin/env python3
"""Background: wait for USB device, then dump/ready-check and restart 110 suite."""
from __future__ import annotations

import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(r"c:\Users\larsf\Findus 2.0")
ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
OUT = ROOT / ".cursor" / "live6w"
LOG = OUT / "full-run-110.log"
PID_FILE = OUT / "suite.pid"
WATCH_LOG = OUT / "reconnect-watch.log"
ASK = ROOT / "scripts" / "deviceQa" / "askServer.mjs"
SUITE = ROOT / "scripts" / "deviceQa" / "_six_week_live.py"
PREFERRED = "00143157P001105"


def log(msg: str) -> None:
    line = f"{time.strftime('%H:%M:%S')} {msg}"
    print(line, flush=True)
    with WATCH_LOG.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def devices() -> list[str]:
    r = subprocess.run([ADB, "devices"], capture_output=True, text=True)
    out = []
    for ln in (r.stdout or "").splitlines():
        parts = ln.split()
        if len(parts) >= 2 and parts[1] == "device":
            out.append(parts[0])
    return out


def kill_suite() -> None:
    subprocess.run(
        [
            "powershell",
            "-NoProfile",
            "-Command",
            "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" |"
            " Where-Object { $_.CommandLine -match '_six_week_live|_reconnect_restart|_ready_restart' } |"
            " ForEach-Object { Stop-Process -Id $_.ProcessId -Force }",
        ],
        capture_output=True,
        text=True,
        timeout=40,
    )


def ensure_ask() -> None:
    try:
        with urllib.request.urlopen("http://127.0.0.1:8791/health", timeout=2) as res:
            if res.status == 200:
                return
    except Exception:
        pass
    flags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) | getattr(
        subprocess, "DETACHED_PROCESS", 0
    )
    with (OUT / "ask-server-110.log").open("ab") as lf:
        subprocess.Popen(
            ["node", str(ASK)],
            cwd=str(ROOT),
            stdout=lf,
            stderr=lf,
            creationflags=flags,
            close_fds=True,
        )
    time.sleep(1.2)


def start_suite(serial: str) -> int:
    kill_suite()
    time.sleep(1)
    LOG.write_text("", encoding="utf-8")
    env = os.environ.copy()
    env["ANDROID_SERIAL"] = serial
    env["FINDUS_QA_SERIAL"] = serial
    lf = LOG.open("a", encoding="utf-8", errors="replace")
    flags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    p = subprocess.Popen(
        [sys.executable, "-u", str(SUITE)],
        cwd=str(ROOT),
        stdout=lf,
        stderr=subprocess.STDOUT,
        env=env,
        creationflags=flags,
    )
    PID_FILE.write_text(str(p.pid), encoding="utf-8")
    return p.pid


def analyze_and_ready(serial: str) -> bool:
    import importlib.util

    os.environ["FINDUS_QA_SERIAL"] = serial
    os.environ["ANDROID_SERIAL"] = serial
    subprocess.run(
        [ADB, "-s", serial, "shell", "am", "force-stop", "com.google.android.googlequicksearchbox"],
        capture_output=True,
    )
    subprocess.run(
        [
            ADB,
            "-s",
            serial,
            "shell",
            "monkey",
            "-p",
            "de.findus.app",
            "-c",
            "android.intent.category.LAUNCHER",
            "1",
        ],
        capture_output=True,
    )
    time.sleep(8)
    remote = "/data/local/tmp/findus_ui.xml"
    subprocess.run(
        [ADB, "-s", serial, "shell", "uiautomator", "dump", remote],
        capture_output=True,
    )
    local = OUT / "ui_ready_dump.xml"
    subprocess.run([ADB, "-s", serial, "pull", remote, str(local)], capture_output=True)
    xml = local.read_text(encoding="utf-8", errors="ignore") if local.exists() else ""
    log(f"xml_bytes={len(xml)}")
    spec = importlib.util.spec_from_file_location(
        "tw", ROOT / "scripts" / "deviceQa" / "_three_week_marathon.py"
    )
    tw = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(tw)
    tw.OUT = OUT
    tw.XML = OUT / "ui.xml"
    blob = tw._ui_blob(xml)
    log("BLOB:\n" + blob[:1500])
    mic = any(tw._looks_like_mic(n) for n in tw.nodes(xml))
    chrome = tw._looks_like_home_chrome(blob.lower())
    log(f"mic={mic} chrome={chrome}")
    ok = tw.wait_app_ready(60.0)
    log(f"wait_app_ready={ok}")
    return ok


def watch_suite(timeout_s: float = 240.0) -> str:
    import re

    deadline = time.time() + timeout_s
    while time.time() < deadline:
        text = LOG.read_text(encoding="utf-8", errors="ignore") if LOG.exists() else ""
        if re.search(r"WARN poller_not_seen|PASS|FAIL|ASK_|Spickzettel|NO_MODAL", text, re.I):
            return text
        # progressed past ready warnings into poller/ask
        if "WARN app_ready_timeout" in text:
            # still only timeouts?
            after = text.split("WARN app_ready_timeout")[-1]
            if re.search(r"poller|PASS|FAIL|ASK_|Spickzettel", after, re.I):
                return text
        if text.count("===") >= 2:
            return text
        time.sleep(2)
    return LOG.read_text(encoding="utf-8", errors="ignore") if LOG.exists() else ""


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    WATCH_LOG.write_text("", encoding="utf-8")
    log("killing stuck suite; waiting for USB…")
    kill_suite()
    ensure_ask()
    serial = None
    for i in range(600):  # up to ~30 min
        devs = devices()
        if PREFERRED in devs:
            serial = PREFERRED
            break
        if devs:
            serial = devs[0]
            log(f"non-preferred device online: {serial}")
            break
        if i % 10 == 0:
            log(f"still offline ({i*3}s)")
        time.sleep(3)
    if not serial:
        log("NO_DEVICE after 30min")
        return 2
    log(f"DEVICE {serial}")
    subprocess.run([ADB, "-s", serial, "reverse", "tcp:8791", "tcp:8791"], capture_output=True)
    subprocess.run([ADB, "-s", serial, "reverse", "tcp:8081", "tcp:8081"], capture_output=True)
    log("reverse: " + subprocess.run(
        [ADB, "-s", serial, "reverse", "--list"], capture_output=True, text=True
    ).stdout)
    analyze_and_ready(serial)
    pid = start_suite(serial)
    log(f"SUITE_PID {pid}")
    text = watch_suite(260.0)
    log("EARLY_LOG:\n" + text[-2500:])
    log(f"done pid={pid}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
