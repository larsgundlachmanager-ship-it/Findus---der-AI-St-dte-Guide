#!/usr/bin/env python3
"""
Poll adb until serial 00143157P001105 (or FINDUS_QA_SERIAL) appears, then:
  - adb reverse 8791
  - ensure askServer on :8791
  - install -r APK if present
  - launch app, wait ready
  - run _maennerwochenende_live.py
  - log to .cursor/live9/maennerwochenende/watch.log

PID file: .cursor/live9/maennerwochenende/watch.pid
"""
from __future__ import annotations

import os
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(r"c:\Users\larsf\Findus 2.0")
OUT = ROOT / ".cursor" / "live9" / "maennerwochenende"
LOG = OUT / "watch.log"
PID_FILE = OUT / "watch.pid"
ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
PKG = "de.findus.app"
EXPECTED = "00143157P001105"
APK = ROOT / "android" / "app" / "build" / "outputs" / "apk" / "release" / "app-release.apk"
ASK_PORT = 8791
LIVE = ROOT / "scripts" / "deviceQa" / "_maennerwochenende_live.py"
ASK_SERVER = ROOT / "scripts" / "deviceQa" / "askServer.mjs"

os.environ.setdefault("FINDUS_QA_SERIAL", EXPECTED)


def serial() -> str:
    return (os.environ.get("FINDUS_QA_SERIAL") or EXPECTED).strip()


def wlog(msg: str) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    line = f"{datetime.now(timezone.utc).strftime('%H:%M:%S')} {msg}"
    try:
        print(line, flush=True)
    except UnicodeEncodeError:
        print(line.encode("ascii", "replace").decode("ascii"), flush=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def adb_global(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [ADB, *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def adb(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [ADB, "-s", serial(), *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def device_online() -> bool:
    ser = serial()
    r = adb_global("devices")
    for line in (r.stdout or "").splitlines():
        if line.startswith(ser + "\t") and "\tdevice" in line:
            return True
    return False


def ask_health() -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{ASK_PORT}/health", timeout=2) as r:
            return r.status == 200
    except Exception:
        return False


def ensure_ask_server() -> None:
    if ask_health():
        wlog("askServer already up")
        return
    wlog("starting askServer.mjs")
    # Detached node process
    creationflags = 0
    if sys.platform == "win32":
        creationflags = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS
    subprocess.Popen(
        ["node", str(ASK_SERVER)],
        cwd=str(ROOT),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        stdin=subprocess.DEVNULL,
        creationflags=creationflags,
        close_fds=True,
    )
    for _ in range(20):
        time.sleep(0.4)
        if ask_health():
            wlog("askServer ready")
            return
    wlog("WARN askServer not responding yet — continuing")


def wait_app_ready(timeout_s: float = 90.0) -> bool:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        r = adb("shell", "uiautomator", "dump", "/data/local/tmp/findus_ui.xml")
        pull = adb("shell", "cat", "/data/local/tmp/findus_ui.xml")
        blob = (pull.stdout or "").lower()
        if re_search_ready(blob):
            return True
        time.sleep(2.0)
    return False


def re_search_ready(blob: str) -> bool:
    import re

    return bool(re.search(r"mikrofon|timeline|einstellungen|orte\b", blob)) and not bool(
        re.search(r"splash|wird geladen", blob)
    )


def install_apk() -> None:
    if not APK.is_file():
        wlog(f"APK missing: {APK}")
        return
    wlog(f"install -r {APK.name} ({APK.stat().st_size} bytes)")
    r = adb("install", "-r", "-d", str(APK))
    out = ((r.stdout or "") + (r.stderr or "")).strip()
    wlog(f"install rc={r.returncode} {out[-200:]}")


def launch_app() -> None:
    adb("shell", "am", "force-stop", PKG)
    time.sleep(1.0)
    adb(
        "shell",
        "monkey",
        "-p",
        PKG,
        "-c",
        "android.intent.category.LAUNCHER",
        "1",
    )
    wlog("app launched")


def run_live() -> int:
    wlog("RUN _maennerwochenende_live.py")
    env = os.environ.copy()
    env["FINDUS_QA_SERIAL"] = serial()
    with LOG.open("a", encoding="utf-8") as f:
        f.write(f"\n--- live start {datetime.now(timezone.utc).isoformat()} ---\n")
        p = subprocess.Popen(
            [sys.executable, str(LIVE)],
            cwd=str(ROOT),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        assert p.stdout is not None
        for line in p.stdout:
            sys.stdout.write(line)
            sys.stdout.flush()
            f.write(line)
            f.flush()
        rc = p.wait()
        f.write(f"--- live exit {rc} ---\n")
    wlog(f"live exit={rc}")
    return rc


def once_ready() -> int:
    ser = serial()
    wlog(f"device online: {ser}")
    adb("reverse", "tcp:8791", "tcp:8791")
    wlog("adb reverse tcp:8791 ok")
    ensure_ask_server()
    install_apk()
    launch_app()
    if wait_app_ready(100):
        wlog("app ready")
    else:
        wlog("WARN app ready timeout — running live anyway")
    return run_live()


def write_pid() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    PID_FILE.write_text(str(os.getpid()), encoding="utf-8")
    wlog(f"pid={os.getpid()} -> {PID_FILE}")


def main() -> int:
    write_pid()
    wlog(f"watching for serial={serial()}")
    # Immediate check
    if device_online():
        wlog("device already online — run now")
        return once_ready()

    # Poll forever (or until killed) — 5s interval, log every ~30s
    i = 0
    while True:
        if device_online():
            return once_ready()
        i += 1
        if i % 6 == 0:
            # also list devices for diagnostics
            r = adb_global("devices", "-l")
            wlog(f"still waiting ({i * 5}s) devices={(r.stdout or '').replace(chr(10), ' | ').strip()}")
        time.sleep(5)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        wlog("interrupted")
        raise SystemExit(130)
