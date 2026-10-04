#!/usr/bin/env python3
"""
Poll adb until Travel serial appears, then:
  - adb reverse 8791 + askServer
  - install -r latest release APK
  - launch app, wait ready
  - run _taxi_uber_live.py
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(r"c:\Users\larsf\Findus 2.0")
OUT = ROOT / ".cursor" / "live9" / "taxi_uber"
LOG = OUT / "watch.log"
PID_FILE = OUT / "watch.pid"
ADB = r"C:\Users\larsf\AppData\Local\Android\Sdk\platform-tools\adb.exe"
PKG = "de.findus.app"
EXPECTED = "00143157P001105"
APK = ROOT / "android" / "app" / "build" / "outputs" / "apk" / "release" / "app-release.apk"
ASK_PORT = 8791
LIVE = ROOT / "scripts" / "deviceQa" / "_taxi_uber_live.py"
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
    # Any authorized device? Prefer expected, else first device if FINDUS_QA_SERIAL unset override
    return False


def any_device_serial() -> str | None:
    r = adb_global("devices")
    for line in (r.stdout or "").splitlines():
        m = re.match(r"^(\S+)\tdevice\b", line)
        if m:
            return m.group(1)
    return None


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
    for _ in range(25):
        time.sleep(0.4)
        if ask_health():
            wlog("askServer ready")
            return
    wlog("WARN askServer not responding yet — continuing")


def wait_app_ready(timeout_s: float = 100.0) -> bool:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        adb("shell", "uiautomator", "dump", "/data/local/tmp/findus_ui.xml")
        pull = adb("shell", "cat", "/data/local/tmp/findus_ui.xml")
        blob = (pull.stdout or "").lower()
        if re.search(r"mikrofon|timeline|einstellungen|orte\b", blob) and not re.search(
            r"splash|wird geladen", blob
        ):
            return True
        time.sleep(2.0)
    return False


def wait_apk_fresh(max_wait_s: float = 900.0) -> None:
    """If a build is in progress (APK older than watch start), wait for newer mtime briefly."""
    # Marker: if apk-build log exists and is recent, wait for APK mtime bump
    build_log = ROOT / ".cursor" / "live9" / "taxi_uber" / "apk-build.log"
    if not APK.is_file():
        wlog("APK missing — waiting for build…")
    start = time.time()
    baseline = APK.stat().st_mtime if APK.is_file() else 0
    # Only wait if build log says running or APK very old relative to stay fix
    while time.time() - start < max_wait_s:
        if APK.is_file() and APK.stat().st_mtime > baseline and (time.time() - APK.stat().st_mtime) < 120:
            # freshly written
            wlog(f"APK ready mtime={APK.stat().st_mtime}")
            return
        if APK.is_file() and not build_log.is_file():
            return
        if build_log.is_file():
            tail = build_log.read_text(encoding="utf-8", errors="replace")[-800:].lower()
            if "build successful" in tail or "assembleRelease" in tail and "failed" in tail:
                if "build successful" in tail or "BUILD SUCCESSFUL" in build_log.read_text(
                    encoding="utf-8", errors="replace"
                ):
                    wlog("gradle BUILD SUCCESSFUL seen")
                    return
                if "BUILD FAILED" in build_log.read_text(encoding="utf-8", errors="replace"):
                    wlog("WARN BUILD FAILED — install existing APK")
                    return
        time.sleep(8)
    wlog("WARN apk wait timeout — install whatever exists")


def install_apk() -> None:
    wait_apk_fresh(60)  # short: build may still run; watcher polls USB first often
    if not APK.is_file():
        wlog(f"APK missing: {APK}")
        return
    wlog(f"install -r {APK.name} ({APK.stat().st_size} bytes, mtime={APK.stat().st_mtime})")
    r = adb("install", "-r", "-d", str(APK))
    out = ((r.stdout or "") + (r.stderr or "")).strip()
    wlog(f"install rc={r.returncode} {out[-240:]}")


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
    wlog("RUN _taxi_uber_live.py")
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
    # If expected not online but another device is, adopt it for this job
    if not device_online():
        other = any_device_serial()
        if other:
            os.environ["FINDUS_QA_SERIAL"] = other
            wlog(f"adopt serial={other}")
    wlog(f"device online: {serial()}")
    # Prefer waiting for in-progress APK rebuild before install
    build_log = OUT / "apk-build.log"
    if build_log.is_file():
        wlog("apk-build.log present — wait up to 15min for fresh APK")
        # longer wait only when build started
        deadline = time.time() + 900
        baseline = APK.stat().st_mtime if APK.is_file() else 0
        while time.time() < deadline:
            txt = build_log.read_text(encoding="utf-8", errors="replace")
            if "BUILD SUCCESSFUL" in txt and APK.is_file() and APK.stat().st_mtime >= baseline:
                # allow slight race: success line then copy
                time.sleep(2)
                if APK.stat().st_mtime > baseline or "BUILD SUCCESSFUL" in txt:
                    wlog("fresh APK after BUILD SUCCESSFUL")
                    break
            if "BUILD FAILED" in txt:
                wlog("WARN BUILD FAILED — continuing with existing APK")
                break
            time.sleep(6)
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


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    PID_FILE.write_text(str(os.getpid()), encoding="utf-8")
    wlog(f"pid={os.getpid()} watching serial={serial()}")
    if device_online() or any_device_serial():
        wlog("device already online — run now")
        return once_ready()
    i = 0
    while True:
        if device_online() or any_device_serial():
            return once_ready()
        i += 1
        if i % 6 == 0:
            r = adb_global("devices", "-l")
            wlog(
                f"still waiting ({i * 5}s) devices={(r.stdout or '').replace(chr(10), ' | ').strip()}"
            )
        time.sleep(5)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        wlog("interrupted")
        raise SystemExit(130)
